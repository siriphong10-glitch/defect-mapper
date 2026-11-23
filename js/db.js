// IndexedDB storage layer — everything stays in the user's browser.
const DB_NAME = 'defect-mapper';
const DB_VERSION = 1;
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('floors')) {
        const s = db.createObjectStore('floors', { keyPath: 'id' });
        s.createIndex('projectId', 'projectId');
      }
      if (!db.objectStoreNames.contains('defects')) {
        const s = db.createObjectStore('defects', { keyPath: 'id' });
        s.createIndex('projectId', 'projectId');
      }
      if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function wrap(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function store(name, mode = 'readonly') {
  const db = await open();
  return db.transaction(name, mode).objectStore(name);
}

const SYNCED = new Set(['projects', 'floors', 'defects']);
// hooks are installed by sync.js when a shared (Google Drive) backend is configured
export const hooks = { onPut: null, onDel: null, onBlob: null, onDelBlob: null, fetchBlob: null };

export const db = {
  async get(name, key) { return wrap((await store(name)).get(key)); },
  async all(name) { return wrap((await store(name)).getAll()); },
  async byProject(name, projectId) {
    return wrap((await store(name)).index('projectId').getAll(projectId));
  },
  // local-only writes (used when applying data pulled from the server)
  async rawPut(name, value) { return wrap((await store(name, 'readwrite')).put(value)); },
  async rawDel(name, key) { return wrap((await store(name, 'readwrite')).delete(key)); },

  async put(name, value) {
    const r = await this.rawPut(name, value);
    if (hooks.onPut && SYNCED.has(name)) hooks.onPut(name, value);
    return r;
  },
  async del(name, key) {
    const rec = hooks.onDel && SYNCED.has(name) ? await this.get(name, key) : null;
    const r = await this.rawDel(name, key);
    if (rec) hooks.onDel(name, rec);
    return r;
  },

  async putBlob(blob, id = uid()) {
    await this.rawPut('blobs', { id, blob, type: blob.type });
    if (hooks.onBlob) hooks.onBlob(id);
    return id;
  },
  async getBlob(id) {
    if (!id) return null;
    const r = await this.get('blobs', id);
    if (r) return r.blob;
    if (hooks.fetchBlob) {
      const b = await hooks.fetchBlob(id);
      if (b) { await this.rawPut('blobs', { id, blob: b, type: b.type }); return b; }
    }
    return null;
  },
  async delBlob(id) {
    if (!id) return;
    await this.rawDel('blobs', id);
    if (hooks.onDelBlob) hooks.onDelBlob(id);
  },

  async getMeta(key, fallback = null) {
    const r = await this.get('meta', key);
    return r ? r.value : fallback;
  },
  async setMeta(key, value) { return this.rawPut('meta', { key, value }); },

  // Remove a project locally. When synced, the server deletes the whole project (and its files) in one op.
  async deleteProject(projectId, { local = false } = {}) {
    const p = await this.get('projects', projectId);
    const floors = await this.byProject('floors', projectId);
    const defects = await this.byProject('defects', projectId);
    const ids = new Set(floors.flatMap(f => [f.blobId, f.srcBlobId]).filter(Boolean)); // shared by several floors
    for (const id of ids) await this.rawDel('blobs', id);
    for (const f of floors) await this.rawDel('floors', f.id);
    for (const d of defects) {
      for (const ph of d.photoIds || []) if (ph) await this.rawDel('blobs', ph);
      await this.rawDel('defects', d.id);
    }
    if (p?.coverBlobId) await this.rawDel('blobs', p.coverBlobId);
    await this.rawDel('projects', projectId);
    if (!local && p && hooks.onDel) hooks.onDel('projects', p);
  },
};

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

// Ask the browser not to evict our data under storage pressure.
export async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      const already = await navigator.storage.persisted();
      if (!already) await navigator.storage.persist();
    }
  } catch { /* ignore */ }
}

// Object-URL cache for blobs shown in the UI
const urlCache = new Map();
export async function blobUrl(id) {
  if (!id) return null;
  if (urlCache.has(id)) return urlCache.get(id);
  const b = await db.getBlob(id);
  if (!b) return null;
  const u = URL.createObjectURL(b);
  urlCache.set(id, u);
  return u;
}
export function forgetUrl(id) {
  if (urlCache.has(id)) { URL.revokeObjectURL(urlCache.get(id)); urlCache.delete(id); }
}
