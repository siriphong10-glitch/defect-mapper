// Inspection templates (form schemas). Every project keeps its own copy so
// headings/options can be edited per project without affecting old projects.
//
// Field kinds:
//   select   – pick one option (dropdown)
//   choice   – pick one option, printed as ☑/☐ boxes in reports
//   checks   – pick many options, printed as ☑/☐ boxes
//   severity – pick one level, each level has a colour (used for pins)
//   text     – single line            textarea – paragraph
//   list     – numbered lines (e.g. repair steps)
// role: element | title | severity | urgency | size   (core fields used by the app)

export const TYPE_LABELS = { structural: 'ตรวจสอบโครงสร้าง', general: 'ตรวจสอบทั่วไป' };

export const DEFAULT_SEVERITY = [
  { label: 'เล็กน้อย', color: '#FFE699' },
  { label: 'ปานกลาง', color: '#F4B183' },
  { label: 'รุนแรง', color: '#FF0000' },
];

export function defaultTemplates() {
  return {
    structural: {
      name: TYPE_LABELS.structural,
      fields: [
        { key: 'element', label: 'โครงสร้าง', kind: 'select', role: 'element',
          options: ['เสา', 'คาน', 'พื้น', 'ท้องพื้น', 'ผนัง', 'ฐานราก', 'บันได', 'หลังคา', 'อื่น ๆ'] },
        { key: 'title', label: 'รูปแบบความเสียหาย', kind: 'text', role: 'title',
          suggestions: ['คอนกรีตหลุดล่อนจนเห็นเหล็กเสริมเป็นสนิม', 'คอนกรีตแตกร้าว', 'คราบน้ำรั่วซึม',
            'น้ำรั่วซึมบริเวณรอยต่อโครงสร้าง', 'รอยแตกร้าวเนื่องจากอุณหภูมิ'] },
        { key: 'details', label: 'รายละเอียดความเสียหาย', kind: 'checks',
          options: ['คราบน้ำซึม', 'น้ำขัง', 'เหล็กเสริมเป็นสนิม', 'คอนกรีตหลุดล่อน', 'คอนกรีตร้าว', 'สีหลุดล่อน',
            'รอยแตกร้าวเนื่องจากอุณหภูมิ', 'หลุดร่อนเป็นหลุม', 'ช่องว่างจากงานก่อสร้าง', 'คราบหินปูน'] },
        { key: 'severity', label: 'ระดับความเสียหาย', kind: 'severity', role: 'severity',
          options: DEFAULT_SEVERITY.map(o => ({ ...o })) },
        { key: 'urgency', label: 'ความเร่งด่วน', kind: 'select', role: 'urgency',
          options: ['ไม่เร่งด่วน', 'สำคัญ', 'เร่งด่วน'] },
        { key: 'size', label: 'ขนาดความเสียหาย', kind: 'text', role: 'size' },
        { key: 'stability', label: 'ผลกระทบต่อความมั่นคง', kind: 'choice',
          options: ['ส่งผลให้ความมั่นคงแข็งแรงลดลง', 'ไม่ส่งผลกับความมั่นคงแข็งแรงโดยรวม'] },
        { key: 'durability', label: 'ผลกระทบต่อความคงทน', kind: 'choice',
          options: ['ส่งผลให้ความคงทนลดลง', 'ไม่ส่งผลกับความคงทน'] },
        { key: 'zone', label: 'พื้นที่ความเสียหาย', kind: 'checks', options: ['ภายในอาคาร', 'ภายนอกอาคาร'] },
        { key: 'grid', label: 'ตำแหน่ง (กริดไลน์)', kind: 'text' },
        { key: 'remark', label: 'คำอธิบายเพิ่มเติม', kind: 'textarea' },
        { key: 'repair', label: 'รายละเอียดการแก้ไข', kind: 'list' },
      ],
    },
    general: {
      name: TYPE_LABELS.general,
      fields: [
        { key: 'category', label: 'หมวดงาน', kind: 'select', role: 'element',
          options: ['งานสถาปัตยกรรม', 'งานโครงสร้าง', 'งานระบบไฟฟ้า', 'งานระบบสุขาภิบาล',
            'งานระบบปรับอากาศและระบายอากาศ', 'งานระบบป้องกันอัคคีภัย', 'งานลิฟต์', 'งานภายนอกอาคาร', 'อื่น ๆ'] },
        { key: 'title', label: 'รายการความบกพร่อง', kind: 'text', role: 'title',
          suggestions: ['ผนังแตกร้าว', 'สีหลุดล่อน/โป่งพอง', 'คราบน้ำรั่วซึม', 'ฝ้าเพดานชำรุด', 'กระเบื้องแตก/ร่อน',
            'ประตู-หน้าต่างชำรุด', 'ยาแนวเสื่อมสภาพ', 'อุปกรณ์ไฟฟ้าชำรุด', 'ท่อรั่วซึม', 'งานติดตั้งไม่เรียบร้อย'] },
        { key: 'severity', label: 'ระดับความบกพร่อง', kind: 'severity', role: 'severity',
          options: DEFAULT_SEVERITY.map(o => ({ ...o })) },
        { key: 'urgency', label: 'ความเร่งด่วน', kind: 'select', role: 'urgency',
          options: ['ไม่เร่งด่วน', 'สำคัญ', 'เร่งด่วน'] },
        { key: 'room', label: 'ห้อง/บริเวณ', kind: 'text' },
        { key: 'size', label: 'ขนาด/ปริมาณ', kind: 'text', role: 'size' },
        { key: 'desc', label: 'รายละเอียด', kind: 'textarea' },
        { key: 'recommend', label: 'ข้อเสนอแนะ/วิธีการแก้ไข', kind: 'list' },
      ],
    },
  };
}

export const KIND_LABELS = {
  select: 'เลือก 1 ตัวเลือก (ดรอปดาวน์)',
  choice: 'เลือก 1 ตัวเลือก (แสดงเป็นช่องติ๊ก)',
  checks: 'เลือกได้หลายข้อ (ช่องติ๊ก)',
  text: 'ข้อความสั้น',
  textarea: 'ข้อความยาว',
  list: 'รายการเรียงข้อ (1. 2. 3.)',
  severity: 'ระดับความรุนแรง (มีสี)',
};

export function fieldByRole(tpl, role) {
  return tpl.fields.find(f => f.role === role);
}

export function severityInfo(tpl, value) {
  const f = fieldByRole(tpl, 'severity');
  if (!f) return null;
  const idx = f.options.findIndex(o => o.label === value);
  if (idx < 0) return null;
  return { ...f.options[idx], rank: idx };
}

export const NO_SEVERITY_COLOR = '#2F6FEB';

// readable text colour on a coloured background
export function textOn(hex) {
  const h = (hex || '#ffffff').replace('#', '');
  const r = parseInt(h.substr(0, 2), 16), g = parseInt(h.substr(2, 2), 16), b = parseInt(h.substr(4, 2), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#111111' : '#ffffff';
}

// Value of a defect field as plain text (used in lists, Excel, JSON)
export function fieldText(field, value) {
  if (value == null || value === '') return '';
  if (Array.isArray(value)) {
    if (field.kind === 'list') return value.filter(Boolean).map((v, i) => `${i + 1}. ${v}`).join('\n');
    return value.filter(Boolean).join(', ');
  }
  return String(value);
}

export function defectTitle(project, d) {
  const tpl = project.templates[d.type] || project.templates.structural;
  const t = (d.data?.title || '').trim();
  if (t) return t;
  const el = fieldByRole(tpl, 'element');
  const det = tpl.fields.find(f => f.kind === 'checks');
  const parts = [];
  if (det && Array.isArray(d.data?.[det.key]) && d.data[det.key].length) parts.push(d.data[det.key].join(', '));
  if (!parts.length && el && d.data?.[el.key]) parts.push(d.data[el.key]);
  return parts.join(' ') || '(ยังไม่ระบุหัวข้อ)';
}

// Grouping key: same inspection type + element + title => one heading in the report
export function groupKey(project, d) {
  const tpl = project.templates[d.type];
  const el = fieldByRole(tpl, 'element');
  const elv = el ? (d.data?.[el.key] || '') : '';
  return `${d.type}|${elv}|${defectTitle(project, d).replace(/\s+/g, ' ').trim().toLowerCase()}`;
}
