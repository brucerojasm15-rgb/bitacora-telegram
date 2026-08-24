// tarea 12 del backlog (COORDINACION.md): helper compartido para pruebas
// de integración reales contra un server real -- extraído del patrón que
// casi cada rama de este proyecto reescribía desde cero en un script
// `_test_*.js` temporal (crear usuario(s) descartable(s) vía POST
// /registro real, ejercitar la ruta nueva, borrar todo al terminar).
// Alcance chico a propósito: NO es un framework de testing, solo reduce
// duplicación. Usado por test/integracion.test.js (tarea M).
const { spawn } = require('child_process');
const path = require('path');

// Arranca `node server.js` como proceso real (no se importa el módulo --
// server.js no tiene guarda `require.main === module`, así que importarlo
// llamaría a app.listen igual; spawnearlo como subproceso real es más
// simple y es exactamente lo que pide la tarea M: "levantar el server,
// pegarle con fetch"). Espera a ver el mensaje de arranque en stdout antes
// de resolver -- nunca un `setTimeout` fijo a ciegas.
function iniciarServidor(envExtra = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', ['server.js'], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, ...envExtra },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let salida = '';
    let resuelto = false;
    // ensureSchema() hace decenas de CREATE TABLE/ALTER TABLE secuenciales
    // contra la DB real antes de que arranque a escuchar -- confirmado que
    // puede tardar bastante más de 20s contra una DB remota, así que el
    // timeout se deja generoso a propósito (en CI, contra el servicio
    // `postgres` local del mismo runner, arranca mucho más rápido).
    const timeout = setTimeout(() => {
      if (!resuelto) {
        proc.kill();
        reject(new Error('Timeout esperando que el server arranque:\n' + salida));
      }
    }, 45000);
    const onData = (chunk) => {
      salida += chunk.toString();
      if (!resuelto && salida.includes('Servidor corriendo')) {
        resuelto = true;
        clearTimeout(timeout);
        proc.stdout.off('data', onData);
        resolve(proc);
      }
    };
    proc.stdout.on('data', onData);
    // Se reenvía TODO lo que imprima el server real (incluido después de
    // arrancar, ej. console.error de una request que falló) al stdout/
    // stderr de este mismo proceso -- si no, un error real del server
    // durante los tests queda enterrado en el closure de esta función y
    // en CI solo se ve "status 500" sin ninguna pista de la causa real.
    proc.stdout.on('data', (chunk) => process.stdout.write(`[server] ${chunk}`));
    proc.stderr.on('data', (chunk) => {
      salida += chunk.toString();
      process.stderr.write(`[server] ${chunk}`);
    });
    proc.on('exit', (code) => {
      if (!resuelto) {
        clearTimeout(timeout);
        reject(new Error(`El server terminó antes de arrancar (código ${code}):\n${salida}`));
      }
    });
  });
}

function detenerServidor(proc) {
  return new Promise((resolve) => {
    if (!proc || proc.exitCode !== null) return resolve();
    proc.once('exit', () => resolve());
    proc.kill();
  });
}

// PIN fijo para todas las cuentas descartables -- no hace falta variarlo,
// nunca son cuentas reales.
const PIN_DESCARTABLE = '1234';

// `prefijo` corto a propósito -- NOMBRE_USUARIO_REGEX en server.js exige
// 3-20 caracteres, y se le suma un sufijo random de 6.
async function crearUsuarioDescartable(baseUrl, prefijo = 'tst') {
  const nombreUsuario = prefijo + Math.random().toString(36).slice(2, 8);
  const res = await fetch(`${baseUrl}/registro`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      nombre_usuario: nombreUsuario,
      pin: PIN_DESCARTABLE,
      confirmar_pin: PIN_DESCARTABLE,
    }),
    redirect: 'manual',
  });
  const setCookie = res.headers.get('set-cookie');
  const cookie = setCookie ? setCookie.split(';')[0] : null;
  if (!cookie) {
    const cuerpo = await res.text();
    throw new Error(`No se pudo registrar el usuario descartable "${nombreUsuario}" (status ${res.status}): ${cuerpo.slice(0, 300)}`);
  }
  return { nombreUsuario, cookie, pin: PIN_DESCARTABLE };
}

// Borra la cuenta vía la ruta real (nunca un DELETE manual a la DB) --
// ejercita el mismo camino de borrado que usan los usuarios reales, que es
// justo lo que esta suite quiere vigilar (ver rama-chat-metas/
// rama-fix-metas-huerfanas/rama-racha-viva, todas encontraron bugs reales
// ahí esta misma sesión).
async function borrarUsuarioYDatos(baseUrl, { cookie, pin = PIN_DESCARTABLE }) {
  const res = await fetch(`${baseUrl}/ajustes/eliminar-cuenta`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie },
    body: new URLSearchParams({ pin, confirmar: 'ELIMINAR' }),
    redirect: 'manual',
  });
  return res.status;
}

module.exports = {
  iniciarServidor,
  detenerServidor,
  crearUsuarioDescartable,
  borrarUsuarioYDatos,
  PIN_DESCARTABLE,
};
