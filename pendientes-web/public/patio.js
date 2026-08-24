// rama-patio-animado: animales vivos deambulan solos dentro de `.patio`
// (posición absoluta, transición CSS left/top) y cada tanto 2 al azar se
// acercan a "jugar" (clase .patio-jugando, wiggle CSS) -- puramente
// decorativo, sin estado en el servidor, se re-sortea en cada carga de
// página. Los fallecidos no entran acá (el servidor ya los excluye del
// marcado -- ver casa.ejs/casa-amigo.ejs), tienen su memorial aparte en
// la Pared de la familia. Los enfermos/críticos caminan más lento (mismo
// espíritu que "letargo" ya usado en el nombre de esa enfermedad).
(function () {
  function iniciarPatio(contenedor) {
    const avatares = Array.from(contenedor.querySelectorAll('.patio-avatar'));
    if (avatares.length === 0) return;

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
      moverA(el, posicionAleatoria(el), duracionMs);
      const pausaMs = duracionMs + 1000 + Math.random() * 3000;
      el.__patioTimer = setTimeout(() => deambular(el), pausaMs);
    }

    avatares.forEach((el) => {
      const inicio = posicionAleatoria(el);
      el.style.position = 'absolute';
      el.style.left = inicio.x + 'px';
      el.style.top = inicio.y + 'px';
      posiciones.set(el, inicio);
      deambular(el);
    });

    function intentarJugar() {
      if (avatares.length >= 2) {
        const barajados = avatares.slice().sort(() => Math.random() - 0.5);
        const [a, b] = barajados;
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
      setTimeout(intentarJugar, 9000 + Math.random() * 9000);
    }
    setTimeout(intentarJugar, 4000 + Math.random() * 4000);
  }

  document.querySelectorAll('.patio').forEach(iniciarPatio);
})();
