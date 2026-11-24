// Overhead positions: items seen from a floor but belonging to the structure above it
// (slab soffit / beam underside = structure of the next floor). Only structural defects
// and test stations can be overhead — an architectural ceiling belongs to its own floor.
//
// item.pos = 'above'           → overhead (absent = in the floor area)
// floor.upId                   → optional override of "the floor above" (default: next floor in the list)
// floor.upAlign = { floorId, pairs: [[[x,y] lower, [x,y] upper], [[x,y],[x,y]]] }
//                              → 2 matched reference points between this plan and the plan above
// project.overheadView = 'found' (default) | 'structure'

// 'ชั้น 4' reads fine after a Thai word; other names (e.g. 'Roof') need a space
export const joinName = (word, name) => word + (/^ชั้น/.test(name || '') ? '' : ' ') + (name || '');

export const canOverhead = (d) => d.layer === 'test' || (d.type || 'structural') === 'structural';
export const isOverhead = (d) => d.pos === 'above' && canOverhead(d);
export const overheadView = (project) => (project?.overheadView === 'structure' ? 'structure' : 'found');

export function upperFloor(floors, f) {
  if (!f) return null;
  if (f.upId) { const u = floors.find(x => x.id === f.upId); if (u && u.id !== f.id) return u; }
  const i = floors.findIndex(x => x.id === f.id);
  return i >= 0 && i < floors.length - 1 ? floors[i + 1] : null;
}

// Similarity transform (shift + rotate + uniform scale) from two point pairs, as complex numbers:
// z' = s·z + t
export function similarity(pairs) {
  const [[p1, q1], [p2, q2]] = pairs;
  const dx = p2[0] - p1[0], dy = p2[1] - p1[1];
  const ex = q2[0] - q1[0], ey = q2[1] - q1[1];
  const den = dx * dx + dy * dy;
  if (den < 1e-6) return null;
  const a = (ex * dx + ey * dy) / den, b = (ey * dx - ex * dy) / den; // s = a + ib
  const tx = q1[0] - (a * p1[0] - b * p1[1]), ty = q1[1] - (b * p1[0] + a * p1[1]);
  return { a, b, tx, ty, scale: Math.hypot(a, b), rot: Math.atan2(b, a) * 180 / Math.PI };
}

export function alignmentOf(lower, upper) {
  const al = lower?.upAlign;
  if (al && al.floorId === upper?.id && al.pairs?.length === 2) return similarity(al.pairs);
  return null;
}

// map a point from the lower plan to the upper plan
export function mapToUpper(lower, upper, pt) {
  const T = alignmentOf(lower, upper);
  if (T) return [T.a * pt[0] - T.b * pt[1] + T.tx, T.b * pt[0] + T.a * pt[1] + T.ty];
  // no reference points → assume both plans share the same sheet frame
  return [pt[0] * upper.w / lower.w, pt[1] * upper.h / lower.h];
}

// Items as they should be presented (exports, dashboard). In 'structure' view an overhead item is
// moved to the floor above (cloned, original untouched). Every returned item carries:
//   _found: floor where it was recorded, _struct: floor whose structure it is (null = unknown)
export function presentItems(project, floors, items) {
  const view = overheadView(project);
  const byId = new Map(floors.map(f => [f.id, f]));
  return items.map(d => {
    const found = byId.get(d.floorId);
    if (!isOverhead(d)) return ({ ...d, _found: found || null, _struct: found || null, _over: false });
    const up = upperFloor(floors, found);
    if (view === 'structure' && up) {
      const c = { ...d, floorId: up.id, pts: d.pts.map(p => mapToUpper(found, up, p)) };
      return Object.assign(c, { _found: found, _struct: up, _over: true, _moved: true });
    }
    return ({ ...d, _found: found || null, _struct: up, _over: true });
  });
}

// short Thai text describing where an item is, for tables
export function positionNote(it) {
  if (!it._over) return '';
  if (it._moved) return `ท้องพื้น/ท้องคาน (${it._found ? joinName('พบจาก', it._found.name) : 'พบจากชั้นล่าง'})`;
  return it._struct ? `เหนือศีรษะ (${joinName('โครงสร้าง', it._struct.name)})` : 'เหนือศีรษะ (โครงสร้างชั้นถัดไป)';
}

export function overheadLegend(project, items) {
  if (!items.some(i => i._over || i.over)) return null;
  return overheadView(project) === 'structure'
    ? 'กรอบเส้นประ = ท้องพื้น/ท้องคาน (พบจากชั้นล่าง)'
    : 'กรอบเส้นประ = เหนือศีรษะ (โครงสร้างชั้นถัดไป)';
}
