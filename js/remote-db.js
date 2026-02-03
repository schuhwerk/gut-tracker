export const RemoteDB = {
    getEntries: async (limit = 50) => {
        const res = await fetch(`api.php?endpoint=entries&limit=${limit}&t=${Date.now()}`, { credentials: 'include' });
        if (!res.ok) throw new Error('API Error');
        return await res.json();
    },

    getEntry: async (id) => {
        const res = await fetch(`api.php?endpoint=entries&id=${id}`, { credentials: 'include' });
        if (!res.ok) throw new Error('API Error');
        return await res.json();
    },

    saveEntry: async (entry, imageBlob = null) => {
        const formData = new FormData();
        formData.append('type', entry.type);
        formData.append('event_at', entry.event_at);
        formData.append('data', JSON.stringify(entry.data));
        
        if (entry.id && !String(entry.id).startsWith('local_')) {
            formData.append('id', entry.id);
        }
        
        if (imageBlob) {
            formData.append('image', imageBlob);
        } else if (entry.image_blob) { // Support passing blob in entry object too
             formData.append('image', entry.image_blob);
        }

        const res = await fetch('api.php?endpoint=entry', {
            method: 'POST',
            body: formData,
            credentials: 'include'
        });
        
        if (!res.ok) throw new Error('API Save Failed');
        return await res.json();
    },

    deleteEntry: async (id) => {
        const res = await fetch('api.php?endpoint=delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id }),
            credentials: 'include'
        });
        if (!res.ok) throw new Error('API Delete Failed');
        return await res.json();
    },

    deleteAll: async () => {
        const res = await fetch('api.php?endpoint=delete_all', { method: 'POST', credentials: 'include' });
        if (!res.ok) throw new Error('API Delete All Failed');
        return await res.json();
    },
};
