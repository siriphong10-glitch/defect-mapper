// On-screen numeric keypad for entering readings on site.
// Inputs opt in with the attribute data-kp. The device keyboard can be used instead (saved per browser).
import { h, $ } from './utils.js';

const LS = 'dm_keypad';
let enabled = (() => { try { return localStorage.getItem(LS) !== 'off'; } catch { return true; } })();
let pad = null, target = null;

export const keypadEnabled = () => enabled;
export function setKeypad(on) {
  enabled = on;
  try { localStorage.setItem(LS, on ? 'on' : 'off'); } catch { /* */ }
  document.querySelectorAll('input[data-kp]').forEach(applyMode);
  if (!on) hide(); else if (target) show(target);
}

export function applyMode(inp) {
  // inputmode=none hides the phone/tablet keyboard while our keypad is used
  inp.setAttribute('inputmode', enabled ? 'none' : (inp.dataset.kp === 'int' ? 'numeric' : 'decimal'));
  inp.setAttribute('autocomplete', 'off');
}

function build() {
  pad = h(`<div class="keypad" role="dialog" aria-label="แป้นตัวเลข">
    <div class="kp-head"><span class="kp-label"></span>
      <button data-k="device" class="kp-mini" title="ใช้คีย์บอร์ดของเครื่องแทน">⌨ ใช้คีย์บอร์ดเครื่อง</button></div>
    <div class="kp-grid">
      ${['7', '8', '9', '⌫', '4', '5', '6', 'C', '1', '2', '3', '−', '0', '.', '◀', '▶'].map(k => `<button data-k="${k}">${k}</button>`).join('')}
    </div>
    <div class="kp-foot"><button data-k="prev" class="kp-wide">↑ ช่องก่อนหน้า</button><button data-k="next" class="kp-wide primary">ช่องถัดไป ↓</button><button data-k="done" class="kp-wide">เสร็จ</button></div>
  </div>`);
  // keep focus in the input while tapping keys
  pad.addEventListener('pointerdown', (e) => { if (e.target.closest('button')) e.preventDefault(); });
  pad.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-k]');
    if (!b || !target) return;
    press(b.dataset.k);
  });
  document.body.appendChild(pad);
}

function setVal(inp, val, caret) {
  inp.value = val;
  try { inp.setSelectionRange(caret, caret); } catch { /* */ }
  inp.dispatchEvent(new Event('input', { bubbles: true }));
}

function fields() {
  const scope = target.closest('[data-kp-scope]') || document;
  return [...scope.querySelectorAll('input[data-kp]:not([disabled])')].filter(x => x.offsetParent !== null);
}

function press(k) {
  const inp = target;
  let s = inp.selectionStart ?? inp.value.length, e = inp.selectionEnd ?? s;
  const v = inp.value;
  if (k === 'device') { setKeypad(false); inp.blur(); setTimeout(() => inp.focus(), 30); return; }
  if (k === 'done') { inp.blur(); hide(); return; }
  if (k === 'next' || k === 'prev') {
    const all = fields(); const i = all.indexOf(inp);
    const nx = all[i + (k === 'next' ? 1 : -1)];
    if (nx) { nx.focus(); nx.select?.(); } else if (k === 'next') { inp.blur(); hide(); }
    return;
  }
  if (k === '◀') { const p = Math.max(0, s - 1); inp.setSelectionRange(p, p); return; }
  if (k === '▶') { const p = Math.min(v.length, e + 1); inp.setSelectionRange(p, p); return; }
  if (k === 'C') { setVal(inp, '', 0); return; }
  if (k === '⌫') {
    if (s === e && s > 0) s--;
    setVal(inp, v.slice(0, s) + v.slice(e), s); return;
  }
  let ch = k === '−' ? '-' : k;
  if (ch === '-') { // toggle sign
    const nv = v.startsWith('-') ? v.slice(1) : '-' + v;
    setVal(inp, nv, Math.max(0, s + (v.startsWith('-') ? -1 : 1))); return;
  }
  if (ch === '.' && (inp.dataset.kp === 'int' || v.includes('.'))) return;
  setVal(inp, v.slice(0, s) + ch + v.slice(e), s + 1);
}

function show(inp) {
  if (!pad) build();
  target = inp;
  const lab = inp.dataset.kpLabel || inp.closest('label')?.querySelector('span')?.textContent || '';
  $('.kp-label', pad).textContent = lab;
  pad.classList.add('on');
  document.body.classList.add('kp-open');
  // keep the field visible above the keypad
  setTimeout(() => inp.scrollIntoView({ block: 'nearest' }), 50);
}
function hide() { if (pad) pad.classList.remove('on'); document.body.classList.remove('kp-open'); target = null; }

document.addEventListener('focusin', (e) => {
  const inp = e.target.closest?.('input[data-kp]');
  if (inp && enabled && !inp.disabled && !inp.readOnly) show(inp);
  else if (pad && !(e.target.closest && e.target.closest('.keypad'))) hide();
});
document.addEventListener('focusout', () => {
  setTimeout(() => { const a = document.activeElement; if (!a || !a.matches?.('input[data-kp]')) hide(); }, 120);
});
document.addEventListener('keydown', (e) => {
  if (!target || !pad?.classList.contains('on')) return;
  if (e.key === 'Enter') { e.preventDefault(); press('next'); }
});
