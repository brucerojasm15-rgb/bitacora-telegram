// rama-cortina-instalable: service worker mínimo, solo para que esta
// página (la "cortina" de docs/index.html) cumpla los requisitos de
// instalabilidad de un navegador (manifest + SW con un fetch handler).
// GitHub Pages ya es estático y nunca se duerme, así que no hace falta
// una estrategia de caché elaborada -- solo un passthrough a la red con
// la propia página como respaldo si alguna vez no hay red al abrir el
// ícono instalado.
const CACHE_NAME = 'zentia-cortina-v1';
const RUTA_BASE = '/bitacora-telegram/';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.add(RUTA_BASE)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return;
  event.respondWith(fetch(event.request).catch(() => caches.match(RUTA_BASE)));
});
