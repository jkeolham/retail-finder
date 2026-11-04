// sw.js - Service Worker for Retail PWA (v7: 4 Convenience Stores Integration)
const CACHE_NAME = 'retail-pwa-v7';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './app.js',
  './manifest.json',
  './icons/icon.svg'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS_TO_CACHE))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  // MCP API 요청이나 외부 API는 캐시하지 않고 항상 네트워크로 통신
  if (e.request.url.includes('mcp.aka.page') || e.request.url.includes('openstreetmap.org') || e.request.method !== 'GET') {
    return;
  }

  // Network-First 전략: 항상 서버에서 최신 버전을 먼저 가져오고, 오프라인일 때만 캐시 사용
  e.respondWith(
    fetch(e.request)
      .then((networkRes) => {
        if (networkRes && networkRes.status === 200) {
          const resClone = networkRes.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, resClone));
        }
        return networkRes;
      })
      .catch(() => caches.match(e.request))
  );
});
