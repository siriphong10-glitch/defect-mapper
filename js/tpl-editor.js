import { db } from './db.js';
import { $, $$, esc, h, modal, confirmBox, toast } from './utils.js';
import { TYPE_LABELS, KIND_LABELS, defaultTemplates } from './templates.js';

const HAS_OPTS = ['select', 'choice', 'checks', 'severity'];
const CORE_ROLES = ['title', 'severity'];

// Edit headings / options of both inspection forms for one project.
export function templateEditor(project, onSaved) {
  // working copy; options carry their original text so renames can be applied to existing pins
  const work = {};
  for (const t of Object.keys(TYPE_LABELS)) {
    const src = project.templates[t] || defaultTemplates()[t];
    work[t] = {
      ...src,
      fields: src.fields.map(f => ({
        ...f,
        _origKey: f.key,
        options: (f.options || []).map(o => f.kind === 'severity' ? { label: o.label, color: o.color, _orig: o.label } : { label: o, _orig: o }),
        suggestions: [...(f.suggestions || [])],
      })),
    };
  }
  let tab = project.defaultType || 'structural';

  const body = h(`<div>
    <p class="hint" style="margin-top:0">แก้ชื่อหัวข้อ เพิ่ม/ลบ/เปลี่ยนชื่อตัวเลือก หรือเพิ่มหัวข้อใหม่ได้ การเปลี่ยนชื่อตัวเลือกจะอัปเดตจุดที่บันทึกไว้แล้วให้อัตโนมัติ</p>
    <div class="tpl-tabs">${Object.entries(TYPE_LABELS).map(([k, v]) => `<button class="btn sm" data-tab="${k}">${v}</button>`).join('')}</div>
    <div id="tf"></div>
    <div class="tfield" style="background:#fafbfc">
      <div class="row" style="align-items:flex-end">
        <label class="fld" style="margin:0"><span>เพิ่มหัวข้อใหม่</span><input type="text" id="nfLabel" placeholder="เช่น ความกว้างรอยร้าว (มม.)"></label>
        <label class="fld" style="margin:0"><span>ชนิดข้อมูล</span><select id="nfKind" class="inp">${Object.entries(KIND_LABELS).filter(([k]) => k !== 'severity').map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
        <button class="btn" id="nfAdd" style="flex:0 0 auto">＋ เพิ่ม</button>
      </div>
    </div>
  </div>`);

  const draw = () => {
    $$('[data-tab]', body).forEach(b => b.classList.toggle('primary', b.dataset.tab === tab));
    const box = $('#tf', body);
    box.innerHTML = '';
    const fields = work[tab].fields;
    fields.forEach((f, i) => {
      const core = CORE_ROLES.includes(f.role);
      const roleTag = f.role === 'title' ? 'ใช้จัดกลุ่มในรายงาน' : f.role === 'severity' ? 'กำหนดสีหมุด' : f.role === 'element' ? 'แสดงหัวตาราง' : '';
      const el = h(`<div class="tfield" style="${f.hidden ? 'opacity:.55' : ''}">
        <div class="thead">
          <input class="inp" type="text" value="${esc(f.label)}">
          <span class="kind">${esc(KIND_LABELS[f.kind] || f.kind)}</span>
          ${roleTag ? `<span class="core">${roleTag}</span>` : ''}
          <button class="icon-btn" data-a="up" title="เลื่อนขึ้น" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button class="icon-btn" data-a="down" title="เลื่อนลง" ${i === fields.length - 1 ? 'disabled' : ''}>↓</button>
          ${core ? '' : `<button class="icon-btn" data-a="hide" title="${f.hidden ? 'แสดงหัวข้อนี้' : 'ซ่อนหัวข้อนี้'}">${f.hidden ? '◌' : '◉'}</button>
          <button class="icon-btn" data-a="del" title="ลบหัวข้อ">🗑</button>`}
        </div>
        ${HAS_OPTS.includes(f.kind) ? `<div class="opts"></div>` : ''}
        ${f.role === 'title' ? `<div class="hint" style="margin-top:8px">คำแนะนำสำหรับพิมพ์หัวข้อ (กด Enter เพื่อเพิ่ม)</div><div class="opts sugg"></div>` : ''}
      </div>`);
      $('.thead input', el).oninput = (e) => { f.label = e.target.value; };
      el.querySelectorAll('[data-a]').forEach(b => b.onclick = async () => {
        const a = b.dataset.a;
        if (a === 'up' && i > 0) [fields[i - 1], fields[i]] = [fields[i], fields[i - 1]];
        if (a === 'down' && i < fields.length - 1) [fields[i + 1], fields[i]] = [fields[i], fields[i + 1]];
        if (a === 'hide') f.hidden = !f.hidden;
        if (a === 'del') {
          if (!(await confirmBox(`ลบหัวข้อ “${f.label}”? ข้อมูลในหัวข้อนี้ของจุดเดิมจะไม่แสดงในรายงาน (ใช้ “ซ่อน” แทนได้ถ้ายังอยากเก็บไว้)`, { ok: 'ลบหัวข้อ', danger: true }))) return;
          fields.splice(i, 1);
        }
        draw();
      });
      if (HAS_OPTS.includes(f.kind)) optEditor($('.opts', el), f.options, f.kind === 'severity');
      if (f.role === 'title') suggEditor($('.sugg', el), f.suggestions);
      box.appendChild(el);
    });
  };

  function optEditor(box, opts, withColor) {
    box.innerHTML = '';
    opts.forEach((o, i) => {
      const el = h(`<span class="opt">${withColor ? `<input type="color" value="${esc(o.color)}">` : ''}<input type="text" value="${esc(o.label)}" size="${Math.max(4, o.label.length + 1)}"><button title="ลบตัวเลือก">✕</button></span>`);
      $('input[type=text]', el).oninput = (e) => { o.label = e.target.value; e.target.size = Math.max(4, e.target.value.length + 1); };
      if (withColor) $('input[type=color]', el).oninput = (e) => { o.color = e.target.value; };
      $('button', el).onclick = () => { opts.splice(i, 1); optEditor(box, opts, withColor); };
      box.appendChild(el);
    });
    const add = h(`<span class="opt" style="background:#fff;border-style:dashed"><input type="text" placeholder="＋ เพิ่มตัวเลือก" size="14"></span>`);
    $('input', add).onkeydown = (e) => {
      if (e.key === 'Enter' && e.target.value.trim()) {
        opts.push(withColor ? { label: e.target.value.trim(), color: '#9ca3af' } : { label: e.target.value.trim() });
        optEditor(box, opts, withColor); $('.opt:last-child input', box).focus();
      }
    };
    $('input', add).onblur = (e) => { if (e.target.value.trim()) { opts.push(withColor ? { label: e.target.value.trim(), color: '#9ca3af' } : { label: e.target.value.trim() }); optEditor(box, opts, withColor); } };
    box.appendChild(add);
  }

  function suggEditor(box, list) {
    box.innerHTML = '';
    list.forEach((s, i) => {
      const el = h(`<span class="opt"><span style="padding:2px">${esc(s)}</span><button title="ลบ">✕</button></span>`);
      $('button', el).onclick = () => { list.splice(i, 1); suggEditor(box, list); };
      box.appendChild(el);
    });
    const add = h(`<span class="opt" style="background:#fff;border-style:dashed"><input type="text" placeholder="＋ เพิ่มคำแนะนำ" size="16"></span>`);
    $('input', add).onkeydown = (e) => {
      if (e.key === 'Enter' && e.target.value.trim()) { list.push(e.target.value.trim()); suggEditor(box, list); $('.opt:last-child input', box).focus(); }
    };
    box.appendChild(add);
  }

  $$('[data-tab]', body).forEach(b => b.onclick = () => { tab = b.dataset.tab; draw(); });
  $('#nfAdd', body).onclick = () => {
    const label = $('#nfLabel', body).value.trim();
    if (!label) { toast('ใส่ชื่อหัวข้อก่อน', 'error'); return; }
    const kind = $('#nfKind', body).value;
    work[tab].fields.push({ key: 'f_' + Date.now().toString(36), label, kind, options: HAS_OPTS.includes(kind) ? [] : [], suggestions: [] });
    $('#nfLabel', body).value = '';
    draw();
    setTimeout(() => { const all = $$('.tfield', $('#tf', body)); all.at(-1)?.scrollIntoView({ block: 'center' }); }, 30);
  };
  draw();

  const finalize = () => {
    const out = {}, renames = {};
    for (const t of Object.keys(work)) {
      renames[t] = {};
      out[t] = {
        ...work[t],
        fields: work[t].fields.map(f => {
          const nf = { ...f };
          delete nf._origKey;
          const opts = f.options.filter(o => o.label.trim());
          opts.forEach(o => { if (o._orig && o._orig !== o.label.trim()) (renames[t][f.key] ||= {})[o._orig] = o.label.trim(); });
          nf.options = f.kind === 'severity' ? opts.map(o => ({ label: o.label.trim(), color: o.color })) : opts.map(o => o.label.trim());
          if (!HAS_OPTS.includes(f.kind)) delete nf.options;
          if (!nf.suggestions?.length) delete nf.suggestions;
          return nf;
        }),
      };
    }
    return { out, renames };
  };

  const applyRenames = async (renames) => {
    const defects = await db.byProject('defects', project.id);
    for (const d of defects) {
      const rm = renames[d.type];
      if (!rm) continue;
      let ch = false;
      for (const [key, map] of Object.entries(rm)) {
        const v = d.data?.[key];
        if (Array.isArray(v)) { const nv = v.map(x => map[x] ?? x); if (nv.some((x, i) => x !== v[i])) { d.data[key] = nv; ch = true; } }
        else if (v != null && map[v] != null) { d.data[key] = map[v]; ch = true; }
      }
      if (ch) await db.put('defects', d);
    }
  };

  modal({
    title: 'หัวข้อและตัวเลือกความเสียหาย', body, wide: true,
    actions: [
      { label: 'คืนค่าเริ่มต้น', onClick: async () => {
        if (!(await confirmBox('คืนหัวข้อทั้งหมดของโครงการนี้เป็นค่าเริ่มต้นของโปรแกรม?'))) return false;
        project.templates = defaultTemplates();
        onSaved && onSaved(); toast('คืนค่าเริ่มต้นแล้ว'); return true;
      } },
      { label: 'บันทึกเป็นค่าเริ่มต้นโครงการใหม่', onClick: async () => {
        const { out, renames } = finalize();
        project.templates = out; await applyRenames(renames);
        await db.setMeta('defaultTemplates', out);
        onSaved && onSaved(); toast('บันทึกแล้ว และจะใช้กับโครงการใหม่ต่อจากนี้', 'ok', 3500); return true;
      } },
      { label: 'บันทึก', kind: 'primary', onClick: async () => {
        const { out, renames } = finalize();
        project.templates = out; await applyRenames(renames);
        onSaved && onSaved(); toast('บันทึกหัวข้อแล้ว', 'ok'); return true;
      } },
    ],
  });
}
