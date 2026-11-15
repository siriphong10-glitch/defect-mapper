/**
 * Defect Mapper — ส่วนเก็บข้อมูลกลางบน Google Drive
 *
 * วิธีติดตั้ง (ทำครั้งเดียว) ดูรายละเอียดใน apps-script/README.md
 *   1) แก้ค่า EDIT_KEY ด้านล่างเป็นรหัสสำหรับแก้ไขข้อมูล
 *   2) เลือกฟังก์ชัน setup แล้วกด Run (อนุญาตสิทธิ์ Google Drive)
 *   3) Deploy > New deployment > Web app
 *        Execute as: Me   •   Who has access: Anyone
 *   4) คัดลอก Web app URL ส่งให้ผู้ดูแลแอพ
 */

// รหัสสำหรับโหมดแก้ไข — เปลี่ยนก่อนกด Run setup (ไม่ถูกเก็บใน GitHub)
const EDIT_KEY = 'เปลี่ยนรหัสตรงนี้';

const ROOT_NAME = 'DefectMapper-Data';

// ------------------------------------------------------------------ setup
function setup() {
  const props = PropertiesService.getScriptProperties();
  if (!EDIT_KEY || EDIT_KEY === 'เปลี่ยนรหัสตรงนี้') throw new Error('กรุณาแก้ค่า EDIT_KEY ก่อน');
  props.setProperty('EDIT_KEY', EDIT_KEY);
  const r = root_();
  Logger.log('พร้อมใช้งาน — โฟลเดอร์ข้อมูล: ' + r.getUrl());
}

// ------------------------------------------------------------------ helpers
function root_() {
  const props = PropertiesService.getScriptProperties();
  let id = props.getProperty('ROOT_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { /* recreate */ } }
  const f = DriveApp.createFolder(ROOT_NAME);
  props.setProperty('ROOT_ID', f.getId());
  return f;
}
function sub_(name) {
  const r = root_();
  const it = r.getFoldersByName(name);
  return it.hasNext() ? it.next() : r.createFolder(name);
}
function readJson_(folder, name) {
  const it = folder.getFilesByName(name);
  if (!it.hasNext()) return null;
  return JSON.parse(it.next().getBlob().getDataAsString('UTF-8'));
}
function writeJson_(folder, name, obj) {
  const s = JSON.stringify(obj);
  const it = folder.getFilesByName(name);
  if (it.hasNext()) it.next().setContent(s);
  else folder.createFile(name, s, MimeType.PLAIN_TEXT);
}
function trashByName_(folder, name) {
  const it = folder.getFilesByName(name);
  while (it.hasNext()) it.next().setTrashed(true);
}
function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function index_() { return readJson_(root_(), 'index.json') || { projects: {} }; }
function projFile_(id) { return 'p_' + id + '.json'; }

// ------------------------------------------------------------------ read (anyone)
function doGet(e) {
  try {
    const p = e.parameter || {};
    switch (p.action) {
      case 'ping': return out_({ ok: true, app: 'defect-mapper' });
      case 'index': return out_(index_());
      case 'version': {
        const ent = index_().projects[p.id];
        return out_({ version: ent ? ent.version : null });
      }
      case 'project': {
        const pf = readJson_(sub_('projects'), projFile_(p.id));
        return out_(pf || { missing: true });
      }
      case 'blob': {
        const it = sub_('blobs').getFilesByName(p.id);
        if (!it.hasNext()) return out_({ missing: true });
        const b = it.next().getBlob();
        return out_({ mime: b.getContentType(), data: Utilities.base64Encode(b.getBytes()) });
      }
    }
    return out_({ error: 'unknown action' });
  } catch (err) {
    return out_({ error: String(err) });
  }
}

// ------------------------------------------------------------------ write (needs key)
function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return out_({ error: 'bad request' }); }
  const key = PropertiesService.getScriptProperties().getProperty('EDIT_KEY');
  if (!key || body.key !== key) return out_({ error: 'auth' });
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    switch (body.action) {
      case 'check': return out_({ ok: true });
      case 'ops': return out_(applyOps_(body.ops || []));
      case 'putBlob': {
        const folder = sub_('blobs');
        if (!folder.getFilesByName(body.id).hasNext()) {
          folder.createFile(Utilities.newBlob(Utilities.base64Decode(body.data), body.mime || 'image/jpeg', body.id));
        }
        return out_({ ok: true });
      }
      case 'delBlobs': {
        const folder = sub_('blobs');
        (body.ids || []).forEach(id => trashByName_(folder, id));
        return out_({ ok: true });
      }
    }
    return out_({ error: 'unknown action' });
  } catch (err) {
    return out_({ error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function summary_(pf) {
  const p = pf.project;
  return {
    project: p,
    version: pf.version,
    counts: { floors: Object.keys(pf.floors).length, defects: Object.keys(pf.defects).length },
  };
}

function applyOps_(ops) {
  const pfolder = sub_('projects');
  const idx = index_();
  const files = {};      // projectId -> project file object
  const prev = {};       // projectId -> version before this request
  const deleted = {};
  const load = (pid) => {
    if (!(pid in files)) {
      files[pid] = readJson_(pfolder, projFile_(pid));
      prev[pid] = files[pid] ? files[pid].version : null;
    }
    return files[pid];
  };
  ops.forEach(op => {
    const pid = op.kind === 'project' ? op.id : op.projectId;
    if (!pid) return;
    if (op.kind === 'project' && op.op === 'del') {
      const pf = load(pid);
      if (pf) {
        const ids = [pf.project && pf.project.coverBlobId];
        Object.values(pf.floors).forEach(f => ids.push(f.blobId));
        Object.values(pf.defects).forEach(d => (d.photoIds || []).forEach(x => ids.push(x)));
        const bf = sub_('blobs');
        ids.filter(Boolean).forEach(id => trashByName_(bf, id));
      }
      trashByName_(pfolder, projFile_(pid));
      delete idx.projects[pid];
      files[pid] = null; deleted[pid] = true;
      return;
    }
    let pf = load(pid);
    if (!pf) {
      if (op.kind !== 'project' || op.op !== 'put') return; // project gone: ignore stale child ops
      pf = files[pid] = { project: null, floors: {}, defects: {}, version: 0 };
      delete deleted[pid];
    }
    const bucket = op.kind === 'project' ? null : (op.kind === 'floor' ? pf.floors : pf.defects);
    if (op.kind === 'project') pf.project = op.record;
    else if (op.op === 'put') bucket[op.id] = op.record;
    else delete bucket[op.id];
    pf.dirty = true;
  });
  const versions = {};
  Object.keys(files).forEach(pid => {
    const pf = files[pid];
    if (!pf || !pf.dirty) { if (deleted[pid]) versions[pid] = { prev: prev[pid], now: null, deleted: true }; return; }
    delete pf.dirty;
    pf.version = (pf.version || 0) + 1;
    writeJson_(pfolder, projFile_(pid), pf);
    if (pf.project) idx.projects[pid] = summary_(pf);
    versions[pid] = { prev: prev[pid], now: pf.version };
  });
  writeJson_(root_(), 'index.json', idx);
  return { ok: true, versions };
}
