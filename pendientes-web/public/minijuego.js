// rama-minijuego-jugar: mini-juego de reflejos, 100% client-side, engine
// genérico igual que tutorial.js -- arma su propio DOM, no requiere tocar
// ninguna vista aparte del botón "Jugar" que lo dispara.
(function () {
  const DURACION_MS = 6000;

  function elemento(tag, clase, texto) {
    const el = document.createElement(tag);
    if (clase) el.className = clase;
    if (texto !== undefined) el.textContent = texto;
    return el;
  }

  function iniciarMiniJuego(animalId, imagen, nombre) {
    const overlay = elemento('div', 'minijuego-overlay');
    const modal = elemento('div', 'minijuego-modal');
    const titulo = elemento('h2', null, `Jugar con ${nombre}`);
    const marcador = elemento('p', 'minijuego-marcador', 'Toques: 0');
    const area = elemento('div', 'minijuego-area');
    const objetivo = elemento('img', 'minijuego-objetivo');
    objetivo.src = imagen;
    objetivo.alt = nombre;
    area.appendChild(objetivo);

    modal.appendChild(titulo);
    modal.appendChild(marcador);
    modal.appendChild(area);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    let toques = 0;
    let activo = true;

    function reposicionar() {
      const maxX = Math.max(0, area.clientWidth - objetivo.clientWidth);
      const maxY = Math.max(0, area.clientHeight - objetivo.clientHeight);
      objetivo.style.left = Math.floor(Math.random() * maxX) + 'px';
      objetivo.style.top = Math.floor(Math.random() * maxY) + 'px';
    }

    objetivo.addEventListener('click', () => {
      if (!activo) return;
      toques += 1;
      marcador.textContent = `Toques: ${toques}`;
      reposicionar();
    });

    reposicionar();

    setTimeout(async () => {
      activo = false;
      objetivo.style.display = 'none';
      titulo.textContent = 'Enviando...';
      marcador.textContent = `Toques finales: ${toques}`;
      try {
        const resp = await fetch(`/animales/${animalId}/jugar`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });
        const datos = await resp.json();
        titulo.textContent = datos.error ? 'Ups' : '¡Listo!';
        const mensaje = elemento('p', 'minijuego-resultado', datos.error || datos.mensaje);
        modal.appendChild(mensaje);
      } catch (err) {
        titulo.textContent = 'Ups';
        modal.appendChild(elemento('p', 'minijuego-resultado', 'No se pudo conectar con el servidor.'));
      }
      const cerrar = elemento('button', 'btn-link', 'Cerrar');
      cerrar.type = 'button';
      cerrar.addEventListener('click', () => {
        overlay.remove();
        // Recarga para que el botón "Jugar" refleje el nuevo cooldown de hoy.
        window.location.reload();
      });
      modal.appendChild(cerrar);
    }, DURACION_MS);
  }

  document.addEventListener('click', (e) => {
    const boton = e.target.closest('.btn-jugar');
    if (!boton) return;
    iniciarMiniJuego(boton.dataset.jugarId, boton.dataset.jugarImagen, boton.dataset.jugarNombre);
  });
})();
