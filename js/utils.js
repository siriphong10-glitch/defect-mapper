export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export function toast(msg, kind = 'info', ms = 2600) {
  let wrap = $('#toasts');
  if (!wrap) { wrap = h('<div id="toasts"></div>'); document.body.appendChild(wrap); }
  const t = h(`<div class="toast ${kind}">${esc(msg)}</div>`);
  wrap.appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, ms);
}

// Generic modal. `body` is an element or HTML string. Returns {el, close, done}
export function modal({ title, body, actions = [], wide = false, onClose, dismissable = true }) {
  const back = h(`<div class="modal-back"><div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">
      <div class="modal-head"><h3>${esc(title)}</h3>${dismissable ? '<button class="icon-btn x" title="ปิด">✕</button>' : ''}</div>
      <div class="modal-body"></div>
      <div class="modal-foot"></div></div></div>`);
  const bodyEl = $('.modal-body', back);
  if (typeof body === 'string') bodyEl.innerHTML = body; else if (body) bodyEl.appendChild(body);
  let resolveDone;
  const done = new Promise(r => (resolveDone = r));
  const close = (val) => { back.remove(); document.removeEventListener('keydown', onKey); onClose && onClose(val); resolveDone(val); };
  const onKey = (e) => { if (e.key === 'Escape' && dismissable) close(null); };
  document.addEventListener('keydown', onKey);
  if (dismissable) {
    $('.x', back).onclick = () => close(null);
    back.addEventListener('mousedown', (e) => { if (e.target === back) close(null); });
  }
  const foot = $('.modal-foot', back);
  for (const a of actions) {
    const b = h(`<button class="btn ${a.kind || ''}">${esc(a.label)}</button>`);
    b.onclick = async () => {
      if (a.onClick) {
        const r = await a.onClick(bodyEl);
        if (r === false) return;
        close(r === undefined ? a.value ?? true : r);
      } else close(a.value ?? null);
    };
    foot.appendChild(b);
  }
  if (!actions.length) foot.remove();
  document.body.appendChild(back);
  const first = $('input:not([type=hidden]):not([type=color]):not([type=file]), textarea, select', bodyEl);
  if (first) setTimeout(() => first.focus(), 30);
  return { el: back, body: bodyEl, close, done };
}

export function confirmBox(message, { ok = 'ยืนยัน', danger = false, title = 'ยืนยัน' } = {}) {
  return modal({
    title, body: `<p>${esc(message)}</p>`,
    actions: [{ label: 'ยกเลิก', value: false }, { label: ok, kind: danger ? 'danger' : 'primary', value: true }],
  }).done.then(v => !!v);
}

export function promptBox(title, value = '', { label = '', placeholder = '' } = {}) {
  const m = modal({
    title,
    body: `<label class="fld">${label ? `<span>${esc(label)}</span>` : ''}<input type="text" value="${esc(value)}" placeholder="${esc(placeholder)}"></label>`,
    actions: [{ label: 'ยกเลิก', value: null }, { label: 'ตกลง', kind: 'primary', onClick: (b) => $('input', b).value.trim() }],
  });
  $('input', m.body).addEventListener('keydown', (e) => { if (e.key === 'Enter') m.close($('input', m.body).value.trim()); });
  return m.done;
}

export function pickFiles({ accept = 'image/*', multiple = false } = {}) {
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = accept; inp.multiple = multiple;
    inp.style.display = 'none';
    document.body.appendChild(inp);
    inp.onchange = () => { resolve([...inp.files]); inp.remove(); };
    inp.click();
  });
}

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// Downscale an image file/blob to fit maxDim; returns {blob, w, h}
export async function compressImage(fileOrBlob, maxDim = 1800, quality = 0.85, type = 'image/jpeg') {
  const url = URL.createObjectURL(fileOrBlob);
  try {
    const img = await loadImage(url);
    let w = img.naturalWidth, hh = img.naturalHeight;
    const s = Math.min(1, maxDim / Math.max(w, hh));
    const cw = Math.round(w * s), ch = Math.round(hh * s);
    if (s === 1 && fileOrBlob.type === type && fileOrBlob.size < 2.5e6) return { blob: fileOrBlob, w, h: hh };
    const c = document.createElement('canvas');
    c.width = cw; c.height = ch;
    const ctx = c.getContext('2d');
    if (type === 'image/jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cw, ch); }
    ctx.drawImage(img, 0, 0, cw, ch);
    const blob = await new Promise(r => c.toBlob(r, type, quality));
    return { blob, w: cw, h: ch };
  } finally { URL.revokeObjectURL(url); }
}

// when `files` is an array, downloads are collected instead (used to bundle several exports into one .zip)
export const downloadCapture = { files: null };
export function download(blob, filename) {
  if (downloadCapture.files) { downloadCapture.files.push({ blob, name: filename }); return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}

const loaded = {};
export function loadScript(src) {
  if (!loaded[src]) {
    loaded[src] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('โหลดไลบรารีไม่สำเร็จ: ' + src));
      document.head.appendChild(s);
    });
  }
  return loaded[src];
}

export const naturalCmp = (a, b) => String(a).localeCompare(String(b), 'th', { numeric: true, sensitivity: 'base' });

export function debounce(fn, ms = 400) {
  let t;
  const d = (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  d.flush = (...args) => { clearTimeout(t); fn(...args); };
  return d;
}

export function fmtDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function thaiDateLong(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function safeName(s) {
  return String(s || 'project').replace(/[\\/:*?"<>|]+/g, '_').trim().slice(0, 80) || 'project';
}

export function blobToDataURL(blob) {
  return new Promise((resolve) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.readAsDataURL(blob); });
}

export async function blobToArrayBuffer(blob) { return await blob.arrayBuffer(); }

// polygon area (shoelace), pts = [[x,y],...]
export function polyArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

export function centroid(pts) {
  if (pts.length === 1) return pts[0];
  // area-weighted centroid, fallback to average
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
    const f = x1 * y2 - x2 * y1;
    a += f; cx += (x1 + x2) * f; cy += (y1 + y2) * f;
  }
  if (Math.abs(a) < 1e-6) {
    const s = pts.reduce((p, c) => [p[0] + c[0], p[1] + c[1]], [0, 0]);
    return [s[0] / pts.length, s[1] / pts.length];
  }
  a *= 0.5;
  return [cx / (6 * a), cy / (6 * a)];
}
