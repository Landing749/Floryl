/**
 * db.js — the only file that talks to IndexedDB.
 * Everything else in the app asks this module for data;
 * nothing else opens a transaction directly.
 */

const DB_NAME = 'pressed-flower-journal';
const DB_VERSION = 1;
const STORE_FLOWERS = 'flowers';
const STORE_POSTS = 'posts';
const STORE_SETTINGS = 'settings';

let dbPromise = null;

/** DBError carries a friendly message alongside the technical cause. */
class DBError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'DBError';
    this.cause = cause;
  }
}

function openDB() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new DBError('This browser does not support local storage, so Pressed cannot save anything on this device.'));
      return;
    }

    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(watchdog);
      fn(value);
    };

    // Some private-browsing modes and sandboxed embeds never fire any
    // event on the open request. Without this, the app would show a
    // loading state forever with no way out.
    const watchdog = setTimeout(() => {
      dbPromise = null; // let a later attempt (e.g. after reload) retry
      finish(reject, new DBError('Local storage is taking too long to respond. If you\u2019re in a private/incognito window or an embedded preview, your browser may be restricting storage \u2014 try opening Pressed in a regular tab.'));
    }, 7000);

    let request;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (err) {
      dbPromise = null;
      finish(reject, new DBError('Pressed could not open local storage in this browser context.', err));
      return;
    }

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      if (!db.objectStoreNames.contains(STORE_FLOWERS)) {
        const flowers = db.createObjectStore(STORE_FLOWERS, { keyPath: 'id' });
        flowers.createIndex('dateAdded', 'dateAdded', { unique: false });
        flowers.createIndex('name', 'name', { unique: false });
      }

      if (!db.objectStoreNames.contains(STORE_POSTS)) {
        db.createObjectStore(STORE_POSTS, { keyPath: 'id' });
      }

      if (!db.objectStoreNames.contains(STORE_SETTINGS)) {
        db.createObjectStore(STORE_SETTINGS, { keyPath: 'key' });
      }
    };

    request.onsuccess = () => finish(resolve, request.result);

    request.onerror = () => {
      dbPromise = null;
      finish(reject, new DBError('Pressed could not open its local storage. Reloading the app sometimes fixes this.', request.error));
    };

    request.onblocked = () => {
      dbPromise = null;
      finish(reject, new DBError('Local storage is in use by another tab. Close other tabs running Pressed and try again.'));
    };
  });

  return dbPromise;
}

function runTx(storeName, mode, work) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    let tx;
    try {
      tx = db.transaction(storeName, mode);
    } catch (err) {
      reject(new DBError('Pressed could not start a storage operation. Try reloading the app.', err));
      return;
    }
    const store = tx.objectStore(storeName);
    let result;

    try {
      result = work(store);
    } catch (err) {
      reject(new DBError('Something went wrong while saving. Nothing was changed.', err));
      return;
    }

    tx.oncomplete = () => resolve(result);
    tx.onerror = () => {
      const err = tx.error;
      if (err && err.name === 'QuotaExceededError') {
        reject(new DBError('Your device is out of storage space. Free up some space, or delete an older flower, and try again.', err));
      } else {
        reject(new DBError('Pressed could not complete that action. Nothing was changed.', err));
      }
    };
    tx.onabort = () => {
      reject(new DBError('The action was interrupted, so nothing was changed.', tx.error));
    };
  }));
}

function reqToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function uid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

const DB = {
  DBError,

  /** Add a new flower record. Returns the stored flower (with id). */
  async addFlower(flower) {
    if (!flower || !flower.photoBlob) {
      throw new DBError('A flower needs a photo before it can be saved.');
    }
    const record = {
      id: uid(),
      name: (flower.name || '').trim() || 'Unnamed flower',
      scientificName: (flower.scientificName || '').trim(),
      symbolism: (flower.symbolism || '').trim(),
      note: (flower.note || '').trim(),
      photoBlob: flower.photoBlob,
      dateAdded: flower.dateAdded || new Date().toISOString(),
    };
    return runTx(STORE_FLOWERS, 'readwrite', (store) => {
      store.add(record);
      return record;
    });
  },

  /** Fetch a single flower by id, or null if it no longer exists. */
  async getFlower(id) {
    const db = await openDB();
    const tx = db.transaction(STORE_FLOWERS, 'readonly');
    const store = tx.objectStore(STORE_FLOWERS);
    const result = await reqToPromise(store.get(id));
    return result || null;
  },

  /** Fetch every saved flower, newest first. */
  async getAllFlowers() {
    const db = await openDB();
    const tx = db.transaction(STORE_FLOWERS, 'readonly');
    const store = tx.objectStore(STORE_FLOWERS);
    const all = await reqToPromise(store.getAll());
    return all.sort((a, b) => new Date(b.dateAdded) - new Date(a.dateAdded));
  },

  /** Update fields on an existing flower. Pass only the fields that changed. */
  async updateFlower(id, changes) {
    return runTx(STORE_FLOWERS, 'readwrite', (store) => {
      const getReq = store.get(id);
      return new Promise((resolve, reject) => {
        getReq.onsuccess = () => {
          const existing = getReq.result;
          if (!existing) {
            reject(new DBError('That flower no longer exists — it may have been deleted already.'));
            return;
          }
          const updated = { ...existing, ...changes, id: existing.id };
          const putReq = store.put(updated);
          putReq.onsuccess = () => resolve(updated);
          putReq.onerror = () => reject(putReq.error);
        };
        getReq.onerror = () => reject(getReq.error);
      });
    }).then((p) => p);
  },

  /** Permanently remove a flower and its photo from local storage only. */
  async deleteFlower(id) {
    return runTx(STORE_FLOWERS, 'readwrite', (store) => {
      store.delete(id);
      return true;
    });
  },

  /** Save a generated post image (optional history of exports). */
  async savePost(post) {
    const record = {
      id: uid(),
      flowerId: post.flowerId,
      template: post.template,
      imageBlob: post.imageBlob,
      dateCreated: new Date().toISOString(),
    };
    return runTx(STORE_POSTS, 'readwrite', (store) => {
      store.add(record);
      return record;
    });
  },

  /** Fetch all saved posts, newest first. */
  async getPosts() {
    const db = await openDB();
    const tx = db.transaction(STORE_POSTS, 'readonly');
    const store = tx.objectStore(STORE_POSTS);
    const all = await reqToPromise(store.getAll());
    return all.sort((a, b) => new Date(b.dateCreated) - new Date(a.dateCreated));
  },

  /** Get a settings value by key. */
  async getSetting(key, fallback = null) {
    const db = await openDB();
    const tx = db.transaction(STORE_SETTINGS, 'readonly');
    const store = tx.objectStore(STORE_SETTINGS);
    const result = await reqToPromise(store.get(key));
    return result ? result.value : fallback;
  },

  /** Set a settings value by key. */
  async setSetting(key, value) {
    return runTx(STORE_SETTINGS, 'readwrite', (store) => {
      store.put({ key, value });
      return true;
    });
  },

  /** Rough estimate of storage used/available, when the browser supports it. */
  async storageEstimate() {
    if (navigator.storage && navigator.storage.estimate) {
      try {
        return await navigator.storage.estimate();
      } catch {
        return null;
      }
    }
    return null;
  },
};

window.DB = DB;
