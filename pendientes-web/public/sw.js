const CACHE_NAME = 'pendientes-static-v1';
const STATIC_ASSETS = [
  '/style.css',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Solo intercepta assets estáticos precacheados. Todo lo demás (/, /pendientes,
  // /pendientes/:id/completar) va directo a la red porque depende de la base de datos.
  if (!STATIC_ASSETS.includes(url.pathname)) return;

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});

self.addEventListener('push', (event) => {
  let datos = { title: 'Bitácora', body: 'Tienes una notificación' };
  if (event.data) {
    try {
      datos = event.data.json();
    } catch (e) {
      datos.body = event.data.text();
    }
  }
  event.waitUntil(
    self.registration.showNotification(datos.title || 'Bitácora', {
      body: datos.body || '',
      icon: '/icons/icon-192.png',
      actions: datos.actions || [],
      data: datos.data || {},
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const datos = event.notification.data || {};
  const url = (event.action && datos.urls && datos.urls[event.action]) || datos.defaultUrl || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((ventanas) => {
      for (const ventana of ventanas) {
        if (ventana.url.startsWith(self.location.origin) && 'focus' in ventana) {
          if ('navigate' in ventana) ventana.navigate(url);
          return ventana.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
