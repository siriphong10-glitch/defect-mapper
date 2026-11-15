import { db, blobUrl, forgetUrl, requestPersistence } from './db.js';
import { $, $$, esc, h, modal, confirmBox, toast, pickFiles, compressImage, fmtDate } from './utils.js';
import { newProject, touch } from './project.js';
import { TYPE_LABELS } from './templates.js';
import * as sync from './sync.js';
import { BUILD } from './version.js';

// Make sure every device runs the latest deployed version (old cached copies used to run without the shared storage)
if (BUILD !== 'dev') {
  fetch('version.json', { cache: 'no-store' }).then(r => r.json()).then(j => {
    if (j.v && j.v !== BUILD) {
      if (sessionStorage.getItem('dm_reloaded') !== j.v) { sessionStorage.setItem('dm_reloaded', j.v); location.reload(); }
      else toast('มีเวอร์ชันใหม่ของแอพ — กด Ctrl+F5 เพื่อโหลดใหม่', 'error', 8000);
    }
  }).catch(() => {});
}

const applyMode = () => document.body.classList.toggle('viewer', !sync.canEdit());
sync.onChange(applyMode);
applyMode();

const app = $('#app');
const ACCENTS = ['#1f3a5f', '#2563eb', '#0f766e', '#15803d', '#ca8a04', '#ea580c', '#dc2626', '#be185d', '#7c3aed', '#475569'];

const PIN_LOGO = `<svg width="22" height="22" viewBox="0 0 24 24"><path d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7z" fill="#ff5a4e"/><circle cx="12" cy="9" r="2.6" fill="#fff"/></svg>`;

// ---------------- router ----------------
async function route() {
  if (handleEditHash()) { renderHome(); return; }
  const m = location.hash.match(/^#\/p\/([\w-]+)/);
  if (m) {
    const { openWorkspace } = await import('./workspace.js');
    const ok = await openWorkspace(app, m[1]);
    if (!ok) { toast('ไม่พบโครงการนี้', 'error'); location.hash = '#/'; }
  } else {
    renderHome();
  }
}
window.addEventListener('hashchange', route);

// ---------------- home ----------------
let lastPull = 0, remoteCounts = {}, homeTimer = null;
async function renderHome(fromPull = false) {
  document.title = 'Defect Mapper — โครงการทั้งหมด';
  const editable = sync.canEdit();
  const projects = (await db.all('projects')).sort((a, b) => b.updatedAt - a.updatedAt);
  const floors = await db.all('floors');
  const defects = await db.all('defects');
  const cntF = {}, cntD = {};
  floors.forEach(f => cntF[f.projectId] = (cntF[f.projectId] || 0) + 1);
  defects.forEach(d => cntD[d.projectId] = (cntD[d.projectId] || 0) + 1);
  for (const [pid, c] of Object.entries(remoteCounts)) { if (c) { cntF[pid] = c.floors; cntD[pid] = c.defects; } }
  const q0 = $('#q')?.value || '';

  app.innerHTML = '';
  const page = h(`<div>
    <div class="home-top"><div class="inner">
      <div class="brand"><div class="logo">${PIN_LOGO}</div><div><h1>Defect Mapper</h1><p>ระบบปักตำแหน่งความเสียหาย-ข้อบกพร่องบนแบบแปลน</p></div></div>
      <div class="spacer"></div>
      <span data-sync></span>
      ${sync.REMOTE ? `<button class="btn" id="btnAuth">${editable ? '🔓 ออกจากโหมดแก้ไข' : '🔒 เข้าโหมดแก้ไข'}</button>` : ''}
      ${sync.REMOTE ? `<button class="btn" id="btnLinks" title="คัดลอกลิงก์สำหรับส่งให้คนอื่น">🔗 ลิงก์</button>` : ''}
      <button class="btn edit-only" id="btnImport" title="นำเข้าไฟล์แพ็กข้อมูลโครงการ (.zip)">⤒ นำเข้าโครงการ</button>
      <button class="btn primary edit-only" id="btnNew">＋ โครงการใหม่</button>
    </div></div>
    <div class="home-body">
      <div class="home-tools">
        <input class="inp" id="q" type="text" placeholder="ค้นหาชื่อ / รหัสโครงการ / ลูกค้า" value="${esc(q0)}">
        <span class="muted" style="margin-left:auto;font-size:13px">${sync.REMOTE
          ? 'ข้อมูลเก็บไว้ที่ Google Drive ส่วนกลาง — ทุกคนที่มีลิงก์ดูได้ แก้ไขได้เมื่อใส่รหัส'
          : 'ข้อมูลทั้งหมดเก็บอยู่ในเบราว์เซอร์นี้ — ควรส่งออก “แพ็กข้อมูลโครงการ” เป็นระยะเพื่อสำรอง'}</span>
      </div>
      <div class="cards" id="cards"></div>
    </div></div>`);
  app.appendChild(page);
  sync.renderStatus();
  $('#btnNew').onclick = () => projectDialog();
  $('#btnImport').onclick = importProject;
  if ($('#btnLinks')) $('#btnLinks').onclick = (e) => shareLinks(e.currentTarget);
  if ($('#btnAuth')) $('#btnAuth').onclick = () => (editable ? (sync.logout(), renderHome()) : editLogin(() => renderHome()));

  const cards = $('#cards');
  const draw = (q = '') => {
    cards.innerHTML = '';
    if (editable) {
      const nc = h(`<div class="pcard new"><div class="plus">＋</div><div>สร้างโครงการใหม่</div></div>`);
      nc.onclick = () => projectDialog();
      cards.appendChild(nc);
    }
    const ql = q.trim().toLowerCase();
    for (const p of projects) {
      if (ql && ![p.name, p.code, p.client, p.location].join(' ').toLowerCase().includes(ql)) continue;
      const localOnly = sync.REMOTE && !sync.isKnown(p.id);
      const c = h(`<div class="pcard" style="--accent:${esc(p.accent)}">
        ${p.coverBlobId ? `<div class="cover"></div>` : ''}
        <button class="icon-btn menu-btn" title="ตัวเลือก">⋯</button>
        <div class="body">
          ${localOnly ? `<div class="local-tag" title="โครงการนี้ยังอยู่เฉพาะในเบราว์เซอร์เครื่องนี้ คนอื่นยังมองไม่เห็น">เฉพาะเครื่องนี้</div>` : ''}
          ${p.code ? `<div class="code">${esc(p.code)}</div>` : ''}
          <h3>${esc(p.name)}</h3>
          ${p.client ? `<div class="meta">${esc(p.client)}</div>` : ''}
          ${p.location ? `<div class="meta">📍 ${esc(p.location)}</div>` : ''}
          <div class="stats"><span><b>${cntF[p.id] || 0}</b> ชั้น/แปลน</span><span><b>${cntD[p.id] || 0}</b> จุด</span><span style="margin-left:auto">${fmtDate(p.updatedAt)}</span></div>
        </div></div>`);
      if (p.coverBlobId) blobUrl(p.coverBlobId).then(u => { if (u) $('.cover', c).style.backgroundImage = `url('${u}')`; });
      c.onclick = (e) => { if (!e.target.closest('.menu-btn')) location.hash = `#/p/${p.id}`; };
      $('.menu-btn', c).onclick = (e) => {
        e.stopPropagation();
        const items = [];
        if (editable && localOnly) items.push({ label: '☁ อัปโหลดขึ้นระบบกลาง (ให้คนอื่นเห็น)', fn: async () => { await sync.uploadProject(p.id); toast('กำลังอัปโหลด — ดูสถานะที่มุมขวาบน', 'ok', 3500); } });
        if (editable) items.push({ label: '✎ แก้ไขข้อมูลโครงการ', fn: () => projectDialog(p) });
        items.push({ label: '⤓ ส่งออก (Word / PDF / Excel / รูป / แพ็กข้อมูล)…', fn: async () => { const { exportDialog } = await import('./export.js'); exportDialog(p.id); } });
        if (editable) items.push('-', { label: '🗑 ลบโครงการ', danger: true, fn: async () => {
          const msg = sync.REMOTE && !localOnly ? `ลบโครงการ “${p.name}” พร้อมแปลนและรูปทั้งหมด ออกจากระบบกลาง? ทุกคนจะมองไม่เห็นโครงการนี้อีก และย้อนกลับไม่ได้` : `ลบโครงการ “${p.name}” พร้อมแปลนและรูปทั้งหมด? การลบไม่สามารถย้อนกลับได้`;
          if (await confirmBox(msg, { ok: 'ลบโครงการ', danger: true })) {
            await db.deleteProject(p.id, { local: localOnly }); toast('ลบโครงการแล้ว'); renderHome();
          }
        } });
        dropdown(e.currentTarget, items);
      };
      cards.appendChild(c);
    }
    if (!projects.length) cards.appendChild(h(`<div class="empty">${sync.REMOTE && !fromPull ? 'กำลังโหลดโครงการจากระบบกลาง…' : editable ? 'ยังไม่มีโครงการ — เริ่มจากกด “สร้างโครงการใหม่”' : 'ยังไม่มีโครงการ'}</div>`));
    const localCount = sync.REMOTE && editable ? projects.filter(p => !sync.isKnown(p.id)).length : 0;
    if (localCount && fromPull) {
      const bar = h(`<div class="upload-bar">มี ${localCount} โครงการที่อยู่เฉพาะในเครื่องนี้ <button class="btn sm primary">☁ อัปโหลดทั้งหมดขึ้นระบบกลาง</button></div>`);
      $('button', bar).onclick = async () => { for (const p of projects.filter(p => !sync.isKnown(p.id))) await sync.uploadProject(p.id); bar.remove(); toast('กำลังอัปโหลด — ดูสถานะที่มุมขวาบน', 'ok', 3500); };
      cards.before(bar);
    }
  };
  $('#q').oninput = (e) => draw(e.target.value);
  draw(q0);

  if (sync.REMOTE) {
    clearTimeout(homeTimer);
    homeTimer = setTimeout(() => {
      if (!location.hash.startsWith('#/p/') && !document.querySelector('.modal-back, .dropdown') && !document.hidden && !$('#q')?.value) renderHome();
    }, 30000);
  }
  if (sync.REMOTE && !fromPull && Date.now() - lastPull > 5000) {
    try {
      const r = await sync.pullIndex();
      remoteCounts = r.counts; lastPull = Date.now();
      if (!location.hash.startsWith('#/p/')) renderHome(true);
    } catch (e) {
      console.warn(e);
      toast('เชื่อมต่อระบบกลางไม่ได้ — แสดงข้อมูลที่เคยโหลดไว้ในเครื่อง', 'error', 5000);
    }
  }
}

export function editLogin(after) {
  const m = modal({
    title: 'เข้าโหมดแก้ไข',
    body: `<p class="muted" style="margin-top:0">ใส่รหัสแก้ไขของทีม เพื่อปักตำแหน่ง แก้ไข หรือลบข้อมูล (ระบบจะจำรหัสไว้ในเบราว์เซอร์นี้)</p>
      <label class="fld"><span>รหัสแก้ไข</span><input type="password" autocomplete="current-password"></label><span class="err" id="authErr" style="color:var(--danger);font-size:13px"></span>`,
    actions: [{ label: 'ยกเลิก', value: null }, { label: 'เข้าสู่โหมดแก้ไข', kind: 'primary', onClick: async (b) => {
      const v = $('input', b).value;
      if (!v) return false;
      $('#authErr', b).textContent = 'กำลังตรวจสอบ…';
      try {
        if (await sync.login(v)) { toast('เข้าสู่โหมดแก้ไขแล้ว', 'ok'); after && after(); return true; }
        $('#authErr', b).textContent = 'รหัสไม่ถูกต้อง';
      } catch (e) { $('#authErr', b).textContent = 'เชื่อมต่อระบบกลางไม่ได้: ' + e.message; }
      return false;
    } }],
  });
  $('input', m.body).addEventListener('keydown', (e) => { if (e.key === 'Enter') $('.modal-foot .btn.primary', m.el).click(); });
}

export function dropdown(anchor, items) {
  $$('.dropdown').forEach(d => d.remove());
  const dd = h('<div class="dropdown"></div>');
  for (const it of items) {
    if (it === '-') { dd.appendChild(h('<hr>')); continue; }
    const b = h(`<button class="${it.danger ? 'danger' : ''}">${it.html || esc(it.label)}</button>`);
    b.onclick = () => { dd.remove(); it.fn(); };
    dd.appendChild(b);
  }
  document.body.appendChild(dd);
  const r = anchor.getBoundingClientRect();
  const w = dd.offsetWidth, hh = dd.offsetHeight;
  dd.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w)) + 'px';
  dd.style.top = (r.bottom + 4 + hh > window.innerHeight ? Math.max(8, r.top - hh - 4) : r.bottom + 4) + 'px';
  setTimeout(() => {
    const off = (e) => { if (!dd.contains(e.target)) { dd.remove(); document.removeEventListener('mousedown', off); } };
    document.addEventListener('mousedown', off);
  });
  return dd;
}

// ---------------- project create / edit ----------------
export async function projectDialog(existing = null, onSaved = null) {
  const isNew = !existing;
  const p = existing || { accent: ACCENTS[0], defaultType: 'structural' };
  let coverBlob = null, coverRemoved = false;
  const coverUrl = p.coverBlobId ? await blobUrl(p.coverBlobId) : null;

  const body = h(`<div>
    <label class="fld"><span>ชื่อโครงการ *</span><input type="text" name="name" value="${esc(p.name || '')}" placeholder="เช่น อาคารจอดรถ ABC Tower"></label>
    <div class="row">
      <label class="fld"><span>รหัสงาน / เลขที่ใบเสนอราคา</span><input type="text" name="code" value="${esc(p.code || '')}" placeholder="เช่น ST691113"></label>
      <label class="fld"><span>วันที่ตรวจสอบ</span><input type="date" name="inspectDate" value="${esc(p.inspectDate || '')}"></label>
    </div>
    <div class="row">
      <label class="fld"><span>ผู้ว่าจ้าง / ลูกค้า</span><input type="text" name="client" value="${esc(p.client || '')}"></label>
      <label class="fld"><span>ผู้ตรวจสอบ</span><input type="text" name="inspector" value="${esc(p.inspector || '')}"></label>
    </div>
    <label class="fld"><span>สถานที่ตั้ง</span><input type="text" name="location" value="${esc(p.location || '')}"></label>
    <div class="row">
      <div class="fld"><span>รูปหน้าปกการ์ด (ไม่บังคับ)</span>
        <div class="cover-prev" id="cov" ${coverUrl ? `style="background-image:url('${coverUrl}')"` : ''}>${coverUrl ? '' : 'คลิกเพื่อเลือกรูป'}</div>
        <button class="btn ghost sm" id="covDel" type="button" style="align-self:flex-start;${coverUrl ? '' : 'display:none'}">ลบรูป</button>
      </div>
      <div class="fld"><span>สีขอบการ์ด</span>
        <div class="color-row" id="colors">${ACCENTS.map(c => `<span class="swatch ${c === p.accent ? 'on' : ''}" data-c="${c}" style="background:${c}"></span>`).join('')}
          <input type="color" id="customColor" value="${esc(p.accent)}" title="เลือกสีเอง" style="width:30px;height:28px;border:0;background:none;padding:0;cursor:pointer"></div>
        <span style="margin-top:10px">ประเภทการตรวจเริ่มต้น</span>
        <select name="defaultType" class="inp">
          <option value="structural" ${p.defaultType === 'structural' ? 'selected' : ''}>${TYPE_LABELS.structural}</option>
          <option value="general" ${p.defaultType === 'general' ? 'selected' : ''}>${TYPE_LABELS.general}</option>
        </select>
        <span class="hint">เปลี่ยนได้รายจุดระหว่างการปักตำแหน่ง</span>
      </div>
    </div>
    <div class="fld"><span>การรันลำดับเลขตำแหน่ง ${isNew ? '* (กรุณาเลือก)' : ''}</span>
      <div class="num-choice">
        <label><input type="radio" name="numbering" value="auto" ${p.numbering === 'auto' ? 'checked' : ''}><b>ให้โปรแกรมรันอัตโนมัติ</b><span class="hint">1, 2, 3 … เรียงตามลำดับการปัก แก้ตัวเลขเองไม่ได้ (สั่งเรียงลำดับใหม่ได้)</span></label>
        <label><input type="radio" name="numbering" value="manual" ${p.numbering === 'manual' ? 'checked' : ''}><b>ให้ผู้ใช้กำหนดเอง</b><span class="hint">พิมพ์เลขได้เอง เช่น 12, A-05 ระบบเสนอเลขถัดไปให้ และตรวจไม่ให้ซ้ำกัน</span></label>
      </div>
      <span class="err" id="numErr"></span>
    </div>
  </div>`);

  let accent = p.accent;
  $$('.swatch', body).forEach(s => s.onclick = () => {
    accent = s.dataset.c; $$('.swatch', body).forEach(x => x.classList.toggle('on', x === s)); $('#customColor', body).value = accent;
  });
  $('#customColor', body).oninput = (e) => { accent = e.target.value; $$('.swatch', body).forEach(x => x.classList.remove('on')); };
  $('#cov', body).onclick = async () => {
    const [f] = await pickFiles({ accept: 'image/*' });
    if (!f) return;
    coverBlob = (await compressImage(f, 1200, 0.85)).blob;
    coverRemoved = false;
    const u = URL.createObjectURL(coverBlob);
    $('#cov', body).style.backgroundImage = `url('${u}')`; $('#cov', body).textContent = '';
    $('#covDel', body).style.display = '';
  };
  $('#covDel', body).onclick = () => {
    coverBlob = null; coverRemoved = true;
    $('#cov', body).style.backgroundImage = ''; $('#cov', body).textContent = 'คลิกเพื่อเลือกรูป';
    $('#covDel', body).style.display = 'none';
  };

  const m = modal({
    title: isNew ? 'สร้างโครงการใหม่' : 'แก้ไขข้อมูลโครงการ',
    body, wide: true,
    actions: [
      { label: 'ยกเลิก', value: null },
      { label: isNew ? 'สร้างโครงการ' : 'บันทึก', kind: 'primary', onClick: async (b) => {
        const v = (n) => $(`[name=${n}]`, b)?.value.trim();
        const name = v('name');
        if (!name) { $('[name=name]', b).focus(); toast('กรุณาใส่ชื่อโครงการ', 'error'); return false; }
        const numbering = $('[name=numbering]:checked', b)?.value;
        if (!numbering) { $('#numErr', b).textContent = 'กรุณาเลือกรูปแบบการรันลำดับเลขก่อนเริ่มโครงการ'; return false; }
        const fields = { name, code: v('code'), client: v('client'), location: v('location'), inspector: v('inspector'),
          inspectDate: v('inspectDate'), accent, numbering, defaultType: v('defaultType') };
        let coverBlobId = p.coverBlobId || null;
        if (coverBlob) { if (coverBlobId) { forgetUrl(coverBlobId); await db.delBlob(coverBlobId); } coverBlobId = await db.putBlob(coverBlob); }
        else if (coverRemoved && coverBlobId) { forgetUrl(coverBlobId); await db.delBlob(coverBlobId); coverBlobId = null; }
        fields.coverBlobId = coverBlobId;
        if (isNew) {
          const np = await newProject(fields);
          requestPersistence();
          location.hash = `#/p/${np.id}`;
          return np;
        }
        Object.assign(existing, fields);
        await touch(existing);
        if (onSaved) onSaved(existing); else renderHome();
        toast('บันทึกแล้ว', 'ok');
        return existing;
      } },
    ],
  });
  return m.done;
}

async function importProject() {
  const [f] = await pickFiles({ accept: '.zip,application/zip' });
  if (!f) return;
  try {
    const { importPack } = await import('./export.js');
    const p = await importPack(f);
    toast(`นำเข้าโครงการ “${p.name}” แล้ว`, 'ok');
    renderHome();
  } catch (e) {
    console.error(e);
    toast('นำเข้าไม่สำเร็จ: ' + e.message, 'error', 5000);
  }
}

const BASE_URL = location.origin + location.pathname;
async function copyText(text, what) {
  try { await navigator.clipboard.writeText(text); toast(`คัดลอก${what}แล้ว`, 'ok'); }
  catch { modal({ title: what, body: `<label class="fld"><span>คัดลอกลิงก์นี้</span><input type="text" value="${esc(text)}" readonly onfocus="this.select()"></label>`, actions: [{ label: 'ปิด' }] }); }
}
function shareLinks(anchor) {
  const items = [{ label: '👁 คัดลอกลิงก์สำหรับดู (ไม่ต้องใช้รหัส)', fn: () => copyText(BASE_URL, 'ลิงก์สำหรับดู') }];
  if (sync.getKey()) items.push({ label: '✎ คัดลอกลิงก์สำหรับแก้ไข (ใส่รหัสในลิงก์แล้ว)', fn: async () => {
    if (await confirmBox('ลิงก์นี้มีรหัสแก้ไขอยู่ในตัว ใครได้ลิงก์ไปจะแก้ไขและลบข้อมูลได้ทันที ส่งให้เฉพาะคนในทีมเท่านั้น (ถ้าลิงก์หลุด ให้เปลี่ยนรหัสใน Apps Script แล้วลิงก์เดิมจะใช้ไม่ได้)', { ok: 'คัดลอกลิงก์แก้ไข', title: 'ลิงก์สำหรับแก้ไข' }))
      copyText(`${BASE_URL}#edit=${encodeURIComponent(sync.getKey())}`, 'ลิงก์สำหรับแก้ไข');
  } });
  else items.push({ label: '✎ ลิงก์สำหรับแก้ไข — เข้าโหมดแก้ไขก่อน', fn: () => editLogin(() => renderHome()) });
  dropdown(anchor, items);
}

// Edit link: #edit=<key> → log in, then remove the key from the address bar
function handleEditHash() {
  const m = location.hash.match(/^#edit=(.+)$/);
  if (!m || !sync.REMOTE) return false;
  const k = decodeURIComponent(m[1]);
  history.replaceState(null, '', BASE_URL + '#/');
  sync.login(k).then(ok => {
    toast(ok ? 'เข้าสู่โหมดแก้ไขแล้ว' : 'รหัสในลิงก์ไม่ถูกต้องหรือถูกเปลี่ยนแล้ว', ok ? 'ok' : 'error', 4000);
    if (!location.hash.startsWith('#/p/')) renderHome();
  }).catch(() => toast('เชื่อมต่อระบบกลางไม่ได้', 'error'));
  return true;
}

export { renderHome };
route();
