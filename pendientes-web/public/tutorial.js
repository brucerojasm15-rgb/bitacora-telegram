// rama-tutorial-multicapitulo: motor genérico del tutorial por capítulos,
// reemplaza el tour de un solo flujo que antes vivía hardcodeado en
// captura.ejs (rama-tutorial-interactivo). Agnóstico de página: construye
// TODO el DOM (bienvenida/coach/final) por JS y reutiliza clases CSS que ya
// eran genéricas (.tutorial-modal-overlay, .tutorial-coach,
// .tutorial-resaltado, ver public/style.css) -- así ninguna vista aparte de
// esta necesita tocarse para mostrar el tour, solo apunta por selector a
// sus controles reales.
//
// Estado: el servidor solo sabe qué CAPÍTULOS están completados
// (window.__tutorialCapitulosCompletados, ver partials/scripts.ejs). El
// progreso DENTRO de un capítulo en curso vive en localStorage
// (zentia_tutorial_activo) -- mismo criterio que ya usaba el tour viejo
// para sobrevivir un submit real + recarga de página.
(function () {
  var CLAVE_ACTIVO = 'zentia_tutorial_activo';
  var CLAVE_CELEBRAR = 'zentia_tutorial_celebrar';

  // Pasos/selectores/textos: puramente de UI, no viven en el servidor. La
  // recompensa acá es solo para el texto de los modales -- el pago real
  // (y su validación) es 100% server-side, ver POST
  // /tutorial/capitulo/:capitulo/completar.
  var CAPITULOS = {
    basico: {
      titulo: 'Básico',
      descripcion: 'Capturá algo real, agregá amigos y conocé tu planta compañera -- 4 pasos rápidos.',
      recompensa: 20,
      pasos: [
        {
          pagina: '/captura', selector: '#captura-texto',
          texto: 'Escribí acá algo real que tengas en mente -- un pendiente, una idea, o algo para recordar.',
          espera: 'boton', gatillo: '#captura-texto', etiquetaBoton: 'Siguiente',
        },
        {
          pagina: '/captura', selector: '.captura-tipos',
          texto: 'Elegí qué es lo que escribiste, y tocá ese botón para guardarlo de verdad.',
          espera: 'guardadoQuery',
        },
        {
          pagina: '/amigos', selector: '#copiar-invitacion',
          texto: 'Copiá tu enlace de invitación -- así agregás amigos reales a zentIA.',
          espera: 'clickReal',
        },
        {
          pagina: '/ia', selector: '.ia-nombre-form',
          texto: 'Ponele un nombre a tu planta compañera y guardalo.',
          espera: 'submitReal',
        },
      ],
    },
    organizacion: {
      titulo: 'Organización',
      descripcion: 'Creá una meta personal y revisá tu resumen de actividad.',
      recompensa: 15,
      pasos: [
        {
          pagina: '/metas', selector: 'form[action="/metas"]',
          texto: 'Creá una meta personal real -- completá el formulario y guardala.',
          espera: 'submitReal',
        },
        {
          pagina: '/estadisticas', selector: 'main',
          texto: 'Este es tu resumen de actividad.',
          espera: 'boton', etiquetaBoton: 'Listo',
        },
      ],
    },
    social: {
      titulo: 'Social',
      descripcion: 'Mandá un mensaje al chat general y revisá la actividad de un amigo.',
      recompensa: 15,
      pasos: [
        {
          pagina: '/chat-general', selector: 'form[action="/mensajes-general"]',
          texto: 'Mandá un mensaje real al chat general.',
          espera: 'submitReal',
        },
        {
          pagina: '/trazabilidad', selector: 'main',
          texto: 'Acá ves la actividad de tu amigo.',
          espera: 'boton', etiquetaBoton: 'Listo', requiereAmistad: true,
        },
      ],
    },
  };

  function leerActivo() {
    try { return JSON.parse(localStorage.getItem(CLAVE_ACTIVO)); } catch (e) { return null; }
  }
  function guardarActivo(activo) { localStorage.setItem(CLAVE_ACTIVO, JSON.stringify(activo)); }
  function limpiarActivo() { localStorage.removeItem(CLAVE_ACTIVO); }

  function pasosDe(capituloId, amistadId) {
    var pasos = CAPITULOS[capituloId].pasos;
    return amistadId ? pasos : pasos.filter(function (p) { return !p.requiereAmistad; });
  }

  function urlDePaso(paso, amistadId) {
    return paso.requiereAmistad && amistadId
      ? paso.pagina + '?amistad_id=' + encodeURIComponent(amistadId)
      : paso.pagina;
  }

  // --- DOM: overlays construidos dinámicamente, un solo par reusado ---
  var overlayModal = null;
  var elCoach = null;
  var elementoResaltado = null;

  function crearOverlay(clase) {
    var overlay = document.createElement('div');
    overlay.className = clase;
    overlay.hidden = true;
    document.body.appendChild(overlay);
    return overlay;
  }

  function asegurarDom() {
    if (!overlayModal) overlayModal = crearOverlay('tutorial-modal-overlay');
    if (!elCoach) elCoach = crearOverlay('tutorial-coach');
  }

  function resaltar(selector) {
    if (elementoResaltado) elementoResaltado.classList.remove('tutorial-resaltado');
    elementoResaltado = selector ? document.querySelector(selector) : null;
    if (elementoResaltado) {
      elementoResaltado.classList.add('tutorial-resaltado');
      elementoResaltado.scrollIntoView({ block: 'center', behavior: 'smooth' });
      if (elementoResaltado.tagName === 'INPUT' || elementoResaltado.tagName === 'TEXTAREA') {
        elementoResaltado.focus();
      }
    }
  }

  function ocultarTodo() {
    if (overlayModal) overlayModal.hidden = true;
    if (elCoach) elCoach.hidden = true;
    resaltar(null);
  }

  function mostrarModal(titulo, texto, opciones) {
    asegurarDom();
    overlayModal.innerHTML = '';
    var caja = document.createElement('div');
    caja.className = 'tutorial-modal';
    var h2 = document.createElement('h2');
    h2.textContent = titulo;
    var p = document.createElement('p');
    p.textContent = texto;
    var botones = document.createElement('div');
    botones.className = 'tutorial-modal-botones';
    if (opciones.mostrarSaltar) {
      var btnSaltar = document.createElement('button');
      btnSaltar.type = 'button';
      btnSaltar.className = 'btn-link';
      btnSaltar.textContent = 'Saltar';
      btnSaltar.addEventListener('click', opciones.alSaltar);
      botones.appendChild(btnSaltar);
    }
    var btnPrincipal = document.createElement('button');
    btnPrincipal.type = 'button';
    btnPrincipal.textContent = opciones.textoBotonPrincipal;
    btnPrincipal.addEventListener('click', opciones.alClickPrincipal);
    botones.appendChild(btnPrincipal);
    caja.appendChild(h2);
    caja.appendChild(p);
    caja.appendChild(botones);
    overlayModal.appendChild(caja);
    overlayModal.hidden = false;
  }

  function mostrarCoach(texto, opciones) {
    asegurarDom();
    elCoach.innerHTML = '';
    var p = document.createElement('p');
    p.textContent = texto;
    var botones = document.createElement('div');
    botones.className = 'tutorial-coach-botones';
    var btnSaltar = document.createElement('button');
    btnSaltar.type = 'button';
    btnSaltar.className = 'btn-link';
    btnSaltar.textContent = 'Saltar';
    btnSaltar.addEventListener('click', opciones.alSaltar);
    botones.appendChild(btnSaltar);
    var btnAccion = null;
    if (opciones.boton) {
      btnAccion = document.createElement('button');
      btnAccion.type = 'button';
      btnAccion.textContent = opciones.boton.etiqueta;
      btnAccion.disabled = !!opciones.boton.deshabilitadoInicial;
      btnAccion.addEventListener('click', opciones.boton.alClick);
      botones.appendChild(btnAccion);
    }
    elCoach.appendChild(p);
    elCoach.appendChild(botones);
    elCoach.hidden = false;
    return btnAccion;
  }

  // --- lógica del tour ---

  // Capítulo básico: "Saltar" marca visto para siempre (no vuelve a
  // nagear), sin recompensa -- mismo comportamiento que el tour de un solo
  // flujo de antes. Capítulos opcionales: "Saltar" NO llama al servidor,
  // solo cierra -- quedan "pendiente" en /tutorial para retomar cuando
  // quiera.
  function terminarComoOmitido(capituloId) {
    limpiarActivo();
    ocultarTodo();
    if (capituloId === 'basico') {
      fetch('/tutorial/capitulo/basico/completar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ omitido: true }),
      }).catch(function () {});
    }
  }

  function completarCapitulo(capituloId, vaANavegar) {
    limpiarActivo();
    var meta = CAPITULOS[capituloId];
    var hacerFetch = function () {
      return fetch('/tutorial/capitulo/' + capituloId + '/completar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
        keepalive: !!vaANavegar,
      }).catch(function () {});
    };
    if (vaANavegar) {
      // El paso final fue un submit real que ya está en camino a navegar
      // -- no se puede mostrar el modal acá (la página está por
      // descargarse). Se guarda para celebrar recién en la página
      // siguiente (mismo patrón que el toast de metas en captura.ejs:
      // feedback DESPUÉS del redirect, no antes).
      hacerFetch();
      localStorage.setItem(CLAVE_CELEBRAR, JSON.stringify({ capitulo: capituloId, recompensa: meta.recompensa }));
      return;
    }
    hacerFetch().then(function () { celebrarCapitulo(capituloId, meta.recompensa); });
  }

  function celebrarCapitulo(capituloId, recompensa) {
    ocultarTodo();
    mostrarModal(
      '¡Capítulo completado!',
      'Ganaste +' + recompensa + ' semillas. El resto de los capítulos están en Tutorial, dentro de "Más".',
      { textoBotonPrincipal: 'Entendido', alClickPrincipal: ocultarTodo, mostrarSaltar: false }
    );
  }

  function irAPaso(capituloId, indice, amistadId) {
    var pasos = pasosDe(capituloId, amistadId);
    if (indice >= pasos.length) {
      completarCapitulo(capituloId, false);
      return;
    }
    guardarActivo({ capitulo: capituloId, paso: indice, amistadId: amistadId || null });
    var paso = pasos[indice];
    if (paso.pagina !== location.pathname) {
      mostrarPuente(capituloId, paso, amistadId);
      return;
    }
    mostrarPasoEnPagina(capituloId, indice, amistadId, paso, pasos);
  }

  function mostrarPuente(capituloId, paso, amistadId) {
    ocultarTodo();
    mostrarModal('¡Bien ahí!', 'Seguimos: ' + paso.texto, {
      textoBotonPrincipal: 'Continuar',
      alClickPrincipal: function () { location.href = urlDePaso(paso, amistadId); },
      mostrarSaltar: true,
      alSaltar: function () { terminarComoOmitido(capituloId); },
    });
  }

  function mostrarPasoEnPagina(capituloId, indice, amistadId, paso, pasos) {
    ocultarTodo();
    resaltar(paso.selector);
    var alSaltar = function () { terminarComoOmitido(capituloId); };
    var avanzar = function () { irAPaso(capituloId, indice + 1, amistadId); };

    if (paso.espera === 'boton') {
      var gatilloEl = paso.gatillo ? document.querySelector(paso.gatillo) : null;
      var btn = mostrarCoach(paso.texto, {
        alSaltar: alSaltar,
        boton: { etiqueta: paso.etiquetaBoton || 'Siguiente', deshabilitadoInicial: !!gatilloEl, alClick: avanzar },
      });
      if (btn) {
        if (gatilloEl) {
          var revisar = function () { btn.disabled = !gatilloEl.value || !gatilloEl.value.trim(); };
          gatilloEl.addEventListener('input', revisar);
          revisar();
        } else {
          btn.disabled = false;
        }
      }
    } else if (paso.espera === 'clickReal') {
      mostrarCoach(paso.texto, { alSaltar: alSaltar, boton: null });
      var elReal = document.querySelector(paso.selector);
      if (elReal) {
        var onClick = function () {
          elReal.removeEventListener('click', onClick);
          avanzar();
        };
        elReal.addEventListener('click', onClick);
      }
    } else if (paso.espera === 'submitReal') {
      // No se intercepta el submit (ni preventDefault ni fetch manual) --
      // se deja que el form navegue de verdad, solo se actualiza
      // localStorage de forma SÍNCRONA antes de que la página se
      // descargue (mismo mecanismo que ya usaba el tour viejo para
      // sobrevivir el submit real de captura.ejs).
      mostrarCoach(paso.texto, { alSaltar: alSaltar, boton: null });
      var form = document.querySelector(paso.selector);
      if (form && form.tagName !== 'FORM') form = form.closest('form');
      if (form) {
        form.addEventListener('submit', function () {
          if (pasos.length - (indice + 1) <= 0) {
            completarCapitulo(capituloId, true);
          } else {
            guardarActivo({ capitulo: capituloId, paso: indice + 1, amistadId: amistadId || null });
          }
        });
      }
    } else if (paso.espera === 'guardadoQuery') {
      // Específico de captura.ejs: ese form intercepta su propio submit
      // (retraso de sonido antes de navegar, ver captura.ejs), así que un
      // listener de 'submit' genérico dispararía en falso en el flujo de
      // "Recordatorio" (que hace un primer submit solo para revelar el
      // campo de fecha, sin guardar nada). La señal robusta es la misma
      // que ya usaba el tour viejo: el redirect real de POST /captura
      // agrega ?guardado=1.
      var params = new URLSearchParams(location.search);
      if (params.get('guardado') === '1') {
        avanzar();
        return;
      }
      mostrarCoach(paso.texto, { alSaltar: alSaltar, boton: null });
    }
  }

  function iniciarCapitulo(capituloId, amistadId) {
    var meta = CAPITULOS[capituloId];
    if (!meta) return;
    mostrarModal('¡Vamos con "' + meta.titulo + '"!', meta.descripcion, {
      textoBotonPrincipal: 'Empezar',
      alClickPrincipal: function () { irAPaso(capituloId, 0, amistadId); },
      mostrarSaltar: true,
      alSaltar: function () { terminarComoOmitido(capituloId); },
    });
  }

  function init() {
    var completados = window.__tutorialCapitulosCompletados || [];

    var celebrarRaw = localStorage.getItem(CLAVE_CELEBRAR);
    if (celebrarRaw) {
      localStorage.removeItem(CLAVE_CELEBRAR);
      try {
        var c = JSON.parse(celebrarRaw);
        if (c && CAPITULOS[c.capitulo]) {
          celebrarCapitulo(c.capitulo, c.recompensa);
          return;
        }
      } catch (e) { /* ignorar, sigue el flujo normal abajo */ }
    }

    var params = new URLSearchParams(location.search);
    var capituloQuery = params.get('tutorial');
    var amistadIdQuery = params.get('amistad_id');
    var activo = leerActivo();

    if (capituloQuery && CAPITULOS[capituloQuery] && (!activo || activo.capitulo !== capituloQuery)) {
      iniciarCapitulo(capituloQuery, amistadIdQuery);
      return;
    }

    if (activo && CAPITULOS[activo.capitulo]) {
      irAPaso(activo.capitulo, activo.paso, activo.amistadId);
      return;
    }

    // Disparo automático del capítulo básico para usuarios nuevos -- mismo
    // criterio que el tour viejo: solo en /captura, con el form real
    // presente (guarda contra la pantalla de confirmación de asignación,
    // que no tiene #form-captura).
    if (location.pathname === '/captura' && completados.indexOf('basico') === -1 && document.getElementById('form-captura')) {
      iniciarCapitulo('basico', null);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
