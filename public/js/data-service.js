import { db } from './idb-store.js';

export const DataService = {
    mode: 'LOCAL', // 'LOCAL' or 'HYBRID'
    isAuthenticated: false,
    userId: null,
    isOnline: navigator.onLine,
    apiKey: localStorage.getItem('openai_api_key'),

    init: async () => {
        window.addEventListener('online', () => DataService.updateStatus(true));
        window.addEventListener('offline', () => DataService.updateStatus(false));
        
        try {
            // Quick check if backend exists and is reachable
            const res = await fetch('api.php?endpoint=check_auth');
            if (res.ok) {
                DataService.mode = 'HYBRID';
                const data = await res.json();
                DataService.isAuthenticated = !!data.authenticated;
                DataService.userId = data.user_id || null;
                if (data.authenticated && data.api_key) {
                    DataService.setApiKey(data.api_key); // Sync key from server
                }
            }
        } catch (e) {
            console.log('Backend not detected or offline, switching to LOCAL mode.');
            DataService.mode = 'LOCAL';
            DataService.isAuthenticated = false;
        }
        
        // Load API Key from local settings if we are in local mode
        if (DataService.mode === 'LOCAL') {
            const setting = await db.getSetting('openai_api_key');
            if (setting) DataService.apiKey = setting.value;
        }

        console.log(`DataService initialized in ${DataService.mode} mode.`);
        return DataService.mode;
    },

    updateStatus: (online) => {
        DataService.isOnline = online;
        if (online && DataService.mode === 'HYBRID') {
             DataService.sync();
        }
    },

    setApiKey: async (key) => {
        DataService.apiKey = key;
        localStorage.setItem('openai_api_key', key); // Legacy support
        await db.saveSetting('openai_api_key', key);
    },

    getEntry: async (id) => {
        let entry = await db.getEntry(id);
        
        // If not found locally and we are online in Hybrid mode, try fetching from API
        if (!entry && DataService.mode === 'HYBRID' && DataService.isOnline && DataService.isAuthenticated) {
             try {
                 const res = await fetch(`api.php?endpoint=entries&id=${id}`);
                 if (res.ok) {
                     entry = await res.json();
                     // Cache it locally so next time it's fast
                     // Use savedEntry format? getEntry from DB returns object. API returns object.
                     // The API object has `data` as object (decoded in PHP).
                     // However, we must ensure ID collision safety?
                     // If it wasn't in DB, addEntry is safe.
                     if (entry && entry.id) {
                         // We must ensure the local DB treats this as "synced" since it came from server
                         entry.synced = 1;
                         await db.addEntry(entry);
                     }
                 }
             } catch(e) {
                 console.warn('Failed to fetch entry from API', e);
             }
        }
        return entry;
    },

    getEntries: async (limit = 50) => {
        let entries = [];
        if (DataService.mode === 'HYBRID' && DataService.isOnline && DataService.isAuthenticated) {
            try {
                const res = await fetch(`api.php?endpoint=entries&limit=${limit}`);
                if (!res.ok) throw new Error('API Error');
                entries = await res.json();
            } catch (e) {
                console.warn('Network failed, fetching local cache.');
                entries = await db.getEntries(limit);
            }
        } else {
            entries = await db.getEntries(limit);
        }
        // Filter out drafts
        return entries.filter(e => !e.data || !e.data.is_draft);
    },

    getDrafts: async () => {
        // Fetch recent entries and filter for drafts
        // We check local DB for speed/consistency, assuming sync handles drafts too
        const entries = await db.getEntries(50);
        return entries.filter(e => e.data && e.data.is_draft);
    },

    saveEntry: async (entry) => {
        // Prepare FormData for API or JSON for Local
        // Entry object: { type, recorded_at, data: {...}, id? }
        
        let savedEntry = { ...entry };

        if (DataService.mode === 'HYBRID' && DataService.isOnline && DataService.isAuthenticated) {
            try {
                const formData = new FormData();
                formData.append('type', entry.type);
                formData.append('recorded_at', entry.recorded_at);
                formData.append('data', JSON.stringify(entry.data));
                if (entry.id && !String(entry.id).startsWith('local_')) {
                    formData.append('id', entry.id);
                }
                
                // Handle Image Upload (special case)
                // If entry.data.image_blob exists (from UI), append it
                if (entry.image_blob) {
                    formData.append('image', entry.image_blob);
                }

                const res = await fetch('api.php?endpoint=entry', {
                    method: 'POST',
                    body: formData
                });
                
                if (!res.ok) throw new Error('API Save Failed');
                const result = await res.json();
                savedEntry.id = Number(result.id); // Ensure numeric ID for IDB
                savedEntry.synced = 1;
                
                // If we uploaded an image, the server returns the path. Update it.
                if (result.image_path) {
                    savedEntry.data = savedEntry.data || {};
                    savedEntry.data.image_path = result.image_path;
                }
                
            } catch (e) {
                console.error('Save to API failed, saving locally.', e);
                savedEntry.synced = 0;
            }
        } else {
            savedEntry.synced = 0;
        }

        // Always ensure ID is valid for IDB (cannot be null/false/0 if autoIncrement is needed)
        // If ID is falsy, delete it so IDB generates one.
        if (!savedEntry.id) delete savedEntry.id;

        // Always save/update to local DB
        // If it was an update to an existing server entry, we need to handle ID collision.
        // IDB uses integer IDs. Server uses integer IDs. 
        // Strategy: Use IDB as cache.
        // If we have a server ID, we use it. If IDB has a collision with a DIFFERENT entry, that's bad.
        // Simplification: In LOCAL mode, we just use IDB IDs. 
        // In HYBRID mode, we trust server IDs.
        
        savedEntry.user_id = DataService.userId;
        const localId = await db.addEntry(savedEntry);
        if (!savedEntry.id && localId) savedEntry.id = localId;
        return savedEntry;
    },

    deleteEntry: async (id) => {
        if (DataService.mode === 'HYBRID' && DataService.isOnline && DataService.isAuthenticated) {
            try {
                await fetch('api.php?endpoint=delete', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id })
                });
            } catch (e) {
                console.warn('API delete failed');
            }
        }
        await db.deleteEntry(id);
    },
    
    // AI Proxies
    aiParse: async (text) => {
        return DataService._callAi('ai_parse', { text });
    },
    
    aiVision: async (imageBase64) => {
        return DataService._callAi('ai_vision', { image_base64: imageBase64 });
    },

    aiMagicVoice: async (audioBlob) => {
        if (DataService.mode === 'HYBRID' && DataService.isAuthenticated) {
            const formData = new FormData();
            formData.append('audio_file', audioBlob);
            formData.append('api_key', DataService.apiKey);
            formData.append('client_time', new Date().toISOString().replace('T', ' ').substring(0, 19));

            const res = await fetch('api.php?endpoint=ai_magic_voice', { method: 'POST', body: formData });
            const data = await res.json();
            if (!res.ok || data.error) {
                const msg = typeof data.error === 'string' ? data.error : (data.message || JSON.stringify(data.error));
                throw new Error(msg);
            }
            return data;
        } else {
            // Local fallback: Transcribe then Parse
            const transcribeResult = await DataService.aiTranscribe(audioBlob);
            if (!transcribeResult || !transcribeResult.text) throw new Error('Transcription failed');
            return DataService.aiParse(transcribeResult.text);
        }
    },
    
    aiTranscribe: async (audioBlob) => {
        const formData = new FormData();
        formData.append('audio_file', audioBlob);
        formData.append('api_key', DataService.apiKey);
        
        // If local, we need to call OpenAI directly? 
        // The prompt asked for "pure browser based".
        // Doing OpenAI calls from browser requires exposing the Key.
        // The current app already stores key in localStorage/DB.
        // So yes, we can call OpenAI directly if in LOCAL mode.
        
        if (DataService.mode === 'HYBRID' && DataService.isAuthenticated) {
            const res = await fetch('api.php?endpoint=ai_transcribe', { method: 'POST', body: formData });
            const data = await res.json();
            if (!res.ok || data.error) {
                 const msg = typeof data.error === 'string' ? data.error : (data.message || JSON.stringify(data.error));
                 throw new Error(msg);
            }
            return data;
        } else {
            return DataService._directOpenAICall('audio/transcriptions', formData, true);
        }
    },

    _callAi: async (endpoint, payload) => {
         if (DataService.mode === 'HYBRID' && DataService.isAuthenticated) {
             const body = { ...payload, api_key: DataService.apiKey };
             const res = await fetch(`api.php?endpoint=${endpoint}`, {
                 method: 'POST',
                 headers: { 'Content-Type': 'application/json' },
                 body: JSON.stringify(body)
             });
             const data = await res.json();
             if (data.error) {
                 const msg = typeof data.error === 'string' ? data.error : (data.message || JSON.stringify(data.error));
                 throw new Error(msg);
             }
             return data;
         } else {
             // Direct OpenAI Implementation for Pure Browser Mode
             if (!DataService.apiKey) throw new Error('NO_API_KEY');
             
             let openAiEndpoint = '';
             let openAiBody = {};
             
             if (endpoint === 'ai_parse' || endpoint === 'ai_vision') {
                 openAiEndpoint = 'chat/completions';
                 const messages = [];
                 const sysPrompt = `You are a health tracking assistant. Date: ${new Date().toLocaleString()}. Return JSON array of objects (types: food, drink, stool, sleep, symptom, activity).
                 
                 Activity schema: { "type": "activity", "recorded_at": "YYYY-MM-DD HH:MM:SS", "data": { "duration_minutes": int, "intensity": "Low" | "Medium" | "High", "notes": "description" } }`;
                 
                 messages.push({ role: 'system', content: sysPrompt });
                 
                 if (endpoint === 'ai_vision') {
                     messages.push({ role: 'user', content: [
                         { type: 'text', text: 'Analyze image for health tracking.' },
                         { type: 'image_url', image_url: { url: payload.image_base64 } }
                     ]});
                 } else {
                     messages.push({ role: 'user', content: payload.text });
                 }
                 
                 openAiBody = {
                     model: 'gpt-4o-mini',
                     messages: messages,
                     temperature: 0
                 };
             }
             
             return DataService._directOpenAICall(openAiEndpoint, openAiBody);
         }
    },

    _directOpenAICall: async (endpoint, body, isFormData = false) => {
        const headers = { 'Authorization': `Bearer ${DataService.apiKey}` };
        if (!isFormData) headers['Content-Type'] = 'application/json';
        
        const res = await fetch(`https://api.openai.com/v1/${endpoint}`, {
            method: 'POST',
            headers: headers,
            body: isFormData ? body : JSON.stringify(body)
        });
        
        const data = await res.json();
        if (data.error) throw new Error(data.error.message);
        
        // Normalize response to match our backend's format
        if (data.choices) {
            const content = data.choices[0].message.content.replace(/```json|```/g, '');
            return JSON.parse(content);
        }
        return data;
    },

    sync: async () => {
        // Placeholder for sync logic
        console.log('Syncing...');
    },

    getPendingUploads: async () => {
        const entries = await db.getUnsyncedEntries();
        // Return entries that are not synced. 
        // If we want to strictly check "not in account", that's what synced=0 means locally.
        // We might want to filter out entries that supposedly belong to another user if such logic existed,
        // but for now, any unsynced entry is fair game to be asked about.
        return entries;
    },

    uploadEntries: async (entries) => {
        if (!DataService.mode === 'HYBRID' || !DataService.isAuthenticated) return;
        
        let count = 0;
        for (const entry of entries) {
            try {
                // Ensure entry has correct user_id before upload
                entry.user_id = DataService.userId;
                
                // Reuse saveEntry logic which handles API upload
                // We force ID to be undefined for the API call if it's a local-only ID so API generates a new one?
                // Or does saveEntry handle it?
                // saveEntry logic: if (entry.id && !String(entry.id).startsWith('local_')) formData.append('id', entry.id);
                // IDB ids are numbers. API ids are numbers.
                // If we upload a local entry (id: 1) to server, server might give it ID: 100.
                // saveEntry updates the local DB with the new ID and synced=1.
                
                // However, saveEntry expects an object.
                // If we pass the entry object from IDB, it has an ID.
                // If that ID is just a local auto-increment, we shouldn't send it to server as 'id', 
                // OR we should let server decide.
                // The current saveEntry logic sends ID if it doesn't start with 'local_'.
                // But local IDB auto-increment IDs are integers like 1, 2, 3.
                // If we send ID=1 to server, server might try to update entry #1.
                // WE MUST NOT SEND ID TO SERVER for new uploads of local data.
                
                // Let's create a copy without ID for the API call, effectively creating a new entry on server.
                // But saveEntry function logic is mixed (API + Local).
                // Let's look at saveEntry again.
                
                /*
                if (entry.id && !String(entry.id).startsWith('local_')) {
                    formData.append('id', entry.id);
                }
                */
               
                // This logic seems risky for numeric local IDs.
                // If we want to sync local -> server, we should treat them as NEW entries on server.
                // So we should temporarily strip ID before calling saveEntry, OR modify saveEntry to handle this.
                // Modifying saveEntry is better but risky for regression.
                // Let's just manually handle the upload loop here or call saveEntry carefully.
                
                // If we treat them as "new", we strip ID.
                const entryToSave = { ...entry };
                delete entryToSave.id; // Treat as new for server
                delete entryToSave.synced; 
                
                // preserve the recorded_at and data!
                
                await DataService.saveEntry(entryToSave);
                
                // After successful save, saveEntry will have added a NEW entry to IDB with synced=1.
                // We should delete the OLD local entry to avoid duplicates?
                // saveEntry returns the saved entry.
                // If we use saveEntry, it adds to DB.
                // So we get a duplicate in DB (Old local one, New synced one).
                // We must delete the old one.
                
                await db.deleteEntry(entry.id);
                count++;
            } catch (e) {
                console.error("Failed to sync entry", entry, e);
            }
        }
        return count;
    }
};
