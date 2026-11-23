// Instrument tests (NDT etc.) — type definitions, calculations and flexible criteria.
//
// Built-in field definitions and formulas live here (so they improve with app updates).
// Each project keeps only its own overrides in project.testSettings:
//   { types: { <id>: { label, prefix, hidden, params:{...}, bands:{ <variant>: [band...] } } },
//     custom: [ { id, label, prefix, fields:[...], evalField, bands:{default:[...]} } ],
//     lastSet: [ids...] }
// A band = { min, max, label, level }   (min ≤ value < max; empty = open)   level: ok | warn | bad | na

export const LEVEL = {
  ok: { color: '#2e7d32', text: 'ผ่าน' },
  warn: { color: '#ef8a00', text: 'เฝ้าระวัง' },
  bad: { color: '#d32f2f', text: 'ไม่ผ่าน' },
  na: { color: '#6b7280', text: 'ประเมินไม่ได้' },
  info: { color: '#2563eb', text: 'บันทึกแล้ว' },
  none: { color: '#ffffff', text: 'ยังไม่บันทึกค่า' },
};
const RANK = { none: 0, info: 1, na: 2, ok: 3, warn: 4, bad: 5 };
export const worstLevel = (levels) => levels.reduce((w, l) => (RANK[l] > RANK[w] ? l : w), 'none');

export const ELEMENTS = ['เสา', 'คาน', 'พื้น', 'ท้องพื้น', 'ผนัง', 'ฐานราก', 'บันได', 'เหล็กรูปพรรณ', 'อื่น ๆ'];
export const ROLES = { '': '—', baseline: 'จุดอ้างอิง', targeted: 'จุดเจาะจง' };

const num = (v) => (v === '' || v == null || isNaN(+v) ? null : +v);
const r = (v, d = 0) => (v == null || !isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d);
const readingsOf = (v) => (Array.isArray(v) ? v.map(num).filter(x => x != null) : []);
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const interp = (x, xs, ys) => {
  if (x < xs[0] || x > xs[xs.length - 1]) return null;
  for (let i = 0; i < xs.length - 1; i++) if (x >= xs[i] && x <= xs[i + 1]) return ys[i] + (x - xs[i]) * (ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]);
  return null;
};
const MPA_TO_KSC = 10.197;

export function bandOf(bands, v) {
  if (v == null || !bands) return null;
  return bands.find(b => (b.min === '' || b.min == null || v >= +b.min) && (b.max === '' || b.max == null || v < +b.max)) || null;
}

// ------------------------------------------------------------------ built-in types
// field kinds: num (unit), text, select (options), readings (count, min), date
export const BUILTIN = {
  ferro: {
    label: 'Ferro Scan — ระยะหุ้มและเหล็กเสริม', short: 'Ferro Scan', prefix: 'FS', cat: 'ข. เหล็กเสริมและความคงทน',
    fields: [
      { key: 'barDesign', label: 'เหล็กเสริมตามแบบ', kind: 'text', ph: 'เช่น DB16@200' },
      { key: 'coverDesign', label: 'ระยะหุ้มตามแบบ', kind: 'num', unit: 'มม.' },
      { key: 'coverMin', label: 'ระยะหุ้มต่ำสุดที่วัดได้', kind: 'num', unit: 'มม.' },
      { key: 'coverAvg', label: 'ระยะหุ้มเฉลี่ย', kind: 'num', unit: 'มม.' },
      { key: 'spacingDesign', label: 'ระยะเรียงตามแบบ', kind: 'num', unit: 'มม.' },
      { key: 'spacingMeas', label: 'ระยะเรียงที่วัดได้', kind: 'num', unit: 'มม.' },
      { key: 'barMeas', label: 'ขนาดเหล็กที่ประมาณได้', kind: 'text', ph: 'เช่น DB16' },
    ],
    params: [
      { key: 'coverTol', label: 'ระยะหุ้มลดลงได้ไม่เกิน (ACI 117)', unit: 'มม.', value: 10 },
      { key: 'spacingTol', label: 'ระยะเรียงคลาดได้ ± (ACI 117)', unit: 'มม.', value: 25 },
      { key: 'instrTol', label: 'ความคลาดเคลื่อนของเครื่องมือ', unit: 'มม.', value: 0 },
    ],
    criteriaNote: 'ระยะหุ้ม: ผ่านเมื่อ ระยะหุ้มต่ำสุด ≥ ระยะหุ้มตามแบบ − พิกัดยอมให้ − ความคลาดเคลื่อนเครื่องมือ ; ระยะเรียง: ผ่านเมื่อ |ระยะที่วัด − ตามแบบ| ≤ พิกัด + ความคลาดเคลื่อนเครื่องมือ',
    calc(v, p) {
      const out = [], lv = [];
      const cd = num(v.coverDesign), cm = num(v.coverMin), sd = num(v.spacingDesign), sm = num(v.spacingMeas);
      const tolC = +p.coverTol + +p.instrTol, tolS = +p.spacingTol + +p.instrTol;
      if (cd != null && cm != null) {
        out.push({ key: 'coverDiff', label: 'ระยะหุ้มต่างจากแบบ', value: r(cm - cd, 0), unit: 'มม.' });
        const ok = cm >= cd - tolC;
        out.push({ key: 'coverEval', label: 'ระยะหุ้ม', value: ok ? 'ผ่าน' : 'ต่ำกว่าเกณฑ์' });
        lv.push(ok ? 'ok' : 'bad');
      }
      if (sd != null && sm != null) {
        const ok = Math.abs(sm - sd) <= tolS;
        out.push({ key: 'spacingEval', label: 'ระยะเรียง', value: ok ? 'ผ่าน' : 'เกินพิกัด' });
        lv.push(ok ? 'ok' : 'bad');
      }
      const level = lv.length ? worstLevel(lv) : null;
      return { out, level, grade: level ? (level === 'ok' ? 'ผ่านเกณฑ์' : 'ไม่ผ่านเกณฑ์') : null };
    },
  },
  upv: {
    label: 'UPV — ความสมบูรณ์ของเนื้อคอนกรีต', short: 'UPV', prefix: 'UPV', cat: 'ก. คุณภาพเนื้อคอนกรีต',
    fields: [
      { key: 'mode', label: 'รูปแบบการวัด', kind: 'select', options: ['วัดโดยตรง (Direct)', 'กึ่งตรงข้าม (Semi-direct)', 'วัดแบบอ้อม (Indirect)'] },
      { key: 'moisture', label: 'สภาพความชื้นผิว', kind: 'select', options: ['แห้ง', 'ชื้น', 'เปียก'] },
      { key: 'path', label: 'ระยะทาง', kind: 'num', unit: 'มม.' },
      { key: 'time', label: 'เวลา', kind: 'num', unit: 'μs' },
      { key: 'velocity', label: 'ความเร็วคลื่น (ถ้าอ่านจากเครื่อง)', kind: 'num', unit: 'm/s' },
      { key: 'group', label: 'กลุ่มกำลังคอนกรีตที่ใช้เทียบเกณฑ์', kind: 'select', options: ['สูงกว่า M25', 'ไม่เกิน M25'] },
    ],
    variantField: 'group', defaultVariant: 'สูงกว่า M25',
    bands: {
      'ไม่เกิน M25': [
        { min: 4500, max: '', label: 'ดีเยี่ยม (Excellent)', level: 'ok' },
        { min: 3750, max: 4500, label: 'ดี (Good)', level: 'ok' },
        { min: 3500, max: 3750, label: 'ดี (Good)', level: 'ok' },
        { min: '', max: 3500, label: 'น่าสงสัย (Doubtful)', level: 'bad' },
      ],
      'สูงกว่า M25': [
        { min: 4500, max: '', label: 'ดีเยี่ยม (Excellent)', level: 'ok' },
        { min: 3750, max: 4500, label: 'ดี (Good)', level: 'ok' },
        { min: '', max: 3750, label: 'น่าสงสัย (Doubtful)', level: 'bad' },
      ],
    },
    criteriaNote: 'IS 516 (Part 5/Sec 1):2018 ตารางที่ 1 รวม Amendment 1 — ใช้จัดระดับคุณภาพเท่านั้น ไม่ใช้ประมาณกำลังอัด ; ถ้าไม่ทราบกำลังอัดออกแบบให้ใช้กลุ่ม “สูงกว่า M25” ซึ่งเข้มกว่า',
    calc(v, p, bands) {
      const out = [];
      let vel = num(v.velocity);
      const path = num(v.path), t = num(v.time);
      if (vel == null && path != null && t) vel = path / t * 1000;
      if (vel == null) return { out, level: null };
      out.push({ key: 'vel', label: 'ความเร็วคลื่น', value: r(vel, 0), unit: 'm/s' });
      const grp = bands[v.group] ? v.group : this.defaultVariant;
      out.push({ key: 'grp', label: 'กลุ่มเกณฑ์ที่ใช้', value: grp + (v.group ? '' : ' (ค่าเริ่มต้น)') });
      const b = bandOf(bands[grp], vel);
      const notes = [];
      if (/อ้อม|กึ่ง/.test(v.mode || '')) notes.push('U4');
      if (/ชื้น|เปียก/.test(v.moisture || '')) notes.push('U3');
      if (b?.level === 'bad') notes.push('U2');
      if (notes.length) out.push({ key: 'notes', label: 'หมายเหตุที่ต้องเขียน', value: ['U1', ...notes].join(', ') });
      return { out, level: b?.level || 'info', grade: b?.label || null, value: vel };
    },
  },
  rebound: {
    label: 'Rebound Hammer — ความแข็งผิวคอนกรีต', short: 'Rebound', prefix: 'RH', cat: 'ก. คุณภาพเนื้อคอนกรีต', required: 'readings',
    fields: [
      { key: 'direction', label: 'ทิศทางการยิง', kind: 'select', options: ['แนวราบ', 'ยิงขึ้น 90°', 'ยิงลง 90°', 'ยิงขึ้น 45°', 'ยิงลง 45°'] },
      { key: 'moisture', label: 'สภาพผิว', kind: 'select', options: ['แห้ง', 'ชื้น', 'เปียก'] },
      { key: 'readings', label: 'ค่าที่อ่านได้ (ต้องกรอก)', kind: 'readings', count: 10, min: 10 },
    ],
    params: [
      { key: 'rule', label: 'วิธีหาค่าตัวแทน', kind: 'select', options: ['ASTM C805 (เฉลี่ย ตัดค่าห่าง > 6)', 'BS EN 12504-2 (มัธยฐาน)'], value: 'ASTM C805 (เฉลี่ย ตัดค่าห่าง > 6)' },
      { key: 'diff', label: 'เกณฑ์ค่าห่างจากค่ากลาง', unit: 'หน่วย', value: 6 },
    ],
    bands: { default: [] },
    criteriaNote: 'ใช้ดูความแข็งผิวและความสม่ำเสมอเท่านั้น ไม่สรุปกำลังอัด อ่านร่วมกับ UPV ที่จุดเดียวกัน (เพิ่มช่วงเกณฑ์ของค่าตัวแทนได้ถ้าต้องการ)',
    calc(v, p, bands) {
      const a = readingsOf(v.readings);
      const out = [];
      if (!a.length) return { out, level: null };
      if (a.length < 10) return { out: [{ key: 'warn', label: 'ค่าที่อ่านได้', value: `ยังไม่ครบ (${a.length}/10 ค่า)` }], level: 'na', grade: 'ค่ายังไม่ครบ' };
      const d = +p.diff || 6;
      let R, used, rejected, invalid = false;
      if (/EN/.test(p.rule)) {
        R = median(a); rejected = a.filter(x => Math.abs(x - R) > d).length; used = a.length;
        invalid = rejected > 0.2 * a.length;
      } else {
        const m = mean(a); const keep = a.filter(x => Math.abs(x - m) <= d);
        rejected = a.length - keep.length; used = keep.length; R = mean(keep);
        invalid = rejected > 2;
      }
      out.push({ key: 'R', label: 'ค่าตัวแทน (R)', value: r(R, 1) });
      out.push({ key: 'rej', label: 'ค่าที่ตัดทิ้ง', value: `${rejected} ค่า` });
      if (invalid) return { out, level: 'na', grade: 'ชุดข้อมูลใช้ไม่ได้ ควรยิงใหม่', value: R };
      const b = bandOf(bands.default, R);
      return { out, level: b?.level || 'info', grade: b?.label || null, value: R };
    },
  },
  core: {
    label: 'เจาะแกนคอนกรีต (Core)', short: 'Core', prefix: 'C', cat: 'ก. คุณภาพเนื้อคอนกรีต',
    fields: [
      { key: 'dia', label: 'เส้นผ่านศูนย์กลาง', kind: 'num', unit: 'มม.' },
      { key: 'len', label: 'ความยาวหลังตัดแต่ง', kind: 'num', unit: 'มม.' },
      { key: 'load', label: 'แรงกดประลัย', kind: 'num', unit: 'kN' },
      { key: 'fcDesign', label: "fc' ตามแบบ (ทรงกระบอก)", kind: 'num', unit: 'กก./ตร.ซม.' },
      { key: 'labNo', label: 'เลขที่รายงานห้องปฏิบัติการ', kind: 'text' },
    ],
    bands: {
      default: [
        { min: 0.85, max: '', label: "ไม่ต่ำกว่า 0.85 fc'", level: 'ok' },
        { min: 0.75, max: 0.85, label: "ต่ำกว่า 0.85 fc' (พิจารณาค่าเฉลี่ย)", level: 'warn' },
        { min: '', max: 0.75, label: "ต่ำกว่า 0.75 fc'", level: 'bad' },
      ],
    },
    criteriaNote: "ASTM C42 ปรับแก้ตาม L/D (1.75 = 0.98, 1.50 = 0.96, 1.25 = 0.93, 1.00 = 0.87) ; เทียบสัดส่วนกับ fc' ตามแบบ (ACI 318 ข้อ 26.12.4: ค่าเฉลี่ย 3 แท่ง ≥ 0.85 fc' และไม่มีแท่งใดต่ำกว่า 0.75 fc')",
    calc(v, p, bands) {
      const out = [];
      const d = num(v.dia), L = num(v.len), P = num(v.load), fc = num(v.fcDesign);
      if (!d || !P) return { out, level: null };
      const fMpa = P * 1000 / (Math.PI * d * d / 4);
      out.push({ key: 'fRaw', label: 'กำลังอัดก่อนปรับแก้', value: r(fMpa * MPA_TO_KSC, 0), unit: 'กก./ตร.ซม.' });
      let k = 1;
      if (L) {
        const ld = L / d;
        out.push({ key: 'ld', label: 'L/D', value: r(ld, 2) });
        if (ld < 1) return { out, level: 'na', grade: 'L/D น้อยกว่า 1 ประเมินไม่ได้' };
        k = ld >= 1.94 ? 1 : interp(ld, [1, 1.25, 1.5, 1.75, 1.94], [0.87, 0.93, 0.96, 0.98, 1]) ?? 1;
      }
      const f = fMpa * k * MPA_TO_KSC;
      out.push({ key: 'fCorr', label: 'กำลังอัดหลังปรับแก้', value: r(f, 0), unit: 'กก./ตร.ซม.' });
      if (!fc) return { out, level: 'info', value: f };
      const ratio = f / fc;
      out.push({ key: 'ratio', label: "สัดส่วนต่อ fc'", value: r(ratio, 2) });
      const b = bandOf(bands.default, ratio);
      return { out, level: b?.level || 'info', grade: b?.label || null, value: f };
    },
  },
  halfcell: {
    label: 'Half-cell Potential — โอกาสเกิดสนิมเหล็กเสริม', short: 'Half-cell', prefix: 'HC', cat: 'ข. เหล็กเสริมและความคงทน',
    fields: [
      { key: 'electrode', label: 'ขั้วอ้างอิง', kind: 'select', options: ['Cu/CuSO₄ (CSE)', 'Ag/AgCl', 'Calomel (SCE)'] },
      { key: 'readings', label: 'ค่าที่อ่านได้', kind: 'readings', count: 9, unit: 'mV' },
      { key: 'temp', label: 'อุณหภูมิขณะวัด', kind: 'num', unit: '°C' },
    ],
    params: [
      { key: 'agcl', label: 'ค่าปรับ Ag/AgCl → CSE (บวกเพิ่ม)', unit: 'mV', value: -117 },
      { key: 'sce', label: 'ค่าปรับ SCE → CSE (บวกเพิ่ม)', unit: 'mV', value: -74 },
    ],
    bands: {
      default: [
        { min: -200, max: '', label: 'โอกาสเกิดสนิม < 10%', level: 'ok' },
        { min: -350, max: -200, label: 'ไม่แน่นอน', level: 'warn' },
        { min: '', max: -350, label: 'โอกาสเกิดสนิม > 90%', level: 'bad' },
      ],
    },
    criteriaNote: 'ASTM C876 — ประเมินจากค่าที่ติดลบมากที่สุดหลังแปลงเป็นขั้ว CSE',
    calc(v, p, bands) {
      const a = readingsOf(v.readings);
      if (!a.length) return { out: [], level: null };
      const off = /AgCl/.test(v.electrode || '') ? +p.agcl : /SCE|Calomel/.test(v.electrode || '') ? +p.sce : 0;
      const cse = a.map(x => x + off);
      const worst = Math.min(...cse);
      const out = [
        { key: 'avg', label: 'ค่าเฉลี่ย (CSE)', value: r(mean(cse), 0), unit: 'mV' },
        { key: 'worst', label: 'ค่าติดลบมากที่สุด (CSE)', value: r(worst, 0), unit: 'mV' },
      ];
      const b = bandOf(bands.default, worst);
      return { out, level: b?.level || 'info', grade: b?.label || null, value: worst };
    },
  },
  carbonation: {
    label: 'ความลึกคาร์บอเนชัน', short: 'Carbonation', prefix: 'CB', cat: 'ข. เหล็กเสริมและความคงทน',
    fields: [
      { key: 'depthMax', label: 'ความลึกสูงสุด', kind: 'num', unit: 'มม.' },
      { key: 'depthAvg', label: 'ความลึกเฉลี่ย', kind: 'num', unit: 'มม.' },
      { key: 'cover', label: 'ระยะหุ้มที่จุดนี้ (เว้นว่าง = ใช้ค่าจาก Ferro Scan)', kind: 'num', unit: 'มม.' },
    ],
    bands: {
      default: [
        { min: '', max: 0.5, label: 'ยังห่างจากเหล็กเสริม', level: 'ok' },
        { min: 0.5, max: 1, label: 'ใกล้ถึงเหล็กเสริม', level: 'warn' },
        { min: 1, max: '', label: 'ถึงเหล็กเสริมแล้ว', level: 'bad' },
      ],
    },
    criteriaNote: 'เทียบสัดส่วน ความลึกคาร์บอเนชันสูงสุด ÷ ระยะหุ้ม (ช่วงเกณฑ์เป็นค่าเริ่มต้น ปรับได้)',
    calc(v, p, bands, station) {
      const dm = num(v.depthMax) ?? num(v.depthAvg);
      if (dm == null) return { out: [], level: null };
      let cover = num(v.cover), src = '';
      if (cover == null && station?.tests?.ferro) { cover = num(station.tests.ferro.coverMin) ?? num(station.tests.ferro.coverAvg); src = ' (จาก Ferro Scan)'; }
      if (!cover) return { out: [], level: 'info', value: dm };
      const ratio = dm / cover;
      const out = [{ key: 'ratio', label: 'ความลึก ÷ ระยะหุ้ม' + src, value: r(ratio, 2) }];
      const b = bandOf(bands.default, ratio);
      return { out, level: b?.level || 'info', grade: b?.label || null, value: ratio };
    },
  },
  chloride: {
    label: 'ปริมาณคลอไรด์', short: 'Chloride', prefix: 'CL', cat: 'ข. เหล็กเสริมและความคงทน', locationFirst: true,
    fields: [
      { key: 'depth', label: 'ช่วงความลึกที่เก็บตัวอย่าง', kind: 'text', ph: 'เช่น 0–20 มม.' },
      { key: 'cl', label: 'ปริมาณคลอไรด์', kind: 'num', unit: '% โดยน้ำหนักซีเมนต์' },
      { key: 'labNo', label: 'เลขที่รายงานห้องปฏิบัติการ', kind: 'text' },
    ],
    bands: {
      default: [
        { min: '', max: 0.2, label: 'ต่ำ', level: 'ok' },
        { min: 0.2, max: 0.4, label: 'เฝ้าระวัง', level: 'warn' },
        { min: 0.4, max: '', label: 'สูง เสี่ยงต่อการเกิดสนิม', level: 'bad' },
      ],
    },
    criteriaNote: 'ช่วงเกณฑ์เป็นค่าเริ่มต้น — ปรับให้ตรงกับคลังวิธีทดสอบก่อนใช้งานจริง',
    evalField: 'cl',
  },
  hardness: {
    label: 'Leeb Hardness — กำลังรับแรงดึงเหล็ก', short: 'Hardness', prefix: 'HD', cat: 'ข. เหล็กเสริมและความคงทน',
    fields: [
      { key: 'grade', label: 'เกรดตามแบบ', kind: 'select', options: ['SR24', 'SD30', 'SD40', 'SD50', 'SS400', 'SS490', 'SS540'] },
      { key: 'size', label: 'ขนาดเหล็ก / ความหนา', kind: 'num', unit: 'มม.' },
      { key: 'hld', label: 'ค่า HLD รายครั้ง', kind: 'readings', count: 5 },
      { key: 'hb', label: 'ค่า HB รายครั้ง (จากเครื่อง)', kind: 'readings', count: 5 },
      { key: 'hbAvg', label: 'HB เฉลี่ย (ถ้าไม่กรอกรายครั้ง)', kind: 'num' },
    ],
    params: [
      { key: 'fuTable', label: 'Fu ขั้นต่ำตามเกรด (MPa)', kind: 'map', value: { SR24: 385, SD30: 480, SD40: 560, SD50: 620, SS400: 400, SS490: 490, SS540: 540 } },
      { key: 'hbTable', label: 'ตาราง HB → Rm (ISO 18265 ตาราง A.1)', kind: 'pairs',
        value: [[109, 370], [114, 385], [119, 400], [124, 415], [128, 430], [133, 450], [138, 465], [143, 480], [147, 495], [152, 510], [156, 530], [162, 545], [166, 560], [171, 575], [176, 595], [181, 610], [185, 625], [190, 640], [195, 660], [199, 675], [204, 690], [209, 705], [214, 720], [219, 740]] },
      { key: 'minDia', label: 'เหล็กเส้นเล็กสุดที่วัดได้ (H3)', unit: 'มม.', value: 20 },
    ],
    criteriaNote: 'ASTM A956 + ISO 18265 ตาราง A.1 (ประมาณค่าเชิงเส้น ห้ามประมาณนอกช่วงตาราง) ; Fu (ksc) = Rm × 10.197 ; ใช้คัดกรองเท่านั้น (H1, H2)',
    calc(v, p) {
      const out = [];
      const hbs = readingsOf(v.hb);
      const hb = hbs.length ? mean(hbs) : num(v.hbAvg);
      const hld = readingsOf(v.hld);
      if (hld.length) out.push({ key: 'hld', label: 'HLD เฉลี่ย', value: r(mean(hld), 0) });
      if (hb == null) return { out, level: hld.length ? 'info' : null };
      out.push({ key: 'hb', label: 'HB เฉลี่ย', value: r(hb, 0) });
      const tbl = (p.hbTable || []).filter(x => x && x.length === 2).sort((a, b) => a[0] - b[0]);
      const rm = interp(hb, tbl.map(x => +x[0]), tbl.map(x => +x[1]));
      const notes = ['H1', 'H2'];
      if (hld.length && hld.length < 5) notes.push('H12');
      const size = num(v.size);
      if (/^S[RD]/.test(v.grade || '') && size != null && size < +p.minDia) {
        out.push({ key: 'notes', label: 'หมายเหตุ', value: [...notes, 'H3'].join(', ') });
        return { out, level: 'na', grade: 'ประเมินไม่ได้ (เหล็กเล็กกว่าที่วัดได้)' };
      }
      if (rm == null) {
        out.push({ key: 'notes', label: 'หมายเหตุ', value: [...notes, 'H9'].join(', ') });
        return { out, level: 'na', grade: 'ประเมินไม่ได้ (นอกช่วงตาราง)' };
      }
      const fu = rm * MPA_TO_KSC;
      out.push({ key: 'fu', label: 'Fu ประมาณการ', value: r(fu, 0), unit: 'กก./ตร.ซม.' });
      const fuMin = p.fuTable?.[v.grade];
      out.push({ key: 'notes', label: 'หมายเหตุ', value: notes.join(', ') });
      if (!fuMin) return { out, level: 'info', value: fu };
      out.push({ key: 'fuMin', label: 'Fu ขั้นต่ำของเกรด', value: r(fuMin * MPA_TO_KSC, 0), unit: 'กก./ตร.ซม.' });
      const ok = rm >= fuMin;
      return { out, level: ok ? 'ok' : 'bad', grade: ok ? 'ไม่ต่ำกว่าเกณฑ์' : 'ต่ำกว่าเกณฑ์ (ควรทดสอบแรงดึง)', value: fu };
    },
  },
  level: {
    label: 'วัดระดับ (Level Survey)', short: 'ระดับ', prefix: 'LV', cat: 'ค. รูปทรงและการเสียรูป', locationFirst: true,
    fields: [
      { key: 'elev', label: 'ค่าระดับ', kind: 'num', unit: 'ม.' },
      { key: 'ref', label: 'อ้างอิงจาก (BM)', kind: 'text' },
    ],
    criteriaNote: 'บันทึกค่าระดับรายจุด (การทรุดตัวต่างกันและเส้นชั้นระดับจะทำในระยะถัดไป)',
    calc(v) { const e = num(v.elev); return { out: [], level: e == null ? null : 'info', value: e }; },
  },
  deflection: {
    label: 'การแอ่นตัวคาน/พื้น', short: 'แอ่นตัว', prefix: 'DF', cat: 'ค. รูปทรงและการเสียรูป', locationFirst: true,
    fields: [
      { key: 'span', label: 'ช่วงยาว (L)', kind: 'num', unit: 'มม.' },
      { key: 'defl', label: 'ระยะแอ่นตัวที่วัดได้', kind: 'num', unit: 'มม.' },
    ],
    params: [{ key: 'limit', label: 'เกณฑ์ L / …', value: 360 }],
    criteriaNote: 'ผ่านเมื่อ ระยะแอ่นตัว ≤ L ÷ เกณฑ์ (ค่าเริ่มต้น L/360 ปรับได้)',
    calc(v, p) {
      const L = num(v.span), d = num(v.defl);
      if (!L || d == null) return { out: [], level: null };
      const allow = L / +p.limit;
      const out = [{ key: 'ratio', label: 'สัดส่วน', value: d > 0 ? `L/${Math.round(L / d)}` : '-' }, { key: 'allow', label: 'ค่ายอมให้', value: r(allow, 1), unit: 'มม.' }];
      const ok = d <= allow;
      return { out, level: ok ? 'ok' : 'bad', grade: ok ? `ไม่เกิน L/${p.limit}` : `เกิน L/${p.limit}`, value: d };
    },
  },
  plumb: {
    label: 'ความดิ่งเสา/ผนัง', short: 'ความดิ่ง', prefix: 'VT', cat: 'ค. รูปทรงและการเสียรูป', locationFirst: true,
    fields: [
      { key: 'height', label: 'ความสูงที่วัด', kind: 'num', unit: 'มม.' },
      { key: 'offset', label: 'ระยะเยื้องแนวดิ่ง', kind: 'num', unit: 'มม.' },
      { key: 'dir', label: 'ทิศทางการเอียง', kind: 'text' },
    ],
    params: [{ key: 'limit', label: 'เกณฑ์ 1 / …', value: 500 }],
    criteriaNote: 'ผ่านเมื่อ ระยะเยื้อง ÷ ความสูง ≤ 1 ÷ เกณฑ์ (ค่าเริ่มต้น 1/500 ปรับได้)',
    calc(v, p) {
      const H = num(v.height), o = num(v.offset);
      if (!H || o == null) return { out: [], level: null };
      const out = [{ key: 'tilt', label: 'ความเอียง', value: o ? `1/${Math.round(H / Math.abs(o))}` : '0' }];
      const ok = Math.abs(o) / H <= 1 / +p.limit;
      return { out, level: ok ? 'ok' : 'bad', grade: ok ? `ไม่เกิน 1/${p.limit}` : `เกิน 1/${p.limit}`, value: Math.abs(o) / H };
    },
  },
  crack: {
    label: 'ติดตามรอยร้าว', short: 'รอยร้าว', prefix: 'CR', cat: 'ง. รอยร้าว', locationFirst: true,
    fields: [
      { key: 'w0', label: 'ความกว้างครั้งแรก', kind: 'num', unit: 'มม.' },
      { key: 'd0', label: 'วันที่วัดครั้งแรก', kind: 'date' },
      { key: 'w1', label: 'ความกว้างครั้งล่าสุด', kind: 'num', unit: 'มม.' },
      { key: 'd1', label: 'วันที่วัดครั้งล่าสุด', kind: 'date' },
      { key: 'gauge', label: 'อุปกรณ์ (Tell-tale / Crack gauge)', kind: 'text' },
    ],
    criteriaNote: 'แสดงการเปลี่ยนแปลงของความกว้างรอยร้าว (การวัดพิกัดด้วยกล้องใช้ระบบบันทึกพิกัดรอยร้าว)',
    calc(v) {
      const a = num(v.w0), b = num(v.w1);
      if (a == null && b == null) return { out: [], level: null };
      const out = [];
      if (a != null && b != null) out.push({ key: 'dw', label: 'ความกว้างเปลี่ยนไป', value: r(b - a, 2), unit: 'มม.' });
      return { out, level: 'info', value: b ?? a };
    },
  },
  loadtest: {
    label: 'ทดสอบรับน้ำหนักพื้น (Load Test)', short: 'Load Test', prefix: 'LT', cat: 'จ. ทดสอบรับน้ำหนัก', locationFirst: true,
    fields: [
      { key: 'gauge', label: 'หมายเลข Dial gauge', kind: 'text' },
      { key: 'dmax', label: 'ระยะแอ่นตัวสูงสุด', kind: 'num', unit: 'มม.' },
      { key: 'dres', label: 'ระยะแอ่นตัวคงค้างหลังถอนน้ำหนัก', kind: 'num', unit: 'มม.' },
    ],
    params: [{ key: 'recovery', label: 'การคืนตัวขั้นต่ำ', unit: '%', value: 75 }],
    criteriaNote: 'ร้อยละการคืนตัว = (สูงสุด − คงค้าง) ÷ สูงสุด × 100 ; ค่าเริ่มต้น ≥ 75% (ACI 318-08 ข้อ 20.5.2) ปรับได้',
    calc(v, p) {
      const m = num(v.dmax), res = num(v.dres);
      if (!m || res == null) return { out: [], level: null };
      const rec = (m - res) / m * 100;
      const ok = rec >= +p.recovery;
      return { out: [{ key: 'rec', label: 'การคืนตัว', value: r(rec, 1), unit: '%' }], level: ok ? 'ok' : 'bad', grade: ok ? `คืนตัว ≥ ${p.recovery}%` : `คืนตัว < ${p.recovery}%`, value: rec };
    },
  },
};
export const BUILTIN_ORDER = ['ferro', 'upv', 'rebound', 'core', 'halfcell', 'carbonation', 'chloride', 'hardness', 'level', 'deflection', 'plumb', 'crack', 'loadtest'];
export const PRESETS = [
  { label: 'สถานีทดสอบ: Ferro Scan + UPV + Rebound', ids: ['ferro', 'upv', 'rebound'] },
];

// ------------------------------------------------------------------ resolved type (built-in + project overrides)
const clone = (x) => JSON.parse(JSON.stringify(x));
export function settingsOf(project) {
  project.testSettings ||= { types: {}, custom: [], lastSet: ['ferro', 'upv', 'rebound'], prefix: 'ST' };
  return project.testSettings;
}

export function typeDef(project, id) {
  const ts = settingsOf(project);
  const custom = (ts.custom || []).find(c => c.id === id);
  if (custom) {
    return { id, custom: true, short: custom.label, cat: 'ฉ. กำหนดเอง', params: [], criteriaNote: custom.criteriaNote || '',
      ...custom, bands: custom.bands || { default: [] }, paramValues: {},
      calc(v, p, bands) {
        const f = custom.evalField; const x = f ? num(v[f]) : null;
        const any = custom.fields.some(fl => v[fl.key] != null && v[fl.key] !== '' && !(Array.isArray(v[fl.key]) && !readingsOf(v[fl.key]).length));
        if (x == null) return { out: [], level: any ? 'info' : null };
        const b = bandOf(bands.default, x);
        return { out: [], level: b?.level || 'info', grade: b?.label || null, value: x };
      } };
  }
  const base = BUILTIN[id];
  if (!base) return null;
  const ov = ts.types?.[id] || {};
  const paramValues = {};
  (base.params || []).forEach(p => { paramValues[p.key] = ov.params?.[p.key] ?? clone(p.value); });
  let calc = base.calc;
  if (!calc && base.evalField) {
    calc = function (v, p, bands) {
      const x = num(v[base.evalField]);
      const any = base.fields.some(fl => v[fl.key] != null && v[fl.key] !== '');
      if (x == null) return { out: [], level: any ? 'info' : null };
      const b = bandOf(bands.default, x);
      return { out: [], level: b?.level || 'info', grade: b?.label || null, value: x };
    };
  }
  return { ...base, id, calc, label: ov.label || base.label, short: ov.short || base.short, prefix: ov.prefix || base.prefix, hidden: !!ov.hidden,
    bands: ov.bands ? clone(ov.bands) : clone(base.bands || {}), paramValues };
}

export function allTypes(project, { includeHidden = false } = {}) {
  const ts = settingsOf(project);
  const ids = [...BUILTIN_ORDER, ...(ts.custom || []).map(c => c.id)];
  return ids.map(id => typeDef(project, id)).filter(t => t && (includeHidden || !t.hidden));
}

// Evaluate one test inside a station
export function evalTest(project, station, id) {
  const t = typeDef(project, id);
  const v = station.tests?.[id] || {};
  if (!t) return { out: [], level: null };
  try {
    const res = t.calc ? t.calc.call(t, v, t.paramValues, t.bands, station) : { out: [], level: null };
    const level = res.level || null;
    return { ...res, level, recorded: level != null };
  } catch (e) { console.warn(e); return { out: [], level: 'na', grade: 'คำนวณไม่ได้' }; }
}

export function stationLevel(project, st) {
  const lv = Object.keys(st.tests || {}).map(id => evalTest(project, st, id).level || 'none');
  return lv.length ? worstLevel(lv) : 'none';
}

export function levelColor(l) { return (LEVEL[l] || LEVEL.none).color; }

// Raw field value as text
export function fieldValueText(f, v) {
  if (v == null || v === '') return '';
  if (f.kind === 'readings') return readingsOf(v).join(' ');
  return String(v);
}

// ------------------------------------------------------------------ station codes
export function prefixFor(project, ids) {
  if (ids.length === 1) return typeDef(project, ids[0])?.prefix || 'T';
  return settingsOf(project).prefix || 'ST';
}
export function nextCode(project, stations, prefix) {
  let max = 0;
  const re = new RegExp('^' + prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '-?(\\d+)$', 'i');
  stations.forEach(s => { const m = String(s.code || '').match(re); if (m) max = Math.max(max, +m[1]); });
  let n = max + 1, code;
  do { code = `${prefix}-${String(n).padStart(2, '0')}`; n++; } while (stations.some(s => String(s.code).toLowerCase() === code.toLowerCase()));
  return code;
}
