import { db } from './idb-store.js';

export const DataService = {
    mode: 'LOCAL', // 'LOCAL' or 'HYBRID'
    isAuthenticated: false,
    userId: null,
    isOnline: navigator.onLine,
    // aiConfig object: { provider, api_key, base_url, model }
    aiConfig: null, 
    debugMode: false,

    // Legacy getter for backward compatibility
    get apiKey() {
        return DataService.aiConfig ? (DataService.aiConfig.api_key || DataService.aiConfig) : null;
    },

    set apiKey(val) {
        // If setting raw string, assume legacy format (OpenAI default)
        if (typeof val === 'string') {
             DataService.aiConfig = { provider: 'openai', api_key: val };
        } else {
             DataService.aiConfig = val;
        }
    },

    init: async () => {
        window.addEventListener('online', () => DataService.updateStatus(true));
        window.addEventListener('offline', () => DataService.updateStatus(false));
        
        try {
            const res = await fetch('api.php?endpoint=check_auth');
            if (res.ok) {
                DataService.mode = 'HYBRID';
                const data = await res.json();
                DataService.isAuthenticated = !!data.authenticated;
                DataService.userId = data.user_id || null;
                if (data.authenticated) {
                    // Prefer ai_config, fallback to api_key
                    if (data.ai_config) DataService.aiConfig = data.ai_config;
                    else if (data.api_key) DataService.aiConfig = { provider: 'openai', api_key: data.api_key };
                    
                    DataService.debugMode = !!data.debug_mode;

                    // Cache user info locally
                    await db.saveUser({
                        id: DataService.userId,
                        username: data.username || 'user',
                        ai_config: DataService.aiConfig,
                        debug_mode: DataService.debugMode ? 1 : 0,
                        api_key: DataService.aiConfig ? DataService.aiConfig.api_key : null
                    });
                }
            }
        } catch (e) {
            console.log('Backend not detected or offline, switching to LOCAL mode.');
            DataService.mode = 'LOCAL';
            DataService.isAuthenticated = false;
        }
        
        if (!DataService.isAuthenticated) {
            const localUser = await DataService._ensureLocalUser();
            DataService.userId = localUser.id;
            DataService.aiConfig = localUser.ai_config;
            DataService.debugMode = !!localUser.debug_mode;
        }

        console.log(`DataService initialized in ${DataService.mode} mode. User ID: ${DataService.userId}`);
        return DataService.mode;
    },

    _ensureLocalUser: async () => {
        let localUser = await db.getUser(0);
        if (!localUser) {
            // Migration logic
            // Check for old 'local' user
            const oldLocalUser = await db.getUser('local');
            if (oldLocalUser) {
                // Migrate from 'local' to 0
                localUser = { ...oldLocalUser, id: 0 };
                // We should also probably delete the old one, but keep it safe for now? 
                // Let's just create the new one.
            } else {
                let aiConfig = null;
                const legacyKey = await db.getSetting('openai_api_key');
                if (legacyKey) aiConfig = { provider: 'openai', api_key: legacyKey };
    
                localUser = {
                    id: 0,
                    username: 'anonymous',
                    password_hash: null, // "anon" user with no password
                    ai_config: aiConfig,
                    debug_mode: 0,
                    api_key: aiConfig ? aiConfig.api_key : null
                };
            }
            await db.saveUser(localUser);
        }
        return localUser;
    },

    updateStatus: (online) => {
        DataService.isOnline = online;
        if (online && DataService.mode === 'HYBRID') {
             DataService.sync();
        }
    },

    saveSettings: async (config, debugMode) => {
        // config is expected to be an object now { provider, api_key, base_url, model }
        DataService.aiConfig = config;
        DataService.debugMode = debugMode;
        
        // Save to local user record
        const userId = DataService.userId || 0;
        const user = await db.getUser(userId) || { id: userId, username: userId === 0 ? 'anonymous' : 'user' };
        user.ai_config = config;
        user.debug_mode = debugMode ? 1 : 0;
        user.api_key = config.api_key;
        await db.saveUser(user);

        // Also save legacy key for safety if some parts still read it directly from storage
        if (config.api_key) localStorage.setItem('openai_api_key', config.api_key);

        if (DataService.mode === 'HYBRID' && DataService.isAuthenticated) {
            await fetch('api.php?endpoint=update_settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    api_key: config.api_key, 
                    ai_config: config,
                    debug_mode: debugMode ? 1 : 0 
                })
            });
        }
    },

    testApiKey: async (config) => {
        const backupConfig = DataService.aiConfig;
        try {
            DataService.aiConfig = config;
            if (DataService.mode === 'HYBRID' && DataService.isAuthenticated) {
                const res = await fetch('api.php?endpoint=test_api_key', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ai_config: config, api_key: config.api_key })
                });
                
                let data;
                try {
                    data = await res.json();
                } catch (e) {
                    const text = await res.text();
                    throw new Error(`Server returned non-JSON response: ${text.substring(0, 100)}`);
                }

                if (!res.ok || data.error) throw new Error(data.message || data.error || 'Verification failed');
                return true;
            } else {
                // Local mode: direct call
                await DataService._directOpenAICall('chat/completions', {
                    model: config.model || 'gpt-4o-mini',
                    messages: [{ role: 'user', content: 'ping' }],
                    max_tokens: 1
                });
                return true;
            }
        } finally {
            DataService.aiConfig = backupConfig;
        }
    },

    getEntry: async (id) => {
        let entry = await db.getEntry(id);
        if (!entry && DataService.mode === 'HYBRID' && DataService.isOnline && DataService.isAuthenticated) {
             try {
                 const res = await fetch(`api.php?endpoint=entries&id=${id}`);
                 if (res.ok) {
                     entry = await res.json();
                     if (entry && entry.id) {
                         entry.synced = 1;
                         await db.addEntry(entry);
                     }
                 }
             } catch(e) { console.warn('Failed to fetch entry from API', e); }
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
                entries = await db.getEntries(limit);
            }
        } else {
            entries = await db.getEntries(limit);
        }
        return entries.filter(e => !e.data || !e.data.is_draft);
    },

    getDrafts: async () => {
        const entries = await db.getEntries(50);
        return entries.filter(e => e.data && e.data.is_draft);
    },

    getCurrentUser: async () => {
        return await db.getUser(DataService.userId);
    },

    saveEntry: async (entry) => {
        let savedEntry = { ...entry };

        if (DataService.mode === 'HYBRID' && DataService.isOnline && DataService.isAuthenticated) {
            try {
                const formData = new FormData();
                formData.append('type', entry.type);
                formData.append('event_at', entry.event_at);
                formData.append('data', JSON.stringify(entry.data));
                if (entry.id && !String(entry.id).startsWith('local_')) {
                    formData.append('id', entry.id);
                }
                
                if (entry.image_blob) {
                    formData.append('image', entry.image_blob);
                }

                const res = await fetch('api.php?endpoint=entry', {
                    method: 'POST',
                    body: formData
                });
                
                if (!res.ok) throw new Error('API Save Failed');
                const result = await res.json();
                savedEntry.id = Number(result.id); 
                savedEntry.synced = 1;
                
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

        if (!savedEntry.id) delete savedEntry.id;

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
            } catch (e) { console.warn('API delete failed'); }
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
            // Pass legacy key in case server expects it, but server will look up config from DB mostly
            // However, our api.php logic prefers `getAiConfig` from DB.
            formData.append('api_key', DataService.apiKey); 
            formData.append('client_time', new Date().toISOString().replace('T', ' ').substring(0, 19));
            formData.append('client_timezone_offset', new Date().getTimezoneOffset());

            const res = await fetch('api.php?endpoint=ai_magic_voice', { method: 'POST', body: formData });
            const data = await res.json();
            if (!res.ok || data.error) {
                const msg = typeof data.error === 'string' ? data.error : (data.message || JSON.stringify(data.error));
                throw new Error(msg);
            }
            return data;
        } else {
            const transcribeResult = await DataService.aiTranscribe(audioBlob);
            if (!transcribeResult || !transcribeResult.text) throw new Error('Transcription failed');
            return DataService.aiParse(transcribeResult.text);
        }
    },
    
    aiTranscribe: async (audioBlob) => {
        const formData = new FormData();
        formData.append('audio_file', audioBlob);
        formData.append('api_key', DataService.apiKey);
        
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
         const enrichedPayload = { 
             ...payload, 
             client_time: new Date().toISOString().replace('T', ' ').substring(0, 19),
             client_timezone_offset: new Date().getTimezoneOffset()
         };

         if (DataService.mode === 'HYBRID' && DataService.isAuthenticated) {
             const body = { ...enrichedPayload, api_key: DataService.apiKey };
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
             // Direct Implementation for Pure Browser Mode
             if (!DataService.apiKey) throw new Error('NO_API_KEY');
             
             let openAiEndpoint = '';
             let openAiBody = {};
             
             if (endpoint === 'ai_parse' || endpoint === 'ai_vision') {
                 openAiEndpoint = 'chat/completions';
                 const messages = [];
                 const sysPrompt = `You are a health tracking assistant. 
                 Current UTC time: ${enrichedPayload.client_time}. 
                 User Timezone Offset (minutes): ${enrichedPayload.client_timezone_offset}.
                 CRITICAL: All returned dates/times MUST be in UTC.
                 Analyze the user's input and extract data into a JSON ARRAY of objects.`;
                 
                 messages.push({ role: 'system', content: sysPrompt });
                 
                 if (endpoint === 'ai_vision') {
                     messages.push({ role: 'user', content: [
                         { type: 'text', text: 'Analyze image for health tracking.' },
                         { type: 'image_url', image_url: { url: payload.image_base64 } }
                     ]});
                 } else {
                     messages.push({ role: 'user', content: payload.text });
                 }
                 
                 // Determine Model
                 let model = 'gpt-4o-mini';
                 if (DataService.aiConfig && DataService.aiConfig.model) {
                     model = DataService.aiConfig.model;
                 }

                 openAiBody = {
                     model: model,
                     messages: messages,
                     temperature: 0
                 };
             }
             
             return DataService._directOpenAICall(openAiEndpoint, openAiBody);
         }
    },

    _directOpenAICall: async (endpoint, body, isFormData = false) => {
        let baseUrl = 'https://api.openai.com/v1/';
        if (DataService.aiConfig && DataService.aiConfig.base_url) {
            baseUrl = DataService.aiConfig.base_url;
            if (!baseUrl.endsWith('/')) baseUrl += '/';
        }

        const headers = { 'Authorization': `Bearer ${DataService.apiKey}` };
        if (!isFormData) headers['Content-Type'] = 'application/json';
        
        const res = await fetch(`${baseUrl}${endpoint}`, {
            method: 'POST',
            headers: headers,
            body: isFormData ? body : JSON.stringify(body)
        });
        
        let data;
        try {
            data = await res.json();
        } catch (e) {
            const text = await res.text();
            throw new Error(`API returned non-JSON response: ${text.substring(0, 100)}`);
        }

        if (data.error) throw new Error(data.error.message || data.error);
        
        if (data.choices) {
            const content = data.choices[0].message.content.replace(/```json|```/g, '');
            try {
                return JSON.parse(content);
            } catch (e) {
                return content;
            }
        }
        return data;
    },

    getLogs: async () => {
        if (DataService.mode === 'HYBRID' && DataService.isAuthenticated) {
            const res = await fetch('api.php?endpoint=get_logs');
            if (!res.ok) throw new Error('Failed to fetch logs');
            return await res.json();
        }
        return { logs: [] };
    },

    sync: async () => { console.log('Syncing...'); },

    getPendingUploads: async () => { return await db.getUnsyncedEntries(); },

    uploadEntries: async (entries) => {
        if (!DataService.mode === 'HYBRID' || !DataService.isAuthenticated) return;
        let count = 0;
        for (const entry of entries) {
            try {
                const entryToSave = { ...entry };
                delete entryToSave.id; 
                delete entryToSave.synced; 
                await DataService.saveEntry(entryToSave);
                await db.deleteEntry(entry.id);
                count++;
            } catch (e) { console.error("Failed to sync entry", entry, e); }
        }
        return count;
    }
};
