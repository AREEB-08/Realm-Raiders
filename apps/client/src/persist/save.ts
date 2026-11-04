/**
 * Local save for the in-app (offline) world. Pattern adapted from the reused web-coc save module:
 * IndexedDB is the primary store, a synchronous localStorage copy is the backup (written in
 * the same tick, so a kill between the two never loses both), and a save that fails to parse
 * is kept aside as a damaged copy instead of being overwritten.
 */
const DB = 'realm-raiders';
const STORE = 'saves';
const KEY = 'world';
const BACKUP = 'realm-raiders-backup';
const VERSION = 1;

interface Envelope {
  v: number;
  savedAt: number;
  data: unknown;
}

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
}

let dbPromise: Promise<IDBDatabase | null> | null = null;
const db = () => (dbPromise ??= openDb());

function idbGet(d: IDBDatabase): Promise<unknown> {
  return new Promise((resolve) => {
    const tx = d.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(KEY);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => resolve(null);
  });
}

function idbPut(d: IDBDatabase, value: unknown): Promise<boolean> {
  return new Promise((resolve) => {
    const tx = d.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, KEY);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
    tx.onabort = () => resolve(false);
  });
}

function valid(x: unknown): x is Envelope {
  return !!x && typeof x === 'object' && (x as Envelope).v === VERSION && 'data' in (x as Envelope);
}

function keepDamaged(raw: unknown) {
  try {
    localStorage.setItem(`realm-raiders-damaged-${Date.now()}`, typeof raw === 'string' ? raw.slice(0, 200_000) : JSON.stringify(raw).slice(0, 200_000));
  } catch {
    /* storage full: nothing more we can do */
  }
}

export async function loadWorld(): Promise<{ data: unknown | null; source: 'idb' | 'backup' | 'none' }> {
  const d = await db();
  let primary: Envelope | null = null;
  if (d) {
    const raw = await idbGet(d);
    if (valid(raw)) primary = raw;
    else if (raw) keepDamaged(raw);
  }
  let backup: Envelope | null = null;
  try {
    const raw = localStorage.getItem(BACKUP);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (valid(parsed)) backup = parsed;
      else keepDamaged(raw);
    }
  } catch (e) {
    keepDamaged(String(e));
  }
  // The newer of the two wins (the backup is written synchronously, so it can be newer).
  if (primary && (!backup || primary.savedAt >= backup.savedAt)) return { data: primary.data, source: 'idb' };
  if (backup) return { data: backup.data, source: 'backup' };
  return { data: null, source: 'none' };
}

let timer: ReturnType<typeof setTimeout> | null = null;
let latest: Envelope | null = null;

/** Throttled persistence: backup now, IndexedDB within 400 ms. */
export function saveWorld(data: unknown) {
  latest = { v: VERSION, savedAt: Date.now(), data };
  try {
    const text = JSON.stringify(latest);
    if (text.length < 4_500_000) localStorage.setItem(BACKUP, text);
  } catch {
    /* quota: IndexedDB still has it */
  }
  if (timer) return;
  timer = setTimeout(async () => {
    timer = null;
    const d = await db();
    if (d && latest) await idbPut(d, latest);
  }, 400);
}

export async function flushWorld() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  const d = await db();
  if (d && latest) await idbPut(d, latest);
}

export async function wipeWorld() {
  latest = null;
  try {
    localStorage.removeItem(BACKUP);
  } catch {
    /* ignore */
  }
  const d = await db();
  if (d) await idbPut(d, null);
}

/**
 * One writer per origin (adapted from the reused session lock). Unlike the original, a WebView
 * without the Web Locks API (Capacitor's floor is below Chromium 69) is allowed to continue.
 */
export function acquireWriter(): Promise<() => void> {
  const locks = (navigator as Navigator & { locks?: LockManager }).locks;
  if (!locks) return Promise.resolve(() => {});
  return new Promise((resolve) => {
    void locks.request('realm-raiders-writer', { mode: 'exclusive' }, async () => {
      await new Promise<void>((release) => resolve(release));
    });
  });
}
