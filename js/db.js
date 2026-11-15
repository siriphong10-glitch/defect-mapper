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

export const db = {
  async get(name, key) { return wrap((await store(name)).get(key)); },
  async all(name) { return wrap((await store(name)).getAll()); },
  async byProject(name, projectId) {
    return wrap((await store(name)).index('projectId').getAll(projectId));
  },
  async put(name, value) { return wrap((await store(name, 'readwrite')).put(value)); },
  async del(name, key) { return wrap((await store(name, 'readwrite')).delete(key)); },

  async putBlob(blob, id = uid()) {
    await this.put('blobs', { id, blob, type: blob.type });
    return id;
  },
  async getBlob(id) {
    if (!id) return null;
    const r = await this.get('blobs', id);
    return r ? r.blob : null;
  },
  async delBlob(id) { if (id) await this.del('blobs', id); },

  async getMeta(key, fallback = null) {
    const r = await this.get('meta', key);
    return r ? r.value : fallback;
  },
  async setMeta(key, value) { return this.put('meta', { key, value }); },

  async deleteProject(projectId) {
    const p = await this.get('projects', projectId);
    const floors = await this.byProject('floors', projectId);
    const defects = await this.byProject('defects', projectId);
    for (const f of floors) { await this.delBlob(f.blobId); await this.del('floors', f.id); }
    for (const d of defects) {
      for (const ph of d.photoIds || []) await this.delBlob(ph);
      await this.del('defects', d.id);
    }
    if (p) await this.delBlob(p.coverBlobId);
    await this.del('projects', projectId);
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
