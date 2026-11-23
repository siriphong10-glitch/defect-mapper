import { db, uid } from './db.js';
import { defaultTemplates } from './templates.js';
import { naturalCmp } from './utils.js';

export async function newProject(fields) {
  const saved = await db.getMeta('defaultTemplates', null);
  const p = {
    id: uid(),
    name: fields.name,
    code: fields.code || '',
    client: fields.client || '',
    location: fields.location || '',
    inspector: fields.inspector || '',
    inspectDate: fields.inspectDate || '',
    accent: fields.accent || '#1f3a5f',
    coverBlobId: fields.coverBlobId || null,
    numbering: fields.numbering,          // 'auto' | 'manual'
    defaultType: fields.defaultType || 'structural',
    templates: saved ? JSON.parse(JSON.stringify(saved)) : defaultTemplates(),
    testSettings: (await db.getMeta('defaultTestSettings', null)) || undefined,
    floorOrder: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await db.put('projects', p);
  return p;
}

export async function touch(project) {
  project.updatedAt = Date.now();
  await db.put('projects', project);
}

export async function loadBundle(projectId) {
  const project = await db.get('projects', projectId);
  if (!project) return null;
  const floors = await db.byProject('floors', projectId);
  const order = project.floorOrder || [];
  floors.sort((a, b) => {
    const ia = order.indexOf(a.id), ib = order.indexOf(b.id);
    return (ia < 0 ? 1e9 : ia) - (ib < 0 ? 1e9 : ib) || a.createdAt - b.createdAt;
  });
  const all = await db.byProject('defects', projectId);
  // test stations share the 'defects' store (layer: 'test') so they sync with the same backend
  const defects = all.filter(d => d.layer !== 'test');
  const tests = all.filter(d => d.layer === 'test');
  return { project, floors, defects, tests };
}

// ---------- numbering ----------
export const normNo = (s) => String(s ?? '').trim().toLowerCase();

export function isDuplicateNo(defects, no, exceptId) {
  const n = normNo(no);
  if (!n) return false;
  return defects.some(d => d.id !== exceptId && normNo(d.no) === n);
}

function bump(no) {
  const m = String(no).match(/^(.*?)(\d+)(\D*)$/);
  if (!m) return String(no) + '-1';
  const [, pre, digits, post] = m;
  const next = String(parseInt(digits, 10) + 1).padStart(digits.length, '0');
  return pre + next + post;
}

// Next number for a new pin.
//  auto   → max numeric + 1
//  manual → continue from the most recently created pin (keeps prefix/padding), skipping duplicates
export function suggestNo(project, defects) {
  if (!defects.length) return '1';
  if (project.numbering === 'auto') {
    const max = defects.reduce((m, d) => Math.max(m, parseInt(d.no, 10) || 0), 0);
    return String(max + 1);
  }
  const last = [...defects].sort((a, b) => a.createdAt - b.createdAt).at(-1);
  let s = bump(last.no || '0');
  let guard = 0;
  while (isDuplicateNo(defects, s) && guard++ < 10000) s = bump(s);
  return s;
}

export function sortDefects(defects, floors) {
  const fo = new Map(floors.map((f, i) => [f.id, i]));
  return [...defects].sort((a, b) => naturalCmp(a.no, b.no) || (fo.get(a.floorId) ?? 0) - (fo.get(b.floorId) ?? 0));
}

// Re-assign 1..n following floor order, then current number / creation order.
export async function renumberAll(project, floors, defects) {
  const fo = new Map(floors.map((f, i) => [f.id, i]));
  const list = [...defects].sort((a, b) =>
    (fo.get(a.floorId) ?? 0) - (fo.get(b.floorId) ?? 0) || naturalCmp(a.no, b.no) || a.createdAt - b.createdAt);
  let i = 1;
  for (const d of list) { d.no = String(i++); await db.put('defects', d); }
}
