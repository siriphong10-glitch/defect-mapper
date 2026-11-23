// Right-hand panel for a test station, list rendering helpers and the criteria editor.
import { $, $$, esc, h, modal, confirmBox, toast, debounce, download, pickFiles } from './utils.js';
import { db } from './db.js';
import { LEVEL, ELEMENTS, ROLES, allTypes, typeDef, evalTest, stationLevel, levelColor, settingsOf, BUILTIN, PRESETS, codeOf, allCodes, nextCode, typePrefix } from './tests.js';
import { keypadEnabled, setKeypad, applyMode } from './keypad.js';

const cssLevel = (l) => `background:${levelColor(l)};color:${l === 'none' ? 'var(--ink-3)' : '#fff'};${l === 'none' ? 'border:1px solid var(--line)' : ''}`;

export function chip(level, text) {
  return `<span class="tchip" style="${cssLevel(level || 'none')}">${esc(text)}</span>`;
}

// short status chips for list items
export function stationChips(project, st) {
  return Object.keys(st.tests || {}).map(id => {
    const t = typeDef(project, id); if (!t) return '';
    const e = evalTest(project, st, id);
    return chip(e.level || 'none', codeOf(st, id) + ' ' + t.short + (e.grade ? ' · ' + e.grade.replace(/\s*\(.*\)$/, '') : e.recorded ? '' : ' · —'));
  }).join('');
}

// ------------------------------------------------------------------ station panel
// ctx: { project, station, floor, editable, stations, onSave(st,{redraw}), onDelete(st), onClose(), onCodeChange() }
export function buildTestPanel(box, ctx) {
  const { project, station: st, editable } = ctx;
  st.tests ||= {};
  const save = debounce(() => ctx.onSave(st), 350);
  const el = h(`<div style="display:contents">
    <div class="rhead"><h4>จุดทดสอบ</h4><button class="icon-btn" id="rClose" title="ปิด (Esc)">✕</button></div>
    <div class="rbody" data-kp-scope>
      <div class="hint" style="margin:-4px 0 10px">${esc(ctx.floor?.name || '')} • แต่ละการทดสอบมีรหัสของตัวเอง แก้ได้ที่หัวการ์ด</div>
      <div class="fld"><span>ประเภทจุด</span><div class="seg" id="roleSeg">${Object.entries(ROLES).map(([k, v]) => `<button data-role="${k}" class="${(st.role || '') === k ? 'on' : ''}">${v}</button>`).join('')}</div></div>
      <div class="row">
        <label class="fld"><span>ชิ้นส่วน</span><select id="fEl"><option value="">— เลือก —</option>${ELEMENTS.map(x => `<option ${x === st.element ? 'selected' : ''}>${x}</option>`).join('')}${st.element && !ELEMENTS.includes(st.element) ? `<option selected>${esc(st.element)}</option>` : ''}</select></label>
        <label class="fld"><span>วันที่ทดสอบ</span><input type="date" id="fDate" value="${esc(st.date || '')}"></label>
      </div>
      <label class="fld"><span>ตำแหน่ง / กริดไลน์</span><input type="text" id="fPlace" value="${esc(st.place || '')}" placeholder="เช่น เสา C-3 ชั้น 8"></label>
      <label class="fld"><span>เกี่ยวข้องกับความเสียหายจุดที่</span><input type="text" id="fLinked" value="${esc(st.linked || '')}" placeholder="เช่น 12, 14"></label>
      <div id="tcards"></div>
      <button class="btn sm edit-only" id="addTest" style="margin:2px 0 12px">＋ เพิ่มการทดสอบที่จุดนี้</button>
      <label class="fld"><span>หมายเหตุ</span><textarea id="fNote" rows="2">${esc(st.note || '')}</textarea></label>
      <div class="sec-title">ภาพประกอบ</div>
      <div class="photos" id="photos"></div>
    </div>
    <div class="rfoot">
      <button class="btn sm danger edit-only" id="rDel">ลบจุดนี้</button>
      <button class="btn sm ghost edit-only" id="kpToggle" title="สลับระหว่างแป้นตัวเลขบนจอกับคีย์บอร์ดของเครื่อง">${keypadEnabled() ? '⌨ ใช้คีย์บอร์ดเครื่อง' : '🔢 ใช้แป้นตัวเลขบนจอ'}</button>
      <span class="spacer"></span>
      <button class="btn sm primary" id="rDone">${editable ? 'เสร็จ' : 'ปิด'}</button>
    </div></div>`);
  box.appendChild(el);
  $('#rClose', box).onclick = $('#rDone', box).onclick = () => ctx.onClose();
  $('#rDel', box).onclick = () => ctx.onDelete(st);
  $('#kpToggle', box).onclick = (e) => { setKeypad(!keypadEnabled()); e.currentTarget.textContent = keypadEnabled() ? '⌨ ใช้คีย์บอร์ดเครื่อง' : '🔢 ใช้แป้นตัวเลขบนจอ'; };

  st.codes ||= {};
  const syncPrimary = () => { const ids = Object.keys(st.tests); st.code = ids.length ? (st.codes[ids[0]] || st.code) : st.code; };
  $$('[data-role]', box).forEach(b => b.onclick = () => { if (!editable) return; st.role = b.dataset.role; $$('[data-role]', box).forEach(x => x.classList.toggle('on', x === b)); save(); ctx.onCodeChange(); });
  $('#fEl', box).onchange = (e) => { st.element = e.target.value; save(); ctx.onCodeChange(); };
  $('#fDate', box).onchange = (e) => { st.date = e.target.value; save(); };
  $('#fPlace', box).oninput = (e) => { st.place = e.target.value; save(); };
  $('#fLinked', box).oninput = (e) => { st.linked = e.target.value; save(); };
  $('#fNote', box).oninput = (e) => { st.note = e.target.value; save(); };

  const cards = $('#tcards', box);
  const refreshResults = () => {
    $$('.tcard', cards).forEach(c => drawResult(c, c.dataset.id));
    ctx.onCodeChange();
  };
  const drawResult = (card, id) => {
    const e = evalTest(project, st, id);
    $('.tstat', card).outerHTML = `<span class="tstat">${chip(e.level || 'none', e.grade || (e.recorded ? LEVEL[e.level]?.text || 'บันทึกแล้ว' : 'ยังไม่บันทึกค่า'))}</span>`;
    const res = $('.tres', card);
    res.innerHTML = e.out.length ? e.out.map(o => `<div><span>${esc(o.label)}</span><b>${esc(o.value ?? '-')}${o.unit ? ' ' + esc(o.unit) : ''}</b></div>`).join('') : '';
    res.style.display = e.out.length ? '' : 'none';
  };

  const drawCards = () => {
    cards.innerHTML = '';
    for (const id of Object.keys(st.tests)) {
      const t = typeDef(project, id);
      if (!t) continue;
      const v = st.tests[id];
      const card = h(`<div class="tcard" data-id="${id}">
        <div class="thd"><input class="tcode" type="text" value="${esc(st.codes[id] || st.code)}" title="รหัสของการทดสอบนี้ (ไม่ซ้ำในโครงการ)"><b>${esc(t.short)}</b><span class="tstat"></span><span class="spacer"></span>
          <button class="icon-btn edit-only" data-rm title="ลบการทดสอบนี้ออกจากจุด">✕</button></div>
        <div class="err tcode-err"></div>
        ${t.locationFirst ? '<div class="hint" style="margin:-2px 0 6px">ปักตำแหน่งไว้ก่อน บันทึกค่าภายหลังได้</div>' : ''}
        <div class="tfields"></div><div class="tres"></div></div>`);
      const ci = $('.tcode', card);
      ci.oninput = () => {
        const val = ci.value.trim();
        const others = allCodes(ctx.stations.filter(s => s.id !== st.id)).concat(Object.entries(st.codes).filter(([k]) => k !== id).map(([, c]) => String(c).toLowerCase()));
        const err = !val ? 'กรุณาใส่รหัส' : others.includes(val.toLowerCase()) ? `รหัส “${val}” ซ้ำกับจุดอื่นแล้ว` : '';
        $('.tcode-err', card).textContent = err; ci.classList.toggle('bad', !!err);
        if (!err) { st.codes[id] = val; syncPrimary(); save(); ctx.onCodeChange(); }
      };
      ci.onblur = () => { if ($('.tcode-err', card).textContent) { ci.value = st.codes[id] || ''; $('.tcode-err', card).textContent = ''; ci.classList.remove('bad'); } };
      const fbox = $('.tfields', card);
      for (const f of t.fields) fbox.appendChild(fieldInput(f, v, () => { save(); refreshResults(); }, t));
      $('[data-rm]', card).onclick = async () => {
        const has = Object.values(v).some(x => x !== '' && x != null && !(Array.isArray(x) && !x.filter(y => y !== '').length));
        if (has && !(await confirmBox(`ลบการทดสอบ ${t.short} และค่าที่บันทึกไว้ออกจากจุดนี้?`, { ok: 'ลบ', danger: true }))) return;
        delete st.tests[id]; delete st.codes[id]; syncPrimary(); save.flush(); drawCards(); ctx.onCodeChange();
      };
      cards.appendChild(card);
      drawResult(card, id);
    }
    if (!Object.keys(st.tests).length) cards.appendChild(h('<p class="hint">ยังไม่มีการทดสอบที่จุดนี้ — กด “เพิ่มการทดสอบที่จุดนี้”</p>'));
    $$('input[data-kp]', cards).forEach(applyMode);
    if (!editable) disableAll();
  };
  $('#addTest', box).onclick = (e) => {
    const anchor = e.currentTarget;
    const avail = allTypes(project).filter(t => !st.tests[t.id]);
    import('./app.js').then(({ dropdown }) => dropdown(anchor, avail.map(t => ({ label: t.label, fn: () => {
      st.tests[t.id] = {};
      st.codes[t.id] = nextCode(project, ctx.stations, typePrefix(project, t.id));
      syncPrimary(); save.flush(); drawCards(); ctx.onCodeChange();
    } }))));
  };
  const disableAll = () => $$('input, select, textarea, .seg button, .tfields button', $('.rbody', box)).forEach(x => { x.disabled = true; });
  drawCards();
  if (!editable) disableAll();
}

function fieldInput(f, v, changed, t) {
  const lab = `<span>${esc(f.label)}${f.unit ? ` <i class="unit">(${esc(f.unit)})</i>` : ''}${t.required === f.key ? ' <i class="req">*</i>' : ''}</span>`;
  let el;
  if (f.kind === 'num') {
    el = h(`<label class="fld">${lab}<input type="text" data-kp value="${esc(v[f.key] ?? '')}" data-kp-label="${esc(f.label)}"></label>`);
    $('input', el).oninput = (e) => { v[f.key] = e.target.value.trim().replace(',', '.'); changed(); };
  } else if (f.kind === 'select') {
    el = h(`<label class="fld">${lab}<select><option value="">— เลือก —</option>${f.options.map(o => `<option ${o === v[f.key] ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></label>`);
    $('select', el).onchange = (e) => { v[f.key] = e.target.value; changed(); };
  } else if (f.kind === 'date') {
    el = h(`<label class="fld">${lab}<input type="date" value="${esc(v[f.key] || '')}"></label>`);
    $('input', el).onchange = (e) => { v[f.key] = e.target.value; changed(); };
  } else if (f.kind === 'readings') {
    const arr = Array.isArray(v[f.key]) ? v[f.key] : [];
    v[f.key] = arr;
    el = h(`<div class="fld">${lab}<div class="readings"></div><button type="button" class="btn sm ghost edit-only" style="align-self:flex-start">＋ เพิ่มช่อง</button></div>`);
    const grid = $('.readings', el);
    const draw = () => {
      grid.innerHTML = '';
      const n = Math.max(f.count || 5, arr.length);
      for (let i = 0; i < n; i++) {
        const c = h(`<label class="rcell"><i>${i + 1}</i><input type="text" data-kp value="${esc(arr[i] ?? '')}" data-kp-label="${esc(f.label)} ครั้งที่ ${i + 1}"></label>`);
        $('input', c).oninput = (e) => { arr[i] = e.target.value.trim().replace(',', '.'); for (let j = 0; j < i; j++) if (arr[j] == null) arr[j] = ''; changed(); };
        grid.appendChild(c);
      }
      $$('input[data-kp]', grid).forEach(applyMode);
    };
    draw();
    $('button', el).onclick = () => { arr.length = Math.max(f.count || 5, arr.length) + 1; for (let i = 0; i < arr.length; i++) if (arr[i] == null) arr[i] = ''; draw(); $$('input', grid).at(-1).focus(); };
  } else {
    el = h(`<label class="fld">${lab}<input type="text" value="${esc(v[f.key] || '')}" placeholder="${esc(f.ph || '')}"></label>`);
    $('input', el).oninput = (e) => { v[f.key] = e.target.value; changed(); };
  }
  return el;
}

// ------------------------------------------------------------------ type-set picker for new pins
export function pickTypeSet(anchor, project, onPick) {
  const ts = settingsOf(project);
  const cur = new Set(ts.lastSet || []);
  const types = allTypes(project);
  const single = cur.size === 1 ? [...cur][0] : null;
  const body = h(`<div class="dropdown tset">
    <div class="hint" style="padding:4px 8px">ชนิดการทดสอบของจุดที่จะปักต่อไป (1 จุด = 1 การทดสอบ เพิ่มการทดสอบอื่นที่ตำแหน่งเดียวกันได้ภายหลัง)</div>
    <div class="tset-list">${types.map(t => `<button data-one="${t.id}" class="${t.id === single ? 'on' : ''}"><span class="pre">${esc(t.prefix)}</span>${esc(t.label)}</button>`).join('')}</div>
    <hr><div class="hint" style="padding:2px 8px">หรือปักเป็นสถานีทดสอบหลายวิธีในครั้งเดียว</div>
    ${PRESETS.map((p, i) => `<button data-preset="${i}">⚡ ${esc(p.label)}</button>`).join('')}</div>`);
  $$('.dropdown').forEach(d => d.remove());
  document.body.appendChild(body);
  const r = anchor.getBoundingClientRect();
  body.style.left = Math.max(8, Math.min(window.innerWidth - body.offsetWidth - 8, r.left)) + 'px';
  body.style.top = Math.max(8, r.top - body.offsetHeight - 6) + 'px';
  const done = (ids) => { if (!ids.length) { toast('เลือกอย่างน้อย 1 ชนิด', 'error'); return; } ts.lastSet = ids; body.remove(); onPick(ids); };
  $$('[data-preset]', body).forEach(b => b.onclick = () => done(PRESETS[+b.dataset.preset].ids));
  $$('[data-one]', body).forEach(b => b.onclick = () => done([b.dataset.one]));
  setTimeout(() => {
    const off = (e) => { if (!body.contains(e.target)) { body.remove(); document.removeEventListener('mousedown', off); } };
    document.addEventListener('mousedown', off);
  });
}

// ------------------------------------------------------------------ criteria / test settings editor
const LEVEL_OPTS = ['ok', 'warn', 'bad', 'na', 'info'];
export function testSettingsEditor(project, onSaved) {
  const work = JSON.parse(JSON.stringify(settingsOf(project)));
  work.types ||= {}; work.custom ||= [];
  let cur = 'upv';
  const body = h(`<div class="tse">
    <p class="hint" style="margin-top:0">ปรับชื่อ รหัสนำหน้า ค่าพารามิเตอร์ และช่วงเกณฑ์ประเมินของแต่ละการทดสอบได้ เกณฑ์ที่ใช้จะพิมพ์ไว้ในตารางผลที่ส่งออกด้วย</p>
    <div class="tse-wrap"><div class="tse-nav"></div><div class="tse-main"></div></div></div>`);
  const nav = $('.tse-nav', body), main = $('.tse-main', body);

  const resolved = () => { const p = { testSettings: work, templates: project.templates }; return { p, types: allTypes(p, { includeHidden: true }) }; };
  const drawNav = () => {
    const { types } = resolved();
    nav.innerHTML = '';
    types.forEach(t => {
      const b = h(`<button class="${t.id === cur ? 'on' : ''}" style="${t.hidden ? 'opacity:.5' : ''}">${esc(t.short)}<small>${esc(t.prefix)}</small></button>`);
      b.onclick = () => { cur = t.id; drawNav(); drawMain(); };
      nav.appendChild(b);
    });
    const add = h('<button class="add">＋ การทดสอบที่กำหนดเอง</button>');
    add.onclick = () => {
      const id = 'c_' + Date.now().toString(36);
      work.custom.push({ id, label: 'การทดสอบใหม่', prefix: 'X', fields: [{ key: 'f1', label: 'ค่าที่วัดได้', kind: 'num', unit: '' }], evalField: 'f1', bands: { default: [] } });
      cur = id; drawNav(); drawMain();
    };
    nav.appendChild(add);
  };

  const drawMain = () => {
    const { p } = resolved();
    const t = typeDef(p, cur);
    const custom = work.custom.find(c => c.id === cur);
    const ov = custom || (work.types[cur] ||= {});
    main.innerHTML = '';
    const head = h(`<div>
      <div class="row">
        <label class="fld"><span>ชื่อการทดสอบ</span><input type="text" data-k="label" value="${esc(custom ? custom.label : (ov.label || t.label))}"></label>
        <label class="fld" style="flex:0 0 110px"><span>รหัสนำหน้า</span><input type="text" data-k="prefix" value="${esc(custom ? custom.prefix : (ov.prefix || t.prefix))}"></label>
      </div>
      ${custom ? '' : `<label class="ck" style="display:flex;gap:8px;margin-bottom:8px"><input type="checkbox" data-k="hidden" ${ov.hidden ? 'checked' : ''}> ซ่อนการทดสอบนี้ในรายการเลือก</label>`}
      <p class="hint">${esc(t.criteriaNote || '')}</p></div>`);
    $$('[data-k]', head).forEach(inp => inp.oninput = inp.onchange = () => {
      const k = inp.dataset.k;
      const val = inp.type === 'checkbox' ? inp.checked : inp.value;
      ov[k] = val; if (k !== 'label' || custom) drawNav();
    });
    main.appendChild(head);

    if (custom) main.appendChild(customFieldsEditor(custom, () => drawMain()));

    // params
    if (t.params?.length) {
      const pbox = h('<div><div class="sec-title">ค่าพารามิเตอร์</div></div>');
      ov.params ||= {};
      for (const prm of t.params) {
        const val = ov.params[prm.key] ?? prm.value;
        if (prm.kind === 'map') {
          const row = h(`<div class="fld"><span>${esc(prm.label)}</span><div class="mapgrid">${Object.entries(val).map(([k, v]) => `<label>${esc(k)}<input type="text" data-m="${esc(k)}" value="${esc(v)}"></label>`).join('')}</div></div>`);
          $$('[data-m]', row).forEach(i => i.oninput = () => { ov.params[prm.key] = { ...(ov.params[prm.key] || val), [i.dataset.m]: +i.value || 0 }; });
          pbox.appendChild(row);
        } else if (prm.kind === 'pairs') {
          const row = h(`<label class="fld"><span>${esc(prm.label)} — 1 บรรทัดต่อคู่ “HB Rm”</span><textarea rows="5" style="font-family:monospace;font-size:12.5px">${esc(val.map(x => x.join(' ')).join('\n'))}</textarea></label>`);
          $('textarea', row).oninput = (e) => { ov.params[prm.key] = e.target.value.split('\n').map(l => l.trim().split(/[\s,;]+/).map(Number)).filter(x => x.length === 2 && x.every(isFinite)); };
          pbox.appendChild(row);
        } else if (prm.kind === 'select') {
          const row = h(`<label class="fld"><span>${esc(prm.label)}</span><select>${prm.options.map(o => `<option ${o === val ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></label>`);
          $('select', row).onchange = (e) => { ov.params[prm.key] = e.target.value; };
          pbox.appendChild(row);
        } else {
          const row = h(`<label class="fld"><span>${esc(prm.label)}${prm.unit ? ` (${esc(prm.unit)})` : ''}</span><input type="text" value="${esc(val)}" style="max-width:160px"></label>`);
          $('input', row).oninput = (e) => { ov.params[prm.key] = e.target.value === '' ? prm.value : +e.target.value; };
          pbox.appendChild(row);
        }
      }
      main.appendChild(pbox);
    }

    // bands
    const bandsSrc = custom ? (custom.bands ||= { default: [] }) : (ov.bands ||= JSON.parse(JSON.stringify(t.bands || {})));
    const variants = Object.keys(bandsSrc);
    if (variants.length || custom) {
      const bbox = h('<div><div class="sec-title">ช่วงเกณฑ์ประเมิน (ตั้งแต่ ≤ ค่า < น้อยกว่า ; เว้นว่าง = ไม่จำกัด)</div></div>');
      if (custom) {
        const ef = h(`<label class="fld"><span>ประเมินจากช่อง</span><select><option value="">— ไม่ประเมิน —</option>${custom.fields.filter(f => f.kind === 'num').map(f => `<option value="${f.key}" ${f.key === custom.evalField ? 'selected' : ''}>${esc(f.label)}</option>`).join('')}</select></label>`);
        $('select', ef).onchange = (e) => { custom.evalField = e.target.value; };
        bbox.appendChild(ef);
      }
      for (const vn of (variants.length ? variants : ['default'])) {
        bandsSrc[vn] ||= [];
        bbox.appendChild(bandTable(vn === 'default' ? '' : vn, bandsSrc[vn]));
      }
      main.appendChild(bbox);
    }
    if (!custom && (ov.label || ov.prefix || ov.params || ov.bands)) {
      const rs = h('<button class="btn sm ghost" style="margin-top:10px">↺ คืนค่าเริ่มต้นของการทดสอบนี้</button>');
      rs.onclick = () => { delete work.types[cur]; drawNav(); drawMain(); };
      main.appendChild(rs);
    }
    if (custom) {
      const del = h('<button class="btn sm danger" style="margin-top:10px">🗑 ลบการทดสอบที่กำหนดเองนี้</button>');
      del.onclick = async () => { if (await confirmBox(`ลบ “${custom.label}”? จุดที่บันทึกการทดสอบนี้ไว้จะไม่แสดงผลส่วนนี้`, { danger: true, ok: 'ลบ' })) { work.custom = work.custom.filter(c => c !== custom); cur = 'upv'; drawNav(); drawMain(); } };
      main.appendChild(del);
    }
  };

  const bandTable = (title, rows) => {
    const wrap = h(`<div class="bandtbl">${title ? `<div class="hint" style="font-weight:600;margin:6px 0 4px">${esc(title)}</div>` : ''}<table><thead><tr><th>ตั้งแต่</th><th>น้อยกว่า</th><th>ผลการประเมิน</th><th>ระดับ</th><th></th></tr></thead><tbody></tbody></table>
      <button class="btn sm ghost">＋ เพิ่มช่วง</button></div>`);
    const tb = $('tbody', wrap);
    const draw = () => {
      tb.innerHTML = '';
      rows.forEach((b, i) => {
        const tr = h(`<tr><td><input type="text" value="${esc(b.min ?? '')}"></td><td><input type="text" value="${esc(b.max ?? '')}"></td><td><input type="text" value="${esc(b.label)}"></td>
          <td><select>${LEVEL_OPTS.map(l => `<option value="${l}" ${l === b.level ? 'selected' : ''}>${LEVEL[l].text}</option>`).join('')}</select></td><td><button class="icon-btn">✕</button></td></tr>`);
        const [a, c, d] = $$('input', tr);
        a.oninput = () => { b.min = a.value === '' ? '' : +a.value; };
        c.oninput = () => { b.max = c.value === '' ? '' : +c.value; };
        d.oninput = () => { b.label = d.value; };
        $('select', tr).onchange = (e) => { b.level = e.target.value; };
        $('button', tr).onclick = () => { rows.splice(i, 1); draw(); };
        tb.appendChild(tr);
      });
    };
    draw();
    $(':scope > button', wrap).onclick = () => { rows.push({ min: '', max: '', label: '', level: 'ok' }); draw(); };
    return wrap;
  };

  const customFieldsEditor = (custom) => {
    const box = h(`<div><div class="sec-title">ช่องข้อมูล</div><div class="cf"></div><button class="btn sm ghost">＋ เพิ่มช่อง</button></div>`);
    const cf = $('.cf', box);
    const draw = () => {
      cf.innerHTML = '';
      custom.fields.forEach((f, i) => {
        const row = h(`<div class="row cfrow"><input class="inp" type="text" value="${esc(f.label)}" placeholder="ชื่อช่อง">
          <select class="inp" style="flex:0 0 150px"><option value="num" ${f.kind === 'num' ? 'selected' : ''}>ตัวเลข</option><option value="readings" ${f.kind === 'readings' ? 'selected' : ''}>ค่าอ่านหลายครั้ง</option><option value="text" ${f.kind === 'text' ? 'selected' : ''}>ข้อความ</option><option value="select" ${f.kind === 'select' ? 'selected' : ''}>ตัวเลือก</option></select>
          <input class="inp" type="text" value="${esc(f.kind === 'select' ? (f.options || []).join(', ') : (f.unit || ''))}" placeholder="${f.kind === 'select' ? 'ตัวเลือก คั่นด้วย ,' : 'หน่วย'}" style="flex:0 0 140px">
          <button class="icon-btn" title="ลบช่อง">✕</button></div>`);
        const [lab, , extra] = $$('input', row);
        lab.oninput = () => { f.label = lab.value; };
        $('select', row).onchange = (e) => { f.kind = e.target.value; if (f.kind === 'readings') f.count = 5; draw(); };
        extra.oninput = () => { if (f.kind === 'select') f.options = extra.value.split(',').map(s => s.trim()).filter(Boolean); else f.unit = extra.value; };
        $('button', row).onclick = () => { custom.fields.splice(i, 1); draw(); };
        cf.appendChild(row);
      });
    };
    draw();
    $(':scope > button', box).onclick = () => { custom.fields.push({ key: 'f' + Date.now().toString(36), label: '', kind: 'num', unit: '' }); draw(); };
    return box;
  };

  drawNav(); drawMain();
  modal({
    title: 'การทดสอบและเกณฑ์ประเมิน', body, wide: true,
    actions: [
      { label: '⤓ ส่งออกเกณฑ์ (.json)', onClick: () => { download(new Blob([JSON.stringify(work, null, 2)], { type: 'application/json' }), `เกณฑ์การทดสอบ - ${project.name}.json`); return false; } },
      { label: '⤒ นำเข้าเกณฑ์', onClick: async () => {
        const [f] = await pickFiles({ accept: '.json,application/json' });
        if (!f) return false;
        try { const j = JSON.parse(await f.text()); if (!j.types && !j.custom) throw new Error(); Object.assign(work, j); drawNav(); drawMain(); toast('นำเข้าเกณฑ์แล้ว — กดบันทึกเพื่อใช้งาน', 'ok'); }
        catch { toast('ไฟล์เกณฑ์ไม่ถูกต้อง', 'error'); }
        return false;
      } },
      { label: 'บันทึกเป็นค่าเริ่มต้นโครงการใหม่', onClick: async () => { project.testSettings = work; await db.setMeta('defaultTestSettings', work); onSaved(); toast('บันทึกแล้ว และจะใช้กับโครงการใหม่', 'ok'); return true; } },
      { label: 'บันทึก', kind: 'primary', onClick: () => { project.testSettings = work; onSaved(); toast('บันทึกเกณฑ์แล้ว', 'ok'); return true; } },
    ],
  });
}

export { BUILTIN };
