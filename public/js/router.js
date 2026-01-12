export const Router = {
    init: () => {
        window.addEventListener('hashchange', Router.handleRoute);
        Router.handleRoute(); // Initial load
    },

    navigate: (viewId, skipHistory = false) => {
        if (!skipHistory && window.location.hash !== '#' + viewId) {
            window.location.hash = viewId;
            return;
        }
        Router.showView(viewId);
    },

    showView: (viewId) => {
        // Handle virtual 'edit-' routes by delegating to controller (app.js)
        if (viewId.startsWith('edit-')) {
            window.dispatchEvent(new CustomEvent('route-changed', { detail: { view: viewId } }));
            return;
        }

        const view = document.getElementById(`view-${viewId}`);
        if (!view) {
            // console.warn('View not found:', viewId);
            return;
        }

        document.querySelectorAll('.view').forEach(el => el.classList.add('hidden'));
        view.classList.remove('hidden');

        // Dispatch event for controllers to react
        window.dispatchEvent(new CustomEvent('route-changed', { detail: { view: viewId } }));
    },
    
    handleRoute: () => {
        const viewId = window.location.hash.substring(1) || 'dashboard'; // Default to dashboard if auth? Controller decides.
        Router.showView(viewId);
    }
};
