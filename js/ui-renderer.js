import { utils } from './utils.js';

export const UI = {
    renderTimeline: (entries, containerId, highlightId = null) => {
        const container = document.getElementById(containerId);
        if (!container) return;
        
        container.innerHTML = '';
        
        if (!entries || entries.length === 0) {
            container.innerHTML = '<div class="text-center py-10 opacity-50"><div class="text-4xl mb-2">🍃</div><p>No entries yet</p></div>';
            return;
        }

        const todayISO = new Date().toISOString().split('T')[0];
        let currentDayHeader = null;

        entries.forEach((entry) => {
            const dateObj = utils.fromUTC(entry.recorded_at);
            const dayKey = dateObj.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
            // Compare local date strings for "Today" check
            const entryDateISO = utils.formatISO(dateObj).split('T')[0];
            const isToday = entryDateISO === utils.formatISO(new Date()).split('T')[0];

            // Add Day Header
            if (currentDayHeader !== dayKey) {
                currentDayHeader = dayKey;
                const header = document.createElement('div');
                header.className = 'sticky top-0 z-[5] bg-dark-900/80 backdrop-blur-sm py-2 px-1 text-[10px] font-black uppercase tracking-widest text-gray-500 mt-6 first:mt-0';
                header.innerText = isToday ? 'Today' : dayKey;
                container.appendChild(header);
            }

            const el = document.createElement('div');
            let className = 'bg-dark-800 rounded-xl p-4 shadow-lg border border-dark-700 relative overflow-hidden cursor-pointer hover:bg-dark-700 transition-colors mb-4';
            
            if (highlightId && entry.id == highlightId) {
                className += ' new-entry-highlight';
                // Scroll into view after a short delay to ensure DOM is ready
                setTimeout(() => {
                    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }, 100);
            }
            
            el.className = className;
            el.dataset.id = entry.id; // Store ID for click handler
            el.dataset.type = entry.type;

            const timeStr = dateObj.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
            let icon = '', title = '', content = '', imageHtml = ''; 

            if (entry.data && entry.data.image_path) {
                // Sanitize image path to prevent attribute breakout
                const safePath = utils.escapeHtml(entry.data.image_path);
                imageHtml = `<div class="shrink-0"><img src="${safePath}" class="w-16 h-16 rounded-lg object-cover border border-dark-600 bg-dark-900" loading="lazy"></div>`;
            }

            if (entry.type === 'food') {
                icon = '🍎'; title = 'Food';
                if (entry.data.notes) content += `<p class="text-gray-300 mt-1">${utils.escapeHtml(entry.data.notes)}</p>`;
            } else if (entry.type === 'drink') {
                icon = '🥤'; title = 'Drink';
                const amt = entry.data.amount_liters ? `<span class="font-bold text-cyan-400 ml-2">${utils.escapeHtml(String(entry.data.amount_liters))}L</span>` : '';
                if (entry.data.notes) content += `<p class="text-gray-300 mt-1">${utils.escapeHtml(entry.data.notes)}${amt}</p>`;
                else if (entry.data.amount_liters) content += `<p class="text-gray-300 mt-1">${amt}</p>`;
            } else if (entry.type === 'feeling' || entry.type === 'symptom') {
                const isSymptom = entry.type === 'symptom';
                icon = isSymptom ? '⚡' : '✨'; 
                title = isSymptom ? 'Symptom' : 'Mood';
                
                if (entry.data.notes) content += `<p class="text-gray-300 mt-1 font-medium">${utils.escapeHtml(entry.data.notes)}</p>`;
                const sev = entry.data.severity || '?';
                title += ` <span class="text-xs text-secondary ml-2">(${utils.escapeHtml(String(sev))}/5)</span>`;
            } else if (entry.type === 'stool') {
                icon = '💩'; title = `Stool (Type ${utils.escapeHtml(String(entry.data.bristol_score))})`;
                if (entry.data.notes) content += `<p class="text-gray-300 mt-1">${utils.escapeHtml(entry.data.notes)}</p>`;
            } else if (entry.type === 'sleep') {
                icon = '😴'; title = 'Sleep';
                const dur = parseFloat(entry.data.duration_hours).toFixed(1);
                content += `<div class="text-xl font-bold text-white">${utils.escapeHtml(String(dur))}h</div>`;
            } else if (entry.type === 'activity') {
                // Activity
                const intensity = entry.data.intensity || '';
                if (intensity === 'High') icon = '🔥';
                else if (intensity === 'Medium') icon = '🏃';
                else icon = '🧘'; // Low or default
                
                title = `${utils.escapeHtml(intensity)} Activity`;
                
                const dur = entry.data.duration_minutes ? `<span class="font-bold text-emerald-400 ml-2">${utils.escapeHtml(String(entry.data.duration_minutes))}m</span>` : '';
                
                if (entry.data.notes) content += `<p class="text-gray-300 mt-1 font-medium">${utils.escapeHtml(entry.data.notes)}${dur}</p>`;
                else if (entry.data.duration_minutes) content += `<p class="text-gray-300 mt-1">${dur}</p>`;
            }
            
            el.innerHTML = `
            <div class="flex gap-3 pointer-events-none">
                ${imageHtml}
                <div class="flex-1 min-w-0">
                    <div class="flex justify-between items-start mb-1">
                        <div class="flex items-center gap-2"><span>${icon}</span><h3 class="font-bold text-white">${title}</h3></div>
                        <div class="text-xs text-gray-500 text-right shrink-0 ml-2">${timeStr}</div>
                    </div>
                    <div class="text-sm text-gray-300">${content}</div>
                </div>
            </div>`;
            
            // Re-attach specific click listener in controller, but here we set data attr
            container.appendChild(el);
        });
    },

    renderStats: (entries, containerId) => {
        const container = document.getElementById(containerId);
        if (!container) return;
        
        if (!entries || entries.length === 0) {
            container.innerHTML = '<p class="text-center text-gray-500">No data for stats yet.</p>';
            return;
        }

        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const recentEntries = entries.filter(e => new Date(e.recorded_at) >= thirtyDaysAgo);
        
        let totalSleep = 0, sleepCount = 0, totalStools = 0, totalDrinks = 0;
        
        recentEntries.forEach(e => {
            if (e.type === 'sleep') { totalSleep += parseFloat(e.data.duration_hours) || 0; sleepCount++; }
            else if (e.type === 'stool') { totalStools++; }
            else if (e.type === 'drink') { totalDrinks++; }
        });

        const avgSleep = sleepCount ? (totalSleep / sleepCount).toFixed(1) : 0;
        
        container.innerHTML = `<div class="grid grid-cols-3 gap-4">
            <div class="bg-dark-800 p-3 rounded-xl border border-dark-700 text-center"><h3 class="text-gray-400 text-xs uppercase font-bold mb-1">Sleep</h3><p class="text-xl font-bold text-blue-400">${avgSleep}h</p></div>
            <div class="bg-dark-800 p-3 rounded-xl border border-dark-700 text-center"><h3 class="text-gray-400 text-xs uppercase font-bold mb-1">Stools</h3><p class="text-xl font-bold text-emerald-500">${totalStools}</p></div>
            <div class="bg-dark-800 p-3 rounded-xl border border-dark-700 text-center"><h3 class="text-gray-400 text-xs uppercase font-bold mb-1">Drinks</h3><p class="text-xl font-bold text-cyan-400">${totalDrinks}</p></div>
        </div>`;
    },

    renderCharts: (entries) => {
        if (!entries || entries.length === 0) return;

        // Process Data
        const days = {}; // Key: YYYY-MM-DD
        const symptoms = [];

        // Initialize last 30 days
        for (let i = 29; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            const k = d.toISOString().split('T')[0];
            days[k] = { stoolScoreSum: 0, stoolCount: 0, sleepDuration: 0, date: k };
        }

        entries.forEach(e => {
            const localDate = utils.fromUTC(e.recorded_at);
            const k = utils.formatISO(localDate).split('T')[0];
            
            if (!days[k]) return; // Out of range or future

            if (e.type === 'stool') {
                days[k].stoolScoreSum += parseInt(e.data.bristol_score || 0);
                days[k].stoolCount++;
            } else if (e.type === 'sleep') {
                days[k].sleepDuration += parseFloat(e.data.duration_hours || 0);
            } else if (e.type === 'feeling' || e.type === 'symptom') {
                symptoms.push({
                    dateStr: k,
                    y: parseInt(e.data.severity || 1),
                    note: e.data.notes,
                    type: e.type
                });
            }
        });

        const labels = Object.keys(days).sort().map(d => d.slice(5)); // MM-DD
        const stoolData = Object.values(days).sort((a,b) => a.date.localeCompare(b.date))
            .map(d => d.stoolCount ? (d.stoolScoreSum / d.stoolCount).toFixed(1) : null);
        
        const sleepData = Object.values(days).sort((a,b) => a.date.localeCompare(b.date))
            .map(d => d.sleepDuration || null);

        // Ensure chart instances are managed or destroyed if re-rendering
        if (window.appCharts) {
            if(window.appCharts.stoolSleep) window.appCharts.stoolSleep.destroy();
            if(window.appCharts.symptoms) window.appCharts.symptoms.destroy();
        } else {
            window.appCharts = {};
        }

        // Chart 1: Stool & Sleep
        const ctx1 = document.getElementById('chart-stool-sleep')?.getContext('2d');
        if (ctx1) {
            window.appCharts.stoolSleep = new Chart(ctx1, {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [
                        {
                            label: 'Avg Stool Score (1-7)',
                            data: stoolData,
                            borderColor: '#10b981',
                            backgroundColor: '#10b981',
                            type: 'line',
                            yAxisID: 'y',
                            tension: 0.3,
                            spanGaps: true
                        },
                        {
                            label: 'Sleep (Hours)',
                            data: sleepData,
                            backgroundColor: 'rgba(59, 130, 246, 0.5)',
                            yAxisID: 'y1',
                            borderRadius: 4
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: { mode: 'index', intersect: false },
                    scales: {
                        x: { ticks: { color: '#9ca3af' }, grid: { color: '#374151' } },
                        y: { 
                            type: 'linear', display: true, position: 'left', min: 0, max: 8,
                            ticks: { color: '#10b981' }, grid: { color: '#374151' }
                        },
                        y1: { 
                            type: 'linear', display: true, position: 'right', min: 0, max: 12,
                            grid: { drawOnChartArea: false }, ticks: { color: '#60a5fa' }
                        }
                    },
                    plugins: {
                        legend: { labels: { color: '#d1d5db' } }
                    }
                }
            });
        }

        // Chart 2: Symptoms
        const ctx2 = document.getElementById('chart-symptoms')?.getContext('2d');
        if (ctx2) {
            // Map symptoms to day indices
            const symptomData = symptoms.map(s => {
                const dayKey = s.dateStr.slice(5); // MM-DD
                const index = labels.indexOf(dayKey);
                return index !== -1 ? {
                    x: index,
                    y: s.y,
                    r: s.y * 3,
                    _note: s.note // Custom prop for tooltip
                } : null;
            }).filter(s => s !== null);

            window.appCharts.symptoms = new Chart(ctx2, {
                type: 'bubble',
                data: {
                    labels: labels, // Shared labels
                    datasets: [{
                        label: 'Symptoms',
                        data: symptomData,
                        backgroundColor: 'rgba(248, 113, 113, 0.7)',
                        borderColor: 'rgba(248, 113, 113, 1)'
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        x: { 
                            type: 'category', // Use category axis
                            labels: labels,
                            ticks: { color: '#9ca3af', maxTicksLimit: 10 }, 
                            grid: { color: '#374151' } 
                        },
                        y: { 
                            min: 0, max: 6, 
                            ticks: { stepSize: 1, color: '#f87171' }, 
                            grid: { color: '#374151' },
                            title: { display: true, text: 'Score (1-5)', color: '#9ca3af' }
                        }
                    },
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            callbacks: {
                                label: (ctx) => {
                                    const raw = ctx.raw;
                                    return `${raw._note} (${raw.y})`;
                                }
                            }
                        }
                    }
                }
            });
        }
    },

    toggleLoading: (show, text = 'Processing...') => {
        const overlay = document.getElementById('loading-overlay');
        const msg = document.getElementById('loading-text');
        if (overlay && msg) {
            if (show) {
                msg.innerText = text;
                overlay.classList.remove('hidden');
            } else {
                overlay.classList.add('hidden');
            }
        }
    }
};
