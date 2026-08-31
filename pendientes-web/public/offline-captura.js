// rama-captura-offline: cola local de capturas hechas sin conexión.
// Alcance confirmado con el usuario: SOLO /captura (el "bloc de notas") --
// el resto de la app sigue necesitando internet como siempre. Se guarda en
// localStorage, no IndexedDB, mismo criterio que rama-login-lockscreen
// (consistencia con el resto de la app + el volumen esperado, unos pocos
// textos cortos mientras no hay señal, es trivial para ese límite).
//
// Este archivo se carga en TODAS las páginas (ver partials/scripts.ejs)
// para que la sincronización dispare sola en cuanto vuelve la señal, sin
// importar en qué página de la app esté el usuario en ese momento -- no
// solo si vuelve a abrir /captura.
(function () {
  const CLAVE = 'zentia_captura_offline_v1';
  let sincronizando = false;

  function leerCola() {
    try {
      const cruda = localStorage.getItem(CLAVE);
      const cola = cruda ? JSON.parse(cruda) : [];
      return Array.isArray(cola) ? cola : [];
    } catch (err) {
      return [];
    }
  }

  function guardarCola(cola) {
    try {
      localStorage.setItem(CLAVE, JSON.stringify(cola));
    } catch (err) {
      // Cuota llena / almacenamiento bloqueado (navegación privada) -- no
      // hay mucho más que hacer acá, nunca debe romper la página.
    }
  }

  function encolarCaptura({ texto, tipo, cuando }) {
    const cola = leerCola();
    cola.push({
      id: Date.now() + '-' + Math.random().toString(36).slice(2),
      texto,
      tipo,
      cuando: cuando || null,
    });
    guardarCola(cola);
    return cola.length;
  }

  function contarPendientes() {
    return leerCola().length;
  }

  async function sincronizar() {
    if (sincronizando || !navigator.onLine) return;
    sincronizando = true;
    try {
      let cola = leerCola();
      while (cola.length) {
        const item = cola[0];
        const cuerpo = new URLSearchParams({
          texto: item.texto,
          tipo: item.tipo,
          // Nunca se puede mostrar la pantalla de "¿asignar a @fulano?" acá
          // -- no hay usuario interactivo delante durante una sincronización
          // en segundo plano. Se salta esa detección a propósito y se
          // guarda siempre como tarea propia (ver POST /captura y
          // COORDINACION.md, sección rama-captura-offline).
          cancelar_asignacion: '1',
        });
        if (item.cuando) cuerpo.set('cuando', item.cuando);

        let respuesta;
        try {
          respuesta = await fetch('/captura', { method: 'POST', body: cuerpo, credentials: 'same-origin' });
        } catch (err) {
          // El fetch ni siquiera llegó al servidor -- seguimos sin señal de
          // verdad. Se corta acá (el item se queda primero en la cola) y se
          // reintenta en el próximo evento 'online' o carga de página.
          break;
        }
        // Cualquier respuesta real (2xx, 4xx de validación, 5xx) confirma
        // que sí hay conexión -- no tiene sentido reintentar por siempre un
        // item que el propio servidor ya procesó o rechazó, así que se
        // saca de la cola igual para no trabar los que vienen detrás.
        void respuesta;
        cola.shift();
        guardarCola(cola);
        if (window.__actualizarBadgeCapturaOffline) window.__actualizarBadgeCapturaOffline(cola.length);
      }
    } finally {
      sincronizando = false;
    }
  }

  window.capturaOffline = { encolarCaptura, contarPendientes, sincronizar };

  window.addEventListener('online', sincronizar);
  window.addEventListener('load', sincronizar);
})();
