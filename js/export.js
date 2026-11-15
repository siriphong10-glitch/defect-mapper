import { db, uid } from './db.js';
import { $, $$, esc, h, modal, toast, download, loadScript, loadImage, naturalCmp, safeName, thaiDateLong, centroid, polyArea } from './utils.js';
import { loadBundle } from './project.js';
import { TYPE_LABELS, fieldByRole, severityInfo, NO_SEVERITY_COLOR, textOn, fieldText, defectTitle, groupKey } from './templates.js';

const DEFAULT_ORG = 'บริษัท เพอร์ฟอร์มแมกซ์ บิวดิ้ง เซอร์วิซ จำกัด';
const HEAD_FILL = 'C5D9F1';
const SHAPE_TH = { point: 'จุด', area: 'พื้นที่', rect: 'พื้นที่' };

// =====================================================================================
// Report model — shared by every export format
// =====================================================================================
export async function buildModel(projectId, floorIds = null) {
  const { project, floors, defects } = await loadBundle(projectId);
  const fl = floorIds ? floors.filter(f => floorIds.includes(f.id)) : floors;
  const fo = new Map(fl.map((f, i) => [f.id, i]));
  const ds = defects.filter(d => fo.has(d.floorId))
    .sort((a, b) => naturalCmp(a.no, b.no) || fo.get(a.floorId) - fo.get(b.floorId));

  const items = ds.map(d => {
    const tpl = project.templates[d.type] || project.templates.structural;
    const floor = fl[fo.get(d.floorId)];
    const sevF = fieldByRole(tpl, 'severity'), urgF = fieldByRole(tpl, 'urgency'), elF = fieldByRole(tpl, 'element'), sizeF = fieldByRole(tpl, 'size');
    const sev = sevF ? severityInfo(tpl, d.data?.[sevF.key]) : null;
    const area = floor?.scale && d.shape !== 'point' ? polyArea(d.pts) * floor.scale ** 2 : null;
    return {
      d, tpl, floor, no: d.no,
      title: defectTitle(project, d),
      element: elF ? (d.data?.[elF.key] || '') : '',
      elementLabel: elF ? elF.label : 'หมวด',
      sev, sevText: sev?.label || '', urgText: urgF ? (d.data?.[urgF.key] || '') : '',
      color: sev?.color || NO_SEVERITY_COLOR,
      size: sizeF ? (d.data?.[sizeF.key] || '') : '',
      area,
      key: groupKey(project, d),
    };
  });

  // groups (same heading → one entry)
  const gmap = new Map();
  for (const it of items) {
    if (!gmap.has(it.key)) gmap.set(it.key, { key: it.key, items: [], tpl: it.tpl, type: it.d.type });
    gmap.get(it.key).items.push(it);
  }
  const groups = [...gmap.values()];
  groups.forEach((g, i) => {
    g.index = i + 1;
    g.first = g.items[0];
    g.title = g.first.title;
    g.element = g.first.element;
    g.worst = g.items.reduce((w, it) => (it.sev && (!w.sev || it.sev.rank > w.sev.rank) ? it : w), g.items[0]);
  });

  const perFloor = fl.map(f => ({ floor: f, items: items.filter(it => it.floor.id === f.id) }));
  return { project, floors: fl, items, groups, perFloor };
}

function sevLabelOf(tpl) {
  const s = fieldByRole(tpl, 'severity'), u = fieldByRole(tpl, 'urgency');
  return [s?.label, u?.label?.replace(/^ความ/, '')].filter(Boolean).join('/') || 'ระดับความเสียหาย';
}

function positionsText(items) {
  const byFloor = new Map();
  items.forEach(it => { if (!byFloor.has(it.floor.name)) byFloor.set(it.floor.name, []); byFloor.get(it.floor.name).push(it.no); });
  const parts = [...byFloor.entries()].map(([f, nos]) => `${f}: จุดที่ ${nos.join(', ')}`);
  return parts.join(' / ') + (items.length > 1 ? ` (รวม ${items.length} ${items.some(i => i.d.shape !== 'point') ? 'ตำแหน่ง' : 'จุด'})` : '');
}

// A "card" = the per-item form table seen in the reports (shared by Word & PDF)
function cardModel(entries, { grouped, showUnchecked, maxPhotos }) {
  const first = entries[0];
  const tpl = first.tpl;
  const d = first.d;
  const worst = entries.reduce((w, it) => (it.sev && (!w.sev || it.sev.rank > w.sev.rank) ? it : w), first);
  const before = [], after = [];
  for (const f of tpl.fields) {
    if (f.hidden || ['element', 'severity', 'urgency', 'title'].includes(f.role)) continue;
    let row = null;
    if (f.kind === 'checks' || f.kind === 'choice') {
      const set = new Set();
      entries.forEach(it => { const v = it.d.data?.[f.key]; (Array.isArray(v) ? v : [v]).forEach(x => x && set.add(x)); });
      const options = showUnchecked ? [...f.options, ...[...set].filter(x => !f.options.includes(x))] : [...set];
      if (!options.length) continue;
      row = { label: f.label, kind: 'boxes', options, checked: set };
    } else if (f.kind === 'list') {
      const v = d.data?.[f.key];
      const arr = (Array.isArray(v) ? v : (v ? String(v).split('\n') : [])).filter(x => String(x).trim());
      if (!arr.length) continue;
      row = { label: f.label, kind: 'list', items: arr };
    } else if (f.role === 'size' && grouped && entries.length > 1) {
      const areas = entries.map(e => e.area);
      let txt;
      if (areas.every(a => a != null)) txt = `รวมประมาณ ${areas.reduce((s, a) => s + a, 0).toFixed(2)} ตร.ม. (${entries.length} ตำแหน่ง)`;
      else {
        const sz = entries.filter(e => e.size).map(e => `จุดที่ ${e.no}: ${e.size}`);
        if (!sz.length) continue;
        txt = sz.slice(0, 8).join('; ') + (sz.length > 8 ? ' …' : '');
      }
      row = { label: f.label, kind: 'text', value: txt };
    } else {
      let v = fieldText(f, d.data?.[f.key]);
      if (f.role === 'size' && !v && first.area != null) v = `${first.area.toFixed(2)} ตร.ม.`;
      if (!v) continue;
      row = { label: f.label, kind: 'text', value: v };
    }
    (f.kind === 'textarea' || f.kind === 'list' ? after : before).push(row);
  }
  // sample photos: first photo from different points first, then extra photos
  const photos = [];
  for (const it of entries) { if (it.d.photoIds?.[0] && photos.length < maxPhotos) photos.push(it.d.photoIds[0]); }
  for (const it of entries) for (const p of (it.d.photoIds || []).slice(1)) if (photos.length < maxPhotos && !photos.includes(p)) photos.push(p);
  return {
    no: grouped ? String(entries.groupIndex) : first.no,
    elementLabel: first.elementLabel, element: first.element || '-',
    sevLabel: sevLabelOf(tpl), sevText: [worst.sevText, worst.urgText].filter(Boolean).join('/') || '-', sevColor: worst.sev ? worst.color : null,
    titleLabel: (fieldByRole(tpl, 'title') || {}).label || 'หัวข้อ', title: first.title,
    before, after, photos,
    position: grouped ? positionsText(entries) : `${first.floor.name}${first.d.data?.grid ? ' / ' + first.d.data.grid : ''} (${SHAPE_TH[first.d.shape]})`,
    typeLabel: TYPE_LABELS[d.type],
  };
}

// =====================================================================================
// Annotated plan rendering (canvas)
// =====================================================================================
async function ensureFonts() {
  try { await Promise.all([document.fonts.load('700 20px Sarabun'), document.fonts.load('400 20px Sarabun'), document.fonts.load('700 20px Sarabun', 'กขค')]); } catch { /* */ }
}

function roundRect(ctx, x, y, w, hh, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + hh, r); ctx.arcTo(x + w, y + hh, x, y + hh, r);
  ctx.arcTo(x, y + hh, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

export async function planCanvas(floor, items, { maxDim = 3000, markerScale = 1, header = null } = {}) {
  await ensureFonts();
  const blob = await db.getBlob(floor.blobId);
  const url = URL.createObjectURL(blob);
  const img = await loadImage(url);
  URL.revokeObjectURL(url);
  const s = Math.min(1, maxDim / Math.max(floor.w, floor.h));
  const W = Math.round(floor.w * s), H = Math.round(floor.h * s);
  const k = Math.max(W, H) / 1000 * markerScale;
  const headH = header ? Math.round(Math.max(56, 46 * Math.max(W, H) / 1400)) : 0;
  const c = document.createElement('canvas');
  c.width = W; c.height = H + headH;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, headH, W, H);
  ctx.save(); ctx.translate(0, headH);
  const P = (p) => [p[0] * s, p[1] * s];
  for (const it of items.filter(i => i.d.shape !== 'point')) {
    ctx.beginPath();
    it.d.pts.forEach((p, i) => { const [x, y] = P(p); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.closePath();
    ctx.globalAlpha = 0.28; ctx.fillStyle = it.color; ctx.fill();
    ctx.globalAlpha = 1; ctx.lineWidth = 2.5 * k; ctx.strokeStyle = it.color; ctx.lineJoin = 'round'; ctx.stroke();
  }
  const badgeAt = (x, y, text, color, square) => {
    const fs = 16 * k;
    ctx.font = `700 ${fs}px Sarabun, sans-serif`;
    const w = Math.max(32 * k, ctx.measureText(text).width + 14 * k), hh = 32 * k;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.4)'; ctx.shadowBlur = 3 * k; ctx.shadowOffsetY = 1 * k;
    roundRect(ctx, x - w / 2, y - hh / 2, w, hh, square ? 5 * k : hh / 2);
    ctx.fillStyle = color; ctx.fill();
    ctx.restore();
    roundRect(ctx, x - w / 2, y - hh / 2, w, hh, square ? 5 * k : hh / 2);
    ctx.lineWidth = 2 * k; ctx.strokeStyle = '#fff'; ctx.stroke();
    ctx.fillStyle = textOn(color); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y + 1 * k);
  };
  for (const it of items.filter(i => i.d.shape !== 'point')) { const [x, y] = P(centroid(it.d.pts)); badgeAt(x, y, it.no, it.color, true); }
  for (const it of items.filter(i => i.d.shape === 'point')) { const [x, y] = P(it.d.pts[0]); badgeAt(x, y, it.no, it.color, false); }
  ctx.restore();
  if (header) {
    const f = headH * 0.36;
    ctx.fillStyle = '#1f3a5f'; ctx.fillRect(0, 0, W, headH);
    ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    ctx.font = `700 ${f}px Sarabun, sans-serif`;
    ctx.fillText(header.title, f * 0.8, headH / 2);
    let x = W - f * 0.8;
    ctx.font = `400 ${f * 0.8}px Sarabun, sans-serif`;
    ctx.textAlign = 'right';
    for (const lg of [...header.legend].reverse()) {
      const tw = ctx.measureText(lg.label).width;
      ctx.fillStyle = '#fff'; ctx.fillText(lg.label, x, headH / 2);
      x -= tw + f * 0.5;
      ctx.beginPath(); ctx.arc(x, headH / 2, f * 0.32, 0, Math.PI * 2); ctx.fillStyle = lg.color; ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
      x -= f * 1.1;
    }
  }
  return c;
}

const canvasBlob = (c, type = 'image/png', q = 0.92) => new Promise(r => c.toBlob(r, type, q));

function legendOf(model) {
  const seen = new Map();
  for (const t of Object.values(model.project.templates)) {
    const f = fieldByRole(t, 'severity');
    (f?.options || []).forEach(o => { if (!seen.has(o.label)) seen.set(o.label, o.color); });
  }
  const list = [...seen.entries()].map(([label, color]) => ({ label, color }));
  if (model.items.some(i => !i.sev)) list.push({ label: 'ยังไม่ระบุ', color: NO_SEVERITY_COLOR });
  return list;
}

// =====================================================================================
// Export dialog
// =====================================================================================
export async function exportDialog(projectId) {
  const { project, floors } = await loadBundle(projectId);
  const saved = await db.getMeta('exportPrefs', {});
  const org = await db.getMeta('orgName', DEFAULT_ORG);
  const pref = (k, dflt) => saved[k] ?? dflt;
  const body = h(`<div>
    <div class="exp-formats">
      <label><input type="radio" name="fmt" value="word" checked><b>Word (.docx)</b><span>แปลน + รายการ + ตาราง</span></label>
      <label><input type="radio" name="fmt" value="pdf"><b>PDF</b><span>เหมือน Word และมีหน้าปก</span></label>
      <label><input type="radio" name="fmt" value="image"><b>รูปแปลน (.png)</b><span>เฉพาะแบบแปลนที่ปักแล้ว</span></label>
      <label><input type="radio" name="fmt" value="excel"><b>Excel (.xlsx)</b><span>รายการทุกจุด + สรุป</span></label>
      <label><input type="radio" name="fmt" value="pack"><b>แพ็กข้อมูล (.zip)</b><span>ส่งให้ Claude เขียนรายงาน / สำรอง / ย้ายเครื่อง</span></label>
    </div>
    <div class="exp-opts" id="optDoc">
      <div class="sec-title" style="margin-top:0">ส่วนที่ต้องการแสดง</div>
      <label class="ck"><input type="checkbox" name="cover"><span>หน้าปก “รายการความเสียหาย-ข้อบกพร่องของโครงการ …”</span></label>
      <label class="ck"><input type="checkbox" name="summary" ${pref('summary', true) ? 'checked' : ''}><span>ตารางสรุปจำนวนตามหัวข้อความเสียหาย</span></label>
      <label class="ck"><input type="checkbox" name="plans" ${pref('plans', true) ? 'checked' : ''}><span>แปลนเรียงชั้น (พร้อมตำแหน่งที่ปัก)</span></label>
      <label class="ck"><input type="checkbox" name="groups" ${pref('groups', true) ? 'checked' : ''}><span>รายการความเสียหายแยกตามหัวข้อ — หัวข้อซ้ำแสดงครั้งเดียว พร้อมรูปตัวอย่าง
        <select name="groupPhotos" class="inp" style="width:auto;display:inline-block;padding:1px 6px;margin-left:4px"><option value="1" ${pref('groupPhotos', 2) == 1 ? 'selected' : ''}>1 รูป</option><option value="2" ${pref('groupPhotos', 2) == 2 ? 'selected' : ''}>2 รูป</option></select></span></label>
      <label class="ck"><input type="checkbox" name="table" ${pref('table', true) ? 'checked' : ''}><span>ตารางตำแหน่งทุกจุด (เรียงเลขลำดับ พร้อมจำนวนรวม)</span></label>
      <label class="ck"><input type="checkbox" name="perPoint" ${pref('perPoint', false) ? 'checked' : ''}><span>แบบฟอร์มรายจุด (ทุกจุด จุดละ 1 ตาราง)
        <select name="pointPhotos" class="inp" style="width:auto;display:inline-block;padding:1px 6px;margin-left:4px">${[1, 2, 4].map(n => `<option value="${n}" ${pref('pointPhotos', 2) == n ? 'selected' : ''}>${n} รูป</option>`).join('')}</select></span></label>
      <label class="ck"><input type="checkbox" name="showUnchecked" ${pref('showUnchecked', true) ? 'checked' : ''}><span>แสดงตัวเลือกที่ไม่ได้ติ๊ก (☐) ในแบบฟอร์ม</span></label>
      <label class="fld" style="margin-top:8px"><span>ชื่อหน่วยงานผู้จัดทำ (แสดงบนปก/หัวกระดาษ)</span><input type="text" name="org" value="${esc(org)}"></label>
    </div>
    <div class="exp-opts" id="optImg" style="display:none">
      <label class="ck"><input type="checkbox" name="imgHeader" checked><span>ใส่แถบชื่อโครงการ/ชั้น และสัญลักษณ์ระดับความเสียหายด้านบนรูป</span></label>
    </div>
    <div id="optFloors">
      <div class="sec-title">ชั้น / แปลนที่ส่งออก</div>
      <div class="floor-picks">${floors.map(f => `<label class="chip on"><input type="checkbox" name="floor" value="${f.id}" checked>${esc(f.name)}</label>`).join('') || '<span class="muted">ยังไม่มีแปลน</span>'}</div>
      <label class="fld" style="margin-top:10px;max-width:260px"><span>ขนาดหมุดบนแปลน</span>
        <select name="marker" class="inp"><option value="0.75">เล็ก</option><option value="1" selected>ปานกลาง</option><option value="1.4">ใหญ่</option><option value="1.9">ใหญ่มาก</option></select></label>
    </div>
    <div id="expProg" style="display:none"><p class="muted" id="expMsg" style="margin:10px 0 0"></p><div class="progress"><div id="expBar"></div></div></div>
  </div>`);
  const sync = () => {
    const fmt = $('[name=fmt]:checked', body).value;
    $('#optDoc', body).style.display = ['word', 'pdf'].includes(fmt) ? '' : 'none';
    $('#optImg', body).style.display = fmt === 'image' ? '' : 'none';
    $('#optFloors', body).style.display = fmt === 'pack' ? 'none' : '';
    $('[name=cover]', body).checked = fmt === 'pdf' ? pref('coverPdf', true) : pref('coverWord', false);
  };
  $$('[name=fmt]', body).forEach(r => r.onchange = sync);
  $$('.floor-picks .chip', body).forEach(c => $('input', c).onchange = (e) => c.classList.toggle('on', e.target.checked));
  sync();

  modal({
    title: `ส่งออก — ${project.name}`, body, wide: true,
    actions: [
      { label: 'ยกเลิก', value: null },
      { label: 'ส่งออก', kind: 'primary', onClick: async (b) => {
        const fmt = $('[name=fmt]:checked', b).value;
        const ck = (n) => $(`[name=${n}]`, b).checked;
        const opts = {
          cover: ck('cover'), summary: ck('summary'), plans: ck('plans'), groups: ck('groups'), table: ck('table'), perPoint: ck('perPoint'),
          showUnchecked: ck('showUnchecked'), groupPhotos: +$('[name=groupPhotos]', b).value, pointPhotos: +$('[name=pointPhotos]', b).value,
          org: $('[name=org]', b).value.trim(), marker: +$('[name=marker]', b).value, imgHeader: ck('imgHeader'),
          floorIds: $$('[name=floor]:checked', b).map(x => x.value),
        };
        if (fmt !== 'pack' && !opts.floorIds.length) { toast('เลือกอย่างน้อย 1 ชั้น', 'error'); return false; }
        if (['word', 'pdf'].includes(fmt) && !(opts.cover || opts.summary || opts.plans || opts.groups || opts.table || opts.perPoint)) { toast('เลือกอย่างน้อย 1 ส่วน', 'error'); return false; }
        await db.setMeta('exportPrefs', { ...saved, ...opts, [fmt === 'pdf' ? 'coverPdf' : 'coverWord']: opts.cover });
        await db.setMeta('orgName', opts.org);
        $('#expProg', b).style.display = '';
        $$('.modal-foot button', b.parentElement).forEach(x => x.disabled = true);
        const prog = (msg, frac) => { $('#expMsg', b).textContent = msg; if (frac != null) $('#expBar', b).style.width = Math.round(frac * 100) + '%'; };
        try {
          if (fmt === 'word') await exportWord(projectId, opts, prog);
          else if (fmt === 'pdf') { await exportPdf(projectId, opts, prog); }
          else if (fmt === 'image') await exportImages(projectId, opts, prog);
          else if (fmt === 'excel') await exportExcel(projectId, opts, prog);
          else if (fmt === 'pack') await exportPack(projectId, prog);
          return true;
        } catch (e) {
          console.error(e);
          toast('ส่งออกไม่สำเร็จ: ' + e.message, 'error', 6000);
          $$('.modal-foot button', b.parentElement).forEach(x => x.disabled = false);
          $('#expProg', b).style.display = 'none';
          return false;
        }
      } },
    ],
  });
}

const fileBase = (p) => safeName(`${p.code ? p.code + ' ' : ''}${p.name}`);

// =====================================================================================
// Images
// =====================================================================================
async function exportImages(projectId, opts, prog = () => {}) {
  const model = await buildModel(projectId, opts.floorIds);
  const legend = legendOf(model);
  const outs = [];
  for (let i = 0; i < model.perFloor.length; i++) {
    const { floor, items } = model.perFloor[i];
    prog(`กำลังสร้างรูป ${floor.name}`, i / model.perFloor.length);
    const c = await planCanvas(floor, items, { maxDim: 4000, markerScale: opts.marker,
      header: opts.imgHeader ? { title: `${model.project.name} — ${floor.name} (${items.length} จุด)`, legend } : null });
    outs.push({ name: `${String(i + 1).padStart(2, '0')} ${safeName(floor.name)}.png`, blob: await canvasBlob(c) });
  }
  if (outs.length === 1) download(outs[0].blob, `${fileBase(model.project)} - ${outs[0].name}`);
  else {
    await loadScript('vendor/jszip.min.js');
    const zip = new JSZip();
    outs.forEach(o => zip.file(o.name, o.blob));
    download(await zip.generateAsync({ type: 'blob' }), `${fileBase(model.project)} - แปลน.zip`);
  }
  toast(`ส่งออกรูปแปลน ${outs.length} ชั้นแล้ว`, 'ok');
}

// =====================================================================================
// Excel
// =====================================================================================
async function exportExcel(projectId, opts, prog = () => {}) {
  prog('กำลังเตรียมข้อมูล', 0.2);
  await loadScript('vendor/xlsx.full.min.js');
  const model = await buildModel(projectId, opts.floorIds);
  const p = model.project;
  // union of field labels across both templates (same label → same column)
  const cols = [];
  for (const t of Object.keys(TYPE_LABELS)) {
    for (const f of p.templates[t].fields) if (!f.hidden && !cols.find(c => c.label === f.label)) cols.push({ label: f.label });
  }
  const rows = model.items.map(it => {
    const r = { 'ลำดับ': isNaN(+it.no) ? it.no : +it.no, 'ชั้น/แปลน': it.floor.name, 'ประเภทการตรวจ': TYPE_LABELS[it.d.type], 'ลักษณะ': SHAPE_TH[it.d.shape] };
    for (const c of cols) r[c.label] = '';
    for (const f of it.tpl.fields) if (!f.hidden) r[f.label] = fieldText(f, it.d.data?.[f.key]);
    r['พื้นที่จากแปลน (ตร.ม.)'] = it.area != null ? +it.area.toFixed(2) : '';
    r['จำนวนรูป'] = it.d.photoIds?.length || 0;
    const [x, y] = it.d.shape === 'point' ? it.d.pts[0] : centroid(it.d.pts);
    r['ตำแหน่ง X (%)'] = +(x / it.floor.w * 100).toFixed(1);
    r['ตำแหน่ง Y (%)'] = +(y / it.floor.h * 100).toFixed(1);
    return r;
  });
  const wb = XLSX.utils.book_new();
  const header = [['รายการความเสียหาย-ข้อบกพร่อง โครงการ ' + p.name], [[p.code, p.client, p.location].filter(Boolean).join(' • ')], []];
  const ws = XLSX.utils.aoa_to_sheet(header);
  XLSX.utils.sheet_add_json(ws, rows, { origin: 'A4' });
  XLSX.utils.sheet_add_aoa(ws, [[], ['รวมทั้งหมด', rows.length + ' จุด']], { origin: -1 });
  const keys = Object.keys(rows[0] || { 'ลำดับ': 1 });
  ws['!cols'] = keys.map(k => ({ wch: Math.min(48, Math.max(8, k.length + 2, ...rows.map(r => String(r[k] ?? '').split('\n')[0].length + 1))) }));
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 3, c: 0 }, e: { r: 3 + rows.length, c: keys.length - 1 } }) };
  XLSX.utils.book_append_sheet(wb, ws, 'รายการทั้งหมด');

  const g = model.groups.map(gr => ({
    'ลำดับ': gr.index, 'ประเภทการตรวจ': TYPE_LABELS[gr.type], [gr.first.elementLabel]: gr.element, 'หัวข้อความเสียหาย': gr.title,
    'ระดับสูงสุด': gr.worst.sevText, 'จำนวน': gr.items.length,
    'พื้นที่รวมจากแปลน (ตร.ม.)': gr.items.every(i => i.area != null) ? +gr.items.reduce((s, i) => s + i.area, 0).toFixed(2) : '',
    'ตำแหน่งที่พบ': positionsText(gr.items),
  }));
  const ws2 = XLSX.utils.json_to_sheet(g);
  ws2['!cols'] = [{ wch: 6 }, { wch: 16 }, { wch: 14 }, { wch: 40 }, { wch: 12 }, { wch: 8 }, { wch: 14 }, { wch: 60 }];
  XLSX.utils.book_append_sheet(wb, ws2, 'สรุปตามหัวข้อ');

  const fl = model.perFloor.map(pf => {
    const r = { 'ชั้น/แปลน': pf.floor.name, 'จำนวนจุด': pf.items.length };
    legendOf(model).forEach(lg => { r[lg.label] = pf.items.filter(i => (i.sevText || 'ยังไม่ระบุ') === lg.label).length; });
    return r;
  });
  const ws3 = XLSX.utils.json_to_sheet(fl);
  ws3['!cols'] = [{ wch: 24 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }];
  XLSX.utils.book_append_sheet(wb, ws3, 'สรุปตามชั้น');
  prog('กำลังบันทึก', 0.9);
  XLSX.writeFile(wb, `${fileBase(p)} - รายการความเสียหาย.xlsx`);
  toast('ส่งออก Excel แล้ว', 'ok');
}

// =====================================================================================
// Word
// =====================================================================================
const FONT = 'TH SarabunPSK';
const FONTS = { ascii: FONT, hAnsi: FONT, cs: FONT, eastAsia: FONT };

async function exportWord(projectId, opts, prog = () => {}) {
  prog('กำลังโหลดไลบรารี', 0.05);
  await loadScript('vendor/docx.iife.js');
  const D = window.docx;
  const model = await buildModel(projectId, opts.floorIds);
  const p = model.project;
  const PAGE_W = 11906, PAGE_H = 16838, MARGIN = 1134; // A4, 2 cm
  const CW = PAGE_W - MARGIN * 2; // content width (twips)
  const twipToPx = (t) => t / 15;

  const run = (text, o = {}) => new D.TextRun({ text, font: o.symbol ? 'Segoe UI Symbol' : FONTS, size: o.size || 28, sizeComplexScript: o.size || 28, bold: o.bold, boldComplexScript: o.bold, color: o.color, underline: o.underline ? {} : undefined, break: o.break });
  const para = (children, o = {}) => new D.Paragraph({ children: Array.isArray(children) ? children : [typeof children === 'string' ? run(children, o) : children],
    alignment: o.align, spacing: { before: o.before ?? 0, after: o.after ?? 0, line: o.line }, heading: o.heading, pageBreakBefore: o.pageBreak, keepNext: o.keepNext, indent: o.indent });
  const border = { style: D.BorderStyle.SINGLE, size: 4, color: '000000' };
  const borders = { top: border, bottom: border, left: border, right: border };
  const cell = (children, o = {}) => new D.TableCell({
    children: Array.isArray(children) ? children : [para(children, { size: o.size, bold: o.bold, align: o.align, color: o.color })],
    columnSpan: o.span, borders, verticalAlign: D.VerticalAlign.CENTER,
    shading: o.fill ? { fill: o.fill, type: D.ShadingType.CLEAR, color: 'auto' } : undefined,
    margins: { top: 40, bottom: 40, left: 90, right: 90 }, width: o.w ? { size: o.w, type: D.WidthType.DXA } : undefined,
  });
  const table = (rows, widths) => new D.Table({ rows, columnWidths: widths, width: { size: widths.reduce((a, b) => a + b, 0), type: D.WidthType.DXA }, layout: D.TableLayoutType.FIXED });
  const H1 = (t, pageBreak = true) => para([run(t, { size: 36, bold: true, color: '1F3A5F' })], { heading: D.HeadingLevel.HEADING_1, pageBreak, after: 160, keepNext: true });
  const H2 = (t) => para([run(t, { size: 30, bold: true })], { heading: D.HeadingLevel.HEADING_2, before: 200, after: 100, keepNext: true });

  const imgRun = async (blobOrCanvas, maxWpx, maxHpx, isCanvas) => {
    let blob, w, hh;
    if (isCanvas) { blob = await canvasBlob(blobOrCanvas, 'image/png'); w = blobOrCanvas.width; hh = blobOrCanvas.height; }
    else {
      blob = blobOrCanvas;
      const u = URL.createObjectURL(blob); const im = await loadImage(u); URL.revokeObjectURL(u);
      w = im.naturalWidth; hh = im.naturalHeight;
    }
    const s = Math.min(maxWpx / w, maxHpx / hh);
    return new D.ImageRun({ type: blob.type === 'image/png' ? 'png' : 'jpg', data: new Uint8Array(await blob.arrayBuffer()), transformation: { width: Math.round(w * s), height: Math.round(hh * s) } });
  };

  const legend = legendOf(model);
  const legendPara = () => para([run('สัญลักษณ์: ', { bold: true, size: 26 }), ...legend.flatMap(l => [run('●', { color: l.color.replace('#', ''), size: 30 }), run(` ${l.label}    `, { size: 26 })]),
    run('(วงกลม = จุด, สี่เหลี่ยม = พื้นที่)', { size: 24, color: '666666' })], { after: 120 });

  // ---------- card table ----------
  const W6 = [1500, 1100, 1250, 1700, 2300, CW - 1500 - 1100 - 1250 - 1700 - 2300];
  const cardTable = async (cm) => {
    const rows = [];
    const lbl = (t) => cell(t, { fill: HEAD_FILL, span: 2, align: D.AlignmentType.CENTER, size: 28 });
    rows.push(new D.TableRow({ cantSplit: true, children: [
      cell('ลำดับที่', { fill: HEAD_FILL, align: D.AlignmentType.CENTER }), cell(cm.no, { align: D.AlignmentType.CENTER }),
      cell(cm.elementLabel, { fill: HEAD_FILL, align: D.AlignmentType.CENTER }), cell(cm.element, { align: D.AlignmentType.CENTER }),
      cell(cm.sevLabel, { fill: HEAD_FILL, align: D.AlignmentType.CENTER }),
      cell(cm.sevText, { align: D.AlignmentType.CENTER, fill: cm.sevColor ? cm.sevColor.replace('#', '') : undefined, color: cm.sevColor ? textOn(cm.sevColor).replace('#', '') : undefined }),
    ] }));
    const textRow = (label, value) => new D.TableRow({ cantSplit: true, children: [lbl(label), cell(String(value).split('\n').map(l => para(l)), { span: 4 })] });
    const boxesRow = (r) => {
      const per = r.options.length <= 2 ? 2 : 3;
      const lines = [];
      for (let i = 0; i < r.options.length; i += per) {
        lines.push(para(r.options.slice(i, i + per).flatMap((o, j) => [run(r.checked.has(o) ? '☑ ' : '☐ ', { size: 26, symbol: true }), run(o + (j < per - 1 ? '      ' : ''))])));
      }
      return new D.TableRow({ cantSplit: true, children: [lbl(r.label), cell(lines, { span: 4 })] });
    };
    rows.push(textRow(cm.titleLabel, cm.title));
    for (const r of cm.before) rows.push(r.kind === 'boxes' ? boxesRow(r) : textRow(r.label, r.value));
    if (cm.photos.length) {
      const runs = [];
      const n = cm.photos.length;
      const maxW = n === 1 ? 380 : n === 2 ? 290 : 200;
      for (let i = 0; i < n; i++) {
        const b = await db.getBlob(cm.photos[i]);
        if (!b) continue;
        runs.push(await imgRun(b, maxW, 230));
        if (i < n - 1) runs.push(run('   '));
      }
      rows.push(new D.TableRow({ cantSplit: true, children: [cell([para([run('ภาพประกอบ', { underline: true })], { after: 60 }), para(runs, { align: D.AlignmentType.CENTER, after: 60 })], { span: 6 })] }));
    } else {
      rows.push(new D.TableRow({ cantSplit: true, children: [cell([para([run('ภาพประกอบ', { underline: true }), run('  — ไม่มีรูปประกอบ', { color: '888888' })])], { span: 6 })] }));
    }
    for (const r of cm.after) {
      if (r.kind === 'list') {
        rows.push(new D.TableRow({ cantSplit: true, children: [cell([para([run(r.label, { underline: true })], { align: D.AlignmentType.CENTER })], { span: 6, fill: HEAD_FILL })] }));
        rows.push(new D.TableRow({ children: [cell(r.items.map((t, i) => para([run(`${i + 1}.  ${t}`)], { indent: { left: 360, hanging: 360 } })), { span: 6 })] }));
      } else rows.push(new D.TableRow({ cantSplit: true, children: [cell([para([run(r.label + ': ', { underline: true }), run(r.value)])], { span: 6 })] }));
    }
    rows.push(textRow('ตำแหน่งและขอบเขต', cm.position));
    return table(rows, W6);
  };

  // ---------- sections ----------
  const portrait = (children, first = false) => ({
    properties: { titlePage: !!(first && opts.cover), page: { size: { width: PAGE_W, height: PAGE_H }, margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN } } },
    headers: { default: new D.Header({ children: [para([run(`${opts.org ? opts.org + '  |  ' : ''}รายการความเสียหาย-ข้อบกพร่อง โครงการ ${p.name}`, { size: 22, color: '666666' })], { align: D.AlignmentType.RIGHT })] }) },
    footers: { default: new D.Footer({ children: [new D.Paragraph({ alignment: D.AlignmentType.RIGHT, children: [new D.TextRun({ children: ['หน้า ', D.PageNumber.CURRENT], font: FONTS, size: 24, sizeComplexScript: 24, color: '666666' })] })] }) },
    children,
  });
  const sections = [];
  let body = [];
  const flush = () => { if (body.length) { sections.push(portrait(body, !sections.length)); body = []; } };

  if (opts.cover) {
    body.push(para('', { after: 2000 }));
    body.push(para([run('รายการความเสียหาย-ข้อบกพร่อง', { size: 52, bold: true, color: '1F3A5F' })], { align: D.AlignmentType.CENTER, after: 200 }));
    body.push(para([run('ของโครงการ', { size: 36 })], { align: D.AlignmentType.CENTER, after: 120 }));
    body.push(para([run(p.name, { size: 44, bold: true })], { align: D.AlignmentType.CENTER, after: 400 }));
    if (p.coverBlobId) { const cb = await db.getBlob(p.coverBlobId); if (cb) body.push(para([await imgRun(cb, 460, 300)], { align: D.AlignmentType.CENTER, after: 400 })); }
    const info = [['รหัสงาน', p.code], ['ผู้ว่าจ้าง', p.client], ['สถานที่ตั้ง', p.location], ['ผู้ตรวจสอบ', p.inspector], ['วันที่ตรวจสอบ', thaiDateLong(p.inspectDate)], ['จำนวนตำแหน่งที่พบ', `${model.items.length} ตำแหน่ง`]].filter(r => r[1]);
    info.forEach(([k, v]) => body.push(para([run(k + ' : ', { bold: true, size: 32 }), run(v, { size: 32 })], { align: D.AlignmentType.CENTER, after: 60 })));
    if (opts.org) body.push(para([run(opts.org, { size: 32, bold: true, color: '1F3A5F' })], { align: D.AlignmentType.CENTER, before: 1200 }));
  }
  let firstHeading = !opts.cover;

  if (opts.summary) {
    body.push(H1('สรุปจำนวนความเสียหาย-ข้อบกพร่อง', !firstHeading)); firstHeading = false;
    const Ws = [700, 1500, 3000, 1500, 900, CW - 700 - 1500 - 3000 - 1500 - 900];
    const rows = [new D.TableRow({ tableHeader: true, children: ['ลำดับ', 'โครงสร้าง/หมวด', 'หัวข้อความเสียหาย', 'ระดับสูงสุด', 'จำนวน', 'ตำแหน่งที่พบ'].map(t => cell(t, { fill: HEAD_FILL, bold: true, align: D.AlignmentType.CENTER })) })];
    model.groups.forEach(g => rows.push(new D.TableRow({ cantSplit: true, children: [
      cell(String(g.index), { align: D.AlignmentType.CENTER }), cell(g.element || '-'), cell(g.title),
      cell(g.worst.sevText || '-', { align: D.AlignmentType.CENTER, fill: g.worst.sev ? g.worst.color.replace('#', '') : undefined, color: g.worst.sev ? textOn(g.worst.color).replace('#', '') : undefined }),
      cell(String(g.items.length), { align: D.AlignmentType.CENTER }), cell(g.items.map(i => i.no).join(', '), { size: 26 }),
    ] })));
    rows.push(new D.TableRow({ children: [cell('รวมทั้งหมด', { span: 4, bold: true, align: D.AlignmentType.RIGHT, fill: 'F2F2F2' }), cell(String(model.items.length), { bold: true, align: D.AlignmentType.CENTER, fill: 'F2F2F2' }), cell('ตำแหน่ง', { fill: 'F2F2F2' })] }));
    body.push(table(rows, Ws));
  }

  if (opts.plans) {
    for (let i = 0; i < model.perFloor.length; i++) {
      const { floor, items } = model.perFloor[i];
      prog(`กำลังสร้างแปลน ${floor.name}`, 0.1 + 0.4 * i / model.perFloor.length);
      const c = await planCanvas(floor, items, { maxDim: 3000, markerScale: opts.marker });
      const land = floor.w / floor.h > 1.15;
      const head = para([run(`แปลน${/^(ชั้น|แปลน)/.test(floor.name) ? '' : ' '}${floor.name.replace(/^แปลน\s*/, '')}`, { size: 34, bold: true, color: '1F3A5F' }), run(`   (${items.length} ตำแหน่ง)`, { size: 28, color: '666666' })],
        { heading: D.HeadingLevel.HEADING_2, after: 120, keepNext: true, pageBreak: !land && (body.length > 0) });
      if (land) {
        flush();
        const lw = PAGE_H - MARGIN * 2, lh = PAGE_W - MARGIN * 2;
        sections.push({ ...portrait([head, para([await imgRun(c, twipToPx(lw), twipToPx(lh) - 110, true)], { align: D.AlignmentType.CENTER, after: 80 }), legendPara()]),
          properties: { page: { size: { width: PAGE_W, height: PAGE_H, orientation: D.PageOrientation.LANDSCAPE }, margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN } } } });
      } else {
        body.push(head, para([await imgRun(c, twipToPx(CW), twipToPx(PAGE_H - MARGIN * 2) - 130, true)], { align: D.AlignmentType.CENTER, after: 80 }), legendPara());
      }
    }
  }

  if (opts.groups) {
    flush();
    body.push(H1('รายการความเสียหาย-ข้อบกพร่องแยกตามหัวข้อ', false));
    body.push(para([run(`พบความเสียหาย-ข้อบกพร่องทั้งหมด ${model.items.length} ตำแหน่ง จำแนกได้ ${model.groups.length} หัวข้อ ดังนี้ (หัวข้อที่พบซ้ำหลายตำแหน่งแสดงรูปตัวอย่าง ${opts.groupPhotos} รูป และระบุตำแหน่งที่พบทั้งหมดไว้ท้ายตาราง)`)], { after: 160 }));
    for (let i = 0; i < model.groups.length; i++) {
      prog(`กำลังสร้างรายการ ${i + 1}/${model.groups.length}`, 0.5 + 0.25 * i / model.groups.length);
      const g = model.groups[i];
      const entries = Object.assign([...g.items], { groupIndex: g.index });
      body.push(await cardTable(cardModel(entries, { grouped: true, showUnchecked: opts.showUnchecked, maxPhotos: opts.groupPhotos })));
      body.push(para('', { after: 200 }));
    }
  }

  if (opts.table) {
    flush();
    body.push(H1('ตารางตำแหน่งความเสียหาย-ข้อบกพร่องทั้งหมด', false));
    const Wt = [650, 1300, 1300, 3000, 1450, CW - 650 - 1300 - 1300 - 3000 - 1450];
    const rows = [new D.TableRow({ tableHeader: true, children: ['ลำดับ', 'ชั้น/แปลน', 'โครงสร้าง/หมวด', 'หัวข้อความเสียหาย', 'ระดับ/เร่งด่วน', 'ขนาด/ตำแหน่ง'].map(t => cell(t, { fill: HEAD_FILL, bold: true, align: D.AlignmentType.CENTER, size: 26 })) })];
    for (const it of model.items) {
      const sz = [it.size || (it.area != null ? it.area.toFixed(2) + ' ตร.ม.' : ''), it.d.data?.grid].filter(Boolean).join(' / ');
      rows.push(new D.TableRow({ cantSplit: true, children: [
        cell(it.no, { align: D.AlignmentType.CENTER, size: 26 }), cell(it.floor.name, { size: 26 }), cell(it.element || '-', { size: 26 }), cell(it.title, { size: 26 }),
        cell([it.sevText, it.urgText].filter(Boolean).join('/') || '-', { size: 26, align: D.AlignmentType.CENTER, fill: it.sev ? it.color.replace('#', '') : undefined, color: it.sev ? textOn(it.color).replace('#', '') : undefined }),
        cell(sz || '-', { size: 26 }),
      ] }));
    }
    rows.push(new D.TableRow({ children: [cell(`รวมทั้งหมด ${model.items.length} ตำแหน่ง`, { span: 6, bold: true, align: D.AlignmentType.CENTER, fill: 'F2F2F2' })] }));
    body.push(table(rows, Wt));
    // per-floor count
    body.push(H2('จำนวนตำแหน่งแยกตามชั้น'));
    const Wf = [CW - 1800 * 1, 1800];
    const fr = [new D.TableRow({ tableHeader: true, children: ['ชั้น/แปลน', 'จำนวน (ตำแหน่ง)'].map(t => cell(t, { fill: HEAD_FILL, bold: true, align: D.AlignmentType.CENTER })) })];
    model.perFloor.forEach(pf => fr.push(new D.TableRow({ children: [cell(pf.floor.name), cell(String(pf.items.length), { align: D.AlignmentType.CENTER })] })));
    fr.push(new D.TableRow({ children: [cell('รวม', { bold: true, align: D.AlignmentType.RIGHT, fill: 'F2F2F2' }), cell(String(model.items.length), { bold: true, align: D.AlignmentType.CENTER, fill: 'F2F2F2' })] }));
    body.push(table(fr, Wf));
  }

  if (opts.perPoint) {
    flush();
    body.push(H1('แบบฟอร์มความเสียหายรายตำแหน่ง', false));
    for (let i = 0; i < model.items.length; i++) {
      prog(`กำลังสร้างแบบฟอร์มรายจุด ${i + 1}/${model.items.length}`, 0.75 + 0.2 * i / model.items.length);
      body.push(await cardTable(cardModel([model.items[i]], { grouped: false, showUnchecked: opts.showUnchecked, maxPhotos: opts.pointPhotos })));
      body.push(para('', { after: 200 }));
    }
  }
  flush();

  prog('กำลังรวมไฟล์ Word', 0.97);
  const doc = new D.Document({
    creator: opts.org || 'Defect Mapper', title: `รายการความเสียหาย-ข้อบกพร่อง ${p.name}`,
    styles: {
      default: { document: { run: { font: FONTS, size: 28, sizeComplexScript: 28 } } },
      paragraphStyles: [
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: FONTS, size: 36, sizeComplexScript: 36, bold: true, boldComplexScript: true, color: '1F3A5F' } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: FONTS, size: 32, sizeComplexScript: 32, bold: true, boldComplexScript: true } },
      ],
    },
    sections,
  });
  const blob = await D.Packer.toBlob(doc);
  download(blob, `${fileBase(p)} - รายการความเสียหาย.docx`);
  toast('ส่งออก Word แล้ว', 'ok');
}

// =====================================================================================
// PDF (paged HTML → preview → html2canvas/jsPDF or browser print)
// =====================================================================================
const PW = 794, PH = 1123, PAD = 56; // A4 @96dpi

function rpCss() {
  return `
  .rp-page{width:${PW}px;height:${PH}px;background:#fff;margin:0 auto 18px;position:relative;box-shadow:0 2px 10px rgba(0,0,0,.35);overflow:hidden;font-family:Sarabun,sans-serif;color:#000;font-size:13.5px;line-height:1.45}
  .rp-page.land{width:${PH}px;height:${PW}px}
  .rp-body{position:absolute;left:${PAD}px;right:${PAD}px;top:${PAD + 10}px;bottom:${PAD + 6}px;overflow:hidden}
  .rp-head{position:absolute;left:${PAD}px;right:${PAD}px;top:22px;font-size:11px;color:#666;text-align:right;border-bottom:1px solid #ccc;padding-bottom:3px}
  .rp-foot{position:absolute;left:${PAD}px;right:${PAD}px;bottom:20px;font-size:11px;color:#666;text-align:right}
  .rp-page h1{font-size:21px;color:#1f3a5f;margin:0 0 10px}
  .rp-page h2{font-size:17px;color:#1f3a5f;margin:0 0 8px}
  .rp-page p{margin:0 0 8px}
  .rp-t{width:100%;border-collapse:collapse;table-layout:fixed;margin-bottom:14px}
  .rp-t td,.rp-t th{border:1px solid #000;padding:3px 6px;vertical-align:middle;word-wrap:break-word}
  .rp-t th,.rp-t td.hd{background:#${HEAD_FILL};font-weight:400;text-align:center}
  .rp-t th{font-weight:700}
  .rp-t .c{text-align:center}
  .rp-t .tot td{background:#f2f2f2;font-weight:700}
  .rp-photos{display:flex;gap:10px;justify-content:center;padding:4px 0 6px}
  .rp-photos img{max-height:215px;max-width:100%;object-fit:contain}
  .rp-u{text-decoration:underline}
  .rp-box{display:inline-block;margin-right:16px;white-space:nowrap}
  .rp-legend{font-size:12px;margin-top:6px}.rp-legend i{display:inline-block;width:11px;height:11px;border-radius:50%;margin:0 4px -1px 10px;border:1px solid rgba(0,0,0,.3)}
  .rp-plan{text-align:center}.rp-plan img{max-width:100%;border:1px solid #bbb}
  .rp-cover{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;text-align:center;padding:120px 70px 70px;border-top:14px solid var(--acc)}
  .rp-cover .t1{font-size:32px;font-weight:700;color:#1f3a5f}.rp-cover .t2{font-size:20px;margin:8px 0}.rp-cover .t3{font-size:26px;font-weight:700;margin-bottom:28px}
  .rp-cover img{max-width:520px;max-height:330px;border-radius:6px;margin-bottom:28px;object-fit:cover}
  .rp-cover .info{font-size:16px;line-height:1.9}.rp-cover .org{margin-top:auto;font-size:17px;font-weight:700;color:#1f3a5f}
  @page{size:A4;margin:0}
  @media print{.rp-page{box-shadow:none;margin:0;page-break-after:always;break-after:page}.rp-page.land{page:land}@page land{size:A4 landscape}}
  `;
}

async function photoUrl(id, cache) {
  if (cache[id]) return cache[id];
  const b = await db.getBlob(id);
  cache[id] = b ? URL.createObjectURL(b) : '';
  return cache[id];
}

async function cardHtml(cm, urls) {
  const sevStyle = cm.sevColor ? `background:${cm.sevColor};color:${textOn(cm.sevColor)}` : '';
  const rows = [];
  rows.push(`<tr><td class="hd">ลำดับที่</td><td class="c">${esc(cm.no)}</td><td class="hd">${esc(cm.elementLabel)}</td><td class="c">${esc(cm.element)}</td><td class="hd">${esc(cm.sevLabel)}</td><td class="c" style="${sevStyle}">${esc(cm.sevText)}</td></tr>`);
  const tr = (l, v) => `<tr><td class="hd" colspan="2">${esc(l)}</td><td colspan="4">${esc(v).replace(/\n/g, '<br>')}</td></tr>`;
  rows.push(tr(cm.titleLabel, cm.title));
  for (const r of cm.before) {
    if (r.kind === 'boxes') rows.push(`<tr><td class="hd" colspan="2">${esc(r.label)}</td><td colspan="4">${r.options.map(o => `<span class="rp-box">${r.checked.has(o) ? '☑' : '☐'} ${esc(o)}</span>`).join('')}</td></tr>`);
    else rows.push(tr(r.label, r.value));
  }
  const imgs = [];
  for (const id of cm.photos) { const u = await photoUrl(id, urls); if (u) imgs.push(`<img src="${u}" style="max-width:${cm.photos.length === 1 ? 70 : 48}%">`); }
  rows.push(`<tr><td colspan="6"><div class="rp-u">ภาพประกอบ</div>${imgs.length ? `<div class="rp-photos">${imgs.join('')}</div>` : '<span style="color:#888">ไม่มีรูปประกอบ</span>'}</td></tr>`);
  for (const r of cm.after) {
    if (r.kind === 'list') rows.push(`<tr><td colspan="6" class="hd"><span class="rp-u">${esc(r.label)}</span></td></tr><tr><td colspan="6"><ol style="margin:2px 0 2px 4px;padding-left:22px">${r.items.map(t => `<li>${esc(t)}</li>`).join('')}</ol></td></tr>`);
    else rows.push(`<tr><td colspan="6"><span class="rp-u">${esc(r.label)}:</span> ${esc(r.value).replace(/\n/g, '<br>')}</td></tr>`);
  }
  rows.push(tr('ตำแหน่งและขอบเขต', cm.position));
  return `<table class="rp-t"><colgroup><col style="width:13%"><col style="width:9%"><col style="width:13%"><col style="width:20%"><col style="width:24%"><col style="width:21%"></colgroup>${rows.join('')}</table>`;
}

async function buildPdfBlocks(model, opts, urls, prog) {
  const p = model.project;
  const blocks = []; // {html, page:'new'|'land'|'cover', split?:true}
  const legend = legendOf(model);
  const legendHtml = `<div class="rp-legend"><b>สัญลักษณ์:</b>${legend.map(l => `<i style="background:${l.color}"></i>${esc(l.label)}`).join('')} <span style="color:#666;margin-left:10px">(วงกลม = จุด, สี่เหลี่ยม = พื้นที่)</span></div>`;
  if (opts.cover) {
    const cov = p.coverBlobId ? await photoUrl(p.coverBlobId, urls) : '';
    const info = [['รหัสงาน', p.code], ['ผู้ว่าจ้าง', p.client], ['สถานที่ตั้ง', p.location], ['ผู้ตรวจสอบ', p.inspector], ['วันที่ตรวจสอบ', thaiDateLong(p.inspectDate)], ['จำนวนตำแหน่งที่พบ', `${model.items.length} ตำแหน่ง`]].filter(r => r[1]);
    blocks.push({ page: 'cover', html: `<div class="rp-cover" style="--acc:${esc(p.accent)}"><div class="t1">รายการความเสียหาย-ข้อบกพร่อง</div><div class="t2">ของโครงการ</div><div class="t3">${esc(p.name)}</div>
      ${cov ? `<img src="${cov}">` : ''}<div class="info">${info.map(([k, v]) => `<b>${esc(k)} :</b> ${esc(v)}`).join('<br>')}</div>${opts.org ? `<div class="org">${esc(opts.org)}</div>` : ''}</div>` });
  }
  if (opts.summary) {
    blocks.push({ page: 'new', html: `<h1>สรุปจำนวนความเสียหาย-ข้อบกพร่อง</h1>` });
    blocks.push({ split: true, html: `<table class="rp-t"><colgroup><col style="width:7%"><col style="width:15%"><col style="width:33%"><col style="width:14%"><col style="width:9%"><col style="width:22%"></colgroup>
      <thead><tr><th>ลำดับ</th><th>โครงสร้าง/หมวด</th><th>หัวข้อความเสียหาย</th><th>ระดับสูงสุด</th><th>จำนวน</th><th>ตำแหน่งที่พบ</th></tr></thead><tbody>
      ${model.groups.map(g => `<tr><td class="c">${g.index}</td><td>${esc(g.element || '-')}</td><td>${esc(g.title)}</td><td class="c" style="${g.worst.sev ? `background:${g.worst.color};color:${textOn(g.worst.color)}` : ''}">${esc(g.worst.sevText || '-')}</td><td class="c">${g.items.length}</td><td style="font-size:12px">${esc(g.items.map(i => i.no).join(', '))}</td></tr>`).join('')}
      <tr class="tot"><td colspan="4" style="text-align:right">รวมทั้งหมด</td><td class="c">${model.items.length}</td><td>ตำแหน่ง</td></tr></tbody></table>` });
  }
  if (opts.plans) {
    for (let i = 0; i < model.perFloor.length; i++) {
      const { floor, items } = model.perFloor[i];
      prog(`กำลังสร้างแปลน ${floor.name}`, 0.1 + 0.35 * i / model.perFloor.length);
      const c = await planCanvas(floor, items, { maxDim: 2600, markerScale: opts.marker });
      const u = URL.createObjectURL(await canvasBlob(c, 'image/jpeg', 0.9));
      urls['plan_' + floor.id] = u;
      const land = floor.w / floor.h > 1.15;
      const maxH = (land ? PW : PH) - PAD * 2 - 16 - 70;
      blocks.push({ page: land ? 'land' : 'new', html: `<h2>แปลน${/^(ชั้น|แปลน)/.test(floor.name) ? '' : ' '}${esc(floor.name.replace(/^แปลน\s*/, ''))} <span style="font-weight:400;color:#666;font-size:14px">(${items.length} ตำแหน่ง)</span></h2>
        <div class="rp-plan"><img src="${u}" style="max-height:${maxH}px"></div>${legendHtml}` });
    }
  }
  if (opts.groups) {
    blocks.push({ page: 'new', html: `<h1>รายการความเสียหาย-ข้อบกพร่องแยกตามหัวข้อ</h1><p>พบความเสียหาย-ข้อบกพร่องทั้งหมด ${model.items.length} ตำแหน่ง จำแนกได้ ${model.groups.length} หัวข้อ ดังนี้</p>` });
    for (let i = 0; i < model.groups.length; i++) {
      prog(`กำลังสร้างรายการ ${i + 1}/${model.groups.length}`, 0.45 + 0.2 * i / model.groups.length);
      const g = model.groups[i];
      blocks.push({ html: await cardHtml(cardModel(Object.assign([...g.items], { groupIndex: g.index }), { grouped: true, showUnchecked: opts.showUnchecked, maxPhotos: opts.groupPhotos }), urls) });
    }
  }
  if (opts.table) {
    blocks.push({ page: 'new', html: `<h1>ตารางตำแหน่งความเสียหาย-ข้อบกพร่องทั้งหมด</h1>` });
    blocks.push({ split: true, html: `<table class="rp-t" style="font-size:12.5px"><colgroup><col style="width:7%"><col style="width:14%"><col style="width:14%"><col style="width:32%"><col style="width:15%"><col style="width:18%"></colgroup>
      <thead><tr><th>ลำดับ</th><th>ชั้น/แปลน</th><th>โครงสร้าง/หมวด</th><th>หัวข้อความเสียหาย</th><th>ระดับ/เร่งด่วน</th><th>ขนาด/ตำแหน่ง</th></tr></thead><tbody>
      ${model.items.map(it => `<tr><td class="c">${esc(it.no)}</td><td>${esc(it.floor.name)}</td><td>${esc(it.element || '-')}</td><td>${esc(it.title)}</td>
        <td class="c" style="${it.sev ? `background:${it.color};color:${textOn(it.color)}` : ''}">${esc([it.sevText, it.urgText].filter(Boolean).join('/') || '-')}</td>
        <td>${esc([it.size || (it.area != null ? it.area.toFixed(2) + ' ตร.ม.' : ''), it.d.data?.grid].filter(Boolean).join(' / ') || '-')}</td></tr>`).join('')}
      <tr class="tot"><td colspan="6" class="c">รวมทั้งหมด ${model.items.length} ตำแหน่ง</td></tr></tbody></table>` });
    blocks.push({ html: `<h2 style="margin-top:6px">จำนวนตำแหน่งแยกตามชั้น</h2><table class="rp-t" style="width:60%"><thead><tr><th>ชั้น/แปลน</th><th style="width:35%">จำนวน (ตำแหน่ง)</th></tr></thead><tbody>
      ${model.perFloor.map(pf => `<tr><td>${esc(pf.floor.name)}</td><td class="c">${pf.items.length}</td></tr>`).join('')}<tr class="tot"><td style="text-align:right">รวม</td><td class="c">${model.items.length}</td></tr></tbody></table>` });
  }
  if (opts.perPoint) {
    blocks.push({ page: 'new', html: `<h1>แบบฟอร์มความเสียหายรายตำแหน่ง</h1>` });
    for (let i = 0; i < model.items.length; i++) {
      prog(`กำลังสร้างแบบฟอร์มรายจุด ${i + 1}/${model.items.length}`, 0.65 + 0.2 * i / model.items.length);
      blocks.push({ html: await cardHtml(cardModel([model.items[i]], { grouped: false, showUnchecked: opts.showUnchecked, maxPhotos: opts.pointPhotos }), urls) });
    }
  }
  return blocks;
}

async function waitImages(root) {
  await Promise.all($$('img', root).map(im => im.complete ? 0 : new Promise(r => { im.onload = im.onerror = r; })));
}

async function paginate(blocks, host, headText) {
  const pages = [];
  let body = null;
  const newPage = (kind) => {
    const pg = h(`<div class="rp-page ${kind === 'land' ? 'land' : ''}">${kind === 'cover' ? '' : `<div class="rp-head">${esc(headText)}</div>`}<div class="rp-body"></div><div class="rp-foot"></div></div>`);
    host.appendChild(pg); pages.push(pg);
    body = $('.rp-body', pg);
    if (kind === 'cover') { body.style.inset = '0'; body.style.left = body.style.right = body.style.top = body.style.bottom = '0'; }
    return pg;
  };
  const over = () => body.scrollHeight > body.clientHeight + 1;
  let curKind = null;
  for (const b of blocks) {
    if (b.page === 'cover') { newPage('cover'); body.innerHTML = b.html; await waitImages(body); body = null; curKind = 'cover'; continue; }
    const want = b.page === 'land' ? 'land' : 'port';
    if (!body || curKind !== want || ((b.page === 'new' || b.page === 'land') && body.childNodes.length)) { newPage(want); curKind = want; }
    const el = h(`<div>${b.html}</div>`);
    body.appendChild(el);
    await waitImages(el);
    if (!over()) continue;
    if (b.split) {
      // split table rows across pages, repeating the header
      const src = $('table', el);
      const rows = $$('tbody > tr', src);
      el.remove();
      const mk = () => { const t = src.cloneNode(true); $('tbody', t).innerHTML = ''; const w = h('<div></div>'); w.appendChild(t); body.appendChild(w); return $('tbody', t); };
      let tb = mk();
      for (const r of rows) {
        tb.appendChild(r);
        if (over() && tb.children.length > 1) { r.remove(); newPage('port'); curKind = 'port'; tb = mk(); tb.appendChild(r); }
      }
    } else if (body.childNodes.length > 1) {
      el.remove(); newPage(curKind === 'land' ? 'land' : 'port'); body.appendChild(el);
    }
  }
  pages.forEach((pg, i) => { const f = $('.rp-foot', pg); if (f && !pg.querySelector('.rp-cover')) f.textContent = `หน้า ${i + 1} / ${pages.length}`; });
  return pages;
}

async function exportPdf(projectId, opts, prog = () => {}) {
  await ensureFonts();
  const model = await buildModel(projectId, opts.floorIds);
  const p = model.project;
  const urls = {};
  const blocks = await buildPdfBlocks(model, opts, urls, prog);
  prog('กำลังจัดหน้า', 0.88);
  const view = h(`<div class="report-view"><style>${rpCss()}</style>
    <div class="report-bar"><div class="t"><b>ตัวอย่าง PDF</b> — ${esc(p.name)} <span id="rpCount" style="opacity:.7"></span></div>
      <button class="btn sm" id="rpPrint" title="ข้อความคมชัด เลือก “บันทึกเป็น PDF” ในหน้าต่างพิมพ์">🖨 พิมพ์ / บันทึก PDF (ข้อความคมชัด)</button>
      <button class="btn sm primary" id="rpDl">⤓ ดาวน์โหลดไฟล์ PDF</button>
      <button class="btn sm" id="rpClose">ปิด</button></div>
    <div class="report-pages" id="rpPages"></div></div>`);
  document.body.appendChild(view);
  const pages = await paginate(blocks, $('#rpPages', view), `${opts.org ? opts.org + '  |  ' : ''}รายการความเสียหาย-ข้อบกพร่อง โครงการ ${p.name}`);
  $('#rpCount', view).textContent = `(${pages.length} หน้า)`;
  const close = () => { view.remove(); Object.values(urls).forEach(u => u && URL.revokeObjectURL(u)); };
  $('#rpClose', view).onclick = close;
  $('#rpPrint', view).onclick = () => window.print();
  $('#rpDl', view).onclick = async (e) => {
    const btn = e.currentTarget; btn.disabled = true;
    try {
      await loadScript('vendor/html2canvas.min.js');
      await loadScript('vendor/jspdf.umd.min.js');
      const { jsPDF } = window.jspdf;
      let pdf = null;
      for (let i = 0; i < pages.length; i++) {
        btn.textContent = `กำลังสร้าง ${i + 1}/${pages.length}…`;
        const pg = pages[i];
        const land = pg.classList.contains('land');
        const shadow = pg.style.boxShadow; pg.style.boxShadow = 'none';
        const c = await html2canvas(pg, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false });
        pg.style.boxShadow = shadow;
        const orient = land ? 'landscape' : 'portrait';
        if (!pdf) pdf = new jsPDF({ orientation: orient, unit: 'mm', format: 'a4', compress: true });
        else pdf.addPage('a4', orient);
        pdf.addImage(c.toDataURL('image/jpeg', 0.9), 'JPEG', 0, 0, land ? 297 : 210, land ? 210 : 297, undefined, 'FAST');
      }
      pdf.setProperties({ title: `รายการความเสียหาย-ข้อบกพร่อง ${p.name}` });
      download(pdf.output('blob'), `${fileBase(p)} - รายการความเสียหาย.pdf`);
      toast('ดาวน์โหลด PDF แล้ว', 'ok');
    } catch (err) { console.error(err); toast('สร้าง PDF ไม่สำเร็จ: ' + err.message, 'error', 6000); }
    btn.disabled = false; btn.textContent = '⤓ ดาวน์โหลดไฟล์ PDF';
  };
  return pages.length;
}

// =====================================================================================
// Data pack (.zip) — for Claude report writing, backup and moving between devices
// =====================================================================================
const PACK_FORMAT = 'defect-mapper-pack';

export async function exportPack(projectId, prog = () => {}) {
  const busy = toastBusy('กำลังสร้างแพ็กข้อมูล…');
  try {
    await loadScript('vendor/jszip.min.js');
    const model = await buildModel(projectId);
    const { project: p, floors } = model;
    const { defects } = await loadBundle(projectId);
    const zip = new JSZip();
    const ext = (b) => (b?.type === 'image/png' ? 'png' : 'jpg');
    const safeNo = (no) => String(no).replace(/[^\w฀-๿-]+/g, '_');

    // raw data for re-import
    const blobsMap = {};
    const addBlob = async (id, path) => { const b = await db.getBlob(id); if (b) { zip.file(path, b); blobsMap[id] = path; } };
    if (p.coverBlobId) await addBlob(p.coverBlobId, `cover.${ext(await db.getBlob(p.coverBlobId))}`);
    for (let i = 0; i < floors.length; i++) {
      const f = floors[i];
      prog(`แปลน ${f.name}`, i / floors.length * 0.5);
      await addBlob(f.blobId, `plans/original/${String(i + 1).padStart(2, '0')}_${safeName(f.name)}.${ext(await db.getBlob(f.blobId))}`);
      const c = await planCanvas(f, model.perFloor[i].items, { maxDim: 3000, header: { title: `${p.name} — ${f.name}`, legend: legendOf(model) } });
      zip.file(`plans/annotated/${String(i + 1).padStart(2, '0')}_${safeName(f.name)}.png`, await canvasBlob(c));
    }
    for (const it of model.items) {
      for (let j = 0; j < (it.d.photoIds || []).length; j++) {
        const id = it.d.photoIds[j];
        const b = await db.getBlob(id);
        if (b) { const path = `photos/P${safeNo(it.no)}_${j + 1}.${ext(b)}`; zip.file(path, b); blobsMap[id] = path; }
      }
    }
    zip.file('project.json', JSON.stringify({ format: PACK_FORMAT, version: 1, exportedAt: new Date().toISOString(), project: p, floors, defects, blobs: blobsMap }, null, 2));

    // human/AI-readable report data
    const report = {
      project: { name: p.name, code: p.code, client: p.client, location: p.location, inspector: p.inspector, inspectDate: p.inspectDate, numbering: p.numbering === 'auto' ? 'อัตโนมัติ' : 'กำหนดเอง' },
      totals: { points: model.items.length, floors: floors.length, headings: model.groups.length },
      floors: model.perFloor.map((pf, i) => ({ order: i + 1, name: pf.floor.name, count: pf.items.length, scaleMetersPerPixel: pf.floor.scale || null,
        annotatedPlan: `plans/annotated/${String(i + 1).padStart(2, '0')}_${safeName(pf.floor.name)}.png` })),
      groups: model.groups.map(g => ({ index: g.index, inspectionType: TYPE_LABELS[g.type], element: g.element, title: g.title, worstSeverity: g.worst.sevText, count: g.items.length, points: g.items.map(i => i.no), positions: positionsText(g.items) })),
      defects: model.items.map(it => {
        const fields = {};
        it.tpl.fields.forEach(f => { if (!f.hidden) { const v = fieldText(f, it.d.data?.[f.key]); if (v) fields[f.label] = v; } });
        return {
          no: it.no, floor: it.floor.name, inspectionType: TYPE_LABELS[it.d.type], shape: SHAPE_TH[it.d.shape],
          title: it.title, element: it.element, severity: it.sevText, urgency: it.urgText,
          areaFromPlan_m2: it.area != null ? +it.area.toFixed(2) : null, fields,
          photos: (it.d.photoIds || []).map(id => blobsMap[id]).filter(Boolean),
        };
      }),
    };
    zip.file('report.json', JSON.stringify(report, null, 2));
    zip.file('README.md', packReadme(model));
    prog('กำลังบีบอัด', 0.9);
    const blob = await zip.generateAsync({ type: 'blob' });
    download(blob, `${fileBase(p)} - แพ็กข้อมูล.zip`);
    toast('ส่งออกแพ็กข้อมูลแล้ว', 'ok');
  } finally { busy(); }
}

function packReadme(model) {
  const p = model.project;
  return `# แพ็กข้อมูลความเสียหาย-ข้อบกพร่อง: ${p.name}

ส่งออกจาก Defect Mapper เมื่อ ${new Date().toLocaleString('th-TH')}

## ภาพรวม
- รหัสงาน: ${p.code || '-'}
- ผู้ว่าจ้าง: ${p.client || '-'}
- สถานที่ตั้ง: ${p.location || '-'}
- ผู้ตรวจสอบ: ${p.inspector || '-'}  •  วันที่ตรวจสอบ: ${thaiDateLong(p.inspectDate) || '-'}
- จำนวนตำแหน่งที่พบ: ${model.items.length} ตำแหน่ง ใน ${model.floors.length} ชั้น/แปลน จำแนกได้ ${model.groups.length} หัวข้อ

## โครงสร้างไฟล์
| ไฟล์ / โฟลเดอร์ | เนื้อหา |
|---|---|
| \`report.json\` | ข้อมูลสำหรับเขียนรายงาน: ข้อมูลโครงการ, สรุปตามชั้น (\`floors\`), สรุปตามหัวข้อ (\`groups\`), และรายละเอียดทุกจุด (\`defects\`) โดยใช้ชื่อหัวข้อภาษาไทยตามแบบฟอร์ม |
| \`plans/annotated/\` | แปลนแต่ละชั้นที่ปักตำแหน่งแล้ว (เลขบนหมุด = เลขลำดับจุด, สีตามระดับความเสียหาย) |
| \`plans/original/\` | แปลนต้นฉบับที่ยังไม่ปัก |
| \`photos/\` | รูปประกอบ ตั้งชื่อเป็น \`P<เลขจุด>_<ลำดับรูป>\` |
| \`project.json\` | ข้อมูลดิบสำหรับนำเข้ากลับเข้า Defect Mapper (หน้าแรก → “นำเข้าโครงการ”) |

## สำหรับ Claude: แนวทางใช้แพ็กนี้เขียนรายงาน
1. อ่าน \`report.json\` ก่อน — \`groups\` คือหัวข้อความเสียหายที่ไม่ซ้ำกัน (ใช้เป็นหัวข้อย่อยในบทผลการตรวจสอบ) ส่วน \`defects\` คือรายละเอียดรายจุด
2. ใช้รูปใน \`plans/annotated/\` เป็นภาพแปลนแสดงตำแหน่ง และเลือกรูปจาก \`photos/\` ตามเลขจุดใน \`defects[].photos\`
3. ระดับความเสียหาย (\`severity\`) และความเร่งด่วน (\`urgency\`) ใช้จัดลำดับความสำคัญของงานซ่อม
4. ช่อง \`fields\` ของแต่ละจุดเก็บข้อมูลตามแบบฟอร์มจริง (เช่น รายละเอียดความเสียหาย, ผลกระทบต่อความมั่นคง/ความคงทน, รายละเอียดการแก้ไข)
5. \`areaFromPlan_m2\` คำนวณจากพื้นที่ที่วาดบนแปลนตามสเกลที่ตั้งไว้ (เป็นค่าประมาณ)

## สรุปตามหัวข้อ
| ลำดับ | โครงสร้าง/หมวด | หัวข้อ | ระดับสูงสุด | จำนวน | จุดที่ |
|---|---|---|---|---|---|
${model.groups.map(g => `| ${g.index} | ${g.element || '-'} | ${g.title} | ${g.worst.sevText || '-'} | ${g.items.length} | ${g.items.map(i => i.no).join(', ')} |`).join('\n')}
`;
}

function toastBusy(msg) {
  const t = h(`<div class="toast" style="position:fixed;bottom:80px;left:50%;transform:translateX(-50%);z-index:2100">${esc(msg)}</div>`);
  document.body.appendChild(t);
  return () => t.remove();
}

export async function importPack(file) {
  await loadScript('vendor/jszip.min.js');
  const zip = await JSZip.loadAsync(file);
  const pj = zip.file('project.json');
  if (!pj) throw new Error('ไม่พบ project.json ในไฟล์ zip');
  const data = JSON.parse(await pj.async('string'));
  if (data.format !== PACK_FORMAT) throw new Error('ไฟล์นี้ไม่ใช่แพ็กข้อมูลของ Defect Mapper');
  const mime = (path) => (/\.png$/i.test(path) ? 'image/png' : 'image/jpeg');
  const newBlob = {};
  const blobFor = async (oldId) => {
    if (!oldId) return null;
    if (newBlob[oldId]) return newBlob[oldId];
    const path = data.blobs[oldId];
    const zf = path && zip.file(path);
    if (!zf) return null;
    const b = new Blob([await zf.async('arraybuffer')], { type: mime(path) });
    newBlob[oldId] = await db.putBlob(b);
    return newBlob[oldId];
  };
  const existing = await db.get('projects', data.project.id);
  const p = { ...data.project, id: uid(), coverBlobId: await blobFor(data.project.coverBlobId), updatedAt: Date.now() };
  if (existing) p.name = p.name + ' (นำเข้า)';
  const floorMap = {};
  for (const f of data.floors) {
    const nf = { ...f, id: uid(), projectId: p.id, blobId: await blobFor(f.blobId) };
    floorMap[f.id] = nf.id;
    await db.put('floors', nf);
  }
  p.floorOrder = (data.project.floorOrder || data.floors.map(f => f.id)).map(id => floorMap[id]).filter(Boolean);
  for (const d of data.defects) {
    if (!floorMap[d.floorId]) continue;
    const photoIds = [];
    for (const ph of d.photoIds || []) { const nid = await blobFor(ph); if (nid) photoIds.push(nid); }
    await db.put('defects', { ...d, id: uid(), projectId: p.id, floorId: floorMap[d.floorId], photoIds });
  }
  await db.put('projects', p);
  return p;
}
