import { db, uid, blobUrl, forgetUrl } from './db.js';
import { $, $$, esc, h, modal, confirmBox, promptBox, toast, pickFiles, compressImage, debounce, naturalCmp,
  loadImage, polyArea, centroid } from './utils.js';
import { loadBundle, touch, suggestNo, isDuplicateNo, renumberAll } from './project.js';
import { TYPE_LABELS, fieldByRole, severityInfo, NO_SEVERITY_COLOR, textOn, defectTitle } from './templates.js';
import { dropdown, projectDialog, editLogin } from './app.js';
import * as sync from './sync.js';
import { prefixFor, nextCode, stationLevel, levelColor, typeDef, settingsOf, allTypes, ensureCodes, stationLabel, typePrefix, codeOf } from './tests.js';
import { buildTestPanel, stationChips, pickTypeSet, testSettingsEditor } from './test-panel.js';
import { canOverhead, isOverhead, upperFloor, similarity, overheadView, joinName } from './overhead.js';
import { renderDashboard, exportDashboardPng } from './dashboard.js';
import './keypad.js';

const ICON = {
  select: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M5 3l14 8-6 1.5L10 19z"/></svg>',
  point: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 2.5a6.5 6.5 0 0 0-6.5 6.5c0 4.9 6.5 12.5 6.5 12.5s6.5-7.6 6.5-12.5A6.5 6.5 0 0 0 12 2.5z"/><circle cx="12" cy="9" r="2.3"/></svg>',
  area: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M4 7l7-4 9 6-3 11-11-2z" fill="currentColor" fill-opacity=".15"/><circle cx="4" cy="7" r="1.6" fill="currentColor"/><circle cx="11" cy="3" r="1.6" fill="currentColor"/><circle cx="20" cy="9" r="1.6" fill="currentColor"/><circle cx="17" cy="20" r="1.6" fill="currentColor"/><circle cx="6" cy="18" r="1.6" fill="currentColor"/></svg>',
  rect: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="6" width="16" height="12" rx="1" fill="currentColor" fill-opacity=".15"/></svg>',
  scale: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 15l12-12 6 6-12 12z"/><path d="M7 11l2 2M10 8l2 2M13 5l2 2"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.8 2.8L16.5 9.5"/></svg>',
  layers: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5" opacity=".6"/></svg>',
  flask: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M9 3h6M10 3v6l-5.5 9.5A1.6 1.6 0 0 0 5.9 21h12.2a1.6 1.6 0 0 0 1.4-2.5L14 9V3"/><path d="M7.5 15h9"/></svg>',
  label: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="8"/><path d="M10 9h3v7"/></svg>',
  up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5h18" stroke-dasharray="3 2.4"/><path d="M12 20V9M7.5 13.5 12 9l4.5 4.5"/></svg>',
};
const TOOL_HINT = {
  select: 'คลิกเลือกจุด • ลากจุดเพื่อย้าย • ลากพื้นที่ว่างเพื่อเลื่อนแปลน • ล้อเมาส์เพื่อซูม',
  point: 'คลิกบนแปลนเพื่อปักจุดความเสียหาย',
  area: 'คลิกทีละมุมเพื่อวาดพื้นที่ • คลิกจุดแรก / ดับเบิลคลิก / Enter เพื่อจบ • Backspace ลบมุมล่าสุด • Esc ยกเลิก',
  rect: 'ลากเพื่อวาดพื้นที่สี่เหลี่ยม',
  scale: 'คลิก 2 จุดบนแปลนที่ทราบระยะจริง (เช่น ระยะกริด) แล้วใส่ความยาวเป็นเมตร',
};

let S = null; // workspace state
window.__dm = { get S() { return S; } }; // for debugging/tests

export async function openWorkspace(root, projectId) {
  if (sync.REMOTE) {
    if (!(await db.get('projects', projectId))) root.innerHTML = '<div class="empty" style="padding-top:120px">กำลังโหลดโครงการจากระบบกลาง…</div>';
    try {
      const r = await sync.pullProject(projectId);
      if (r === 'deleted') { toast('โครงการนี้ถูกลบออกจากระบบกลางแล้ว', 'error'); await db.deleteProject(projectId, { local: true }); return false; }
    } catch (e) { console.warn(e); toast('เชื่อมต่อระบบกลางไม่ได้ — แสดงข้อมูลที่เคยโหลดไว้ในเครื่อง', 'error', 5000); }
  }
  const b = await loadBundle(projectId);
  if (!b) return false;
  S = {
    root, ...b,
    floorId: null, selectedId: null, tool: 'select', copyPrev: false, showLabels: true,
    view: { tx: 0, ty: 0, s: 1 }, draft: null, img: null, imgUrl: null, lastCreatedId: null,
    filter: '', mode: ['test', 'overview'].includes(localStorage.getItem('dm_mode_' + projectId)) ? localStorage.getItem('dm_mode_' + projectId) : 'defect',
    showOther: localStorage.getItem('dm_show_other') !== '0',
    confirm: localStorage.getItem('dm_confirm') !== '0', pending: null,
    overhead: localStorage.getItem('dm_over') === '1', // new pins are 'overhead' (soffit of the floor above)
  };
  S.floorId = (b.floors[0] || {}).id || null;
  ensureCodes(b.project, S.tests);
  document.title = b.project.name + ' — Inspect Recorder';
  renderShell();
  await selectFloor(S.floorId, true);
  if (S.mode === 'overview') renderDash();
  startPolling();
  return true;
}

const canEdit = () => sync.canEdit();

// ---- keep in sync with changes made by other people
let pollTimer = null;
function startPolling() {
  clearInterval(pollTimer);
  if (!sync.REMOTE) return;
  const mine = S;
  pollTimer = setInterval(async () => {
    if (S !== mine || !document.body.contains($('#canvas'))) { clearInterval(pollTimer); return; }
    if (document.hidden || sync.pendingCount() || S.draft || gesture) return;
    if (document.activeElement && $('#right')?.contains(document.activeElement)) return; // user is typing
    try {
      const pid = S.project.id;
      const v = await sync.remoteVersion(pid);
      if (v == null || (v === sync.localVersion(pid) && !sync.staleProjects.has(pid))) return;
      if (await sync.pullProject(pid) !== true) return;
      await reloadFromLocal();
    } catch (e) { /* offline: try again next tick */ }
  }, 15000);
}

async function reloadFromLocal() {
  const b = await loadBundle(S.project.id);
  if (!b) return;
  const oldFloor = curFloor();
  S.project = b.project; S.floors = b.floors; S.defects = b.defects; S.tests = b.tests; ensureCodes(S.project, S.tests);
  if (S.selectedId && !selected()) S.selectedId = null;
  renderTitle();
  const nf = curFloor();
  if (!nf || !oldFloor || nf.blobId !== oldFloor.blobId) await selectFloor(nf ? nf.id : (S.floors[0]?.id || null));
  else { S.img = { w: nf.w, h: nf.h }; refreshAll(); renderCanvasBase(); }
}

const P = () => S.project;
const tplOf = (d) => P().templates[d.type] || P().templates.structural;
const curFloor = () => S.floors.find(f => f.id === S.floorId) || null;
const isTest = () => S.mode === 'test';
const curItems = () => (isTest() ? S.tests : S.defects);
const floorDefects = () => curItems().filter(d => d.floorId === S.floorId);
const selected = () => curItems().find(d => d.id === S.selectedId) || null;
const itemLabel = (d) => (d.layer === 'test' ? d.code : d.no);

export function defectColor(project, d) {
  const tpl = project.templates[d.type] || project.templates.structural;
  const sf = fieldByRole(tpl, 'severity');
  const info = sf ? severityInfo(tpl, d.data?.[sf.key]) : null;
  return info ? info.color : NO_SEVERITY_COLOR;
}

// ===================================================================== shell
function renderShell() {
  const p = P();
  S.root.innerHTML = '';
  const el = h(`<div class="ws ${S.mode === 'overview' ? 'overview' : ''}" style="--accent:${esc(p.accent)}">
    <div class="ws-top">
      <button class="btn ghost" id="back" title="กลับหน้ารวมโครงการ">← โครงการทั้งหมด</button>
      <div class="title"><h2 id="pname"></h2><div class="sub" id="psub"></div></div>
      <div class="mode-seg" id="modeSeg"><button data-mode="overview" class="${S.mode === 'overview' ? 'on' : ''}">ภาพรวม</button><button data-mode="defect" class="${S.mode === 'defect' ? 'on' : ''}">ความเสียหาย</button><button data-mode="test" class="${isTest() ? 'on' : ''}">ผลทดสอบ</button></div>
      <span data-sync></span>
      ${sync.REMOTE ? `<button class="btn ghost" id="btnAuth">${canEdit() ? '🔓 ออกโหมดแก้ไข' : '🔒 เข้าโหมดแก้ไข'}</button>` : ''}
      <button class="btn edit-only" id="btnTpl" title="${isTest() ? 'ตั้งค่าการทดสอบและเกณฑ์ประเมิน' : 'แก้ไขหัวข้อและตัวเลือกความเสียหาย'}">${isTest() ? '⚙ การทดสอบและเกณฑ์' : '⚙ หัวข้อความเสียหาย'}</button>
      <button class="icon-btn" id="btnMore" title="เพิ่มเติม">⋯</button>
      <span class="exp-split"><button class="btn primary" id="btnExport" title="ส่งออกรายงาน">⤓ ส่งออก</button><button class="btn primary" id="btnExportMenu" title="เลือกรูปแบบไฟล์">▾</button></span>
    </div>
    <div class="ws-floors">
      <button class="btn sm edit-only" id="btnImport" title="นำเข้ารูปแปลน (JPG/PNG) หรือ PDF ได้หลายไฟล์ในครั้งเดียว">＋ นำเข้าแปลนชั้น</button>
      <div class="floor-nav" id="ftabs"></div>
    </div>
    <div class="ws-main">
      <aside class="ws-left ${localStorage.getItem('dm_left_collapsed') === '1' ? 'collapsed' : ''}" id="left">
        <button class="ltoggle" id="lToggle" title="ซ่อน/แสดงรายการความเสียหาย ( [ )"></button>
        <div class="lhead"><h4><span>${isTest() ? 'จุดทดสอบในชั้นนี้' : 'รายการในชั้นนี้'}</span><span class="muted" id="lcount"></span></h4>
          <input class="inp" id="lfilter" type="text" placeholder="${isTest() ? 'ค้นหารหัส / ชนิดการทดสอบ' : 'ค้นหาเลข / หัวข้อ'}"></div>
        <div class="dlist" id="dlist"></div>
      </aside>
      <div class="ws-canvas" id="canvas"></div>
      <aside class="ws-right closed" id="right"></aside>
      <div class="dash-wrap" id="dash"></div>
    </div>
    <div class="ws-tools" id="tools"></div>
  </div>`);
  S.root.appendChild(el);
  $('#back').onclick = () => { location.hash = '#/'; };
  $('#btnImport').onclick = importFloors;
  $$('[data-mode]').forEach(b => b.onclick = () => setMode(b.dataset.mode));
  $('#btnTpl').onclick = async () => {
    if (isTest()) {
      testSettingsEditor(P(), async () => { await touch(P()); refreshAll(); });
      return;
    }
    const { templateEditor } = await import('./tpl-editor.js');
    templateEditor(P(), async () => {
      await touch(P());
      const nb = await loadBundle(P().id); S.defects = nb.defects; S.tests = nb.tests; ensureCodes(P(), S.tests); // option renames may have updated pins
      refreshAll();
    });
  };
  const openExport = async (fmt) => {
    if (fmt === 'dashboard' || (!fmt && S.mode === 'overview')) { if (S.mode !== 'overview') await setMode('overview'); exportDashboardPng(P()); return; }
    if (fmt === 'tests' || (!fmt && isTest())) { const { exportTestsDialog } = await import('./test-export.js'); exportTestsDialog(S.project.id); return; }
    const { exportDialog } = await import('./export.js');
    if (!fmt) fmt = (await db.getMeta('exportPrefs', {})).lastFormat || 'word';
    exportDialog(S.project.id, fmt);
  };
  $('#btnExport').onclick = () => openExport();
  $('#btnExportMenu').onclick = async (e) => {
    const anchor = e.currentTarget;
    const { EXPORT_FORMATS } = await import('./export.js');
    dropdown(anchor, [...EXPORT_FORMATS.map(f => ({
      html: `<span class="fmt-ic" style="background:${f.color}">${f.icon}</span><span class="fmt-txt">${esc(f.label)}<small>${esc(f.desc)}</small></span>`,
      fn: () => openExport(f.id),
    })), '-', {
      html: `<span class="fmt-ic" style="background:#0f766e">T</span><span class="fmt-txt">ผลทดสอบ (Word / CSV / Excel)<small>ตารางผลแยกตามชนิดการทดสอบ พร้อมเกณฑ์</small></span>`,
      fn: () => openExport('tests'),
    }, {
      html: `<span class="fmt-ic" style="background:#7c3aed">▦</span><span class="fmt-txt">ภาพ Dashboard (.png)<small>ภาพรวมโครงการ 1 หน้า สำหรับนำเสนอ</small></span>`,
      fn: () => openExport('dashboard'),
    }]);
  };
  sync.renderStatus();
  if ($('#btnAuth')) $('#btnAuth').onclick = () => {
    const rerender = async () => { renderShell(); await selectFloor(S.floorId); };
    if (canEdit()) { sync.logout(); S.selectedId = S.selectedId; S.tool = 'select'; rerender(); }
    else editLogin(rerender);
  };
  $('#btnMore').onclick = (e) => dropdown(e.currentTarget, [
    ...(canEdit() ? [
      { label: '✎ แก้ไขข้อมูลโครงการ', fn: () => projectDialog(P(), () => { renderTitle(); refreshAll(); }) },
      { label: '#  เรียงเลขลำดับใหม่ทั้งโครงการ (1…n)', fn: renumber },
      '-'] : []),
    { label: `👤 ชื่อผู้บันทึก: ${localStorage.getItem('dm_user') || '(ยังไม่ได้ตั้ง)'}`, fn: async () => { const n = await promptBox('ชื่อผู้บันทึก', localStorage.getItem('dm_user') || '', { label: 'ใช้แสดงในหน้าภาพรวมว่าใครบันทึกจุดไหน' }); if (n) { localStorage.setItem('dm_user', n); toast('บันทึกชื่อแล้ว', 'ok'); } } },
    { label: '⤓ ส่งออกแพ็กข้อมูล / สำรอง (.zip)', fn: async () => { const { exportPack } = await import('./export.js'); exportPack(P().id); } },
  ]);
  $('#lfilter').oninput = (e) => { S.filter = e.target.value; renderList(); };
  $('#lToggle').onclick = toggleLeft;
  renderTitle();
  renderTools();
  setupCanvas();
  document.removeEventListener('keydown', onKey);
  document.addEventListener('keydown', onKey);
}

async function setMode(m) {
  if (S.mode === m) return;
  S.mode = m; S.selectedId = null; S.draft = null; S.tool = 'select'; S.filter = '';
  try { localStorage.setItem('dm_mode_' + S.project.id, m); } catch { /* */ }
  cancelPending();
  renderShell();
  await selectFloor(S.floorId);
  if (m === 'overview') renderDash();
}

async function renderDash() {
  const box = $('#dash');
  if (!box || S.mode !== 'overview') return;
  const org = await db.getMeta('orgName', 'บริษัท เพอร์ฟอร์มแมกซ์ บิวดิ้ง เซอร์วิซ จำกัด');
  renderDashboard(box, {
    project: P(), floors: S.floors, defects: S.defects, tests: S.tests, editable: canEdit(), org,
    onGoto: async (mode, floorId, itemId) => {
      await setMode(mode);
      if (floorId && floorId !== S.floorId) await selectFloor(floorId);
      if (itemId) { select(itemId); const d = selected(); if (d) centerOn(d); }
    },
  });
}

async function whoAmI() {
  let n = localStorage.getItem('dm_user');
  if (!n) {
    n = await promptBox('ชื่อผู้บันทึก', '', { label: 'ชื่อนี้จะแสดงในหน้าภาพรวมว่าใครบันทึกจุดไหน (ถามครั้งเดียว เปลี่ยนได้ที่เมนู ⋯)' }) || 'ไม่ระบุ';
    try { localStorage.setItem('dm_user', n); } catch { /* */ }
  }
  return n;
}

function toggleLeft() {
  const l = $('#left');
  const c = l.classList.toggle('collapsed');
  try { localStorage.setItem('dm_left_collapsed', c ? '1' : '0'); } catch { /* */ }
}

function renderTitle() {
  const p = P();
  $('#pname').textContent = p.name;
  const nm = p.numbering === 'auto' ? 'รันเลขอัตโนมัติ' : 'กำหนดเลขเอง';
  $('#psub').textContent = [p.code, p.client, p.location, nm].filter(Boolean).join(' • ');
  S.root.firstElementChild.style.setProperty('--accent', p.accent);
}

function refreshAll() { renderTabs(); renderList(); renderPins(); renderRight(); if (S.mode === 'overview') renderDash(); }

async function renumber() {
  if (P().numbering === 'manual' && !(await confirmBox('เรียงเลขใหม่เป็น 1…n ตามลำดับชั้นและเลขเดิม? เลขที่กำหนดเองไว้จะถูกแทนที่'))) return;
  await renumberAll(P(), S.floors, S.defects);
  await touch(P());
  refreshAll();
  toast('เรียงเลขลำดับใหม่แล้ว', 'ok');
}

// ===================================================================== floors
function renderTabs() {
  const box = $('#ftabs');
  box.innerHTML = '';
  if (!S.floors.length) { box.appendChild(h('<span class="muted" style="font-size:13px;padding-left:4px">ยังไม่มีแปลน — กด “นำเข้าแปลนชั้น” เพื่อเริ่ม</span>')); return; }
  const i = Math.max(0, S.floors.findIndex(f => f.id === S.floorId));
  const f = S.floors[i];
  const n = curItems().filter(d => d.floorId === f.id).length;
  const el = h(`<div class="fnav">
    <button class="icon-btn fprev" title="ชั้นก่อนหน้า (Page Up)" ${i === 0 ? 'disabled' : ''}>◀</button>
    <button class="fpick" title="เลือกชั้น / แปลน"><span class="fname">${esc(f.name)}</span><span class="cnt">${n} จุด</span><span class="fpos">${i + 1}/${S.floors.length}</span><span class="caret">▾</span></button>
    <button class="icon-btn fnext" title="ชั้นถัดไป (Page Down)" ${i === S.floors.length - 1 ? 'disabled' : ''}>▶</button>
    ${canEdit() ? '<button class="btn sm ghost fmenu" title="จัดการชั้นนี้">⋮ จัดการชั้น</button>' : ''}
  </div>`);
  $('.fprev', el).onclick = () => stepFloor(-1);
  $('.fnext', el).onclick = () => stepFloor(1);
  $('.fpick', el).onclick = (e) => floorPicker(e.currentTarget);
  $('.fpick', el).ondblclick = () => { if (canEdit()) renameFloor(f); };
  if ($('.fmenu', el)) $('.fmenu', el).onclick = (e) => dropdown(e.currentTarget, [
    { label: '✎ เปลี่ยนชื่อชั้น', fn: () => renameFloor(f) },
    { label: '↔ ตั้งสเกลแปลน', fn: () => setTool('scale') },
    { label: '🖼 เปลี่ยนรูปแปลน (คงตำแหน่งเดิม)', fn: () => replaceFloorImage(f) },
    { label: '⧉ ทำสำเนาชั้น (ใช้แปลนเดียวกัน เช่น ชั้นทั่วไป)', fn: () => duplicateFloor(f) },
    { label: '⬆ ชั้นด้านบน / จัดตำแหน่งแปลนให้ตรงกัน', fn: () => alignDialog(f) },
    ...(i > 0 ? [{ label: '↑ ย้ายลำดับขึ้น', fn: () => moveFloor(f, -1) }] : []),
    ...(i < S.floors.length - 1 ? [{ label: '↓ ย้ายลำดับลง', fn: () => moveFloor(f, 1) }] : []),
    '-',
    { label: '🗑 ลบชั้นนี้', danger: true, fn: () => deleteFloor(f) },
  ]);
  box.appendChild(el);
}

function stepFloor(dir) {
  const i = S.floors.findIndex(f => f.id === S.floorId) + dir;
  if (i >= 0 && i < S.floors.length) selectFloor(S.floors[i].id);
}

function floorPicker(anchor) {
  $$('.dropdown').forEach(d => d.remove());
  const dd = h(`<div class="dropdown fpicker">
    ${S.floors.length > 6 ? '<input class="inp" type="text" placeholder="ค้นหาชั้น…" style="margin-bottom:6px">' : ''}
    <div class="flist"></div></div>`);
  const list = $('.flist', dd);
  const draw = (q = '') => {
    list.innerHTML = '';
    S.floors.forEach((f, i) => {
      if (q && !f.name.toLowerCase().includes(q.toLowerCase())) return;
      const n = curItems().filter(d => d.floorId === f.id).length;
      const b = h(`<button class="${f.id === S.floorId ? 'on' : ''}"><span class="fi">${i + 1}</span><span class="fn">${esc(f.name)}</span><span class="cnt">${n}</span></button>`);
      b.onclick = () => { dd.remove(); if (f.id !== S.floorId) selectFloor(f.id); };
      list.appendChild(b);
    });
    if (!list.children.length) list.appendChild(h('<div class="muted" style="padding:8px;font-size:13px">ไม่พบชั้นที่ค้นหา</div>'));
  };
  draw();
  document.body.appendChild(dd);
  const r = anchor.getBoundingClientRect();
  dd.style.left = Math.max(8, Math.min(window.innerWidth - dd.offsetWidth - 8, r.left)) + 'px';
  dd.style.top = (r.bottom + 4) + 'px';
  const inp = $('input', dd);
  if (inp) { inp.oninput = () => draw(inp.value); inp.onkeydown = (e) => { if (e.key === 'Enter') $('.flist button', dd)?.click(); if (e.key === 'Escape') dd.remove(); }; setTimeout(() => inp.focus(), 20); }
  $('.flist button.on', dd)?.scrollIntoView({ block: 'nearest' });
  setTimeout(() => {
    const off = (e) => { if (!dd.contains(e.target)) { dd.remove(); document.removeEventListener('mousedown', off); } };
    document.addEventListener('mousedown', off);
  });
}

async function selectFloor(id, first = false) {
  S.floorId = id;
  S.draft = null;
  const f = curFloor();
  if (S.selectedId && selected()?.floorId !== id) S.selectedId = null;
  S.img = null;
  if (f) {
    S.imgUrl = await blobUrl(f.blobId);
    S.img = { w: f.w, h: f.h };
  }
  renderTabs();
  renderList();
  renderCanvasBase();
  fitView();
  renderRight();
  if (first && !S.floors.length) setTool('select');
}

async function renameFloor(f) {
  const n = await promptBox('เปลี่ยนชื่อชั้น / แปลน', f.name, { label: 'ชื่อ' });
  if (!n) return;
  f.name = n; await db.put('floors', f); await touch(P()); renderTabs();
}

async function moveFloor(f, dir) {
  const i = S.floors.indexOf(f), j = i + dir;
  if (j < 0 || j >= S.floors.length) return;
  [S.floors[i], S.floors[j]] = [S.floors[j], S.floors[i]];
  P().floorOrder = S.floors.map(x => x.id);
  await touch(P()); renderTabs();
}

async function deleteFloor(f) {
  const n = S.defects.filter(d => d.floorId === f.id).length, nt = S.tests.filter(d => d.floorId === f.id).length;
  if (!(await confirmBox(`ลบ “${f.name}” ${n ? `พร้อมจุดความเสียหาย ${n} จุด` : ''}${nt ? ` และจุดทดสอบ ${nt} จุด` : ''}? การลบไม่สามารถย้อนกลับได้`, { ok: 'ลบชั้น', danger: true }))) return;
  for (const d of [...S.defects, ...S.tests].filter(d => d.floorId === f.id)) {
    for (const ph of d.photoIds || []) { forgetUrl(ph); await db.delBlob(ph); }
    await db.del('defects', d.id);
  }
  S.defects = S.defects.filter(d => d.floorId !== f.id);
  S.tests = S.tests.filter(d => d.floorId !== f.id);
  await delDisplayIfUnused(f); await delSourceIfUnused(f); await db.del('floors', f.id);
  S.floors = S.floors.filter(x => x.id !== f.id);
  P().floorOrder = S.floors.map(x => x.id);
  await touch(P());
  await selectFloor(S.floors[0]?.id || null);
}

// Plan files can be shared: one PDF by several pages, and duplicated floors share the same picture.
// A file is removed only when no other floor still uses it.
const blobInUse = (id, exceptFloorId) => S.floors.some(x => x.id !== exceptFloorId && (x.blobId === id || x.srcBlobId === id));
async function delSourceIfUnused(f) {
  if (f.srcBlobId && !blobInUse(f.srcBlobId, f.id)) await db.delBlob(f.srcBlobId);
}
async function delDisplayIfUnused(f) {
  if (f.blobId && !blobInUse(f.blobId, f.id)) { forgetUrl(f.blobId); await db.delBlob(f.blobId); }
}

async function duplicateFloor(f) {
  const name = await promptBox('ทำสำเนาชั้น (ใช้แปลนเดียวกัน)', `${f.name} (สำเนา)`, { label: 'ชื่อชั้นใหม่ เช่น ชั้น 5' });
  if (!name) return;
  const nf = { ...f, id: uid(), name, createdAt: Date.now() }; // same picture/PDF and scale, no points copied
  delete nf.upId; delete nf.upAlign; // a new level has its own floor above
  await db.put('floors', nf);
  const i = S.floors.indexOf(f);
  S.floors.splice(i + 1, 0, nf);
  P().floorOrder = S.floors.map(x => x.id);
  await touch(P());
  await selectFloor(nf.id);
  toast(`สร้าง “${name}” แล้ว — ใช้แปลนเดียวกับ “${f.name}” (ไม่เปลืองพื้นที่เพิ่ม)`, 'ok', 3500);
}

// ---------------------------------------------------------------- floor above + plan alignment
// small pan/zoom plan viewer used to pick reference points
function miniPlan(host, url, floor, onPick) {
  host.innerHTML = `<div class="al-view"><div class="al-stage" style="width:${floor.w}px;height:${floor.h}px"><img src="${url}" draggable="false" alt="">
    <svg viewBox="0 0 ${floor.w} ${floor.h}" width="${floor.w}" height="${floor.h}"></svg></div>
    <div class="al-zoom"><button type="button" data-z="in" title="ซูมเข้า">＋</button><button type="button" data-z="out" title="ซูมออก">－</button><button type="button" data-z="fit" title="พอดีกรอบ">⤢</button></div></div>`;
  const view = $('.al-view', host), stage = $('.al-stage', host), svg = $('svg', host);
  const v = { s: 1, tx: 0, ty: 0 };
  let marks = [];
  const apply = () => { stage.style.transform = `translate(${v.tx}px,${v.ty}px) scale(${v.s})`; draw(); };
  const fit = () => { const W = view.clientWidth, H = view.clientHeight; v.s = Math.min(W / floor.w, H / floor.h) * 0.96; v.tx = (W - floor.w * v.s) / 2; v.ty = (H - floor.h * v.s) / 2; apply(); };
  const zoomAt = (f, cx, cy) => { const ns = Math.max(0.02, Math.min(8, v.s * f)); v.tx = cx - (cx - v.tx) * ns / v.s; v.ty = cy - (cy - v.ty) * ns / v.s; v.s = ns; apply(); };
  const draw = () => {
    const k = 1 / v.s;
    svg.innerHTML = marks.map(m => { const [x, y] = m.pt, r = 11 * k;
      return `<g><circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="#fff" stroke-width="${5 * k}"/><circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="${m.color}" stroke-width="${2.5 * k}"/>
        <path d="M${x - 18 * k} ${y}H${x - 4 * k}M${x + 4 * k} ${y}H${x + 18 * k}M${x} ${y - 18 * k}V${y - 4 * k}M${x} ${y + 4 * k}V${y + 18 * k}" stroke="${m.color}" stroke-width="${2 * k}"/>
        <text x="${x + 14 * k}" y="${y - 14 * k}" font-size="${14 * k}" font-weight="700" fill="${m.color}" stroke="#fff" stroke-width="${3 * k}" paint-order="stroke" font-family="Sarabun, sans-serif">${esc(m.label)}</text></g>`; }).join('');
  };
  $$('[data-z]', host).forEach(b => b.onclick = (e) => { e.stopPropagation(); const W = view.clientWidth / 2, H = view.clientHeight / 2; b.dataset.z === 'fit' ? fit() : zoomAt(b.dataset.z === 'in' ? 1.5 : 1 / 1.5, W, H); });
  view.addEventListener('wheel', (e) => { e.preventDefault(); const r = view.getBoundingClientRect(); zoomAt(e.deltaY < 0 ? 1.2 : 1 / 1.2, e.clientX - r.left, e.clientY - r.top); }, { passive: false });
  const ptrs = new Map(); let moved = false, last = null, pinch = null;
  view.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.al-zoom')) return;
    view.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    if (ptrs.size === 1) { moved = false; last = [e.clientX, e.clientY]; }
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]) }; moved = true; }
  });
  view.addEventListener('pointermove', (e) => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    const r = view.getBoundingClientRect();
    if (ptrs.size === 2 && pinch) {
      const [a, b] = [...ptrs.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      zoomAt(d / pinch.d, (a[0] + b[0]) / 2 - r.left, (a[1] + b[1]) / 2 - r.top); pinch.d = d; return;
    }
    const dx = e.clientX - last[0], dy = e.clientY - last[1];
    if (!moved && Math.hypot(dx, dy) < 5) return;
    moved = true; v.tx += dx; v.ty += dy; last = [e.clientX, e.clientY]; apply();
  });
  const up = (e) => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.delete(e.pointerId);
    if (ptrs.size < 2) pinch = null;
    if (!ptrs.size && !moved) {
      const r = view.getBoundingClientRect();
      const x = (e.clientX - r.left - v.tx) / v.s, y = (e.clientY - r.top - v.ty) / v.s;
      if (x >= 0 && y >= 0 && x <= floor.w && y <= floor.h) onPick([x, y]);
    }
    if (ptrs.size === 1) { last = [...ptrs.values()][0]; }
  };
  view.addEventListener('pointerup', up); view.addEventListener('pointercancel', up);
  requestAnimationFrame(fit);
  return { setMarks: (m) => { marks = m; draw(); }, fit };
}

async function alignDialog(f) {
  const natural = (() => { const i = S.floors.indexOf(f); return S.floors[i + 1] || null; })();
  let upId = upperFloor(S.floors, f)?.id || '';
  const al = f.upAlign && f.upAlign.pairs?.length === 2 ? f.upAlign : null;
  let pairs = al && al.floorId === upId ? JSON.parse(JSON.stringify(al.pairs)) : [[null, null], [null, null]];
  let active = 0; // 0,1 = reference point being placed, 2 = test
  let testPt = null;
  const others = S.floors.filter(x => x.id !== f.id);
  const body = h(`<div>
    <p class="hint" style="margin:0 0 10px">ตำแหน่ง “เหนือศีรษะ” ที่ปักในชั้นนี้ คือท้องพื้น/ท้องคานของชั้นด้านบน ถ้าตั้งค่าโครงการให้แสดงเป็นของชั้นโครงสร้าง โปรแกรมจะย้ายจุดไปแสดงบนแปลนชั้นด้านบน
      จึงต้องรู้ว่าตำแหน่งบนสองแปลนตรงกันอย่างไร</p>
    <div class="row" style="align-items:flex-end;flex-wrap:wrap;gap:10px">
      <label class="fld" style="min-width:220px"><span>ชั้นด้านบนของ “${esc(f.name)}”</span><select class="inp" id="alUp">
        ${others.length ? others.map(x => `<option value="${x.id}" ${x.id === upId ? 'selected' : ''}>${esc(x.name)}${x === natural ? ' (ชั้นถัดไปในรายการ)' : ''}</option>`).join('') : '<option value="">— ยังไม่มีชั้นอื่น —</option>'}</select></label>
      <div class="fld"><span>จุดอ้างอิง (เลือกจุดเดียวกันบนทั้งสองแปลน เช่น จุดตัดกริดมุมอาคาร ให้อยู่ห่างกัน)</span>
        <div class="seg" id="alStep"><button data-s="0">จุดที่ 1</button><button data-s="1">จุดที่ 2</button><button data-s="2">ทดสอบ</button></div></div>
      <button class="btn sm ghost" id="alClear" type="button">ล้างจุดอ้างอิง</button>
    </div>
    <div class="al-grid"><div><div class="al-cap">แปลน${esc(f.name.replace(/^แปลน\s*/, ''))} (ชั้นที่พบ)</div><div id="alL"></div></div>
      <div><div class="al-cap" id="alUpCap"></div><div id="alR"></div></div></div>
    <p class="hint" id="alMsg" style="margin:8px 0 0"></p>
  </div>`);
  const m = modal({ title: 'ชั้นด้านบน / จัดตำแหน่งแปลนให้ตรงกัน', body, wide: true, actions: [
    { label: 'ยกเลิก', value: null },
    { label: 'บันทึก', kind: 'primary', onClick: async () => {
      const done = pairs.every(p => p[0] && p[1]);
      const any = pairs.some(p => p[0] || p[1]);
      if (any && !done) { toast('จุดอ้างอิงยังไม่ครบ 2 คู่ — เลือกให้ครบ หรือกด “ล้างจุดอ้างอิง”', 'error'); return false; }
      if (done && !similarity(pairs)) { toast('จุดอ้างอิงทั้งสองอยู่ตำแหน่งเดียวกัน — เลือกจุดที่ห่างกัน', 'error'); return false; }
      if (upId && upId !== natural?.id) f.upId = upId; else delete f.upId;
      if (done && upId) f.upAlign = { floorId: upId, pairs }; else delete f.upAlign;
      await db.put('floors', f); await touch(P());
      toast(done ? 'บันทึกชั้นด้านบนและจุดอ้างอิงแล้ว' : 'บันทึกชั้นด้านบนแล้ว (ไม่มีจุดอ้างอิง — ถือว่าสองแปลนใช้กรอบแบบเดียวกัน)', 'ok', 3500);
      renderRight(true);
    } },
  ] });
  let L = null, R = null;
  const COLORS = ['#e11d48', '#2563eb'];
  const mapPt = (pt) => { const T = similarity(pairs); return T ? [T.a * pt[0] - T.b * pt[1] + T.tx, T.b * pt[0] + T.a * pt[1] + T.ty] : null; };
  const refresh = () => {
    $$('#alStep [data-s]', body).forEach(b => { b.classList.toggle('on', +b.dataset.s === active); b.disabled = b.dataset.s === '2' && !pairs.every(p => p[0] && p[1]); });
    const mk = (side) => pairs.flatMap((p, i) => p[side] ? [{ pt: p[side], label: String(i + 1), color: COLORS[i] }] : []);
    const lm = mk(0), rm = mk(1);
    if (active === 2 && testPt) { lm.push({ pt: testPt, label: 'ทดสอบ', color: '#0f766e' }); const q = mapPt(testPt); if (q) rm.push({ pt: q, label: 'ทดสอบ', color: '#0f766e' }); }
    L?.setMarks(lm); R?.setMarks(rm);
    const T = pairs.every(p => p[0] && p[1]) ? similarity(pairs) : null;
    $('#alMsg', body).innerHTML = active === 2 ? 'คลิกตำแหน่งใดก็ได้บนแปลนซ้าย แล้วดูว่าจุด “ทดสอบ” บนแปลนขวาตรงตำแหน่งเดียวกันหรือไม่'
      : T ? `จับคู่ครบแล้ว — มาตราส่วนชั้นบน/ชั้นนี้ ${T.scale.toFixed(3)} เท่า, หมุน ${T.rot.toFixed(1)}° • กด “ทดสอบ” เพื่อตรวจ หรือ “บันทึก”`
      : `คลิกจุดที่ ${active + 1} บนแปลน${pairs[active][0] ? 'ขวา (ชั้นด้านบน)' : 'ซ้าย (ชั้นนี้)'} • เลื่อนแปลนด้วยการลาก ซูมด้วยล้อเมาส์/สองนิ้ว • ถ้าไม่ใส่จุดอ้างอิง โปรแกรมถือว่าสองแปลนใช้กรอบแบบเดียวกัน`;
  };
  const pick = (side) => (pt) => {
    if (!canEdit()) return;
    if (active === 2) { if (side === 0) { testPt = pt; refresh(); } return; }
    pairs[active][side] = pt;
    if (pairs[active][0] && pairs[active][1] && active === 0 && !(pairs[1][0] && pairs[1][1])) active = 1;
    refresh();
  };
  const loadUp = async () => {
    const uf = S.floors.find(x => x.id === upId);
    $('#alUpCap', body).textContent = uf ? `${uf.name} (ชั้นด้านบน)` : '';
    if (uf) R = miniPlan($('#alR', body), await blobUrl(uf.blobId), uf, pick(1)); else { $('#alR', body).innerHTML = '<p class="muted">ยังไม่มีชั้นด้านบน</p>'; R = null; }
    refresh();
  };
  L = miniPlan($('#alL', body), await blobUrl(f.blobId), f, pick(0));
  $('#alUp', body).onchange = (e) => { upId = e.target.value; pairs = (al && al.floorId === upId) ? JSON.parse(JSON.stringify(al.pairs)) : [[null, null], [null, null]]; active = 0; testPt = null; loadUp(); };
  $$('#alStep [data-s]', body).forEach(b => b.onclick = () => { active = +b.dataset.s; refresh(); });
  $('#alClear', body).onclick = () => { pairs = [[null, null], [null, null]]; active = 0; testPt = null; refresh(); };
  await loadUp();
  return m;
}

async function fileToPlanImages(file, onProgress, onlyPage = null) {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  const base = file.name.replace(/\.[^.]+$/, '');
  if (!isPdf) {
    // keep the original file for sharp exports; the working copy is resized for the screen
    const r = await compressImage(file, 4500, 0.92);
    const keepSrc = r.blob !== file;
    return [{ name: base, ...r, src: keepSrc ? { blob: file, type: 'image', key: file } : null }];
  }
  const pdfjs = await import('../vendor/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.min.mjs', import.meta.url).href;
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const out = [];
  for (let i = 1; i <= doc.numPages; i++) {
    if (onlyPage && i !== onlyPage) continue;
    onProgress && onProgress(`กำลังแปลง PDF หน้า ${i}/${doc.numPages}`);
    const page = await doc.getPage(i);
    const v1 = page.getViewport({ scale: 1 });
    const scale = Math.min(6, 4500 / Math.max(v1.width, v1.height));
    const vp = page.getViewport({ scale });
    const c = document.createElement('canvas');
    c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9));
    out.push({ name: doc.numPages > 1 ? `${base} - หน้า ${i}` : base, blob, w: c.width, h: c.height, src: { blob: file, type: 'pdf', page: i, key: file } });
    c.width = c.height = 0;
  }
  return out;
}

async function importFloors() {
  const files = await pickFiles({ accept: 'image/*,.pdf,application/pdf', multiple: true });
  if (!files.length) return;
  const m = modal({ title: 'กำลังนำเข้าแปลน', body: '<p id="impMsg">กำลังเตรียมไฟล์…</p><div class="progress"><div id="impBar"></div></div>', dismissable: false });
  let firstNew = null, done = 0;
  try {
    for (const file of files) {
      const imgs = await fileToPlanImages(file, (t) => { $('#impMsg', m.body).textContent = t; });
      let srcId = null;
      for (const im of imgs) {
        if (im.src && !srcId) srcId = await db.putBlob(im.src.blob instanceof File ? new Blob([im.src.blob], { type: im.src.blob.type || (im.src.type === 'pdf' ? 'application/pdf' : 'image/png') }) : im.src.blob);
        const f = { id: uid(), projectId: P().id, name: im.name, blobId: await db.putBlob(im.blob), w: im.w, h: im.h, scale: null, createdAt: Date.now(),
          ...(im.src ? { srcBlobId: srcId, srcType: im.src.type, pdfPage: im.src.page || null } : {}) };
        await db.put('floors', f);
        S.floors.push(f);
        firstNew = firstNew || f.id;
      }
      done++;
      $('#impBar', m.body).style.width = (done / files.length * 100) + '%';
    }
    P().floorOrder = S.floors.map(x => x.id);
    await touch(P());
    m.close();
    toast(`นำเข้าแปลนแล้ว ${S.floors.length} ชั้น — เปลี่ยนชื่อชั้นได้ที่ “⋮ จัดการชั้น”`, 'ok', 4000);
    await selectFloor(firstNew);
  } catch (e) {
    console.error(e); m.close(); toast('นำเข้าแปลนไม่สำเร็จ: ' + e.message, 'error', 5000);
    renderTabs();
  }
}

async function replaceFloorImage(f) {
  const [file] = await pickFiles({ accept: 'image/*,.pdf,application/pdf' });
  if (!file) return;
  let pageNo = 1;
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
    const pdfjs = await import('../vendor/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.min.mjs', import.meta.url).href;
    const n = (await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise).numPages;
    if (n > 1) {
      const v = await promptBox('เลือกหน้าของ PDF', String(f.pdfPage && f.pdfPage <= n ? f.pdfPage : 1), { label: `ไฟล์นี้มี ${n} หน้า — ใช้หน้าที่เท่าไรเป็นแปลนของ “${f.name}”` });
      if (!v) return;
      pageNo = Math.min(n, Math.max(1, parseInt(v, 10) || 1));
    }
  }
  const im = (await fileToPlanImages(file, null, pageNo))[0];
  if (!im) return;
  const sx = im.w / f.w, sy = im.h / f.h;
  for (const d of [...S.defects, ...S.tests].filter(d => d.floorId === f.id)) {
    d.pts = d.pts.map(([x, y]) => [x * sx, y * sy]);
    await db.put('defects', d);
  }
  if (f.scale) f.scale = f.scale / sx;
  await delDisplayIfUnused(f);
  await delSourceIfUnused(f);
  f.blobId = await db.putBlob(im.blob); f.w = im.w; f.h = im.h;
  if (im.src) { f.srcBlobId = await db.putBlob(new Blob([im.src.blob], { type: im.src.blob.type || (im.src.type === 'pdf' ? 'application/pdf' : 'image/png') })); f.srcType = im.src.type; f.pdfPage = im.src.page || null; }
  else { delete f.srcBlobId; delete f.srcType; delete f.pdfPage; }
  await db.put('floors', f); await touch(P());
  await selectFloor(f.id);
  toast('เปลี่ยนรูปแปลนแล้ว (ปรับตำแหน่งจุดตามสัดส่วน)', 'ok');
}

// ===================================================================== list
function renderList() {
  if (isTest()) return renderTestList();
  const box = $('#dlist');
  const all = floorDefects();
  $('#lcount').textContent = `${all.length} จุด`;
  const q = S.filter.trim().toLowerCase();
  const list = all.filter(d => !q || `${d.no} ${defectTitle(P(), d)}`.toLowerCase().includes(q))
    .sort((a, b) => naturalCmp(a.no, b.no));
  box.innerHTML = '';
  for (const d of list) {
    const tpl = tplOf(d);
    const col = defectColor(P(), d);
    const elf = fieldByRole(tpl, 'element'), sf = fieldByRole(tpl, 'severity');
    const meta = [isOverhead(d) ? '⬆ เหนือศีรษะ' : '', elf && d.data?.[elf.key], sf && d.data?.[sf.key], d.photoIds?.length ? `📷 ${d.photoIds.length}` : ''].filter(Boolean).join(' • ');
    const it = h(`<div class="ditem ${d.id === S.selectedId ? 'on' : ''}">
      <span class="badge ${d.shape !== 'point' ? 'area' : ''}" style="background:${col};color:${textOn(col)}">${esc(d.no)}</span>
      <div class="txt"><div class="t1">${esc(defectTitle(P(), d))}</div><div class="t2">${esc(meta || TYPE_LABELS[d.type])}</div></div></div>`);
    it.onclick = () => { select(d.id); centerOn(d); };
    box.appendChild(it);
  }
  if (!all.length) box.appendChild(h(`<div class="muted" style="font-size:13px;padding:10px">${S.floors.length ? 'ยังไม่มีจุดในชั้นนี้ เลือกเครื่องมือ “ปักจุด” หรือ “พื้นที่” ด้านล่าง' : ''}</div>`));
  const on = $('.ditem.on', box);
  if (on) on.scrollIntoView({ block: 'nearest' });
}

function renderTestList() {
  const box = $('#dlist');
  const all = floorDefects();
  $('#lcount').textContent = `${all.length} จุด`;
  const q = S.filter.trim().toLowerCase();
  const list = all.filter(d => !q || `${stationLabel(d)} ${Object.keys(d.tests || {}).map(id => typeDef(P(), id)?.short).join(' ')} ${d.element || ''} ${d.place || ''}`.toLowerCase().includes(q))
    .sort((a, b) => naturalCmp(a.code, b.code));
  box.innerHTML = '';
  for (const d of list) {
    const lv = stationLevel(P(), d);
    const meta = [isOverhead(d) ? '⬆ เหนือศีรษะ' : '', d.element, d.place, d.role === 'baseline' ? 'จุดอ้างอิง' : d.role === 'targeted' ? 'จุดเจาะจง' : ''].filter(Boolean).join(' • ');
    const it = h(`<div class="ditem ${d.id === S.selectedId ? 'on' : ''}">
      <span class="badge tbadge" style="background:${levelColor(lv)};color:${lv === 'none' ? 'var(--ink)' : '#fff'}">◆</span>
      <div class="txt"><div class="t1">${esc(stationLabel(d))}${meta ? ` <span class="t2" style="font-weight:400">${esc(meta)}</span>` : ''}</div><div class="tchips">${stationChips(P(), d)}</div></div></div>`);
    it.onclick = () => { select(d.id); centerOn(d); };
    box.appendChild(it);
  }
  if (!all.length) box.appendChild(h(`<div class="muted" style="font-size:13px;padding:10px">${S.floors.length ? 'ยังไม่มีจุดทดสอบในชั้นนี้ เลือกเครื่องมือ “ปักจุดทดสอบ” ด้านล่าง' : ''}</div>`));
  const on = $('.ditem.on', box);
  if (on) on.scrollIntoView({ block: 'nearest' });
}

// ===================================================================== tools
function renderTools() {
  const bar = $('#tools');
  const tool = (id, label, key) => `<button class="tool ${S.tool === id ? 'on' : ''}" data-tool="${id}" title="${esc(TOOL_HINT[id])}">${ICON[id]}<span>${label}</span><kbd>${key}</kbd></button>`;
  if (!canEdit()) {
    bar.innerHTML = `${tool('select', 'เลื่อน/ดู', 'V')}
      <button class="tool ${S.showLabels ? 'on' : ''}" id="tLabels" title="แสดง/ซ่อนเลขบนแปลน">${ICON.label}<span>แสดงเลข</span><kbd>L</kbd></button>
      <span class="tsep"></span>
      <button class="icon-btn" id="zOut" title="ซูมออก (−)">－</button><span class="zoom-val" id="zVal">100%</span><button class="icon-btn" id="zIn" title="ซูมเข้า (+)">＋</button>
      <button class="btn sm ghost" id="zFit" title="พอดีหน้าจอ (F)">พอดีจอ</button>
      <span class="hint" style="margin-left:10px">โหมดดูอย่างเดียว — กด “🔒 เข้าโหมดแก้ไข” ด้านบนเพื่อแก้ไข</span>`;
    $('[data-tool]', bar).onclick = () => setTool('select');
    $('#tLabels').onclick = () => { S.showLabels = !S.showLabels; renderTools(); renderPins(); };
    $('#zIn').onclick = () => zoomAt(1.25); $('#zOut').onclick = () => zoomAt(0.8); $('#zFit').onclick = fitView;
    updateZoomLabel();
    return;
  }
  const common = `
    <button class="tool ${S.overhead ? 'on' : ''}" id="tOver" title="เมื่อเปิด จุดใหม่จะเป็นตำแหน่งเหนือศีรษะ (ท้องพื้น/ท้องคานของชั้นถัดไป) — ใช้กับความเสียหายโครงสร้างและจุดทดสอบ">${ICON.up}<span>เหนือศีรษะ</span><kbd>U</kbd></button>
    <button class="tool ${S.confirm ? 'on' : ''}" id="tConfirm" title="ให้กดยืนยันก่อนปักทุกครั้ง (กันกดผิด)">${ICON.check}<span>ยืนยันก่อนปัก</span><kbd>K</kbd></button>
    <button class="tool ${S.showOther ? 'on' : ''}" id="tOther" title="แสดงจุดของอีกชั้นข้อมูลแบบจาง ๆ">${ICON.layers}<span>${isTest() ? 'แสดงความเสียหาย' : 'แสดงจุดทดสอบ'}</span><kbd>O</kbd></button>`;
  if (isTest()) {
    const set = (settingsOf(P()).lastSet || []).map(id => typeDef(P(), id)?.short).filter(Boolean);
    bar.innerHTML = `
      ${tool('select', 'เลือก/เลื่อน', 'V')}
      <span class="tsep"></span>
      ${tool('point', 'ปักจุดทดสอบ', 'P')}
      <button class="tool tset-btn" id="tSet" title="เลือกชนิดการทดสอบของจุดที่จะปัก">${ICON.flask}<span class="tset-lbl">${esc(set.join(' + ') || 'เลือกชนิด')} ▾</span><kbd>T</kbd></button>
      <span class="tsep"></span>${common}
      ${tool('scale', 'ตั้งสเกล', 'S')}
      <button class="tool ${S.showLabels ? 'on' : ''}" id="tLabels" title="แสดง/ซ่อนรหัสบนแปลน">${ICON.label}<span>แสดงรหัส</span><kbd>L</kbd></button>
      <span class="tsep"></span>
      <button class="icon-btn" id="zOut" title="ซูมออก (−)">－</button><span class="zoom-val" id="zVal">100%</span><button class="icon-btn" id="zIn" title="ซูมเข้า (+)">＋</button>
      <button class="btn sm ghost" id="zFit" title="พอดีหน้าจอ (F)">พอดีจอ</button>`;
    $('#tSet').onclick = (e) => pickTypeSet(e.currentTarget, P(), () => { if (S.tool !== 'point') setTool('point'); else { renderTools(); updateHint(); } touch(P()); });
  } else bar.innerHTML = `
    ${tool('select', 'เลือก/เลื่อน', 'V')}
    <span class="tsep"></span>
    ${tool('point', 'ปักจุด', 'P')}
    ${tool('area', 'พื้นที่', 'A')}
    ${tool('rect', 'สี่เหลี่ยม', 'R')}
    <span class="tsep"></span>
    ${common}
    <button class="tool ${S.copyPrev ? 'on' : ''}" id="tCopy" title="เมื่อเปิด จุดใหม่จะคัดลอกรายละเอียด (ไม่รวมรูป) จากจุดล่าสุด">${ICON.copy}<span>ใช้รายละเอียดเดิม</span><kbd>C</kbd></button>
    ${tool('scale', 'ตั้งสเกล', 'S')}
    <button class="tool ${S.showLabels ? 'on' : ''}" id="tLabels" title="แสดง/ซ่อนเลขบนแปลน">${ICON.label}<span>แสดงเลข</span><kbd>L</kbd></button>
    <span class="tsep"></span>
    <button class="icon-btn" id="zOut" title="ซูมออก (−)">－</button>
    <span class="zoom-val" id="zVal">100%</span>
    <button class="icon-btn" id="zIn" title="ซูมเข้า (+)">＋</button>
    <button class="btn sm ghost" id="zFit" title="พอดีหน้าจอ (F)">พอดีจอ</button>`;
  $$('[data-tool]', bar).forEach(b => b.onclick = () => setTool(b.dataset.tool));
  if ($('#tCopy')) $('#tCopy').onclick = () => { S.copyPrev = !S.copyPrev; renderTools(); };
  $('#tConfirm').onclick = toggleConfirm;
  $('#tOver').onclick = toggleOverhead;
  $('#tOther').onclick = toggleOther;
  $('#tLabels').onclick = () => { S.showLabels = !S.showLabels; renderTools(); renderPins(); };
  $('#zIn').onclick = () => zoomAt(1.25);
  $('#zOut').onclick = () => zoomAt(0.8);
  $('#zFit').onclick = fitView;
  updateZoomLabel();
}

function toggleConfirm() { S.confirm = !S.confirm; try { localStorage.setItem('dm_confirm', S.confirm ? '1' : '0'); } catch { /* */ } renderTools(); toast(S.confirm ? 'เปิด: ต้องกดยืนยันก่อนปักทุกครั้ง' : 'ปิด: ปักทันทีเมื่อคลิก'); }
function toggleOverhead() {
  S.overhead = !S.overhead;
  try { localStorage.setItem('dm_over', S.overhead ? '1' : '0'); } catch { /* */ }
  renderTools(); updateHint();
  if (!S.overhead) { toast('ปิด: จุดใหม่อยู่ในพื้นที่ชั้นนี้'); return; }
  const up = upperFloor(S.floors, S.floors.find(f => f.id === S.floorId));
  toast(up ? `เปิด: จุดใหม่เป็นตำแหน่งเหนือศีรษะ (${joinName('โครงสร้าง', up.name)})${isTest() ? '' : ' • ใช้กับความเสียหายแบบตรวจสอบโครงสร้าง'}`
    : 'เปิด: จุดใหม่เป็นตำแหน่งเหนือศีรษะ — แต่ชั้นนี้ยังไม่มีชั้นด้านบนในโครงการ', up ? 'ok' : 'error', 4000);
}
function toggleOther() { S.showOther = !S.showOther; try { localStorage.setItem('dm_show_other', S.showOther ? '1' : '0'); } catch { /* */ } renderTools(); renderPins(); }

function setTool(t) {
  if (!canEdit()) t = 'select';
  if (isTest() && (t === 'area' || t === 'rect')) t = 'point';
  cancelPending();
  S.tool = t;
  S.draft = null;
  renderTools();
  const c = $('#canvas');
  c.className = 'ws-canvas tool-' + t;
  renderPins();
  updateHint();
}

function updateHint() {
  const hint = $('#cHint');
  if (!hint) return;
  if (!S.img || S.tool === 'select') { hint.style.display = 'none'; return; }
  let t = TOOL_HINT[S.tool];
  if (isTest() && S.tool === 'point') {
    const ids = settingsOf(P()).lastSet || [];
    const nx = []; ids.forEach(id => nx.push(nextCode(P(), S.tests, typePrefix(P(), id), nx)));
    t = `คลิกบนแปลนเพื่อปักจุดทดสอบ (${ids.map(id => typeDef(P(), id)?.short).filter(Boolean).join(' + ')})  •  รหัสถัดไป: ${nx.join(' / ')}`;
  } else if (['point', 'area', 'rect'].includes(S.tool)) t += `  •  เลขถัดไป: ${suggestNo(P(), S.defects)}`;
  if (S.confirm && ['point', 'area', 'rect'].includes(S.tool)) t += '  •  ต้องกดยืนยันก่อนปัก';
  if (S.overhead && ['point', 'area', 'rect'].includes(S.tool)) t += '  •  ⬆ จุดใหม่เป็นตำแหน่งเหนือศีรษะ';
  hint.textContent = t;
  hint.style.display = '';
}

// ===================================================================== canvas
const SVGNS = 'http://www.w3.org/2000/svg';
function setupCanvas() {
  const c = $('#canvas');
  c.className = 'ws-canvas tool-' + S.tool;
  c.innerHTML = `<svg id="svg"><g id="world"><image id="plan" preserveAspectRatio="none"></image><g id="pins"></g><g id="draft"></g></g></svg>
    <div class="canvas-hint" id="cHint" style="display:none"></div><div class="scale-tag" id="scaleTag" style="display:none"></div>
    <div class="canvas-empty" id="cEmpty" style="display:none"><div class="box"><h3>เริ่มจากนำเข้าแปลนพื้น</h3>
      <p class="muted">รองรับไฟล์รูป (JPG, PNG) และ PDF หลายหน้า — แต่ละหน้า/ไฟล์จะกลายเป็น 1 ชั้น</p>
      <button class="btn primary" id="emptyImport">＋ นำเข้าแปลนชั้น</button></div></div>`;
  $('#emptyImport').onclick = importFloors;
  const svg = $('#svg');
  svg.addEventListener('pointerdown', onDown);
  svg.addEventListener('pointermove', onMove);
  svg.addEventListener('pointerup', onUp);
  svg.addEventListener('pointercancel', onUp);
  svg.addEventListener('dblclick', onDbl);
  svg.addEventListener('wheel', onWheel, { passive: false });
  svg.addEventListener('contextmenu', (e) => e.preventDefault());
  let last = null;
  new ResizeObserver(() => {
    if (!S || !document.body.contains(c)) return;
    const W = c.clientWidth, H = c.clientHeight;
    if (last && W > 0 && H > 0) { S.view.tx += (W - last.W) / 2; S.view.ty += (H - last.H) / 2; applyView(); }
    if (W > 0 && H > 0) last = { W, H };
  }).observe(c);
}

function renderCanvasBase() {
  const f = curFloor();
  $('#cEmpty').style.display = f ? 'none' : '';
  const img = $('#plan');
  if (f) {
    img.setAttribute('href', S.imgUrl);
    img.setAttribute('width', f.w); img.setAttribute('height', f.h);
    img.style.display = '';
  } else img.style.display = 'none';
  const tag = $('#scaleTag');
  if (f && f.scale) { tag.style.display = ''; tag.textContent = `สเกล: 1 ม. ≈ ${(1 / f.scale).toFixed(1)} px`; }
  else tag.style.display = 'none';
  renderPins();
  updateHint();
}

function applyView() {
  const { tx, ty, s } = S.view;
  $('#world').setAttribute('transform', `translate(${tx},${ty}) scale(${s})`);
  updateZoomLabel();
}
function updateZoomLabel() { const z = $('#zVal'); if (z) z.textContent = Math.round(S.view.s * 100 * (S.fitS ? 1 / S.fitS : 1)) + '%'; }

function fitView() {
  const c = $('#canvas');
  if (!c || !S.img) { applyView(); return; }
  const W = c.clientWidth, H = c.clientHeight, pad = 24;
  if (W <= pad * 2 || H <= pad * 2) { S.needFit = true; return; } // canvas hidden (overview) — fit when shown
  const s = Math.min((W - pad * 2) / S.img.w, (H - pad * 2) / S.img.h);
  S.view = { s, tx: (W - S.img.w * s) / 2, ty: (H - S.img.h * s) / 2 };
  S.fitS = s; S.userMoved = false;
  applyView(); renderPins();
}

function zoomAt(factor, sx, sy) {
  const c = $('#canvas');
  if (sx == null) { sx = c.clientWidth / 2; sy = c.clientHeight / 2; }
  const v = S.view;
  const ns = Math.max((S.fitS || 1) * 0.3, Math.min((S.fitS || 1) * 40, v.s * factor));
  const k = ns / v.s;
  v.tx = sx - (sx - v.tx) * k; v.ty = sy - (sy - v.ty) * k; v.s = ns;
  S.userMoved = true;
  applyView(); scheduleRender();
}

let rafPending = false;
function scheduleRender() {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => { rafPending = false; renderPins(); });
}

function toWorld(e) {
  const r = $('#svg').getBoundingClientRect();
  const sx = e.clientX - r.left, sy = e.clientY - r.top;
  return { sx, sy, x: (sx - S.view.tx) / S.view.s, y: (sy - S.view.ty) / S.view.s };
}
const clampPt = (x, y) => [Math.max(0, Math.min(S.img.w, x)), Math.max(0, Math.min(S.img.h, y))];

function svgEl(tag, attrs = {}, parent) {
  const e = document.createElementNS(SVGNS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}

function badge(parent, x, y, text, color, k, square, selectedFlag, over) {
  const fs = 12 * k;
  const w = Math.max(24, 9 + String(text).length * 7.4) * k, hh = 24 * k;
  const g = svgEl('g', { class: 'pin' }, parent);
  if (over) svgEl('rect', { x: x - w / 2 - 5 * k, y: y - hh / 2 - 5 * k, width: w + 10 * k, height: hh + 10 * k, rx: square ? 8 * k : (hh + 10 * k) / 2, fill: 'rgba(255,255,255,.7)', stroke: '#1f3a5f', 'stroke-width': 1.8 * k, 'stroke-dasharray': `${4 * k} ${3 * k}` }, g);
  if (selectedFlag) svgEl('rect', { x: x - w / 2 - 4 * k, y: y - hh / 2 - 4 * k, width: w + 8 * k, height: hh + 8 * k, rx: square ? 7 * k : (hh + 8 * k) / 2, fill: 'none', stroke: '#1f3a5f', 'stroke-width': 2.5 * k }, g);
  svgEl('rect', { x: x - w / 2, y: y - hh / 2, width: w, height: hh, rx: square ? 5 * k : hh / 2, fill: color, stroke: '#fff', 'stroke-width': 2 * k, style: 'filter:drop-shadow(0 1px 1.5px rgba(0,0,0,.45))' }, g);
  if (S.showLabels) {
    const t = svgEl('text', { x, y: y + fs * 0.36, 'text-anchor': 'middle', 'font-size': fs, 'font-weight': 700, fill: textOn(color), 'font-family': 'Sarabun, sans-serif' }, g);
    t.textContent = text;
  }
  return g;
}

function renderPins() {
  const layer = $('#pins');
  if (!layer || S.mode === 'overview') return;
  if (S.needFit && $('#canvas')?.clientWidth > 48) { S.needFit = false; fitView(); return; }
  layer.innerHTML = '';
  $('#draft').innerHTML = '';
  if (!S.img) return;
  const k = 1 / S.view.s;
  if (S.showOther) {
    const other = (isTest() ? S.defects : S.tests).filter(d => d.floorId === S.floorId);
    const og = svgEl('g', { opacity: 0.35, style: 'pointer-events:none' }, layer);
    if (isTest()) drawDefects(og, other, k, false); else drawTests(og, other, k, false);
  }
  const list = floorDefects().sort((a, b) => (a.id === S.selectedId) - (b.id === S.selectedId));
  if (isTest()) drawTests(layer, list, k, true); else drawDefects(layer, list, k, true);
  renderDraft();
}

function drawTests(layer, list, k, interactive) {
  for (const d of list) {
    const [x, y] = d.pts[0];
    const lv = stationLevel(P(), d);
    const col = levelColor(lv);
    const sel = interactive && d.id === S.selectedId;
    const g = svgEl('g', interactive ? { 'data-id': d.id, style: 'cursor:pointer' } : {}, layer);
    const r = 9 * k;
    if (isOverhead(d)) svgEl('circle', { cx: x, cy: y, r: r * 1.95, fill: 'rgba(255,255,255,.7)', stroke: '#1f3a5f', 'stroke-width': 1.8 * k, 'stroke-dasharray': `${4 * k} ${3 * k}` }, g);
    if (sel) svgEl('rect', { x: x - r - 5 * k, y: y - r - 5 * k, width: 2 * r + 10 * k, height: 2 * r + 10 * k, transform: `rotate(45 ${x} ${y})`, fill: 'none', stroke: '#1f3a5f', 'stroke-width': 2.5 * k }, g);
    svgEl('rect', { x: x - r, y: y - r, width: 2 * r, height: 2 * r, transform: `rotate(45 ${x} ${y})`, fill: col, stroke: lv === 'none' ? '#1f3a5f' : '#fff', 'stroke-width': 2 * k, style: 'filter:drop-shadow(0 1px 1.5px rgba(0,0,0,.45))' }, g);
    if (S.showLabels) {
      const label = stationLabel(d);
      const fs = 11 * k, tw = (String(label).length * 6.6 + 10) * k, th = 17 * k, lx = x + 13 * k, ly = y - 22 * k;
      svgEl('rect', { x: lx, y: ly, width: tw, height: th, rx: 4 * k, fill: '#fff', stroke: col === '#ffffff' ? '#1f3a5f' : col, 'stroke-width': 1.5 * k }, g);
      const t = svgEl('text', { x: lx + tw / 2, y: ly + th * 0.7, 'text-anchor': 'middle', 'font-size': fs, 'font-weight': 700, fill: '#16202c', 'font-family': 'Sarabun, sans-serif' }, g);
      t.textContent = label;
    }
  }
}

function drawDefects(layer, list, k, interactive) {
  // areas first, then points on top
  for (const pass of ['area', 'point']) {
    for (const d of list) {
      const isPt = d.shape === 'point';
      if ((pass === 'point') !== isPt) continue;
      const col = defectColor(P(), d);
      const sel = interactive && d.id === S.selectedId;
      const g = svgEl('g', interactive ? { 'data-id': d.id, style: 'cursor:pointer' } : {}, layer);
      if (isPt) {
        const [x, y] = d.pts[0];
        badge(g, x, y, d.no, col, k, false, sel, isOverhead(d));
      } else {
        svgEl('polygon', { points: d.pts.map(p => p.join(',')).join(' '), fill: col, 'fill-opacity': sel ? 0.38 : 0.26,
          stroke: col, 'stroke-width': (sel ? 3 : 2) * k, 'stroke-dasharray': sel ? `${8 * k} ${4 * k}` : '', 'stroke-linejoin': 'round' }, g);
        const [cx, cy] = centroid(d.pts);
        badge(g, cx, cy, d.no, col, k, true, sel, isOverhead(d));
        if (sel && S.tool === 'select') {
          d.pts.forEach((p, i) => svgEl('circle', { cx: p[0], cy: p[1], r: 6 * k, fill: '#fff', stroke: '#1f3a5f', 'stroke-width': 2 * k, 'data-vertex': i, 'data-id': d.id, style: 'cursor:move' }, layer));
        }
      }
    }
  }
}

function renderDraft() {
  const g = $('#draft');
  g.innerHTML = '';
  const k = 1 / S.view.s;
  const col = '#ff5a4e';
  if (S.pending) {
    const pts = S.pending.pts;
    if (pts.length === 1) {
      const [x, y] = pts[0];
      svgEl('circle', { cx: x, cy: y, r: 16 * k, fill: col, 'fill-opacity': .18, stroke: col, 'stroke-width': 2 * k, 'stroke-dasharray': `${4 * k} ${3 * k}` }, g);
      svgEl('path', { d: `M${x - 10 * k} ${y}H${x + 10 * k}M${x} ${y - 10 * k}V${y + 10 * k}`, stroke: col, 'stroke-width': 2 * k }, g);
    } else svgEl('polygon', { points: pts.map(p => p.join(',')).join(' '), fill: col, 'fill-opacity': .2, stroke: col, 'stroke-width': 2.5 * k, 'stroke-dasharray': `${6 * k} ${4 * k}` }, g);
    positionConfirm();
  }
  const dr = S.draft;
  if (!dr) return;
  if (dr.kind === 'area' && dr.pts.length) {
    const pts = dr.hover ? [...dr.pts, dr.hover] : dr.pts;
    svgEl('polyline', { points: pts.map(p => p.join(',')).join(' '), fill: col, 'fill-opacity': .15, stroke: col, 'stroke-width': 2 * k, 'stroke-dasharray': `${6 * k} ${4 * k}` }, g);
    dr.pts.forEach((p, i) => svgEl('circle', { cx: p[0], cy: p[1], r: (i === 0 ? 7 : 5) * k, fill: i === 0 ? col : '#fff', stroke: col, 'stroke-width': 2 * k }, g));
  }
  if (dr.kind === 'rect' && dr.a && dr.b) {
    const [x1, y1] = dr.a, [x2, y2] = dr.b;
    svgEl('rect', { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1), fill: col, 'fill-opacity': .15, stroke: col, 'stroke-width': 2 * k }, g);
  }
  if (dr.kind === 'scale' && dr.a) {
    const b = dr.b || dr.hover || dr.a;
    svgEl('line', { x1: dr.a[0], y1: dr.a[1], x2: b[0], y2: b[1], stroke: '#0f766e', 'stroke-width': 3 * k }, g);
    [dr.a, b].forEach(p => svgEl('circle', { cx: p[0], cy: p[1], r: 5 * k, fill: '#0f766e' }, g));
  }
}

// ---------- pointer handling ----------
const ptrs = new Map();
let gesture = null; // {type:'pan'|'move'|'vertex'|'rect'|'pinch', ...}

function onDown(e) {
  if (!S.img) return;
  $('#svg').setPointerCapture(e.pointerId);
  const w = toWorld(e);
  ptrs.set(e.pointerId, { sx: w.sx, sy: w.sy });
  if (ptrs.size === 2) {
    const [a, b] = [...ptrs.values()];
    gesture = { type: 'pinch', d0: Math.hypot(a.sx - b.sx, a.sy - b.sy), s0: S.view.s, tx0: S.view.tx, ty0: S.view.ty, mx: (a.sx + b.sx) / 2, my: (a.sy + b.sy) / 2 };
    return;
  }
  const target = e.target.closest('[data-id]');
  const base = { sx0: w.sx, sy0: w.sy, x0: w.x, y0: w.y, moved: false, tx0: S.view.tx, ty0: S.view.ty };
  if (e.button === 1 || e.button === 2 || spaceDown) { gesture = { type: 'pan', ...base }; return; }
  if (S.tool === 'select' && target && !canEdit()) { gesture = { type: 'pan', clickTarget: target, ...base }; return; }
  if (S.tool === 'select' && target) {
    const d = curItems().find(x => x.id === target.dataset.id);
    if (!d) { gesture = { type: 'pan', ...base }; return; }
    if (target.dataset.vertex != null) gesture = { type: 'vertex', d, vi: +target.dataset.vertex, orig: d.pts.map(p => [...p]), ...base };
    else gesture = { type: 'move', d, orig: d.pts.map(p => [...p]), ...base };
    return;
  }
  if (S.tool === 'rect') { S.draft = { kind: 'rect', a: clampPt(w.x, w.y), b: null }; gesture = { type: 'rect', ...base }; return; }
  gesture = { type: 'pan', clickTarget: target, ...base };
}

function onMove(e) {
  if (!S.img) return;
  const w = toWorld(e);
  if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, { sx: w.sx, sy: w.sy });
  if (gesture?.type === 'pinch' && ptrs.size === 2) {
    const [a, b] = [...ptrs.values()];
    const d = Math.hypot(a.sx - b.sx, a.sy - b.sy);
    const ns = gesture.s0 * d / gesture.d0, k = ns / gesture.s0;
    const mx = (a.sx + b.sx) / 2, my = (a.sy + b.sy) / 2;
    S.view.s = ns;
    S.view.tx = mx - (gesture.mx - gesture.tx0) * k;
    S.view.ty = my - (gesture.my - gesture.ty0) * k;
    S.userMoved = true; applyView(); scheduleRender();
    return;
  }
  if (!gesture) {
    if (S.draft && (S.draft.kind === 'area' || (S.draft.kind === 'scale' && !S.draft.b))) { S.draft.hover = clampPt(w.x, w.y); renderDraft(); }
    return;
  }
  const dx = w.sx - gesture.sx0, dy = w.sy - gesture.sy0;
  if (!gesture.moved && Math.hypot(dx, dy) > 4) gesture.moved = true;
  if (!gesture.moved) return;
  if (gesture.type === 'pan') {
    S.view.tx = gesture.tx0 + dx; S.view.ty = gesture.ty0 + dy; S.userMoved = true;
    $('#canvas').classList.add('panning'); applyView();
  } else if (gesture.type === 'move') {
    const ddx = dx / S.view.s, ddy = dy / S.view.s;
    gesture.d.pts = gesture.orig.map(([x, y]) => clampPt(x + ddx, y + ddy));
    scheduleRender();
  } else if (gesture.type === 'vertex') {
    const d = gesture.d, p = clampPt(w.x, w.y);
    if (d.shape === 'rect') {
      const o = gesture.orig[(gesture.vi + 2) % 4];
      d.pts = rectPts(o, p);
      gesture.vi = d.pts.findIndex(q => q[0] === p[0] && q[1] === p[1]);
      if (gesture.vi < 0) gesture.vi = 0;
    } else d.pts[gesture.vi] = p;
    scheduleRender();
  } else if (gesture.type === 'rect') {
    S.draft.b = clampPt(w.x, w.y); renderDraft();
  }
}

function rectPts(a, b) {
  const x1 = Math.min(a[0], b[0]), x2 = Math.max(a[0], b[0]), y1 = Math.min(a[1], b[1]), y2 = Math.max(a[1], b[1]);
  return [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];
}

async function onUp(e) {
  ptrs.delete(e.pointerId);
  $('#canvas').classList.remove('panning');
  const g = gesture;
  if (g?.type === 'pinch') { if (ptrs.size === 0) gesture = null; return; }
  gesture = null;
  if (!g || !S.img) return;
  const w = toWorld(e);
  if (g.type === 'move' || g.type === 'vertex') {
    if (g.moved) { await db.put('defects', g.d); renderRight(true); }
    else select(g.d.id);
    return;
  }
  if (g.type === 'rect') {
    const dr = S.draft; S.draft = null;
    if (dr?.a && dr?.b && Math.abs(dr.a[0] - dr.b[0]) * S.view.s > 6 && Math.abs(dr.a[1] - dr.b[1]) * S.view.s > 6) {
      await place('rect', rectPts(dr.a, dr.b));
    } else renderPins();
    return;
  }
  if (g.type === 'pan' && !g.moved) {
    if (S.pending && S.pending.pts.length > 1) return; // waiting for confirmation of an area
    const p = clampPt(w.x, w.y);
    const inside = w.x >= 0 && w.y >= 0 && w.x <= S.img.w && w.y <= S.img.h;
    if (S.tool === 'select') {
      if (g.clickTarget) select(g.clickTarget.dataset.id); else select(null);
    } else if (S.tool === 'point') {
      if (!inside) return;
      if (S.pending && S.pending.pts.length === 1) { S.pending.pts = [p]; renderDraft(); return; } // adjust before confirming
      await place('point', [p]);
    } else if (S.tool === 'area') {
      if (!inside) return;
      if (!S.draft) S.draft = { kind: 'area', pts: [] };
      const first = S.draft.pts[0];
      if (first && S.draft.pts.length >= 3 && Math.hypot(first[0] - p[0], first[1] - p[1]) * S.view.s < 12) { await finishArea(); return; }
      S.draft.pts.push(p); renderDraft();
    } else if (S.tool === 'scale') {
      if (!inside) return;
      if (!S.draft || S.draft.b) S.draft = { kind: 'scale', a: p };
      else { S.draft.b = p; renderDraft(); await finishScale(); }
      renderDraft();
    }
  }
}

function onDbl(e) {
  if (S.tool === 'area' && S.draft?.pts?.length >= 3) { e.preventDefault(); finishArea(true); }
}

async function finishArea(fromDbl = false) {
  const dr = S.draft;
  if (!dr || dr.pts.length < 3) return;
  let pts = dr.pts;
  // a double-click also adds a duplicate last point via the two clicks: drop near-duplicates
  if (fromDbl) pts = pts.filter((p, i) => i === 0 || Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) * S.view.s > 3);
  S.draft = null;
  if (pts.length < 3) { renderPins(); return; }
  await place('area', pts);
}

async function finishScale() {
  const { a, b } = S.draft;
  const px = Math.hypot(a[0] - b[0], a[1] - b[1]);
  const v = await promptBox('ตั้งสเกลแปลน', '', { label: `ระยะจริงของเส้นที่วาด (เมตร) — ยาว ${px.toFixed(0)} px บนแปลน`, placeholder: 'เช่น 8.00' });
  S.draft = null;
  const m = parseFloat(String(v || '').replace(/,/g, ''));
  if (m > 0 && px > 0) {
    const f = curFloor();
    f.scale = m / px;
    await db.put('floors', f);
    toast(`ตั้งสเกล “${f.name}” แล้ว — พื้นที่ที่วาดจะคำนวณ ตร.ม. ให้อัตโนมัติ`, 'ok', 3500);
    renderCanvasBase(); renderRight(true);
    setTool('select');
  } else renderPins();
}

function onWheel(e) {
  if (!S.img) return;
  e.preventDefault();
  const w = toWorld(e);
  const f = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
  zoomAt(f, w.sx, w.sy);
}

let spaceDown = false;
function onKey(e) {
  if (!S || !document.body.contains($('#canvas'))) { document.removeEventListener('keydown', onKey); return; }
  if (document.querySelector('.modal-back, .report-view')) return;
  if (S.mode === 'overview') return;
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
  if (S.pending && !typing) {
    if (e.key === 'Enter') { e.preventDefault(); S.pending.resolve(true); return; }
    if (e.key === 'Escape') { S.pending.resolve(false); return; }
  }
  if (e.key === 'Escape') {
    if (typing) { document.activeElement.blur(); return; }
    if (S.draft) { S.draft = null; renderPins(); return; }
    if (S.tool !== 'select') { setTool('select'); return; }
    select(null); return;
  }
  if (typing) return;
  if (!canEdit() && !['f', 'l', '+', '=', '-', ' ', '[', 'pageup', 'pagedown'].includes(e.key.toLowerCase())) return;
  if (e.key === ' ') { spaceDown = true; e.preventDefault(); window.addEventListener('keyup', (ev) => { if (ev.key === ' ') spaceDown = false; }, { once: true }); return; }
  if (S.draft?.kind === 'area') {
    if (e.key === 'Enter') { finishArea(); return; }
    if (e.key === 'Backspace') { S.draft.pts.pop(); renderDraft(); e.preventDefault(); return; }
  }
  const k = e.key.toLowerCase();
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (k === 'k') toggleConfirm();
  else if (k === 'u') toggleOverhead();
  else if (k === 'o') toggleOther();
  else if (k === 't' && isTest()) $('#tSet')?.click();
  else if (k === 'v') setTool('select');
  else if (k === 'p') setTool('point');
  else if (k === 'a') setTool('area');
  else if (k === 'r') setTool('rect');
  else if (k === 's') setTool('scale');
  else if (k === 'c' && !isTest()) { S.copyPrev = !S.copyPrev; renderTools(); }
  else if (k === 'l') { S.showLabels = !S.showLabels; renderTools(); renderPins(); }
  else if (k === '[') toggleLeft();
  else if (e.key === 'PageUp') { e.preventDefault(); stepFloor(-1); }
  else if (e.key === 'PageDown') { e.preventDefault(); stepFloor(1); }
  else if (k === 'f') fitView();
  else if (k === '+' || k === '=') zoomAt(1.25);
  else if (k === '-') zoomAt(0.8);
  else if ((e.key === 'Delete' || e.key === 'Backspace') && selected()) deleteDefect(selected());
}

function centerOn(d) {
  if (!S.img) return;
  const c = $('#canvas');
  const [x, y] = d.shape === 'point' ? d.pts[0] : centroid(d.pts);
  S.view.tx = c.clientWidth / 2 - x * S.view.s;
  S.view.ty = c.clientHeight / 2 - y * S.view.s;
  S.userMoved = true;
  applyView(); renderPins();
}

// ===================================================================== placing (with optional confirmation)
function cancelPending() { if (S?.pending) S.pending.resolve(false); }
function positionConfirm() {
  const box = $('#placeConfirm');
  if (!box || !S.pending) return;
  const pts = S.pending.pts;
  const [x, y] = pts.length === 1 ? pts[0] : centroid(pts);
  const c = $('#canvas');
  let sx = x * S.view.s + S.view.tx, sy = y * S.view.s + S.view.ty;
  sx = Math.max(110, Math.min(c.clientWidth - 110, sx)); sy = Math.max(10, Math.min(c.clientHeight - 70, sy + 26));
  box.style.left = sx + 'px'; box.style.top = sy + 'px';
}
function confirmPlace(pts) {
  if (!S.confirm) return Promise.resolve(pts);
  cancelPending();
  return new Promise((resolve) => {
    const box = h(`<div class="place-confirm" id="placeConfirm"><span>${isTest() ? 'ปักจุดทดสอบตรงนี้?' : 'ปักตำแหน่งตรงนี้?'}</span>
      <button class="btn sm primary" data-ok>✓ ยืนยัน</button><button class="btn sm" data-no>✕</button></div>`);
    $('#canvas').appendChild(box);
    const done = (v) => { if (!S.pending) return; const final = S.pending.pts; S.pending = null; box.remove(); renderDraft(); resolve(v ? final : null); };
    S.pending = { pts, resolve: done };
    $('[data-ok]', box).onclick = () => done(true);
    $('[data-no]', box).onclick = () => done(false);
    box.addEventListener('pointerdown', (e) => e.stopPropagation());
    renderDraft();
  });
}
async function place(shape, pts) {
  if (!canEdit()) return;
  const ok = await confirmPlace(pts);
  if (!ok) { renderPins(); return; }
  pts = ok; // the point may have been moved before confirming
  if (isTest()) await createTest(pts.length === 1 ? pts : [centroid(pts)]);
  else await createDefect(shape, pts);
}

async function createTest(pts) {
  const p = P();
  const ids = (settingsOf(p).lastSet || ['upv']).filter(id => typeDef(p, id));
  const createdBy = await whoAmI();
  const tests = {}, codes = {};
  ids.forEach(id => { tests[id] = {}; codes[id] = nextCode(p, S.tests, typePrefix(p, id), Object.values(codes)); });
  const d = { id: uid(), projectId: p.id, floorId: S.floorId, layer: 'test', shape: 'point', pts,
    code: codes[ids[0]], codes, role: '', element: '', place: '', tests, photoIds: [], createdAt: Date.now(), createdBy };
  if (S.overhead) d.pos = 'above';
  await db.put('defects', d);
  S.tests.push(d);
  await touch(p);
  S.selectedId = d.id;
  renderTabs(); renderList(); renderPins(); renderRight(); updateHint();
}

// ===================================================================== defects
async function createDefect(shape, pts) {
  if (!canEdit()) return;
  const p = P();
  const prev = S.defects.find(d => d.id === S.lastCreatedId) || selected();
  const createdBy = await whoAmI();
  const d = {
    id: uid(), projectId: p.id, floorId: S.floorId,
    no: suggestNo(p, S.defects), shape, pts,
    type: p.defaultType || 'structural', data: {}, photoIds: [], createdAt: Date.now(), createdBy,
  };
  if (S.copyPrev && prev) { d.type = prev.type; d.data = JSON.parse(JSON.stringify(prev.data || {})); }
  if (S.overhead && canOverhead(d)) d.pos = 'above';
  await db.put('defects', d);
  S.defects.push(d);
  S.lastCreatedId = d.id;
  await touch(p);
  S.selectedId = d.id;
  renderTabs(); renderList(); renderPins(); renderRight(); updateHint();
}

function select(id) {
  S.selectedId = id;
  if (id) S.lastCreatedId = id;
  renderList(); renderPins(); renderRight();
}

async function deleteDefect(d) {
  if (!canEdit()) return;
  if (!(await confirmBox(d.layer === 'test' ? `ลบจุดทดสอบ ${stationLabel(d)} พร้อมค่าที่บันทึกไว้?` : `ลบจุดที่ ${d.no}?`, { ok: 'ลบ', danger: true }))) return;
  for (const ph of d.photoIds || []) { forgetUrl(ph); await db.delBlob(ph); }
  await db.del('defects', d.id);
  S.defects = S.defects.filter(x => x.id !== d.id);
  S.tests = S.tests.filter(x => x.id !== d.id);
  if (S.selectedId === d.id) S.selectedId = null;
  await touch(P());
  renderTabs(); renderList(); renderPins(); renderRight(); updateHint();
}

export function defectAreaM2(floor, d) {
  if (!floor?.scale || d.shape === 'point') return null;
  return polyArea(d.pts) * floor.scale * floor.scale;
}
export function rectDims(floor, d) {
  if (!floor?.scale || d.shape !== 'rect') return null;
  const xs = d.pts.map(p => p[0]), ys = d.pts.map(p => p[1]);
  return [(Math.max(...xs) - Math.min(...xs)) * floor.scale, (Math.max(...ys) - Math.min(...ys)) * floor.scale];
}

// ===================================================================== right panel
const saveSel = debounce(async (d) => { if (!sync.canEdit()) return; await db.put('defects', d); touch(P()); }, 350);

function renderRight(keepScroll = false) {
  const box = $('#right');
  const d = selected();
  if (!d) { box.classList.add('closed'); box.innerHTML = ''; return; }
  const scroll = keepScroll ? $('.rbody', box)?.scrollTop : 0;
  box.classList.remove('closed');
  if (d.layer === 'test') {
    box.innerHTML = '';
    buildTestPanel(box, {
      project: P(), station: d, floor: S.floors.find(f => f.id === d.floorId), editable: canEdit(), stations: S.tests,
      onSave: async (st) => { if (!canEdit()) return; await db.put('defects', st); touch(P()); },
      onDelete: (st) => deleteDefect(st),
      onClose: () => select(null),
      onCodeChange: () => { renderList(); renderPins(); updateHint(); },
    });
    mountPosSeg(box, d, $('#roleSeg', box)?.closest('.fld'));
    renderPhotos(d);
    if (scroll) $('.rbody', box).scrollTop = scroll;
    return;
  }
  const p = P();
  const tpl = tplOf(d);
  const floor = S.floors.find(f => f.id === d.floorId);
  const auto = p.numbering === 'auto';
  const shapeTxt = { point: 'จุด', area: 'พื้นที่ (หลายเหลี่ยม)', rect: 'พื้นที่ (สี่เหลี่ยม)' }[d.shape];
  const area = defectAreaM2(floor, d);
  const dims = rectDims(floor, d);

  box.innerHTML = '';
  const el = h(`<div style="display:contents">
    <div class="rhead"><h4>รายละเอียดความเสียหาย</h4><button class="icon-btn" id="rClose" title="ปิด (Esc)">✕</button></div>
    <div class="rbody">
      <div class="fld" id="noWrap"><span>ลำดับที่ ${auto ? '(รันอัตโนมัติ)' : ''}</span>
        <div class="num-input"><input type="text" id="fNo" value="${esc(d.no)}" ${auto ? 'readonly' : ''}>
        <span class="hint">${esc(shapeTxt)} • ${esc(floor?.name || '')}</span></div>
        <span class="err" id="noErr"></span></div>
      ${area != null ? `<div class="area-line">พื้นที่จากแปลน ≈ <b>${area.toFixed(2)} ตร.ม.</b>${dims ? ` (${dims[0].toFixed(2)} × ${dims[1].toFixed(2)} ม.)` : ''}
        <button class="btn sm ghost" id="useArea" style="padding:0 6px">ใส่ในช่องขนาด</button></div>` :
        (d.shape !== 'point' && !floor?.scale ? `<div class="area-line">ตั้งสเกลแปลนก่อน เพื่อให้คำนวณ ตร.ม. อัตโนมัติ</div>` : '')}
      <div class="fld"><span>ประเภทการตรวจสอบ</span>
        <div class="seg">${Object.keys(TYPE_LABELS).map(t => `<button data-type="${t}" class="${d.type === t ? 'on' : ''}">${TYPE_LABELS[t]}</button>`).join('')}</div></div>
      <div id="fields"></div>
      <div class="sec-title">ภาพประกอบ</div>
      <div class="photos" id="photos"></div>
      <p class="hint" style="margin-top:6px">รูปแรกจะใช้เป็นรูปหลักในรายงาน • คลิกเพื่อขยาย</p>
    </div>
    <div class="rfoot">
      <button class="btn sm danger edit-only" id="rDel">ลบจุดนี้</button>
      <button class="btn sm edit-only" id="rMove" title="ย้ายจุดนี้ไปชั้นอื่น">ย้ายชั้น</button>
      <span class="spacer"></span>
      <button class="btn sm edit-only" id="rCopyPrev" title="คัดลอกรายละเอียดจากจุดอื่น">คัดลอกจาก…</button>
      <button class="btn sm primary" id="rDone">${canEdit() ? 'เสร็จ' : 'ปิด'}</button>
    </div></div>`);
  box.appendChild(el);
  $('#rClose').onclick = $('#rDone').onclick = () => select(null);
  $('#rDel').onclick = () => deleteDefect(d);
  $('#rMove').onclick = (e) => {
    const others = S.floors.filter(f => f.id !== d.floorId);
    if (!others.length) { toast('ยังไม่มีชั้นอื่น'); return; }
    dropdown(e.currentTarget, others.map(f => ({ label: f.name, fn: async () => {
      const sx = f.w / floor.w, sy = f.h / floor.h;
      d.pts = d.pts.map(([x, y]) => [x * sx, y * sy]); d.floorId = f.id;
      await db.put('defects', d); await selectFloor(f.id); S.selectedId = d.id; refreshAll();
      toast(`ย้ายจุดที่ ${d.no} ไป “${f.name}” แล้ว`, 'ok');
    } })));
  };
  $('#rCopyPrev').onclick = async () => {
    const no = await promptBox('คัดลอกรายละเอียดจากจุดอื่น', '', { label: 'เลขลำดับของจุดต้นทาง (ไม่คัดลอกรูป)' });
    if (!no) return;
    const src = S.defects.find(x => x.id !== d.id && String(x.no).trim().toLowerCase() === no.toLowerCase());
    if (!src) { toast('ไม่พบเลขลำดับนี้', 'error'); return; }
    d.type = src.type; d.data = JSON.parse(JSON.stringify(src.data || {}));
    await db.put('defects', d); renderRight(); renderList(); renderPins();
  };
  if ($('#useArea')) $('#useArea').onclick = () => {
    const sf = fieldByRole(tpl, 'size');
    if (!sf) return;
    d.data[sf.key] = dims ? `${dims[0].toFixed(2)} x ${dims[1].toFixed(2)} ม. (${area.toFixed(2)} ตร.ม.)` : `${area.toFixed(2)} ตร.ม.`;
    saveSel(d); renderRight(true);
  };
  $$('[data-type]', box).forEach(b => b.onclick = () => {
    if (d.type === b.dataset.type) return;
    d.type = b.dataset.type; saveSel(d); renderRight(); renderList(); renderPins();
  });

  // number
  const noIn = $('#fNo');
  if (!auto) {
    noIn.oninput = () => {
      const v = noIn.value.trim();
      const err = !v ? 'กรุณาใส่เลขลำดับ' : isDuplicateNo(S.defects, v, d.id) ? `เลข “${v}” ซ้ำกับจุดอื่นแล้ว` : '';
      $('#noErr').textContent = err;
      $('#noWrap').classList.toggle('invalid', !!err);
      if (!err) { d.no = v; saveSel(d); renderList(); renderPins(); updateHint(); }
    };
    noIn.onblur = () => { if ($('#noErr').textContent) { noIn.value = d.no; $('#noErr').textContent = ''; $('#noWrap').classList.remove('invalid'); } };
  }

  if (canOverhead(d)) mountPosSeg(box, d, $('[data-type]', box)?.closest('.fld'));
  renderFields($('#fields'), d, tpl);
  renderPhotos(d);
  if (!canEdit()) $$('input, select, textarea, .seg button, #useArea, .listed button, #fields .btn', $('.rbody', box)).forEach(x => { x.disabled = true; });
  if (scroll) $('.rbody', box).scrollTop = scroll;
}

// "in the floor" vs "overhead (structure of the floor above)" picker, inserted after `after`
function mountPosSeg(box, d, after) {
  if (!after) return;
  const found = S.floors.find(f => f.id === d.floorId);
  const up = upperFloor(S.floors, found);
  const el = h(`<div class="fld"><span>ตำแหน่งที่พบ</span>
    <div class="seg" id="posSeg"><button data-pos="" class="${d.pos !== 'above' ? 'on' : ''}">ในพื้นที่ชั้น</button><button data-pos="above" class="${d.pos === 'above' ? 'on' : ''}">⬆ เหนือศีรษะ</button></div>
    ${d.pos === 'above' ? `<span class="hint">${up ? `ท้องพื้น/ท้องคาน = ${esc(joinName('โครงสร้าง', up.name))} • ${esc(joinName('ในรายงานแสดงที่', overheadView(P()) === 'structure' ? up.name : (found?.name || 'ชั้นที่พบ')))} (ตั้งค่าได้ที่ “แก้ไขข้อมูลโครงการ”)` : '⚠ ชั้นนี้ยังไม่มีชั้นด้านบนในโครงการ — จะแสดงในชั้นที่พบ'}</span>` : ''}</div>`);
  after.after(el);
  $$('[data-pos]', el).forEach(b => b.onclick = async () => {
    if (!canEdit()) return;
    const v = b.dataset.pos;
    if ((d.pos || '') === v) return;
    if (v) d.pos = v; else delete d.pos;
    await db.put('defects', d); touch(P());
    renderRight(true); renderList(); renderPins();
  });
  if (!canEdit()) $$('button', el).forEach(x => { x.disabled = true; });
}

function renderFields(box, d, tpl) {
  d.data = d.data || {};
  const changed = (redraw) => { saveSel(d); if (redraw) { renderList(); renderPins(); } };
  let lastSec = null;
  for (const f of tpl.fields) {
    if (f.hidden) continue;
    const v = d.data[f.key];
    let el;
    const lab = `<span>${esc(f.label)}</span>`;
    const isCore = ['element', 'title', 'severity'].includes(f.role);
    if (f.kind === 'select') {
      el = h(`<label class="fld">${lab}<select><option value="">— เลือก —</option>${f.options.map(o => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('')}
        ${v && !f.options.includes(v) ? `<option selected>${esc(v)}</option>` : ''}</select></label>`);
      $('select', el).onchange = (e) => { d.data[f.key] = e.target.value; changed(isCore || f.role === 'urgency'); };
    } else if (f.kind === 'severity') {
      el = h(`<div class="fld">${lab}<div class="sev-pick">${f.options.map(o => `<label class="chip ${o.label === v ? 'on' : ''}"><input type="radio" name="sev_${f.key}" value="${esc(o.label)}" ${o.label === v ? 'checked' : ''}><span class="dot" style="background:${o.color}"></span>${esc(o.label)}</label>`).join('')}</div></div>`);
      $$('input', el).forEach(inp => inp.onchange = () => {
        d.data[f.key] = inp.value; $$('.chip', el).forEach(c => c.classList.toggle('on', $('input', c).checked)); changed(true);
      });
      $$('.chip', el).forEach(c => c.addEventListener('click', (e) => {
        const inp = $('input', c);
        if (inp.checked && d.data[f.key] === inp.value) { e.preventDefault(); inp.checked = false; d.data[f.key] = ''; c.classList.remove('on'); changed(true); }
      }));
    } else if (f.kind === 'choice' || f.kind === 'checks') {
      const arr = f.kind === 'checks' ? (Array.isArray(v) ? v : []) : [v];
      el = h(`<div class="fld">${lab}<div class="checks">${f.options.map(o => `<label class="chip ${arr.includes(o) ? 'on' : ''}"><input type="checkbox" value="${esc(o)}" ${arr.includes(o) ? 'checked' : ''}>${f.kind === 'checks' ? (arr.includes(o) ? '☑' : '☐') : (arr.includes(o) ? '◉' : '○')} ${esc(o)}</label>`).join('')}</div></div>`);
      $$('input', el).forEach(inp => inp.onchange = () => {
        if (f.kind === 'checks') {
          const cur = new Set(Array.isArray(d.data[f.key]) ? d.data[f.key] : []);
          inp.checked ? cur.add(inp.value) : cur.delete(inp.value);
          d.data[f.key] = f.options.filter(o => cur.has(o)).concat([...cur].filter(o => !f.options.includes(o)));
        } else d.data[f.key] = inp.checked ? inp.value : '';
        changed(true);
        const nb = h('<div></div>'); el.replaceWith(nb); // re-render this field only
        const tmp = h('<div></div>'); renderFields(tmp, d, { fields: [f] }); nb.replaceWith(tmp.firstElementChild);
      });
    } else if (f.kind === 'text') {
      const dl = f.role === 'title' ? titleSuggestions(d, f) : (f.suggestions || []);
      const lid = 'dl_' + f.key;
      el = h(`<label class="fld">${lab}<input type="text" value="${esc(v || '')}" ${dl.length ? `list="${lid}"` : ''}>${dl.length ? `<datalist id="${lid}">${dl.map(s => `<option value="${esc(s)}">`).join('')}</datalist>` : ''}
        ${f.role === 'title' ? '<span class="hint">จุดที่มีหัวข้อ (และโครงสร้าง/หมวด) เดียวกัน จะถูกรวมเป็นหัวข้อเดียวในรายงาน</span>' : ''}</label>`);
      $('input', el).oninput = (e) => { d.data[f.key] = e.target.value; changed(isCore); };
    } else if (f.kind === 'textarea') {
      el = h(`<label class="fld">${lab}<textarea rows="3">${esc(v || '')}</textarea></label>`);
      $('textarea', el).oninput = (e) => { d.data[f.key] = e.target.value; changed(false); };
    } else if (f.kind === 'list') {
      el = h(`<div class="fld">${lab}<div class="listed"></div><button class="btn sm ghost" type="button" style="align-self:flex-start">＋ เพิ่มข้อ</button></div>`);
      const wrap = $('.listed', el);
      const items = Array.isArray(v) ? [...v] : (v ? String(v).split('\n') : []);
      const draw = () => {
        wrap.innerHTML = '';
        items.forEach((it, i) => {
          const li = h(`<div class="li"><span class="n">${i + 1}.</span><textarea class="inp" rows="1">${esc(it)}</textarea><button class="icon-btn" title="ลบข้อ">✕</button></div>`);
          $('textarea', li).oninput = (e) => { items[i] = e.target.value; d.data[f.key] = [...items]; changed(false); };
          $('button', li).onclick = () => { items.splice(i, 1); d.data[f.key] = [...items]; changed(false); draw(); };
          wrap.appendChild(li);
        });
      };
      draw();
      $(':scope > button', el).onclick = () => { items.push(''); draw(); const tas = $$('textarea', wrap); tas.at(-1)?.focus(); };
    }
    if (!el) continue;
    if (f.kind === 'list' && lastSec !== 'more') { box.appendChild(h('<div class="sec-title">การแก้ไข</div>')); lastSec = 'more'; }
    box.appendChild(el);
  }
}

function titleSuggestions(d, f) {
  const set = new Set(f.suggestions || []);
  S.defects.forEach(x => { if (x.type === d.type && x.data?.[f.key]) set.add(x.data[f.key]); });
  return [...set];
}

async function renderPhotos(d) {
  const box = $('#photos');
  if (!box) return;
  box.innerHTML = '';
  for (let i = 0; i < d.photoIds.length; i++) {
    const id = d.photoIds[i];
    const u = await blobUrl(id);
    const ph = h(`<div class="photo" style="background-image:url('${u}')">${i === 0 ? '<span class="first">รูปหลัก</span>' : ''}
      <div class="acts">${i > 0 ? '<button data-a="first" title="ตั้งเป็นรูปหลัก">★</button>' : ''}<button data-a="del" title="ลบรูป">✕</button></div></div>`);
    ph.onclick = (e) => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (a === 'del') { e.stopPropagation(); removePhoto(d, id); }
      else if (a === 'first') { e.stopPropagation(); d.photoIds.splice(i, 1); d.photoIds.unshift(id); saveSel.flush(d); renderPhotos(d); renderList(); }
      else lightbox(u);
    };
    box.appendChild(ph);
  }
  const add = h('<div class="photo add">＋<br>เพิ่มรูป</div>');
  add.onclick = async () => {
    const files = await pickFiles({ accept: 'image/*', multiple: true });
    if (!files.length) return;
    add.textContent = 'กำลังบันทึก…';
    for (const f of files) {
      const { blob } = await compressImage(f, 1600, 0.85);
      d.photoIds.push(await db.putBlob(blob));
    }
    await db.put('defects', d); await touch(P());
    renderPhotos(d); renderList();
  };
  box.appendChild(add);
}

async function removePhoto(d, id) {
  if (!(await confirmBox('ลบรูปนี้?', { ok: 'ลบรูป', danger: true }))) return;
  d.photoIds = d.photoIds.filter(x => x !== id);
  forgetUrl(id); await db.delBlob(id); await db.put('defects', d);
  renderPhotos(d); renderList();
}

function lightbox(url) {
  const lb = h(`<div class="lightbox"><img src="${url}"></div>`);
  lb.onclick = () => lb.remove();
  document.body.appendChild(lb);
}
