export const utils = {
    formatDate: (date = new Date()) => {
        const pad = (n) => String(n).padStart(2, '0');
        return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + ' ' +
            pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds());
    },
    formatISO: (date = new Date()) => {
        return date.toLocaleString('sv').replace(' ', 'T').substring(0, 16);
    },

    // Get current UTC time in YYYY-MM-DD HH:MM:SS format
    nowUTC: () => {
        return new Date().toISOString().replace('T', ' ').substring(0, 19);
    },

    // Convert Local Date/String -> UTC String (YYYY-MM-DD HH:MM:SS)
    toUTC: (dateOrString) => {
        const d = new Date(dateOrString);
        if (isNaN(d)) return dateOrString;
        const pad = (n) => String(n).padStart(2, '0');
        return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()) + ' ' +
            pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds());
    },

    // Convert UTC String -> Local Date Object
    fromUTC: (utcString) => {
        if (!utcString) return new Date();
        // Ensure string is treated as UTC. 
        // If format is "YYYY-MM-DD HH:MM:SS", appending "Z" usually works for Date.parse
        let s = utcString.replace(' ', 'T');
        if (!s.endsWith('Z')) s += 'Z';
        return new Date(s);
    },

    // Convert UTC String -> Local String for Inputs (YYYY-MM-DDTHH:MM)
    toLocalInput: (utcString) => {
        const d = utils.fromUTC(utcString);
        if (isNaN(d)) return '';
        return utils.formatISO(d);
    },
    
    compressImage: (file, maxWidth = 1024, quality = 0.7) => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = (e) => {
                const img = new Image();
                img.src = e.target.result;
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    let width = img.width;
                    let height = img.height;

                    if (width > maxWidth || height > maxWidth) {
                        const ratio = Math.min(maxWidth / width, maxWidth / height);
                        width *= ratio;
                        height *= ratio;
                    }

                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);
                    resolve(canvas.toDataURL('image/jpeg', quality));
                };
                img.onerror = reject;
            };
            reader.onerror = reject;
        });
    },

    base64ToBlob: (base64) => {
        const parts = base64.split(';base64,');
        const contentType = parts[0].split(':')[1];
        const raw = window.atob(parts[1]);
        const rawLength = raw.length;
        const uInt8Array = new Uint8Array(rawLength);
        for (let i = 0; i < rawLength; ++i) {
            uInt8Array[i] = raw.charCodeAt(i);
        }
        return new Blob([uInt8Array], { type: contentType });
    },

    escapeHtml: (str) => {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    },

    generateAIExport: (entries) => {
        // Sort Chronologically (Oldest First)
        const sorted = [...entries].sort((a, b) => new Date(a.recorded_at) - new Date(b.recorded_at));

        let output = "GUT TRACKER EXPORT (FOR AI ANALYSIS)\n";
        output += "Format: [HH:MM] TYPE [Metrics]: Notes\n";
        output += "=====================================\n";
        output += "LEGEND:\n";
        output += "Stool (Bristol Scale 1-7):\n";
        output += "  1-2: Constipation | 3-4: Normal | 5-7: Diarrhea\n";
        output += "Mood & Sleep Quality (1-5):\n";
        output += "  1: Very Bad/Awful | 5: Excellent/Great\n";
        output += "Activity Intensity: Low, Medium, High\n";
        output += "=====================================\n";

        let currentDay = '';

        sorted.forEach(e => {
            const localDate = utils.fromUTC(e.recorded_at);
            const iso = utils.formatISO(localDate);
            const dateStr = iso.split('T')[0];
            const timeStr = iso.split('T')[1];
            
            if (dateStr !== currentDay) {
                output += `\n# ${dateStr}\n`;
                currentDay = dateStr;
            }
            
            const type = e.type.toUpperCase();
            let metrics = [];
            
            if (e.type === 'drink') {
                if (e.data.amount_liters) metrics.push(`${e.data.amount_liters}L`);
            } else if (e.type === 'stool') {
                if (e.data.bristol_score) metrics.push(`Bristol:${e.data.bristol_score}`);
            } else if (e.type === 'sleep') {
                if (e.data.duration_hours) metrics.push(`${e.data.duration_hours}h`);
                if (e.data.quality) metrics.push(`Qual:${e.data.quality}/5`);
            } else if (e.type === 'feeling' || e.type === 'symptom') {
                const score = e.data.mood_score || e.data.severity;
                if (score) metrics.push(`Mood:${score}/5`);
            } else if (e.type === 'activity') {
                 if (e.data.duration_minutes) metrics.push(`${e.data.duration_minutes}min`);
                 if (e.data.intensity) metrics.push(`${e.data.intensity}`);
            }
            
            let line = `[${timeStr}] ${type}`;
            if (metrics.length > 0) line += ` [${metrics.join(', ')}]`;
            
            if (e.data.notes) {
                line += `: ${e.data.notes}`;
            }
            
            output += line + '\n';
        });
        
        return output;
    }
};
