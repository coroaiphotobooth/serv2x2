
/**
 * INDEXED DB STORAGE UTILITY
 * Menggantikan LocalStorage untuk data besar (seperti Base64 Images di Concepts).
 * LocalStorage limit hanya 5MB, IndexedDB bisa sampai ratusan MB/GB.
 */

const DB_NAME = 'CoroAI_Photobooth_DB';
const STORE_NAME = 'app_data';
const DB_VERSION = 1;

// Helper: Open Database Connection
const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error("Browser does not support IndexedDB"));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

/**
 * Menyimpan data ke IndexedDB (Async)
 * @param key Key identifier (misal: 'pb_concepts')
 * @param data Data object/array
 */
export const saveLargeData = async (key: string, data: any) => {
  try {
    const db = await openDB();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(data, key);
      
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
      
      // Close DB connection after transaction finishes
      tx.oncomplete = () => db.close();
    });
  } catch (error) {
    console.error(`[IndexedDB] Save Failed for ${key}:`, error);
  }
};

/**
 * Mengambil data dari IndexedDB (Async)
 * @param key Key identifier
 */
export const getLargeData = async (key: string): Promise<any> => {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(key);
      
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);

      tx.oncomplete = () => db.close();
    });
  } catch (error) {
    console.error(`[IndexedDB] Load Failed for ${key}:`, error);
    return null;
  }
};

/**
 * Menghapus data dari IndexedDB
 */
export const removeLargeData = async (key: string) => {
    try {
        const db = await openDB();
        return new Promise<void>((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            const req = store.delete(key);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
            tx.oncomplete = () => db.close();
        });
    } catch (error) {
        console.error(`[IndexedDB] Delete Failed for ${key}:`, error);
    }
}
