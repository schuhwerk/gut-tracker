import { utils } from './utils.js';
import { DataService } from './data-service.js';
import { UI } from './ui-renderer.js';
import { Router } from './router.js';

const app = {
    pendingDeletions: new Set(),
    pendingDrafts: [],
    mediaRecorder: null,
    audioChunks: [],
    magicBtnHandlers: { timer: null, isLongPress: false, startTime: 0 },
    charts: {},
    isReviewing: false,
    lastSavedId: null,

    AI_PROVIDERS: {
        openai: { 
            name: 'OpenAI (Default)', 
            base_url: 'https://api.openai.com/v1', 
            model: 'gpt-4o-mini',
            fields_hidden: true 
        },
        deepseek: { 
            name: 'DeepSeek', 
            base_url: 'https://api.deepseek.com', 
            model: 'deepseek-chat',
            fields_hidden: false
        },
        custom: { 
            name: 'Custom / Other', 
            base_url: '', 
            model: '',
            fields_hidden: false
        }
    },

    showLoading: (text) => UI.toggleLoading(true, text),
    hideLoading: () => UI.toggleLoading(false),

    init: async () => {
        // PWA Registration
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('sw.js').then(reg => {
                reg.addEventListener('updatefound', () => {
                    const newWorker = reg.installing;
                    newWorker.addEventListener('statechange', () => {
                        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                            if(confirm("New version available! Refresh now?")) {
                                newWorker.postMessage({ type: 'SKIP_WAITING' });
                                window.location.reload();
                            }
                        }
                    });
                });
            });
            navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload());
        }

        // Fetch version
        fetch('manifest.json')
            .then(r => r.json())
            .then(d => { 
                const el = document.getElementById('app-version');
                if(el && d.version) el.innerText = 'v' + d.version;
            }).catch(() => {});

        // Initialize Data Service
        await DataService.init();

        // Routing & Auth
        window.addEventListener('route-changed', (e) => app.onRouteChanged(e.detail.view));
        
        Router.init();

        // Setup UI Listeners
        app.setupListeners();
        app.setupForms();
        app.initMagicButton();
        
        // Check if we need to login or redirect
        const currentHash = window.location.hash.substring(1);
        
        if (DataService.mode === 'HYBRID') {
            try {
                const res = await fetch('api.php?endpoint=check_auth');
                const auth = await res.json();
                if (auth.authenticated) {
                    DataService.isAuthenticated = true;
                    // Note: check_auth might return new config values, but DataService.init already handled it?
                    // Actually DataService.init calls check_auth. This second call is redundant if init did it.
                    // DataService.init handles isAuthenticated state.
                    // We just need to check if we are authenticated to navigate.
                } 
                
                if (DataService.isAuthenticated) {
                     await app.checkPendingUploads();
                     if (!currentHash || currentHash === 'login') await app.checkDraftsAndNavigate();
                } else {
                     if (!currentHash) Router.navigate('dashboard');
                }
            } catch (e) {
                // If checking auth fails (network), fallback logic handled by DataService.init setting mode=LOCAL?
                if (!currentHash) Router.navigate('dashboard');
            }
        } else {
            if (!currentHash || currentHash === 'login') await app.checkDraftsAndNavigate();
        }
    },

    navigate: (viewId) => {
        Router.navigate(viewId);
    },

    checkDraftsAndNavigate: async () => {
        const drafts = await DataService.getDrafts();
        if (drafts.length > 0) {
            Router.navigate('magic-input');
        } else {
            Router.navigate('dashboard');
        }
    },
    
    // AI Settings Logic
    toggleAiFields: () => {
        const provider = document.getElementById('ai-provider').value;
        const config = app.AI_PROVIDERS[provider] || app.AI_PROVIDERS['custom'];
        
        const advFields = document.getElementById('ai-advanced-fields');
        const baseUrlInput = document.getElementById('ai-base-url');
        const modelInput = document.getElementById('ai-model');

        // Always set the defaults if switching to a specific provider config
        if (provider !== 'custom') {
            baseUrlInput.value = config.base_url;
            modelInput.value = config.model;
        }

        if (config.fields_hidden) {
            advFields.classList.add('hidden');
        } else {
            advFields.classList.remove('hidden');
            baseUrlInput.placeholder = config.base_url || 'https://api.openai.com/v1';
            modelInput.placeholder = config.model || 'gpt-4o-mini';
        }
    },

    saveLocalSettings: async () => {
         const provider = document.getElementById('ai-provider').value;
         const apiKey = document.getElementById('api-key').value.trim();
         const debugMode = document.getElementById('debug-mode').checked;
         
         const config = {
             provider: provider,
             api_key: apiKey,
             base_url: document.getElementById('ai-base-url').value.trim(),
             model: document.getElementById('ai-model').value.trim()
         };

         try {
             if (apiKey) {
                 app.showLoading('Verifying API Key...');
                 await DataService.testApiKey(config);
                 app.hideLoading();
             }
             
             await DataService.saveSettings(config, debugMode);
             alert('Settings saved and verified.');
             Router.navigate('settings');
         } catch (e) {
             app.hideLoading();
             alert('Verification failed: ' + e.message + '\n\nSettings NOT saved.');
         }
    },

    checkPendingUploads: async () => {
        if (!DataService.isAuthenticated) return;
        const unsynced = await DataService.getPendingUploads();
        // Logic for sync prompt (currently disabled/placeholder)
    },

    onRouteChanged: async (viewId) => {
        if (viewId.startsWith('edit-')) {
            const id = viewId.split('-')[1];
            try {
                const entry = await DataService.getEntry(id);
                if (entry) {
                    Router.showView(`add-${entry.type}`); 
                    app.populateEntry(entry);
                } else {
                    alert('Entry not found');
                    Router.navigate('dashboard');
                }
            } catch(e) {
                console.error(e);
                Router.navigate('dashboard');
            }
            return;
        }

        if (viewId === 'dashboard') {
            app.loadEntries();
            const welcomeBox = document.getElementById('welcome-box');
            if (welcomeBox && !localStorage.getItem('welcomeBoxDismissed')) {
                welcomeBox.classList.remove('hidden');
            }
            app.updateStatusBox();
            app.checkBetaWarning();
        } else if (viewId === 'stats') {
            app.loadStats();
        } else if (viewId === 'diagram') {
            app.loadDiagram();
        } else if (viewId.startsWith('add-')) {
             app.prepareAddView(viewId);
        } else if (viewId === 'magic-input') {
             app.renderMagicList();
        } else if (viewId === 'settings') {
            // Populate Settings
            const config = DataService.aiConfig || {};
            
            // Handle legacy format (if config is just string or null)
            const provider = config.provider || (config.base_url ? 'custom' : 'openai');
            
            // Generate Options
            const select = document.getElementById('ai-provider');
            select.innerHTML = '';
            Object.keys(app.AI_PROVIDERS).forEach(key => {
                const opt = document.createElement('option');
                opt.value = key;
                opt.text = app.AI_PROVIDERS[key].name;
                select.appendChild(opt);
            });
            select.value = provider;

            document.getElementById('api-key').value = config.api_key || (typeof config === 'string' ? config : '') || '';
            document.getElementById('ai-base-url').value = config.base_url || '';
            document.getElementById('ai-model').value = config.model || '';
            document.getElementById('debug-mode').checked = DataService.debugMode || false;
            
            app.toggleAiFields();

            const logoutBtn = document.getElementById('btn-logout');
            const loginBtn = document.getElementById('btn-login-settings');
            const profileSync = document.getElementById('profile-sync-section');
            const logsBtn = document.getElementById('btn-show-logs');
            const userInfoBox = document.getElementById('user-info-settings');
            const usernameSpan = document.getElementById('settings-username');

            if (DataService.isAuthenticated) {
                if(logoutBtn) logoutBtn.classList.remove('hidden');
                if(loginBtn) loginBtn.classList.add('hidden');
                if(profileSync) profileSync.classList.remove('hidden');
                if (DataService.debugMode && logsBtn) logsBtn.classList.remove('hidden');
                
                try {
                    const user = await DataService.getCurrentUser();
                    if(user && usernameSpan) usernameSpan.innerText = user.username;
                    if(userInfoBox) userInfoBox.classList.remove('hidden');
                } catch(e) { }

            } else {
                if(logoutBtn) logoutBtn.classList.add('hidden');
                if(loginBtn) loginBtn.classList.remove('hidden');
                if(profileSync) profileSync.classList.add('hidden');
                if(logsBtn) logsBtn.classList.add('hidden');
                if(userInfoBox) userInfoBox.classList.add('hidden');
            }
        }
    },
    
    // ... rest of methods unchanged ... 
    logout: async () => {
        if (!confirm('Logout?')) return;
        try {
            await fetch('api.php?endpoint=logout', { method: 'POST' });
            DataService.isAuthenticated = false;
            window.location.reload(); 
        } catch (e) {
            alert('Logout failed');
        }
    },

    loadEntries: async () => {
        const timeline = document.getElementById('timeline');
        timeline.innerHTML = '<p class="text-center text-gray-500 py-4">Loading...</p>';
        let entries = await DataService.getEntries();
        
        if (app.pendingDeletions.size > 0) {
            entries = entries.filter(e => !app.pendingDeletions.has(e.id));
        }
        
        const now = new Date();
        const todayISO = utils.formatISO(now).split('T')[0]; 
        
        let waterToday = 0;
        let hasFeelingLog = false;

        entries.forEach(e => {
            const localDate = utils.fromUTC(e.event_at);
            const dateStr = utils.formatISO(localDate).split('T')[0];
            
            if (e.type === 'drink' && dateStr === todayISO) {
                waterToday += parseFloat(e.data.amount_liters || 0);
            }
            if ((e.type === 'feeling' || e.type === 'symptom') && (dateStr === todayISO)) {
                hasFeelingLog = true;
            }
        });
        document.getElementById('hydration-label').innerText = `${waterToday.toFixed(1)} / 2.5L`;
        document.getElementById('hydration-bar').style.width = Math.min(100, (waterToday / 2.5) * 100) + '%';

        const dot = document.getElementById('feeling-btn-dot');
        if (dot) {
             if (now.getHours() >= 15 && !hasFeelingLog) dot.classList.remove('hidden');
             else dot.classList.add('hidden');
        }
        
        UI.renderTimeline(entries, 'timeline', app.lastSavedId);
        if (app.lastSavedId) app.lastSavedId = null;
        
        document.querySelectorAll('#timeline > div').forEach(el => {
            el.onclick = () => {
                const id = el.dataset.id;
                const entry = entries.find(e => e.id == id);
                if (entry) app.editEntry(entry);
            };

            const cloneBtn = el.querySelector('.btn-clone');
            if (cloneBtn) {
                cloneBtn.onclick = (e) => {
                    e.stopPropagation();
                    const id = el.dataset.id;
                    const entry = entries.find(e => e.id == id);
                    if (entry) app.cloneEntry(entry);
                };
            }
        });
    },

    cloneEntry: async (originalEntry) => {
        try {
            const newEntry = {
                ...originalEntry,
                id: null,
                event_at: utils.toUTC(new Date()),
                created_at: utils.toUTC(new Date()),
                synced: 0 
            };
            if (newEntry.data && newEntry.data.is_draft) {
                delete newEntry.data.is_draft;
            }

            const result = await DataService.saveEntry(newEntry);
            
            app.lastSavedId = result.id;
            app.loadEntries(); 
            
            app.showUndoToast('Entry re-added', async () => {
                await DataService.deleteEntry(result.id);
                app.loadEntries();
            });

        } catch (e) {
            alert('Failed to re-add: ' + e.message);
        }
    },

    prepareAddView: (viewId) => {
        let type = viewId.replace('add-', '');
        if (type === 'symptom') type = 'feeling';
        
        const formId = `form-${type}`;
        app.resetForm(formId);
        
        const title = document.getElementById(`title-${type}`);
        if (title) title.innerText = `Add ${type.charAt(0).toUpperCase() + type.slice(1)}`;
        
        const deleteBtn = document.querySelector(`#view-${viewId} .btn-delete`);
        if (deleteBtn) deleteBtn.classList.add('hidden');
        
        const timeInput = document.querySelector(`#${formId} input[name="event_at"]`);
        if (timeInput) timeInput.value = utils.formatISO();
        
        if (viewId === 'add-sleep') {
             const bedInput = document.querySelector(`#${formId} input[name="bedtime"]`);
             if (bedInput) bedInput.value = utils.formatISO(new Date(Date.now() - 8*3600*1000));
        }
        
        const btn = document.querySelector(`#${formId} .save-btn`);
        if (btn) btn.textContent = 'Save ' + type.charAt(0).toUpperCase() + type.slice(1);

        const typeSelector = document.querySelector(`#${formId} .type-switcher`);
        if (typeSelector) typeSelector.value = type;
    },

    editEntry: (entry) => {
        if (entry.id) {
            Router.navigate(`edit-${entry.id}`);
        } else {
            Router.navigate(`add-${entry.type}`);
            setTimeout(() => app.populateEntry(entry), 50);
        }
    },

    switchEntryType: (newType) => {
        const currentView = document.querySelector('.view:not(.hidden)');
        if (!currentView) return;
        const currentForm = currentView.querySelector('form');
        if (!currentForm) return;

        const formData = new FormData(currentForm);
        const id = formData.get('id');
        const event_at_local = formData.get('event_at');
        const notes = formData.get('notes');
        
        const entry = {
            id: id ? Number(id) : null,
            type: newType,
            event_at: event_at_local ? utils.toUTC(event_at_local) : new Date().toISOString().replace('T', ' ').substring(0, 19),
            data: { notes: notes }
        };

        const imgPreview = currentForm.querySelector('.current-image-preview img');
        if (imgPreview) {
            entry.data.image_path = imgPreview.getAttribute('src');
        }

        Router.showView(`add-${newType}`);
        app.prepareAddView(`add-${newType}`);
        app.populateEntry(entry);
    },

    populateEntry: (entry) => {
        let type = entry.type;
        if (type === 'symptom') type = 'feeling';

        const viewId = `add-${type}`;
        const formId = `form-${type}`;
        
        if (entry.type === 'symptom') {
             document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
             document.getElementById('view-' + viewId)?.classList.remove('hidden');
        }

        const form = document.getElementById(formId);
        if (!form) return;

        const typeSelector = form.querySelector('.type-switcher');
        if (typeSelector) typeSelector.value = type;
        
        form.querySelector('input[name="id"]').value = entry.id || '';
        const infoEl = document.querySelector(`#view-${viewId} .created-at-info`);
        if (infoEl) infoEl.innerText = entry.id ? 'Created: ' + (entry.created_at || 'N/A') + ' (UTC)' : '';
        
        const deleteBtn = document.querySelector(`#view-${viewId} .btn-delete`);
        if (deleteBtn) {
            if (entry.id) deleteBtn.classList.remove('hidden');
            else deleteBtn.classList.add('hidden');
        }
        
        const title = document.getElementById(`title-${type}`);
        if (title) title.innerText = `Edit ${type.charAt(0).toUpperCase() + type.slice(1)}`;
        
        const btn = form.querySelector('.save-btn');
        if (btn) {
            if (entry.data && entry.data.is_draft) {
                btn.textContent = 'Add ' + type.charAt(0).toUpperCase() + type.slice(1);
            } else {
                btn.textContent = entry.id ? 'Update' : 'Save ' + type.charAt(0).toUpperCase() + type.slice(1);
            }
        }

        const timeInput = form.querySelector('input[name="event_at"]');
        if (timeInput) {
            timeInput.value = utils.toLocalInput(entry.event_at);
        }
        
        if (entry.data.notes) {
            const el = form.querySelector('textarea[name="notes"]') || form.querySelector(`#${type}-notes`);
            if(el) el.value = entry.data.notes;
        }

        if (type === 'stool') {
            const s = entry.data.bristol_score;
            form.querySelector('input[name="bristol_score"]').value = s || 4;
            form.querySelectorAll('.bristol-selector button').forEach(b => b.classList.remove('selected'));
            const b = form.querySelector(`.bristol-selector button[data-val="${s}"]`);
            if(b) b.classList.add('selected');
        } else if (type === 'drink') {
            form.querySelector('input[name="amount_liters"]').value = entry.data.amount_liters || '';
        } else if (type === 'feeling' || type === 'symptom') {
            const val = entry.data.mood_score || entry.data.severity || 3;
            const input = form.querySelector('input[name="mood_score"]');
            if (input) {
                input.value = val;
                const output = input.parentElement.querySelector('output');
                if (output) output.value = val;
            }
            if (entry.data.notes) {
                 const el = form.querySelector('textarea[name="notes"]') || form.querySelector('#feeling-notes');
                 if(el) el.value = entry.data.notes;
            }
        } else if (type === 'sleep') {
            const val = entry.data.quality || 3;
            const input = form.querySelector('input[name="quality"]');
            if (input) {
                input.value = val;
                const output = input.parentElement.querySelector('output');
                if (output) output.value = val;
            }
            if (entry.data.bedtime) {
                form.querySelector('input[name="bedtime"]').value = utils.toLocalInput(entry.data.bedtime);
            }
        } else if (type === 'activity') {
            form.querySelector('input[name="duration_minutes"]').value = entry.data.duration_minutes || '';
            const val = entry.data.intensity;
            form.querySelector('input[name="intensity"]').value = val || '';
            
            if (val) {
                const b = form.querySelector(`.intensity-selector button[data-val="${val}"]`);
                if(b) b.click();
            }
            if (entry.data.notes) {
                const el = form.querySelector('textarea[name="notes"]');
                if(el) el.value = entry.data.notes;
            }
        }

        if (entry.data.image_path) {
            const prev = form.querySelector('.current-image-preview') || document.querySelector(`#view-${viewId} .current-image-preview`);
            if (prev) {
                prev.innerHTML = `
                <div class="relative inline-block">
                    <img src="${entry.data.image_path}" class="h-32 rounded-lg border border-dark-600 bg-dark-800 object-cover" onerror="this.src='data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjNmI3MjgwIiBzdHJva2Utd2lkdGg9IjIiPjxwYXRoIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCIgZD0iTTEyIDl2Mn0xMiAxNXYuMDFNMjEgMTJjMCA0Ljk3LTQuMDMgOS05IDlTMiAxNi45NyAyIDEyIDEyIDIuOTggMTIgMi45OCA5IDIxIDEyek0xMiA4VjQiIC8+PC9zdmc+'">
                    <button type="button" class="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 shadow-md hover:bg-red-600 transition-colors z-10" onclick="app.removeImage(this)">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                          <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>`;
                prev.classList.remove('hidden');
            }
        }
    },

    resetForm: (formId) => {
        const form = document.getElementById(formId);
        if(!form) return;
        form.reset();
        delete form.dataset.removeImage;
        form.querySelector('input[name="id"]').value = '';
        const prev = form.querySelector('.current-image-preview');
        if(prev) { prev.innerHTML = ''; prev.classList.add('hidden'); }
        const btns = form.querySelectorAll('.bristol-selector button');
        if(btns) btns.forEach(b => b.classList.remove('selected'));
        
        const iBtn = form.querySelectorAll('.intensity-selector button');
        if(iBtn) {
            iBtn.forEach(b => {
                 b.classList.add('bg-dark-800');
                 b.classList.remove('bg-emerald-600', 'text-white');
                 b.querySelector('.font-bold')?.classList.remove('text-white');
                 b.querySelector('.font-bold')?.classList.add('text-gray-400');
            });
        }
    },

    setupForms: () => {
        const handleSubmit = async (e, type) => {
            e.preventDefault();
            const form = e.target;
            const formData = new FormData(form);
            const formId = `form-${type}`;
            
            let entry = {
                id: formData.get('id') ? Number(formData.get('id')) : null,
                type: type,
                event_at: utils.toUTC(formData.get('event_at')),
                data: {},
                image_blob: null
            };

            if (entry.id) {
                try {
                    const existing = await DataService.getEntry(entry.id);
                    if (existing) {
                        entry = { 
                            ...existing, 
                            ...entry, 
                            data: { ...existing.data, ...entry.data } 
                        };
                    }
                } catch(e) { console.warn('Failed to fetch existing for merge', e); }
            }
            
            if (type === 'stool') {
                entry.data.bristol_score = formData.get('bristol_score');
                entry.data.notes = formData.get('notes');
            } else if (type === 'sleep') {
                const bedLocal = formData.get('bedtime');
                entry.data.bedtime = utils.toUTC(bedLocal);
                entry.data.quality = formData.get('quality');
                const wakeDate = new Date(formData.get('event_at'));
                const bedDate = new Date(bedLocal);
                entry.data.duration_hours = (wakeDate > bedDate) ? ((wakeDate - bedDate) / 3600000).toFixed(1) : 0;
            } else if (type === 'feeling') {
                 entry.data.notes = formData.get('notes');
                 entry.data.mood_score = formData.get('mood_score');
            } else if (type === 'drink') {
                 entry.data.notes = formData.get('notes');
                 entry.data.amount_liters = formData.get('amount_liters');
            } else if (type === 'food') {
                 entry.data.notes = formData.get('notes');
                 const fileInput = form.querySelector('input[name="image"]');
                 if (fileInput && fileInput.files[0]) {
                     entry.image_blob = fileInput.files[0];
                 }
            } else if (type === 'activity') {
                entry.data.notes = formData.get('notes');
                entry.data.duration_minutes = formData.get('duration_minutes');
                entry.data.intensity = formData.get('intensity');
            }

            if (form.dataset.removeImage === '1') {
                entry.data.image_path = null;
                entry.image_blob = null;
            }

            try {
                const result = await DataService.saveEntry(entry);
                app.lastSavedId = result.id;
                
                app.resetForm(formId);
                
                if (app.isReviewing) {
                    app.isReviewing = false;
                    const drafts = await DataService.getDrafts();
                    if (drafts.length > 0) Router.navigate('magic-input');
                    else Router.navigate('dashboard');
                } else {
                    Router.navigate('dashboard');
                }
            } catch (err) {
                console.error(err);
                const msg = err ? (err.message || err) : 'Unknown error';
                alert('Save failed: ' + msg);
            }
        };

        ['food', 'drink', 'stool', 'sleep', 'feeling', 'activity'].forEach(type => {
             const formId = `form-${type}`;
             const form = document.getElementById(formId);
             if (form) form.addEventListener('submit', (e) => handleSubmit(e, type));
        });
        
        const loginForm = document.getElementById('login-form');
        if(loginForm) {
            loginForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const fd = new FormData(loginForm);
                try {
                    const res = await fetch('api.php?endpoint=login', { method: 'POST', body: fd });
                    const data = await res.json();
                    if(data.user_id) {
                         await DataService.init(); 
                         Router.navigate('dashboard');
                    } else {
                        alert(data.error || 'Login failed');
                    }
                } catch(e) { alert('Login failed'); }
            });
        }
        
        const createForm = document.getElementById('create-user-form');
        if (createForm) {
            createForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const fd = new FormData(createForm);
                try {
                    const res = await fetch('api.php?endpoint=create_user', { method: 'POST', body: fd });
                    const data = await res.json();
                    if(!data.error) {
                        alert('User created, please login.');
                        Router.navigate('login');
                    } else alert(data.error);
                } catch(e) { alert('Failed'); }
            });
        }
    },

    setupListeners: () => {
         document.querySelectorAll('.bristol-selector button').forEach(btn => {
             btn.addEventListener('click', (e) => {
                 const target = e.target.closest('button');
                 const p = target.parentElement;
                 p.querySelectorAll('button').forEach(b => b.classList.remove('selected'));
                 target.classList.add('selected');
                 p.nextElementSibling.value = target.dataset.val;
             });
         });
         
         document.querySelectorAll('.intensity-selector button').forEach(btn => {
             btn.addEventListener('click', (e) => {
                 const target = e.target.closest('button');
                 const p = target.parentElement;
                 p.querySelectorAll('button').forEach(b => b.classList.remove('bg-emerald-600', 'bg-dark-800', 'border-emerald-500'));
                 p.querySelectorAll('button').forEach(b => {
                     b.classList.add('bg-dark-800');
                     b.classList.remove('bg-emerald-600', 'text-white');
                     b.querySelector('.text-gray-400')?.classList.remove('text-white');
                 });
                 
                 target.classList.remove('bg-dark-800');
                 target.classList.add('bg-emerald-600', 'text-white');
                 target.querySelector('.font-bold')?.classList.remove('text-gray-400');
                 target.querySelector('.font-bold')?.classList.add('text-white');
                 
                 p.nextElementSibling.value = target.dataset.val;
             });
         });
         
         document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.key === 'Enter') {
                const form = document.activeElement?.closest('form');
                if (form) form.requestSubmit();
            }
         });
         
         window.app = app;
    },

    removeImage: (btn) => {
        const form = btn.closest('form');
        const prev = btn.closest('.current-image-preview');
        if (prev) {
            prev.innerHTML = '';
            prev.classList.add('hidden');
        }
        const fileInput = form.querySelector('input[name="image"]');
        if (fileInput) fileInput.value = '';
        form.dataset.removeImage = '1';
    },

    handleImageSelect: async (input) => {
        if (!DataService.apiKey) {
            alert('Please add your OpenAI API Key in settings to use AI features.');
            Router.navigate('settings');
            input.value = '';
            return;
        }
        const preview = document.getElementById('img-preview-text');
        if (!input.files || !input.files[0]) return;
        
        preview.innerText = 'Compressing...';
        try {
            const base64 = await utils.compressImage(input.files[0]);
            
            const form = input.closest('form');
            const imgPrev = form.querySelector('.current-image-preview');
            if (imgPrev) {
                imgPrev.innerHTML = `<img src="${base64}" class="h-32 rounded-lg border border-dark-600 bg-dark-800 object-cover">`;
                imgPrev.classList.remove('hidden');
            }

            preview.innerText = 'Analyzing...';
            
            const results = await DataService.aiVision(base64);
            if (results && results.length > 0) {
                 const notes = document.getElementById('food-notes');
                 if(notes) notes.value = (notes.value ? notes.value + ' ' : '') + (results[0].data.notes || '');
                 preview.innerText = 'Analyzed! ✅';
            } else {
                 preview.innerText = 'No food detected';
            }
        } catch(e) {
            preview.innerText = 'Error: ' + e.message;
        }
    },
    
    processMagicImage: async (input) => {
         if (!DataService.apiKey) {
            alert('Please add your OpenAI API Key in settings to use AI features.');
            Router.navigate('settings');
            input.value = '';
            return;
         }
         if (!input.files || !input.files[0]) return;
         UI.toggleLoading(true, 'AI Vision...');
         try {
             const base64 = await utils.compressImage(input.files[0], 1024);
             const imageBlob = utils.base64ToBlob(base64);
             const results = await DataService.aiVision(base64);
             app.handleMagicResults(results, imageBlob);
         } catch(e) {
             alert(e.message);
         } finally {
             UI.toggleLoading(false);
             input.value = '';
         }
    },
    
    handleMagicResults: async (results, imageBlob = null) => {
        if (!Array.isArray(results)) {
            if (results && typeof results === 'object' && !results.error) {
                results = [results];
            } else {
                throw new Error('AI Response Error: ' + (results.error || 'Invalid format'));
            }
        }

        if (imageBlob) {
            results.forEach(r => {
                r.image_blob = imageBlob;
            });
        }

        if (results.length === 1) {
            try {
                UI.toggleLoading(true, 'Saving entry...');
                const result = await DataService.saveEntry(results[0]);
                app.lastSavedId = result.id;
                UI.toggleLoading(false);
                Router.navigate('dashboard');
                return;
            } catch (e) {
                console.warn('Auto-save failed, saving as draft instead', e);
            }
        }

        UI.toggleLoading(true, 'Preparing review...');
        for(let entry of results) {
            entry.data = entry.data || {};
            entry.data.is_draft = true;
            await DataService.saveEntry(entry);
        }
        UI.toggleLoading(false);

        Router.navigate('magic-input');
        app.renderMagicList();
    },
    
    renderMagicList: async () => {
        const container = document.getElementById('magic-result-content');
        if(!container) return;
        container.innerHTML = '<p class="text-center text-gray-500">Loading drafts...</p>';
        
        app.pendingDrafts = await DataService.getDrafts();

        if (app.pendingDeletions.size > 0) {
            app.pendingDrafts = app.pendingDrafts.filter(e => !app.pendingDeletions.has(e.id));
        }

        container.innerHTML = '';
        
        if (app.pendingDrafts.length === 0) {
            container.innerHTML = '<p class="text-center text-gray-500 py-4">No pending items.</p>';
            Router.navigate('dashboard');
            return;
        }

        app.pendingDrafts.forEach((entry, index) => {
            const div = document.createElement('div');
            div.className = 'bg-dark-800 rounded-xl p-4 shadow-lg border border-dark-700 relative overflow-hidden mb-4';
            
            let icon = '', title = '', content = '', imageHtml = ''; 
            
            if (entry.data && entry.data.image_path) {
                imageHtml = `<div class="shrink-0"><img src="${entry.data.image_path}" class="w-16 h-16 rounded-lg object-cover border border-dark-600 bg-dark-900" loading="lazy"></div>`;
            }

            if (entry.type === 'food') {
                icon = '🍎'; title = 'Food';
                if (entry.data.notes) content += `<p class="text-gray-300 mt-1">${entry.data.notes}</p>`;
            } else if (entry.type === 'drink') {
                icon = '🥤'; title = 'Drink';
                const amt = entry.data.amount_liters ? `<span class="font-bold text-cyan-400 ml-2">${entry.data.amount_liters}L</span>` : '';
                if (entry.data.notes) content += `<p class="text-gray-300 mt-1">${entry.data.notes}${amt}</p>`;
                else if (entry.data.amount_liters) content += `<p class="text-gray-300 mt-1">${amt}</p>`;
            } else if (entry.type === 'feeling' || entry.type === 'symptom') {
                icon = '⚡'; title = 'Mood/Feeling';
                if (entry.data.notes) content += `<p class="text-gray-300 mt-1 font-medium">${entry.data.notes}</p>`;
                const score = entry.data.mood_score || entry.data.severity || '?';
                title += ` <span class="text-xs text-emerald-400 ml-2">Mood: ${score}</span>`;
            } else if (entry.type === 'stool') {
                icon = '💩'; title = `Stool (Type ${entry.data.bristol_score})`;
                if (entry.data.notes) content += `<p class="text-gray-300 italic mt-1">"${entry.data.notes}"</p>`;
            } else if (entry.type === 'sleep') {
                icon = '😴'; title = 'Sleep';
                const dur = parseFloat(entry.data.duration_hours).toFixed(1);
                content += `<div class="text-xl font-bold text-white">${dur}h</div>`;
            } else {
                icon = '📝'; title = entry.type.charAt(0).toUpperCase() + entry.type.slice(1);
                if (entry.data.notes) content += `<p class="text-gray-300 mt-1">${entry.data.notes}</p>`;
            }

            div.innerHTML = `
               <div class="flex gap-3 mb-4">
                   ${imageHtml}
                   <div class="flex-1 min-w-0">
                       <div class="flex justify-between items-start mb-1">
                           <div class="flex items-center gap-2"><span>${icon}</span><h3 class="font-bold text-white">${title}</h3></div>
                           <button onclick="app.cancelMagicEntry(${index})" class="text-gray-500 hover:text-red-400 p-1">✕</button>
                       </div>
                       <div class="text-sm text-gray-300">${content}</div>
                       <div class="text-xs text-gray-500 mt-2">Recorded at: ${utils.fromUTC(entry.event_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</div>
                   </div>
               </div>
               <div class="grid grid-cols-2 gap-2">
                   <button onclick="app.reviewMagicEntry(${index})" class="bg-dark-700 hover:bg-dark-600 text-gray-300 py-2 rounded-lg text-xs font-bold border border-dark-600">Review</button>
                   <button onclick="app.saveMagicEntry(${index})" class="bg-emerald-600 hover:bg-emerald-500 text-white py-2 rounded-lg text-xs font-bold shadow-lg shadow-emerald-900/20">Add</button>
               </div>
            `;
            container.appendChild(div);
       });
    },
    
    reviewMagicEntry: (index) => {
        const entry = app.pendingDrafts[index];
        app.isReviewing = true;
        app.editEntry(entry);
    },
    
    saveMagicEntry: async (index) => {
        const entry = app.pendingDrafts[index];
        try {
            if(entry.data) delete entry.data.is_draft;
            const result = await DataService.saveEntry(entry);
            app.lastSavedId = result.id;
            
            app.renderMagicList();
        } catch(e) { alert(e.message); }
    },
    
    cancelMagicEntry: async (index) => {
        const entry = app.pendingDrafts[index];
        const id = entry.id;
        if(!id) return;

        app.pendingDeletions.add(id);
        app.renderMagicList();

        let committed = false;
        const timeoutId = setTimeout(async () => {
             committed = true;
             app.pendingDeletions.delete(id);
             await DataService.deleteEntry(id);
        }, 5000);

        app.showUndoToast('Draft discarded', () => {
             if(committed) return; 
             clearTimeout(timeoutId);
             app.pendingDeletions.delete(id);
             app.renderMagicList();
        });
    },

    dismissWelcomeBox: () => {
        const welcomeBox = document.getElementById('welcome-box');
        if (welcomeBox) {
            welcomeBox.classList.add('hidden');
            localStorage.setItem('welcomeBoxDismissed', 'true');
        }
    },

    checkBetaWarning: () => {
        const box = document.getElementById('beta-warning-dash');
        if (!box) return;
        if (localStorage.getItem('betaWarningDismissed') === 'true') {
            box.classList.add('hidden');
        } else {
            box.classList.remove('hidden');
        }
        app.updateAlertIcon();
    },

    dismissBetaWarning: () => {
        const box = document.getElementById('beta-warning-dash');
        if (box) box.classList.add('hidden');
        localStorage.setItem('betaWarningDismissed', 'true');
        app.updateAlertIcon();
    },

    getStatusType: () => {
        if (DataService.mode === 'LOCAL') return 'OFFLINE';
        if (DataService.mode === 'HYBRID' && !DataService.isAuthenticated) return 'UNAUTH';
        return null;
    },

    updateStatusBox: () => {
        const box = document.getElementById('status-box');
        const titleEl = document.getElementById('status-box-title');
        const msgEl = document.getElementById('status-box-msg');
        const actionBtn = document.getElementById('status-box-action');
        
        if (!box) return;

        const type = app.getStatusType();

        if (!type) {
            box.classList.add('hidden');
            app.updateAlertIcon();
            return;
        }

        if (type === 'OFFLINE') {
            titleEl.innerHTML = '<span>📡</span> Offline Mode';
            msgEl.innerHTML = 'Server unreachable. Data is saved <strong class="text-orange-300">locally</strong> and will NOT sync until connection is restored.';
            actionBtn.innerText = 'Reload to Retry';
            actionBtn.onclick = () => window.location.reload();
        } else if (type === 'UNAUTH') {
            titleEl.innerHTML = '<span>🔒</span> Not Logged In';
            msgEl.innerHTML = 'Backend detected but you are not logged in. Data is saved <strong class="text-orange-300">locally</strong>. <br>Clear browser = Lose data.';
            actionBtn.innerText = 'Login to Sync';
            actionBtn.onclick = () => app.navigate('login');
        }

        const dismissedKey = `statusDismissed_${type}`;
        if (localStorage.getItem(dismissedKey) === 'true') {
            box.classList.add('hidden');
        } else {
            box.classList.remove('hidden');
        }
        app.updateAlertIcon();
    },

    dismissStatusBox: () => {
        const type = app.getStatusType();
        if (type) {
            localStorage.setItem(`statusDismissed_${type}`, 'true');
            const box = document.getElementById('status-box');
            if(box) box.classList.add('hidden');
            app.updateAlertIcon();
            
            const icon = document.getElementById('btn-status-icon');
            if(icon) {
                icon.classList.add('animate-pulse');
                setTimeout(() => icon.classList.remove('animate-pulse'), 2000);
            }
        }
    },

    updateAlertIcon: () => {
        const icon = document.getElementById('btn-status-icon');
        if (!icon) return;

        const betaDismissed = localStorage.getItem('betaWarningDismissed') === 'true';
        
        const type = app.getStatusType();
        const statusDismissed = type ? localStorage.getItem(`statusDismissed_${type}`) === 'true' : false;

        if (betaDismissed || (type && statusDismissed)) {
            icon.classList.remove('hidden');
            
            if (!icon.dataset.settled) {
                icon.classList.add('text-orange-400', 'animate-pulse');
                icon.dataset.settled = "true";
                
                setTimeout(() => {
                    icon.classList.remove('text-orange-400', 'animate-pulse');
                }, 3000); 
            }
        } else {
            icon.classList.add('hidden');
            delete icon.dataset.settled;
            icon.classList.remove('text-orange-400', 'animate-pulse');
        }
    },

    showAllAlerts: () => {
        localStorage.removeItem('betaWarningDismissed');
        const type = app.getStatusType();
        if(type) localStorage.removeItem(`statusDismissed_${type}`);
        
        app.checkBetaWarning();
        app.updateStatusBox();
    },

    showStatusBox: () => {
        app.showAllAlerts();
    },

    deleteEntry: async (formId) => {
         const form = document.getElementById(formId);
         const idVal = form.querySelector('input[name="id"]').value;
         if(!idVal) return;
         const id = Number(idVal);

         app.pendingDeletions.add(id);
         app.resetForm(formId);
         Router.navigate('dashboard'); 

         let committed = false;
         const timeoutId = setTimeout(async () => {
             committed = true;
             app.pendingDeletions.delete(id);
             await DataService.deleteEntry(id);
         }, 5000);

         app.showUndoToast('Entry deleted', () => {
             if (committed) return; 
             clearTimeout(timeoutId);
             app.pendingDeletions.delete(id);
             if (app.pendingDeletions.size === 0 && (window.location.hash === '#dashboard' || !window.location.hash)) {
                 app.loadEntries();
             }
         });
    },

    showUndoToast: (msg, onUndo) => {
        const existing = document.getElementById('undo-toast');
        if(existing) existing.remove();

        const toast = document.createElement('div');
        toast.id = 'undo-toast';
        toast.className = 'fixed bottom-24 left-1/2 transform -translate-x-1/2 z-50 bg-dark-800 text-white px-6 py-3 rounded-full shadow-lg border border-dark-600 flex items-center gap-4 shadow-2xl';
        toast.innerHTML = `
            <span>${msg}</span>
            <button id="btn-undo" class="text-emerald-400 font-bold hover:text-emerald-300 border-l border-dark-600 pl-4">UNDO</button>
        `;
        document.body.appendChild(toast);
        
        toast.querySelector('#btn-undo').onclick = () => {
             onUndo();
             toast.remove();
        };

        setTimeout(() => {
            if(document.body.contains(toast)) {
                toast.style.transition = 'opacity 0.5s';
                toast.style.opacity = '0';
                setTimeout(() => toast.remove(), 500);
            }
        }, 5000);
    },

    syncKeyToProfile: async () => {
        const provider = document.getElementById('ai-provider').value;
        const key = document.getElementById('api-key').value.trim();
        if(!key) return alert('Enter a key first');
        
        const config = {
            provider: provider,
            api_key: key,
            base_url: document.getElementById('ai-base-url').value.trim(),
            model: document.getElementById('ai-model').value.trim()
        };

        try {
            app.showLoading('Verifying Key...');
            await DataService.testApiKey(config);
            app.hideLoading();

            const res = await fetch('api.php?endpoint=update_settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    api_key: key,
                    ai_config: config,
                    debug_mode: document.getElementById('debug-mode').checked ? 1 : 0
                })
            });
            const data = await res.json();
            if(data.error) throw new Error(data.error);
            alert('Key verified and synced to profile');
        } catch(e) { 
            app.hideLoading();
            alert('Verification or Sync failed: ' + e.message); 
        }
    },

    removeKeyFromProfile: async () => {
        if(!confirm('Remove key from server?')) return;
        try {
            const res = await fetch('api.php?endpoint=update_settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ api_key: '' })
            });
            const data = await res.json();
            if(data.error) throw new Error(data.error);
            alert('Key removed from profile');
        } catch(e) { alert('Failed: ' + e.message); }
    },

    exportData: async () => {
        const entries = await DataService.getEntries(5000);
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(entries));
        const downloadAnchorNode = document.createElement('a');
        downloadAnchorNode.setAttribute("href",     dataStr);
        downloadAnchorNode.setAttribute("download", "gut_tracker_export.json");
        document.body.appendChild(downloadAnchorNode);
        downloadAnchorNode.click();
        downloadAnchorNode.remove();
    },

    exportDataForAI: async () => {
        const entries = await DataService.getEntries(5000);
        
        const output = utils.generateAIExport(entries);

        const dataStr = "data:text/plain;charset=utf-8," + encodeURIComponent(output);
        const downloadAnchorNode = document.createElement('a');
        downloadAnchorNode.setAttribute("href",     dataStr);
        downloadAnchorNode.setAttribute("download", "gut_tracker_ai_export.txt");
        document.body.appendChild(downloadAnchorNode);
        downloadAnchorNode.click();
        downloadAnchorNode.remove();
    },

    deleteAllData: async () => {
        if (!confirm('EXTREMELY IMPORTANT: This will delete ALL data from this device and the server (if logged in). Proceed?')) return;
        if (!confirm('Are you REALLY sure?')) return;
        
        try {
            if (DataService.mode === 'HYBRID' && DataService.isAuthenticated) {
                await fetch('api.php?endpoint=delete_all', { method: 'POST' });
            }
            await db.clearAll();
            alert('All data deleted.');
            window.location.reload();
        } catch (e) {
            alert('Delete failed: ' + e.message);
        }
    },

    initMagicButton: () => {
        const btn = document.getElementById('btn-voice-magic');
        if (!btn) return;
        
        const start = (e) => {
            if (!DataService.apiKey) {
                alert('Please add your OpenAI API Key in settings to use AI features.');
                Router.navigate('settings');
                return;
            }
            if(e.cancelable) e.preventDefault();
            app.magicBtnHandlers.isLongPress = false;
            app.magicBtnHandlers.startTime = Date.now();
            app.magicBtnHandlers.timer = setTimeout(() => {
                app.magicBtnHandlers.isLongPress = true;
                if(navigator.vibrate) navigator.vibrate(50);
                btn.classList.add('scale-125', 'ring-4', 'ring-indigo-500', 'animate-pulse');
                app.recordAudio(); 
            }, 300); 
        };

        const end = async (e) => {
            clearTimeout(app.magicBtnHandlers.timer);
            const duration = Date.now() - app.magicBtnHandlers.startTime;
            
            if (app.magicBtnHandlers.isLongPress) {
                 btn.classList.remove('scale-125', 'ring-4', 'ring-indigo-500', 'animate-pulse');
                 const audioBlob = await app.stopRecordingAndTranscribe();
                 if (audioBlob) {
                     UI.toggleLoading(true, 'Transcribing & Analyzing...');
                     try {
                        const results = await DataService.aiMagicVoice(audioBlob);
                        if(results) app.handleMagicResults(Array.isArray(results) ? results : [results]);
                     } catch(e) {
                         console.error(e);
                         if (e.message.includes('Unauthorized') || e.message.includes('INVALID_API_KEY')) {
                             alert('Authentication failed. Please check your API Key in settings or try logging in again.');
                         } else {
                             alert('Voice Error: ' + e.message);
                         }
                     }
                     UI.toggleLoading(false);
                 }
            } else {
                if (duration < 300 && duration > 50) {
                     alert("Hold to speak!");
                }
            }
        };

        btn.addEventListener('mousedown', start);
        btn.addEventListener('touchstart', start, {passive: false});
        btn.addEventListener('mouseup', end);
        btn.addEventListener('touchend', end);
        btn.addEventListener('contextmenu', e => e.preventDefault());
    },

    recordAudio: async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            app.mediaRecorder = new MediaRecorder(stream);
            app.audioChunks = [];
            app.mediaRecorder.ondataavailable = (event) => app.audioChunks.push(event.data);
            app.mediaRecorder.start();
        } catch (e) {
            alert('Microphone access denied');
        }
    },

    stopRecordingAndTranscribe: async () => {
        return new Promise((resolve) => {
            if (!app.mediaRecorder || app.mediaRecorder.state !== 'recording') {
                resolve(null);
                return;
            }
            app.mediaRecorder.onstop = async () => {
                const audioBlob = new Blob(app.audioChunks, { type: 'audio/webm' });
                resolve(audioBlob);
                app.mediaRecorder.stream.getTracks().forEach(track => track.stop());
            };
            app.mediaRecorder.stop();
        });
    },

    startDictation: async (targetId) => {
         // Re-implement dictation logic if needed or just use built-in magic voice
         alert('Use the magic voice button for now!');
    },

    showLogs: async () => {
        const container = document.getElementById('logs-content');
        container.innerHTML = '<p class="text-center text-gray-500">Loading...</p>';
        app.navigate('logs');
        
        try {
            const data = await DataService.getLogs();
            if (!data.logs || data.logs.length === 0) {
                container.innerHTML = '<p class="text-center text-gray-500">No logs found.</p>';
                return;
            }
            
            container.innerHTML = data.logs.map(log => {
                let details = '';
                try {
                    const ctx = JSON.parse(log.context);
                    if (ctx.prompt && ctx.response) {
                        details = `
                            <div class="mt-2 text-xs bg-black/30 p-2 rounded border border-white/10 overflow-x-auto whitespace-pre-wrap font-mono">
                                <strong class="text-indigo-400">Prompt:</strong>\n${ctx.prompt}\n\n<strong class="text-emerald-400">Response:</strong>\n${ctx.response}
                            </div>
                        `;
                    } else {
                        details = `<pre class="mt-2 text-xs bg-black/30 p-2 rounded overflow-x-auto">${JSON.stringify(ctx, null, 2)}</pre>`;
                    }
                } catch (e) {
                    details = `<div class="mt-2 text-xs">${log.context || ''}</div>`;
                }

                return `
                    <div class="bg-dark-800 p-4 rounded-xl border border-dark-700">
                        <div class="flex justify-between items-start mb-2">
                            <span class="text-xs font-bold uppercase text-gray-500">${log.type}</span>
                            <span class="text-[10px] text-gray-600">${log.created_at}</span>
                        </div>
                        <div class="text-sm text-white font-medium">${log.message}</div>
                        ${details}
                    </div>
                `;
            }).join('');
        } catch (e) {
            container.innerHTML = `<p class="text-center text-red-400">Error loading logs: ${e.message}</p>`;
        }
    }
};

// Initialize App
document.addEventListener('DOMContentLoaded', () => {
    app.init();
});
