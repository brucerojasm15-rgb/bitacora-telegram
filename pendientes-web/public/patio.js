// rama-patio-animado: animales vivos deambulan solos dentro de `.patio`
// (posición absoluta, transición CSS left/top) y cada tanto 2 al azar se
// acercan a "jugar" (clase .patio-jugando, wiggle CSS) -- puramente
// decorativo, sin estado en el servidor, se re-sortea en cada carga de
// página. Los fallecidos no entran acá (el servidor ya los excluye del
// marcado -- ver casa.ejs/casa-amigo.ejs), tienen su memorial aparte en
// la Pared de la familia. Los enfermos/críticos caminan más lento (mismo
// espíritu que "letargo" ya usado en el nombre de esa enfermedad).
//
// rama-rivalidades (Etapa 2): `.patio` trae data-rivales con los pares
// [idA, idB] calculados en el servidor (sonRivales() -- especie fija o
// rasgo raro compartido) y cada .patio-avatar trae data-id. Los rivales
// nunca se emparejan para "jugar" y el deambular evita acercarse
// demasiado entre ellos -- salvo data-comida="1" (recién se alimentó a
// alguien, pedido explícito del usuario: "se juntan igual a la hora de
// comer"), que fuerza una reunión única al cargar antes de volver al
// comportamiento normal.
(function () {
  const DISTANCIA_MINIMA_RIVALES = 90;

  function iniciarPatio(contenedor) {
    const avatares = Array.from(contenedor.querySelectorAll('.patio-avatar'));
    if (avatares.length === 0) return;

    let paresRivales = [];
    try { paresRivales = JSON.parse(contenedor.dataset.rivales || '[]'); } catch (err) { paresRivales = []; }
    const esRival = (idA, idB) => paresRivales.some(([x, y]) => (x === idA && y === idB) || (x === idB && y === idA));
    const idDe = (el) => Number(el.dataset.id);

    const posiciones = new Map();

    function limites(el) {
      return {
        maxX: Math.max(contenedor.clientWidth - el.offsetWidth, 0),
        maxY: Math.max(contenedor.clientHeight - el.offsetHeight, 0),
      };
    }

    function posicionAleatoria(el) {
      const { maxX, maxY } = limites(el);
      return { x: Math.random() * maxX, y: Math.random() * maxY };
    }

    function distancia(p1, p2) {
      return Math.hypot(p1.x - p2.x, p1.y - p2.y);
    }

    // Hasta 5 intentos buscando un punto lejos de cualquier rival actual
    // -- si no encuentra ninguno lo bastante lejos (patio chico, muchos
    // rivales), usa el último candidato igual, mejor que trabarse.
    function posicionLejosDeRivales(el) {
      const miId = idDe(el);
      const rivalesDeEste = avatares.filter((otro) => otro !== el && esRival(miId, idDe(otro)));
      if (rivalesDeEste.length === 0) return posicionAleatoria(el);
      let candidato = posicionAleatoria(el);
      for (let intento = 0; intento < 5; intento++) {
        const lejos = rivalesDeEste.every((r) => distancia(candidato, posiciones.get(r) || candidato) >= DISTANCIA_MINIMA_RIVALES);
        if (lejos) break;
        candidato = posicionAleatoria(el);
      }
      return candidato;
    }

    function moverA(el, destino, duracionMs) {
      const actual = posiciones.get(el) || destino;
      el.style.transform = destino.x < actual.x ? 'scaleX(-1)' : 'scaleX(1)';
      el.style.transition = `left ${duracionMs}ms ease-in-out, top ${duracionMs}ms ease-in-out`;
      el.style.left = destino.x + 'px';
      el.style.top = destino.y + 'px';
      posiciones.set(el, destino);
    }

    function deambular(el) {
      const lento = el.dataset.lento === '1';
      const duracionMs = (lento ? 6000 : 3000) + Math.random() * 3000;
      moverA(el, posicionLejosDeRivales(el), duracionMs);
      const pausaMs = duracionMs + 1000 + Math.random() * 3000;
      el.__patioTimer = setTimeout(() => deambular(el), pausaMs);
    }

    function iniciarDeambular() {
      avatares.forEach((el) => {
        const inicio = posicionLejosDeRivales(el);
        el.style.position = 'absolute';
        el.style.left = inicio.x + 'px';
        el.style.top = inicio.y + 'px';
        posiciones.set(el, inicio);
        deambular(el);
      });
    }

    function intentarJugar() {
      if (avatares.length >= 2) {
        // Hasta 5 intentos buscando un par que NO sea rival -- si el
        // patio es todo rivales entre sí, simplemente no juegan esta
        // vez (mejor eso que forzar a 2 rivales a "jugar").
        let a, b, encontrado = false;
        for (let intento = 0; intento < 5; intento++) {
          const barajados = avatares.slice().sort(() => Math.random() - 0.5);
          [a, b] = barajados;
          if (!esRival(idDe(a), idDe(b))) { encontrado = true; break; }
        }
        if (encontrado) {
          const posA = posiciones.get(a);
          const posB = posiciones.get(b);
          const punto = { x: (posA.x + posB.x) / 2, y: (posA.y + posB.y) / 2 };
          clearTimeout(a.__patioTimer);
          clearTimeout(b.__patioTimer);
          moverA(a, { x: Math.max(punto.x - 20, 0), y: punto.y }, 1500);
          moverA(b, { x: Math.min(punto.x + 20, limites(b).maxX), y: punto.y }, 1500);
          setTimeout(() => {
            a.classList.add('patio-jugando');
            b.classList.add('patio-jugando');
          }, 1500);
          setTimeout(() => {
            a.classList.remove('patio-jugando');
            b.classList.remove('patio-jugando');
            deambular(a);
            deambular(b);
          }, 3300);
        }
      }
      setTimeout(intentarJugar, 9000 + Math.random() * 9000);
    }

    if (contenedor.dataset.comida === '1' && avatares.length >= 2) {
      // Reunión forzada, ignora rivalidad por completo -- todos convergen
      // a un punto central antes de que arranque el comportamiento
      // normal (que sí respeta distancia entre rivales).
      const centro = { x: contenedor.clientWidth / 2, y: contenedor.clientHeight / 2 };
      avatares.forEach((el, i) => {
        el.style.position = 'absolute';
        const angulo = (i / avatares.length) * Math.PI * 2;
        const destino = {
          x: Math.min(Math.max(centro.x + Math.cos(angulo) * 30, 0), limites(el).maxX),
          y: Math.min(Math.max(centro.y + Math.sin(angulo) * 30, 0), limites(el).maxY),
        };
        el.style.left = destino.x + 'px';
        el.style.top = destino.y + 'px';
        posiciones.set(el, destino);
      });
      setTimeout(iniciarDeambular, 2500);
      setTimeout(intentarJugar, 6000);
    } else {
      iniciarDeambular();
      setTimeout(intentarJugar, 4000 + Math.random() * 4000);
    }
  }

  document.querySelectorAll('.patio').forEach(iniciarPatio);
})();
