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
export async function buildModel(projectId, floorIds = null, filter = null) {
  const { project, floors, defects } = await loadBundle(projectId);
  const fl = floorIds ? floors.filter(f => floorIds.includes(f.id)) : floors;
  const fo = new Map(fl.map((f, i) => [f.id, i]));
  const ds = defects.filter(d => fo.has(d.floorId))
    .sort((a, b) => naturalCmp(a.no, b.no) || fo.get(a.floorId) - fo.get(b.floorId));

  let items = ds.map(d => {
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

  if (filter) {
    if (filter.types?.length) items = items.filter(it => filter.types.includes(it.d.type));
    if (filter.sevs?.length) items = items.filter(it => filter.sevs.includes(it.sevText || '__none'));
    if (filter.sort === 'floor') items.sort((a, b) => fo.get(a.floor.id) - fo.get(b.floor.id) || naturalCmp(a.no, b.no));
  }

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

// ---- source rendering: re-draw the plan from the original PDF / image at the size needed for print
export const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const MAX_PIXELS = IS_IOS ? 16.5e6 : 48e6; // iOS Safari refuses canvases above ~16.7 MP
export const PAPER = { A3: [420, 297], A4: [297, 210] };
const pdfCache = new Map();
async function pdfDoc(blobId) {
  if (!pdfCache.has(blobId)) {
    pdfCache.set(blobId, (async () => {
      const blob = await db.getBlob(blobId);
      if (!blob) return null;
      const pdfjs = await import('../vendor/pdf.min.mjs');
      pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.min.mjs', import.meta.url).href;
      return pdfjs.getDocument({ data: await blob.arrayBuffer() }).promise;
    })());
  }
  return pdfCache.get(blobId);
}
async function drawSource(ctx, floor, x, y, W, H) {
  if (floor.srcType === 'pdf' && floor.srcBlobId) {
    try {
      const doc = await pdfDoc(floor.srcBlobId);
      if (doc) {
        const page = await doc.getPage(floor.pdfPage || 1);
        const v1 = page.getViewport({ scale: 1 });
        const vp = page.getViewport({ scale: W / v1.width });
        const c = document.createElement('canvas');
        c.width = W; c.height = H;
        const cx = c.getContext('2d');
        cx.fillStyle = '#fff'; cx.fillRect(0, 0, W, H);
        await page.render({ canvasContext: cx, viewport: vp }).promise;
        ctx.drawImage(c, x, y, W, H);
        c.width = c.height = 0;
        return 'pdf';
      }
    } catch (err) { console.warn('PDF re-render failed, using stored image', err); }
  }
  const blob = (floor.srcType === 'image' && floor.srcBlobId && await db.getBlob(floor.srcBlobId)) || await db.getBlob(floor.blobId);
  const url = URL.createObjectURL(blob);
  const img = await loadImage(url);
  URL.revokeObjectURL(url);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, x, y, W, H);
  return 'image';
}

// Fit the plan inside a box. Sizes in mm when dpi is given (print), else in pixels (maxDim, legacy).
function fitPlan(floor, boxW, boxH) {
  const s = Math.min(boxW / floor.w, boxH / floor.h);
  return [floor.w * s, floor.h * s];
}

// Draw pins/areas. pxPerMm sets marker size on paper (badge 6 mm high at markerScale 1).
function drawMarks(ctx, items, ox, oy, sc, pxPerMm, markerScale) {
  const m = pxPerMm * markerScale;
  const P = (p) => [ox + p[0] * sc, oy + p[1] * sc];
  for (const it of items.filter(i => i.d.shape !== 'point')) {
    ctx.beginPath();
    it.d.pts.forEach((p, i) => { const [x, y] = P(p); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.closePath();
    ctx.globalAlpha = 0.28; ctx.fillStyle = it.color; ctx.fill();
    ctx.globalAlpha = 1; ctx.lineWidth = 0.6 * m; ctx.strokeStyle = it.color; ctx.lineJoin = 'round'; ctx.stroke();
  }
  const badgeAt = (x, y, text, color, square) => {
    const fs = 3.6 * m;
    ctx.font = `700 ${fs}px Sarabun, sans-serif`;
    const hh = 6 * m, w = Math.max(hh, ctx.measureText(text).width + 2.6 * m);
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 0.6 * m; ctx.shadowOffsetY = 0.2 * m;
    roundRect(ctx, x - w / 2, y - hh / 2, w, hh, square ? 1 * m : hh / 2);
    ctx.fillStyle = color; ctx.fill();
    ctx.restore();
    roundRect(ctx, x - w / 2, y - hh / 2, w, hh, square ? 1 * m : hh / 2);
    ctx.lineWidth = 0.45 * m; ctx.strokeStyle = '#fff'; ctx.stroke();
    ctx.fillStyle = textOn(color); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y + 0.2 * m);
  };
  for (const it of items.filter(i => i.d.shape !== 'point')) { const [x, y] = P(centroid(it.d.pts)); badgeAt(x, y, it.no, it.color, true); }
  for (const it of items.filter(i => i.d.shape === 'point')) { const [x, y] = P(it.d.pts[0]); badgeAt(x, y, it.no, it.color, false); }
}

// Plan only (no page). opts: { boxMm:[w,h], dpi } for print, or { maxDim } in pixels.
export async function planCanvas(floor, items, { maxDim = 3000, boxMm = null, dpi = 300, markerScale = 1, header = null } = {}) {
  await ensureFonts();
  let W, H, pxPerMm;
  if (boxMm) {
    const [wMm, hMm] = fitPlan(floor, boxMm[0], boxMm[1]);
    pxPerMm = dpi / 25.4;
    W = Math.round(wMm * pxPerMm); H = Math.round(hMm * pxPerMm);
  } else {
    const s = Math.min(maxDim / Math.max(floor.w, floor.h), 4);
    W = Math.round(floor.w * s); H = Math.round(floor.h * s);
    pxPerMm = Math.max(W, H) / 400; // as if printed on A3
  }
  const headH = header ? Math.round(12 * pxPerMm) : 0;
  const cap = Math.sqrt(MAX_PIXELS / (W * (H + headH)));
  if (cap < 1) { W = Math.floor(W * cap); H = Math.floor(H * cap); pxPerMm *= cap; }
  const hh = header ? Math.round(12 * pxPerMm) : 0;
  const c = document.createElement('canvas');
  c.width = W; c.height = H + hh;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  await drawSource(ctx, floor, 0, hh, W, H);
  drawMarks(ctx, items, 0, hh, W / floor.w, pxPerMm, markerScale);
  if (header) drawHeaderBand(ctx, 0, 0, W, hh, header);
  return c;
}

function drawHeaderBand(ctx, x0, y0, W, hh, header) {
  const f = hh * 0.4;
  ctx.fillStyle = '#1f3a5f'; ctx.fillRect(x0, y0, W, hh);
  ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  ctx.font = `700 ${f}px Sarabun, sans-serif`;
  ctx.fillText(header.title, x0 + f * 0.8, y0 + hh / 2);
  let x = x0 + W - f * 0.8;
  ctx.font = `400 ${f * 0.8}px Sarabun, sans-serif`;
  ctx.textAlign = 'right';
  for (const lg of [...(header.legend || [])].reverse()) {
    const tw = ctx.measureText(lg.label).width;
    ctx.fillStyle = '#fff'; ctx.fillText(lg.label, x, y0 + hh / 2);
    x -= tw + f * 0.5;
    ctx.beginPath(); ctx.arc(x, y0 + hh / 2, f * 0.32, 0, Math.PI * 2); ctx.fillStyle = lg.color; ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(1.5, f * 0.06); ctx.stroke();
    x -= f * 1.1;
  }
}

// A whole printable page (A3/A4) with title, plan and legend, at the given dpi.
export async function planPage(floor, items, { paper = 'A3', dpi = 300, markerScale = 1, title = '', subtitle = '', legend = [], foot = '' } = {}) {
  await ensureFonts();
  const [lw, sw] = PAPER[paper];
  const land = floor.w >= floor.h;
  let pw = land ? lw : sw, ph = land ? sw : lw;
  let pxPerMm = dpi / 25.4;
  let W = Math.round(pw * pxPerMm), H = Math.round(ph * pxPerMm);
  const cap = Math.sqrt(MAX_PIXELS / (W * H));
  if (cap < 1) { pxPerMm *= cap; W = Math.floor(W * cap); H = Math.floor(H * cap); }
  const mm = (v) => v * pxPerMm;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
  const M = 12, titleH = 11, legH = legend.length ? 8 : 0, footH = foot ? 5 : 0;
  // title
  ctx.fillStyle = '#1f3a5f'; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
  ctx.font = `700 ${mm(5.2)}px Sarabun, sans-serif`;
  ctx.fillText(title, mm(M), mm(M + 5));
  if (subtitle) { ctx.fillStyle = '#555'; ctx.font = `400 ${mm(3.4)}px Sarabun, sans-serif`; ctx.fillText(subtitle, mm(M), mm(M + 9.6)); }
  // plan area
  const boxW = pw - 2 * M, boxH = ph - 2 * M - titleH - legH - footH;
  const [wMm, hMm] = fitPlan(floor, boxW, boxH);
  const ox = mm(M + (boxW - wMm) / 2), oy = mm(M + titleH + (boxH - hMm) / 2);
  const PW = Math.round(mm(wMm)), PH = Math.round(mm(hMm));
  await drawSource(ctx, floor, ox, oy, PW, PH);
  ctx.strokeStyle = '#999'; ctx.lineWidth = Math.max(1, mm(0.2)); ctx.strokeRect(ox, oy, PW, PH);
  drawMarks(ctx, items, ox, oy, PW / floor.w, pxPerMm, markerScale);
  // legend
  if (legend.length) {
    let x = mm(M); const y = mm(ph - M - footH - 2.5);
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    ctx.font = `700 ${mm(3.2)}px Sarabun, sans-serif`; ctx.fillStyle = '#16202c';
    ctx.fillText('สัญลักษณ์:', x, y); x += ctx.measureText('สัญลักษณ์:').width + mm(3);
    ctx.font = `400 ${mm(3.2)}px Sarabun, sans-serif`;
    for (const lg of legend) {
      ctx.beginPath(); ctx.arc(x + mm(1.6), y, mm(1.6), 0, Math.PI * 2); ctx.fillStyle = lg.color; ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = mm(0.2); ctx.stroke();
      x += mm(4.6); ctx.fillStyle = '#16202c'; ctx.fillText(lg.label, x, y); x += ctx.measureText(lg.label).width + mm(5);
    }
  }
  if (foot) { ctx.fillStyle = '#777'; ctx.font = `400 ${mm(2.8)}px Sarabun, sans-serif`; ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic'; ctx.fillText(foot, mm(pw - M), mm(ph - M + 2)); }
  return { canvas: c, land, paper, wMm: pw, hMm: ph };
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
export const EXPORT_FORMATS = [
  { id: 'word', icon: 'W', color: '#2b579a', label: 'Word (.docx)', desc: 'แปลน + รายการตามหัวข้อ + ตาราง แก้ไขต่อได้' },
  { id: 'pdf', icon: 'PDF', color: '#c62828', label: 'PDF', desc: 'เนื้อหาเหมือน Word พร้อมหน้าปก' },
  { id: 'image', icon: '🖼', color: '#0f766e', label: 'รูปแปลน', desc: 'เฉพาะแบบแปลนที่ปักแล้ว (PNG/JPG)' },
  { id: 'excel', icon: 'X', color: '#217346', label: 'Excel (.xlsx)', desc: 'รายการทุกจุด + สรุป' },
  { id: 'pack', icon: '⧉', color: '#6d28d9', label: 'แพ็กข้อมูล (.zip)', desc: 'ส่งให้ Claude เขียนรายงาน / สำรอง / ย้ายเครื่อง' },
];

export async function exportDialog(projectId, initialFmt = 'word') {
  const { project, floors, defects } = await loadBundle(projectId);
  const saved = await db.getMeta('exportPrefs', {});
  const org = await db.getMeta('orgName', DEFAULT_ORG);
  const pref = (k, dflt) => saved[k] ?? dflt;
  const sel = (name, opts, cur) => `<select name="${name}" class="inp" style="width:auto;display:inline-block;padding:2px 8px">${opts.map(([v, t]) => `<option value="${v}" ${String(cur) === String(v) ? 'selected' : ''}>${t}</option>`).join('')}</select>`;
  const ckb = (name, label, on, hint = '') => `<label class="ck"><input type="checkbox" name="${name}" ${on ? 'checked' : ''}><span>${label}${hint ? `<br><span class="hint">${hint}</span>` : ''}</span></label>`;

  // severity levels used in this project (for filtering)
  const sevs = new Map();
  for (const t of Object.values(project.templates)) (fieldByRole(t, 'severity')?.options || []).forEach(o => sevs.set(o.label, o.color));
  const usedTypes = [...new Set(defects.map(d => d.type))];

  const body = h(`<div>
    <div class="sec-title" style="margin-top:0">1. เลือกรูปแบบไฟล์</div>
    <div class="exp-formats">${EXPORT_FORMATS.map(f => `<label><input type="radio" name="fmt" value="${f.id}" ${f.id === initialFmt ? 'checked' : ''}>
      <span class="fi" style="background:${f.color}">${f.icon}</span><b>${f.label}</b><span>${f.desc}</span></label>`).join('')}</div>

    <div class="sec-title">2. ตัวเลือกการส่งออก</div>
    <div class="exp-opts" data-for="word pdf">
      ${ckb('cover', 'หน้าปก “รายการความเสียหาย-ข้อบกพร่องของโครงการ …”', false)}
      ${ckb('summary', 'ตารางสรุปจำนวนตามหัวข้อความเสียหาย', pref('summary', true))}
      ${ckb('plans', 'แปลนเรียงชั้น (พร้อมตำแหน่งที่ปัก)', pref('plans', true))}
      <label class="ck"><input type="checkbox" name="groups" ${pref('groups', true) ? 'checked' : ''}><span>รายการความเสียหายแยกตามหัวข้อ (หัวข้อซ้ำแสดงครั้งเดียว) — รูปตัวอย่าง ${sel('groupPhotos', [[1, '1 รูป'], [2, '2 รูป']], pref('groupPhotos', 2))}</span></label>
      ${ckb('table', 'ตารางตำแหน่งทุกจุด (เรียงเลขลำดับ พร้อมจำนวนรวมและสรุปรายชั้น)', pref('table', true))}
      <label class="ck"><input type="checkbox" name="perPoint" ${pref('perPoint', false) ? 'checked' : ''}><span>แบบฟอร์มรายจุด (ทุกจุด จุดละ 1 ตาราง) — รูปต่อจุด ${sel('pointPhotos', [[1, '1 รูป'], [2, '2 รูป'], [4, '4 รูป']], pref('pointPhotos', 2))}</span></label>
      ${ckb('showUnchecked', 'แสดงตัวเลือกที่ไม่ได้ติ๊ก (☐) ในแบบฟอร์ม เหมือนแบบฟอร์มกระดาษ', pref('showUnchecked', true))}
      <label class="fld" style="margin-top:8px"><span>ชื่อหน่วยงานผู้จัดทำ (แสดงบนปกและหัวกระดาษ — เว้นว่างได้)</span><input type="text" name="org" value="${esc(org)}"></label>
    </div>
    <div class="exp-opts" data-for="image">
      <div class="row" style="flex-wrap:wrap">
        <label class="fld"><span>ชนิดไฟล์</span>${sel('imgType', [['png', 'PNG (คมชัด ไฟล์ใหญ่)'], ['jpg', 'JPG (ไฟล์เล็ก)']], pref('imgType', 'png'))}</label>
        <label class="fld"><span>ขนาด</span>${sel('imgPaper', [['A3', 'เต็มหน้ากระดาษ A3 (มีชื่อชั้นและสัญลักษณ์)'], ['A4', 'เต็มหน้ากระดาษ A4 (มีชื่อชั้นและสัญลักษณ์)'], ['source', 'เฉพาะแปลน ไม่มีกรอบกระดาษ']], pref('imgPaper', 'A3'))}</label>
      </div>
      ${ckb('imgHeader', 'แบบ “เฉพาะแปลน”: ใส่แถบชื่อโครงการ/ชั้น และสัญลักษณ์ด้านบนรูป', pref('imgHeader', true))}
      <p class="hint">ถ้าเลือกหลายชั้น จะได้ไฟล์ .zip ที่มีรูปแยกทีละชั้น</p>
    </div>
    <div class="exp-opts" data-for="excel">
      ${ckb('xlsSummary', 'เพิ่มชีต “สรุปตามหัวข้อ” และ “สรุปตามชั้น”', pref('xlsSummary', true))}
      ${ckb('xlsCoords', 'เพิ่มคอลัมน์พิกัดตำแหน่งบนแปลน (X, Y เป็น % ของแปลน)', pref('xlsCoords', false))}
    </div>
    <div class="exp-opts" data-for="pack">
      ${ckb('packAnnotated', 'แปลนที่ปักตำแหน่งแล้ว (สำหรับใส่ในรายงาน)', pref('packAnnotated', true))}
      ${ckb('packPhotos', 'รูปประกอบทุกจุด', pref('packPhotos', true))}
      ${ckb('packOriginal', 'แปลนต้นฉบับ', pref('packOriginal', true), 'จำเป็นถ้าจะใช้ไฟล์นี้สำรองข้อมูลหรือนำเข้ากลับในเครื่องอื่น')}
      <p class="hint">แพ็กข้อมูลรวมทุกชั้นและทุกจุดของโครงการเสมอ</p>
    </div>

    <div data-for="word pdf image excel">
      <div class="sec-title">3. เลือกข้อมูลที่ส่งออก</div>
      <div class="fld"><span>ชั้น / แปลน <a href="#" id="flAll" style="font-weight:400;margin-left:6px">เลือกทั้งหมด</a> <a href="#" id="flNone" style="font-weight:400;margin-left:4px">ไม่เลือก</a></span>
        <div class="floor-picks">${floors.map(f => `<label class="chip on"><input type="checkbox" name="floor" value="${f.id}" checked>${esc(f.name)} <span class="muted">(${defects.filter(d => d.floorId === f.id).length})</span></label>`).join('') || '<span class="muted">ยังไม่มีแปลน</span>'}</div></div>
      ${usedTypes.length > 1 ? `<div class="fld"><span>ประเภทการตรวจสอบ</span><div class="floor-picks">${usedTypes.map(t => `<label class="chip on"><input type="checkbox" name="ftype" value="${t}" checked>${TYPE_LABELS[t]}</label>`).join('')}</div></div>` : ''}
      <div class="fld"><span>ระดับความเสียหาย</span><div class="floor-picks">${[...sevs.entries()].map(([l, c]) => `<label class="chip on"><input type="checkbox" name="fsev" value="${esc(l)}" checked><span class="dot" style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${c}"></span>${esc(l)}</label>`).join('')}
        <label class="chip on"><input type="checkbox" name="fsev" value="__none" checked>ยังไม่ระบุ</label></div></div>
      <div class="row" style="flex-wrap:wrap">
        <label class="fld" data-for="word pdf excel"><span>การเรียงลำดับรายการ</span>${sel('sort', [['no', 'ตามเลขลำดับ'], ['floor', 'ตามชั้น แล้วตามเลขลำดับ']], pref('sort', 'no'))}</label>
        <label class="fld" data-for="word pdf image"><span>ความละเอียดแปลน${IS_IOS ? ' (iPad/iPhone จำกัดไว้ประมาณ 280 dpi)' : ''}</span>${sel('planDpi', [[200, '200 dpi (ไฟล์เล็กกว่า)'], [300, '300 dpi (คมที่สุด)']], pref('planDpi', 300))}</label>
        <label class="fld" data-for="word pdf"><span>ขนาดหน้าแปลนในรายงาน</span>${sel('planPaper', [['A3', 'A3 (แปลนใหญ่ อ่านง่าย)'], ['A4', 'A4 (ทั้งเล่มขนาดเดียวกัน)']], pref('planPaper', 'A3'))}</label>
        <label class="fld" data-for="word pdf image"><span>ขนาดหมุดบนแปลน</span>${sel('marker', [[0.6, 'เล็ก'], [1, 'ปานกลาง'], [1.4, 'ใหญ่'], [1.9, 'ใหญ่มาก']], pref('marker', 1))}</label>
      </div>
      <p class="hint" id="expCount"></p>
    </div>
    <div id="expProg" style="display:none"><p class="muted" id="expMsg" style="margin:10px 0 0"></p><div class="progress"><div id="expBar"></div></div></div>
  </div>`);

  const current = () => ({
    fmt: $('[name=fmt]:checked', body).value,
    floorIds: $$('[name=floor]:checked', body).map(x => x.value),
    types: $$('[name=ftype]:checked', body).map(x => x.value),
    sevs: $$('[name=fsev]:checked', body).map(x => x.value),
  });
  const countMatching = () => {
    const c = current();
    const tplSev = (d) => { const t = project.templates[d.type]; const f = fieldByRole(t, 'severity'); const v = f ? d.data?.[f.key] : ''; return v && severityInfo(t, v) ? v : '__none'; };
    const n = defects.filter(d => c.floorIds.includes(d.floorId) && (!usedTypes.length || usedTypes.length < 2 || c.types.includes(d.type)) && c.sevs.includes(tplSev(d))).length;
    $('#expCount', body).textContent = `จะส่งออก ${n} จาก ${defects.length} จุด`;
  };
  const sync = () => {
    const fmt = current().fmt;
    $$('[data-for]', body).forEach(el => { el.style.display = el.dataset.for.split(' ').includes(fmt) ? '' : 'none'; });
    $('[name=cover]', body).checked = fmt === 'pdf' ? pref('coverPdf', true) : pref('coverWord', false);
    $('.modal-foot .btn.primary', body.closest('.modal'))?.replaceChildren(document.createTextNode(`ส่งออก ${EXPORT_FORMATS.find(f => f.id === fmt).label}`));
    countMatching();
  };
  $$('[name=fmt]', body).forEach(r => r.onchange = sync);
  $$('.floor-picks .chip', body).forEach(c => $('input', c).onchange = (e) => { c.classList.toggle('on', e.target.checked); countMatching(); });
  const setAll = (on) => (e) => { e.preventDefault(); $$('[name=floor]', body).forEach(i => { i.checked = on; i.closest('.chip').classList.toggle('on', on); }); countMatching(); };
  if ($('#flAll', body)) { $('#flAll', body).onclick = setAll(true); $('#flNone', body).onclick = setAll(false); }

  const m = modal({
    title: `ส่งออก — ${project.name}`, body, wide: true,
    actions: [
      { label: 'ยกเลิก', value: null },
      { label: 'ส่งออก', kind: 'primary', onClick: async (b) => {
        const c = current();
        const fmt = c.fmt;
        const ck = (n) => !!$(`[name=${n}]`, b)?.checked;
        const val = (n) => $(`[name=${n}]`, b)?.value;
        const opts = {
          cover: ck('cover'), summary: ck('summary'), plans: ck('plans'), groups: ck('groups'), table: ck('table'), perPoint: ck('perPoint'),
          showUnchecked: ck('showUnchecked'), groupPhotos: +val('groupPhotos'), pointPhotos: +val('pointPhotos'),
          org: val('org').trim(), marker: +val('marker'), imgHeader: ck('imgHeader'), imgType: val('imgType'), imgPaper: val('imgPaper'), planPaper: val('planPaper') || 'A3', planDpi: +val('planDpi'),
          xlsSummary: ck('xlsSummary'), xlsCoords: ck('xlsCoords'),
          packAnnotated: ck('packAnnotated'), packPhotos: ck('packPhotos'), packOriginal: ck('packOriginal'),
          sort: val('sort'), floorIds: c.floorIds,
          filter: { types: usedTypes.length > 1 ? c.types : [], sevs: c.sevs.length === sevs.size + 1 ? [] : c.sevs, sort: val('sort') },
        };
        if (fmt !== 'pack' && !opts.floorIds.length) { toast('เลือกอย่างน้อย 1 ชั้น', 'error'); return false; }
        if (fmt !== 'pack' && !c.sevs.length) { toast('เลือกระดับความเสียหายอย่างน้อย 1 ระดับ', 'error'); return false; }
        if (['word', 'pdf'].includes(fmt) && !(opts.cover || opts.summary || opts.plans || opts.groups || opts.table || opts.perPoint)) { toast('เลือกอย่างน้อย 1 ส่วน', 'error'); return false; }
        const { filter, floorIds, ...keep } = opts;
        await db.setMeta('exportPrefs', { ...saved, ...keep, [fmt === 'pdf' ? 'coverPdf' : 'coverWord']: opts.cover, lastFormat: fmt });
        await db.setMeta('orgName', opts.org);
        $('#expProg', b).style.display = '';
        $$('.modal-foot button', b.parentElement).forEach(x => x.disabled = true);
        const prog = (msg, frac) => { $('#expMsg', b).textContent = msg; if (frac != null) $('#expBar', b).style.width = Math.round(frac * 100) + '%'; };
        try {
          if (fmt === 'word') await exportWord(projectId, opts, prog);
          else if (fmt === 'pdf') await exportPdf(projectId, opts, prog);
          else if (fmt === 'image') await exportImages(projectId, opts, prog);
          else if (fmt === 'excel') await exportExcel(projectId, opts, prog);
          else if (fmt === 'pack') await exportPack(projectId, prog, { original: opts.packOriginal, annotated: opts.packAnnotated, photos: opts.packPhotos });
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
  sync();
  return m.done;
}

const fileBase = (p) => safeName(`${p.code ? p.code + ' ' : ''}${p.name}`);

// =====================================================================================
// Images
// =====================================================================================
async function exportImages(projectId, opts, prog = () => {}) {
  const model = await buildModel(projectId, opts.floorIds, opts.filter);
  const legend = legendOf(model);
  const outs = [];
  for (let i = 0; i < model.perFloor.length; i++) {
    const { floor, items } = model.perFloor[i];
    prog(`กำลังสร้างรูป ${floor.name}`, i / model.perFloor.length);
    const dpi = opts.planDpi || 300;
    const c = opts.imgPaper === 'source'
      ? await planCanvas(floor, items, { boxMm: [400, 400], dpi, markerScale: opts.marker,
        header: opts.imgHeader ? { title: `${model.project.name} — ${floor.name} (${items.length} จุด)`, legend } : null })
      : (await planPage(floor, items, { paper: opts.imgPaper || 'A3', dpi, markerScale: opts.marker, legend,
        title: `${floor.name}`, subtitle: `${model.project.name}${model.project.code ? ' (' + model.project.code + ')' : ''} • ${items.length} ตำแหน่ง`,
        foot: (opts.org || '') })).canvas;
    const jpg = opts.imgType === 'jpg';
    outs.push({ name: `${String(i + 1).padStart(2, '0')} ${safeName(floor.name)}.${jpg ? 'jpg' : 'png'}`, blob: await canvasBlob(c, jpg ? 'image/jpeg' : 'image/png', 0.92) });
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
  const model = await buildModel(projectId, opts.floorIds, opts.filter);
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
    if (opts.xlsCoords) {
      const [x, y] = it.d.shape === 'point' ? it.d.pts[0] : centroid(it.d.pts);
      r['ตำแหน่ง X (%)'] = +(x / it.floor.w * 100).toFixed(1);
      r['ตำแหน่ง Y (%)'] = +(y / it.floor.h * 100).toFixed(1);
    }
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

  if (opts.xlsSummary !== false) {
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
  }
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
  const model = await buildModel(projectId, opts.floorIds, opts.filter);
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
      // plan pages are A3 or A4 (chosen in the dialog; orientation follows the plan); everything else stays A4
      const land = floor.w >= floor.h;
      const a4 = opts.planPaper === 'A4';
      const [lw, sw] = PAPER[a4 ? 'A4' : 'A3'];
      const pw = land ? lw : sw, ph = land ? sw : lw;
      const boxMm = [pw - 40, ph - 40 - (a4 ? 26 : 30)];
      const c = await planCanvas(floor, items, { boxMm, dpi: opts.planDpi || 300, markerScale: opts.marker });
      const head = para([run(`แปลน${/^(ชั้น|แปลน)/.test(floor.name) ? '' : ' '}${floor.name.replace(/^แปลน\s*/, '')}`, { size: 34, bold: true, color: '1F3A5F' }), run(`   (${items.length} ตำแหน่ง)`, { size: 28, color: '666666' })],
        { heading: D.HeadingLevel.HEADING_2, after: 120, keepNext: true });
      flush();
      const PGW = a4 ? 11906 : 16838, PGH = a4 ? 16838 : 23811;
      const mmPx = (v) => v / 25.4 * 96;
      sections.push({ ...portrait([head, para([await imgRun(c, mmPx(boxMm[0]), mmPx(boxMm[1]), true)], { align: D.AlignmentType.CENTER, after: 80 }), legendPara()]),
        properties: { page: { size: { width: PGW, height: PGH, orientation: land ? D.PageOrientation.LANDSCAPE : D.PageOrientation.PORTRAIT }, margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN } } } });
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
    creator: opts.org || 'Inspect Recorder', title: `รายการความเสียหาย-ข้อบกพร่อง ${p.name}`,
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
  .rp-page.a3{width:1123px;height:1587px}.rp-page.a3.land{width:1587px;height:1123px}.rp-page.a3.pa4{width:794px;height:1123px}.rp-page.a3.pa4.land{width:1123px;height:794px}
  .rp-page.a3 .a3img{position:absolute;inset:0;width:100%;height:100%}
  .rp-page.a3 .rp-foot{bottom:8px}
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
  @media print{.rp-page{box-shadow:none;margin:0;page-break-after:always;break-after:page}.rp-page.land{page:land}@page land{size:A4 landscape}.rp-page.a3{page:a3p}.rp-page.a3.land{page:a3l}@page a3p{size:A3 portrait}@page a3l{size:A3 landscape}.rp-page.a3.pa4{page:auto}.rp-page.a3.pa4.land{page:land}}
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
      const pg = await planPage(floor, items, { paper: opts.planPaper === 'A4' ? 'A4' : 'A3', dpi: opts.planDpi || 300, markerScale: opts.marker, legend: legendOf(model),
        title: `แปลน${/^(ชั้น|แปลน)/.test(floor.name) ? '' : ' '}${floor.name.replace(/^แปลน\s*/, '')}`, subtitle: `${p.name} • ${items.length} ตำแหน่ง`, foot: opts.org || '' });
      const blob = await canvasBlob(pg.canvas, 'image/jpeg', 0.93);
      pg.canvas.width = pg.canvas.height = 0;
      const u = URL.createObjectURL(blob);
      urls['plan_' + floor.id] = u;
      blocks.push({ page: 'a3', land: pg.land, img: u, paper: pg.paper });
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
    if (b.page === 'a3') { // full plan page (A3 or A4) rendered at print resolution
      const pg = h(`<div class="rp-page a3 ${b.paper === 'A4' ? 'pa4' : ''} ${b.land ? 'land' : ''}"><img class="a3img" src="${b.img}"><div class="rp-foot"></div></div>`);
      pg.dataset.img = b.img;
      host.appendChild(pg); pages.push(pg);
      await waitImages(pg);
      body = null; curKind = 'a3';
      continue;
    }
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
  const model = await buildModel(projectId, opts.floorIds, opts.filter);
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
        const a3 = pg.classList.contains('a3');
        const orient = land ? 'landscape' : 'portrait';
        const big = a3 && !pg.classList.contains('pa4');
        const fmt = big ? 'a3' : 'a4';
        const [pw, ph] = big ? (land ? [420, 297] : [297, 420]) : (land ? [297, 210] : [210, 297]);
        let dataUrl;
        if (a3) {
          const pn = $('.rp-foot', pg)?.textContent || '';
          const img = $('.a3img', pg);
          const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
          const cx = c.getContext('2d'); cx.drawImage(img, 0, 0);
          if (pn) { const s = c.width / pw; cx.font = `400 ${2.8 * s}px Sarabun, sans-serif`; cx.fillStyle = '#777'; cx.textAlign = 'right'; cx.fillText(pn, c.width - 12 * s, c.height - 5 * s); }
          dataUrl = c.toDataURL('image/jpeg', 0.93); c.width = c.height = 0;
        } else {
          const shadow = pg.style.boxShadow; pg.style.boxShadow = 'none';
          const c = await html2canvas(pg, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false });
          pg.style.boxShadow = shadow;
          dataUrl = c.toDataURL('image/jpeg', 0.9);
        }
        if (!pdf) pdf = new jsPDF({ orientation: orient, unit: 'mm', format: fmt, compress: true });
        else pdf.addPage(fmt, orient);
        pdf.addImage(dataUrl, 'JPEG', 0, 0, pw, ph, undefined, 'FAST');
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

export async function exportPack(projectId, prog = () => {}, popts = {}) {
  const po = { original: true, annotated: true, photos: true, ...popts };
  const busy = toastBusy('กำลังสร้างแพ็กข้อมูล…');
  try {
    await loadScript('vendor/jszip.min.js');
    const model = await buildModel(projectId);
    const { project: p, floors } = model;
    const defects = await db.byProject('defects', projectId); // raw: includes test stations
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
      if (po.original) await addBlob(f.blobId, `plans/original/${String(i + 1).padStart(2, '0')}_${safeName(f.name)}.${ext(await db.getBlob(f.blobId))}`);
      if (po.original && f.srcBlobId && !blobsMap[f.srcBlobId]) {
        const sb = await db.getBlob(f.srcBlobId);
        if (sb) { const path = `plans/source/${safeName(f.name)}.${sb.type === 'application/pdf' ? 'pdf' : ext(sb)}`; zip.file(path, sb); blobsMap[f.srcBlobId] = path; }
      }
      if (!po.annotated) continue;
      const c = (await planPage(f, model.perFloor[i].items, { paper: 'A3', dpi: 200, legend: legendOf(model), title: f.name, subtitle: `${p.name} • ${model.perFloor[i].items.length} ตำแหน่ง` })).canvas;
      zip.file(`plans/annotated/${String(i + 1).padStart(2, '0')}_${safeName(f.name)}.png`, await canvasBlob(c));
    }
    for (const it of po.photos ? model.items : []) {
      for (let j = 0; j < (it.d.photoIds || []).length; j++) {
        const id = it.d.photoIds[j];
        const b = await db.getBlob(id);
        if (b) { const path = `photos/P${safeNo(it.no)}_${j + 1}.${ext(b)}`; zip.file(path, b); blobsMap[id] = path; }
      }
    }
    const stations = defects.filter(d => d.layer === 'test');
    for (const st of po.photos ? stations : []) {
      for (let j = 0; j < (st.photoIds || []).length; j++) {
        const id = st.photoIds[j];
        const b = await db.getBlob(id);
        if (b) { const path = `photos/T_${safeNo(st.code)}_${j + 1}.${ext(b)}`; zip.file(path, b); blobsMap[id] = path; }
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
    if (stations.length) {
      const { testsReport } = await import('./test-export.js');
      report.tests = testsReport(p, floors, stations);
      report.totals.testPoints = stations.length;
    }
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

ส่งออกจาก Inspect Recorder เมื่อ ${new Date().toLocaleString('th-TH')}

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
| \`project.json\` | ข้อมูลดิบสำหรับนำเข้ากลับเข้า Inspect Recorder (หน้าแรก → “นำเข้าโครงการ”) |

## สำหรับ Claude: แนวทางใช้แพ็กนี้เขียนรายงาน
1. อ่าน \`report.json\` ก่อน — \`groups\` คือหัวข้อความเสียหายที่ไม่ซ้ำกัน (ใช้เป็นหัวข้อย่อยในบทผลการตรวจสอบ) ส่วน \`defects\` คือรายละเอียดรายจุด
2. ใช้รูปใน \`plans/annotated/\` เป็นภาพแปลนแสดงตำแหน่ง และเลือกรูปจาก \`photos/\` ตามเลขจุดใน \`defects[].photos\`
3. ระดับความเสียหาย (\`severity\`) และความเร่งด่วน (\`urgency\`) ใช้จัดลำดับความสำคัญของงานซ่อม
4. ช่อง \`fields\` ของแต่ละจุดเก็บข้อมูลตามแบบฟอร์มจริง (เช่น รายละเอียดความเสียหาย, ผลกระทบต่อความมั่นคง/ความคงทน, รายละเอียดการแก้ไข)
5. \`areaFromPlan_m2\` คำนวณจากพื้นที่ที่วาดบนแปลนตามสเกลที่ตั้งไว้ (เป็นค่าประมาณ)
6. \`tests\` (ถ้ามี) คือผลการทดสอบแยกตามชนิด: \`columns\`/\`rows\` ใช้ทำตารางผลบทที่ 3, \`criteria\` และ \`bands\` คือเกณฑ์ที่ใช้ประเมิน (ปรับได้ในแอพ), คอลัมน์ "หมายเหตุที่ต้องเขียน" บอกรหัสข้อควรระวังตามคลังวิธีทดสอบ (เช่น U1, U4, H1) ; รูปของจุดทดสอบอยู่ใน \`photos/T_<รหัสจุด>_*\`

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
  if (data.format !== PACK_FORMAT) throw new Error('ไฟล์นี้ไม่ใช่แพ็กข้อมูลของ Inspect Recorder');
  const mime = (path) => (/\.png$/i.test(path) ? 'image/png' : /\.pdf$/i.test(path) ? 'application/pdf' : 'image/jpeg');
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
    const nf = { ...f, id: uid(), projectId: p.id, blobId: await blobFor(f.blobId), srcBlobId: f.srcBlobId ? await blobFor(f.srcBlobId) : null };
    if (!nf.blobId) throw new Error('แพ็กนี้ส่งออกโดยไม่รวมแปลนต้นฉบับ จึงนำเข้ากลับไม่ได้');
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
