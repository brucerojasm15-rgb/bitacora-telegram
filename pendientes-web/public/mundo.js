// rama-mundo-caminable: prototipo chico y aislado del mundo caminable
// (ver COORDINACION.md, "Visión grande 2026-08-25" -- decisión confirmada
// de que TODA la app se convierte en esto, empezando por un prototipo).
// Canvas 2D plano (no WebGL, sería sobre-ingeniería para un mapa 2D
// top-down), vanilla JS sin framework -- mismo criterio que el resto de
// esta base de código (nunca se introdujo React/Vue/etc.). Caminar hasta
// un edificio y entrar simplemente navega a la ruta real que ya existe
// (/casa, /plaza) -- esas páginas no se tocan, cero riesgo de romper algo
// ya probado. Solo 2 edificios de prueba en este prototipo (a propósito,
// ver el doc) -- el resto del "juego" sigue accesible por el detalle
// "Más del juego" en mundo.ejs mientras no se conviertan en edificios
// también.
(function () {
  const canvas = document.getElementById('mundo-canvas');
  if (!canvas) return;
  const wrap = canvas.parentElement;
  const ctx = canvas.getContext('2d');
  const prompt = document.getElementById('mundo-prompt');
  const promptBtn = document.getElementById('mundo-prompt-btn');

  const estilo = getComputedStyle(document.documentElement);
  const colorAccent = estilo.getPropertyValue('--accent').trim() || '#16A34A';
  const colorAccentFuerte = estilo.getPropertyValue('--accent-strong').trim() || '#0B4A2E';

  const MAPA_ANCHO = 1600;
  const MAPA_ALTO = 1200;
  const RADIO_AVATAR = 16;
  const VELOCIDAD = 220; // px/seg

  // rama-mundo-caminable: solo 2 edificios de prueba, conectados a rutas
  // reales ya construidas -- el resto del "juego" (Mi planta, Mercado,
  // Logros, Hablar con tu planta) queda en el detalle "Más del juego" del
  // EJS hasta una ronda futura que les asigne su propio edificio.
  const EDIFICIOS = [
    { nombre: 'Casa', ruta: '/casa', x: 420, y: 380, w: 160, h: 120, color: colorAccentFuerte },
    { nombre: 'Plaza', ruta: '/plaza', x: 1100, y: 780, w: 160, h: 120, color: colorAccent },
  ];

  const avatar = { x: MAPA_ANCHO / 2, y: MAPA_ALTO / 2, dirX: 0, dirY: 1 };

  const teclas = new Set();
  let joystick = null; // {dx, dy} normalizado, viene del arrastre táctil
  let edificioCerca = null;

  function ajustarTamano() {
    const ancho = wrap.clientWidth;
    const alto = Math.max(320, Math.min(window.innerHeight * 0.55, 520));
    const dpr = window.devicePixelRatio || 1;
    canvas.style.width = ancho + 'px';
    canvas.style.height = alto + 'px';
    canvas.width = Math.round(ancho * dpr);
    canvas.height = Math.round(alto * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  ajustarTamano();
  window.addEventListener('resize', ajustarTamano);

  window.addEventListener('keydown', (e) => {
    teclas.add(e.key.toLowerCase());
    if ((e.key === 'Enter' || e.key === ' ') && edificioCerca) {
      e.preventDefault();
      window.location.href = edificioCerca.ruta;
    }
  });
  window.addEventListener('keyup', (e) => teclas.delete(e.key.toLowerCase()));

  function direccionDeTeclado() {
    let dx = 0, dy = 0;
    if (teclas.has('arrowleft') || teclas.has('a')) dx -= 1;
    if (teclas.has('arrowright') || teclas.has('d')) dx += 1;
    if (teclas.has('arrowup') || teclas.has('w')) dy -= 1;
    if (teclas.has('arrowdown') || teclas.has('s')) dy += 1;
    return { dx, dy };
  }

  // Arrastre táctil: el origen es donde empieza el toque, el vector hacia
  // el dedo mientras se mueve define la dirección (como un joystick
  // virtual invisible) -- soltar detiene al avatar. Pensado para mobile
  // (esta app es PWA instalable, mobile-first) sin necesitar dibujar un
  // d-pad aparte para este prototipo.
  let origenToque = null;
  canvas.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    origenToque = { x: t.clientX, y: t.clientY };
    e.preventDefault();
  }, { passive: false });
  canvas.addEventListener('touchmove', (e) => {
    if (!origenToque) return;
    const t = e.touches[0];
    const dx = t.clientX - origenToque.x;
    const dy = t.clientY - origenToque.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 8) joystick = { dx: dx / dist, dy: dy / dist };
    e.preventDefault();
  }, { passive: false });
  function soltarToque() { origenToque = null; joystick = null; }
  canvas.addEventListener('touchend', soltarToque);
  canvas.addEventListener('touchcancel', soltarToque);

  function actualizar(dt) {
    let { dx, dy } = direccionDeTeclado();
    if (dx === 0 && dy === 0 && joystick) {
      dx = joystick.dx;
      dy = joystick.dy;
    }
    const mag = Math.hypot(dx, dy);
    if (mag > 0) {
      dx /= mag;
      dy /= mag;
      avatar.dirX = dx;
      avatar.dirY = dy;
      avatar.x = Math.min(Math.max(avatar.x + dx * VELOCIDAD * dt, RADIO_AVATAR), MAPA_ANCHO - RADIO_AVATAR);
      avatar.y = Math.min(Math.max(avatar.y + dy * VELOCIDAD * dt, RADIO_AVATAR), MAPA_ALTO - RADIO_AVATAR);
    }

    // rama-mundo-caminable: "cerca" = el círculo del avatar superpone el
    // rectángulo del edificio con un margen -- mismo espíritu simple que
    // el resto de las colisiones del proyecto (ver esRival()/distancia()
    // en patio.js), nada de motor de físicas real para un prototipo.
    const MARGEN = 24;
    const nuevo = EDIFICIOS.find((ed) => {
      const cercaX = avatar.x > ed.x - MARGEN && avatar.x < ed.x + ed.w + MARGEN;
      const cercaY = avatar.y > ed.y - MARGEN && avatar.y < ed.y + ed.h + MARGEN;
      return cercaX && cercaY;
    }) || null;
    if (nuevo !== edificioCerca) {
      edificioCerca = nuevo;
      if (edificioCerca) {
        promptBtn.textContent = `Entrar a ${edificioCerca.nombre}`;
        prompt.hidden = false;
      } else {
        prompt.hidden = true;
      }
    }
  }

  function dibujar() {
    const ancho = canvas.width / (window.devicePixelRatio || 1);
    const alto = canvas.height / (window.devicePixelRatio || 1);
    const camX = Math.min(Math.max(avatar.x - ancho / 2, 0), Math.max(MAPA_ANCHO - ancho, 0));
    const camY = Math.min(Math.max(avatar.y - alto / 2, 0), Math.max(MAPA_ALTO - alto, 0));

    ctx.fillStyle = '#bfe6c4';
    ctx.fillRect(0, 0, ancho, alto);

    ctx.save();
    ctx.translate(-camX, -camY);

    // Cuadrícula de referencia, puramente decorativa (da sensación de
    // movimiento real al caminar, sin necesitar tiles/arte todavía).
    ctx.strokeStyle = 'rgba(11, 74, 46, 0.12)';
    ctx.lineWidth = 1;
    const PASO = 80;
    for (let x = 0; x <= MAPA_ANCHO; x += PASO) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, MAPA_ALTO);
      ctx.stroke();
    }
    for (let y = 0; y <= MAPA_ALTO; y += PASO) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(MAPA_ANCHO, y);
      ctx.stroke();
    }

    EDIFICIOS.forEach((ed) => {
      ctx.fillStyle = ed.color;
      ctx.beginPath();
      ctx.roundRect(ed.x, ed.y, ed.w, ed.h, 14);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = '600 15px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(ed.nombre, ed.x + ed.w / 2, ed.y + ed.h / 2 + 5);
    });

    // Avatar: cápsula simple con un indicador de dirección -- diseño
    // propio (no copiado), suficiente para validar cómo se siente
    // caminar antes de invertir en arte real.
    ctx.fillStyle = colorAccentFuerte;
    ctx.beginPath();
    ctx.arc(avatar.x, avatar.y, RADIO_AVATAR, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(avatar.x + avatar.dirX * 8, avatar.y + avatar.dirY * 8, 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();

    // El prompt de "Entrar a X" es un botón real en el DOM (mejor
    // accesibilidad/tap-target que dibujarlo en canvas) -- se posiciona
    // sobre el avatar en coordenadas de pantalla.
    if (edificioCerca) {
      const px = avatar.x - camX;
      const py = avatar.y - camY - RADIO_AVATAR - 44;
      prompt.style.left = px + 'px';
      prompt.style.top = py + 'px';
    }
  }

  promptBtn.addEventListener('click', () => {
    if (edificioCerca) window.location.href = edificioCerca.ruta;
  });

  let ultimo = performance.now();
  function bucle(ahora) {
    const dt = Math.min((ahora - ultimo) / 1000, 0.05);
    ultimo = ahora;
    actualizar(dt);
    dibujar();
    requestAnimationFrame(bucle);
  }
  requestAnimationFrame(bucle);
})();
