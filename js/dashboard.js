// Project overview (dashboard) + export as a sharp PNG for presenting to clients.
import { $, $$, esc, h, toast, download, loadScript, naturalCmp, safeName, thaiDateLong, polyArea } from './utils.js';
import { fieldByRole, severityInfo, NO_SEVERITY_COLOR, defectTitle, TYPE_LABELS } from './templates.js';
import { allTypes, evalTest, LEVEL, levelColor, codeOf, stationLabel } from './tests.js';

const NAVY = '#2c5282';
const LEVEL_ORDER = ['ok', 'warn', 'bad', 'na', 'info', 'none'];
const pct = (a, b) => (b ? Math.round(a / b * 100) : 0);
const dayKey = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

export function computeStats({ project, floors, defects, tests }) {
  const fo = new Map(floors.map((f, i) => [f.id, i]));
  const floorById = new Map(floors.map(f => [f.id, f]));
  // severity / urgency
  const sev = new Map(), urg = new Map(), heads = new Map();
  let worst = 0, urgent = 0, area = 0, areaN = 0;
  const sevRank = {};
  for (const d of defects) {
    const tpl = project.templates[d.type] || project.templates.structural;
    const sf = fieldByRole(tpl, 'severity'), uf = fieldByRole(tpl, 'urgency');
    const si = sf ? severityInfo(tpl, d.data?.[sf.key]) : null;
    const sKey = si ? si.label : 'ยังไม่ระบุ';
    if (!sev.has(sKey)) sev.set(sKey, { label: sKey, color: si ? si.color : '#cbd5e1', rank: si ? si.rank : -1, n: 0 });
    sev.get(sKey).n++;
    sevRank[d.id] = { label: sKey, color: si ? si.color : '#cbd5e1', rank: si ? si.rank : -1 };
    if (si && sf && si.rank === sf.options.length - 1) worst++;
    const u = uf ? (d.data?.[uf.key] || '') : '';
    const uKey = u || 'ยังไม่ระบุ';
    if (!urg.has(uKey)) urg.set(uKey, { label: uKey, n: 0, idx: uf ? uf.options.indexOf(u) : -1 });
    urg.get(uKey).n++;
    if (uf && u && uf.options.indexOf(u) === uf.options.length - 1) urgent++;
    const elF = fieldByRole(tpl, 'element');
    const title = defectTitle(project, d);
    const hk = `${elF ? (d.data?.[elF.key] || '') : ''}|${title}`;
    if (!heads.has(hk)) heads.set(hk, { label: title, el: elF ? d.data?.[elF.key] || '' : '', n: 0 });
    heads.get(hk).n++;
    const f = floorById.get(d.floorId);
    if (f?.scale && d.shape !== 'point') { area += polyArea(d.pts) * f.scale ** 2; areaN++; }
  }
  const sevList = [...sev.values()].sort((a, b) => b.rank - a.rank);
  const urgList = [...urg.values()].sort((a, b) => b.idx - a.idx);
  const headList = [...heads.values()].sort((a, b) => b.n - a.n);
  // per floor, stacked by severity
  const perFloor = floors.map(f => {
    const ds = defects.filter(d => d.floorId === f.id);
    const segs = sevList.map(s => ({ ...s, n: ds.filter(d => sevRank[d.id].label === s.label).length })).filter(s => s.n);
    return { floor: f, n: ds.length, tests: tests.filter(t => t.floorId === f.id).length, segs };
  });
  // tests per type
  const types = allTypes(project, { includeHidden: true }).map(t => {
    const sts = tests.filter(s => s.tests?.[t.id]);
    if (!sts.length) return null;
    const lv = {}; const grades = new Map();
    let rec = 0;
    sts.forEach(s => {
      const e = evalTest(project, s, t.id);
      const l = e.level || 'none';
      lv[l] = (lv[l] || 0) + 1;
      if (e.recorded) rec++;
      const gl = e.grade || (e.recorded ? 'บันทึกแล้ว (ไม่มีเกณฑ์ประเมิน)' : null);
      if (gl) { const g = grades.get(gl) || { label: gl, level: l, n: 0 }; g.n++; grades.set(gl, g); }
    });
    return { t, total: sts.length, rec, lv, grades: [...grades.values()].sort((a, b) => LEVEL_ORDER.indexOf(a.level) - LEVEL_ORDER.indexOf(b.level)) };
  }).filter(Boolean);
  const testTotal = types.reduce((s, x) => s + x.total, 0), testRec = types.reduce((s, x) => s + x.rec, 0);
  // field days & recorders
  const days = new Map(), people = new Map();
  for (const d of [...defects, ...tests]) {
    const k = dayKey(d.createdAt || 0);
    const r = days.get(k) || { day: k, defects: 0, tests: 0 };
    d.layer === 'test' ? r.tests++ : r.defects++;
    days.set(k, r);
    const who = d.createdBy || 'ไม่ระบุ';
    const p = people.get(who) || { who, defects: 0, tests: 0 };
    d.layer === 'test' ? p.tests++ : p.defects++;
    people.set(who, p);
  }
  // completeness (team only)
  const sevF = (d) => { const tpl = project.templates[d.type] || project.templates.structural; return fieldByRole(tpl, 'severity'); };
  const noPhoto = defects.filter(d => !d.photoIds?.length);
  const noSev = defects.filter(d => { const f = sevF(d); return f && !d.data?.[f.key]; });
  const noTitle = defects.filter(d => !(d.data?.title || '').trim());
  const notRecorded = [];
  tests.forEach(s => Object.keys(s.tests || {}).forEach(id => { if (!evalTest(project, s, id).recorded) notRecorded.push({ s, id }); }));
  return {
    totals: { defects: defects.length, worst, urgent, area, areaN, tests: tests.length, testTotal, testRec, floors: floors.length },
    sevList, urgList, headList, perFloor, types,
    days: [...days.values()].sort((a, b) => a.day.localeCompare(b.day)),
    people: [...people.values()].sort((a, b) => (b.defects + b.tests) - (a.defects + a.tests)),
    gaps: { noPhoto, noSev, noTitle, notRecorded },
    floorName: (id) => floorById.get(id)?.name || '', fo,
  };
}

const bar = (label, n, max, color, extra = '', title = '') => `
  <div class="db-row" ${extra} title="${esc(title || `${label}: ${n}`)}">
    <span class="db-lab">${esc(label)}</span>
    <span class="db-track"><span class="db-fill" style="width:${max ? Math.max(n ? 1.5 : 0, n / max * 100) : 0}%;background:${color}"></span></span>
    <span class="db-val">${n}</span></div>`;

const stacked = (segs, total, max) => `<span class="db-track"><span class="db-stack" style="width:${max ? total / max * 100 : 0}%">${segs.map(s => `<span style="flex:${s.n};background:${s.color}" title="${esc(s.label)}: ${s.n}"></span>`).join('')}</span></span>`;

export function renderDashboard(root, ctx) {
  const { project: p, editable } = ctx;
  const st = computeStats(ctx);
  const T = st.totals;
  const sevMax = Math.max(1, ...st.sevList.map(s => s.n));
  const urgMax = Math.max(1, ...st.urgList.map(s => s.n));
  const headTop = st.headList.slice(0, 10);
  const headMax = Math.max(1, ...headTop.map(s => s.n));
  const floorMax = Math.max(1, ...st.perFloor.map(f => f.n));
  const dayMax = Math.max(1, ...st.days.map(d => d.defects + d.tests));
  const now = new Date();
  root.innerHTML = '';
  const el = h(`<div class="dash" id="dashRoot">
    <div class="db-head">
      <div><div class="db-code">${esc(p.code || '')}</div><h2>${esc(p.name)}</h2>
        <div class="db-meta">${[p.client, p.location, p.inspector ? 'ผู้ตรวจสอบ: ' + p.inspector : '', p.inspectDate ? 'วันที่ตรวจสอบ: ' + thaiDateLong(p.inspectDate) : ''].filter(Boolean).map(esc).join(' • ')}</div></div>
      <div class="db-asof">ข้อมูล ณ ${now.toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' })} ${now.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น.</div>
    </div>
    <div class="db-kpis">
      <div class="kpi"><span>จุดความเสียหาย</span><b>${T.defects}</b><small>ใน ${T.floors} ชั้น/แปลน</small></div>
      <div class="kpi"><span>ระดับรุนแรงที่สุด</span><b style="color:#c62828">${T.worst}</b><small>${pct(T.worst, T.defects)}% ของจุดทั้งหมด</small></div>
      <div class="kpi"><span>เร่งด่วน</span><b style="color:#c2410c">${T.urgent}</b><small>${pct(T.urgent, T.defects)}% ของจุดทั้งหมด</small></div>
      <div class="kpi"><span>พื้นที่เสียหายรวม</span><b>${T.areaN ? T.area.toFixed(1) : '–'}</b><small>${T.areaN ? `ตร.ม. จาก ${T.areaN} พื้นที่ที่วาดบนแปลน` : 'ยังไม่มีพื้นที่ที่คำนวณได้'}</small></div>
      <div class="kpi"><span>การทดสอบ</span><b>${T.testRec}<i>/${T.testTotal}</i></b><small>บันทึกผลแล้ว ${pct(T.testRec, T.testTotal)}% (${T.tests} จุด)</small></div>
    </div>
    <div class="db-grid">
      <section class="db-card"><h3>ระดับความเสียหาย</h3>${st.sevList.map(s => bar(s.label, s.n, sevMax, s.color, '', `${s.label}: ${s.n} จุด (${pct(s.n, T.defects)}%)`)).join('') || '<p class="muted">ยังไม่มีข้อมูล</p>'}</section>
      <section class="db-card"><h3>ความเร่งด่วน</h3>${st.urgList.map(s => bar(s.label, s.n, urgMax, s.label === 'ยังไม่ระบุ' ? '#cbd5e1' : NAVY)).join('') || '<p class="muted">ยังไม่มีข้อมูล</p>'}</section>
      <section class="db-card wide"><h3>หัวข้อความเสียหายที่พบมากที่สุด${st.headList.length > 10 ? ` <small>(10 จาก ${st.headList.length} หัวข้อ)</small>` : ''}</h3>
        ${headTop.map(s => bar((s.el ? s.el + ' – ' : '') + s.label, s.n, headMax, NAVY)).join('') || '<p class="muted">ยังไม่มีข้อมูล</p>'}</section>
      <section class="db-card wide"><h3>จำนวนจุดความเสียหายแยกตามชั้น <small>(สีตามระดับความเสียหาย • กดเพื่อเปิดชั้นนั้น)</small></h3>
        ${st.perFloor.map(f => `<div class="db-row click" data-floor="${f.floor.id}" title="${esc(f.floor.name)}: ${f.n} จุด${f.tests ? ` • จุดทดสอบ ${f.tests}` : ''}"><span class="db-lab">${esc(f.floor.name)}</span>${stacked(f.segs, f.n, floorMax)}<span class="db-val">${f.n}</span></div>`).join('') || '<p class="muted">ยังไม่มีแปลน</p>'}
        <div class="db-legend">${st.sevList.map(s => `<span><i style="background:${s.color}"></i>${esc(s.label)}</span>`).join('')}</div></section>
      ${st.types.length ? `<section class="db-card wide"><h3>ผลการทดสอบแยกตามวิธี</h3>
        <div class="db-tests">${st.types.map(x => `<div class="db-test">
          <div class="dt-head"><b>${esc(x.t.short)}</b><span>บันทึกผลแล้ว ${x.rec}/${x.total} จุด</span></div>
          <div class="dt-prog"><span style="width:${pct(x.rec, x.total)}%"></span></div>
          <div class="dt-stack">${LEVEL_ORDER.filter(l => x.lv[l]).map(l => `<span style="flex:${x.lv[l]};background:${l === 'none' ? '#e5e7eb' : levelColor(l)}" title="${esc(LEVEL[l].text)}: ${x.lv[l]}"></span>`).join('')}</div>
          <div class="dt-grades">${x.grades.map(g => `<span><i style="background:${levelColor(g.level)}"></i>${esc(g.label)} <b>${g.n}</b></span>`).join('')}${x.lv.none ? `<span><i style="background:#e5e7eb"></i>ยังไม่บันทึกค่า <b>${x.lv.none}</b></span>` : ''}</div>
        </div>`).join('')}</div></section>` : ''}
      <section class="db-card"><h3>การลงพื้นที่ (จำนวนจุดที่บันทึกต่อวัน)</h3>
        ${st.days.map(d => `<div class="db-row" title="${d.day}: ความเสียหาย ${d.defects} • ทดสอบ ${d.tests}"><span class="db-lab">${new Date(d.day + 'T00:00').toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })}</span>
          ${stacked([{ n: d.defects, color: NAVY, label: 'ความเสียหาย' }, { n: d.tests, color: '#0f766e', label: 'จุดทดสอบ' }].filter(s => s.n), d.defects + d.tests, dayMax)}<span class="db-val">${d.defects + d.tests}</span></div>`).join('') || '<p class="muted">ยังไม่มีข้อมูล</p>'}
        <div class="db-legend"><span><i style="background:${NAVY}"></i>ความเสียหาย</span><span><i style="background:#0f766e"></i>จุดทดสอบ</span></div></section>
      <section class="db-card"><h3>ผู้บันทึก</h3>
        <table class="db-tbl"><thead><tr><th>ชื่อ</th><th>ความเสียหาย</th><th>จุดทดสอบ</th></tr></thead><tbody>
        ${st.people.map(x => `<tr><td>${esc(x.who)}</td><td>${x.defects}</td><td>${x.tests}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">ยังไม่มีข้อมูล</td></tr>'}</tbody></table></section>
      ${editable ? `<section class="db-card wide team-only"><h3>ความครบถ้วนของข้อมูล <small>(เห็นเฉพาะทีมในโหมดแก้ไข ไม่รวมในภาพที่ส่งออก)</small></h3>
        <div class="db-gaps">
          ${gapList('ความเสียหายที่ยังไม่มีรูป', st.gaps.noPhoto.map(d => ({ id: d.id, mode: 'defect', floor: d.floorId, text: `จุดที่ ${d.no}`, sub: st.floorName(d.floorId) })))}
          ${gapList('ยังไม่ระบุระดับความเสียหาย', st.gaps.noSev.map(d => ({ id: d.id, mode: 'defect', floor: d.floorId, text: `จุดที่ ${d.no}`, sub: st.floorName(d.floorId) })))}
          ${gapList('ยังไม่ระบุหัวข้อความเสียหาย', st.gaps.noTitle.map(d => ({ id: d.id, mode: 'defect', floor: d.floorId, text: `จุดที่ ${d.no}`, sub: st.floorName(d.floorId) })))}
          ${gapList('จุดทดสอบที่ยังไม่บันทึกค่า', st.gaps.notRecorded.map(({ s, id }) => ({ id: s.id, mode: 'test', floor: s.floorId, text: codeOf(s, id), sub: st.floorName(s.floorId) })))}
        </div></section>` : ''}
    </div>
    <div class="db-foot">${esc(ctx.org || '')}</div>
  </div>`);
  root.appendChild(el);
  $$('[data-floor]', el).forEach(r => r.onclick = () => ctx.onGoto('defect', r.dataset.floor));
  $$('[data-goto]', el).forEach(a => a.onclick = (e) => { e.preventDefault(); ctx.onGoto(a.dataset.mode, a.dataset.fl, a.dataset.goto); });
}

function gapList(title, items) {
  const naturalItems = [...items].sort((a, b) => naturalCmp(a.text, b.text));
  return `<div class="db-gap"><b>${esc(title)} <span class="${items.length ? 'n bad' : 'n ok'}">${items.length}</span></b>
    ${items.length ? `<div class="db-gap-list">${naturalItems.slice(0, 60).map(i => `<a href="#" data-goto="${i.id}" data-mode="${i.mode}" data-fl="${i.floor}" title="${esc(i.sub)}">${esc(i.text)}</a>`).join('')}${items.length > 60 ? ` <span class="muted">และอีก ${items.length - 60}</span>` : ''}</div>` : '<div class="muted" style="font-size:13px">ครบแล้ว ✓</div>'}</div>`;
}

// Export the dashboard as a PNG (rendered at ~3x for projectors / slides). Team-only parts are left out.
export async function exportDashboardPng(project) {
  const src = $('#dashRoot');
  if (!src) return;
  await loadScript('vendor/html2canvas.min.js');
  try { await document.fonts.ready; } catch { /* */ }
  const holder = h('<div style="position:fixed;left:-10000px;top:0;width:1600px;background:#f4f6f8"></div>');
  const clone = src.cloneNode(true);
  clone.classList.add('dash-export');
  $$('.team-only', clone).forEach(x => x.remove());
  holder.appendChild(clone);
  document.body.appendChild(holder);
  const busy = h('<div class="toast" style="position:fixed;bottom:80px;left:50%;transform:translateX(-50%);z-index:2100">กำลังสร้างภาพ…</div>');
  document.body.appendChild(busy);
  try {
    const c = await html2canvas(clone, { scale: 2.4, backgroundColor: '#f4f6f8', logging: false, windowWidth: 1600 });
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    download(blob, `${safeName(`${project.code ? project.code + ' ' : ''}${project.name}`)} - ภาพรวมโครงการ.png`);
    toast(`ส่งออกภาพ Dashboard แล้ว (${c.width}×${c.height} px)`, 'ok', 3500);
  } catch (e) { console.error(e); toast('สร้างภาพไม่สำเร็จ: ' + e.message, 'error'); }
  finally { holder.remove(); busy.remove(); }
}
