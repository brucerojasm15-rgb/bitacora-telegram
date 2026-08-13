// Sonidos cortos de mixkit.co (Sound Effects Free License, sin atribución
// requerida — ver mixkit.co/license/#sfxFree). Fuente de cada archivo
// documentada en COORDINACION.md, sección rama-captura-rapida.
function reproducirSonido(nombre) {
  try {
    const audio = new Audio(`/sonidos/${nombre}.mp3`);
    audio.play().catch(() => {});
    return audio;
  } catch (err) {
    return null;
  }
}
