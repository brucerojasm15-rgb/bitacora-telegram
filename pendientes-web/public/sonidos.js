// Sonidos cortos de mixkit.co (Sound Effects Free License, sin atribución
// requerida — ver mixkit.co/license/#sfxFree). Fuente de cada archivo
// documentada en COORDINACION.md, sección rama-captura-rapida.
function reproducirSonido(nombre) {
  // rama-ajustes: preferencia de sonido guardada en localStorage (no en la
  // cuenta — ver COORDINACION.md, no afecta el HTML inicial así que no
  // hace falta que el servidor la conozca de antemano).
  if (localStorage.getItem('sonidosActivos') === 'no') return null;
  try {
    const audio = new Audio(`/sonidos/${nombre}.mp3`);
    audio.play().catch(() => {});
    return audio;
  } catch (err) {
    return null;
  }
}
