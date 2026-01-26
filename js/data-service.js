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

    get canUseAi() {
        return !!DataService.apiKey || (DataService.mode === 'HYBRID' && DataService.isAuthenticated);
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
                const apiEntries = await res.json();

                // Merge with local unsynced entries to ensure "pending" items are visible
                const unsynced = await db.getUnsyncedEntries();
                
                // Create a Map for easy merging by ID
                const entryMap = new Map();
                apiEntries.forEach(e => entryMap.set(e.id, e));
                
                // Overlay unsynced (dirty) entries
                unsynced.forEach(e => {
                    entryMap.set(e.id, e);
                });
                
                entries = Array.from(entryMap.values());
                
                // Re-sort by event_at DESC
                entries.sort((a, b) => {
                    const dateA = new Date(a.event_at.replace(' ', 'T'));
                    const dateB = new Date(b.event_at.replace(' ', 'T'));
                    return dateB - dateA;
                });
                
            } catch (e) {
                console.warn('API fetch failed, falling back to local DB', e);
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
        const payload = {
            text: text,
            client_time: new Date().toISOString().replace('T', ' ').substring(0, 19),
            client_timezone_offset: new Date().getTimezoneOffset()
        };
        
        // 1. Calculate Local Time Reference
        const localTimeRef = DataService._getLocalReferenceTime(payload.client_timezone_offset);
        
        // 2. Build System Prompt
        const systemPrompt = DataService._getMagicSystemPrompt(localTimeRef);
        
        // 3. Call AI
        const response = await DataService._callAi({
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: text }
            ],
            response_format: { type: "json_object" }
        });

        // 4. Parse & Process (Timezone conversion)
        let content = response.choices ? response.choices[0].message.content : (response.content || '{}');
        
        // Clean Markdown (just in case)
        content = content.replace(/```json\n?|```/g, '').trim();

        let items = [];
        try {
            const parsed = JSON.parse(content);
            items = parsed.items || parsed || [];
            if (!Array.isArray(items)) items = [items];
        } catch (e) {
            console.error("JSON Parse Error", e);
            throw new Error("Failed to parse AI response: " + e.message);
        }
        
        if (items.length === 0) {
            throw new Error("AI returned no valid items.");
        }
        
        return DataService._processAiResponse(items, payload.client_timezone_offset);
    },
    
    aiVision: async (imageBase64) => {
        const payload = {
            client_time: new Date().toISOString().replace('T', ' ').substring(0, 19),
            client_timezone_offset: new Date().getTimezoneOffset()
        };

        const localTimeRef = DataService._getLocalReferenceTime(payload.client_timezone_offset);
        const systemPrompt = DataService._getMagicSystemPrompt(localTimeRef);

        const response = await DataService._callAi({
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: [
                    { type: "text", text: "Analyze this image and extract health tracking data. Identify if it is food, drink, a stool sample (Bristol scale), or related to sleep/symptoms. Return the JSON list." },
                    { type: "image_url", image_url: { url: imageBase64 } }
                ]}
            ],
            max_tokens: 500
        });

        const content = response.choices ? response.choices[0].message.content : (response.content || '[]');
        let items = [];
        try {
            const parsed = JSON.parse(content);
            items = parsed.items || parsed || [];
            if (!Array.isArray(items)) items = [items];
        } catch (e) {
            console.error("JSON Parse Error", e);
            throw new Error("Failed to parse AI Vision response.");
        }
        
        if (items.length === 0) {
             // It's possible the image had nothing relevant, but let's warn if it's strictly empty
             // Actually, for vision, empty list might be valid if nothing found.
             // But usually we want to know.
             console.warn("AI Vision returned no items.");
        }

        return DataService._processAiResponse(items, payload.client_timezone_offset);
    },

    aiMagicVoice: async (audioBlob) => {
        // Step 1: Transcribe (Always goes to backend for Whisper, or Direct OpenAI in Local)
        let text = '';
        if (DataService.mode === 'HYBRID' && DataService.isAuthenticated) {
            const formData = new FormData();
            formData.append('audio_file', audioBlob);
            formData.append('api_key', DataService.apiKey); // Legacy/Fallback

            const res = await fetch('api.php?endpoint=ai_transcribe', { method: 'POST', body: formData });
            const data = await res.json();
            if (!res.ok || data.error) {
                 const msg = typeof data.error === 'string' ? data.error : (data.message || JSON.stringify(data.error));
                 throw new Error(msg);
            }
            text = data.text;
        } else {
            const transcribeResult = await DataService.aiTranscribe(audioBlob);
            if (!transcribeResult || !transcribeResult.text) throw new Error('Transcription failed');
            text = transcribeResult.text;
        }

        if (!text) throw new Error('No speech detected');

        // Step 2: Parse using JS Logic
        return DataService.aiParse(text);
    },
    
    aiTranscribe: async (audioBlob) => {
        const hasLocalKey = !!DataService.apiKey;
        const canUseProxy = DataService.mode === 'HYBRID' && DataService.isAuthenticated;

        if (hasLocalKey) {
            const formData = new FormData();
            formData.append('file', audioBlob, 'recording.webm');
            formData.append('model', 'whisper-1');
            return DataService._directOpenAICall('audio/transcriptions', formData, true);
        } else if (canUseProxy) {
            const formData = new FormData();
            formData.append('audio_file', audioBlob);
            // No api_key sent, server injects
            
            const res = await fetch('api.php?endpoint=ai_transcribe', { method: 'POST', body: formData });
            const data = await res.json();
            if (!res.ok || data.error) {
                 const msg = typeof data.error === 'string' ? data.error : (data.message || JSON.stringify(data.error));
                 throw new Error(msg);
            }
            if (!data.text || data.text.trim() === '') {
                throw new Error('No speech detected in recording.');
            }
            return data;
        } else {
            throw new Error('NO_API_KEY');
        }
    },

    // New Helpers Ported from PHP
    _getLocalReferenceTime: (offsetMinutes) => {
        // JS Date is already Local if we just do new Date(), but we need to match the Logic.
        // PHP Logic: UTC Time - OffsetMinutes (where offset is like -120 for UTC+2).
        // JS new Date().getTimezoneOffset() returns -120 for UTC+2.
        // So Local Time = UTC - Offset.
        // Wait, if I'm in UTC+2. Current is 14:00. UTC is 12:00. Offset is -120.
        // UTC (12:00) - (-120m) = 14:00. Correct.
        const now = new Date();
        const utcTimestamp = now.getTime() + (now.getTimezoneOffset() * 60000); // Convert to UTC timestamp
        
        // Apply Offset to get User Local Time
        // userOffset is what getTimezoneOffset() returns (e.g. -120 for UTC+2)
        // We want to reconstruct the Local Time string.
        // Actually, simpler: new Date() *is* Local.
        // The PHP logic was converting a UTC string to Local.
        // In JS, we just want a formatted Local string.
        
        const y = now.getFullYear();
        const m = String(now.getMonth() + 1).padStart(2, '0');
        const d = String(now.getDate()).padStart(2, '0');
        const h = String(now.getHours()).padStart(2, '0');
        const min = String(now.getMinutes()).padStart(2, '0');
        const s = String(now.getSeconds()).padStart(2, '0');
        return `${y}-${m}-${d} ${h}:${min}:${s}`;
    },

    _getMagicSystemPrompt: (localTimeStr) => {
        return `Context:
- User Local Time: ${localTimeStr}
- Output: JSON Object containing a key 'items' which is a list.

Task: Parse input into structured data.

Rules:
1. Use USER LOCAL TIME for 'event_at'. Do NOT convert to UTC.
2. If user implies 'now', use the Context time.
3. Infer amounts if vague (sip=0.05, cup=0.25, glass=0.3, mug=0.35, bottle=0.5).
4. For 'sleep', 'event_at' is WAKE time.
5. Format 'event_at' strictly as "YYYY-MM-DD HH:MM:SS".

Schema (Object Structure):
- { "type": "food", "event_at": "YYYY-MM-DD HH:MM:SS", "data": { "notes": "string" } }
- { "type": "drink", "event_at": "YYYY-MM-DD HH:MM:SS", "data": { "notes": "string", "amount_liters": float } }
- { "type": "stool", "event_at": "YYYY-MM-DD HH:MM:SS", "data": { "bristol_score": int(1-7), "notes": "string" } }
- { "type": "sleep", "event_at": "YYYY-MM-DD HH:MM:SS", "data": { "duration_hours": float, "quality": int(1-5), "bedtime": "YYYY-MM-DD HH:MM:SS" } }
- { "type": "symptom", "event_at": "YYYY-MM-DD HH:MM:SS", "data": { "notes": "string", "mood_score": int(1-5) } }
- { "type": "activity", "event_at": "YYYY-MM-DD HH:MM:SS", "data": { "duration_minutes": int, "intensity": "Low/Med/High", "notes": "string" } }`;
    },

    _processAiResponse: (items, offsetMinutes) => {
        if (!Array.isArray(items)) return [];
        const results = [];
        
        items.forEach(item => {
            if (!item.event_at) return;
            try {
                // item.event_at is LOCAL time string (e.g. "2023-10-10 08:00:00")
                if (item.event_at && item.event_at.endsWith(' 00:00:00')) {
                    // If time is 00:00:00, it likely means the user didn't specify a time (e.g. "yesterday").
                    // We default to 12:00:00 to place it in the middle of the day.
                    item.event_at = item.event_at.replace(' 00:00:00', ' 12:00:00');
                }

                let localDate = new Date(item.event_at.replace(' ', 'T'));
                
                // Fallback if date is invalid (e.g. AI returned garbage)
                if (isNaN(localDate.getTime())) {
                    console.warn('Invalid date from AI:', item.event_at, 'Using Now.');
                    localDate = new Date();
                }

                // Convert to UTC
                const utcString = localDate.toISOString().replace('T', ' ').substring(0, 19);
                item.event_at = utcString;
                
                // Sleep Logic
                if (item.type === 'sleep' && item.data && item.data.duration_hours) {
                    const durationSecs = parseFloat(item.data.duration_hours) * 3600;
                    const wakeTimeTs = localDate.getTime(); // UTC ms
                    const bedtimeTs = wakeTimeTs - (durationSecs * 1000);
                    const bedtimeDate = new Date(bedtimeTs);
                    item.data.bedtime = bedtimeDate.toISOString().replace('T', ' ').substring(0, 19);
                }
                
                results.push(item);
            } catch (e) {
                console.warn('Processing failed for item', item, e);
            }
        });
        return results;
    },

    _callAi: async (payload) => {
         // Payload is now OpenAI "chat/completions" body format (messages, etc)
         const hasLocalKey = !!DataService.apiKey;
         const canUseProxy = DataService.mode === 'HYBRID' && DataService.isAuthenticated;

         if (!hasLocalKey && !canUseProxy) {
             throw new Error('NO_API_KEY');
         }

         if (hasLocalKey) {
             // Direct Implementation for Pure Browser Mode (or override)
             let model = 'gpt-4o-mini';
             if (DataService.aiConfig && DataService.aiConfig.model) {
                 model = DataService.aiConfig.model;
             }

             const openAiBody = {
                 model: model,
                 temperature: 0,
                 ...payload
             };
             
             return DataService._directOpenAICall('chat/completions', openAiBody);
         } else {
             // Proxy Mode (Server injects key)
             const body = { 
                 ...payload, 
                 api_key: null // Ensure we don't send null, server handles injection
             };
             
             const res = await fetch(`api.php?endpoint=ai_chat_proxy`, {
                 method: 'POST',
                 headers: { 'Content-Type': 'application/json' },
                 body: JSON.stringify(body)
             });
             const data = await res.json();
             if (data.error) {
                 const msg = typeof data.error === 'string' ? data.error : (data.message || JSON.stringify(data.error));
                 throw new Error(msg);
             }
             
             const content = data.choices ? data.choices[0].message.content : (data.content || '');
             if (!content || String(content).trim() === '') {
                 throw new Error('AI returned an empty response.');
             }

             return data;
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
