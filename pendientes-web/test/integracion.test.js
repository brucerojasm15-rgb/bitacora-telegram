// tarea M del backlog (COORDINACION.md): puñado de pruebas de integración
// reales -- levanta el server real (scripts/test-helpers.js) contra una DB
// de PRUEBA (nunca la de producción; en CI es el servicio `postgres` de
// ci.yml, siempre vacía al arrancar -- ensureSchema() la puebla sola) y le
// pega con fetch, como pide el enunciado original. Deliberadamente chico:
// no reemplaza `npm run ci` (sintaxis/plantillas) ni intenta cubrir toda
// la app -- cubre los flujos que esta misma sesión encontró rotos de
// verdad (rama-chat-metas, rama-fix-metas-huerfanas, rama-racha-viva),
// para que dejen de poder romperse en silencio.
// El server hijo (scripts/test-helpers.js) carga su propio .env vía
// `require('dotenv').config()` en server.js -- pero ESTE proceso (el que
// corre `node --test`) también necesita `process.env.DATABASE_URL` para
// su propio `pool` de verificación directa contra la DB, así que se carga
// acá también. En CI no hay `.env` (los env vars los pone `ci.yml`
// directo) -- dotenv no hace nada si no encuentra el archivo, no rompe.
require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const {
  iniciarServidor,
  detenerServidor,
  crearUsuarioDescartable,
  borrarUsuarioYDatos,
} = require('../scripts/test-helpers');

const PORT = process.env.TEST_PORT || 4099;
const BASE = `http://127.0.0.1:${PORT}`;

let servidor;
let pool;
let usuarioA;
let usuarioB;

test.before(async () => {
  servidor = await iniciarServidor({ PORT: String(PORT) });
  // Mismo criterio de SSL que server.js (ver el comentario ahí) -- sin
  // esto, este pool aparte que usa la suite para verificar contra la DB
  // directamente fallaba con ECONNREFUSED al correr localmente contra
  // Railway (que sí exige SSL), aunque el server real sí conectaba bien.
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
  });
  // Dos cuentas compartidas por toda la suite (no una por test) -- el
  // registro público está limitado a 5 altas exitosas/hora/IP a propósito
  // (rama-limite-registro), y este mismo proceso de server es el que
  // cuenta esas altas en memoria durante toda la corrida de CI.
  usuarioA = await crearUsuarioDescartable(BASE, 'tsa');
  usuarioB = await crearUsuarioDescartable(BASE, 'tsb');
});

test.after(async () => {
  if (usuarioA) await borrarUsuarioYDatos(BASE, usuarioA).catch(() => {});
  if (usuarioB) await borrarUsuarioYDatos(BASE, usuarioB).catch(() => {});
  if (pool) await pool.end();
  await detenerServidor(servidor);
});

test('captura un pendiente propio y lo completa (JSON) con datos consistentes con la DB', async () => {
  const capturar = await fetch(`${BASE}/captura`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: usuarioA.cookie },
    body: new URLSearchParams({ texto: 'Pendiente de prueba de integración', tipo: 'pendiente' }),
    redirect: 'manual',
  });
  assert.equal(capturar.status, 302);

  const htmlIndex = await (await fetch(`${BASE}/`, { headers: { Cookie: usuarioA.cookie } })).text();
  const idMatch = htmlIndex.match(/\/pendientes\/(\d+)\/completar/);
  assert.ok(idMatch, 'debería aparecer un pendiente pendiente de completar en /');
  const pendienteId = idMatch[1];

  const completar = await fetch(`${BASE}/pendientes/${pendienteId}/completar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', Cookie: usuarioA.cookie },
    body: new URLSearchParams({}),
  });
  assert.equal(completar.status, 200);
  const datos = await completar.json();
  assert.equal(datos.completado, true);
  assert.ok(datos.barra, 'la respuesta debe incluir la barra superior recién calculada');

  const { rows } = await pool.query(
    'SELECT saldo_moneda FROM usuarios WHERE nombre_usuario = $1',
    [usuarioA.nombreUsuario]
  );
  assert.equal(datos.barra.semillas, rows[0].saldo_moneda, 'las semillas devueltas deben coincidir con la DB real');
});

test('amistad entre A y B, mensaje de chat visible para ambos', async () => {
  const solicitar = await fetch(`${BASE}/amigos/solicitar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: usuarioA.cookie },
    body: new URLSearchParams({ nombre_usuario: usuarioB.nombreUsuario }),
    redirect: 'manual',
  });
  assert.equal(solicitar.status, 302);

  const htmlB = await (await fetch(`${BASE}/amigos`, { headers: { Cookie: usuarioB.cookie } })).text();
  const idSolicitud = htmlB.match(/\/amigos\/(\d+)\/aceptar/);
  assert.ok(idSolicitud, 'B debería ver la solicitud pendiente de A');

  const aceptar = await fetch(`${BASE}/amigos/${idSolicitud[1]}/aceptar`, {
    method: 'POST',
    headers: { Cookie: usuarioB.cookie },
    redirect: 'manual',
  });
  assert.equal(aceptar.status, 302);

  const htmlAmigosA = await (await fetch(`${BASE}/amigos`, { headers: { Cookie: usuarioA.cookie } })).text();
  const bloqueB = htmlAmigosA.split('<li>').find((b) => b.includes(usuarioB.nombreUsuario));
  assert.ok(bloqueB, 'A debería ver a B en su lista de amigos');
  const amistadId = bloqueB.match(/\/chat\?amistad_id=(\d+)/)[1];

  const enviar = await fetch(`${BASE}/mensajes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', Cookie: usuarioA.cookie },
    body: new URLSearchParams({ amistad_id: amistadId, texto: 'Hola desde la prueba de integración' }),
  });
  assert.equal(enviar.status, 200);

  const chatB = await (await fetch(`${BASE}/chat?amistad_id=${amistadId}`, { headers: { Cookie: usuarioB.cookie } })).text();
  assert.ok(chatB.includes('Hola desde la prueba de integración'), 'B debería ver el mensaje de A en el chat');

  // Guarda el amistadId en el usuario para reusarlo en el siguiente test
  // (metas compartidas + unirse desde el chat) sin rehacer todo el flujo.
  usuarioA.amistadIdConB = amistadId;
});

test('meta compartida: A la crea con C (SIN B), la comparte en el chat A-B, y B se une', async () => {
  assert.ok(usuarioA.amistadIdConB, 'depende del test anterior (amistad ya aceptada)');

  // A propósito, A crea la meta invitando a C (NUNCA a B) -- si B fuera
  // invitado desde la creación, ya sería participante y el botón "Unirme"
  // nunca aparecería, lo que dejaría sin probar el camino real que esta
  // feature agrega (rama-chat-metas): alguien que ve la tarjeta en un chat
  // sin haber sido invitado originalmente. A (no C) tiene que seguir
  // siendo el creador -- la regla de confianza de POST /metas/compartida/
  // :id/unirme exige ser amigo aceptado del CREADOR (ver esa ruta en
  // server.js), y B ya es amigo de A, no de un tercero cualquiera.
  const usuarioC = await crearUsuarioDescartable(BASE, 'tsc');
  try {
    await fetch(`${BASE}/amigos/solicitar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: usuarioA.cookie },
      body: new URLSearchParams({ nombre_usuario: usuarioC.nombreUsuario }),
      redirect: 'manual',
    });
    const htmlAmigosC = await (await fetch(`${BASE}/amigos`, { headers: { Cookie: usuarioC.cookie } })).text();
    const idSolicitudA = htmlAmigosC.match(/\/amigos\/(\d+)\/aceptar/);
    assert.ok(idSolicitudA, 'C debería ver la solicitud de A');
    await fetch(`${BASE}/amigos/${idSolicitudA[1]}/aceptar`, {
      method: 'POST',
      headers: { Cookie: usuarioC.cookie },
      redirect: 'manual',
    });

    const htmlMetasA = await (await fetch(`${BASE}/metas`, { headers: { Cookie: usuarioA.cookie } })).text();
    const idCMatch = htmlMetasA.match(new RegExp(`value="(\\d+)"[^>]*>\\s*${usuarioC.nombreUsuario}`));
    assert.ok(idCMatch, 'A debería ver a C en el selector de participantes de meta compartida');

    const crear = await fetch(`${BASE}/metas/compartida`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: usuarioA.cookie },
      body: new URLSearchParams({ titulo: 'Meta de integración', valor_objetivo: '5', participantes: idCMatch[1] }),
      redirect: 'manual',
    });
    assert.equal(crear.status, 302);

    const { rows: metaRows } = await pool.query(
      "SELECT id FROM metas_compartidas WHERE titulo = 'Meta de integración' ORDER BY id DESC LIMIT 1"
    );
    assert.ok(metaRows.length, 'la meta compartida debería existir en la DB');
    const metaId = metaRows[0].id;

    // A (participante real) comparte la meta creada por C dentro del chat
    // A-B -- B NUNCA fue invitado por C, así que no participa todavía.
    const compartir = await fetch(`${BASE}/mensajes/meta`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: usuarioA.cookie },
      body: new URLSearchParams({ amistad_id: usuarioA.amistadIdConB, meta_tipo: 'compartida', meta_id: String(metaId) }),
      redirect: 'manual',
    });
    assert.equal(compartir.status, 302);

    const chatB = await (await fetch(`${BASE}/chat?amistad_id=${usuarioA.amistadIdConB}`, { headers: { Cookie: usuarioB.cookie } })).text();
    assert.ok(chatB.includes('Meta de integración'), 'B debería ver la tarjeta de la meta en el chat');
    assert.ok(chatB.includes('Unirme a esta meta'), 'B todavía no participa, debería ver el botón Unirme');

    const unirse = await fetch(`${BASE}/metas/compartida/${metaId}/unirme`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: usuarioB.cookie },
      body: new URLSearchParams({ amistad_id: usuarioA.amistadIdConB }),
      redirect: 'manual',
    });
    assert.equal(unirse.status, 302);

    const { rows: participaRows } = await pool.query(
      'SELECT 1 FROM metas_compartidas_participantes WHERE meta_compartida_id = $1 AND usuario_id = (SELECT id FROM usuarios WHERE nombre_usuario = $2)',
      [metaId, usuarioB.nombreUsuario]
    );
    assert.equal(participaRows.length, 1, 'B debería quedar como participante real en la DB tras unirse');
  } finally {
    // C ya cumplió su papel (probar que un tercero puede crear una meta
    // que un participante comparte en OTRO chat) -- se borra acá mismo,
    // no en el after() de la suite, porque solo este test la usa.
    await borrarUsuarioYDatos(BASE, usuarioC).catch(() => {});
  }
});

test('borrar ambas cuentas no revienta el server (regresión de los 2 bugs de FK/scope encontrados esta sesión)', async () => {
  // Este test es el motivo principal de esta suite: rama-chat-metas y
  // rama-fix-metas-huerfanas encontraron crashes reales de FK al borrar
  // cuentas con datos cruzados, y rama-racha-viva encontró un crash real
  // de scope -- las 3 veces solo se detectaron probando a mano contra
  // Railway. Si el server sigue respondiendo después de este borrado, no
  // hay violación de FK sin capturar ni excepción no manejada.
  const statusA = await borrarUsuarioYDatos(BASE, usuarioA);
  assert.equal(statusA, 302);
  const statusB = await borrarUsuarioYDatos(BASE, usuarioB);
  assert.equal(statusB, 302);
  usuarioA = null;
  usuarioB = null;

  const sigueVivo = await fetch(`${BASE}/login`);
  assert.equal(sigueVivo.status, 200, 'el server debe seguir respondiendo después de borrar ambas cuentas');
});
