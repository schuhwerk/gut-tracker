const DB_NAME = 'GutTrackerDB';
const DB_VERSION = 5;

// Schema definitions to ensure local IDB matches Server DB structure
const SCHEMAS = {
    users: {
        id: null,
        username: '',
        password_hash: '', // Added for server similarity
        api_key: null,
        debug_mode: 0,
        ai_config: null
        // created_at is automatic on server, handled locally if needed
    },
    entries: {
        id: null,
        user_id: null,
        type: '',
        event_at: '',
        data: null, // Server uses TEXT (JSON), we keep object locally but sync converts
        created_at: ''
    }
};

const enforceSchema = (data, schemaName) => {
    const schema = SCHEMAS[schemaName];
    if (!schema) return data;
    
    const result = { ...data };
    
    // Ensure all schema keys exist with defaults if missing
    for (const key in schema) {
        if (result[key] === undefined) {
             // Don't overwrite id if it's null in schema but we want auto-increment
             if (key === 'id' && schema.id === null) continue;
             result[key] = schema[key];
        }
    }
    return result;
};

export const db = {
    open: () => {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = (event) => {
                const dbInstance = event.target.result;
                const oldVersion = event.oldVersion;
                let store;

                if (!dbInstance.objectStoreNames.contains('entries')) {
                    store = dbInstance.createObjectStore('entries', { keyPath: 'id', autoIncrement: true });
                    store.createIndex('type', 'type', { unique: false });
                    store.createIndex('event_at', 'event_at', { unique: false });
                    store.createIndex('synced', 'synced', { unique: false });
                    store.createIndex('user_id', 'user_id', { unique: false });
                } else {
                    store = request.transaction.objectStore('entries');
                    if (!store.indexNames.contains('user_id')) {
                        store.createIndex('user_id', 'user_id', { unique: false });
                    }
                    if (oldVersion < 4) {
                         if (store.indexNames.contains('recorded_at')) {
                             store.deleteIndex('recorded_at');
                         }
                         if (!store.indexNames.contains('event_at')) {
                             store.createIndex('event_at', 'event_at', { unique: false });
                         }
                    }
                }

                if (!dbInstance.objectStoreNames.contains('users')) {
                    dbInstance.createObjectStore('users', { keyPath: 'id' });
                }

                // Migration to Rename recorded_at -> event_at
                if (oldVersion < 4) {
                    const transaction = request.transaction;
                    const entriesStore = transaction.objectStore('entries');
                    entriesStore.openCursor().onsuccess = (e) => {
                        const cursor = e.target.result;
                        if (cursor) {
                            const entry = cursor.value;
                            if (entry.recorded_at) {
                                entry.event_at = entry.recorded_at;
                                delete entry.recorded_at;
                                cursor.update(entry);
                            }
                            cursor.continue();
                        }
                    };
                }

                // Migration for version 3: Standardize date formats
                if (oldVersion < 3) {
                    const transaction = request.transaction;
                    const entriesStore = transaction.objectStore('entries');
                    entriesStore.openCursor().onsuccess = (e) => {
                        const cursor = e.target.result;
                        if (cursor) {
                            const entry = cursor.value;
                            let changed = false;

                            // Fix created_at
                            if (entry.created_at && entry.created_at.includes('T') && entry.created_at.includes('Z')) {
                                entry.created_at = entry.created_at.replace('T', ' ').substring(0, 19);
                                changed = true;
                            }
                            // Fix event_at
                            if (entry.event_at && entry.event_at.includes('T')) {
                                entry.event_at = entry.event_at.replace('T', ' ');
                                if (entry.event_at.length === 16) entry.event_at += ':00';
                                changed = true;
                            }

                            if (changed) {
                                cursor.update(entry);
                            }
                            cursor.continue();
                        }
                    };
                }
                
                if (!dbInstance.objectStoreNames.contains('settings')) {
                    dbInstance.createObjectStore('settings', { keyPath: 'key' });
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
            
            // Enforce Schema
            entry = enforceSchema(entry, 'entries');

            if (!entry.id) delete entry.id;

            if (entry.synced === undefined) {
                entry.synced = 0;
            }
            // Only set created_at for new entries
            if (!entry.created_at && !entry.id) {
                entry.created_at = new Date().toISOString().replace('T', ' ').substring(0, 19);
            }
            return store.put(entry); // Use put for upsert support
        });
    },

    updateEntry: async (entry) => {
        return db.tx('entries', 'readwrite', (store) => {
            entry = enforceSchema(entry, 'entries');
            if (entry.synced === undefined) entry.synced = 0; // Mark as dirty on update only if not specified
            return store.put(entry);
        });
    },

    deleteEntry: async (id) => {
        return db.tx('entries', 'readwrite', (store) => store.delete(Number(id)));
    },

    getEntry: async (id) => {
        return db.tx('entries', 'readonly', (store) => store.get(Number(id)));
    },

    getEntries: async (limit = 50, userId = null) => {
        const dbInstance = await db.open();
        return new Promise((resolve, reject) => {
            const transaction = dbInstance.transaction('entries', 'readonly');
            const store = transaction.objectStore('entries');
            const index = store.index('event_at');
            const request = index.openCursor(null, 'prev'); // Descending order
            const results = [];

            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor && results.length < limit) {
                    const entry = cursor.value;
                    const entryUserId = entry.user_id || 0;
                    const targetUserId = userId === null ? null : (userId || 0);
                    
                    if (targetUserId === null || entryUserId == targetUserId) {
                        results.push(entry);
                    }
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

    getUnsyncedEntries: async (userId = null) => {
        const dbInstance = await db.open();
        return new Promise((resolve, reject) => {
            const transaction = dbInstance.transaction('entries', 'readonly');
            const store = transaction.objectStore('entries');
            const index = store.index('synced');
            // Using a cursor to allow filtering by userId easily
            const request = index.openCursor(IDBKeyRange.only(0)); // 0 = not synced
            const results = [];

            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    const entry = cursor.value;
                    const entryUserId = entry.user_id || 0;
                    const targetUserId = userId === null ? null : (userId || 0);
                    
                    if (targetUserId === null || entryUserId == targetUserId) {
                        results.push(entry);
                    }
                    cursor.continue();
                } else {
                    resolve(results);
                }
            };
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

    saveUser: async (user) => {
        // Enforce Schema
        user = enforceSchema(user, 'users');
        return db.tx('users', 'readwrite', store => store.put(user));
    },

    saveEntries: async (entries) => {
        return db.tx('entries', 'readwrite', (store) => {
            entries.forEach(entry => {
                if (typeof entry.data === 'string') {
                    try { entry.data = JSON.parse(entry.data); } catch(e){}
                }
                entry = enforceSchema(entry, 'entries');
                entry.synced = 1; 
                store.put(entry);
            });
        });
    },

    getUser: async (id) => {
        const dbInstance = await db.open();
        return new Promise((resolve, reject) => {
            const transaction = dbInstance.transaction('users', 'readonly');
            const store = transaction.objectStore('users');
            const request = store.get(id);
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error);
        });
    },
    
    clearAll: async () => {
        const dbInstance = await db.open();
        const stores = ['entries', 'settings', 'users'];
        const transaction = dbInstance.transaction(stores, 'readwrite');
        stores.forEach(s => {
            if (dbInstance.objectStoreNames.contains(s)) {
                transaction.objectStore(s).clear();
            }
        });
        return new Promise((resolve, reject) => {
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
        });
    }
};
