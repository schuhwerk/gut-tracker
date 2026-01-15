const DB_NAME = 'GutTrackerDB';
const DB_VERSION = 2;

export const db = {
    open: () => {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                let store;
                if (!db.objectStoreNames.contains('entries')) {
                    store = db.createObjectStore('entries', { keyPath: 'id', autoIncrement: true });
                    store.createIndex('type', 'type', { unique: false });
                    store.createIndex('recorded_at', 'recorded_at', { unique: false });
                    store.createIndex('synced', 'synced', { unique: false }); // 0 = no, 1 = yes
                    store.createIndex('user_id', 'user_id', { unique: false });
                } else {
                    store = request.transaction.objectStore('entries');
                    if (!store.indexNames.contains('user_id')) {
                        store.createIndex('user_id', 'user_id', { unique: false });
                    }
                }
                
                if (!db.objectStoreNames.contains('settings')) {
                    db.createObjectStore('settings', { keyPath: 'key' });
                }
            };

            request.onsuccess = (event) => resolve(event.target.result);
            request.onerror = (event) => reject(event.target.error);
        });
    },

    // Generic transaction helper
    tx: async (storeName, mode, callback) => {
        const dbInstance = await db.open();
        return new Promise((resolve, reject) => {
            const transaction = dbInstance.transaction(storeName, mode);
            const store = transaction.objectStore(storeName);
            const request = callback(store);

            transaction.oncomplete = () => resolve(request.result);
            transaction.onerror = () => reject(transaction.error);
        });
    },

    addEntry: async (entry) => {
        return db.tx('entries', 'readwrite', (store) => {
            // Ensure data is stored appropriately (serialized or object)
            // Backend expects 'data' as JSON string, but IDB can store objects.
            // We will store as object to be cleaner locally, but convert when syncing.
            if (typeof entry.data === 'string') {
                try { entry.data = JSON.parse(entry.data); } catch(e){}
            }
            entry.synced = 0;
            // Only set created_at for new entries
            if (!entry.created_at && !entry.id) {
                entry.created_at = new Date().toISOString();
            }
            return store.put(entry); // Use put for upsert support
        });
    },

    updateEntry: async (entry) => {
        return db.tx('entries', 'readwrite', (store) => {
            entry.synced = 0; // Mark as dirty on update
            return store.put(entry);
        });
    },

    deleteEntry: async (id) => {
        return db.tx('entries', 'readwrite', (store) => store.delete(Number(id)));
    },

    getEntry: async (id) => {
        return db.tx('entries', 'readonly', (store) => store.get(Number(id)));
    },

    getEntries: async (limit = 50) => {
        const dbInstance = await db.open();
        return new Promise((resolve, reject) => {
            const transaction = dbInstance.transaction('entries', 'readonly');
            const store = transaction.objectStore('entries');
            const index = store.index('recorded_at');
            const request = index.openCursor(null, 'prev'); // Descending order
            const results = [];

            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor && results.length < limit) {
                    results.push(cursor.value);
                    cursor.continue();
                } else {
                    resolve(results);
                }
            };
            request.onerror = () => reject(request.error);
        });
    },
    
    getAllEntries: async () => {
         return db.tx('entries', 'readonly', store => store.getAll());
    },

    getUnsyncedEntries: async () => {
        const dbInstance = await db.open();
        return new Promise((resolve, reject) => {
            const transaction = dbInstance.transaction('entries', 'readonly');
            const store = transaction.objectStore('entries');
            const index = store.index('synced');
            const request = index.getAll(0); // 0 = not synced
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    },

    saveSetting: async (key, value) => {
        return db.tx('settings', 'readwrite', store => store.put({ key, value }));
    },

    getSetting: async (key) => {
        const dbInstance = await db.open();
        return new Promise((resolve, reject) => {
            const transaction = dbInstance.transaction('settings', 'readonly');
            const store = transaction.objectStore('settings');
            const request = store.get(key);
            request.onsuccess = () => resolve(request.result ? request.result.value : null);
            request.onerror = () => reject(request.error);
        });
    },
    
    clearAll: async () => {
        return db.tx('entries', 'readwrite', store => store.clear());
    }
};
