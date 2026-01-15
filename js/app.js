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

        // Initialize Data Service (Auth Check)
        await DataService.init();

        // Routing & Auth
        window.addEventListener('route-changed', (e) => app.onRouteChanged(e.detail.view));
        
        // Initial Route Decision
        const currentHash = window.location.hash.substring(1);
        
        // If we are in Hybrid mode but not authenticated (checked inside DataService init implicitly via api key check? No, DataService.init just checks mode)
        // We need a proper Auth check.
        // If LOCAL mode, we assume "logged in" if we can read DB.
        
        if (DataService.mode === 'HYBRID') {
             // We need to know if we are logged in. 
             // DataService.init already tried check_auth.
             // If check_auth failed, we might be logged out.
             // But DataService.init sets mode=LOCAL if check_auth fails due to connection.
             // If check_auth returns {authenticated: false}, mode is still HYBRID.
             
             // Let's refine DataService init return or check state.
             // For now, let's just try to load entries. If 401, redirect.
        }

        Router.init();

        // Setup UI Listeners
        app.setupListeners();
        app.setupForms();
        app.initMagicButton();
        
        // Check if we need to login
        if (DataService.mode === 'HYBRID') {
            try {
                const res = await fetch('api.php?endpoint=check_auth');
                const auth = await res.json();
                if (auth.authenticated) {
                    DataService.isAuthenticated = true;
                    // Check for unsynced local entries
                    await app.checkPendingUploads();
                    
                    if (!currentHash || currentHash === 'login') await app.checkDraftsAndNavigate();
                } else {
                    DataService.isAuthenticated = false;
                    if (!currentHash) Router.navigate('dashboard');
                }
            } catch (e) {
                if (DataService.mode === 'LOCAL' && (!currentHash || currentHash === 'login')) {
                    await app.checkDraftsAndNavigate();
                }
            }
        } else {
            if (!currentHash || currentHash === 'login') await app.checkDraftsAndNavigate();
        }
    },

    checkDraftsAndNavigate: async () => {
        const drafts = await DataService.getDrafts();
        if (drafts.length > 0) {
            Router.navigate('magic-input');
        } else {
            Router.navigate('dashboard');
        }
    },

    checkPendingUploads: async () => {
        // Only run if we are authenticated
        if (!DataService.isAuthenticated) return;
        
        const unsynced = await DataService.getPendingUploads();
        if (unsynced && unsynced.length > 0) {

            return; // @todo this needs more work and needs to be implemented properly. 

            // Filter out entries that might already belong to this user if we could detect that easily,
            // but for now we assume all unsynced local entries are candidates.
            // We should show a nice summary.
            const stats = unsynced.reduce((acc, curr) => {
                acc[curr.type] = (acc[curr.type] || 0) + 1;
                return acc;
            }, {});
            
            const summary = Object.entries(stats)
                .map(([type, count]) => `${count} ${type.charAt(0).toUpperCase() + type.slice(1)}`)
                .join(', ');

            const msg = `Found ${unsynced.length} local entries that are not in your account:\n${summary}\n\nDo you want to upload them now?`;
            if (confirm(msg)) {
                UI.toggleLoading(true, 'Syncing local entries...');
                try {
                    const count = await DataService.uploadEntries(unsynced);
                    alert(`Successfully synced ${count} entries.`);
                } catch (e) {
                    alert('Sync had errors: ' + e.message);
                } finally {
                    UI.toggleLoading(false);
                }
            }
        }
    },

    onRouteChanged: async (viewId) => {
        if (viewId.startsWith('edit-')) {
            const id = viewId.split('-')[1];
            try {
                const entry = await DataService.getEntry(id);
                if (entry) {
                    // Show the correct form view without resolving route hash (since hash is #edit-ID)
                    // We use Router.showView but need to bypass the 'edit-' check? 
                    // No, Router.showView('add-food') works fine.
                    // But it dispatches 'route-changed' -> 'add-food'.
                    // So we trigger 'prepareAddView' which resets form.
                    // Then we populate.
                    
                    Router.showView(`add-${entry.type}`); 
                    // Note: showView dispatches event synchronously, so prepareAddView runs NOW.
                    
                    // Now populate
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
            
            // Welcome Box Logic
            const welcomeBox = document.getElementById('welcome-box');
            if (welcomeBox && !localStorage.getItem('welcomeBoxDismissed')) {
                welcomeBox.classList.remove('hidden');
            }

            // Status Box Logic (Offline or Unauth)
            app.updateStatusBox();
            
            // Beta Warning Logic
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
            document.getElementById('api-key').value = DataService.apiKey || '';
            const logoutBtn = document.getElementById('btn-logout');
            const loginBtn = document.getElementById('btn-login-settings');
            const profileSync = document.getElementById('profile-sync-section');
            if (DataService.isAuthenticated) {
                if(logoutBtn) logoutBtn.classList.remove('hidden');
                if(loginBtn) loginBtn.classList.add('hidden');
                if(profileSync) profileSync.classList.remove('hidden');
            } else {
                if(logoutBtn) logoutBtn.classList.add('hidden');
                if(loginBtn) loginBtn.classList.remove('hidden');
                if(profileSync) profileSync.classList.add('hidden');
            }
        }
    },

    logout: async () => {
        if (!confirm('Logout?')) return;
        try {
            await fetch('api.php?endpoint=logout', { method: 'POST' });
            DataService.isAuthenticated = false;
            // Optionally clear some local state, but keep data in IDB
            window.location.reload(); // Simplest way to reset app state
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
        
        // Hydration & Reminder Logic
        const now = new Date();
        const todayISO = utils.formatISO(now).split('T')[0]; // Local YYYY-MM-DD
        
        let waterToday = 0;
        let hasFeelingLog = false;

        entries.forEach(e => {
            const localDate = utils.fromUTC(e.recorded_at);
            const dateStr = utils.formatISO(localDate).split('T')[0]; // Local YYYY-MM-DD
            
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
             // Only show reminder if past 15:00
             if (now.getHours() >= 15 && !hasFeelingLog) dot.classList.remove('hidden');
             else dot.classList.add('hidden');
        }
        
        UI.renderTimeline(entries, 'timeline', app.lastSavedId);
        if (app.lastSavedId) app.lastSavedId = null;
        
        // Attach click handlers for editing
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
            // Create clone with current time
            const newEntry = {
                ...originalEntry,
                id: null,
                recorded_at: utils.toUTC(new Date()),
                created_at: utils.toUTC(new Date()),
                synced: 0 // Ensure it's treated as new
            };
            
            // If original was a draft, make sure new one isn't (or is?)
            // Usually we want to verify real entries.
            if (newEntry.data && newEntry.data.is_draft) {
                delete newEntry.data.is_draft;
            }

            const result = await DataService.saveEntry(newEntry);
            
            app.lastSavedId = result.id;
            app.loadEntries(); // Refresh
            
            app.showUndoToast('Entry re-added', async () => {
                await DataService.deleteEntry(result.id);
                app.loadEntries();
            });

        } catch (e) {
            alert('Failed to re-add: ' + e.message);
        }
    },

    prepareAddView: (viewId) => {
        // Handle legacy symptom redirect if needed
        let type = viewId.replace('add-', '');
        if (type === 'symptom') type = 'feeling';
        
        const formId = `form-${type}`;
        app.resetForm(formId);
        
        const title = document.getElementById(`title-${type}`);
        if (title) title.innerText = `Add ${type.charAt(0).toUpperCase() + type.slice(1)}`;
        
        const deleteBtn = document.querySelector(`#view-${viewId} .btn-delete`);
        if (deleteBtn) deleteBtn.classList.add('hidden');
        
        const timeInput = document.querySelector(`#${formId} input[name="recorded_at"]`);
        if (timeInput) timeInput.value = utils.formatISO();
        
        if (viewId === 'add-sleep') {
             const bedInput = document.querySelector(`#${formId} input[name="bedtime"]`);
             if (bedInput) bedInput.value = utils.formatISO(new Date(Date.now() - 8*3600*1000));
        }
        
        const btn = document.querySelector(`#${formId} .save-btn`);
        if (btn) btn.textContent = 'Save ' + type.charAt(0).toUpperCase() + type.slice(1);

        // Reset Type Selector
        const typeSelector = document.querySelector(`#${formId} .type-switcher`);
        if (typeSelector) typeSelector.value = type;
    },

    editEntry: (entry) => {
        if (entry.id) {
            Router.navigate(`edit-${entry.id}`);
        } else {
            // Fallback (rare)
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
        const recorded_at_local = formData.get('recorded_at');
        const notes = formData.get('notes');
        
        const entry = {
            id: id ? Number(id) : null,
            type: newType,
            // populateEntry expects UTC. input is Local.
            recorded_at: recorded_at_local ? utils.toUTC(recorded_at_local) : new Date().toISOString().replace('T', ' ').substring(0, 19),
            data: { notes: notes }
        };

        // Preserve Image Path from Preview if exists
        const imgPreview = currentForm.querySelector('.current-image-preview img');
        if (imgPreview) {
            entry.data.image_path = imgPreview.getAttribute('src');
        }

        // Switch View
        Router.showView(`add-${newType}`);
        app.prepareAddView(`add-${newType}`);
        app.populateEntry(entry);
    },

    populateEntry: (entry) => {
        let type = entry.type;
        // Map legacy symptom to feeling
        if (type === 'symptom') type = 'feeling';

        const viewId = `add-${type}`;
        const formId = `form-${type}`;
        
        // Ensure we are on the right view (in case we came from legacy link)
        if (entry.type === 'symptom') {
             // UI might have opened 'add-symptom' but Router should handle mapping or we ensure view is correct
             document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
             document.getElementById('view-' + viewId)?.classList.remove('hidden');
        }

        const form = document.getElementById(formId);
        if (!form) return;

        // Set Type Selector
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
        // If it's a draft, say "Add" instead of "Update", even though it technically has an ID.
        if (btn) {
            if (entry.data && entry.data.is_draft) {
                btn.textContent = 'Add ' + type.charAt(0).toUpperCase() + type.slice(1);
            } else {
                btn.textContent = entry.id ? 'Update' : 'Save ' + type.charAt(0).toUpperCase() + type.slice(1);
            }
        }

        // Populate fields
        const timeInput = form.querySelector('input[name="recorded_at"]');
        if (timeInput) {
            timeInput.value = utils.toLocalInput(entry.recorded_at);
        }
        
        if (entry.data.notes) {
            const el = form.querySelector('textarea[name="notes"]') || form.querySelector(`#${type}-notes`);
            if(el) el.value = entry.data.notes;
        }

        // Type specific
        if (type === 'stool') {
            const s = entry.data.bristol_score;
            form.querySelector('input[name="bristol_score"]').value = s || 4;
            // Update selector UI
            form.querySelectorAll('.bristol-selector button').forEach(b => b.classList.remove('selected'));
            const b = form.querySelector(`.bristol-selector button[data-val="${s}"]`);
            if(b) b.classList.add('selected');
        } else if (type === 'drink') {
            form.querySelector('input[name="amount_liters"]').value = entry.data.amount_liters || '';
        } else if (type === 'feeling' || type === 'symptom') {
            const val = entry.data.severity || 3;
            const input = form.querySelector('input[name="severity"]');
            if (input) {
                input.value = val;
                const output = input.parentElement.querySelector('output');
                if (output) output.value = val;
            }
            // Notes field might be feeling-notes or notes
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
            
            // Trigger click on correct button
            if (val) {
                const b = form.querySelector(`.intensity-selector button[data-val="${val}"]`);
                if(b) b.click();
            }
            if (entry.data.notes) {
                const el = form.querySelector('textarea[name="notes"]');
                if(el) el.value = entry.data.notes;
            }
        }

        // Show image if assigned (any type)
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
        
        // Reset intensity buttons
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
                recorded_at: utils.toUTC(formData.get('recorded_at')),
                data: {},
                image_blob: null
            };

            if (entry.id) {
                try {
                    const existing = await DataService.getEntry(entry.id);
                    if (existing) {
                        // Merge existing properties (preserve created_at, user_id, synced, etc.)
                        entry = { 
                            ...existing, 
                            ...entry, 
                            data: { ...existing.data, ...entry.data } 
                        };
                    }
                } catch(e) { console.warn('Failed to fetch existing for merge', e); }
            }
            
            // Extract data
            if (type === 'stool') {
                entry.data.bristol_score = formData.get('bristol_score');
                entry.data.notes = formData.get('notes');
            } else if (type === 'sleep') {
                const bedLocal = formData.get('bedtime');
                entry.data.bedtime = utils.toUTC(bedLocal);
                entry.data.quality = formData.get('quality');
                
                // Calculate duration using Local times (easier diff)
                const wakeDate = new Date(formData.get('recorded_at'));
                const bedDate = new Date(bedLocal);
                entry.data.duration_hours = (wakeDate > bedDate) ? ((wakeDate - bedDate) / 3600000).toFixed(1) : 0;
            } else if (type === 'feeling') {
                 entry.data.notes = formData.get('notes');
                 entry.data.severity = formData.get('severity');
            } else if (type === 'drink') {
                 entry.data.notes = formData.get('notes');
                 entry.data.amount_liters = formData.get('amount_liters');
            } else if (type === 'food') {
                 entry.data.notes = formData.get('notes');
                 const fileInput = form.querySelector('input[name="image"]');
                 if (fileInput && fileInput.files[0]) {
                     entry.image_blob = fileInput.files[0]; // Passed to DataService
                 }
            } else if (type === 'activity') {
                entry.data.notes = formData.get('notes');
                entry.data.duration_minutes = formData.get('duration_minutes');
                entry.data.intensity = formData.get('intensity');
            }

            // Handle Image Removal
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
                    // Check if we still have drafts
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
        
        // Login & Create User
        const loginForm = document.getElementById('login-form');
        if(loginForm) {
            loginForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const fd = new FormData(loginForm);
                try {
                    const res = await fetch('api.php?endpoint=login', { method: 'POST', body: fd });
                    const data = await res.json();
                    if(data.user_id) {
                         // Force Hybrid check
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
         // Bristol Selector
         document.querySelectorAll('.bristol-selector button').forEach(btn => {
             btn.addEventListener('click', (e) => {
                 const target = e.target.closest('button');
                 const p = target.parentElement;
                 p.querySelectorAll('button').forEach(b => b.classList.remove('selected'));
                 target.classList.add('selected');
                 p.nextElementSibling.value = target.dataset.val;
             });
         });
         
         // Activity Intensity Selector
         document.querySelectorAll('.intensity-selector button').forEach(btn => {
             btn.addEventListener('click', (e) => {
                 const target = e.target.closest('button');
                 const p = target.parentElement;
                 p.querySelectorAll('button').forEach(b => b.classList.remove('bg-emerald-600', 'bg-dark-800', 'border-emerald-500'));
                 // Reset all to default style
                 p.querySelectorAll('button').forEach(b => {
                     b.classList.add('bg-dark-800');
                     b.classList.remove('bg-emerald-600', 'text-white');
                     b.querySelector('.text-gray-400')?.classList.remove('text-white');
                 });
                 
                 // Apply active style
                 target.classList.remove('bg-dark-800');
                 target.classList.add('bg-emerald-600', 'text-white');
                 target.querySelector('.font-bold')?.classList.remove('text-gray-400');
                 target.querySelector('.font-bold')?.classList.add('text-white');
                 
                 p.nextElementSibling.value = target.dataset.val;
             });
         });
         
         // Global Keys
         document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.key === 'Enter') {
                const form = document.activeElement?.closest('form');
                if (form) form.requestSubmit();
            }
         });
         
         // Helper function for global access (for onclicks in HTML)
         window.app = app;
    },

    // Magic Features
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
            
            // Show preview immediately
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

        // Attach image to all results if provided
        if (imageBlob) {
            results.forEach(r => {
                r.image_blob = imageBlob;
            });
        }

        // Single result auto-save logic is good, but user wants editing flexibility.
        // If we make everything a draft, the user can choose to edit or ignore.
        // However, auto-saving exact matches is a nice feature.
        // We will stick to: 
        // 1. Single result -> Save normally (unless user changed preference, but no pref setting exists).
        // 2. Multiple -> Save as drafts and show list.
        
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
            // If we are on magic-input view but no drafts, redirect to dashboard
            container.innerHTML = '<p class="text-center text-gray-500 py-4">No pending items.</p>';
            Router.navigate('dashboard');
            return;
        }

        app.pendingDrafts.forEach((entry, index) => {
            const div = document.createElement('div');
            div.className = 'bg-dark-800 rounded-xl p-4 shadow-lg border border-dark-700 relative overflow-hidden mb-4';
            
            // Logic adapted from UI.renderTimeline
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
                const sev = entry.data.severity || '?';
                title += ` <span class="text-xs text-emerald-400 ml-2">Sc: ${sev}</span>`;
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
                       <div class="text-xs text-gray-500 mt-2">Recorded at: ${utils.fromUTC(entry.recorded_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</div>
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
            // Remove is_draft and save
            if(entry.data) delete entry.data.is_draft;
            const result = await DataService.saveEntry(entry);
            app.lastSavedId = result.id;
            
            // If saving magically, we might want to go to dashboard or stay?
            // "Add" usually means "Done".
            // Implementation: Remove from list. If list empty, go dashboard.
            // But current impl calls app.renderMagicList().
            // If we want to highlight, we should probably go to dashboard for that item?
            // The user clicked "Add" on a magic item.
            // If we stay on magic list, highlighting doesn't happen on dashboard.
            // If we navigate to dashboard, we see it highlighted.
            
            // Let's modify behavior: Remove from draft list locally, check if more exist.
            
            // But wait, renderMagicList re-fetches drafts.
            // The saved entry is no longer a draft.
            // So if we call renderMagicList(), it acts correctly for remaining drafts.
            // But if user wants to see the added item, they might expect to go to dashboard?
            // The "saveMagicEntry" function currently just refreshes the list.
            // Let's leave it as is, but if we navigate to dashboard later, `lastSavedId` will be set to the LAST saved one.
            // If user adds 3 items, the last one will be highlighted if they go to dashboard.
            // That's acceptable.
            
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

        // Configure Content
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
            
            // Blink icon
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

        // Show icon if ANY relevant alert is dismissed
        if (betaDismissed || (type && statusDismissed)) {
            icon.classList.remove('hidden');
            
            // Trigger animation if not already settled
            if (!icon.dataset.settled) {
                icon.classList.add('text-orange-400', 'animate-pulse');
                icon.dataset.settled = "true";
                
                setTimeout(() => {
                    icon.classList.remove('text-orange-400', 'animate-pulse');
                }, 3000); // Fade out after 3s
            }
        } else {
            icon.classList.add('hidden');
            delete icon.dataset.settled;
            icon.classList.remove('text-orange-400', 'animate-pulse');
        }
    },

    showAllAlerts: () => {
        // Clear dismiss flags
        localStorage.removeItem('betaWarningDismissed');
        const type = app.getStatusType();
        if(type) localStorage.removeItem(`statusDismissed_${type}`);
        
        // Update UI
        app.checkBetaWarning();
        app.updateStatusBox();
    },

    showStatusBox: () => {
        // Legacy/Fallback - redirects to showAll now
        app.showAllAlerts();
    },

    deleteEntry: async (formId) => {
         const form = document.getElementById(formId);
         const idVal = form.querySelector('input[name="id"]').value;
         if(!idVal) return;
         const id = Number(idVal);

         // Optimistic UI Update
         app.pendingDeletions.add(id);
         app.resetForm(formId);
         Router.navigate('dashboard'); // This will trigger loadEntries, which filters out the ID

         let committed = false;
         const timeoutId = setTimeout(async () => {
             committed = true;
             app.pendingDeletions.delete(id);
             await DataService.deleteEntry(id);
         }, 5000);

         app.showUndoToast('Entry deleted', () => {
             if (committed) return; // Too late
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
        const key = document.getElementById('api-key').value.trim();
        if(!key) return alert('Enter a key first');
        try {
            const res = await fetch('api.php?endpoint=update_settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ api_key: key })
            });
            const data = await res.json();
            if(data.error) throw new Error(data.error);
            alert('Key synced to profile');
        } catch(e) { alert('Sync failed: ' + e.message); }
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
        // Fetch all entries (limit 5000 should cover most users for now)
        const entries = await DataService.getEntries(5000);
        
        // Sort Chronologically (Oldest First) for causality analysis
        entries.sort((a, b) => new Date(a.recorded_at) - new Date(b.recorded_at));

        let output = "GUT TRACKER EXPORT (AI OPTIMIZED)\n";
        output += "Format: [Timestamp] TYPE - Details\n";
        output += "=====================================\n\n";

        entries.forEach(e => {
            const date = new Date(e.recorded_at);
            // Format: YYYY-MM-DD HH:MM
            const timeStr = date.toISOString().replace('T', ' ').substring(0, 16);
            const type = e.type.toUpperCase();
            
            output += `[${timeStr}] ${type}\n`;
            
            if (e.data.notes) {
                output += `  Notes: ${e.data.notes}\n`;
            }

            if (e.type === 'food') {
                // Notes already handled
            } else if (e.type === 'drink') {
                if (e.data.amount_liters) output += `  Amount: ${e.data.amount_liters}L\n`;
            } else if (e.type === 'stool') {
                if (e.data.bristol_score) output += `  Bristol Scale: ${e.data.bristol_score}\n`;
            } else if (e.type === 'sleep') {
                if (e.data.quality) output += `  Quality: ${e.data.quality}/5\n`;
                if (e.data.duration_hours) output += `  Duration: ${e.data.duration_hours}h\n`;
                if (e.data.bedtime) {
                    const bed = new Date(e.data.bedtime).toISOString().replace('T', ' ').substring(0, 16);
                    output += `  Bedtime: ${bed}\n`;
                }
            } else if (e.type === 'feeling' || e.type === 'symptom') {
                if (e.data.severity) output += `  Severity: ${e.data.severity}/5\n`;
            } else if (e.type === 'activity') {
                 if (e.data.duration_minutes) output += `  Duration: ${e.data.duration_minutes} min\n`;
                 if (e.data.intensity) output += `  Intensity: ${e.data.intensity}\n`;
            }
            
            output += "\n";
        });

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

    saveLocalSettings: async () => {
         const key = document.getElementById('api-key').value.trim();
         await DataService.setApiKey(key);
         alert('Saved locally');
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

    loadStats: async () => {
         const entries = await DataService.getEntries(300);
         UI.renderStats(entries, 'stats-content');
    },

    loadDiagram: async () => {
         // Fetch enough entries for 30 days. 
         // Strategy: Get last ~300 entries and let UI filter by date, 
         // or if we had a date-range API, use that.
         // DataService.getEntries defaults to limit 50, so we need more.
         // Since we don't have date filtering in getEntries(limit) in IDB/API explicitly exposed here simply,
         // we fetch a larger chunk.
         const entries = await DataService.getEntries(300);
         UI.renderCharts(entries);
    },

    navigate: (viewId) => {
        Router.navigate(viewId);
    }
};

document.addEventListener('DOMContentLoaded', app.init);
