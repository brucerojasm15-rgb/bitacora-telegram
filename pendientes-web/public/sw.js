// rama-pwa-instalable: v2 del cache -- agrega favicon.svg (no estaba,
// quedó afuera cuando se creó en el rediseño visual) y OFFLINE_URL, una
// página mínima cacheada para cuando una navegación falla por completo
// sin red (no cachea /, /pendientes, etc. -- esas siguen yendo siempre a
// la red porque dependen de la sesión y la DB, esto es solo el "no tengo
// internet" en vez de que el navegador muestre su propio error genérico).
// rama-fix-sw-cache: v3 -- causa raíz real de "el nav se ve roto en el
// celular" en las 2 rondas anteriores (rama-nav-rediseno Y
// rama-inicio-planta): NO era un problema de CSS/navegador, era este
// service worker sirviendo un `/style.css` cacheado desde antes de esos
// cambios, para siempre, porque el fetch handler de abajo era
// cache-first puro (`cached || fetch(...)`) -- una vez que `/style.css`
// entraba al cache la primera vez, nunca se volvía a pedir a la red
// salvo que cambiara este archivo sw.js (lo que dispara un `install`
// nuevo). Como el HTML de cada página SÍ va siempre a la red (ver el
// bloque de navegaciones más abajo, sin cambios), el resultado era HTML
// nuevo + CSS viejo -- exactamente la mezcla rota que se vio en el
// celular real (barra superior sin el layout nuevo, `.menu-pantalla`
// sin ningún estilo, como texto plano). Se cambia la estrategia de
// `STATIC_ASSETS` a network-first-con-fallback-a-cache (ver el fetch
// handler) para que esto no se repita en el futuro con cualquier cambio
// de CSS -- y se bumpea el nombre acá para forzar un `install` limpio
// una vez en los dispositivos que ya tenían la v2 cacheada.
const CACHE_NAME = 'pendientes-static-v3';
const OFFLINE_URL = '/offline.html';
const STATIC_ASSETS = [
  '/style.css',
  '/manifest.json',
  '/favicon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  OFFLINE_URL,
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

  // Navegaciones (cargar una página, no un asset): siempre a la red primero
  // -- dependen de sesión/DB, nunca servir una versión vieja cacheada. Si la
  // red falla del todo (sin internet), mostrar la página offline en vez del
  // error genérico del navegador.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(OFFLINE_URL))
    );
    return;
  }

  // Solo intercepta assets estáticos precacheados. Todo lo demás (/pendientes,
  // /pendientes/:id/completar, etc.) va directo a la red porque depende de la base de datos.
  if (!STATIC_ASSETS.includes(url.pathname)) return;

  // rama-fix-sw-cache: network-first (no cache-first) -- misma prioridad
  // que ya se le da a las navegaciones arriba ("nunca servir una versión
  // vieja cacheada" si hay red). Se pide a la red primero y se actualiza
  // el cache con la respuesta fresca; el cache solo se usa como
  // respaldo si la red falla del todo (sin internet). Así un cambio de
  // `/style.css` en un deploy nuevo se ve de inmediato en la próxima
  // carga con red, sin depender de que cambie este archivo sw.js.
  event.respondWith(
    fetch(event.request)
      .then((respuesta) => {
        const copia = respuesta.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copia));
        return respuesta;
      })
      .catch(() => caches.match(event.request))
  );
});

self.addEventListener('push', (event) => {
  let datos = { title: 'zentIA', body: 'Tienes una notificación' };
  if (event.data) {
    try {
      datos = event.data.json();
    } catch (e) {
      datos.body = event.data.text();
    }
  }
  // rama-metas-rutinarias: requireInteraction/vibrate llegaban en el
  // payload desde hace rato pero se ignoraban acá -- ahora sí se
  // reenvían si el servidor los manda (opt-in por payload, no todas las
  // notificaciones necesitan ser "llamativas").
  event.waitUntil(
    self.registration.showNotification(datos.title || 'zentIA', {
      body: datos.body || '',
      icon: '/icons/icon-192.png',
      actions: datos.actions || [],
      data: datos.data || {},
      requireInteraction: datos.requireInteraction || false,
      vibrate: datos.vibrate || undefined,
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
