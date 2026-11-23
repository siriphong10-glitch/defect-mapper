// Export of instrument-test results: Word tables, CSV and Excel.
import { db } from './db.js';
import { $, $$, esc, h, modal, toast, download, loadScript, naturalCmp, safeName } from './utils.js';
import { loadBundle } from './project.js';
import { allTypes, typeDef, evalTest, LEVEL, levelColor, ROLES, fieldValueText, ensureCodes, codeOf } from './tests.js';

const HEAD_FILL = 'C5D9F1';
const DEFAULT_ORG = 'บริษัท เพอร์ฟอร์มแมกซ์ บิวดิ้ง เซอร์วิซ จำกัด';

// ------------------------------------------------------------------ model
export async function buildTestModel(projectId, floorIds = null) {
  const { project, floors, tests } = await loadBundle(projectId);
  const fl = floorIds ? floors.filter(f => floorIds.includes(f.id)) : floors;
  ensureCodes(project, tests);
  const fo = new Map(fl.map((f, i) => [f.id, i]));
  const stations = tests.filter(s => fo.has(s.floorId))
    .sort((a, b) => fo.get(a.floorId) - fo.get(b.floorId) || naturalCmp(a.code, b.code));
  // tables are sorted by each test's own code inside typeTable
  const types = allTypes(project, { includeHidden: true }).filter(t => stations.some(s => s.tests?.[t.id]));
  const floorOf = (s) => fl[fo.get(s.floorId)];
  return { project, floors: fl, stations, types, floorOf };
}

// table for one test type: { columns:[{key,label,unit,group}], rows:[{cells, level, grade, station}] }
export function typeTable(model, t, { split = false, includeEmpty = true } = {}) {
  const { project } = model;
  const fo = new Map(model.floors.map((f, i) => [f.id, i]));
  const rowsSrc = model.stations.filter(s => s.tests?.[t.id])
    .sort((a, b) => naturalCmp(codeOf(a, t.id), codeOf(b, t.id)) || (fo.get(a.floorId) ?? 0) - (fo.get(b.floorId) ?? 0));
  const evals = rowsSrc.map(s => evalTest(project, s, t.id));
  const outKeys = [];
  evals.forEach(e => e.out.forEach(o => { if (!outKeys.find(k => k.key === o.key)) outKeys.push({ key: o.key, label: o.label, unit: o.unit }); }));
  const cols = [
    { key: '_n', label: 'ลำดับ' }, { key: '_code', label: 'รหัสจุด' }, { key: '_floor', label: 'ชั้น/แปลน' },
    { key: '_place', label: 'ตำแหน่ง/กริด' }, { key: '_el', label: 'ชิ้นส่วน' }, { key: '_role', label: 'ประเภทจุด' },
  ];
  const maxReads = {};
  t.fields.forEach(f => { if (f.kind === 'readings') maxReads[f.key] = Math.max(f.count || 0, ...rowsSrc.map(s => (s.tests[t.id][f.key] || []).length)); });
  t.fields.forEach(f => {
    if (f.kind === 'readings' && split) for (let i = 0; i < maxReads[f.key]; i++) cols.push({ key: `${f.key}#${i}`, label: `${f.label.replace(/\s*\(.*\)$/, '')} ${i + 1}`, unit: f.unit });
    else cols.push({ key: f.key, label: f.label.replace(/\s*\(.*\)$/, ''), unit: f.unit, field: f });
  });
  outKeys.forEach(o => cols.push({ key: 'o:' + o.key, label: o.label, unit: o.unit }));
  cols.push({ key: '_grade', label: 'ผลการประเมิน' }, { key: '_with', label: 'ทดสอบร่วมกับ' }, { key: '_linked', label: 'ความเสียหายที่เกี่ยวข้อง' }, { key: '_note', label: 'หมายเหตุ' });
  let n = 0;
  const rows = [];
  rowsSrc.forEach((s, i) => {
    const e = evals[i];
    if (!includeEmpty && !e.recorded) return;
    const v = s.tests[t.id];
    const cells = {
      _n: ++n, _code: codeOf(s, t.id), _with: Object.keys(s.tests).filter(k => k !== t.id).map(k => codeOf(s, k)).join(', '), _floor: model.floorOf(s)?.name || '', _place: s.place || '', _el: s.element || '', _role: ROLES[s.role || ''] === '—' ? '' : ROLES[s.role || ''],
      _grade: e.grade || (e.recorded ? '' : 'ยังไม่บันทึกค่า'), _linked: s.linked || '', _note: s.note || '',
    };
    t.fields.forEach(f => {
      if (f.kind === 'readings' && split) for (let j = 0; j < maxReads[f.key]; j++) cells[`${f.key}#${j}`] = v[f.key]?.[j] ?? '';
      else cells[f.key] = fieldValueText(f, v[f.key]);
    });
    e.out.forEach(o => { cells['o:' + o.key] = o.value ?? ''; });
    rows.push({ cells, level: e.level || 'none', grade: e.grade, station: s });
  });
  // drop columns that are empty in every row (keeps tables readable), but keep the identity columns
  const keep = cols.filter(c => c.key.startsWith('_') && !['_place', '_el', '_role', '_with', '_linked', '_note'].includes(c.key) || rows.some(r => r.cells[c.key] !== '' && r.cells[c.key] != null));
  return { columns: keep, rows };
}

export function criteriaLines(t) {
  const lines = [];
  if (t.criteriaNote) lines.push(t.criteriaNote);
  (t.params || []).forEach(p => {
    const v = t.paramValues[p.key];
    if (p.kind === 'pairs') lines.push(`${p.label}: ${v.length} คู่ค่า (${v[0]?.join('→')} ถึง ${v.at(-1)?.join('→')})`);
    else if (p.kind === 'map') lines.push(`${p.label}: ${Object.entries(v).map(([k, x]) => `${k} ${x}`).join(', ')}`);
    else lines.push(`${p.label}: ${v}${p.unit ? ' ' + p.unit : ''}`);
  });
  return lines;
}
export function bandRows(t) {
  const out = [];
  for (const [vn, bands] of Object.entries(t.bands || {})) {
    (bands || []).forEach(b => out.push({ variant: vn === 'default' ? '' : vn, range: rangeText(b), label: b.label, level: b.level }));
  }
  return out;
}
const rangeText = (b) => {
  const lo = b.min === '' || b.min == null ? null : b.min, hi = b.max === '' || b.max == null ? null : b.max;
  if (lo != null && hi != null) return `${lo} ถึงน้อยกว่า ${hi}`;
  if (lo != null) return `ตั้งแต่ ${lo} ขึ้นไป`;
  if (hi != null) return `น้อยกว่า ${hi}`;
  return 'ทุกค่า';
};
const colHead = (c) => c.label + (c.unit ? ` (${c.unit})` : '');

// ------------------------------------------------------------------ dialog
export async function exportTestsDialog(projectId) {
  const model0 = await buildTestModel(projectId);
  const { project, floors } = model0;
  if (!model0.stations.length) { toast('ยังไม่มีจุดทดสอบในโครงการนี้', 'error'); return; }
  const prefs = await db.getMeta('testExportPrefs', {});
  const org = await db.getMeta('orgName', DEFAULT_ORG);
  const body = h(`<div>
    <div class="sec-title" style="margin-top:0">1. เลือกรูปแบบไฟล์</div>
    <div class="exp-formats">
      <label><input type="radio" name="tfmt" value="word" ${prefs.fmt !== 'csv' && prefs.fmt !== 'excel' ? 'checked' : ''}><span class="fi" style="background:#2b579a">W</span><b>Word — ตารางผล</b><span>แยกตามชนิดการทดสอบ พร้อมแปลนและเกณฑ์</span></label>
      <label><input type="radio" name="tfmt" value="csv" ${prefs.fmt === 'csv' ? 'checked' : ''}><span class="fi" style="background:#475569">CSV</span><b>CSV</b><span>1 ไฟล์ต่อชนิด ค่าดิบแยกคอลัมน์</span></label>
      <label><input type="radio" name="tfmt" value="excel" ${prefs.fmt === 'excel' ? 'checked' : ''}><span class="fi" style="background:#217346">X</span><b>Excel (.xlsx)</b><span>1 ชีตต่อชนิด + สรุป + เกณฑ์</span></label>
    </div>
    <div class="sec-title">2. การทดสอบที่ส่งออก</div>
    <div class="floor-picks" id="tTypes">${model0.types.map(t => `<label class="chip on"><input type="checkbox" name="ttype" value="${t.id}" checked>${esc(t.short)} <span class="muted">(${model0.stations.filter(s => s.tests?.[t.id]).length})</span></label>`).join('')}</div>
    <div class="sec-title">3. ตัวเลือก</div>
    <div class="exp-opts">
      <label class="ck"><input type="checkbox" name="includeEmpty" ${prefs.includeEmpty !== false ? 'checked' : ''}><span>รวมจุดที่ปักตำแหน่งไว้แต่ยังไม่บันทึกค่า</span></label>
      <label class="ck" data-w><input type="checkbox" name="plans" ${prefs.plans !== false ? 'checked' : ''}><span>แปลนตำแหน่งจุดทดสอบ (แยกตามชนิด)</span></label>
      <label class="ck" data-w><input type="checkbox" name="criteria" ${prefs.criteria !== false ? 'checked' : ''}><span>ตารางเกณฑ์ประเมินที่ใช้ และสรุปจำนวนตามผลประเมิน</span></label>
      <label class="fld" data-w style="margin-top:6px;max-width:300px"><span>ความละเอียดแปลน (หน้า A3)</span><select name="planDpi" class="inp"><option value="200" ${prefs.planDpi == 200 ? 'selected' : ''}>200 dpi (ไฟล์เล็กกว่า)</option><option value="300" ${prefs.planDpi != 200 ? 'selected' : ''}>300 dpi (คมที่สุด)</option></select></label>
      <label class="fld" data-w style="margin-top:6px"><span>ชื่อหน่วยงานผู้จัดทำ (หัวกระดาษ)</span><input type="text" name="org" value="${esc(org)}"></label>
    </div>
    <div class="fld"><span>ชั้น / แปลน</span><div class="floor-picks">${floors.map(f => `<label class="chip on"><input type="checkbox" name="tfloor" value="${f.id}" checked>${esc(f.name)}</label>`).join('')}</div></div>
    <div id="expProg" style="display:none"><p class="muted" id="expMsg" style="margin:10px 0 0"></p><div class="progress"><div id="expBar"></div></div></div>
  </div>`);
  $$('.floor-picks .chip', body).forEach(c => $('input', c).onchange = (e) => c.classList.toggle('on', e.target.checked));
  const sync = () => { const f = $('[name=tfmt]:checked', body).value; $$('[data-w]', body).forEach(x => { x.style.display = f === 'word' ? '' : 'none'; }); };
  $$('[name=tfmt]', body).forEach(r => r.onchange = sync); sync();
  modal({
    title: `ส่งออกผลทดสอบ — ${project.name}`, body, wide: true,
    actions: [{ label: 'ยกเลิก', value: null }, { label: 'ส่งออก', kind: 'primary', onClick: async (b) => {
      const opts = {
        fmt: $('[name=tfmt]:checked', b).value,
        types: $$('[name=ttype]:checked', b).map(x => x.value),
        floorIds: $$('[name=tfloor]:checked', b).map(x => x.value),
        includeEmpty: $('[name=includeEmpty]', b).checked, plans: $('[name=plans]', b).checked, criteria: $('[name=criteria]', b).checked,
        org: $('[name=org]', b).value.trim(), planDpi: +$('[name=planDpi]', b).value,
      };
      if (!opts.types.length || !opts.floorIds.length) { toast('เลือกการทดสอบและชั้นอย่างน้อยอย่างละ 1', 'error'); return false; }
      await db.setMeta('testExportPrefs', opts); await db.setMeta('orgName', opts.org);
      $('#expProg', b).style.display = '';
      const prog = (m, f) => { $('#expMsg', b).textContent = m; if (f != null) $('#expBar', b).style.width = Math.round(f * 100) + '%'; };
      try {
        const model = await buildTestModel(projectId, opts.floorIds);
        model.types = model.types.filter(t => opts.types.includes(t.id));
        if (!model.types.length) { toast('ไม่มีจุดทดสอบในชั้นที่เลือก', 'error'); return false; }
        if (opts.fmt === 'csv') await exportCsv(model, opts);
        else if (opts.fmt === 'excel') await exportXlsx(model, opts, prog);
        else await exportWordTables(model, opts, prog);
        return true;
      } catch (e) { console.error(e); toast('ส่งออกไม่สำเร็จ: ' + e.message, 'error', 6000); $('#expProg', b).style.display = 'none'; return false; }
    } }],
  });
}

const base = (p) => safeName(`${p.code ? p.code + ' ' : ''}${p.name}`);

// ------------------------------------------------------------------ CSV
const csvCell = (v) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
function toCsv(tbl) {
  const lines = [tbl.columns.map(c => csvCell(colHead(c))).join(',')];
  tbl.rows.forEach(r => lines.push(tbl.columns.map(c => csvCell(r.cells[c.key])).join(',')));
  return '﻿' + lines.join('\r\n');
}
async function exportCsv(model, opts) {
  const files = model.types.map(t => ({ name: `${safeName(t.short)}.csv`, text: toCsv(typeTable(model, t, { split: true, includeEmpty: opts.includeEmpty })) }));
  if (files.length === 1) download(new Blob([files[0].text], { type: 'text/csv;charset=utf-8' }), `${base(model.project)} - ผลทดสอบ ${files[0].name}`);
  else {
    await loadScript('vendor/jszip.min.js');
    const zip = new JSZip();
    files.forEach(f => zip.file(f.name, f.text));
    download(await zip.generateAsync({ type: 'blob' }), `${base(model.project)} - ผลทดสอบ (CSV).zip`);
  }
  toast('ส่งออก CSV แล้ว', 'ok');
}

// ------------------------------------------------------------------ Excel
async function exportXlsx(model, opts, prog) {
  prog('กำลังเตรียมข้อมูล', 0.2);
  await loadScript('vendor/xlsx.full.min.js');
  const wb = XLSX.utils.book_new();
  const summary = [['การทดสอบ', 'จำนวนจุด', ...Object.values(LEVEL).map(l => l.text)]];
  const lvKeys = Object.keys(LEVEL);
  const used = new Set();
  for (const t of model.types) {
    const tbl = typeTable(model, t, { split: true, includeEmpty: opts.includeEmpty });
    const aoa = [[t.label], [], tbl.columns.map(colHead), ...tbl.rows.map(r => tbl.columns.map(c => { const v = r.cells[c.key]; return v !== '' && !isNaN(+v) && typeof v !== 'boolean' && !String(v).includes(' ') ? +v : v; }))];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = tbl.columns.map(c => ({ wch: Math.min(40, Math.max(6, colHead(c).length + 1, ...tbl.rows.map(r => String(r.cells[c.key] ?? '').length + 1))) }));
    let name = t.short.replace(/[\\/?*[\]:]/g, '').slice(0, 28); while (used.has(name)) name += '_'; used.add(name);
    XLSX.utils.book_append_sheet(wb, ws, name);
    summary.push([t.short, tbl.rows.length, ...lvKeys.map(k => tbl.rows.filter(r => r.level === k).length)]);
  }
  const ws = XLSX.utils.aoa_to_sheet(summary);
  ws['!cols'] = [{ wch: 18 }, { wch: 10 }, ...lvKeys.map(() => ({ wch: 14 }))];
  XLSX.utils.book_append_sheet(wb, ws, 'สรุป');
  const crit = [['การทดสอบ', 'กลุ่ม', 'ช่วงค่า', 'ผลการประเมิน', 'ระดับ']];
  model.types.forEach(t => {
    criteriaLines(t).forEach(l => crit.push([t.short, '', l, '', '']));
    bandRows(t).forEach(b => crit.push([t.short, b.variant, b.range, b.label, LEVEL[b.level]?.text || '']));
  });
  const wc = XLSX.utils.aoa_to_sheet(crit); wc['!cols'] = [{ wch: 14 }, { wch: 14 }, { wch: 60 }, { wch: 34 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, wc, 'เกณฑ์ที่ใช้');
  XLSX.writeFile(wb, `${base(model.project)} - ผลทดสอบ.xlsx`);
  toast('ส่งออก Excel แล้ว', 'ok');
}

// ------------------------------------------------------------------ Word
const FONT = 'TH SarabunPSK';
const FONTS = { ascii: FONT, hAnsi: FONT, cs: FONT, eastAsia: FONT };
async function exportWordTables(model, opts, prog) {
  prog('กำลังโหลดไลบรารี', 0.05);
  await loadScript('vendor/docx.iife.js');
  const D = window.docx;
  const { planCanvas } = await import('./export.js');
  const p = model.project;
  const PW = 11906, PH = 16838, M = 1134;
  const run = (text, o = {}) => new D.TextRun({ text: String(text ?? ''), font: o.symbol ? 'Segoe UI Symbol' : FONTS, size: o.size || 28, sizeComplexScript: o.size || 28, bold: o.bold, boldComplexScript: o.bold, color: o.color });
  const para = (children, o = {}) => new D.Paragraph({ children: Array.isArray(children) ? children : [run(children, o)], alignment: o.align, spacing: { before: o.before ?? 0, after: o.after ?? 0 }, heading: o.heading, keepNext: o.keepNext });
  const bd = { style: D.BorderStyle.SINGLE, size: 4, color: '000000' };
  const cell = (text, o = {}) => new D.TableCell({
    children: String(text ?? '').split('\n').map(l => para(l, { size: o.size || 24, bold: o.bold, align: o.align, color: o.color })),
    borders: { top: bd, bottom: bd, left: bd, right: bd }, verticalAlign: D.VerticalAlign.CENTER, columnSpan: o.span,
    shading: o.fill ? { fill: o.fill, type: D.ShadingType.CLEAR, color: 'auto' } : undefined,
    margins: { top: 30, bottom: 30, left: 60, right: 60 }, width: o.w ? { size: o.w, type: D.WidthType.DXA } : undefined,
  });
  const table = (rows, widths) => new D.Table({ rows, columnWidths: widths, width: { size: widths.reduce((a, b) => a + b, 0), type: D.WidthType.DXA }, layout: D.TableLayoutType.FIXED });
  const header = () => new D.Header({ children: [para([run(`${opts.org ? opts.org + '  |  ' : ''}ผลการทดสอบ โครงการ ${p.name}`, { size: 22, color: '666666' })], { align: D.AlignmentType.RIGHT })] });
  const footer = () => new D.Footer({ children: [new D.Paragraph({ alignment: D.AlignmentType.RIGHT, children: [new D.TextRun({ children: ['หน้า ', D.PageNumber.CURRENT], font: FONTS, size: 22, sizeComplexScript: 22, color: '666666' })] })] });
  const section = (children, land) => ({
    properties: { page: { size: { width: PW, height: PH, orientation: land ? D.PageOrientation.LANDSCAPE : D.PageOrientation.PORTRAIT }, margin: { top: M, bottom: M, left: M, right: M } } },
    headers: { default: header() }, footers: { default: footer() }, children,
  });
  const imgRun = async (c, maxW, maxH) => {
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    const s = Math.min(maxW / c.width, maxH / c.height);
    return new D.ImageRun({ type: 'png', data: new Uint8Array(await blob.arrayBuffer()), transformation: { width: Math.round(c.width * s), height: Math.round(c.height * s) } });
  };
  const sections = [];
  for (let ti = 0; ti < model.types.length; ti++) {
    const t = model.types[ti];
    prog(`กำลังสร้างตาราง ${t.short}`, 0.1 + 0.85 * ti / model.types.length);
    const tbl = typeTable(model, t, { split: false, includeEmpty: opts.includeEmpty });
    const land = tbl.columns.length > 7;
    const CW = (land ? PH : PW) - 2 * M;
    const children = [para([run(`ผลการทดสอบ: ${t.label}`, { size: 34, bold: true, color: '1F3A5F' })], { heading: D.HeadingLevel.HEADING_1, after: 120, keepNext: true }),
      para([run(`จำนวน ${tbl.rows.length} จุด`, { size: 26, color: '555555' })], { after: 120 })];
    if (opts.plans) {
      // location plans on A3 pages (one per floor), the result table stays on A4
      for (const f of model.floors) {
        const sts = tbl.rows.filter(r => model.floorOf(r.station)?.id === f.id);
        if (!sts.length) continue;
        const items = sts.map(r => ({ d: { shape: 'point', pts: r.station.pts }, no: codeOf(r.station, t.id), color: levelColor(r.level) === '#ffffff' ? '#64748b' : levelColor(r.level) }));
        const pl = f.w >= f.h, pw = pl ? 420 : 297, ph = pl ? 297 : 420;
        const boxMm = [pw - 40, ph - 40 - 24];
        const c = await planCanvas(f, items, { boxMm, dpi: opts.planDpi || 300, markerScale: 1 });
        const mmPx = (v) => v / 25.4 * 96;
        sections.push({
          properties: { page: { size: { width: 16838, height: 23811, orientation: pl ? D.PageOrientation.LANDSCAPE : D.PageOrientation.PORTRAIT }, margin: { top: M, bottom: M, left: M, right: M } } },
          headers: { default: header() }, footers: { default: footer() },
          children: [...(sections.length && sections.at(-1)._type === t.id ? [] : children.splice(0)),
            para([run(`ตำแหน่งจุดทดสอบ ${t.short} — ${f.name}`, { size: 30, bold: true })], { after: 80, keepNext: true }),
            para([await imgRun(c, mmPx(boxMm[0]), mmPx(boxMm[1]))], { align: D.AlignmentType.CENTER })],
          _type: t.id,
        });
        c.width = c.height = 0;
      }
    }
    // result table
    const fixed = { _n: 600, _code: 1000, _floor: 1200, _grade: 1700 };
    const flexCols = tbl.columns.filter(c => !fixed[c.key]);
    const rest = CW - tbl.columns.filter(c => fixed[c.key]).reduce((s, c) => s + fixed[c.key], 0);
    const widths = tbl.columns.map(c => fixed[c.key] || Math.floor(rest / Math.max(1, flexCols.length)));
    const rows = [new D.TableRow({ tableHeader: true, children: tbl.columns.map((c, i) => cell(colHead(c), { fill: HEAD_FILL, bold: true, align: D.AlignmentType.CENTER, size: 22, w: widths[i] })) })];
    tbl.rows.forEach(r => rows.push(new D.TableRow({ cantSplit: true, children: tbl.columns.map((c, i) => {
      const v = r.cells[c.key];
      if (c.key === '_grade') {
        const col = levelColor(r.level);
        const colored = r.level !== 'none' && r.level !== 'info';
        return cell(v || '-', { size: 22, align: D.AlignmentType.CENTER, fill: colored ? col.replace('#', '') : undefined, color: colored ? 'FFFFFF' : undefined, w: widths[i] });
      }
      return cell(v === '' || v == null ? '-' : v, { size: 22, align: ['_n', '_code'].includes(c.key) || typeof v === 'number' || !isNaN(+v) ? D.AlignmentType.CENTER : undefined, w: widths[i] });
    }) })));
    children.push(table(rows, widths));
    if (opts.criteria) {
      const counts = {};
      tbl.rows.forEach(r => { const k = r.grade || (r.level === 'none' ? 'ยังไม่บันทึกค่า' : LEVEL[r.level]?.text); counts[k] = (counts[k] || 0) + 1; });
      children.push(para([run('สรุปผลการประเมิน: ', { bold: true, size: 26 }), run(Object.entries(counts).map(([k, n]) => `${k} ${n} จุด`).join(' ; '), { size: 26 })], { before: 120, after: 80 }));
      children.push(para([run('เกณฑ์ที่ใช้ประเมิน', { bold: true, size: 26 })], { after: 40, keepNext: true }));
      criteriaLines(t).forEach(l => children.push(para([run('• ' + l, { size: 24 })], { after: 20 })));
      const br = bandRows(t);
      if (br.length) {
        const hasVar = br.some(b => b.variant);
        const w2 = hasVar ? [2200, 3400, 3600, 1400] : [4400, 4200, 1400];
        const hr = new D.TableRow({ tableHeader: true, children: [...(hasVar ? ['กลุ่ม'] : []), 'ช่วงค่า', 'ผลการประเมิน', 'ระดับ'].map((x, i) => cell(x, { fill: HEAD_FILL, bold: true, align: D.AlignmentType.CENTER, size: 22, w: w2[i] })) });
        const rr = br.map(b => new D.TableRow({ children: [...(hasVar ? [b.variant] : []), b.range, b.label, LEVEL[b.level]?.text || ''].map((x, i) => cell(x, { size: 22, w: w2[i] })) }));
        children.push(para('', { after: 60 }), table([hr, ...rr], w2));
      }
    }
    sections.push(section(children, land));
  }
  prog('กำลังรวมไฟล์ Word', 0.97);
  const doc = new D.Document({
    creator: opts.org || 'Inspect Recorder', title: `ผลการทดสอบ ${p.name}`,
    styles: { default: { document: { run: { font: FONTS, size: 28, sizeComplexScript: 28 } } },
      paragraphStyles: [{ id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: FONTS, size: 34, sizeComplexScript: 34, bold: true, boldComplexScript: true, color: '1F3A5F' } }] },
    sections: sections.map(({ _type, ...s }) => s),
  });
  download(await D.Packer.toBlob(doc), `${base(p)} - ผลทดสอบ.docx`);
  toast('ส่งออกตารางผลทดสอบ (Word) แล้ว', 'ok');
}

// ------------------------------------------------------------------ for the data pack (report.json)
export function testsReport(project, floors, stations) {
  const model = { project, floors, stations, floorOf: (s) => floors.find(f => f.id === s.floorId) };
  const types = allTypes(project, { includeHidden: true }).filter(t => stations.some(s => s.tests?.[t.id]));
  return types.map(t => {
    const tbl = typeTable(model, t, { split: false, includeEmpty: true });
    return {
      test: t.label, short: t.short, criteria: criteriaLines(t), bands: bandRows(t),
      columns: tbl.columns.map(colHead),
      rows: tbl.rows.map(r => Object.fromEntries(tbl.columns.map(c => [colHead(c), r.cells[c.key]]))),
    };
  });
}
