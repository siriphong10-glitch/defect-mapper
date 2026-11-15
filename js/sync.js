// Shared storage on Google Drive (via Apps Script).
// IndexedDB stays the working copy/cache; every local change is queued and sent to the server.
import { SCRIPT_URL } from './config.js';
import { db, hooks } from './db.js';
import { $$ } from './utils.js';

export const REMOTE = !!SCRIPT_URL;
const KEY_LS = 'dm_edit_key', Q_LS = 'dm_queue', KNOWN_LS = 'dm_known', VER_LS = 'dm_versions';

const ls = {
  get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* */ } },
};

let editKey = ls.get(KEY_LS, null);
let queue = ls.get(Q_LS, []);           // [{t:'op', op}|{t:'blob', id}|{t:'delBlob', id}]
const known = new Set(ls.get(KNOWN_LS, []));   // project ids that exist on the server
const versions = ls.get(VER_LS, {});    // projectId -> last version pulled/written
let state = 'idle', lastError = '';
const listeners = new Set();

export const canEdit = () => !REMOTE || !!editKey;
export const isKnown = (pid) => known.has(pid);
export const pendingCount = () => queue.length;

function saveQueue() { ls.set(Q_LS, queue); emit(); }
function saveKnown() { ls.set(KNOWN_LS, [...known]); }
function emit() { listeners.forEach(fn => fn()); renderStatus(); }
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

// ---------------------------------------------------------------- transport
async function apiGet(params) {
  const u = new URL(SCRIPT_URL);
  Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));
  const r = await fetch(u, { redirect: 'follow' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j;
}
async function apiPost(body) {
  const r = await fetch(SCRIPT_URL, { method: 'POST', body: JSON.stringify({ ...body, key: editKey }), redirect: 'follow' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  if (j.error === 'auth') { logout(); throw new Error('รหัสแก้ไขไม่ถูกต้องหรือถูกเปลี่ยนแล้ว'); }
  if (j.error) throw new Error(j.error);
  return j;
}

// ---------------------------------------------------------------- edit mode
export async function login(key) {
  const prev = editKey;
  editKey = key;
  try { await apiPost({ action: 'check' }); ls.set(KEY_LS, key); emit(); flush(); return true; }
  catch (e) { editKey = prev; if (/รหัส/.test(e.message)) return false; throw e; }
}
export function logout() { editKey = null; localStorage.removeItem(KEY_LS); emit(); }

// ---------------------------------------------------------------- queue
const KIND = { projects: 'project', floors: 'floor', defects: 'defect' };
let sending = null; // items currently in flight (removed from queue)

function enqueue(item) {
  if (item.t === 'op') {
    // coalesce repeated saves of the same record
    // (replace in place so a project is always created before its floors/pins)
    const i = queue.findIndex(q => q.t === 'op' && q.op.kind === item.op.kind && q.op.id === item.op.id);
    if (i >= 0) { queue[i] = item; saveQueue(); scheduleFlush(); return; }
  }
  queue.push(item);
  saveQueue();
  scheduleFlush();
}

let flushTimer = null;
function scheduleFlush(ms = 600) { clearTimeout(flushTimer); flushTimer = setTimeout(flush, ms); }

const toB64 = (blob) => new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.readAsDataURL(blob); });

let retryMs = 3000;
export async function flush() {
  if (!REMOTE || !editKey || sending || !queue.length) return;
  state = 'saving'; emit();
  try {
    while (queue.length && editKey) {
      const head = queue[0];
      if (head.t === 'op') {
        let n = 0; while (n < queue.length && n < 60 && queue[n].t === 'op') n++;
        sending = queue.splice(0, n); saveQueue();
        const res = await apiPost({ action: 'ops', ops: sending.map(s => s.op) });
        for (const [pid, v] of Object.entries(res.versions || {})) {
          if (v.deleted) { known.delete(pid); delete versions[pid]; continue; }
          known.add(pid);
          // someone else changed this project since we last pulled → mark stale so it gets pulled
          if (versions[pid] != null && v.prev != null && v.prev !== versions[pid]) staleProjects.add(pid);
          versions[pid] = v.now;
        }
        saveKnown(); ls.set(VER_LS, versions);
      } else if (head.t === 'blob') {
        sending = queue.splice(0, 1); saveQueue();
        const r = await db.get('blobs', head.id);
        if (r) await apiPost({ action: 'putBlob', id: head.id, mime: r.blob.type || 'image/jpeg', data: await toB64(r.blob) });
      } else if (head.t === 'delBlob') {
        let n = 0; while (n < queue.length && n < 100 && queue[n].t === 'delBlob') n++;
        sending = queue.splice(0, n); saveQueue();
        await apiPost({ action: 'delBlobs', ids: sending.map(s => s.id) });
      }
      sending = null;
      retryMs = 3000;
    }
    state = 'idle'; lastError = '';
  } catch (e) {
    console.warn('sync failed', e);
    if (sending) { queue.unshift(...sending); sending = null; saveQueue(); }
    state = 'error'; lastError = e.message;
    if (editKey) { scheduleFlush(retryMs); retryMs = Math.min(retryMs * 2, 60000); }
  }
  emit();
}
window.addEventListener('online', () => scheduleFlush(100));
window.addEventListener('beforeunload', (e) => { if (REMOTE && queue.length && editKey) { e.preventDefault(); e.returnValue = ''; } });

const pendingIds = () => new Set(queue.filter(q => q.t === 'op').map(q => q.op.id));
export const staleProjects = new Set();

// ---------------------------------------------------------------- hooks (local change → queue)
if (REMOTE) {
  hooks.onPut = (name, rec) => {
    if (!editKey) return;
    enqueue({ t: 'op', op: { kind: KIND[name], op: 'put', id: rec.id, projectId: rec.projectId, record: rec } });
  };
  hooks.onDel = (name, rec) => {
    if (!editKey) return;
    if (name === 'projects') queue = queue.filter(q => !(q.t === 'op' && (q.op.projectId === rec.id || q.op.id === rec.id)));
    enqueue({ t: 'op', op: { kind: KIND[name], op: 'del', id: rec.id, projectId: rec.projectId } });
  };
  hooks.onBlob = (id) => { if (editKey) enqueue({ t: 'blob', id }); };
  hooks.onDelBlob = (id) => {
    if (!editKey) return;
    const i = queue.findIndex(q => q.t === 'blob' && q.id === id);
    if (i >= 0) { queue.splice(i, 1); saveQueue(); return; } // never uploaded
    enqueue({ t: 'delBlob', id });
  };
  const inflight = new Map();
  hooks.fetchBlob = (id) => {
    if (!inflight.has(id)) {
      inflight.set(id, (async () => {
        try {
          const j = await apiGet({ action: 'blob', id });
          if (j.missing) return null;
          const bin = atob(j.data); const u8 = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
          return new Blob([u8], { type: j.mime || 'image/jpeg' });
        } catch (e) { console.warn('blob fetch failed', id, e); return null; }
        finally { setTimeout(() => inflight.delete(id), 0); }
      })());
    }
    return inflight.get(id);
  };
  if (editKey) scheduleFlush(300);
}

// ---------------------------------------------------------------- pull (server → local)
// Returns { counts: {pid:{floors,defects}}, ok }
export async function pullIndex() {
  if (!REMOTE) return { ok: true, counts: {} };
  const idx = await apiGet({ action: 'index' });
  const pend = pendingIds();
  const counts = {};
  const remoteIds = new Set(Object.keys(idx.projects || {}));
  for (const [pid, ent] of Object.entries(idx.projects || {})) {
    counts[pid] = ent.counts;
    known.add(pid);
    const local = await db.get('projects', pid);
    if (pend.has(pid) && local) continue;
    if (!local || (ent.project.updatedAt || 0) >= (local.updatedAt || 0)) await db.rawPut('projects', ent.project);
  }
  // projects that were on the server but are gone now → removed by someone else
  for (const p of await db.all('projects')) {
    if (!remoteIds.has(p.id) && known.has(p.id) && !pend.has(p.id)) {
      known.delete(p.id);
      await db.deleteProject(p.id, { local: true });
    }
  }
  saveKnown();
  return { ok: true, counts };
}

export async function remoteVersion(pid) {
  const j = await apiGet({ action: 'version', id: pid });
  return j.version;
}
export const localVersion = (pid) => versions[pid];

// Replace the local copy of one project with the server copy (keeping unsent local edits).
export async function pullProject(pid) {
  if (!REMOTE) return false;
  const pf = await apiGet({ action: 'project', id: pid });
  if (pf.missing) return known.has(pid) ? 'deleted' : false;
  const pend = pendingIds();
  if (!pend.has(pid) && pf.project) await db.rawPut('projects', pf.project);
  for (const [store, remote] of [['floors', pf.floors || {}], ['defects', pf.defects || {}]]) {
    const local = await db.byProject(store, pid);
    for (const rec of Object.values(remote)) if (!pend.has(rec.id)) await db.rawPut(store, rec);
    for (const rec of local) if (!remote[rec.id] && !pend.has(rec.id)) await db.rawDel(store, rec.id);
  }
  versions[pid] = pf.version; ls.set(VER_LS, versions);
  known.add(pid); saveKnown();
  staleProjects.delete(pid);
  return true;
}

// Upload a project that so far exists only in this browser.
export async function uploadProject(pid) {
  const p = await db.get('projects', pid);
  if (!p) return;
  const floors = await db.byProject('floors', pid);
  const defects = await db.byProject('defects', pid);
  const blobIds = [p.coverBlobId, ...floors.map(f => f.blobId), ...defects.flatMap(d => d.photoIds || [])].filter(Boolean);
  blobIds.forEach(id => enqueue({ t: 'blob', id }));
  enqueue({ t: 'op', op: { kind: 'project', op: 'put', id: p.id, record: p } });
  floors.forEach(f => enqueue({ t: 'op', op: { kind: 'floor', op: 'put', id: f.id, projectId: pid, record: f } }));
  defects.forEach(d => enqueue({ t: 'op', op: { kind: 'defect', op: 'put', id: d.id, projectId: pid, record: d } }));
}

// ---------------------------------------------------------------- status pill
export function statusText() {
  if (!REMOTE) return { cls: 'local', text: 'เก็บในเครื่องนี้', title: 'ยังไม่ได้ตั้งค่าที่เก็บข้อมูลกลาง' };
  if (!editKey) return { cls: 'view', text: '👁 โหมดดูอย่างเดียว', title: 'กด “เข้าโหมดแก้ไข” เพื่อแก้ไขข้อมูล' };
  if (state === 'error') return { cls: 'err', text: `⚠ ยังส่งไม่ได้ (${queue.length})`, title: lastError + ' — จะลองส่งใหม่อัตโนมัติ' };
  if (queue.length || state === 'saving') return { cls: 'busy', text: `⟳ กำลังบันทึก… (${queue.length + (sending ? sending.length : 0)})`, title: 'กำลังส่งข้อมูลขึ้น Google Drive' };
  return { cls: 'ok', text: '☁ บันทึกขึ้นระบบกลางแล้ว', title: 'ข้อมูลล่าสุดอยู่บน Google Drive แล้ว' };
}
export function renderStatus() {
  const s = statusText();
  $$('[data-sync]').forEach(el => { el.className = 'sync-pill ' + s.cls; el.textContent = s.text; el.title = s.title; });
}
