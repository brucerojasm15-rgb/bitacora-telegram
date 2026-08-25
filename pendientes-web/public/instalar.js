// rama-instalar-app: banner de "instalar como app" -- antes solo existía
// el ícono discreto de instalar del navegador (Chrome/Edge), que casi
// nadie nota. Chrome/Edge/Android soportan `beforeinstallprompt` (evento
// real, se puede disparar el prompt nativo desde un botón propio). iOS
// Safari NUNCA dispara ese evento (restricción de Apple, no hay prompt
// programático) -- ahí se muestra una instrucción manual en su lugar
// ("Compartir -> Agregar a inicio").
//
// No se muestra si ya está instalada (display-mode: standalone, o
// navigator.standalone en iOS) ni si el usuario ya la cerró hace menos de
// 14 días (localStorage, mismo criterio de "no ser molesto" que el resto
// de banners/toasts de esta app).
(function () {
  const CLAVE_CERRADO = 'zentia_instalar_cerrado';
  const DIAS_COOLDOWN = 14;

  function yaInstalada() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }

  function cerradoRecientemente() {
    try {
      const marca = Number(localStorage.getItem(CLAVE_CERRADO));
      if (!marca) return false;
      return (Date.now() - marca) < DIAS_COOLDOWN * 24 * 60 * 60 * 1000;
    } catch (err) {
      return false;
    }
  }

  function marcarCerrado() {
    try { localStorage.setItem(CLAVE_CERRADO, String(Date.now())); } catch (err) { /* localStorage bloqueado -- no pasa nada, solo vuelve a aparecer */ }
  }

  function esIos() {
    return /iphone|ipad|ipod/i.test(window.navigator.userAgent) && !window.MSStream;
  }

  function crearBanner(texto, botonTexto, alClick) {
    const banner = document.createElement('div');
    banner.className = 'banner-instalar';
    banner.innerHTML =
      '<img src="/icons/icon-192.png" alt="" class="banner-instalar-icono">' +
      '<p class="banner-instalar-texto">' + texto + '</p>' +
      '<div class="banner-instalar-acciones">' +
      (botonTexto ? '<button type="button" class="banner-instalar-boton">' + botonTexto + '</button>' : '') +
      '<button type="button" class="banner-instalar-cerrar" aria-label="Cerrar">&times;</button>' +
      '</div>';
    document.body.appendChild(banner);
    requestAnimationFrame(() => banner.classList.add('banner-instalar-visible'));
    banner.querySelector('.banner-instalar-cerrar').addEventListener('click', () => {
      marcarCerrado();
      banner.remove();
    });
    if (botonTexto) {
      banner.querySelector('.banner-instalar-boton').addEventListener('click', () => {
        alClick();
        marcarCerrado();
        banner.remove();
      });
    }
    return banner;
  }

  if (yaInstalada() || cerradoRecientemente()) return;

  let promptDiferido = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    promptDiferido = e;
    crearBanner('Instalá zentIA en tu pantalla de inicio -- acceso directo, sin abrir el navegador.', 'Instalar', () => {
      promptDiferido.prompt();
    });
  });

  window.addEventListener('appinstalled', () => {
    marcarCerrado();
    const existente = document.querySelector('.banner-instalar');
    if (existente) existente.remove();
  });

  // iOS Safari nunca dispara beforeinstallprompt -- instrucción manual,
  // mostrada un poco después de cargar para no competir con el resto de
  // la UI en el primer instante.
  if (esIos() && !window.MSStream) {
    setTimeout(() => {
      if (yaInstalada() || cerradoRecientemente()) return;
      crearBanner('Instalá zentIA: tocá el ícono de compartir de Safari y elegí "Agregar a inicio".', null, null);
    }, 3000);
  }
})();
