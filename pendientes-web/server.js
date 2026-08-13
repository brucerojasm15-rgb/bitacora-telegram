require('dotenv').config();

const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const { Pool } = require('pg');
const webpush = require('web-push');
const cron = require('node-cron');

const app = express();
const PORT = process.env.PORT || 3000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    'mailto:brucerojasm15@gmail.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

app.set('view engine', 'ejs');
app.set('views', __dirname + '/views');
app.set('trust proxy', 1); // Railway hace proxy/TLS-termination; necesario para cookies "secure"
app.use(express.static(__dirname + '/public'));
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

app.use(
  session({
    store: new pgSession({ pool, tableName: 'session', createTableIfMissing: true }),
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: 'auto',
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 dias
    },
  })
);

/* ============================================================
   PASO 1 (ACCESS_KEY por query string) — DESACTIVADO, Paso 3 lo
   reemplaza por sesiones con login real. Se deja comentado (no
   borrado) para poder revertir rápido si algo falla con sesiones.
   Para revertir: comenta el middleware de sesión de abajo y
   descomenta este bloque completo.

const REINYECTAR_CLAVE_HTML = `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><title>Pendientes</title></head>
<body>
<script>
(function () {
  var params = new URLSearchParams(window.location.search);
  var guardada = localStorage.getItem('clave');
  if (guardada) {
    params.set('clave', guardada);
    window.location.replace(window.location.pathname + '?' + params.toString());
  }
})();
</script>
</body>
</html>`;

app.use((req, res, next) => {
  const clave = req.query.clave || req.body.clave;
  const claveValida = process.env.ACCESS_KEY && clave === process.env.ACCESS_KEY;
  if (claveValida) {
    req.clave = clave;
    return next();
  }
  const puedeReintentar = req.method === 'GET' && !req.query.clave;
  if (puedeReintentar) {
    return res.status(403).type('html').send(REINYECTAR_CLAVE_HTML);
  }
  return res.status(403).end();
});
============================================================ */

// Middleware de autenticación por sesión (Paso 3). Deja pasar /login y
// /registro sin exigir sesión (si no, nadie podría loguearse ni crear
// cuenta); todo lo demás requiere una sesión activa o redirige/rechaza.
app.use((req, res, next) => {
  if (req.path === '/login' || req.path === '/registro' || req.path === '/recuperar') return next();
  if (req.session && req.session.usuario_id) {
    req.usuarioId = req.session.usuario_id;
    return next();
  }
  if (req.method === 'GET') {
    return res.redirect('/login');
  }
  return res.status(401).end();
});

// Límite de intentos por IP (fuerza bruta en /login y /registro). En memoria:
// suficiente para una sola instancia; si la app crece a múltiples instancias
// habría que moverlo a la DB o a algo compartido como Redis.
const intentosPorIp = new Map();
const LIMITE_INTENTOS = 8;
const VENTANA_INTENTOS_MS = 15 * 60 * 1000;

function limitarIntentos(prefijo) {
  return (req, res, next) => {
    const clave = `${prefijo}:${req.ip}`;
    const ahora = Date.now();
    const entrada = intentosPorIp.get(clave);
    if (!entrada || ahora > entrada.resetAt) {
      intentosPorIp.set(clave, { count: 1, resetAt: ahora + VENTANA_INTENTOS_MS });
      return next();
    }
    if (entrada.count >= LIMITE_INTENTOS) {
      const esperaMin = Math.ceil((entrada.resetAt - ahora) / 60000);
      return res.status(429).send(`Demasiados intentos. Espera ${esperaMin} minuto(s) e intenta de nuevo.`);
    }
    entrada.count += 1;
    return next();
  };
}

setInterval(() => {
  const ahora = Date.now();
  for (const [clave, entrada] of intentosPorIp) {
    if (ahora > entrada.resetAt) intentosPorIp.delete(clave);
  }
}, 60 * 60 * 1000).unref();

// Límite de CUENTAS NUEVAS por IP por hora — distinto de limitarIntentos('registro')
// de arriba (que limita intentos totales, exitosos o no, contra fuerza bruta) porque
// resuelve un problema distinto: alguien con paciencia podría espaciar sus intentos
// para no gatillar el límite de fuerza bruta (8/15min = 32/hora) y aun así crear
// decenas de cuentas falsas por hora. Este límite cuenta SOLO registros exitosos.
// Número elegido (5/hora por IP): esta app es para un grupo chico de amigos/familia
// (ver el resto de COORDINACION.md — sistema de amistades, chat entre amigos), no
// una red social pública. 5 cubre el caso legítimo más exigente que se puede esperar
// (varias personas de la misma casa/red registrándose seguido en una sesión), y deja
// muy por debajo del límite de fuerza bruta existente (32/hora) para que farmear
// cuentas automatizadas deje de ser rentable sin bloquear el uso real.
const registrosPorIp = new Map();
const LIMITE_REGISTROS_EXITOSOS_POR_HORA = 5;
const VENTANA_REGISTROS_MS = 60 * 60 * 1000;

function limiteRegistrosAlcanzado(ip) {
  const entrada = registrosPorIp.get(ip);
  if (!entrada || Date.now() > entrada.resetAt) return false;
  return entrada.count >= LIMITE_REGISTROS_EXITOSOS_POR_HORA;
}

function registrarAltaExitosa(ip) {
  const ahora = Date.now();
  const entrada = registrosPorIp.get(ip);
  if (!entrada || ahora > entrada.resetAt) {
    registrosPorIp.set(ip, { count: 1, resetAt: ahora + VENTANA_REGISTROS_MS });
    return;
  }
  entrada.count += 1;
}

setInterval(() => {
  const ahora = Date.now();
  for (const [ip, entrada] of registrosPorIp) {
    if (ahora > entrada.resetAt) registrosPorIp.delete(ip);
  }
}, 60 * 60 * 1000).unref();

function verificarPin(pin, pinHashGuardado) {
  const partes = (pinHashGuardado || '').split(':');
  if (partes.length !== 2) return false;
  const [saltHex, hashHex] = partes;
  const salt = Buffer.from(saltHex, 'hex');
  const hashGuardado = Buffer.from(hashHex, 'hex');
  const hashIntento = crypto.scryptSync(pin, salt, hashGuardado.length);
  return hashGuardado.length === hashIntento.length && crypto.timingSafeEqual(hashGuardado, hashIntento);
}

function crearPinHash(pin) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pin, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

// Código de recuperación de PIN: mismo esquema hash que el PIN (crearPinHash/
// verificarPin funcionan con cualquier string, se reusan tal cual). Alfabeto
// sin 0/O/1/I/L para evitar confusión al copiarlo a mano.
const ALFABETO_CODIGO_RECUPERACION = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function generarCodigoRecuperacion() {
  const bytes = crypto.randomBytes(10);
  let codigo = '';
  for (let i = 0; i < bytes.length; i++) {
    codigo += ALFABETO_CODIGO_RECUPERACION[bytes[i] % ALFABETO_CODIGO_RECUPERACION.length];
  }
  return `${codigo.slice(0, 5)}-${codigo.slice(5)}`;
}

const NOMBRE_USUARIO_REGEX = /^[a-zA-Z0-9_]{3,20}$/;
const PIN_REGEX = /^\d{4,6}$/;

app.get('/login', (req, res) => {
  if (req.session && req.session.usuario_id) {
    return res.redirect('/');
  }
  res.render('login', { error: null });
});

app.post('/login', limitarIntentos('login'), async (req, res) => {
  const nombreUsuario = (req.body.nombre_usuario || '').trim().toLowerCase();
  const pin = req.body.pin || '';
  if (!nombreUsuario || !pin) {
    return res.render('login', { error: 'Completa usuario y PIN.' });
  }
  try {
    const { rows } = await pool.query('SELECT id, pin_hash FROM usuarios WHERE nombre_usuario = $1', [nombreUsuario]);
    const usuario = rows[0];
    if (!usuario || !verificarPin(pin, usuario.pin_hash)) {
      return res.render('login', { error: 'Usuario o PIN incorrecto.' });
    }
    req.session.usuario_id = usuario.id;
    req.session.nombre_usuario = nombreUsuario;
    res.redirect('/');
  } catch (err) {
    console.error('Error en login:', err.message);
    res.status(500).render('login', { error: 'Error del servidor, intenta de nuevo.' });
  }
});

app.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) console.error('Error cerrando sesion:', err.message);
    res.redirect('/login');
  });
});

app.get('/registro', (req, res) => {
  if (req.session && req.session.usuario_id) {
    return res.redirect('/');
  }
  res.render('registro', { error: null, nombreUsuario: '' });
});

app.post('/registro', limitarIntentos('registro'), async (req, res) => {
  const nombreUsuario = (req.body.nombre_usuario || '').trim().toLowerCase();
  const pin = req.body.pin || '';
  const confirmarPin = req.body.confirmar_pin || '';

  if (!NOMBRE_USUARIO_REGEX.test(nombreUsuario)) {
    return res.render('registro', {
      error: 'El usuario debe tener entre 3 y 20 caracteres (letras, números o _).',
      nombreUsuario,
    });
  }
  if (!PIN_REGEX.test(pin)) {
    return res.render('registro', { error: 'El PIN debe ser numérico, de 4 a 6 dígitos.', nombreUsuario });
  }
  if (pin !== confirmarPin) {
    return res.render('registro', { error: 'El PIN y su confirmación no coinciden.', nombreUsuario });
  }
  if (limiteRegistrosAlcanzado(req.ip)) {
    return res.render('registro', {
      error: 'Se alcanzó el límite de cuentas nuevas desde esta red en la última hora. Intenta de nuevo más tarde.',
      nombreUsuario,
    });
  }

  try {
    const pinHash = crearPinHash(pin);
    const codigoRecuperacion = generarCodigoRecuperacion();
    const codigoRecuperacionHash = crearPinHash(codigoRecuperacion);
    const { rows } = await pool.query(
      'INSERT INTO usuarios (nombre_usuario, pin_hash, codigo_recuperacion_hash) VALUES ($1, $2, $3) RETURNING id',
      [nombreUsuario, pinHash, codigoRecuperacionHash]
    );
    registrarAltaExitosa(req.ip);
    req.session.usuario_id = rows[0].id;
    req.session.nombre_usuario = nombreUsuario;
    res.render('codigo-recuperacion', {
      codigo: codigoRecuperacion,
      mensaje: 'Cuenta creada. Este es tu código de recuperación de PIN — apúntalo antes de continuar:',
      continuarUrl: '/',
    });
  } catch (err) {
    if (err.code === '23505') {
      return res.render('registro', { error: 'Ese nombre de usuario ya está en uso.', nombreUsuario });
    }
    console.error('Error en registro:', err.message);
    res.status(500).render('registro', { error: 'Error del servidor, intenta de nuevo.', nombreUsuario });
  }
});

app.get('/recuperar', (req, res) => {
  res.render('recuperar', { error: null, nombreUsuario: '' });
});

app.post('/recuperar', limitarIntentos('recuperar'), async (req, res) => {
  const nombreUsuario = (req.body.nombre_usuario || '').trim().toLowerCase();
  const codigo = (req.body.codigo || '').trim().toUpperCase();
  const pinActual = req.body.pin_actual || '';
  const pin = req.body.pin || '';
  const confirmarPin = req.body.confirmar_pin || '';

  if (!nombreUsuario || !codigo || !pinActual) {
    return res.render('recuperar', { error: 'Completa usuario, PIN actual y código de recuperación.', nombreUsuario });
  }
  if (!PIN_REGEX.test(pin)) {
    return res.render('recuperar', { error: 'El PIN nuevo debe ser numérico, de 4 a 6 dígitos.', nombreUsuario });
  }
  if (pin !== confirmarPin) {
    return res.render('recuperar', { error: 'El PIN nuevo y su confirmación no coinciden.', nombreUsuario });
  }

  try {
    const { rows } = await pool.query(
      'SELECT id, pin_hash, codigo_recuperacion_hash FROM usuarios WHERE nombre_usuario = $1',
      [nombreUsuario]
    );
    const usuario = rows[0];
    // Ahora se exigen AMBOS factores (PIN actual + código de recuperación).
    // Antes solo pedía el código, lo que permitía resetear el PIN de otra
    // cuenta sabiendo únicamente su código (hueco documentado en la sección
    // de rama-recuperacion-pin). Mismo mensaje genérico si cualquiera de
    // los dos falla, para no revelar cuál de los dos fue.
    if (
      !usuario ||
      !usuario.codigo_recuperacion_hash ||
      !verificarPin(codigo, usuario.codigo_recuperacion_hash) ||
      !verificarPin(pinActual, usuario.pin_hash)
    ) {
      return res.render('recuperar', { error: 'Usuario o código incorrecto.', nombreUsuario });
    }
    const nuevoPinHash = crearPinHash(pin);
    const nuevoCodigo = generarCodigoRecuperacion();
    const nuevoCodigoHash = crearPinHash(nuevoCodigo);
    await pool.query(
      'UPDATE usuarios SET pin_hash = $1, codigo_recuperacion_hash = $2 WHERE id = $3',
      [nuevoPinHash, nuevoCodigoHash, usuario.id]
    );
    res.render('codigo-recuperacion', {
      codigo: nuevoCodigo,
      mensaje: 'Tu PIN se actualizó. Este es tu nuevo código de recuperación — apúntalo antes de continuar:',
      continuarUrl: '/login',
    });
  } catch (err) {
    console.error('Error en recuperación de PIN:', err.message);
    res.status(500).render('recuperar', { error: 'Error del servidor, intenta de nuevo.', nombreUsuario });
  }
});

async function ensureSchema() {
  // usuarios debe existir antes que cualquier ALTER TABLE que la referencie.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id SERIAL PRIMARY KEY,
      nombre_usuario TEXT UNIQUE,
      pin_hash TEXT,
      creado TIMESTAMP DEFAULT now()
    )
  `);
  await pool.query(`
    ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS codigo_recuperacion_hash TEXT
  `);
  await pool.query(`
    ALTER TABLE pendientes
      ADD COLUMN IF NOT EXISTS contador_posposiciones INT DEFAULT 0,
      ADD COLUMN IF NOT EXISTS necesita_reflexion BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS usuario_id INT REFERENCES usuarios(id),
      ADD COLUMN IF NOT EXISTS categoria TEXT,
      ADD COLUMN IF NOT EXISTS asignado_a INT REFERENCES usuarios(id),
      ADD COLUMN IF NOT EXISTS eliminado BOOLEAN DEFAULT false
  `);
  await pool.query(`
    ALTER TABLE ideas ADD COLUMN IF NOT EXISTS usuario_id INT REFERENCES usuarios(id)
  `);
  await pool.query(`
    ALTER TABLE recordatorios ADD COLUMN IF NOT EXISTS usuario_id INT REFERENCES usuarios(id)
  `);
  await pool.query(`
    ALTER TABLE hechos ADD COLUMN IF NOT EXISTS usuario_id INT REFERENCES usuarios(id)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS reflexiones (
      id SERIAL PRIMARY KEY,
      pendiente_id INT REFERENCES pendientes(id),
      pregunta TEXT,
      respuesta TEXT,
      fecha TIMESTAMP DEFAULT now()
    )
  `);
  await pool.query(`
    ALTER TABLE reflexiones ADD COLUMN IF NOT EXISTS usuario_id INT REFERENCES usuarios(id)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id SERIAL PRIMARY KEY,
      endpoint TEXT,
      p256dh TEXT,
      auth TEXT,
      creado TIMESTAMP DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS amistades (
      id SERIAL PRIMARY KEY,
      usuario_a_id INT REFERENCES usuarios(id),
      usuario_b_id INT REFERENCES usuarios(id),
      UNIQUE (usuario_a_id, usuario_b_id)
    )
  `);
  // usuario_a_id = quien envía la solicitud, usuario_b_id = quien la recibe.
  // Columnas agregadas por rama-amigos (ver COORDINACION.md) — no se recreó la tabla.
  await pool.query(`
    ALTER TABLE amistades
      ADD COLUMN IF NOT EXISTS estado TEXT NOT NULL DEFAULT 'pendiente',
      ADD COLUMN IF NOT EXISTS fecha TIMESTAMP DEFAULT now()
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS mensajes (
      id SERIAL PRIMARY KEY,
      amistad_id INT REFERENCES amistades(id),
      autor_id INT REFERENCES usuarios(id),
      texto TEXT,
      fecha TIMESTAMP DEFAULT now(),
      leido BOOLEAN DEFAULT false
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS historial_ediciones (
      id SERIAL PRIMARY KEY,
      pendiente_id INT REFERENCES pendientes(id),
      texto_anterior TEXT,
      editado TIMESTAMP DEFAULT now()
    )
  `);
}

// Categorías sugeridas para clasificar pendientes (rama-categorias). Lista
// cerrada simple, mismo espíritu que RANGOS_VALIDOS más abajo: si el valor
// recibido (crear/editar/filtrar) no está en esta lista, se ignora/guarda
// como sin categoría en vez de fallar.
const CATEGORIAS_VALIDAS = ['personal', 'trabajo', 'fundo', 'salud', 'otro'];

// rama-tareas-compartidas: confirma amistad directa aceptada entre dos
// usuarios (no requiere amistad_id, a diferencia de usuarioPerteneceAmistad
// que valida contra una fila específica de amistades).
async function usuariosSonAmigos(usuarioIdA, usuarioIdB) {
  const { rows } = await pool.query(
    `SELECT 1 FROM amistades
     WHERE estado = 'aceptada'
       AND ((usuario_a_id = $1 AND usuario_b_id = $2) OR (usuario_a_id = $2 AND usuario_b_id = $1))`,
    [usuarioIdA, usuarioIdB]
  );
  return rows.length > 0;
}

async function usuarioPerteneceAmistad(usuarioId, amistadId) {
  const { rows } = await pool.query(
    "SELECT 1 FROM amistades WHERE id = $1 AND estado = 'aceptada' AND (usuario_a_id = $2 OR usuario_b_id = $2)",
    [amistadId, usuarioId]
  );
  return rows.length > 0;
}

app.get('/', async (req, res) => {
  const categoriaFiltro = CATEGORIAS_VALIDAS.includes(req.query.categoria) ? req.query.categoria : null;
  const q = (req.query.q || '').trim();
  try {
    // rama-tareas-compartidas: además de los propios, trae los pendientes
    // que un amigo le asignó (asignado_a = usuarioId). Se trae el nombre de
    // quien lo creó para mostrar "Asignado por @fulano" en esos casos.
    const params = [req.usuarioId];
    let consulta = `SELECT p.id, p.texto, p.creado, p.necesita_reflexion, p.categoria, p.usuario_id, p.asignado_a,
              uc.nombre_usuario AS creador_nombre
       FROM pendientes p
       LEFT JOIN usuarios uc ON uc.id = p.usuario_id
       WHERE p.hecho = FALSE AND p.eliminado = FALSE AND (p.usuario_id = $1 OR p.asignado_a = $1)`;
    if (categoriaFiltro) {
      params.push(categoriaFiltro);
      consulta += ` AND p.categoria = $${params.length}`;
    }
    if (q) {
      params.push(`%${q}%`);
      consulta += ` AND p.texto ILIKE $${params.length}`;
    }
    consulta += ' ORDER BY p.creado ASC';
    const { rows } = await pool.query(consulta, params);
    res.render('index', {
      pendientes: rows,
      error: null,
      vapidPublicKey: process.env.VAPID_PUBLIC_KEY || '',
      categorias: CATEGORIAS_VALIDAS,
      categoriaFiltro,
      q,
      usuarioId: req.usuarioId,
    });
  } catch (err) {
    console.error('Error consultando pendientes:', err.message);
    res.status(500).render('index', {
      pendientes: [],
      error: 'No se pudo leer la base de datos.',
      vapidPublicKey: process.env.VAPID_PUBLIC_KEY || '',
      categorias: CATEGORIAS_VALIDAS,
      categoriaFiltro,
      q,
      usuarioId: req.usuarioId,
    });
  }
});

app.post('/pendientes', async (req, res) => {
  const texto = (req.body.texto || '').trim();
  const categoria = CATEGORIAS_VALIDAS.includes(req.body.categoria) ? req.body.categoria : null;
  if (!texto) {
    return res.status(400).send('El texto no puede estar vacío');
  }
  try {
    await pool.query(
      'INSERT INTO pendientes (texto, creado, hecho, usuario_id, categoria) VALUES ($1, now(), FALSE, $2, $3)',
      [texto, req.usuarioId, categoria]
    );
  } catch (err) {
    console.error('Error creando pendiente:', err.message);
  }
  res.redirect('/');
});

app.post('/pendientes/:id/completar', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).send('id inválido');
  }
  try {
    await pool.query(
      'UPDATE pendientes SET hecho = TRUE WHERE id = $1 AND usuario_id = $2 AND eliminado = FALSE',
      [id, req.usuarioId]
    );
  } catch (err) {
    console.error('Error marcando pendiente como hecho:', err.message);
  }
  res.redirect('/');
});

// Borrado lógico: nunca DELETE real. historial_ediciones referencia
// pendientes(id) sin ON DELETE CASCADE (a propósito, ver rama-historial-
// ediciones), así que un DELETE real fallaría por la FK apenas el pendiente
// tuviera alguna edición registrada — o forzaría borrar también su
// historial, que es justo lo que esa rama garantiza que sea inmutable.
app.post('/pendientes/:id/eliminar', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).send('id inválido');
  }
  try {
    await pool.query(
      'UPDATE pendientes SET eliminado = TRUE WHERE id = $1 AND usuario_id = $2',
      [id, req.usuarioId]
    );
  } catch (err) {
    console.error('Error eliminando pendiente:', err.message);
  }
  res.redirect('/');
});

app.post('/pendientes/:id/posponer', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).send('id inválido');
  }
  try {
    await pool.query(
      `UPDATE pendientes
       SET contador_posposiciones = contador_posposiciones + 1,
           necesita_reflexion = (contador_posposiciones + 1) >= 3
       WHERE id = $1 AND usuario_id = $2 AND eliminado = FALSE`,
      [id, req.usuarioId]
    );
  } catch (err) {
    console.error('Error posponiendo pendiente:', err.message);
  }
  res.redirect('/');
});

app.post('/pendientes/:id/reflexion', async (req, res) => {
  const id = Number(req.params.id);
  const respuesta = (req.body.respuesta || '').trim();
  if (!Number.isInteger(id)) {
    return res.status(400).send('id inválido');
  }
  if (!respuesta) {
    return res.status(400).send('La respuesta no puede estar vacía');
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'INSERT INTO reflexiones (pendiente_id, pregunta, respuesta, usuario_id) VALUES ($1, $2, $3, $4)',
      [id, '¿Qué pasa?', respuesta, req.usuarioId]
    );
    await client.query(
      'UPDATE pendientes SET contador_posposiciones = 0, necesita_reflexion = FALSE WHERE id = $1 AND usuario_id = $2 AND eliminado = FALSE',
      [id, req.usuarioId]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error guardando reflexion:', err.message);
  } finally {
    client.release();
  }
  res.redirect('/');
});

app.post('/suscribir', async (req, res) => {
  const { subscription } = req.body;
  if (!subscription || !subscription.endpoint || !subscription.keys) {
    return res.status(400).send('Suscripción inválida');
  }
  try {
    const existente = await pool.query(
      'SELECT id FROM push_subscriptions WHERE endpoint = $1',
      [subscription.endpoint]
    );
    if (existente.rows.length === 0) {
      await pool.query(
        'INSERT INTO push_subscriptions (endpoint, p256dh, auth) VALUES ($1, $2, $3)',
        [subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth]
      );
    }
  } catch (err) {
    console.error('Error guardando suscripcion:', err.message);
    return res.status(500).send('No se pudo guardar la suscripción');
  }
  res.status(201).send('ok');
});

async function enviarPushATodos(payloadObjeto) {
  const { rows } = await pool.query('SELECT id, endpoint, p256dh, auth FROM push_subscriptions');
  const payload = JSON.stringify(payloadObjeto);

  const resultados = await Promise.allSettled(
    rows.map((s) =>
      webpush
        .sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload)
        .catch(async (err) => {
          if (err.statusCode === 404 || err.statusCode === 410) {
            await pool.query('DELETE FROM push_subscriptions WHERE id = $1', [s.id]);
          }
          throw err;
        })
    )
  );

  const enviadas = resultados.filter((r) => r.status === 'fulfilled').length;
  return { enviadas, total: rows.length };
}

function payloadRecordatorioDiario() {
  return {
    title: 'Bitácora',
    body: 'No has registrado nada hecho hoy — ¿qué avanzaste?',
    actions: [
      { action: 'abrir', title: 'Abrir' },
      { action: 'agregar', title: 'Agregar pendiente' },
    ],
    data: {
      defaultUrl: '/',
      urls: {
        abrir: '/',
        agregar: '/#nuevo-pendiente',
      },
    },
  };
}

async function revisarYNotificarSiNoHayHechosHoy() {
  try {
    const { rows } = await pool.query(`
      SELECT COUNT(*) FROM hechos
      WHERE cuando >= date_trunc('day', now() AT TIME ZONE 'America/Lima') AT TIME ZONE 'America/Lima'
    `);
    const cantidadHoy = parseInt(rows[0].count, 10);
    if (cantidadHoy > 0) {
      console.log(`[cron] Ya hay ${cantidadHoy} hecho(s) hoy, no se notifica.`);
      return;
    }
    const { enviadas, total } = await enviarPushATodos(payloadRecordatorioDiario());
    console.log(`[cron] Sin hechos hoy: notificacion enviada a ${enviadas}/${total} suscripcion(es).`);
  } catch (err) {
    console.error('[cron] Error en el job de notificacion diaria:', err.message);
  }
}

function cronDesdeHora(horaStr) {
  const partes = (horaStr || '20:00').split(':');
  const hora = parseInt(partes[0], 10);
  const minuto = parseInt(partes[1], 10);
  const horaValida = Number.isInteger(hora) && hora >= 0 && hora <= 23 ? hora : 20;
  const minutoValido = Number.isInteger(minuto) && minuto >= 0 && minuto <= 59 ? minuto : 0;
  return `${minutoValido} ${horaValida} * * *`;
}

cron.schedule(cronDesdeHora(process.env.HORA_NOTIFICACION), revisarYNotificarSiNoHayHechosHoy, {
  timezone: 'America/Lima',
});

app.post('/notificar-prueba', async (req, res) => {
  try {
    const { enviadas, total } = await enviarPushATodos({ title: 'Bitácora', body: 'Hola desde tu bitácora' });
    res.send(`Notificaciones enviadas: ${enviadas}/${total}`);
  } catch (err) {
    console.error('Error enviando notificaciones:', err.message);
    res.status(500).send('Error enviando notificaciones');
  }
});

const RANGOS_VALIDOS = ['7', '30', 'todo'];

function whereRango(rango, columnaFecha) {
  if (rango === '7') return `AND ${columnaFecha} >= NOW() - INTERVAL '7 days'`;
  if (rango === '30') return `AND ${columnaFecha} >= NOW() - INTERVAL '30 days'`;
  return '';
}

// --- Helpers para /estadisticas ---
// La tabla `pendientes` no tiene una columna de "fecha de completado": solo
// `creado` (cuándo se creó el pendiente) y `hecho` (si ya se completó o no).
// Por eso, tanto "completadas por semana" como la "racha de días" usan
// `creado` como aproximación de cuándo se completó. Si un pendiente se crea
// un día y se completa varios días después, estas métricas lo cuentan en la
// semana/día en que se CREÓ, no en el que se completó. Documentado también
// en la vista.
const VENCIDO_DIAS = 7; // "vencido" = pendiente sin hacer, creado hace más de 7 días.

function formatearDiaLima(fecha) {
  return new Date(fecha).toLocaleDateString('en-CA', { timeZone: 'America/Lima' });
}

function diaAnterior(diaStr) {
  const d = new Date(diaStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// Cuenta días consecutivos (calendario America/Lima) con al menos un
// pendiente completado, contando hacia atrás desde hoy. Si hoy todavía no
// se completó nada, la racha no se rompe por eso (el día actual no terminó
// todavía) y se empieza a contar desde ayer.
function calcularRacha(diasSet) {
  const hoyLima = formatearDiaLima(new Date());
  let cursor = diasSet.has(hoyLima) ? hoyLima : diaAnterior(hoyLima);
  let racha = 0;
  while (diasSet.has(cursor)) {
    racha++;
    cursor = diaAnterior(cursor);
  }
  return racha;
}

app.get('/estadisticas', async (req, res) => {
  try {
    const [porSemana, vencidos, completados] = await Promise.all([
      pool.query(
        `SELECT
           to_char(date_trunc('week', creado AT TIME ZONE 'America/Lima'), 'YYYY-MM-DD') AS semana,
           COUNT(*)::int AS cantidad
         FROM pendientes
         WHERE hecho = TRUE AND eliminado = FALSE AND usuario_id = $1
         GROUP BY semana
         ORDER BY semana DESC
         LIMIT 12`,
        [req.usuarioId]
      ),
      pool.query(
        `SELECT id, texto, creado
         FROM pendientes
         WHERE hecho = FALSE AND eliminado = FALSE AND usuario_id = $1 AND creado < NOW() - INTERVAL '${VENCIDO_DIAS} days'
         ORDER BY creado ASC`,
        [req.usuarioId]
      ),
      pool.query(
        'SELECT creado FROM pendientes WHERE hecho = TRUE AND eliminado = FALSE AND usuario_id = $1',
        [req.usuarioId]
      ),
    ]);

    const diasCompletados = new Set(completados.rows.map((r) => formatearDiaLima(r.creado)));
    const racha = calcularRacha(diasCompletados);

    res.render('estadisticas', {
      porSemana: porSemana.rows,
      vencidos: vencidos.rows,
      racha,
      vencidoDias: VENCIDO_DIAS,
      error: null,
    });
  } catch (err) {
    console.error('Error consultando estadisticas:', err.message);
    res.status(500).render('estadisticas', {
      porSemana: [],
      vencidos: [],
      racha: 0,
      vencidoDias: VENCIDO_DIAS,
      error: 'No se pudo leer la base de datos.',
    });
  }
});

// rama-captura-rapida: decisión de esquema documentada en COORDINACION.md —
// se reusan las 3 tablas ya existentes (pendientes/ideas/recordatorios, las
// mismas que ya llena el bot de Telegram) en vez de crear una tabla única
// con columna `tipo`. No hace falta ALTER TABLE nuevo: las 3 ya tienen
// usuario_id desde ramas anteriores.
const TIPOS_CAPTURA_VALIDOS = ['pendiente', 'idea', 'recordatorio'];

app.get('/captura', (req, res) => {
  res.render('captura', { error: null, guardado: req.query.guardado === '1' });
});

app.post('/captura', async (req, res) => {
  const texto = (req.body.texto || '').trim();
  const tipo = req.body.tipo;
  if (!texto || !TIPOS_CAPTURA_VALIDOS.includes(tipo)) {
    return res.status(400).render('captura', { error: 'Escribe algo y elige un tipo válido.' });
  }
  if (tipo === 'recordatorio' && !req.body.cuando) {
    return res.status(400).render('captura', { error: 'Los recordatorios necesitan fecha y hora.' });
  }
  try {
    if (tipo === 'pendiente') {
      await pool.query(
        'INSERT INTO pendientes (texto, creado, hecho, usuario_id) VALUES ($1, now(), FALSE, $2)',
        [texto, req.usuarioId]
      );
    } else if (tipo === 'idea') {
      await pool.query(
        'INSERT INTO ideas (fecha, idea, estado, usuario_id) VALUES ($1, $2, NULL, $3)',
        [new Date().toISOString(), texto, req.usuarioId]
      );
    } else {
      await pool.query(
        'INSERT INTO recordatorios (texto, cuando, avisado, usuario_id) VALUES ($1, $2, FALSE, $3)',
        [texto, new Date(req.body.cuando), req.usuarioId]
      );
    }
  } catch (err) {
    console.error('Error guardando captura rápida:', err.message);
    return res.status(500).render('captura', { error: 'No se pudo guardar. Intenta de nuevo.' });
  }
  res.redirect('/captura?guardado=1');
});

app.get('/ideas', async (req, res) => {
  const rango = RANGOS_VALIDOS.includes(req.query.rango) ? req.query.rango : 'todo';
  try {
    const { rows } = await pool.query(
      `SELECT id, fecha, idea, estado FROM ideas WHERE usuario_id = $1 ${whereRango(rango, 'fecha::timestamptz')} ORDER BY id DESC`,
      [req.usuarioId]
    );
    res.render('ideas', { ideas: rows, error: null, rango });
  } catch (err) {
    console.error('Error consultando ideas:', err.message);
    res.status(500).render('ideas', { ideas: [], error: 'No se pudo leer la base de datos.', rango });
  }
});

app.get('/recordatorios', async (req, res) => {
  const rango = RANGOS_VALIDOS.includes(req.query.rango) ? req.query.rango : 'todo';
  try {
    const { rows } = await pool.query(
      `SELECT id, texto, cuando, avisado FROM recordatorios WHERE usuario_id = $1 ${whereRango(rango, 'cuando')} ORDER BY id DESC`,
      [req.usuarioId]
    );
    res.render('recordatorios', { recordatorios: rows, error: null, rango });
  } catch (err) {
    console.error('Error consultando recordatorios:', err.message);
    res.status(500).render('recordatorios', { recordatorios: [], error: 'No se pudo leer la base de datos.', rango });
  }
});

app.get('/hechos', async (req, res) => {
  const rango = RANGOS_VALIDOS.includes(req.query.rango) ? req.query.rango : 'todo';
  try {
    const { rows } = await pool.query(
      `SELECT id, texto, cuando FROM hechos WHERE usuario_id = $1 ${whereRango(rango, 'cuando')} ORDER BY id DESC`,
      [req.usuarioId]
    );
    res.render('hechos', { hechos: rows, error: null, rango });
  } catch (err) {
    console.error('Error consultando hechos:', err.message);
    res.status(500).render('hechos', { hechos: [], error: 'No se pudo leer la base de datos.', rango });
  }
});

app.get('/pendientes/:id/editar', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).send('id inválido');
  }
  try {
    // rama-tareas-compartidas: además del texto/categoría, trae a quién está
    // asignado (si aplica). Solo el dueño puede editar o reasignar.
    const { rows } = await pool.query(
      `SELECT p.id, p.texto, p.categoria, p.asignado_a, ua.nombre_usuario AS asignado_a_nombre
       FROM pendientes p
       LEFT JOIN usuarios ua ON ua.id = p.asignado_a
       WHERE p.id = $1 AND p.usuario_id = $2 AND p.eliminado = FALSE`,
      [id, req.usuarioId]
    );
    if (rows.length === 0) {
      return res.status(404).send('Pendiente no encontrado');
    }
    const { rows: amigos } = await pool.query(
      `SELECT u.id, u.nombre_usuario
       FROM amistades a
       JOIN usuarios u ON u.id = CASE WHEN a.usuario_a_id = $1 THEN a.usuario_b_id ELSE a.usuario_a_id END
       WHERE a.estado = 'aceptada' AND (a.usuario_a_id = $1 OR a.usuario_b_id = $1)
       ORDER BY u.nombre_usuario ASC`,
      [req.usuarioId]
    );
    res.render('editar', { pendiente: rows[0], categorias: CATEGORIAS_VALIDAS, amigos });
  } catch (err) {
    console.error('Error cargando pendiente para editar:', err.message);
    res.status(500).send('No se pudo cargar el pendiente');
  }
});

app.post('/pendientes/:id/editar', async (req, res) => {
  const id = Number(req.params.id);
  const texto = (req.body.texto || '').trim();
  const categoria = CATEGORIAS_VALIDAS.includes(req.body.categoria) ? req.body.categoria : null;
  if (!Number.isInteger(id)) {
    return res.status(400).send('id inválido');
  }
  if (!texto) {
    return res.status(400).send('El texto no puede estar vacío');
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const actual = await client.query(
      'SELECT texto FROM pendientes WHERE id = $1 AND usuario_id = $2 AND eliminado = FALSE',
      [id, req.usuarioId]
    );
    if (actual.rows.length > 0) {
      await client.query(
        'INSERT INTO historial_ediciones (pendiente_id, texto_anterior) VALUES ($1, $2)',
        [id, actual.rows[0].texto]
      );
      await client.query(
        'UPDATE pendientes SET texto = $1, categoria = $2 WHERE id = $3 AND usuario_id = $4',
        [texto, categoria, id, req.usuarioId]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error actualizando pendiente:', err.message);
  } finally {
    client.release();
  }
  res.redirect('/');
});

app.post('/pendientes/:id/asignar', async (req, res) => {
  const id = Number(req.params.id);
  const nombreUsuario = (req.body.nombre_usuario || '').trim().toLowerCase();
  if (!Number.isInteger(id)) {
    return res.status(400).send('id inválido');
  }
  try {
    const { rows: propios } = await pool.query(
      'SELECT id FROM pendientes WHERE id = $1 AND usuario_id = $2 AND eliminado = FALSE',
      [id, req.usuarioId]
    );
    if (propios.length === 0) {
      return res.status(404).send('Pendiente no encontrado');
    }

    if (!nombreUsuario) {
      // Selector vacío = quitar la asignación actual.
      await pool.query('UPDATE pendientes SET asignado_a = NULL WHERE id = $1 AND usuario_id = $2', [id, req.usuarioId]);
      return res.redirect('/pendientes/' + id + '/editar');
    }

    const { rows: destinatarioRows } = await pool.query(
      'SELECT id FROM usuarios WHERE nombre_usuario = $1',
      [nombreUsuario]
    );
    const destinatario = destinatarioRows[0];
    if (!destinatario) {
      return res.status(400).send('No existe ningún usuario con ese nombre.');
    }
    if (destinatario.id === req.usuarioId) {
      return res.status(400).send('No puedes asignarte un pendiente a ti mismo.');
    }
    const sonAmigos = await usuariosSonAmigos(req.usuarioId, destinatario.id);
    if (!sonAmigos) {
      return res.status(403).send('Solo puedes asignar pendientes a un amigo (amistad aceptada).');
    }

    await pool.query('UPDATE pendientes SET asignado_a = $1 WHERE id = $2 AND usuario_id = $3', [destinatario.id, id, req.usuarioId]);
  } catch (err) {
    console.error('Error asignando pendiente:', err.message);
    return res.status(500).send('No se pudo asignar el pendiente.');
  }
  res.redirect('/pendientes/' + id + '/editar');
});

app.get('/exportar', async (req, res) => {
  let ExcelJS;
  try {
    ExcelJS = require('exceljs');
  } catch (err) {
    console.error('Error cargando exceljs:', err.message);
    return res.status(500).send('Exportar no está disponible ahora mismo.');
  }

  try {
    const workbook = new ExcelJS.Workbook();
    const tablas = [
      { nombre: 'Pendientes', query: 'SELECT * FROM pendientes WHERE usuario_id = $1 AND eliminado = FALSE ORDER BY id' },
      { nombre: 'Ideas', query: 'SELECT * FROM ideas WHERE usuario_id = $1 ORDER BY id' },
      { nombre: 'Recordatorios', query: 'SELECT * FROM recordatorios WHERE usuario_id = $1 ORDER BY id' },
      { nombre: 'Hechos', query: 'SELECT * FROM hechos WHERE usuario_id = $1 ORDER BY id' },
      { nombre: 'Reflexiones', query: 'SELECT * FROM reflexiones WHERE usuario_id = $1 ORDER BY id' },
    ];

    for (const { nombre, query } of tablas) {
      const { rows, fields } = await pool.query(query, [req.usuarioId]);
      const hoja = workbook.addWorksheet(nombre);
      hoja.columns = fields.map((f) => ({ header: f.name, key: f.name, width: 22 }));
      rows.forEach((fila) => hoja.addRow(fila));
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="bitacora.xlsx"');
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('Error exportando a Excel:', err.message);
    if (!res.headersSent) {
      res.status(500).send('No se pudo generar el Excel');
    } else {
      res.end();
    }
  }
});

// Vista y rutas de amigos (rama-amigos). Usa la tabla amistades ya creada
// por rama-chat (id, usuario_a_id, usuario_b_id) más las columnas estado y
// fecha agregadas arriba con ALTER TABLE. Convención propia de esta rama,
// documentada en COORDINACION.md: usuario_a_id = quien envía la solicitud,
// usuario_b_id = quien la recibe; estado ∈ {pendiente, aceptada, rechazada}.
app.get('/amigos', async (req, res) => {
  try {
    const [amigos, recibidas, enviadas] = await Promise.all([
      pool.query(
        `SELECT a.id AS amistad_id, u.id AS usuario_id, u.nombre_usuario
         FROM amistades a
         JOIN usuarios u ON u.id = CASE WHEN a.usuario_a_id = $1 THEN a.usuario_b_id ELSE a.usuario_a_id END
         WHERE a.estado = 'aceptada' AND (a.usuario_a_id = $1 OR a.usuario_b_id = $1)
         ORDER BY u.nombre_usuario ASC`,
        [req.usuarioId]
      ),
      pool.query(
        `SELECT a.id AS amistad_id, u.nombre_usuario, a.fecha
         FROM amistades a
         JOIN usuarios u ON u.id = a.usuario_a_id
         WHERE a.usuario_b_id = $1 AND a.estado = 'pendiente'
         ORDER BY a.fecha DESC`,
        [req.usuarioId]
      ),
      pool.query(
        `SELECT a.id AS amistad_id, u.nombre_usuario, a.fecha
         FROM amistades a
         JOIN usuarios u ON u.id = a.usuario_b_id
         WHERE a.usuario_a_id = $1 AND a.estado = 'pendiente'
         ORDER BY a.fecha DESC`,
        [req.usuarioId]
      ),
    ]);
    res.render('amigos', {
      amigos: amigos.rows,
      recibidas: recibidas.rows,
      enviadas: enviadas.rows,
      error: null,
    });
  } catch (err) {
    console.error('Error consultando amigos:', err.message);
    res.status(500).render('amigos', {
      amigos: [],
      recibidas: [],
      enviadas: [],
      error: 'No se pudo leer la base de datos.',
    });
  }
});

app.post('/amigos/solicitar', async (req, res) => {
  const nombreUsuario = (req.body.nombre_usuario || '').trim().toLowerCase();
  if (!nombreUsuario) {
    return res.status(400).send('Escribe un nombre de usuario.');
  }
  try {
    const { rows: destinatarioRows } = await pool.query(
      'SELECT id FROM usuarios WHERE nombre_usuario = $1',
      [nombreUsuario]
    );
    const destinatario = destinatarioRows[0];
    if (!destinatario) {
      return res.status(400).send('No existe ningún usuario con ese nombre.');
    }
    if (destinatario.id === req.usuarioId) {
      return res.status(400).send('No puedes agregarte a ti mismo.');
    }
    const { rows: existentes } = await pool.query(
      `SELECT id, estado FROM amistades
       WHERE (usuario_a_id = $1 AND usuario_b_id = $2) OR (usuario_a_id = $2 AND usuario_b_id = $1)`,
      [req.usuarioId, destinatario.id]
    );
    const existente = existentes[0];
    if (existente && existente.estado === 'aceptada') {
      return res.status(400).send('Ya son amigos.');
    }
    if (existente && existente.estado === 'pendiente') {
      return res.status(400).send('Ya existe una solicitud pendiente con este usuario.');
    }
    if (existente && existente.estado === 'rechazada') {
      // Se había rechazado antes: se reabre como nueva solicitud desde quien la reenvía.
      await pool.query(
        `UPDATE amistades SET usuario_a_id = $1, usuario_b_id = $2, estado = 'pendiente', fecha = now()
         WHERE id = $3`,
        [req.usuarioId, destinatario.id, existente.id]
      );
    } else {
      await pool.query(
        `INSERT INTO amistades (usuario_a_id, usuario_b_id, estado, fecha) VALUES ($1, $2, 'pendiente', now())`,
        [req.usuarioId, destinatario.id]
      );
    }
  } catch (err) {
    console.error('Error creando solicitud de amistad:', err.message);
    return res.status(500).send('No se pudo enviar la solicitud.');
  }
  res.redirect('/amigos');
});

app.post('/amigos/:id/aceptar', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).send('id inválido');
  }
  try {
    const { rowCount } = await pool.query(
      `UPDATE amistades SET estado = 'aceptada' WHERE id = $1 AND usuario_b_id = $2 AND estado = 'pendiente'`,
      [id, req.usuarioId]
    );
    if (rowCount === 0) {
      return res.status(404).send('Solicitud no encontrada.');
    }
  } catch (err) {
    console.error('Error aceptando solicitud de amistad:', err.message);
    return res.status(500).send('No se pudo aceptar la solicitud.');
  }
  res.redirect('/amigos');
});

app.post('/amigos/:id/rechazar', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).send('id inválido');
  }
  try {
    const { rowCount } = await pool.query(
      `UPDATE amistades SET estado = 'rechazada' WHERE id = $1 AND usuario_b_id = $2 AND estado = 'pendiente'`,
      [id, req.usuarioId]
    );
    if (rowCount === 0) {
      return res.status(404).send('Solicitud no encontrada.');
    }
  } catch (err) {
    console.error('Error rechazando solicitud de amistad:', err.message);
    return res.status(500).send('No se pudo rechazar la solicitud.');
  }
  res.redirect('/amigos');
});

// Vista y rutas de chat. Todavía no está enlazada al menú de navegación
// principal (partials/nav.ejs) ni depende de la tabla amistades, que se
// construye en otra rama.
app.get('/chat', async (req, res) => {
  const amistadId = Number(req.query.amistad_id);
  const buscar = (req.query.buscar || '').trim();
  if (!Number.isInteger(amistadId)) {
    return res.render('chat', { mensajes: [], amistadId: null, error: null, usuarioId: req.usuarioId, buscar });
  }
  try {
    const pertenece = await usuarioPerteneceAmistad(req.usuarioId, amistadId);
    if (!pertenece) {
      return res.status(403).render('chat', { mensajes: [], amistadId: null, error: 'No tienes acceso a esta conversación.', usuarioId: req.usuarioId, buscar });
    }
    const params = [amistadId];
    let consulta = 'SELECT id, amistad_id, autor_id, texto, fecha, leido FROM mensajes WHERE amistad_id = $1';
    if (buscar) {
      params.push(`%${buscar}%`);
      consulta += ` AND texto ILIKE $${params.length}`;
    }
    consulta += ' ORDER BY fecha ASC';
    const { rows } = await pool.query(consulta, params);
    // Se capturan los mensajes ANTES de marcarlos como leídos, para que la
    // vista todavía pueda mostrar cuáles llegaron sin leer en esta apertura
    // del chat. Solo se marcan los mensajes del OTRO usuario: los propios no
    // se tocan (su estado `leido` indica si el otro ya los vio).
    await pool.query(
      'UPDATE mensajes SET leido = true WHERE amistad_id = $1 AND autor_id != $2 AND leido = false',
      [amistadId, req.usuarioId]
    );
    res.render('chat', { mensajes: rows, amistadId, error: null, usuarioId: req.usuarioId, buscar });
  } catch (err) {
    console.error('Error consultando mensajes:', err.message);
    res.status(500).render('chat', { mensajes: [], amistadId, error: 'No se pudo leer la base de datos.', usuarioId: req.usuarioId, buscar });
  }
});

// Notificaciones: cuántos mensajes sin leer tiene el usuario logueado en
// total, sumando todas las conversaciones (amistades) a las que pertenece.
// Pensado para que otras vistas (ej. una futura lista de conversaciones o
// el menú de navegación) puedan mostrar un contador sin tener que abrir
// cada chat. No depende de columnas que agregue rama-amigos (`estado`),
// solo de las que ya existen en main.
app.get('/notificaciones', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS no_leidos
       FROM mensajes m
       JOIN amistades a ON a.id = m.amistad_id
       WHERE (a.usuario_a_id = $1 OR a.usuario_b_id = $1)
         AND m.autor_id != $1
         AND m.leido = false`,
      [req.usuarioId]
    );
    res.json({ noLeidos: rows[0].no_leidos });
  } catch (err) {
    console.error('Error consultando notificaciones:', err.message);
    res.status(500).json({ error: 'No se pudo consultar notificaciones.' });
  }
});

app.post('/mensajes', async (req, res) => {
  const amistadId = Number(req.body.amistad_id);
  const texto = (req.body.texto || '').trim();
  if (!Number.isInteger(amistadId)) {
    return res.status(400).send('amistad_id inválido');
  }
  if (!texto) {
    return res.status(400).send('El texto no puede estar vacío');
  }
  try {
    const pertenece = await usuarioPerteneceAmistad(req.usuarioId, amistadId);
    if (!pertenece) {
      return res.status(403).send('No tienes acceso a esta conversación.');
    }
    await pool.query(
      'INSERT INTO mensajes (amistad_id, autor_id, texto, fecha, leido) VALUES ($1, $2, $3, now(), false)',
      [amistadId, req.usuarioId, texto]
    );
  } catch (err) {
    console.error('Error creando mensaje:', err.message);
    return res.status(500).send('No se pudo enviar el mensaje.');
  }
  res.redirect('/chat?amistad_id=' + amistadId);
});

ensureSchema()
  .catch((err) => console.error('Error preparando el esquema:', err.message))
  .finally(() => {
    app.listen(PORT, () => {
      console.log(`Servidor corriendo en http://localhost:${PORT}`);
    });
  });
