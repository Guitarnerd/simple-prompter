// IndexedDB: saved scripts plus a small key/value store (settings, remote map).
// Falls back to memory when IndexedDB is unavailable (some private windows), so the app still runs.

const mem = { scripts: new Map(), kv: new Map() };

const db = new Promise(resolve => {
  try {
    const req = indexedDB.open('simple-prompter', 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('scripts', { keyPath: 'id' });
      req.result.createObjectStore('kv');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = req.onblocked = () => resolve(null);
  } catch {
    resolve(null);
  }
});

async function run(storeName, mode, fn) {
  const d = await db;
  if (!d) return undefined;
  return new Promise((resolve, reject) => {
    const tx = d.transaction(storeName, mode);
    const req = fn(tx.objectStore(storeName));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}

const hasDb = async () => !!(await db);

export async function get(key) {
  return (await hasDb()) ? run('kv', 'readonly', s => s.get(key)) : mem.kv.get(key);
}

export async function set(key, value) {
  if (await hasDb()) await run('kv', 'readwrite', s => s.put(value, key));
  else mem.kv.set(key, value);
}

export async function allScripts() {
  const list = (await hasDb()) ? await run('scripts', 'readonly', s => s.getAll()) : [...mem.scripts.values()];
  return list.sort((a, b) => a.addedAt - b.addedAt);
}

export async function putScript(script) {
  if (await hasDb()) await run('scripts', 'readwrite', s => s.put(script));
  else mem.scripts.set(script.id, script);
}

export async function deleteScript(id) {
  if (await hasDb()) await run('scripts', 'readwrite', s => s.delete(id));
  else mem.scripts.delete(id);
}
