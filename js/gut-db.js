import { db as LocalDB } from './idb-store.js';
import { RemoteDB } from './remote-db.js';

export const GutDB = {
    mode: 'LOCAL', // 'LOCAL' or 'HYBRID'
    isAuthenticated: false,
    isOnline: navigator.onLine,

    userId: null,

    init: async (mode = 'LOCAL', authenticated = false, userId = null) => {
        GutDB.mode = mode;
        GutDB.isAuthenticated = authenticated;
        GutDB.userId = userId;
        
        if (!window._gutDbListenersAdded) {
            window.addEventListener('online', () => GutDB.isOnline = true);
            window.addEventListener('offline', () => GutDB.isOnline = false);
            window._gutDbListenersAdded = true;
        }
        
        await LocalDB.open();
        console.log(`GutDB initialized in ${mode} mode. Authenticated: ${authenticated}, UserID: ${userId}`);
    },

    setAuth: (authenticated, userId = null) => {
        GutDB.isAuthenticated = authenticated;
        GutDB.userId = userId;
        GutDB.mode = authenticated ? 'HYBRID' : 'LOCAL';
    },

    get canSync() {
        return GutDB.mode === 'HYBRID' && GutDB.isAuthenticated && GutDB.isOnline;
    },

    getEntries: async (limit = 50) => {
        let entries = [];
        
        if (GutDB.canSync) {
            try {
                // 1. Fetch Remote
                const apiEntries = await RemoteDB.getEntries(limit);
                
                // 2. Fetch Local Unsynced (Dirty)
                const unsynced = await LocalDB.getUnsyncedEntries(GutDB.userId);
                
                // 3. Merge
                const entryMap = new Map();
                
                if (Array.isArray(apiEntries)) {
                    apiEntries.forEach(e => {
                        e.synced = 1;
                        if (e.id) e.id = Number(e.id);
                        if (GutDB.userId) e.user_id = GutDB.userId;
                        entryMap.set(e.id, e);
                        // Update Local Cache silently, but don't overwrite unsynced local entries
                        LocalDB.getEntry(e.id)
                            .then(localEntry => {
                                if (!localEntry || localEntry.synced === 1) {
                                    return LocalDB.addEntry(e);
                                }
                                return null;
                            })
                            .catch(err => console.warn('Cache update failed', err));
                    });
                }
                
                // Overlay Unsynced
                if (Array.isArray(unsynced)) {
                    unsynced.forEach(e => {
                        if (e.id) entryMap.set(e.id, e);
                    });
                }
                
                entries = Array.from(entryMap.values());

                if (entries.length === 0) {
                    const localEntries = await LocalDB.getEntries(limit, GutDB.userId);
                    entries = localEntries;
                }

            } catch (e) {
                console.warn('GutDB: Remote fetch failed, falling back to local.', e);
                entries = await LocalDB.getEntries(limit, GutDB.userId);
            }
        } else {
            entries = await LocalDB.getEntries(limit, GutDB.userId);
        }

        // Sort by event_at DESC
        return entries.sort((a, b) => {
            if (!a.event_at || !b.event_at) return 0;
            const dateA = new Date(a.event_at.replace(' ', 'T'));
            const dateB = new Date(b.event_at.replace(' ', 'T'));
            if (isNaN(dateA) || isNaN(dateB)) return 0;
            return dateB - dateA;
        });
    },

    getEntry: async (id) => {
        let entry = await LocalDB.getEntry(id);
        
        if (!entry && GutDB.canSync) {
            try {
                const remoteEntry = await RemoteDB.getEntry(id);
                if (remoteEntry) {
                    remoteEntry.synced = 1;
                    await LocalDB.addEntry(remoteEntry);
                    entry = remoteEntry;
                }
            } catch (e) {
                console.warn('GutDB: Remote get failed', e);
            }
        }
        return entry;
    },

    saveEntry: async (entry) => {
        const entryToSave = { ...entry };
        const wasLocalOnly = !!entryToSave.local_only;
        const isNewLocal = !entryToSave.id;
        
        // Only sync if we have an authenticated session AND the entry belongs to that user.
        // Anonymous entries (userId 0 or null) must stay local.
        const canSyncEntry = GutDB.canSync && entryToSave.user_id && entryToSave.user_id != 0;

        if (canSyncEntry) {
            try {
                const result = await RemoteDB.saveEntry(entryToSave);
                // Update with Server ID and cleaned data
                entryToSave.id = Number(result.id);
                entryToSave.synced = 1;
                entryToSave.local_only = false;
                if (result.image_path && entryToSave.data) {
                    entryToSave.data.image_path = result.image_path;
                }
            } catch (e) {
                console.error('GutDB: API Save failed, saving locally as unsynced.', e);
                entryToSave.synced = 0;
                if (isNewLocal || wasLocalOnly) {
                    entryToSave.local_only = true;
                }
            }
        } else {
            entryToSave.synced = 0;
            if (isNewLocal || wasLocalOnly) {
                entryToSave.local_only = true;
            }
        }

        // Always save to Local DB
        const localId = await LocalDB.addEntry(entryToSave);
        if (!entryToSave.id && localId) entryToSave.id = localId;
        
        return entryToSave;
    },

    deleteEntry: async (id) => {
        if (GutDB.canSync) {
            try {
                await RemoteDB.deleteEntry(id);
            } catch (e) {
                console.warn('GutDB: Remote delete failed', e);
                // Mark for deletion later? 
                // For now, we just delete locally. 
                // Ideally we should have a 'deleted' flag for sync.
            }
        }
        await LocalDB.deleteEntry(id);
    },

    deleteLocalEntry: async (id) => {
        await LocalDB.deleteEntry(id);
    },

    deleteAll: async () => {
        if (GutDB.canSync) {
            await RemoteDB.deleteAll();
        }
        await LocalDB.clearAll();
    },
    
    getDrafts: async () => {
        // Drafts are always local
        const entries = await LocalDB.getEntries(50, GutDB.userId);
        return entries.filter(e => e.data && e.data.is_draft);
    },
    
    // Pass-through for simple local ops
    getUser: (id) => LocalDB.getUser(id),
    saveUser: (user) => LocalDB.saveUser(user),
    getUnsynced: (userId = GutDB.userId) => LocalDB.getUnsyncedEntries(userId),
};