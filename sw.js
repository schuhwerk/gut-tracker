const CACHE_NAME = 'gut-tracker-v14';
const ASSETS_TO_CACHE = [
    './',
    'index.html',
    'style.css',
    'manifest.json',
    'icons/icon.svg',
    'js/app.js',
    'js/utils.js',
    'js/router.js',
    'js/data-service.js',
    'js/idb-store.js',
    'js/ui-renderer.js'
];

// On install, fetch everything fresh from the network
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return Promise.all(
                ASSETS_TO_CACHE.map((url) => {
                    return fetch(url, { cache: 'reload' }).then((response) => {
                        if (response.ok) return cache.put(url, response);
                        throw new Error(`Failed to fetch ${url}`);
                    });
                })
            );
        })
    );
});

self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // 1. API & POST requests: Always Network Only
    if (url.pathname.includes('api.php') || event.request.method !== 'GET') {
        event.respondWith(fetch(event.request));
        return;
    }

    // 2. Main App Files: Network First, then Cache
    // This ensures that if you're online, you ALWAYS get the latest code.
    if (ASSETS_TO_CACHE.some(path => url.pathname.endsWith(path.replace('./', '')))) {
        event.respondWith(
            fetch(event.request)
                .then((response) => {
                    // Update cache while we're at it
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                    return response;
                })
                .catch(() => caches.match(event.request))
        );
        return;
    }

    // 3. Images/Other Assets: Cache First
    event.respondWith(
        caches.match(event.request).then((response) => {
            return response || fetch(event.request);
        })
    );
});