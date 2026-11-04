/**
 * IndexedDB cache for baked sprite atlases (spec F6: baked once on first launch, then loaded).
 * A separate database from the game save, so "reset my realm" never throws the art away.
 * Every call fails soft: no IndexedDB (private mode, old WebView) just means "bake again".
 */
const DB = 'realm-raiders-art';
const STORE = 'atlas';

let dbp: Promise<IDBDatabase | null> | null = null;
function db(): Promise<IDBDatabase | null> {
  if (dbp) return dbp;
  dbp = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null);
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbp;
}

export async function artGet(key: string): Promise<Blob | null> {
  const d = await db();
  if (!d) return null;
  return new Promise((resolve) => {
    try {
      const req = d.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result instanceof Blob ? req.result : null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function artPut(key: string, blob: Blob): Promise<void> {
  const d = await db();
  if (!d) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = d.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(blob, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}
