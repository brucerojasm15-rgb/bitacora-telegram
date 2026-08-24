require('dotenv').config();

const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const { Pool } = require('pg');
const webpush = require('web-push');
const cron = require('node-cron');
const { google } = require('googleapis');
const bcrypt = require('bcrypt');
const nodemailer = require('nodemailer');

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

// rama-google-calendar (tarea 10 del roadmap, esqueleto sin probar — ver
// COORDINACION.md): sin GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET/
// GOOGLE_REDIRECT_URI en .env, googleOAuthClient queda en null y las rutas
// de /calendario/* devuelven 500 "no configurada" en vez de fallar feo.
const googleOAuthClient =
  process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REDIRECT_URI
    ? new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI
      )
    : null;

// rama-segmentacion-ideas (Fase 1 de v0.2, ver COORDINACION.md): mismo
// patrón que rama-ia-companera-fase2 (Groq, API compatible con OpenAI chat
// completions, fetch nativo sin SDK nuevo). Sin GROQ_API_KEY en .env,
// groqClient queda en null y segmentarIdeaConGroq cae a su fallback sin
// segmentar (ver más abajo) en vez de fallar feo.
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
// 'llama-3.3-70b-versatile' fue deprecado por Groq (confirmado 2026-08-17,
// ya no aparece en GET /v1/models) -- reemplazado por openai/gpt-oss-120b,
// el mas parecido en capacidad todavia disponible en el tier gratis.
// Requiere reasoning_effort:'low' en la llamada (ver llamarGroqConReintento)
// porque sin eso el modelo mete su razonamiento interno dentro del JSON de
// respuesta y rompe response_format:'json_object' (confirmado con pruebas
// manuales contra la API real).
const MODELO_IA_SEGMENTACION = 'openai/gpt-oss-120b';
const groqClient = process.env.GROQ_API_KEY ? { apiKey: process.env.GROQ_API_KEY } : null;

// rama-login-email: mismo criterio que googleOAuthClient arriba -- sin
// GMAIL_USER/GMAIL_APP_PASSWORD en .env, mailTransporter queda en null y
// /recuperar-email sigue respondiendo su mensaje genérico de siempre (no le
// revela al usuario que el envío de correo no está configurado), pero loguea
// el error en el servidor. GMAIL_APP_PASSWORD es una "contraseña de
// aplicación" de Gmail (https://myaccount.google.com/apppasswords), NO la
// contraseña normal de la cuenta -- Gmail no acepta SMTP con la contraseña
// normal si la cuenta tiene verificación en 2 pasos (que las contraseñas de
// aplicación requieren tener activada).
const mailTransporter =
  process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD
    ? nodemailer.createTransport({
        service: 'gmail',
        auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
      })
    : null;

async function enviarEmailReseteo(destinatario, link) {
  if (!mailTransporter) {
    console.error('GMAIL_USER/GMAIL_APP_PASSWORD no configurados -- no se pudo enviar el email de restablecimiento.');
    return;
  }
  await mailTransporter.sendMail({
    from: `Bitácora <${process.env.GMAIL_USER}>`,
    to: destinatario,
    subject: 'Restablecer tu contraseña -- Bitácora',
    text: `Alguien (esperamos que hayas sido vos) pidió restablecer la contraseña de tu cuenta en Bitácora.\n\nSi fuiste vos, abrí este link (válido por 1 hora):\n${link}\n\nSi no fuiste vos, ignora este correo -- tu cuenta sigue segura, nadie puede hacer nada sin abrir ese link.`,
  });
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
// rama-terminos-privacidad: /terminos también queda público -- se enlaza
// desde /registro, que se visita sin sesión.
app.use((req, res, next) => {
  // rama-login-email: /login/email y /registro/email son las variantes
  // email+contraseña de /login y /registro (mismo criterio, público, se
  // navegan sin sesión). /recuperar-email y /recuperar-email/:token
  // (pedir el link y usarlo) también, mismo criterio que /recuperar.
  if (
    req.path === '/login' ||
    req.path === '/login/email' ||
    req.path === '/registro' ||
    req.path === '/registro/email' ||
    req.path === '/recuperar' ||
    req.path === '/recuperar-email' ||
    req.path.startsWith('/recuperar-email/') ||
    req.path === '/terminos'
  ) return next();
  if (req.session && req.session.usuario_id) {
    req.usuarioId = req.session.usuario_id;
    return next();
  }
  if (req.method === 'GET') {
    return res.redirect('/login');
  }
  return res.status(401).end();
});

// rama-tutorial-multicapitulo: fuente de verdad del lado servidor -- solo
// id + recompensa + validación de qué capítulos existen. Los pasos/
// selectores/textos de cada capítulo son puramente de UI y viven en
// public/tutorial.js, no acá.
const TUTORIAL_CAPITULOS = {
  basico: { recompensa: 20 },
  organizacion: { recompensa: 15 },
  social: { recompensa: 15 },
};

// rama-tema-jungla: expone `tema` a TODAS las vistas vía res.locals (así
// partials/head.ejs puede fijar data-theme en el <html> sin parpadeo, sin
// que cada ruta tenga que acordarse de pasarlo). Una consulta liviana más
// por request logueado — aceptable para el tamaño de esta app.
app.use(async (req, res, next) => {
  if (!req.usuarioId) {
    res.locals.tema = null;
    res.locals.barraSuperior = null;
    res.locals.nombreUsuario = null;
    res.locals.tutorialCapitulosCompletados = [];
    res.locals.tutorialCapitulosPendientes = 0;
    res.locals.iaChatSinLeer = false;
    res.locals.logrosNuevos = [];
    return next();
  }
  try {
    // rama-interfaz: se suma ia_especie/saldo_moneda a esta MISMA consulta
    // (no una nueva) porque ya se estaba pidiendo `tema` acá para cada
    // request logueada -- aprovecharla evita un roundtrip extra.
    // rama-inicio-planta: mismo criterio, se suma nombre_usuario -- lo
    // necesita el saludo de la pantalla principal nueva ("Hola, {nombre}"),
    // pero se expone acá (no solo en captura.ejs) por si a futuro hace
    // falta en otro lado, igual que ya se hizo con `tema`/`barraSuperior`.
    // rama-perfil-juego: mismo criterio otra vez -- se suman las columnas
    // que perfilJuegoDeUsuario necesita (ia_skin/ia_nombre/ia_tema_extra/
    // comodines_perdon_disponibles) para que barraSuperiorDeUsuario pueda
    // pasarle esta fila y no dispare una segunda consulta a `usuarios`.
    // rama-recapitulacion-diaria: se suma ia_chat_visto_hasta, la usa la
    // consulta de abajo para el badge "no leído" del chat de la planta.
    const { rows } = await pool.query(
      `SELECT tema, ia_especie, ia_skin, ia_nombre, ia_tema_extra, saldo_moneda,
              comodines_perdon_disponibles, nombre_usuario, ia_chat_visto_hasta
       FROM usuarios WHERE id = $1`,
      [req.usuarioId]
    );
    const usuario = rows[0];
    res.locals.tema = usuario ? usuario.tema : null;
    res.locals.nombreUsuario = usuario ? usuario.nombre_usuario : null;
    res.locals.barraSuperior = await barraSuperiorDeUsuario(req.usuarioId, usuario);
    // rama-tutorial-multicapitulo: se calcula acá para TODAS las vistas
    // (como `tema`/`barraSuperior`) porque el tour cruza varias páginas
    // (captura, amigos, ia, metas, chat-general, trazabilidad) y la
    // insignia del menú "Más" también necesita este dato en cualquier
    // página.
    const { rows: completadosRows } = await pool.query(
      'SELECT capitulo FROM tutorial_capitulos_completados WHERE usuario_id = $1',
      [req.usuarioId]
    );
    const completados = completadosRows.map((r) => r.capitulo);
    res.locals.tutorialCapitulosCompletados = completados;
    res.locals.tutorialCapitulosPendientes = Object.keys(TUTORIAL_CAPITULOS).filter(
      (id) => !completados.includes(id)
    ).length;
    // rama-recapitulacion-diaria: mismo criterio que noLeidosGeneral de
    // chat_general_visto_hasta (ver GET /chat-general/no-leidos) -- EXISTS
    // en vez de COUNT porque solo hace falta saber si hay algo, no cuánto.
    const { rows: sinLeerRows } = await pool.query(
      `SELECT EXISTS (
         SELECT 1 FROM mensajes_ia
         WHERE usuario_id = $1 AND rol = 'ia'
           AND fecha > COALESCE($2::timestamp, to_timestamp(0))
       ) AS hay`,
      [req.usuarioId, usuario ? usuario.ia_chat_visto_hasta : null]
    );
    res.locals.iaChatSinLeer = sinLeerRows[0].hay;
    // rama-logros: SOLO lectura acá -- este middleware corre en TODA
    // request logueada, incluidas las que redirigen sin renderizar nunca
    // partials/nav.ejs (ej. POST /captura). Marcar "mostrado" acá mismo
    // se probó y tiene una race real: un POST que pasa por acá justo
    // después de un desbloqueo lo marca visto sin que ningún toast se
    // haya renderizado nunca. El marcado real lo confirma el cliente
    // (POST /logros/marcar-visto, ver partials/scripts.ejs) recién
    // después de mostrar el toast de verdad en el navegador.
    const { rows: logrosRows } = await pool.query(
      'SELECT logro FROM logros_desbloqueados WHERE usuario_id = $1 AND mostrado = FALSE',
      [req.usuarioId]
    );
    res.locals.logrosNuevos = logrosRows
      .map((r) => LOGROS[r.logro])
      .filter(Boolean)
      .map((l) => ({ nombre: l.nombre, descripcion: l.descripcion }));
  } catch (err) {
    res.locals.tema = null;
    res.locals.barraSuperior = null;
    res.locals.nombreUsuario = null;
    res.locals.tutorialCapitulosCompletados = [];
    res.locals.tutorialCapitulosPendientes = 0;
    res.locals.iaChatSinLeer = false;
    res.locals.logrosNuevos = [];
  }
  next();
});

// rama-interfaz (Fase 4 de v0.2): datos de la barra superior fija (mini
// planta + racha + semillas), expuestos a TODAS las vistas autenticadas vía
// res.locals -- mismo criterio que `tema` arriba, ninguna de las 34 rutas
// que hacen res.render tiene que pasarlo a mano. `usuarioFila` es el
// resultado de la consulta que ya hizo el middleware de arriba (evita
// repetirla); si no se pasa (llamadas fuera de ese middleware), la trae acá.
// rama-perfil-juego (tarea O): delega en perfilJuegoDeUsuario en vez de
// tener su propia lógica de etapa/racha -- mismo trade-off de consultas
// que ya aceptó rama-tema-jungla con la de `tema`, no se sumó ninguna
// query nueva (usuarioFila ya trae hoy todas las columnas que
// perfilJuegoDeUsuario necesita, ver el middleware global más arriba).
async function barraSuperiorDeUsuario(usuarioId, usuarioFila) {
  const perfil = await perfilJuegoDeUsuario(usuarioId, { usuarioFila });
  if (!perfil) return null;
  return {
    usuarioId,
    especie: perfil.especie,
    etapa: perfil.etapa.indice,
    semillas: perfil.saldoMoneda,
    racha: perfil.rachaGeneral,
  };
}

const TEMAS_VALIDOS = ['claro', 'oscuro', 'sistema'];

app.post('/preferencia-tema', async (req, res) => {
  const tema = req.body.tema;
  if (!TEMAS_VALIDOS.includes(tema)) {
    return res.status(400).end();
  }
  try {
    await pool.query('UPDATE usuarios SET tema = $1 WHERE id = $2', [
      tema === 'sistema' ? null : tema,
      req.usuarioId,
    ]);
  } catch (err) {
    console.error('Error guardando preferencia de tema:', err.message);
    return res.status(500).end();
  }
  res.status(204).end();
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

// rama-invitar-amigos: código de invitación por usuario. Distinto criterio
// del código de recuperación a propósito (documentado en COORDINACION.md):
// no se hashea (no es un secreto que desbloquee una cuenta, solo resuelve
// a un usuario_id para pre-cargar una solicitud de amistad) y no es de un
// solo uso (vive mientras el usuario no lo regenere). Se comparte como
// link, no se transcribe a mano, así que no hace falta un alfabeto sin
// ambigüedades — base64url es más corto y ya es seguro para URLs.
function generarCodigoInvitacion() {
  return crypto.randomBytes(9).toString('base64url');
}

// rama-google-calendar: los tokens de Google (access + refresh) nunca se
// guardan en texto plano. AES-256-GCM en vez de un modo sin autenticación
// (ECB/CBC) porque GCM detecta si el texto cifrado fue alterado. IV
// aleatorio de 12 bytes por fila (recomendado para GCM, no reusar IV entre
// filas). Clave separada de SESSION_SECRET a propósito — GOOGLE_TOKEN_
// ENCRYPTION_KEY en .env, 32 bytes en hex (ver .env.example).
const GOOGLE_TOKEN_ALGORITMO = 'aes-256-gcm';

function cifrarTokensGoogle(objetoTokens) {
  const clave = Buffer.from(process.env.GOOGLE_TOKEN_ENCRYPTION_KEY, 'hex');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(GOOGLE_TOKEN_ALGORITMO, clave, iv);
  const cifrado = Buffer.concat([cipher.update(JSON.stringify(objetoTokens), 'utf8'), cipher.final()]);
  return { iv: iv.toString('hex'), authTag: cipher.getAuthTag().toString('hex'), datos: cifrado.toString('hex') };
}

function descifrarTokensGoogle(fila) {
  const clave = Buffer.from(process.env.GOOGLE_TOKEN_ENCRYPTION_KEY, 'hex');
  const decipher = crypto.createDecipheriv(GOOGLE_TOKEN_ALGORITMO, clave, Buffer.from(fila.iv, 'hex'));
  decipher.setAuthTag(Buffer.from(fila.auth_tag, 'hex'));
  const descifrado = Buffer.concat([
    decipher.update(Buffer.from(fila.datos_cifrados, 'hex')),
    decipher.final(),
  ]);
  return JSON.parse(descifrado.toString('utf8'));
}

// Cliente autorizado para UN usuario puntual (nunca el googleOAuthClient
// global, que no tiene credenciales de nadie todavía). Si Google renueva el
// access_token solo (evento 'tokens' del SDK), se vuelve a cifrar y guardar
// — si no se hiciera esto, la sesión de Calendar se rompería silenciosamente
// después de que expire el primer access_token.
async function obtenerClienteCalendarPara(usuarioId) {
  if (!googleOAuthClient) return null;
  const { rows } = await pool.query('SELECT * FROM google_calendar_tokens WHERE usuario_id = $1', [usuarioId]);
  if (rows.length === 0) return null;
  const tokens = descifrarTokensGoogle(rows[0]);
  const cliente = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  cliente.setCredentials(tokens);
  cliente.on('tokens', async (tokensNuevos) => {
    try {
      const combinados = { ...tokens, ...tokensNuevos };
      const { iv, authTag, datos } = cifrarTokensGoogle(combinados);
      await pool.query(
        'UPDATE google_calendar_tokens SET iv = $1, auth_tag = $2, datos_cifrados = $3, actualizado = now() WHERE usuario_id = $4',
        [iv, authTag, datos, usuarioId]
      );
    } catch (err) {
      console.error('No se pudo guardar el token renovado de Google Calendar:', err.message);
    }
  });
  return cliente;
}

const NOMBRE_USUARIO_REGEX = /^[a-zA-Z0-9_]{3,20}$/;
const PIN_REGEX = /^\d{4,6}$/;
// rama-login-email
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_MIN_LARGO = 8;

// rama-login-email: token de reseteo de contraseña. A diferencia de
// codigo_recuperacion_hash (scrypt, pensado para un secreto CORTO que un
// humano podría intentar adivinar/fuerza-bruta), el token viaja en un link
// de un solo uso y ya es 256 bits de aleatoriedad -- no hace falta un hash
// lento, solo evitar que quede en texto plano en la DB. sha256 alcanza y
// además permite buscarlo por igualdad directa en la query (con scrypt no
// se podría: cada hash lleva su propio salt, no hay forma de buscar "cuál
// fila tiene este token" sin ya saber a qué usuario pertenece).
function hashTokenReseteo(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function generarTokenReseteo() {
  return crypto.randomBytes(32).toString('base64url');
}

// rama-terminos-privacidad: página estática, pública (ver middleware de
// sesión arriba). Sin datos dinámicos -- no hace falta pool.query acá.
app.get('/terminos', (req, res) => {
  res.render('terminos', {});
});

app.get('/login', (req, res) => {
  // rama-interfaz-v2: la app abre en Captura rápida, no en Pendientes --
  // pedido explícito del usuario. /captura sigue siendo la única pantalla
  // con el selector pendiente/idea/recordatorio, así que es la puerta de
  // entrada natural. Pendientes sigue existiendo, solo dejó de ser home.
  if (req.session && req.session.usuario_id) {
    return res.redirect('/captura');
  }
  res.render('login', {
    error: null,
    cuentaEliminada: req.query.cuenta_eliminada === '1',
    password_actualizada: req.query.password_actualizada === '1',
  });
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
    res.redirect('/captura');
  } catch (err) {
    console.error('Error en login:', err.message);
    res.status(500).render('login', { error: 'Error del servidor, intenta de nuevo.' });
  }
});

// rama-login-email: variante de /login por email+contraseña. Mismo mensaje
// genérico que /login (usuario+PIN) si el email no existe, no tiene
// contraseña vinculada, o la contraseña no coincide -- no revela cuál de
// los tres fue, mismo criterio que el resto del archivo.
app.post('/login/email', limitarIntentos('login-email'), async (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  const password = req.body.password || '';
  if (!email || !password) {
    return res.render('login', { error: 'Completa email y contraseña.', metodo: 'email', emailIngresado: email });
  }
  try {
    const { rows } = await pool.query(
      'SELECT id, nombre_usuario, password_hash FROM usuarios WHERE email = $1',
      [email]
    );
    const usuario = rows[0];
    const coincide = usuario && usuario.password_hash && (await bcrypt.compare(password, usuario.password_hash));
    if (!coincide) {
      return res.render('login', { error: 'Email o contraseña incorrectos.', metodo: 'email', emailIngresado: email });
    }
    req.session.usuario_id = usuario.id;
    req.session.nombre_usuario = usuario.nombre_usuario;
    // rama-tutorial-interactivo: mismo destino que POST /login (usuario+PIN)
    // -- /captura es la landing desde rama-interfaz-v2, no '/'.
    res.redirect('/captura');
  } catch (err) {
    console.error('Error en login por email:', err.message);
    res.status(500).render('login', { error: 'Error del servidor, intenta de nuevo.', metodo: 'email', emailIngresado: email });
  }
});

app.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) console.error('Error cerrando sesion:', err.message);
    res.redirect('/login');
  });
});

// rama-invitar-amigos: resuelve un código de invitación al usuario dueño,
// sin filtrar nada si no existe (registro sigue funcionando normal, solo
// sin el banner "te invitó @fulano" ni la solicitud pre-cargada).
async function resolverInvitador(codigo) {
  if (!codigo) return null;
  const { rows } = await pool.query(
    'SELECT id, nombre_usuario FROM usuarios WHERE codigo_invitacion = $1',
    [codigo]
  );
  return rows[0] || null;
}

app.get('/registro', async (req, res) => {
  if (req.session && req.session.usuario_id) {
    return res.redirect('/captura');
  }
  const codigoInvitacion = typeof req.query.invitacion === 'string' ? req.query.invitacion : '';
  const invitador = await resolverInvitador(codigoInvitacion).catch(() => null);
  res.render('registro', {
    error: null,
    nombreUsuario: '',
    especies: IA_ESPECIES,
    codigoInvitacion,
    invitadoPor: invitador ? invitador.nombre_usuario : null,
  });
});

app.post('/registro', limitarIntentos('registro'), async (req, res) => {
  const nombreUsuario = (req.body.nombre_usuario || '').trim().toLowerCase();
  const pin = req.body.pin || '';
  const confirmarPin = req.body.confirmar_pin || '';
  const especie = IA_ESPECIES.includes(req.body.especie) ? req.body.especie : IA_ESPECIES[0];
  const codigoInvitacion = (req.body.invitacion || '').trim();

  if (!NOMBRE_USUARIO_REGEX.test(nombreUsuario)) {
    return res.render('registro', {
      error: 'El usuario debe tener entre 3 y 20 caracteres (letras, números o _).',
      nombreUsuario,
      especies: IA_ESPECIES,
      codigoInvitacion,
      invitadoPor: null,
    });
  }
  if (!PIN_REGEX.test(pin)) {
    return res.render('registro', { error: 'El PIN debe ser numérico, de 4 a 6 dígitos.', nombreUsuario, especies: IA_ESPECIES, codigoInvitacion, invitadoPor: null });
  }
  if (pin !== confirmarPin) {
    return res.render('registro', { error: 'El PIN y su confirmación no coinciden.', nombreUsuario, especies: IA_ESPECIES, codigoInvitacion, invitadoPor: null });
  }
  if (limiteRegistrosAlcanzado(req.ip)) {
    return res.render('registro', {
      error: 'Se alcanzó el límite de cuentas nuevas desde esta red en la última hora. Intenta de nuevo más tarde.',
      nombreUsuario,
      especies: IA_ESPECIES,
      codigoInvitacion,
      invitadoPor: null,
    });
  }

  try {
    const pinHash = crearPinHash(pin);
    const codigoRecuperacion = generarCodigoRecuperacion();
    const codigoRecuperacionHash = crearPinHash(codigoRecuperacion);
    const nombreIaPorDefecto = especie.charAt(0).toUpperCase() + especie.slice(1);
    const { rows } = await pool.query(
      `INSERT INTO usuarios (nombre_usuario, pin_hash, codigo_recuperacion_hash, ia_especie, ia_nombre, tutorial_interactivo_visto)
       VALUES ($1, $2, $3, $4, $5, FALSE) RETURNING id`,
      [nombreUsuario, pinHash, codigoRecuperacionHash, especie, nombreIaPorDefecto]
    );
    const nuevoUsuarioId = rows[0].id;
    registrarAltaExitosa(req.ip);
    req.session.usuario_id = nuevoUsuarioId;
    req.session.nombre_usuario = nombreUsuario;

    // rama-invitar-amigos: si el código resuelve a un usuario real, se
    // pre-carga la solicitud de amistad (nuevo usuario -> quien invitó),
    // mismo INSERT que usa POST /amigos/solicitar. Falla en silencio (solo
    // log) si el código ya no es válido o algo sale mal — no debe romper
    // el registro, que ya ocurrió.
    if (codigoInvitacion) {
      try {
        const invitador = await resolverInvitador(codigoInvitacion);
        if (invitador) {
          await pool.query(
            `INSERT INTO amistades (usuario_a_id, usuario_b_id, estado, fecha) VALUES ($1, $2, 'pendiente', now())`,
            [nuevoUsuarioId, invitador.id]
          );
        }
      } catch (err) {
        console.error('Error pre-cargando solicitud de amistad por invitación:', err.message);
      }
    }

    // rama-tutorial-interactivo: reemplaza el link "continuar" a /onboarding
    // (carrusel estático, retirado) -- ahora va directo a /captura, donde
    // el tour interactivo nuevo se dispara solo si corresponde
    // (tutorial_interactivo_visto = FALSE, ver el middleware que calcula
    // `mostrarTutorial`).
    res.render('codigo-recuperacion', {
      codigo: codigoRecuperacion,
      mensaje: 'Cuenta creada. Este es tu código de recuperación de PIN — apúntalo antes de continuar:',
      continuarUrl: '/captura',
    });
  } catch (err) {
    if (err.code === '23505') {
      return res.render('registro', { error: 'Ese nombre de usuario ya está en uso.', nombreUsuario, especies: IA_ESPECIES, codigoInvitacion, invitadoPor: null });
    }
    console.error('Error en registro:', err.message);
    res.status(500).render('registro', { error: 'Error del servidor, intenta de nuevo.', nombreUsuario, especies: IA_ESPECIES, codigoInvitacion, invitadoPor: null });
  }
});

// rama-login-email: variante de /registro por email+contraseña, para un
// usuario NUEVO que nunca tuvo cuenta (fila nueva en usuarios, sin riesgo de
// duplicado -- no existía antes). Un usuario EXISTENTE que ya tiene
// usuario+PIN NO debería pasar por acá para agregar email: eso es
// POST /ajustes/vincular-email, que actualiza SU fila en vez de crear una
// nueva. Sigue pidiendo nombre_usuario y especie -- son de identidad/social
// (se muestran en amigos, chat, etc.), no de autenticación, así que se
// piden igual que en /registro; lo único que cambia es que la credencial de
// acceso es email+contraseña en vez de PIN.
app.post('/registro/email', limitarIntentos('registro'), async (req, res) => {
  const nombreUsuario = (req.body.nombre_usuario || '').trim().toLowerCase();
  const email = (req.body.email || '').trim().toLowerCase();
  const password = req.body.password || '';
  const confirmarPassword = req.body.confirmar_password || '';
  const especie = IA_ESPECIES.includes(req.body.especie) ? req.body.especie : IA_ESPECIES[0];
  const codigoInvitacion = (req.body.invitacion || '').trim();
  const rerender = (error) => res.render('registro', {
    error, metodo: 'email', nombreUsuario, emailIngresado: email,
    especies: IA_ESPECIES, codigoInvitacion, invitadoPor: null,
  });

  if (!NOMBRE_USUARIO_REGEX.test(nombreUsuario)) {
    return rerender('El usuario debe tener entre 3 y 20 caracteres (letras, números o _).');
  }
  if (!EMAIL_REGEX.test(email)) {
    return rerender('Ingresa un email válido.');
  }
  if (password.length < PASSWORD_MIN_LARGO) {
    return rerender(`La contraseña debe tener al menos ${PASSWORD_MIN_LARGO} caracteres.`);
  }
  if (password !== confirmarPassword) {
    return rerender('La contraseña y su confirmación no coinciden.');
  }
  if (limiteRegistrosAlcanzado(req.ip)) {
    return rerender('Se alcanzó el límite de cuentas nuevas desde esta red en la última hora. Intenta de nuevo más tarde.');
  }

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const nombreIaPorDefecto = especie.charAt(0).toUpperCase() + especie.slice(1);
    // rama-tutorial-interactivo: tutorial_interactivo_visto = FALSE explícito,
    // mismo criterio que POST /registro -- una cuenta nueva por email es tan
    // "usuario nuevo" como una por PIN, y debe ver el tour también.
    const { rows } = await pool.query(
      `INSERT INTO usuarios (nombre_usuario, email, password_hash, ia_especie, ia_nombre, tutorial_interactivo_visto)
       VALUES ($1, $2, $3, $4, $5, FALSE) RETURNING id`,
      [nombreUsuario, email, passwordHash, especie, nombreIaPorDefecto]
    );
    const nuevoUsuarioId = rows[0].id;
    registrarAltaExitosa(req.ip);
    req.session.usuario_id = nuevoUsuarioId;
    req.session.nombre_usuario = nombreUsuario;

    // Mismo bloque que POST /registro -- ver ese comentario.
    if (codigoInvitacion) {
      try {
        const invitador = await resolverInvitador(codigoInvitacion);
        if (invitador) {
          await pool.query(
            `INSERT INTO amistades (usuario_a_id, usuario_b_id, estado, fecha) VALUES ($1, $2, 'pendiente', now())`,
            [nuevoUsuarioId, invitador.id]
          );
        }
      } catch (err) {
        console.error('Error pre-cargando solicitud de amistad por invitación:', err.message);
      }
    }

    // rama-tutorial-interactivo: sin codigo-recuperacion.ejs acá (esa
    // pantalla es para el código de recuperación de PIN, y esta cuenta no
    // tiene PIN) -- directo a /captura, donde el tour interactivo se
    // dispara solo por tutorial_interactivo_visto = FALSE. El /onboarding
    // viejo (carrusel estático) fue retirado.
    res.redirect('/captura');
  } catch (err) {
    if (err.code === '23505') {
      const mensaje = (err.detail || '').includes('email')
        ? 'Ese email ya está en uso.'
        : 'Ese nombre de usuario ya está en uso.';
      return rerender(mensaje);
    }
    console.error('Error en registro por email:', err.message);
    res.status(500);
    return rerender('Error del servidor, intenta de nuevo.');
  }
});

// rama-tutorial-multicapitulo: lista los capítulos disponibles (básico +
// opcionales) con su estado. El link "Empezar" de cada capítulo apunta
// directo a la página de su primer paso con ?tutorial=<id> -- el motor
// cliente (public/tutorial.js) toma la posta desde ahí. Para "social" se
// suma el amistad_id del primer amigo (si tiene alguno) porque ese
// capítulo tiene un 2do paso condicional a tener amigos.
app.get('/tutorial', async (req, res) => {
  try {
    const { rows: amistadRows } = await pool.query(
      `SELECT id FROM amistades WHERE estado = 'aceptada' AND (usuario_a_id = $1 OR usuario_b_id = $1)
       ORDER BY id ASC LIMIT 1`,
      [req.usuarioId]
    );
    const primerAmistadId = amistadRows[0] ? amistadRows[0].id : null;
    res.render('tutorial', {
      completados: res.locals.tutorialCapitulosCompletados,
      recompensas: Object.fromEntries(Object.entries(TUTORIAL_CAPITULOS).map(([id, c]) => [id, c.recompensa])),
      primerAmistadId,
      error: null,
    });
  } catch (err) {
    console.error('Error consultando capítulos del tutorial:', err.message);
    res.status(500).render('tutorial', {
      completados: [], recompensas: {}, primerAmistadId: null, error: 'No se pudo leer la base de datos.',
    });
  }
});

// rama-logros: lista los 9 logros, desbloqueados destacados (con fecha) y
// bloqueados atenuados -- mismo criterio visual que /tutorial con
// capítulos completados/pendientes.
app.get('/logros', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT logro, desbloqueado_en FROM logros_desbloqueados WHERE usuario_id = $1',
      [req.usuarioId]
    );
    const desbloqueadosPorSlug = Object.fromEntries(rows.map((r) => [r.logro, r.desbloqueado_en]));
    const logros = Object.entries(LOGROS).map(([slug, l]) => ({
      slug,
      nombre: l.nombre,
      descripcion: l.descripcion,
      desbloqueadoEn: desbloqueadosPorSlug[slug] || null,
    }));
    res.render('logros', { logros, error: null });
  } catch (err) {
    console.error('Error consultando logros:', err.message);
    res.status(500).render('logros', { logros: [], error: 'No se pudo leer la base de datos.' });
  }
});

// rama-logros: marca como "mostrado" recién cuando el navegador confirma
// que ya renderizó el toast (ver partials/scripts.ejs) -- no hace falta
// mandar qué slugs, simplemente marca todo lo pendiente de este usuario,
// que es exactamente lo que el toast que se acaba de mostrar incluía.
app.post('/logros/marcar-visto', async (req, res) => {
  try {
    await pool.query('UPDATE logros_desbloqueados SET mostrado = TRUE WHERE usuario_id = $1 AND mostrado = FALSE', [
      req.usuarioId,
    ]);
  } catch (err) {
    console.error('Error marcando logros como vistos:', err.message);
  }
  res.status(204).end();
});

// rama-tutorial-multicapitulo: reemplaza a POST /tutorial/completar (que
// marcaba un único booleano). Ahora hay un capítulo por :capitulo -- se
// valida contra TUTORIAL_CAPITULOS, se marca completado (idempotente vía
// ON CONFLICT) y, si es la primera vez de verdad (no un "Saltar" del
// capítulo básico, ver `omitido`), se paga la recompensa con el mismo
// helper que usa el resto de la app (pagarMoneda, ver rama-moneda-virtual)
// -- respeta el mismo LIMITE_MONEDA_DIARIA que cualquier otra fuente de
// moneda, no hace falta un límite aparte para esto.
app.post('/tutorial/capitulo/:capitulo/completar', async (req, res) => {
  const capitulo = req.params.capitulo;
  if (!TUTORIAL_CAPITULOS[capitulo]) {
    return res.status(400).send('Capítulo inválido.');
  }
  const omitido = req.body && req.body.omitido === true;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO tutorial_capitulos_completados (usuario_id, capitulo) VALUES ($1, $2)
       ON CONFLICT (usuario_id, capitulo) DO NOTHING RETURNING usuario_id`,
      [req.usuarioId, capitulo]
    );
    const seInsertoDeVerdad = rows.length > 0;
    if (seInsertoDeVerdad && !omitido) {
      await pagarMoneda(client, req.usuarioId, TUTORIAL_CAPITULOS[capitulo].recompensa, `Tutorial: capítulo "${capitulo}"`, null);
    }
    await client.query('COMMIT');
    // rama-logros: cuenta para "graduado" tanto si se completó de verdad
    // como si se saltó (mismo criterio que ya usa tutorialCapitulosPendientes
    // -- ambos casos insertan la fila en tutorial_capitulos_completados).
    if (seInsertoDeVerdad) {
      await revisarYOtorgarLogros(req.usuarioId).catch((err) =>
        console.error('Error revisando logros tras completar capítulo de tutorial:', err.message)
      );
    }
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error marcando capítulo de tutorial como completado:', err.message);
  } finally {
    client.release();
  }
  res.status(204).end();
});

app.get('/recuperar', (req, res) => {
  res.render('recuperar', { error: null, nombreUsuario: '' });
});

app.post('/recuperar', limitarIntentos('recuperar'), async (req, res) => {
  const nombreUsuario = (req.body.nombre_usuario || '').trim().toLowerCase();
  const codigo = (req.body.codigo || '').trim().toUpperCase();
  const pin = req.body.pin || '';
  const confirmarPin = req.body.confirmar_pin || '';

  if (!nombreUsuario || !codigo) {
    return res.render('recuperar', { error: 'Completa usuario y código de recuperación.', nombreUsuario });
  }
  if (!PIN_REGEX.test(pin)) {
    return res.render('recuperar', { error: 'El PIN nuevo debe ser numérico, de 4 a 6 dígitos.', nombreUsuario });
  }
  if (pin !== confirmarPin) {
    return res.render('recuperar', { error: 'El PIN nuevo y su confirmación no coinciden.', nombreUsuario });
  }

  try {
    const { rows } = await pool.query(
      'SELECT id, codigo_recuperacion_hash FROM usuarios WHERE nombre_usuario = $1',
      [nombreUsuario]
    );
    const usuario = rows[0];
    // rama-fix-recuperacion-pin: revertido el pedido del PIN actual además
    // del código (agregado en rama-fix-recuperar-pin, PR #32) -- exigirlo
    // dejaba la recuperación inutilizable para su único caso de uso real
    // (olvidaste el PIN), porque pedía ese mismo PIN olvidado para
    // recuperarlo. El código ya es un segundo factor suficiente por sí
    // solo: alta entropía (10 caracteres de un alfabeto de 32, ver
    // generarCodigoRecuperacion), de un solo uso (se regenera después de
    // cada recuperación, ver abajo), y las peticiones están limitadas por
    // `limitarIntentos` (8 cada 15 min por IP) -- mismo modelo que un
    // código de respaldo de 2FA, donde conocer el código alcanza.
    if (!usuario || !usuario.codigo_recuperacion_hash || !verificarPin(codigo, usuario.codigo_recuperacion_hash)) {
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

// rama-login-email: reseteo de contraseña por link enviado al email, para
// cuentas que ya vincularon email+contraseña. Flujo separado de /recuperar
// (que es para el PIN, con código de recuperación) porque el modelo de
// amenaza es distinto: acá no hay "código propio" que pedir, así que el
// factor de prueba es "tener acceso a esa bandeja de entrada".
const MENSAJE_RECUPERAR_EMAIL_ENVIADO =
  'Si ese email existe y tiene una contraseña vinculada, te enviamos un link para restablecerla. Revisa tu bandeja (y spam).';

app.get('/recuperar-email', (req, res) => {
  res.render('recuperar-email', { error: null, enviado: false, email: '' });
});

app.post('/recuperar-email', limitarIntentos('recuperar-email'), async (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  if (!EMAIL_REGEX.test(email)) {
    return res.render('recuperar-email', { error: 'Ingresa un email válido.', enviado: false, email });
  }
  try {
    const { rows } = await pool.query(
      'SELECT id FROM usuarios WHERE email = $1 AND password_hash IS NOT NULL',
      [email]
    );
    const usuario = rows[0];
    // Mismo mensaje de éxito exista o no la cuenta -- no revela si ese email
    // está registrado (evita que alguien use este formulario para
    // enumerar cuentas). Solo se envía el correo de verdad si existe.
    if (usuario) {
      const token = generarTokenReseteo();
      await pool.query(
        `INSERT INTO reseteos_password (usuario_id, token_hash, expira) VALUES ($1, $2, now() + interval '1 hour')`,
        [usuario.id, hashTokenReseteo(token)]
      );
      const link = `${req.protocol}://${req.get('host')}/recuperar-email/${token}`;
      enviarEmailReseteo(email, link).catch((err) => {
        console.error('Error enviando email de reseteo:', err.message);
      });
    }
    res.render('recuperar-email', { error: null, enviado: true, email: '' });
  } catch (err) {
    console.error('Error en /recuperar-email:', err.message);
    // Mismo mensaje genérico incluso ante un error real -- no le da a un
    // atacante información sobre el estado interno del servidor/la DB.
    res.render('recuperar-email', { error: null, enviado: true, email: '' });
  }
});

async function buscarReseteoVigente(token) {
  const { rows } = await pool.query(
    `SELECT reseteos_password.id, usuario_id FROM reseteos_password
     WHERE token_hash = $1 AND usado = FALSE AND expira > now()`,
    [hashTokenReseteo(token)]
  );
  return rows[0] || null;
}

app.get('/recuperar-email/:token', async (req, res) => {
  const reseteo = await buscarReseteoVigente(req.params.token).catch(() => null);
  if (!reseteo) {
    return res.status(400).render('recuperar-email-confirmar', {
      error: 'Este link ya no es válido -- puede haber vencido (dura 1 hora) o ya haberse usado. Pedí uno nuevo.',
      token: null,
    });
  }
  res.render('recuperar-email-confirmar', { error: null, token: req.params.token });
});

app.post('/recuperar-email/:token', limitarIntentos('recuperar-email'), async (req, res) => {
  const password = req.body.password || '';
  const confirmarPassword = req.body.confirmar_password || '';
  const reseteo = await buscarReseteoVigente(req.params.token).catch(() => null);
  if (!reseteo) {
    return res.status(400).render('recuperar-email-confirmar', {
      error: 'Este link ya no es válido -- puede haber vencido (dura 1 hora) o ya haberse usado. Pedí uno nuevo.',
      token: null,
    });
  }
  if (password.length < PASSWORD_MIN_LARGO) {
    return res.render('recuperar-email-confirmar', {
      error: `La contraseña debe tener al menos ${PASSWORD_MIN_LARGO} caracteres.`,
      token: req.params.token,
    });
  }
  if (password !== confirmarPassword) {
    return res.render('recuperar-email-confirmar', { error: 'La contraseña y su confirmación no coinciden.', token: req.params.token });
  }
  try {
    const passwordHash = await bcrypt.hash(password, 12);
    await pool.query('UPDATE usuarios SET password_hash = $1 WHERE id = $2', [passwordHash, reseteo.usuario_id]);
    // Cierra este token y cualquier otro pendiente del mismo usuario --
    // si pidió el link varias veces, un solo uso invalida todos los demás.
    await pool.query('UPDATE reseteos_password SET usado = TRUE WHERE usuario_id = $1 AND usado = FALSE', [reseteo.usuario_id]);
    res.redirect('/login?password_actualizada=1');
  } catch (err) {
    console.error('Error confirmando reseteo de contraseña:', err.message);
    res.status(500).render('recuperar-email-confirmar', { error: 'Error del servidor, intenta de nuevo.', token: req.params.token });
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
  // rama-tema-jungla: preferencia de tema en la cuenta (no localStorage)
  // para que persista entre dispositivos y el HTML salga ya con el data-
  // theme correcto desde el servidor, sin parpadeo del tema equivocado.
  // NULL = sigue la preferencia del sistema operativo (prefers-color-scheme).
  await pool.query(`
    ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS tema TEXT
  `);
  await pool.query(`
    ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS codigo_recuperacion_hash TEXT
  `);
  // rama-invitar-amigos: código de invitación, decisión documentada en
  // COORDINACION.md — a diferencia de codigo_recuperacion_hash, este NO se
  // guarda hasheado ni es de un solo uso (otro modelo de amenaza: no
  // desbloquea ninguna cuenta, solo pre-carga una solicitud de amistad).
  await pool.query(`
    ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS codigo_invitacion TEXT UNIQUE
  `);
  // rama-onboarding: decisión documentada en COORDINACION.md — columna
  // booleana simple en usuarios (mismo criterio que el resto del
  // esquema), en vez de una tabla aparte. Cuentas viejas (creadas antes
  // de esta rama) quedan en FALSE por defecto, pero nunca se les fuerza
  // el onboarding porque nada las redirige a /onboarding automáticamente
  // — solo el flujo de /registro lo hace.
  // DEPRECADA por rama-tutorial-interactivo (reemplaza el carrusel
  // estático de /onboarding por un tour interactivo en /captura, ver
  // `tutorial_interactivo_visto` más abajo) -- se deja la columna y el
  // comentario histórico sin tocar, no vale la pena una migración para
  // borrar una columna booleana que ya nadie escribe.
  await pool.query(`
    ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS onboarding_visto BOOLEAN NOT NULL DEFAULT FALSE
  `);
  // rama-tutorial-interactivo: columna NUEVA y separada de
  // `onboarding_visto` a propósito -- si reusara esa misma columna, TODAS
  // las cuentas ya existentes (creadas antes de esta rama, con
  // onboarding_visto=FALSE de fábrica -- confirmado contra la DB real:
  // hasta la cuenta del propio dueño del proyecto está en FALSE) verían
  // el tour disparado la próxima vez que abran /captura, que es API
  // visitada por cualquier usuario logueado constantemente. DEFAULT TRUE
  // (a diferencia de la columna vieja) para que ninguna cuenta existente
  // se vea afectada; el registro nuevo (`POST /registro`) la inserta en
  // FALSE explícitamente para que SOLO los usuarios que se registran de
  // acá en adelante vean el tour.
  await pool.query(`
    ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS tutorial_interactivo_visto BOOLEAN NOT NULL DEFAULT TRUE
  `);
  // rama-tutorial-multicapitulo: reemplaza el booleano único de arriba por
  // una tabla (varios capítulos posibles, no solo "visto sí/no"). Se DEJA
  // `tutorial_interactivo_visto` sin usar de acá en más -- mismo criterio ya
  // aplicado arriba con `onboarding_visto`, no vale la pena una migración
  // para borrar una columna booleana que ya nadie escribe. Migración
  // única: cualquier cuenta que ya tenía `tutorial_interactivo_visto = TRUE`
  // (cuentas viejas por el DEFAULT, o cuentas que ya vieron/saltaron el tour
  // de un solo capítulo) recibe una fila 'basico' acá, para no volver a
  // dispararles el tour nuevo -- sin pagar recompensa, porque no es una
  // finalización real de los 4 pasos nuevos.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tutorial_capitulos_completados (
      usuario_id INT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      capitulo TEXT NOT NULL,
      completado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (usuario_id, capitulo)
    )
  `);
  await pool.query(`
    INSERT INTO tutorial_capitulos_completados (usuario_id, capitulo)
    SELECT id, 'basico' FROM usuarios WHERE tutorial_interactivo_visto = TRUE
    ON CONFLICT (usuario_id, capitulo) DO NOTHING
  `);
  // rama-login-email: login alternativo por email+contraseña, ADICIONAL al
  // de usuario+PIN -- no lo reemplaza, ambos quedan disponibles a la vez.
  // Ambas columnas nullable a propósito: las cuentas existentes solo tienen
  // usuario+PIN y siguen funcionando igual; se vinculan opcionalmente desde
  // /ajustes. UNIQUE en email para poder buscarlo en el login sin
  // ambigüedad -- Postgres permite múltiples NULL en una columna UNIQUE, así
  // que no bloquea a las cuentas que nunca lo vinculen.
  await pool.query(`
    ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS email TEXT UNIQUE
  `);
  await pool.query(`
    ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS password_hash TEXT
  `);
  // rama-login-email: tokens de restablecimiento de contraseña (el correo lo
  // manda /recuperar-email vía Gmail SMTP). Un usuario puede pedir el link
  // varias veces -- por eso es tabla aparte y no una columna en usuarios,
  // para no pisar un token vigente con uno nuevo si el usuario reintenta.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS reseteos_password (
      id SERIAL PRIMARY KEY,
      usuario_id INT REFERENCES usuarios(id),
      token_hash TEXT UNIQUE,
      expira TIMESTAMP,
      usado BOOLEAN NOT NULL DEFAULT FALSE,
      creado TIMESTAMP DEFAULT now()
    )
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
  // rama-segmentacion-ideas (Fase 1 de v0.2, ver COORDINACION.md): etiqueta
  // corta de tema por idea — desde esta rama, una fila de `ideas` es un
  // pensamiento atómico, no necesariamente la captura completa del usuario.
  // NULL en filas que Groq no pudo etiquetar (ver segmentarIdeaConGroq).
  await pool.query(`
    ALTER TABLE ideas ADD COLUMN IF NOT EXISTS etiqueta TEXT
  `);
  // Snapshot de `ideas` tal cual estaba ANTES de la migración retroactiva de
  // segmentación (scripts/migrar_segmentar_ideas.js) — permite revertir si
  // el corte de Groq queda mal. Solo estructura acá; la población (una sola
  // vez, si está vacía) la hace el script, no ensureSchema, que corre en
  // cada arranque del server.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ideas_backup_pre_segmentacion (
      id INT,
      fecha TEXT,
      idea TEXT,
      estado TEXT,
      usuario_id INT,
      respaldado_en TIMESTAMP DEFAULT now()
    )
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
  // rama-notificaciones-recordatorios: decisión de esquema documentada en
  // COORDINACION.md — nullable porque las suscripciones viejas (aviso
  // diario genérico) no tienen dueño y siguen funcionando igual.
  await pool.query(`
    ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS usuario_id INT REFERENCES usuarios(id)
  `);
  // rama-metas (Fase 2 de v0.2): metas personales con progreso numérico.
  // `etiqueta` (no UNIQUE, un usuario puede tener varias metas con la misma
  // si quiere) es la que se compara contra `ideas.etiqueta` (Fase 1) al
  // capturar, para el auto-incremento — ver POST /captura. `valor_actual`
  // arranca en 0 y nunca se decrementa salvo por /metas/:id/deshacer
  // (el "deshacer" del toast de auto-incremento). `estado`: 'activa' es la
  // única que participa en el auto-incremento; 'completada'/'archivada' se
  // muestran pero no siguen sumando.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS metas (
      id SERIAL PRIMARY KEY,
      usuario_id INT REFERENCES usuarios(id),
      titulo TEXT NOT NULL,
      etiqueta TEXT,
      tipo_metrica TEXT,
      valor_objetivo INT NOT NULL DEFAULT 1,
      valor_actual INT NOT NULL DEFAULT 0,
      fecha_objetivo DATE,
      estado TEXT NOT NULL DEFAULT 'activa',
      creado TIMESTAMP DEFAULT now()
    )
  `);
  // rama-metas-compartidas (fast-follow de v0.2, Backlog): igual que `metas`
  // pero con varios participantes en vez de un solo usuario_id. Tabla
  // aparte (no una columna "compartida" en `metas`) porque el modelo es
  // distinto: necesita saber QUIÉNES participan y CUÁNTO aportó cada uno,
  // cosa que una fila de `metas` no tiene dónde guardar. `creado_por` es
  // solo informativo (quién la armó) -- no da más permisos que cualquier
  // otro participante, ver POST /metas/compartida/:id/estado.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS metas_compartidas (
      id SERIAL PRIMARY KEY,
      creado_por INT REFERENCES usuarios(id),
      titulo TEXT NOT NULL,
      etiqueta TEXT,
      tipo_metrica TEXT,
      valor_objetivo INT NOT NULL DEFAULT 1,
      valor_actual INT NOT NULL DEFAULT 0,
      fecha_objetivo DATE,
      estado TEXT NOT NULL DEFAULT 'activa',
      creado TIMESTAMP DEFAULT now()
    )
  `);
  // `aportado`: cuánto sumó ESTE participante específicamente -- separado
  // del total en metas_compartidas.valor_actual, para poder mostrar el
  // desglose por persona (parte del "vibras" de colaboración/comparación
  // que ya tiene la racha entre amigos). Clave primaria compuesta: un
  // usuario participa una sola vez por meta compartida.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS metas_compartidas_participantes (
      meta_compartida_id INT REFERENCES metas_compartidas(id),
      usuario_id INT REFERENCES usuarios(id),
      aportado INT NOT NULL DEFAULT 0,
      PRIMARY KEY (meta_compartida_id, usuario_id)
    )
  `);
  // rama-google-calendar: 1 fila por usuario (no por dispositivo, a
  // diferencia de push_subscriptions) — el refresh_token de Google es por
  // cuenta de Google, no por navegador. iv/auth_tag/datos_cifrados en vez
  // de columnas de texto plano — ver cifrarTokensGoogle/descifrarTokensGoogle.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS google_calendar_tokens (
      usuario_id INT PRIMARY KEY REFERENCES usuarios(id),
      iv TEXT NOT NULL,
      auth_tag TEXT NOT NULL,
      datos_cifrados TEXT NOT NULL,
      actualizado TIMESTAMP DEFAULT now()
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
  // rama-chat-metas: un mensaje puede además "adjuntar" una meta (propia o
  // compartida) en vez de ser solo texto -- se guardan como columnas
  // nullable en la misma fila en vez de una tabla aparte, mismo criterio
  // pragmático que ya usa el resto de la app para adjuntos opcionales (ej.
  // `asignado_a` en pendientes). Nunca las dos a la vez -- lo garantiza el
  // código de POST /mensajes/meta, no una constraint (mismo estilo que el
  // resto del esquema, que no usa CHECK constraints en ningún lado).
  // ON DELETE SET NULL a propósito: la meta referenciada puede pertenecer a
  // un usuario que NO es ninguno de los dos de esta amistad (ej. X crea una
  // meta compartida con A, A la comparte en su chat con B; si X borra su
  // cuenta, POST /ajustes/eliminar-cuenta borra `metas_compartidas` por
  // `creado_por` sin tocar el chat A-B) -- sin SET NULL, ese DELETE
  // reventaría con violación de FK (mismo patrón de bug ya atrapado 3 veces
  // en este proyecto, ver rama-perfil-juego/rama-recapitulacion-diaria en
  // COORDINACION.md). La vista (chat.ejs) ya maneja el caso NULL mostrando
  // "Esta meta ya no existe."
  await pool.query(`
    ALTER TABLE mensajes
      ADD COLUMN IF NOT EXISTS meta_personal_id INT,
      ADD COLUMN IF NOT EXISTS meta_compartida_id INT
  `);
  // Constraints agregadas aparte (no inline en el ADD COLUMN de arriba) y
  // siempre re-declaradas DROP+ADD: así, si esta rama corrió antes en este
  // mismo Postgres con la versión sin ON DELETE SET NULL, el próximo
  // arranque la corrige sola en vez de quedar con el FK viejo para siempre
  // (ADD COLUMN IF NOT EXISTS no vuelve a tocar una columna que ya existe).
  await pool.query(`ALTER TABLE mensajes DROP CONSTRAINT IF EXISTS mensajes_meta_personal_id_fkey`);
  await pool.query(`ALTER TABLE mensajes ADD CONSTRAINT mensajes_meta_personal_id_fkey FOREIGN KEY (meta_personal_id) REFERENCES metas(id) ON DELETE SET NULL`);
  await pool.query(`ALTER TABLE mensajes DROP CONSTRAINT IF EXISTS mensajes_meta_compartida_id_fkey`);
  await pool.query(`ALTER TABLE mensajes ADD CONSTRAINT mensajes_meta_compartida_id_fkey FOREIGN KEY (meta_compartida_id) REFERENCES metas_compartidas(id) ON DELETE SET NULL`);
  // rama-chat-metas (optimización, pedida explícitamente por el usuario --
  // "quiero que sea veloz"): GET /chat filtra por amistad_id y ordena por
  // fecha en cada apertura del chat -- sin este índice, Postgres hace un
  // seq scan completo de `mensajes` que solo va a doler más a medida que
  // se acumulen conversaciones. Mismo patrón que el índice ya existente de
  // mensajes_ia (usuario_id, fecha).
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_mensajes_amistad_fecha ON mensajes (amistad_id, fecha)
  `);
  // rama-chat-general: sala única para todos los usuarios, sin amistad_id
  // de por medio (decisión documentada en COORDINACION.md).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS mensajes_generales (
      id SERIAL PRIMARY KEY,
      autor_id INT REFERENCES usuarios(id),
      texto TEXT,
      fecha TIMESTAMP DEFAULT now()
    )
  `);
  await pool.query(`
    ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS chat_general_visto_hasta TIMESTAMP
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS historial_ediciones (
      id SERIAL PRIMARY KEY,
      pendiente_id INT REFERENCES pendientes(id),
      texto_anterior TEXT,
      editado TIMESTAMP DEFAULT now()
    )
  `);
  // rama-trazabilidad-social: decisión de esquema documentada en
  // COORDINACION.md — tabla nueva en vez de columna en `pendientes`, porque
  // un evento de completado es inmutable y separado del estado actual del
  // pendiente (mismo espíritu que historial_ediciones arriba).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS eventos_completado (
      id SERIAL PRIMARY KEY,
      pendiente_id INT REFERENCES pendientes(id),
      completado_por INT REFERENCES usuarios(id),
      comentario TEXT,
      fecha TIMESTAMP DEFAULT now()
    )
  `);
  // rama-moneda-virtual (tarea 7 del roadmap): decisión de esquema
  // documentada en COORDINACION.md.
  await pool.query(`
    ALTER TABLE eventos_completado ADD COLUMN IF NOT EXISTS cuenta_para_racha BOOLEAN NOT NULL DEFAULT TRUE
  `);
  await pool.query(`
    ALTER TABLE pendientes ADD COLUMN IF NOT EXISTS asignado_en TIMESTAMP
  `);
  await pool.query(`
    ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS saldo_moneda INT NOT NULL DEFAULT 0
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS moneda_transacciones (
      id SERIAL PRIMARY KEY,
      usuario_id INT REFERENCES usuarios(id),
      cantidad INT NOT NULL,
      origen TEXT NOT NULL DEFAULT 'ganada',
      motivo TEXT,
      evento_completado_id INT REFERENCES eventos_completado(id),
      fecha TIMESTAMP DEFAULT now()
    )
  `);
  // rama-ia-companera-fase1 (tarea 8 del roadmap): decisiones documentadas
  // en COORDINACION.md. ia_especie/ia_etapa NO se persiste como columna: la
  // etapa se calcula en vivo a partir de moneda_transacciones (ver
  // etapaPorMoneda más abajo) para que nunca pueda desincronizarse.
  await pool.query(`
    ALTER TABLE usuarios
      ADD COLUMN IF NOT EXISTS ia_especie TEXT,
      ADD COLUMN IF NOT EXISTS ia_skin TEXT NOT NULL DEFAULT 'clasico',
      ADD COLUMN IF NOT EXISTS ia_nombre TEXT,
      ADD COLUMN IF NOT EXISTS ia_tema_extra TEXT,
      ADD COLUMN IF NOT EXISTS comodines_perdon_disponibles INT NOT NULL DEFAULT 0
  `);
  // Días "perdonados": cuentan como si hubiera actividad para la racha que
  // se muestra en /ia (NO toca la racha de /estadisticas ni la de la tarea
  // 7 que paga moneda — queda deliberadamente aislado, ver COORDINACION.md).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS racha_protecciones (
      id SERIAL PRIMARY KEY,
      usuario_id INT REFERENCES usuarios(id),
      fecha DATE NOT NULL,
      creado TIMESTAMP DEFAULT now(),
      UNIQUE (usuario_id, fecha)
    )
  `);
  // rama-sugerencia-estancados (fast-follow de v0.2, Backlog): sugerencia_ia
  // queda en NULL hasta que el job la genera (ver revisarYSugerirPendientesEstancados)
  // -- así el job sabe qué pendientes todavía no procesó sin necesitar una
  // tabla aparte. sugerencia_ia_descartada es independiente de `hecho`: un
  // pendiente descartado de /estancados sigue activo en la lista normal,
  // simplemente no se le vuelve a mostrar (ni regenerar) la sugerencia.
  await pool.query(`
    ALTER TABLE pendientes
      ADD COLUMN IF NOT EXISTS sugerencia_ia TEXT,
      ADD COLUMN IF NOT EXISTS sugerencia_ia_generada_en TIMESTAMP,
      ADD COLUMN IF NOT EXISTS sugerencia_ia_descartada BOOLEAN NOT NULL DEFAULT FALSE
  `);
  // rama-ia-companera-fase2-v2 (tarea 9 del roadmap, reconstruida sobre main
  // actualizado -- ver COORDINACION.md): mensajes_ia es una tabla propia (no
  // reusar mensajes/mensajes_generales, que exigen amistad_id o un autor_id
  // real en usuarios -- la IA no es una fila de usuarios). TIMESTAMPTZ desde
  // el día 1 (a diferencia de otras tablas viejas del proyecto que usan
  // TIMESTAMP naive -- hallazgo documentado en la rama original, ya
  // corregido acá).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS mensajes_ia (
      id SERIAL PRIMARY KEY,
      usuario_id INT REFERENCES usuarios(id),
      rol TEXT NOT NULL CHECK (rol IN ('usuario', 'ia')),
      texto TEXT NOT NULL,
      fecha TIMESTAMPTZ DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_mensajes_ia_usuario_fecha ON mensajes_ia (usuario_id, fecha)
  `);
  // perfil_ia: perfil acumulado, una fila por usuario (usuario_id como PK --
  // relación 1:1, simplifica el upsert). resumen arranca vacío ('') hasta
  // que se acumulan UMBRAL_ACTUALIZAR_PERFIL mensajes nuevos del usuario
  // (ver actualizarPerfilIaSiCorresponde más abajo).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS perfil_ia (
      usuario_id INT PRIMARY KEY REFERENCES usuarios(id),
      resumen TEXT NOT NULL DEFAULT '',
      mensajes_en_resumen INT NOT NULL DEFAULT 0,
      actualizado TIMESTAMPTZ DEFAULT now()
    )
  `);
  // ia_llamadas: instrumentación de costo/latencia desde el día 1 (LLM Ops
  // básico, ver COORDINACION.md) -- costo_usd queda en 0 con Groq (tier
  // gratis) pero se sigue registrando modelo/tokens/latencia como log de uso
  // real. motivo distingue llamadas de chat de las de actualización de
  // perfil, mismo criterio de nomenclatura que moneda_transacciones.origen.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ia_llamadas (
      id SERIAL PRIMARY KEY,
      usuario_id INT REFERENCES usuarios(id),
      modelo TEXT NOT NULL,
      motivo TEXT NOT NULL CHECK (motivo IN ('chat', 'perfil')),
      tokens_entrada INT NOT NULL DEFAULT 0,
      tokens_salida INT NOT NULL DEFAULT 0,
      costo_usd NUMERIC(10,6) NOT NULL DEFAULT 0,
      latencia_ms INT NOT NULL,
      error TEXT,
      fecha TIMESTAMPTZ DEFAULT now()
    )
  `);
  // rama-recapitulacion-diaria (tarea 11 del roadmap): decisiones
  // documentadas en COORDINACION.md. 'reflexion' se suma al CHECK de
  // motivo (drop+add del constraint autogenerado -- idempotente, corre en
  // cada boot igual que el resto de ensureSchema).
  await pool.query(`
    ALTER TABLE ia_llamadas DROP CONSTRAINT IF EXISTS ia_llamadas_motivo_check
  `);
  await pool.query(`
    ALTER TABLE ia_llamadas ADD CONSTRAINT ia_llamadas_motivo_check
      CHECK (motivo IN ('chat', 'perfil', 'reflexion'))
  `);
  // recapitulacion_diaria: PK compuesta (usuario_id, fecha) es el propio
  // mecanismo anti-doble-pago -- el cron intenta un INSERT antes de pagar
  // nada; si ya existe fila para ese usuario+fecha, se salta (ON CONFLICT
  // DO NOTHING). protocolo_version en moneda_transacciones queda NULL
  // para cualquier motivo que no sea 'recapitulacion_diaria' -- el
  // versionado es solo de ESTA fórmula, no retroactivo a tarea 7/8/9.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS recapitulacion_diaria (
      usuario_id INT REFERENCES usuarios(id),
      fecha DATE NOT NULL,
      ejecutado_en TIMESTAMPTZ DEFAULT now(),
      PRIMARY KEY (usuario_id, fecha)
    )
  `);
  await pool.query(`
    ALTER TABLE moneda_transacciones ADD COLUMN IF NOT EXISTS protocolo_version INT
  `);
  // ia_chat_visto_hasta: mismo patrón que chat_general_visto_hasta, para
  // el badge "no leído" del tile "Hablar con tu planta". reflexion_ia_activa:
  // opt-out exigido por la restricción de diseño del 2026-08-16 -- afecta
  // SOLO la reflexión narrativa, el pago de moneda sigue corriendo igual.
  await pool.query(`
    ALTER TABLE usuarios
      ADD COLUMN IF NOT EXISTS ia_chat_visto_hasta TIMESTAMP,
      ADD COLUMN IF NOT EXISTS reflexion_ia_activa BOOLEAN NOT NULL DEFAULT TRUE
  `);
  // rama-logros: primera mecánica nueva del "juego" (de las 4 candidatas
  // que mencionaba la tarea O -- logros, cosméticos, eventos, intercambio).
  // Sin pago de moneda al desbloquear -- puramente celebratorio, cero
  // riesgo de economía. `mostrado` es lo que le permite al middleware
  // global mostrar el toast una sola vez (ver revisarYOtorgarLogros).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS logros_desbloqueados (
      usuario_id INT REFERENCES usuarios(id),
      logro TEXT NOT NULL,
      desbloqueado_en TIMESTAMPTZ DEFAULT now(),
      mostrado BOOLEAN NOT NULL DEFAULT FALSE,
      PRIMARY KEY (usuario_id, logro)
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

// rama-asignacion-texto: detecta un intento de asignar la tarea a un amigo
// dentro del texto libre de "captura rápida" (documentado en detalle en
// COORDINACION.md). Dos patrones, con este orden de precedencia fijo:
//   1) "@nombre" en cualquier parte del texto — sintaxis explícita, gana
//      siempre que aparezca aunque el texto también tenga una frase
//      natural. Si hay varias "@menciones", se usa la primera (más a la
//      izquierda).
//   2) Si no hay "@", frases naturales, revisadas EN ESTE ORDEN: "recuérdale
//      a X" / "asígnale a X" (verbos explícitos de asignar, poco ambiguos)
//      antes que "para X" (mucho más genérico — "comprar pan para la cena"
//      no debería leerse como asignación; el paso siguiente, que exige
//      coincidencia exacta con un amigo real, descarta solo la enorme
//      mayoría de estos falsos positivos).
// El nombre candidato se normaliza (minúsculas, sin tildes) antes de
// compararlo, porque nombre_usuario solo admite [a-zA-Z0-9_] (ver
// NOMBRE_USUARIO_REGEX) — nunca tiene tildes ni espacios, así que basta con
// tomar la primera "palabra" después del patrón.
function extraerNombreCandidatoAsignacion(texto) {
  const normalizado = texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  const arroba = normalizado.match(/@([a-z0-9_]{3,20})/);
  if (arroba) return arroba[1];
  // Candidato acotado a {3,20} (igual que NOMBRE_USUARIO_REGEX): descarta
  // sin consultar la DB palabras cortas frecuentísimas después de "para"
  // ("para la", "para el", "para mí"...) que nunca podrían ser un
  // nombre_usuario real de todas formas.
  const frasesNaturales = [
    /\brecuerdale a ([a-z0-9_]{3,20})/,
    /\basignale a ([a-z0-9_]{3,20})/,
    /\bpara ([a-z0-9_]{3,20})/,
  ];
  for (const regex of frasesNaturales) {
    const coincidencia = normalizado.match(regex);
    if (coincidencia) return coincidencia[1];
  }
  return null;
}

// Busca el nombre candidato entre los amigos ACTUALES (amistad
// estado='aceptada') del usuario, case-insensitive. nombre_usuario es
// UNIQUE en toda la tabla `usuarios` (y ya se guarda en minúsculas, ver
// /registro) así que hoy una coincidencia exacta nunca puede devolver más
// de una fila — el llamador igual maneja `rows.length > 1` como
// "ambigüedad" (lo que pide el enunciado), por robustez ante un futuro
// cambio de esquema (ej. un apodo no-único), aunque no sea alcanzable con
// el esquema actual.
async function buscarAmigoPorNombre(usuarioId, nombreCandidato) {
  const { rows } = await pool.query(
    `SELECT u.id, u.nombre_usuario
     FROM amistades a
     JOIN usuarios u ON u.id = CASE WHEN a.usuario_a_id = $1 THEN a.usuario_b_id ELSE a.usuario_a_id END
     WHERE a.estado = 'aceptada' AND (a.usuario_a_id = $1 OR a.usuario_b_id = $1)
       AND lower(u.nombre_usuario) = $2`,
    [usuarioId, nombreCandidato]
  );
  return rows;
}

async function usuarioPerteneceAmistad(usuarioId, amistadId) {
  const { rows } = await pool.query(
    "SELECT 1 FROM amistades WHERE id = $1 AND estado = 'aceptada' AND (usuario_a_id = $2 OR usuario_b_id = $2)",
    [amistadId, usuarioId]
  );
  return rows.length > 0;
}

// rama-busqueda-filtros: decisión documentada en COORDINACION.md — helper
// chico compartido entre GET / y GET /ideas en vez de duplicar el ILIKE con
// su manejo de índice de parámetro ($N), que es lo único realmente común
// entre esas dos consultas (el resto — categoría, estado, joins — es
// específico de cada una y no vale la pena forzarlo a un solo builder).
function agregarFiltroTexto(consulta, params, columna, q) {
  if (!q) return consulta;
  params.push(`%${q}%`);
  return consulta + ` AND ${columna} ILIKE $${params.length}`;
}

// Antes el estado estaba hardcodeado (WHERE p.hecho = FALSE, solo activos).
// 'pendiente' como default preserva ese comportamiento para quien no toque
// el filtro nuevo.
const ESTADOS_PENDIENTE_VALIDOS = ['pendiente', 'completado'];

app.get('/', async (req, res) => {
  const categoriaFiltro = CATEGORIAS_VALIDAS.includes(req.query.categoria) ? req.query.categoria : null;
  const q = (req.query.q || '').trim();
  const estadoFiltro = ESTADOS_PENDIENTE_VALIDOS.includes(req.query.estado) ? req.query.estado : 'pendiente';
  try {
    // rama-tareas-compartidas: además de los propios, trae los pendientes
    // que un amigo le asignó (asignado_a = usuarioId). Se trae el nombre de
    // quien lo creó para mostrar "Asignado por @fulano" en esos casos.
    const params = [req.usuarioId, estadoFiltro === 'completado'];
    let consulta = `SELECT p.id, p.texto, p.creado, p.necesita_reflexion, p.categoria, p.usuario_id, p.asignado_a,
              uc.nombre_usuario AS creador_nombre
       FROM pendientes p
       LEFT JOIN usuarios uc ON uc.id = p.usuario_id
       WHERE p.hecho = $2 AND p.eliminado = FALSE AND (p.usuario_id = $1 OR p.asignado_a = $1)`;
    if (categoriaFiltro) {
      params.push(categoriaFiltro);
      consulta += ` AND p.categoria = $${params.length}`;
    }
    consulta = agregarFiltroTexto(consulta, params, 'p.texto', q);
    consulta += ' ORDER BY p.creado ASC';
    const { rows } = await pool.query(consulta, params);
    res.render('index', {
      pendientes: rows,
      error: null,
      vapidPublicKey: process.env.VAPID_PUBLIC_KEY || '',
      categorias: CATEGORIAS_VALIDAS,
      categoriaFiltro,
      estadoFiltro,
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
      estadoFiltro,
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

// rama-trazabilidad-social: decisión documentada en COORDINACION.md — se
// amplía esta ruta con "OR asignado_a = $2" en vez de crear una ruta nueva
// para completar tareas asignadas. Es la misma acción (marcar hecho=TRUE);
// duplicarla en dos rutas hubiera significado mantener la misma UPDATE en
// dos lugares. El único comportamiento extra para el caso asignado es el
// evento de trazabilidad + la notificación, ambos condicionados a que la
// tarea tuviera `asignado_a` (es decir, que fuera una tarea compartida).
// rama-moneda-virtual (tarea 7 del roadmap): decisiones documentadas en
// COORDINACION.md — moneda base por tarea asignada completada, reparto
// 70/30 entre quien completa y quien asignó (redondeado sobre el total ya
// con bonus, para que la suma de las dos partes nunca "pierda" una
// moneda por redondeo), bonus por racha de días consecutivos completando
// tareas asignadas, límite diario por persona, y umbral anti-granjeo.
const MONEDA_POR_TAREA_ASIGNADA = 10;
const REPARTO_COMPLETA_PCT = 0.7;
const REPARTO_ASIGNO_PCT = 0.3; // documentado como constante nombrada; en el código se calcula como el resto (total - parteCompleta) para que la suma nunca pierda una moneda por redondeo — REPARTO_COMPLETA_PCT + REPARTO_ASIGNO_PCT debe sumar 1.
const BONUS_MONEDA_POR_DIA_RACHA = 2;
const LIMITE_MONEDA_DIARIA = 100;
const UMBRAL_ANTI_GRANJEO_MINUTOS = 10;

// rama-recapitulacion-diaria (tarea 11 del roadmap): decisiones numéricas
// documentadas en COORDINACION.md. Cubre el hueco real que deja tarea 7
// (que solo paga por tareas ASIGNADAS completadas) -- actividad propia
// (pendientes sin asignar, ideas capturadas, racha general) no pagaba
// nada hasta esta rama. Comparte LIMITE_MONEDA_DIARIA de arriba a
// propósito (mismo criterio que ya usa el tutorial, ver comentario en
// POST /tutorial/capitulo/:capitulo/completar) -- un solo tope, sin
// importar la fuente.
const MONEDA_POR_PENDIENTE_PROPIO = 3;
const MONEDA_POR_IDEA_CAPTURADA = 2;
const MONEDA_BONUS_RACHA_DIARIA = 5;
const UMBRAL_RACHA_BONUS_DIAS = 3;
const PROTOCOLO_MONEDA_DIARIA_VERSION = 1;

async function rachaTareasAsignadas(client, usuarioId) {
  const { rows } = await client.query(
    'SELECT fecha FROM eventos_completado WHERE completado_por = $1 AND cuenta_para_racha = TRUE',
    [usuarioId]
  );
  const dias = new Set(rows.map((r) => formatearDiaLima(r.fecha)));
  return calcularRacha(dias);
}

async function monedaGanadaHoy(client, usuarioId) {
  const { rows } = await client.query(
    `SELECT COALESCE(SUM(cantidad), 0)::int AS total FROM moneda_transacciones
     WHERE usuario_id = $1 AND origen = 'ganada'
       AND fecha >= date_trunc('day', now() AT TIME ZONE 'America/Lima') AT TIME ZONE 'America/Lima'`,
    [usuarioId]
  );
  return rows[0].total;
}

// Devuelve cuánto se pagó realmente (puede ser menos que `cantidad` si el
// límite diario ya estaba parcialmente consumido, o 0 si ya se alcanzó).
// `protocoloVersion` (rama-recapitulacion-diaria, tarea 11) es opcional y
// queda NULL para cualquier caller que no lo pase (tarea 7, tutorial) --
// el versionado es solo de la fórmula de recapitulación diaria, no
// retroactivo a las demás fuentes de moneda.
async function pagarMoneda(client, usuarioId, cantidad, motivo, eventoCompletadoId, protocoloVersion = null) {
  if (cantidad <= 0) return 0;
  const yaGanadaHoy = await monedaGanadaHoy(client, usuarioId);
  const aPagar = Math.min(cantidad, Math.max(0, LIMITE_MONEDA_DIARIA - yaGanadaHoy));
  if (aPagar <= 0) return 0;
  await client.query(
    "INSERT INTO moneda_transacciones (usuario_id, cantidad, origen, motivo, evento_completado_id, protocolo_version) VALUES ($1, $2, 'ganada', $3, $4, $5)",
    [usuarioId, aPagar, motivo, eventoCompletadoId, protocoloVersion]
  );
  await client.query('UPDATE usuarios SET saldo_moneda = saldo_moneda + $1 WHERE id = $2', [aPagar, usuarioId]);
  return aPagar;
}

// rama-ia-companera-fase1 (tarea 8 del roadmap): decisiones numéricas
// documentadas en COORDINACION.md. La planta crece con la moneda GANADA DE
// POR VIDA (ganada + comprada, nunca el saldo gastable), para que comprar
// un skin o un comodín no la haga "retroceder". Curva progresiva: cada
// salto cuesta más que alcanzar el anterior — pensada para uso real entre
// 2 amigos (ver LIMITE_MONEDA_DIARIA=100/día de la tarea 7, difícil de
// agotar todos los días): brote a los ~2 días activos típicos, joven a
// la ~1 semana, adulta a las ~3 semanas.
const IA_ESPECIES = ['monstera', 'cactus', 'ficus', 'suculenta'];
const IA_ETAPAS = ['semilla', 'brote', 'joven', 'adulta'];
const IA_UMBRAL_ETAPA = [0, 50, 200, 500];

// Costos en moneda gastable (usuarios.saldo_moneda) de cada uso, documentados
// junto a la constante como pide el enunciado. El nombre de la IA es
// gratuito (es solo un texto, no un recurso visual/funcional nuevo) — no
// tiene constante de costo.
const IA_COSTO_SKIN = 30;
const IA_COSTO_COMODIN_PERDON = 40;
const IA_COSTO_TEMA_EXTRA = 60;
const IA_SKINS_DISPONIBLES = ['clasico', 'alegre', 'zen', 'nocturno'];
const IA_TEMAS_EXTRA_DISPONIBLES = ['atardecer', 'lluvia'];

// rama-ia-companera-fase2-v2 (tarea 9 del roadmap): IA conversacional real
// -- decisiones documentadas en COORDINACION.md. Gratis para todos los
// usuarios logueados (sin gating de premium); 40 mensajes/usuario/MES (no
// por día, dentro del rango 30-50 pedido) es el tope de seguridad de uso,
// no una restricción de negocio. Proveedor Groq (mismo groqClient/
// GROQ_API_URL/llamarGroqConReintento ya usados por rama-segmentacion-ideas
// más arriba -- reconstruida sobre main para consolidar en un solo cliente
// en vez de duplicarlo, ver tarea J del backlog en COORDINACION.md).
const LIMITE_MENSAJES_IA_POR_MES = 40;
// Cada 15 mensajes nuevos del usuario dispara una actualización del perfil
// acumulado (ver actualizarPerfilIaSiCorresponde) -- con el tope de 40/mes,
// un usuario que agota el límite dispara ~2-3 actualizaciones al mes,
// suficiente para no quedar desactualizado sin ser una llamada extra por
// cada mensaje.
const UMBRAL_ACTUALIZAR_PERFIL = 15;
// Groq es gratis en el tier usado -- costo_usd queda en 0, pero se sigue
// registrando en ia_llamadas (modelo, tokens, latencia) como log de uso
// real por si en el futuro se vuelve a evaluar un modelo pago.
const COSTO_IA_USD = 0;
// Alerta de USO diario -- puramente informativa, nunca bloquea el servicio.
// Lo que puede fallar no es el costo (Groq es gratis), sino el límite de
// 14,400 llamadas/día de la cuenta gratuita compartida con
// rama-segmentacion-ideas/rama-sugerencia-estancados; 10,000 da margen para
// avisar antes de llegar al tope real.
const UMBRAL_ALERTA_LLAMADAS_IA_POR_DIA = 10000;

function etapaPorMoneda(totalDeVida) {
  let indice = 0;
  for (let i = IA_UMBRAL_ETAPA.length - 1; i >= 0; i--) {
    if (totalDeVida >= IA_UMBRAL_ETAPA[i]) {
      indice = i;
      break;
    }
  }
  const siguienteUmbral = indice < IA_UMBRAL_ETAPA.length - 1 ? IA_UMBRAL_ETAPA[indice + 1] : null;
  return { indice, nombre: IA_ETAPAS[indice], siguienteUmbral };
}

async function monedaAcumuladaDeVida(usuarioId) {
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(cantidad), 0)::int AS total FROM moneda_transacciones
     WHERE usuario_id = $1 AND origen IN ('ganada', 'comprada')`,
    [usuarioId]
  );
  return rows[0].total;
}

// Tarea O del backlog (modelo de datos unificado para el "juego"): NO se
// creó ninguna tabla/columna nueva -- el hallazgo real fue que
// barraSuperiorDeUsuario, GET /ia y GET /trazabilidad repetían cada una su
// propia mini-consulta de las mismas columnas/tablas (usuarios, moneda de
// vida, etapa, racha). Esta función es el único punto de lectura para el
// estado del "juego" de un usuario; cualquier pantalla futura (incluida la
// tarea 11 cuando se diseñe) debería llamar acá en vez de repetir el
// patrón disperso otra vez. `incluirPerfilIa` es opt-in porque
// barraSuperiorDeUsuario corre en CADA request logueado (vía el middleware
// global) y no debe sumar una query más de la que ya acepta hoy.
// `usuarioFila` es opcional (mismo criterio que ya usaba
// barraSuperiorDeUsuario): si el caller ya trae la fila de `usuarios`
// (ej. el middleware global, que la extiende con las columnas de acá para
// no repetir el SELECT), se reusa en vez de volver a consultar.
// Deliberadamente NO incluye rachaTareasAsignadas (la racha de tarea 7,
// usada para el bonus de moneda en pagarMoneda) -- esa es lógica de
// negocio/gating, no una lectura de resumen, y es un concepto de racha
// distinto a propósito del que sí devuelve esta función (ver su propio
// comentario en rachasDeUsuarios más abajo).
async function perfilJuegoDeUsuario(usuarioId, { usuarioFila, incluirPerfilIa = false } = {}) {
  const consultas = [
    usuarioFila
      ? Promise.resolve(usuarioFila)
      : pool
          .query(
            `SELECT ia_especie, ia_skin, ia_nombre, ia_tema_extra, saldo_moneda,
                    comodines_perdon_disponibles
             FROM usuarios WHERE id = $1`,
            [usuarioId]
          )
          .then((r) => r.rows[0]),
    monedaAcumuladaDeVida(usuarioId),
    rachasDeUsuarios([usuarioId]),
  ];
  if (incluirPerfilIa) {
    consultas.push(pool.query('SELECT resumen FROM perfil_ia WHERE usuario_id = $1', [usuarioId]));
  }
  const [fila, totalDeVida, rachas, perfilIaRows] = await Promise.all(consultas);
  if (!fila) return null;
  const etapa = etapaPorMoneda(totalDeVida);
  return {
    especie: fila.ia_especie || 'monstera',
    etapa,
    totalDeVida,
    saldoMoneda: fila.saldo_moneda,
    iaNombre: fila.ia_nombre,
    iaSkin: fila.ia_skin || 'clasico',
    iaTemaExtra: fila.ia_tema_extra,
    comodinesDisponibles: fila.comodines_perdon_disponibles,
    rachaGeneral: rachas.get(usuarioId) || 0,
    ...(incluirPerfilIa ? { perfilIaResumen: perfilIaRows.rows[0] ? perfilIaRows.rows[0].resumen : '' } : {}),
  };
}

// rama-logros: catálogo de logros -- mismo espíritu que TUTORIAL_CAPITULOS
// (objeto por slug, criterio evaluado contra stats ya calculados). Todos
// derivados de datos que YA existían antes de esta rama -- cero tracking
// nuevo aparte de la tabla de desbloqueo. Sin recompensa de moneda al
// desbloquear (decisión explícita: puramente celebratorio, a diferencia
// de tareas 7/11).
const LOGROS = {
  primeros_pasos: {
    nombre: 'Primeros pasos',
    descripcion: 'Completá tu primer pendiente.',
    criterio: (stats) => stats.pendientesCompletados >= 1,
  },
  racha_semana: {
    nombre: 'Racha de una semana',
    descripcion: 'Mantené una racha de 7 días.',
    criterio: (stats) => stats.racha >= 7,
  },
  racha_mes: {
    nombre: 'Racha de un mes',
    descripcion: 'Mantené una racha de 30 días.',
    criterio: (stats) => stats.racha >= 30,
  },
  planta_adulta: {
    nombre: 'Planta adulta',
    descripcion: 'Llevá tu planta a la etapa adulta.',
    criterio: (stats) => stats.etapaIndice >= IA_ETAPAS.length - 1,
  },
  cien_tareas: {
    nombre: 'Cien tareas',
    descripcion: 'Completá 100 pendientes en total.',
    criterio: (stats) => stats.pendientesCompletados >= 100,
  },
  coleccionista_ideas: {
    nombre: 'Coleccionista de ideas',
    descripcion: 'Capturá 50 ideas.',
    criterio: (stats) => stats.ideasCapturadas >= 50,
  },
  mejor_en_equipo: {
    nombre: 'Mejor en equipo',
    descripcion: 'Completá 10 tareas que te asignó un amigo.',
    criterio: (stats) => stats.tareasAsignadasCompletadas >= 10,
  },
  graduado: {
    nombre: 'Graduado',
    descripcion: 'Completá los 3 capítulos del tutorial.',
    criterio: (stats) => stats.tutorialCompletados >= 3,
  },
  primer_amigo: {
    nombre: 'Primer amigo',
    descripcion: 'Hacé tu primera amistad.',
    criterio: (stats) => stats.amigos >= 1,
  },
};

// Revisa los logros todavía no desbloqueados de un usuario y otorga los
// que ya cumplen su criterio. Se llama desde los puntos donde puede
// cambiar algún stat relevante (completar pendiente, capturar idea,
// aceptar amistad, completar capítulo de tutorial, recapitulación
// diaria) -- no hace falta engancharlo a pagarMoneda genérico, esos 5
// puntos cubren todo lo que puede mover un criterio. Devuelve los slugs
// recién otorgados (para quien quiera usarlos, aunque hoy nadie los usa
// directo -- la celebración la arma el middleware global leyendo
// `mostrado=FALSE`, no el valor de retorno de esta función).
async function revisarYOtorgarLogros(usuarioId) {
  const [yaDesbloqueadosRows, perfil, pendRows, ideasRows, eventosRows, tutRows, amigosRows] = await Promise.all([
    pool.query('SELECT logro FROM logros_desbloqueados WHERE usuario_id = $1', [usuarioId]),
    perfilJuegoDeUsuario(usuarioId),
    pool.query('SELECT COUNT(*)::int AS c FROM pendientes WHERE usuario_id = $1 AND hecho = TRUE AND eliminado = FALSE', [
      usuarioId,
    ]),
    pool.query('SELECT COUNT(*)::int AS c FROM ideas WHERE usuario_id = $1', [usuarioId]),
    pool.query('SELECT COUNT(*)::int AS c FROM eventos_completado WHERE completado_por = $1', [usuarioId]),
    pool.query('SELECT COUNT(*)::int AS c FROM tutorial_capitulos_completados WHERE usuario_id = $1', [usuarioId]),
    pool.query(
      "SELECT COUNT(*)::int AS c FROM amistades WHERE (usuario_a_id = $1 OR usuario_b_id = $1) AND estado = 'aceptada'",
      [usuarioId]
    ),
  ]);
  const yaDesbloqueados = new Set(yaDesbloqueadosRows.rows.map((r) => r.logro));
  const stats = {
    pendientesCompletados: pendRows.rows[0].c,
    racha: perfil ? perfil.rachaGeneral : 0,
    etapaIndice: perfil ? perfil.etapa.indice : 0,
    ideasCapturadas: ideasRows.rows[0].c,
    tareasAsignadasCompletadas: eventosRows.rows[0].c,
    tutorialCompletados: tutRows.rows[0].c,
    amigos: amigosRows.rows[0].c,
  };
  const nuevos = Object.entries(LOGROS)
    .filter(([slug, logro]) => !yaDesbloqueados.has(slug) && logro.criterio(stats))
    .map(([slug]) => slug);
  for (const slug of nuevos) {
    await pool.query('INSERT INTO logros_desbloqueados (usuario_id, logro) VALUES ($1, $2) ON CONFLICT DO NOTHING', [
      usuarioId,
      slug,
    ]);
  }
  return nuevos;
}

// Origen 'gastada' es una extensión chica sobre el enum de la tarea 7
// (que solo pedía distinguir 'ganada' de 'comprada' para la compra futura
// de moneda con dinero real) — hacía falta un tercer valor para registrar
// el GASTO de moneda en el mismo log, sin mezclarlo con ninguno de los
// otros dos. cantidad va negativa para que el log siga sumando al total
// real gastado/ganado si algún día se audita entero.
async function gastarMoneda(client, usuarioId, cantidad, motivo) {
  const { rows } = await client.query('SELECT saldo_moneda FROM usuarios WHERE id = $1 FOR UPDATE', [usuarioId]);
  const saldo = rows[0] ? rows[0].saldo_moneda : 0;
  if (saldo < cantidad) return false;
  await client.query('UPDATE usuarios SET saldo_moneda = saldo_moneda - $1 WHERE id = $2', [cantidad, usuarioId]);
  await client.query(
    "INSERT INTO moneda_transacciones (usuario_id, cantidad, origen, motivo) VALUES ($1, $2, 'gastada', $3)",
    [usuarioId, -cantidad, motivo]
  );
  return true;
}

// Observaciones simples sobre datos propios del usuario — estadística sobre
// tablas ya existentes, sin llamar ningún modelo de IA (a propósito, la
// tarea 8 es Fase 1: la conversación real es Fase 2, tarea 9, todavía
// bloqueada). Reusa formatearDiaLima/calcularRacha de /estadisticas.
async function observacionesIA(usuarioId) {
  const observaciones = [];
  const [completados, protegidos, horaMasFrecuente] = await Promise.all([
    pool.query('SELECT creado FROM pendientes WHERE hecho = TRUE AND eliminado = FALSE AND usuario_id = $1', [usuarioId]),
    pool.query('SELECT fecha FROM racha_protecciones WHERE usuario_id = $1', [usuarioId]),
    pool.query(
      `SELECT EXTRACT(HOUR FROM creado AT TIME ZONE 'America/Lima')::int AS hora, COUNT(*)::int AS cantidad
       FROM pendientes WHERE hecho = TRUE AND eliminado = FALSE AND usuario_id = $1
       GROUP BY hora ORDER BY cantidad DESC LIMIT 1`,
      [usuarioId]
    ),
  ]);

  const diasConActividad = new Set(completados.rows.map((r) => formatearDiaLima(r.creado)));
  protegidos.rows.forEach((r) => diasConActividad.add(formatearDiaLima(r.fecha)));
  const racha = calcularRacha(diasConActividad);
  if (racha > 0) {
    observaciones.push(`Llevás ${racha} día(s) seguidos completando algo. Así se cuida una racha.`);
  } else {
    observaciones.push('Todavía no armaste una racha — completar algo hoy es un buen comienzo.');
  }

  if (horaMasFrecuente.rows[0]) {
    observaciones.push(`Sos más activo cerca de las ${horaMasFrecuente.rows[0].hora}:00.`);
  }

  observaciones.push(`Completaste ${completados.rows.length} pendiente(s) en total desde que empezaste.`);
  return observaciones;
}

// rama-ia-companera-fase2-v2 (tarea 9 del roadmap): IA conversacional real
// -- decisiones documentadas en COORDINACION.md. Reusa groqClient/
// GROQ_API_URL/llamarGroqConReintento (definidos más abajo, function
// declaration -- hoisting normal de JS, no hace falta reordenar) en vez de
// un cliente propio.

// Reseteo por MES calendario America/Lima (no por día). Solo cuenta
// mensajes rol='usuario' (no las respuestas de la IA).
async function contarMensajesIaEsteMes(usuarioId) {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS cantidad FROM mensajes_ia
     WHERE usuario_id = $1 AND rol = 'usuario'
       AND date_trunc('month', fecha AT TIME ZONE 'America/Lima')
         = date_trunc('month', now() AT TIME ZONE 'America/Lima')`,
    [usuarioId]
  );
  return rows[0].cantidad;
}

// Alerta de uso diario (ver UMBRAL_ALERTA_LLAMADAS_IA_POR_DIA): total
// global (sin usuario_id) de llamadas a Groq (chat + perfil, todos los
// usuarios, éxito o error) del día calendario America/Lima actual. Nunca
// bloquea el servicio -- es puramente informativa.
async function contarLlamadasIaHoy() {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS total FROM ia_llamadas
     WHERE date_trunc('day', fecha AT TIME ZONE 'America/Lima')
       = date_trunc('day', now() AT TIME ZONE 'America/Lima')`
  );
  return rows[0].total;
}

// Se llama después de cada INSERT exitoso en ia_llamadas (chat o perfil).
// Se chequea en cada request que agrega una llamada, sin deduplicar -- es
// una sola query de agregación barata, y en una app de este tamaño no
// genera spam de log real.
async function avisarSiLlamadasIaSeAcercanAlLimite() {
  const total = await contarLlamadasIaHoy();
  if (total >= UMBRAL_ALERTA_LLAMADAS_IA_POR_DIA) {
    console.warn(
      `⚠️ Llamadas a Groq hoy: ${total} (umbral de aviso: ${UMBRAL_ALERTA_LLAMADAS_IA_POR_DIA} de las 14,400 diarias del tier gratis)`
    );
  }
}

// RAG: recupera del Postgres existente lo que el usuario realmente escribió
// (mismas tablas/patrón que /exportar y /estadisticas, Promise.all en
// paralelo) y arma el prompt con eso como contexto explícito, más el perfil
// acumulado si existe. Historial de conversación: últimos ~10 turnos (20
// mensajes usuario+ia intercalados) de mensajes_ia.
async function construirContextoIA(usuarioId) {
  const [pendientes, completados, ideas, recordatorios, hechos, reflexiones, perfil, historialRows] = await Promise.all([
    pool.query(
      'SELECT texto, categoria FROM pendientes WHERE usuario_id = $1 AND hecho = FALSE AND eliminado = FALSE ORDER BY creado DESC LIMIT 20',
      [usuarioId]
    ),
    pool.query(
      'SELECT texto FROM pendientes WHERE usuario_id = $1 AND hecho = TRUE AND eliminado = FALSE ORDER BY creado DESC LIMIT 10',
      [usuarioId]
    ),
    pool.query('SELECT idea, etiqueta FROM ideas WHERE usuario_id = $1 ORDER BY fecha DESC LIMIT 10', [usuarioId]),
    pool.query('SELECT texto FROM recordatorios WHERE usuario_id = $1 ORDER BY cuando DESC LIMIT 10', [usuarioId]),
    pool.query('SELECT texto FROM hechos WHERE usuario_id = $1 ORDER BY cuando DESC LIMIT 10', [usuarioId]),
    pool.query(
      'SELECT pregunta, respuesta FROM reflexiones WHERE usuario_id = $1 ORDER BY fecha DESC LIMIT 5',
      [usuarioId]
    ),
    pool.query('SELECT resumen FROM perfil_ia WHERE usuario_id = $1', [usuarioId]),
    pool.query(
      'SELECT rol, texto FROM mensajes_ia WHERE usuario_id = $1 ORDER BY fecha DESC LIMIT 20',
      [usuarioId]
    ),
  ]);
  const observaciones = await observacionesIA(usuarioId);

  const lineas = [];
  lineas.push(
    'Sos la IA compañera de un usuario en una app de organización personal ' +
    '(pendientes, ideas, recordatorios, hechos, reflexiones). Respondé en ' +
    'español, con un tono cercano e informal ("vos"), y basate SOLO en los ' +
    'datos reales listados abajo -- nunca inventes pendientes, ideas ni ' +
    'hechos que no estén ahí.'
  );

  const resumenPerfil = perfil.rows[0] && perfil.rows[0].resumen ? perfil.rows[0].resumen.trim() : '';
  if (resumenPerfil) {
    lineas.push('\n## Lo que ya sabemos de vos\n' + resumenPerfil);
  }

  lineas.push('\n## Pendientes activos');
  lineas.push(
    pendientes.rows.length
      ? pendientes.rows.map((p) => `- ${p.texto}${p.categoria ? ` [${p.categoria}]` : ''}`).join('\n')
      : '(sin pendientes activos)'
  );

  lineas.push('\n## Completados recientes');
  lineas.push(completados.rows.length ? completados.rows.map((p) => `- ${p.texto}`).join('\n') : '(sin completados recientes)');

  lineas.push('\n## Ideas');
  lineas.push(
    ideas.rows.length
      ? ideas.rows.map((i) => `- ${i.idea}${i.etiqueta ? ` [${i.etiqueta}]` : ''}`).join('\n')
      : '(sin ideas anotadas)'
  );

  lineas.push('\n## Recordatorios');
  lineas.push(recordatorios.rows.length ? recordatorios.rows.map((r) => `- ${r.texto}`).join('\n') : '(sin recordatorios)');

  lineas.push('\n## Hechos');
  lineas.push(hechos.rows.length ? hechos.rows.map((h) => `- ${h.texto}`).join('\n') : '(sin hechos registrados)');

  lineas.push('\n## Reflexiones');
  lineas.push(
    reflexiones.rows.length
      ? reflexiones.rows.map((r) => `- ${r.pregunta}: ${r.respuesta}`).join('\n')
      : '(sin reflexiones)'
  );

  lineas.push('\n## Observaciones');
  lineas.push(observaciones.map((o) => `- ${o}`).join('\n'));

  const historial = historialRows.rows.slice().reverse();

  return { system: lineas.join('\n'), historial };
}

// Disparador: contador de mensajes nuevos, no cron (ver UMBRAL_ACTUALIZAR_PERFIL
// más arriba). No debe romper el chat normal si falla -- el call site la
// envuelve en su propio try/catch.
async function actualizarPerfilIaSiCorresponde(usuarioId) {
  const { rows: totalRows } = await pool.query(
    "SELECT COUNT(*)::int AS total FROM mensajes_ia WHERE usuario_id = $1 AND rol = 'usuario'",
    [usuarioId]
  );
  const totalMensajes = totalRows[0].total;

  const { rows: perfilRows } = await pool.query(
    'SELECT resumen, mensajes_en_resumen FROM perfil_ia WHERE usuario_id = $1',
    [usuarioId]
  );
  const mensajesEnResumen = perfilRows[0] ? perfilRows[0].mensajes_en_resumen : 0;

  if (totalMensajes - mensajesEnResumen < UMBRAL_ACTUALIZAR_PERFIL) {
    return;
  }

  const { rows: recientes } = await pool.query(
    'SELECT rol, texto FROM mensajes_ia WHERE usuario_id = $1 ORDER BY fecha DESC LIMIT 30',
    [usuarioId]
  );
  const conversacion = recientes
    .slice()
    .reverse()
    .map((m) => `${m.rol === 'usuario' ? 'Usuario' : 'IA'}: ${m.texto}`)
    .join('\n');

  // El perfil no solo acumula, también revisa: se le pide explícitamente al
  // modelo que compare contra el resumen anterior y decida qué sigue
  // vigente, para evitar que datos viejos ("usa Make") convivan como verdad
  // simultánea con datos nuevos que los reemplazan ("migró a Python").
  const resumenPrevioTexto = perfilRows[0] && perfilRows[0].resumen ? perfilRows[0].resumen.trim() : '';
  const systemResumen = resumenPrevioTexto
    ? `Resumen anterior de este usuario: "${resumenPrevioTexto}"\n\nA partir de la conversación nueva de abajo, actualizá ese resumen en 2-3 oraciones: mantené lo que sigue vigente, reemplazá lo que quedó obsoleto (ej. si antes decía que usaba una herramienta y ahora usa otra, quedate con la nueva), y sumá patrones nuevos si los hay. Sé concreto y breve, en español.`
    : 'Resumí en 2-3 oraciones los patrones de comportamiento que notás en esta conversación -- hábitos, horarios, temas recurrentes. Sé concreto y breve, en español.';

  const inicio = Date.now();
  try {
    const respuestaGroq = await llamarGroqConReintento(systemResumen, conversacion, {
      maxTokens: 200,
      responseFormat: 'text',
    });
    const { texto: resumen, tokensEntrada, tokensSalida } = await extraerTextoYTokensGroq(respuestaGroq);
    const latenciaMs = Date.now() - inicio;

    await pool.query(
      `INSERT INTO ia_llamadas (usuario_id, modelo, motivo, tokens_entrada, tokens_salida, costo_usd, latencia_ms)
       VALUES ($1, $2, 'perfil', $3, $4, $5, $6)`,
      [usuarioId, MODELO_IA_SEGMENTACION, tokensEntrada, tokensSalida, COSTO_IA_USD, latenciaMs]
    );
    await avisarSiLlamadasIaSeAcercanAlLimite();
    await pool.query(
      `INSERT INTO perfil_ia (usuario_id, resumen, mensajes_en_resumen)
       VALUES ($1, $2, $3)
       ON CONFLICT (usuario_id) DO UPDATE SET resumen = $2, mensajes_en_resumen = $3, actualizado = now()`,
      [usuarioId, resumen, totalMensajes]
    );
  } catch (err) {
    const latenciaMs = Date.now() - inicio;
    console.error('Error actualizando perfil_ia:', err.message);
    await pool.query(
      `INSERT INTO ia_llamadas (usuario_id, modelo, motivo, tokens_entrada, tokens_salida, costo_usd, latencia_ms, error)
       VALUES ($1, $2, 'perfil', 0, 0, 0, $3, $4)`,
      [usuarioId, MODELO_IA_SEGMENTACION, latenciaMs, String((err && err.message) || err).slice(0, 500)]
    );
  }
}

// rama-recapitulacion-diaria (tarea 11 del roadmap): reflexión narrativa
// del cron diario -- usa perfil_ia.resumen + SOLO el delta del día (nunca
// el historial crudo completo, decisión de diseño del 2026-08-16
// documentada en COORDINACION.md). El caller (recapitularUsuario) solo
// llama a esta función cuando hubo actividad real ese día -- nunca genera
// un mensaje de "no hiciste nada". No debe romper el cron si falla --
// mismo contrato que actualizarPerfilIaSiCorresponde (nunca lanza).
async function generarReflexionDiaria(usuarioId, delta) {
  const { rows: perfilRows } = await pool.query('SELECT resumen FROM perfil_ia WHERE usuario_id = $1', [usuarioId]);
  const resumenPrevio = perfilRows[0] && perfilRows[0].resumen ? perfilRows[0].resumen.trim() : '';

  const lineasDelta = [];
  if (delta.pendientesPropios.length) {
    lineasDelta.push(
      'Pendientes propios completados hoy:\n' + delta.pendientesPropios.map((t) => `- ${t}`).join('\n')
    );
  }
  if (delta.ideas.length) {
    lineasDelta.push(
      'Ideas capturadas hoy:\n' +
        delta.ideas.map((i) => `- ${i.idea}${i.etiqueta ? ` [${i.etiqueta}]` : ''}`).join('\n')
    );
  }
  if (delta.rachaDias >= UMBRAL_RACHA_BONUS_DIAS) {
    lineasDelta.push(`Lleva una racha activa de ${delta.rachaDias} día(s) seguidos.`);
  }

  const system =
    'Sos la IA compañera de una app de organización personal, hablando como ' +
    'si fueras la planta del usuario. Tu tarea es escribir UN mensaje corto ' +
    '(2-3 oraciones) de reflexión sobre la actividad de HOY del usuario, en ' +
    'español, tono cercano ("vos"). Reglas estrictas: (1) SIEMPRE tono ' +
    'neutral o positivo -- nunca frasees como reproche ("no cumpliste", ' +
    '"bajaste tu ritmo"), aunque la actividad haya sido poca. (2) Basate ' +
    'SOLO en los datos de hoy listados abajo, más lo que ya sabés del ' +
    'usuario -- nunca inventes datos. (3) No repitas la lista textual, ' +
    'convertila en una observación natural, como lo diría una planta que ' +
    'nota a su compañero humano.' +
    (resumenPrevio ? `\n\nLo que ya sabés de este usuario: ${resumenPrevio}` : '');

  const inicio = Date.now();
  try {
    const respuestaGroq = await llamarGroqConReintento(system, lineasDelta.join('\n\n'), {
      maxTokens: 200,
      responseFormat: 'text',
    });
    const { texto: reflexion, tokensEntrada, tokensSalida } = await extraerTextoYTokensGroq(respuestaGroq);
    const latenciaMs = Date.now() - inicio;
    await pool.query(
      `INSERT INTO ia_llamadas (usuario_id, modelo, motivo, tokens_entrada, tokens_salida, costo_usd, latencia_ms)
       VALUES ($1, $2, 'reflexion', $3, $4, $5, $6)`,
      [usuarioId, MODELO_IA_SEGMENTACION, tokensEntrada, tokensSalida, COSTO_IA_USD, latenciaMs]
    );
    await avisarSiLlamadasIaSeAcercanAlLimite();
    await pool.query("INSERT INTO mensajes_ia (usuario_id, rol, texto) VALUES ($1, 'ia', $2)", [
      usuarioId,
      reflexion.trim(),
    ]);
  } catch (err) {
    const latenciaMs = Date.now() - inicio;
    console.error(`Error generando reflexión diaria para usuario ${usuarioId}:`, err.message);
    await pool.query(
      `INSERT INTO ia_llamadas (usuario_id, modelo, motivo, tokens_entrada, tokens_salida, costo_usd, latencia_ms, error)
       VALUES ($1, $2, 'reflexion', 0, 0, 0, $3, $4)`,
      [usuarioId, MODELO_IA_SEGMENTACION, latenciaMs, String((err && err.message) || err).slice(0, 500)]
    );
  }
}

// Cron diario -- calcula la actividad del día calendario Lima ANTERIOR
// completo (nunca el día en curso, evita el caso borde de correr a
// medianoche sin el día completo todavía). Por usuario: reserva el día en
// recapitulacion_diaria ANTES de pagar nada (evita doble pago si el cron
// corre dos veces), paga con pagarMoneda (mismo LIMITE_MONEDA_DIARIA
// compartido con tarea 7 y el tutorial), y si hubo actividad real +
// reflexion_ia_activa, genera la reflexión narrativa DESPUÉS del commit
// (la llamada a Groq no debe mantener la conexión pooled ocupada).
async function recapitularUsuario(usuarioId, reflexionActiva, diaObjetivo, inicio, fin) {
  const client = await pool.connect();
  let huboActividad = false;
  let delta = null;
  try {
    await client.query('BEGIN');
    const reserva = await client.query(
      'INSERT INTO recapitulacion_diaria (usuario_id, fecha) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING usuario_id',
      [usuarioId, diaObjetivo]
    );
    if (reserva.rows.length > 0) {
      // asignado_a IS NULL: nunca cuenta un pendiente que tarea 7 ya pagó
      // (esa paga en tiempo real, solo para completados de tareas
      // ASIGNADAS -- ver POST /pendientes/:id/completar).
      const [pendientesRows, ideasRows, rachas] = await Promise.all([
        client.query(
          `SELECT texto FROM pendientes
           WHERE usuario_id = $1 AND hecho = TRUE AND eliminado = FALSE AND asignado_a IS NULL
             AND creado >= $2 AND creado < $3`,
          [usuarioId, inicio, fin]
        ),
        client.query('SELECT idea, etiqueta FROM ideas WHERE usuario_id = $1 AND fecha >= $2 AND fecha < $3', [
          usuarioId,
          inicio,
          fin,
        ]),
        rachasDeUsuarios([usuarioId]),
      ]);
      const rachaDias = rachas.get(usuarioId) || 0;
      huboActividad = pendientesRows.rows.length > 0 || ideasRows.rows.length > 0 || rachaDias >= UMBRAL_RACHA_BONUS_DIAS;
      if (huboActividad) {
        const total =
          pendientesRows.rows.length * MONEDA_POR_PENDIENTE_PROPIO +
          ideasRows.rows.length * MONEDA_POR_IDEA_CAPTURADA +
          (rachaDias >= UMBRAL_RACHA_BONUS_DIAS ? MONEDA_BONUS_RACHA_DIARIA : 0);
        await pagarMoneda(client, usuarioId, total, 'recapitulacion_diaria', null, PROTOCOLO_MONEDA_DIARIA_VERSION);
        delta = {
          pendientesPropios: pendientesRows.rows.map((r) => r.texto),
          ideas: ideasRows.rows,
          rachaDias,
        };
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // rama-logros: el pago de arriba puede cruzar planta_adulta.
  if (huboActividad) {
    await revisarYOtorgarLogros(usuarioId).catch((err) =>
      console.error(`Error revisando logros tras recapitulación diaria del usuario ${usuarioId}:`, err.message)
    );
  }

  if (huboActividad && reflexionActiva && groqClient) {
    await generarReflexionDiaria(usuarioId, delta);
  }
}

async function recapitularActividadDiaria() {
  const diaObjetivo = diaAnterior(formatearDiaLima(new Date()));
  const { inicio, fin } = limitesDiaLima(diaObjetivo);
  try {
    const { rows: usuarios } = await pool.query('SELECT id, reflexion_ia_activa FROM usuarios');
    for (const usuario of usuarios) {
      try {
        await recapitularUsuario(usuario.id, usuario.reflexion_ia_activa, diaObjetivo, inicio, fin);
      } catch (err) {
        console.error(`[cron] Error en recapitulación diaria del usuario ${usuario.id}:`, err.message);
      }
    }
    console.log(`[cron] Recapitulación diaria (${diaObjetivo}) procesada para ${usuarios.length} usuario(s).`);
  } catch (err) {
    console.error('[cron] Error en el job de recapitulación diaria:', err.message);
  }
}

app.get('/ia/chat', async (req, res) => {
  try {
    const [{ rows: mensajes }, mensajesEsteMes, { rows: usuarioRows }] = await Promise.all([
      pool.query(
        'SELECT id, rol, texto, fecha FROM mensajes_ia WHERE usuario_id = $1 ORDER BY fecha ASC LIMIT 200',
        [req.usuarioId]
      ),
      contarMensajesIaEsteMes(req.usuarioId),
      pool.query('SELECT ia_nombre, ia_especie FROM usuarios WHERE id = $1', [req.usuarioId]),
    ]);
    const usuario = usuarioRows[0];
    const nombreIa = (usuario && (usuario.ia_nombre || usuario.ia_especie)) || 'tu planta';
    // rama-recapitulacion-diaria: mismo patrón que GET /chat-general con
    // chat_general_visto_hasta -- marca como leído recién DESPUÉS de traer
    // los mensajes, así el badge "no leído" del nav refleja lo que había
    // sin ver hasta este request.
    await pool.query('UPDATE usuarios SET ia_chat_visto_hasta = now() WHERE id = $1', [req.usuarioId]);
    res.render('ia-chat', {
      mensajes,
      nombreIa,
      restantesEsteMes: Math.max(0, LIMITE_MENSAJES_IA_POR_MES - mensajesEsteMes),
      limiteMensual: LIMITE_MENSAJES_IA_POR_MES,
      error: req.query.error || null,
    });
  } catch (err) {
    console.error('Error consultando el chat con la IA:', err.message);
    res.status(500).render('ia-chat', {
      mensajes: [],
      nombreIa: 'tu planta',
      restantesEsteMes: 0,
      limiteMensual: LIMITE_MENSAJES_IA_POR_MES,
      error: 'No se pudo cargar el chat.',
    });
  }
});

app.post('/ia/chat', async (req, res) => {
  const texto = (req.body.texto || '').trim().slice(0, 2000);
  if (!texto) {
    return res.status(400).send('El mensaje no puede estar vacío.');
  }
  // Cliente condicional -- mismo patrón que googleOAuthClient (ver arriba).
  if (!groqClient) {
    return res.status(500).send('IA conversacional no configurada (falta GROQ_API_KEY).');
  }
  try {
    // Límite mensual: se chequea ANTES de llamar a la API y ANTES de
    // guardar el mensaje del usuario (si no, el propio mensaje bloqueado se
    // contaría la próxima vez).
    const mensajesEsteMes = await contarMensajesIaEsteMes(req.usuarioId);
    if (mensajesEsteMes >= LIMITE_MENSAJES_IA_POR_MES) {
      return res.redirect('/ia/chat?error=limite_mensual');
    }

    // El mensaje del usuario se guarda SIEMPRE, incluso si la llamada a
    // Groq falla después -- no debe perderse.
    await pool.query(
      "INSERT INTO mensajes_ia (usuario_id, rol, texto) VALUES ($1, 'usuario', $2)",
      [req.usuarioId, texto]
    );

    const { system, historial } = await construirContextoIA(req.usuarioId);
    const mensajesHistorial = historial.map((m) => ({
      role: m.rol === 'usuario' ? 'user' : 'assistant',
      content: m.texto,
    }));

    const inicio = Date.now();
    try {
      const respuestaGroq = await llamarGroqConReintento(system, texto, {
        maxTokens: 1024,
        responseFormat: 'text',
        historial: mensajesHistorial,
      });
      const { texto: respuestaTexto, tokensEntrada, tokensSalida } = await extraerTextoYTokensGroq(respuestaGroq);
      const latenciaMs = Date.now() - inicio;

      await pool.query(
        "INSERT INTO mensajes_ia (usuario_id, rol, texto) VALUES ($1, 'ia', $2)",
        [req.usuarioId, respuestaTexto || '(la IA no devolvió texto)']
      );
      await pool.query(
        `INSERT INTO ia_llamadas (usuario_id, modelo, motivo, tokens_entrada, tokens_salida, costo_usd, latencia_ms)
         VALUES ($1, $2, 'chat', $3, $4, $5, $6)`,
        [req.usuarioId, MODELO_IA_SEGMENTACION, tokensEntrada, tokensSalida, COSTO_IA_USD, latenciaMs]
      );
      await avisarSiLlamadasIaSeAcercanAlLimite();

      // El disparador de perfil corre después de guardar la respuesta
      // exitosa, y su propio try/catch evita que una falla ahí rompa la
      // respuesta del chat normal.
      try {
        await actualizarPerfilIaSiCorresponde(req.usuarioId);
      } catch (errPerfil) {
        console.error('Error en actualizarPerfilIaSiCorresponde (no rompe el chat):', errPerfil.message);
      }

      return res.redirect('/ia/chat');
    } catch (errIa) {
      const latenciaMs = Date.now() - inicio;
      console.error('Error llamando a la API de Groq (chat):', errIa.message);
      await pool.query(
        `INSERT INTO ia_llamadas (usuario_id, modelo, motivo, tokens_entrada, tokens_salida, costo_usd, latencia_ms, error)
         VALUES ($1, $2, 'chat', 0, 0, 0, $3, $4)`,
        [req.usuarioId, MODELO_IA_SEGMENTACION, latenciaMs, String((errIa && errIa.message) || errIa).slice(0, 500)]
      );
      return res.redirect('/ia/chat?error=ia_no_disponible');
    }
  } catch (err) {
    console.error('Error en POST /ia/chat:', err.message);
    return res.status(500).send('No se pudo procesar el mensaje.');
  }
});

app.post('/pendientes/:id/completar', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).send('id inválido');
  }
  const client = await pool.connect();
  let notificarA = null;
  let comentario = null;
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE pendientes SET hecho = TRUE
       WHERE id = $1 AND eliminado = FALSE AND (usuario_id = $2 OR asignado_a = $2)
       RETURNING id, usuario_id, asignado_a, asignado_en`,
      [id, req.usuarioId]
    );
    const pendiente = rows[0];
    if (pendiente && pendiente.asignado_a) {
      comentario = (req.body.comentario || '').trim() || null;

      const segundosDesdeAsignado = pendiente.asignado_en
        ? (Date.now() - new Date(pendiente.asignado_en).getTime()) / 1000
        : Infinity;
      const esGranjeoSospechoso = segundosDesdeAsignado < UMBRAL_ANTI_GRANJEO_MINUTOS * 60;

      const { rows: eventoRows } = await client.query(
        'INSERT INTO eventos_completado (pendiente_id, completado_por, comentario, cuenta_para_racha) VALUES ($1, $2, $3, $4) RETURNING id',
        [pendiente.id, req.usuarioId, comentario, !esGranjeoSospechoso]
      );
      const eventoId = eventoRows[0].id;

      // El bonus por racha se suma al pozo ANTES de repartir 70/30, así que
      // también favorece a quien asignó (le conviene armar rachas reales
      // con su amigo, no solo al que completa). Si es un completado
      // sospechosamente rápido, el bonus queda en 0 (no se paga completo,
      // como pide el enunciado) y el evento no cuenta para la racha futura.
      let bonusRacha = 0;
      if (!esGranjeoSospechoso) {
        const racha = await rachaTareasAsignadas(client, req.usuarioId);
        bonusRacha = racha * BONUS_MONEDA_POR_DIA_RACHA;
      }
      const totalMoneda = MONEDA_POR_TAREA_ASIGNADA + bonusRacha;
      const parteCompleta = Math.round(totalMoneda * REPARTO_COMPLETA_PCT);
      const parteAsigno = totalMoneda - parteCompleta;

      await pagarMoneda(client, req.usuarioId, parteCompleta, `Completar pendiente #${pendiente.id}`, eventoId);
      await pagarMoneda(client, pendiente.usuario_id, parteAsigno, `Tarea asignada #${pendiente.id} completada`, eventoId);

      // Se notifica al OTRO miembro de la tarea compartida, sea cual sea el
      // rol de quien completó (el dueño original o la persona asignada).
      notificarA = req.usuarioId === pendiente.usuario_id ? pendiente.asignado_a : pendiente.usuario_id;
    }
    await client.query('COMMIT');
    // rama-logros: cualquier pendiente completado (propio o asignado)
    // puede cruzar primeros_pasos/racha/cien_tareas/mejor_en_equipo, y el
    // pago de tarea 7 de arriba puede cruzar planta_adulta -- después del
    // commit, no adentro de la transacción.
    if (pendiente) {
      await revisarYOtorgarLogros(req.usuarioId).catch((err) =>
        console.error('Error revisando logros tras completar pendiente:', err.message)
      );
    }
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error marcando pendiente como hecho:', err.message);
  } finally {
    client.release();
  }
  if (notificarA) {
    enviarPushAUsuario(notificarA, {
      title: 'Tarea completada',
      body: comentario ? `Se completó una tarea compartida: "${comentario}"` : 'Se completó una tarea compartida.',
      data: { defaultUrl: '/' },
    }).catch((err) => console.error('Error notificando tarea completada:', err.message));
  }
  // rama-interfaz: ?logro=1 -- la barra superior lo lee y anima la mini
  // planta (ver partials/scripts.ejs), luego lo limpia de la URL.
  res.redirect('/?logro=1');
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

// rama-sugerencia-estancados: mismo criterio de "propios o asignados" que
// GET / (ver rama-tareas-compartidas) -- un pendiente asignado a mí también
// puede aparecer acá si lleva estancado, no solo los que yo creé.
app.get('/estancados', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, texto, categoria, creado, sugerencia_ia
       FROM pendientes
       WHERE hecho = FALSE AND eliminado = FALSE AND sugerencia_ia_descartada = FALSE
         AND sugerencia_ia IS NOT NULL AND (usuario_id = $1 OR asignado_a = $1)
       ORDER BY creado ASC`,
      [req.usuarioId]
    );
    res.render('estancados', { pendientes: rows, error: null });
  } catch (err) {
    console.error('Error consultando pendientes estancados:', err.message);
    res.status(500).render('estancados', { pendientes: [], error: 'No se pudo leer la base de datos.' });
  }
});

// Descartar es permanente para ESE pendiente (no se vuelve a generar ni a
// mostrar) -- si el usuario sigue sin resolverlo, ya vio la sugerencia una
// vez, insistir con la misma cada día sería ruido, no ayuda.
app.post('/estancados/:id/descartar', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).send('id inválido');
  }
  try {
    await pool.query(
      'UPDATE pendientes SET sugerencia_ia_descartada = TRUE WHERE id = $1 AND (usuario_id = $2 OR asignado_a = $2)',
      [id, req.usuarioId]
    );
  } catch (err) {
    console.error('Error descartando sugerencia de pendiente estancado:', err.message);
  }
  res.redirect('/estancados');
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
        'INSERT INTO push_subscriptions (endpoint, p256dh, auth, usuario_id) VALUES ($1, $2, $3, $4)',
        [subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth, req.usuarioId]
      );
    } else {
      // El mismo navegador puede haber quedado suscrito bajo otra sesión
      // (dispositivo compartido) — el dueño se actualiza al usuario actual.
      await pool.query('UPDATE push_subscriptions SET usuario_id = $1 WHERE endpoint = $2', [
        req.usuarioId,
        subscription.endpoint,
      ]);
    }
  } catch (err) {
    console.error('Error guardando suscripcion:', err.message);
    return res.status(500).send('No se pudo guardar la suscripción');
  }
  res.status(201).send('ok');
});

// rama-tema-jungla (limpieza): enviarPushATodos y enviarPushAUsuario solo
// diferían en el WHERE de la consulta — el envío y la limpieza de
// suscripciones muertas (404/410) eran idénticos, factorizados acá.
async function enviarPushASubscripciones(rows, payloadObjeto) {
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

async function enviarPushATodos(payloadObjeto) {
  const { rows } = await pool.query('SELECT id, endpoint, p256dh, auth FROM push_subscriptions');
  return enviarPushASubscripciones(rows, payloadObjeto);
}

async function enviarPushAUsuario(usuarioId, payloadObjeto) {
  const { rows } = await pool.query(
    'SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE usuario_id = $1',
    [usuarioId]
  );
  return enviarPushASubscripciones(rows, payloadObjeto);
}

function payloadRecordatorio(texto) {
  return {
    title: 'Recordatorio',
    body: texto,
    data: { defaultUrl: '/recordatorios' },
  };
}

function payloadRecordatorioDiario() {
  return {
    title: 'Bitácora',
    body: 'No has registrado nada hecho hoy — ¿qué avanzaste?',
    actions: [
      { action: 'abrir', title: 'Abrir' },
      // rama-metas: antes iba a '/#nuevo-pendiente' (solo servía para
      // pendientes). Apunta a /captura -- el textarea ya tiene autofocus,
      // y de ahí se puede elegir cualquiera de los 3 tipos, no solo pendiente.
      { action: 'agregar', title: 'Captura rápida' },
    ],
    data: {
      defaultUrl: '/',
      urls: {
        abrir: '/',
        agregar: '/captura',
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

// rama-notificaciones-recordatorios: corre cada minuto (los recordatorios
// se guardan con minuto exacto desde /captura, un cron menos frecuente
// los avisaría tarde). Los que no tienen usuario_id (creados antes de esta
// rama, o directo por el bot sin dueño) se ignoran: no hay a quién avisar.
async function revisarYNotificarRecordatoriosPendientes() {
  try {
    const { rows } = await pool.query(`
      SELECT id, texto, usuario_id FROM recordatorios
      WHERE avisado = FALSE AND cuando <= now() AND usuario_id IS NOT NULL
    `);
    for (const r of rows) {
      try {
        const { enviadas, total } = await enviarPushAUsuario(r.usuario_id, payloadRecordatorio(r.texto));
        console.log(`[cron] Recordatorio #${r.id}: notificado a ${enviadas}/${total} suscripcion(es) del usuario ${r.usuario_id}.`);
      } catch (err) {
        console.error(`[cron] Error notificando recordatorio #${r.id}:`, err.message);
      }
      await pool.query('UPDATE recordatorios SET avisado = TRUE WHERE id = $1', [r.id]);
    }
  } catch (err) {
    console.error('[cron] Error en el job de recordatorios:', err.message);
  }
}

cron.schedule('* * * * *', revisarYNotificarRecordatoriosPendientes, {
  timezone: 'America/Lima',
});

// Restringida al usuario dueño del proyecto: no existe un concepto de
// rol/admin en el esquema todavía, así que se compara directo contra el
// nombre de usuario guardado en la sesión (mismo campo que ya setea
// POST /login, siempre en minúsculas). Ruta de prueba manual de Web Push,
// sin uso de cara al usuario final -- no tiene sentido que cualquier
// cuenta pueda spamear una notificación real a todos los usuarios.
app.post('/notificar-prueba', async (req, res) => {
  if (req.session.nombre_usuario !== 'bruce') {
    return res.status(403).send('No autorizado.');
  }
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

// rama-recapitulacion-diaria (tarea 11): límites absolutos [00:00, 24:00)
// de un día calendario America/Lima, para filtrar columnas TIMESTAMP(TZ)
// por rango sin depender de aritmética de fechas en SQL. Lima no observa
// horario de verano (UTC-5 fijo todo el año), por eso el offset fijo es
// seguro acá (a diferencia de zonas con DST).
function limitesDiaLima(diaStr) {
  const inicio = new Date(`${diaStr}T00:00:00-05:00`);
  const fin = new Date(inicio.getTime() + 24 * 60 * 60 * 1000);
  return { inicio, fin };
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

// rama-racha (Fase 3 de v0.2): racha diaria visible entre amigos. Reusa
// exactamente el mismo criterio de "día con actividad" que ya usan
// /estadisticas y /ia (pendientes.hecho=TRUE, `creado` como aproximación de
// cuándo se completó, mismo `calcularRacha`) -- no se inventó un cuarto
// criterio de actividad. Es un dato DISTINTO del contador semanal de
// /estadisticas (`porSemana`, cuántos completó por semana) -- esa ruta y esa
// columna no se tocan, esto solo reusa el helper para calcular lo mismo
// pero de varios usuarios a la vez, en una sola consulta (no N+1) para no
// pegarle a la DB una vez por amigo.
async function rachasDeUsuarios(idsUsuarios) {
  if (!idsUsuarios.length) return new Map();
  const { rows } = await pool.query(
    `SELECT usuario_id, creado FROM pendientes
     WHERE hecho = TRUE AND eliminado = FALSE AND usuario_id = ANY($1::int[])`,
    [idsUsuarios]
  );
  const diasPorUsuario = new Map(idsUsuarios.map((id) => [id, new Set()]));
  for (const fila of rows) {
    diasPorUsuario.get(fila.usuario_id).add(formatearDiaLima(fila.creado));
  }
  const rachas = new Map();
  for (const [id, dias] of diasPorUsuario) {
    rachas.set(id, calcularRacha(dias));
  }
  return rachas;
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

// rama-asignacion-texto: locals que captura.ejs necesita en TODAS las
// respuestas (siguiendo el mismo estilo que el resto del archivo, que pasa
// el set completo de locals en cada res.render en vez de confiar en
// defaults de la plantilla) — evita "no está definida" en EJS según por
// qué rama del código se llegó a cada render.
function localsCaptura(extra) {
  return Object.assign(
    { error: null, guardado: false, confirmarAsignacion: null, avisoAsignacion: null, textoPrefill: '', metasTocadas: [] },
    extra
  );
}

// rama-metas: inverso de la codificación "id:titulo:cantidad:tipo|..."
// armada en POST /captura -- decodeURIComponent por campo porque el título
// puede traer ":" o "|" (se codificó con encodeURIComponent, no el string
// entero). `tipo` ('propia'|'compartida', rama-metas-compartidas) decide a
// qué ruta de deshacer apunta el botón del toast.
function parsearMetasTocadas(param) {
  if (!param) return [];
  return param.split('|').map((parte) => {
    const [id, tituloCod, cantidad, tipo] = parte.split(':');
    return {
      id: Number(id),
      titulo: decodeURIComponent(tituloCod || ''),
      cantidad: Number(cantidad) || 1,
      tipo: tipo === 'compartida' ? 'compartida' : 'propia',
    };
  });
}

// rama-segmentacion-ideas (Fase 1 de v0.2, ver COORDINACION.md): reintento
// ante rate limit (429) de Groq, parseando el "Please try again in Xs" del
// propio mensaje de error. Acá (ruta HTTP en vivo) el tope de reintentos es
// bajo — a diferencia del script de migración por lotes — para no colgar la
// respuesta al usuario que está esperando guardar su Idea.
const MAX_REINTENTOS_429_CAPTURA = 2;

// `opciones` generalizado en rama-sugerencia-estancados para reutilizar este
// mismo reintento desde generarSugerenciaEstancado, que no necesita JSON
// (es una oración de texto libre) ni 4096 tokens (la respuesta es corta a
// propósito). Los defaults reproducen el comportamiento previo exacto, así
// que segmentarIdeaConGroq no cambia.
// `opciones.historial` agregado en rama-ia-companera-fase2-v2 (tarea 9,
// reconstruida sobre main -- ver COORDINACION.md, tarea J del backlog):
// turnos previos `[{role:'user'|'assistant', content}]` insertados entre el
// system prompt y el mensaje final, para conversación multi-turno del chat
// de la IA compañera. Vacío por defecto -- no cambia el comportamiento de
// segmentarIdeaConGroq ni generarSugerenciaEstancado, que no lo pasan. Este
// es ahora el ÚNICO cliente Groq del proyecto (antes había una segunda
// implementación casi idéntica en la rama de la IA compañera, cada una sin
// ver el main de la otra -- consolidado acá en vez de duplicar).
async function llamarGroqConReintento(system, texto, opciones = {}) {
  const maxTokens = opciones.maxTokens || 4096;
  const responseFormat = opciones.responseFormat || 'json_object';
  const historial = opciones.historial || [];
  for (let intento = 0; intento <= MAX_REINTENTOS_429_CAPTURA; intento++) {
    const respuesta = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${groqClient.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODELO_IA_SEGMENTACION,
        // Subido de 1024 a 4096 -- 1024 no alcanzaba para ideas largas
        // (Groq cortaba el JSON a la mitad), confirmado con la prueba de
        // ideas reales del 2026-08-20. Mismo cambio en el script de
        // migración, ver su comentario.
        max_tokens: maxTokens,
        reasoning_effort: 'low',
        response_format: { type: responseFormat },
        messages: [
          { role: 'system', content: system },
          ...historial,
          { role: 'user', content: texto },
        ],
      }),
    });
    if (respuesta.status === 429 && intento < MAX_REINTENTOS_429_CAPTURA) {
      const datos = await respuesta.json().catch(() => ({}));
      const mensaje = (datos.error && datos.error.message) || '';
      const match = mensaje.match(/try again in ([\d.]+)s/i);
      const esperaMs = Math.min(match ? Math.ceil(parseFloat(match[1]) * 1000) + 300 : 2000, 6000);
      await new Promise((resolve) => setTimeout(resolve, esperaMs));
      continue;
    }
    return respuesta;
  }
}

// rama-ia-companera-fase2-v2 (tarea 9 del roadmap): extrae texto + tokens de
// una respuesta de llamarGroqConReintento({responseFormat:'text'}) -- factor
// común entre el chat y la actualización de perfil (ver más arriba), en vez
// de repetir el mismo parseo de `datos.choices[0].message.content`/
// `datos.usage` dos veces. segmentarIdeaConGroq/generarSugerenciaEstancado
// no lo usan porque cada una hace su propio manejo de error particular
// (fallback silencioso vs. propagar).
async function extraerTextoYTokensGroq(respuesta) {
  const datos = await respuesta.json();
  if (!respuesta.ok) {
    throw new Error((datos.error && datos.error.message) || `Groq respondió ${respuesta.status}`);
  }
  return {
    texto: ((datos.choices[0] && datos.choices[0].message.content) || '').trim(),
    tokensEntrada: datos.usage.prompt_tokens,
    tokensSalida: datos.usage.completion_tokens,
  };
}

// rama-segmentacion-ideas (Fase 1 de v0.2, ver COORDINACION.md): parte una
// Idea de Captura rápida en pensamientos atómicos + etiqueta corta de tema
// cada uno — base técnica de Metas (Fase 2) y Racha (Fase 3). Nunca lanza:
// cualquier fallo (sin GROQ_API_KEY, Groq caído, JSON inválido) cae a
// devolver el texto original sin cortar y etiqueta null — la Idea del
// usuario nunca se pierde por un problema de la IA.
// Etiqueta centinela para cuando Groq falla incluso tras reintentar (o
// devuelve JSON válido sin pensamientos aprovechables) -- distingue "la IA
// no pudo segmentar esto" de `etiqueta: null` (que ahora solo significa "el
// modelo decidió que ya era un pensamiento atómico"). Mismo criterio que el
// script de migración, ver su comentario.
const ETIQUETA_REVISION_MANUAL = '_revision_manual';

async function segmentarIdeaConGroq(texto) {
  const sinSegmentar = [{ texto, etiqueta: null }];
  const requiereRevision = [{ texto, etiqueta: ETIQUETA_REVISION_MANUAL }];
  if (!groqClient) return sinSegmentar;

  const system = `Recibís una "idea" que un usuario escribió de corrido en una app de bitácora personal.
Tu trabajo: partirla en pensamientos atómicos (una idea/tarea/observación completa por pensamiento) y ponerle una etiqueta corta de tema a cada uno (1-3 palabras, minúsculas, sin tildes, ej: "trabajo", "salud", "fundo", "compras").
Si el texto YA es un solo pensamiento atómico, devolvelo tal cual en un único elemento — no inventes cortes artificiales.
No agregues, resumas ni interpretes contenido que no esté en el texto original; solo separá y etiquetá.
Respondé ÚNICAMENTE con JSON en este formato exacto, sin texto adicional ni markdown:
{"pensamientos":[{"texto":"...","etiqueta":"..."}]}`;

  try {
    const respuesta = await llamarGroqConReintento(system, texto);
    const datos = await respuesta.json();
    if (!respuesta.ok) {
      throw new Error((datos.error && datos.error.message) || `Groq respondió ${respuesta.status}`);
    }
    const contenido = (datos.choices[0] && datos.choices[0].message.content) || '';
    const parseado = JSON.parse(contenido);
    const pensamientos = Array.isArray(parseado.pensamientos) ? parseado.pensamientos : [];
    const limpios = pensamientos
      .map((p) => ({
        texto: typeof p.texto === 'string' ? p.texto.trim() : '',
        etiqueta:
          typeof p.etiqueta === 'string' && p.etiqueta.trim()
            ? p.etiqueta.trim().toLowerCase().slice(0, 40)
            : null,
      }))
      .filter((p) => p.texto);
    if (!limpios.length) {
      console.error('Groq devolvió JSON válido pero sin pensamientos aprovechables -- marcada para revisión manual.');
      return requiereRevision;
    }
    return limpios;
  } catch (err) {
    console.error('Error segmentando idea con Groq (marcada para revisión manual):', err.message);
    return requiereRevision;
  }
}

// rama-sugerencia-estancados (fast-follow de v0.2, Backlog): cuántos días
// sin resolver hacen falta para que un pendiente cuente como "estancado".
// No hay columna de "última edición" en `pendientes` (solo `creado`), así
// que el umbral se mide contra la fecha de creación -- suficiente para el
// caso de uso (una tarea vieja que nunca se tocó), no distingue una tarea
// vieja que se editó/pospuso recientemente de una completamente abandonada.
const UMBRAL_DIAS_ESTANCADO = 14;

// A propósito NO se le pide a la IA que invente un link o URL específica:
// no hay forma de verificar que algo que el modelo generó sea una URL real,
// y un link roto/inventado sería peor que no sugerir nada. Se le pide un
// paso concreto en texto plano en cambio (ver system prompt abajo). Mismo
// criterio "nunca lanza" que segmentarIdeaConGroq: cualquier fallo devuelve
// null y el job de abajo simplemente lo reintenta al día siguiente (no
// marca sugerencia_ia_generada_en si no hubo éxito).
async function generarSugerenciaEstancado(texto) {
  if (!groqClient) return null;
  const system = `Un usuario tiene un pendiente en su lista de tareas que lleva más de ${UMBRAL_DIAS_ESTANCADO} días sin resolver. Sugerile UN paso concreto, pequeño y accionable para destrabarlo -- algo que pueda hacer en los próximos minutos, no un plan largo. Respondé en español, en 1-2 oraciones, sin viñetas ni markdown. NUNCA inventes un link o URL específica (no hay forma de verificar que sea real) -- si la sugerencia involucra buscar algo, decí "buscá..." en vez de dar un link.`;
  try {
    const respuesta = await llamarGroqConReintento(system, texto, { maxTokens: 200, responseFormat: 'text' });
    const datos = await respuesta.json();
    if (!respuesta.ok) {
      throw new Error((datos.error && datos.error.message) || `Groq respondió ${respuesta.status}`);
    }
    const contenido = ((datos.choices[0] && datos.choices[0].message.content) || '').trim();
    return contenido || null;
  } catch (err) {
    console.error('Error generando sugerencia de pendiente estancado:', err.message);
    return null;
  }
}

// Corre una vez al día (a diferencia del job de recordatorios, que corre
// cada minuto porque necesita precisión al minuto) -- generar una
// sugerencia no es urgente, y así se evita martillar la API de Groq todos
// los días con los mismos pendientes. Solo procesa los que TODAVÍA no
// tienen sugerencia (sugerencia_ia IS NULL) y no fueron descartados -- una
// vez generada o descartada, no se vuelve a tocar ese pendiente.
async function revisarYSugerirPendientesEstancados() {
  if (!groqClient) return;
  try {
    const { rows } = await pool.query(
      `SELECT id, texto FROM pendientes
       WHERE hecho = FALSE AND eliminado = FALSE
         AND sugerencia_ia IS NULL AND sugerencia_ia_descartada = FALSE
         AND creado <= now() - make_interval(days => $1)`,
      [UMBRAL_DIAS_ESTANCADO]
    );
    for (const p of rows) {
      const sugerencia = await generarSugerenciaEstancado(p.texto);
      if (!sugerencia) continue;
      await pool.query(
        'UPDATE pendientes SET sugerencia_ia = $1, sugerencia_ia_generada_en = now() WHERE id = $2',
        [sugerencia, p.id]
      );
      console.log(`[cron] Sugerencia generada para pendiente estancado #${p.id}.`);
    }
  } catch (err) {
    console.error('[cron] Error en el job de sugerencias de pendientes estancados:', err.message);
  }
}

cron.schedule('0 9 * * *', revisarYSugerirPendientesEstancados, {
  timezone: 'America/Lima',
});

// rama-recapitulacion-diaria (tarea 11): hora distinta a las 9:00 de
// arriba y las 20:00 de HORA_NOTIFICACION, para no concentrar los cron
// jobs en el mismo minuto.
cron.schedule('30 8 * * *', recapitularActividadDiaria, {
  timezone: 'America/Lima',
});

app.get('/captura', (req, res) => {
  res.render('captura', localsCaptura({
    guardado: req.query.guardado === '1',
    avisoAsignacion: req.query.aviso || null,
    textoPrefill: req.query.texto || '',
    metasTocadas: parsearMetasTocadas(req.query.metas),
  }));
});

app.post('/captura', async (req, res) => {
  const texto = (req.body.texto || '').trim();
  const tipo = req.body.tipo;
  if (!texto || !TIPOS_CAPTURA_VALIDOS.includes(tipo)) {
    return res.status(400).render('captura', localsCaptura({ error: 'Escribe algo y elige un tipo válido.' }));
  }
  if (tipo === 'recordatorio' && !req.body.cuando) {
    return res.status(400).render('captura', localsCaptura({ error: 'Los recordatorios necesitan fecha y hora.' }));
  }

  // rama-asignacion-texto: solo aplica a "pendiente" (es la única de las 3
  // tablas de /captura con columna asignado_a). El parseo es 100%
  // server-side (nunca se confía en un id/nombre mandado por el cliente sin
  // revalidar la amistad contra la DB) — ver COORDINACION.md para el porqué
  // de que esto viva acá y no en JS del navegador.
  let asignarA = null; // id de usuario destino del pendiente, si corresponde
  let avisoAsignacion = null;
  const metasTocadas = []; // rama-metas: { id, titulo, cantidad } por cada meta auto-incrementada en esta captura
  if (tipo === 'pendiente') {
    const confirmarId = Number(req.body.confirmar_asignacion_id);
    if (req.body.confirmar_asignacion === '1' && Number.isInteger(confirmarId)) {
      // Paso 2 del flujo de confirmación: el usuario ya vio "Se asignará a
      // X" (paso 1, más abajo) y apretó "Confirmar". Se revalida la
      // amistad de nuevo acá (no se confía en que siga siendo cierta solo
      // porque lo era en el paso 1 — pudo deshacerse la amistad justo
      // entre medio) antes de guardar con asignado_a seteado.
      const sonAmigos = await usuariosSonAmigos(req.usuarioId, confirmarId);
      if (sonAmigos) {
        asignarA = confirmarId;
      } else {
        avisoAsignacion = 'Esa amistad ya no es válida; se guardó como tarea propia.';
      }
    } else if (req.body.cancelar_asignacion !== '1') {
      // Paso 1: primer submit del formulario (todavía no confirmado ni
      // cancelado). Se detecta un candidato en el texto y, si coincide con
      // EXACTAMENTE un amigo actual, se corta acá — se re-renderiza la
      // misma vista en modo "confirmar", sin guardar nada todavía, tal
      // como pide el enunciado ("nunca asignar sin mostrarlo antes").
      const candidato = extraerNombreCandidatoAsignacion(texto);
      if (candidato) {
        const coincidencias = await buscarAmigoPorNombre(req.usuarioId, candidato);
        if (coincidencias.length === 1) {
          return res.render('captura', localsCaptura({
            confirmarAsignacion: { nombre: coincidencias[0].nombre_usuario, id: coincidencias[0].id, texto },
          }));
        } else if (coincidencias.length === 0) {
          avisoAsignacion = `No tienes un amigo llamado "${candidato}"; se guardó como tarea propia.`;
        } else {
          // Ver comentario en buscarAmigoPorNombre: no alcanzable con el
          // esquema actual (nombre_usuario es UNIQUE), pero el enunciado
          // pide manejar el caso igual.
          avisoAsignacion = `Hay más de un amigo que coincide con "${candidato}"; se guardó como tarea propia.`;
        }
      }
    }
    // cancelar_asignacion === '1': el usuario eligió explícitamente
    // "guardar como propia" desde la pantalla de confirmación — sigue de
    // largo sin aviso (no hace falta explicarle una decisión que él mismo
    // tomó).
  }

  try {
    if (tipo === 'pendiente') {
      // asignado_en solo se setea junto con asignado_a (mismo criterio que
      // POST /pendientes/:id/asignar, que también los actualiza juntos).
      await pool.query(
        `INSERT INTO pendientes (texto, creado, hecho, usuario_id, asignado_a, asignado_en)
         VALUES ($1, now(), FALSE, $2, $3, CASE WHEN $3::integer IS NULL THEN NULL ELSE now() END)`,
        [texto, req.usuarioId, asignarA]
      );
    } else if (tipo === 'idea') {
      // rama-segmentacion-ideas: una Idea capturada puede volverse varias
      // filas (un pensamiento atómico cada una) — transacción para que
      // quede todo o nada, mismo estilo que POST /pendientes/:id/editar.
      const pensamientos = await segmentarIdeaConGroq(texto);
      const fecha = new Date().toISOString();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (const p of pensamientos) {
          await client.query(
            'INSERT INTO ideas (fecha, idea, estado, usuario_id, etiqueta) VALUES ($1, $2, NULL, $3, $4)',
            [fecha, p.texto, req.usuarioId, p.etiqueta]
          );
        }
        // rama-metas: auto-incremento por coincidencia de etiqueta -- cuenta
        // cuántos pensamientos de ESTA captura comparten etiqueta con cada
        // meta activa del usuario (puede ser más de 1 si, ej., dos
        // pensamientos salieron etiquetados "ejercicio") y suma todo junto
        // en un solo UPDATE. Sin confirmación previa, tal como pide la
        // tarea -- el toast + deshacer es la confirmación, después del
        // hecho en vez de antes.
        const etiquetasCapturadas = pensamientos.map((p) => p.etiqueta).filter(Boolean);
        if (etiquetasCapturadas.length) {
          const { rows: metasActualizadas } = await client.query(
            `UPDATE metas SET valor_actual = valor_actual + sub.cantidad
             FROM (
               SELECT id, COUNT(*)::int AS cantidad
               FROM metas, unnest($1::text[]) AS etq(etiqueta)
               WHERE metas.usuario_id = $2 AND metas.estado = 'activa' AND metas.etiqueta = etq.etiqueta
               GROUP BY id
             ) AS sub
             WHERE metas.id = sub.id
             RETURNING metas.id, metas.titulo, sub.cantidad`,
            [etiquetasCapturadas, req.usuarioId]
          );
          metasTocadas.push(...metasActualizadas.map((m) => ({ ...m, tipo: 'propia' })));

          // rama-metas-compartidas: mismo mecanismo, pero solo sobre las
          // metas compartidas donde el usuario ES participante (join con
          // metas_compartidas_participantes) -- y además suma el aporte
          // individual en esa misma fila de participante, no solo el total.
          const { rows: compartidasActualizadas } = await client.query(
            `UPDATE metas_compartidas SET valor_actual = valor_actual + sub.cantidad
             FROM (
               SELECT mc.id, COUNT(*)::int AS cantidad
               FROM metas_compartidas mc
               JOIN metas_compartidas_participantes mp ON mp.meta_compartida_id = mc.id AND mp.usuario_id = $2
               CROSS JOIN unnest($1::text[]) AS etq(etiqueta)
               WHERE mc.estado = 'activa' AND mc.etiqueta = etq.etiqueta
               GROUP BY mc.id
             ) AS sub
             WHERE metas_compartidas.id = sub.id
             RETURNING metas_compartidas.id, metas_compartidas.titulo, sub.cantidad`,
            [etiquetasCapturadas, req.usuarioId]
          );
          if (compartidasActualizadas.length) {
            await client.query(
              `UPDATE metas_compartidas_participantes AS p
               SET aportado = p.aportado + sub.cantidad
               FROM (SELECT * FROM json_to_recordset($1) AS x(id int, cantidad int)) AS sub
               WHERE p.meta_compartida_id = sub.id AND p.usuario_id = $2`,
              [JSON.stringify(compartidasActualizadas.map((m) => ({ id: m.id, cantidad: m.cantidad }))), req.usuarioId]
            );
            metasTocadas.push(...compartidasActualizadas.map((m) => ({ ...m, tipo: 'compartida' })));
          }
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    } else {
      await pool.query(
        'INSERT INTO recordatorios (texto, cuando, avisado, usuario_id) VALUES ($1, $2, FALSE, $3)',
        [texto, new Date(req.body.cuando), req.usuarioId]
      );
    }
  } catch (err) {
    console.error('Error guardando captura rápida:', err.message);
    return res.status(500).render('captura', localsCaptura({ error: 'No se pudo guardar. Intenta de nuevo.' }));
  }
  // rama-logros: solo la rama "idea" puede cruzar coleccionista_ideas.
  if (tipo === 'idea') {
    await revisarYOtorgarLogros(req.usuarioId).catch((err) =>
      console.error('Error revisando logros tras capturar idea:', err.message)
    );
  }
  // rama-interfaz: ?logro=1 -- misma señal que /pendientes/:id/completar
  // para que la barra superior anime la mini planta.
  const params = new URLSearchParams({ guardado: '1', logro: '1' });
  if (avisoAsignacion) params.set('aviso', avisoAsignacion);
  if (metasTocadas.length) {
    // Codificado como "id:titulo:cantidad" separados por "|" -- evita
    // depender de parseo de arrays anidados en query string (el server usa
    // express.urlencoded({ extended: false }), que no los soporta). El
    // título va con encodeURIComponent propio porque puede traer ":" o "|".
    params.set(
      'metas',
      metasTocadas
        .map((m) => `${m.id}:${encodeURIComponent(m.titulo)}:${m.cantidad}:${m.tipo}`)
        .join('|')
    );
  }
  res.redirect('/captura?' + params.toString());
});

app.get('/ideas', async (req, res) => {
  const rango = RANGOS_VALIDOS.includes(req.query.rango) ? req.query.rango : 'todo';
  const q = (req.query.q || '').trim();
  try {
    const params = [req.usuarioId];
    let consulta = `SELECT id, fecha, idea, estado FROM ideas WHERE usuario_id = $1 ${whereRango(rango, 'fecha::timestamptz')}`;
    consulta = agregarFiltroTexto(consulta, params, 'idea', q);
    consulta += ' ORDER BY id DESC';
    const { rows } = await pool.query(consulta, params);
    res.render('ideas', { ideas: rows, error: null, rango, q });
  } catch (err) {
    console.error('Error consultando ideas:', err.message);
    res.status(500).render('ideas', { ideas: [], error: 'No se pudo leer la base de datos.', rango, q });
  }
});

// rama-metas (Fase 2 de v0.2)
const ESTADOS_META_VALIDOS = ['activa', 'completada', 'archivada'];

// rama-metas-compartidas: trae las metas compartidas donde el usuario
// participa, con el desglose de aporte por participante embebido como
// array (una sola query con json_agg, no N+1 por meta).
async function metasCompartidasDeUsuario(usuarioId) {
  const { rows } = await pool.query(
    `SELECT mc.*, part.participantes
     FROM metas_compartidas mc
     JOIN metas_compartidas_participantes mp ON mp.meta_compartida_id = mc.id AND mp.usuario_id = $1
     JOIN LATERAL (
       SELECT json_agg(json_build_object('usuario_id', p.usuario_id, 'nombre_usuario', u.nombre_usuario, 'aportado', p.aportado) ORDER BY p.aportado DESC) AS participantes
       FROM metas_compartidas_participantes p
       JOIN usuarios u ON u.id = p.usuario_id
       WHERE p.meta_compartida_id = mc.id
     ) part ON TRUE
     ORDER BY (mc.estado = 'activa') DESC, mc.creado DESC`,
    [usuarioId]
  );
  return rows;
}

async function amigosAceptadosDe(usuarioId) {
  const { rows } = await pool.query(
    `SELECT u.id, u.nombre_usuario
     FROM amistades a
     JOIN usuarios u ON u.id = CASE WHEN a.usuario_a_id = $1 THEN a.usuario_b_id ELSE a.usuario_a_id END
     WHERE a.estado = 'aceptada' AND (a.usuario_a_id = $1 OR a.usuario_b_id = $1)
     ORDER BY u.nombre_usuario ASC`,
    [usuarioId]
  );
  return rows;
}

app.get('/metas', async (req, res) => {
  try {
    const [{ rows: metas }, metasCompartidas, amigos] = await Promise.all([
      pool.query('SELECT * FROM metas WHERE usuario_id = $1 ORDER BY (estado = $2) DESC, creado DESC', [
        req.usuarioId,
        'activa',
      ]),
      metasCompartidasDeUsuario(req.usuarioId),
      amigosAceptadosDe(req.usuarioId),
    ]);
    res.render('metas', { metas, metasCompartidas, amigos, error: null });
  } catch (err) {
    console.error('Error consultando metas:', err.message);
    res.status(500).render('metas', { metas: [], metasCompartidas: [], amigos: [], error: 'No se pudo leer la base de datos.' });
  }
});

app.post('/metas', async (req, res) => {
  const titulo = (req.body.titulo || '').trim();
  const etiqueta = (req.body.etiqueta || '').trim().toLowerCase() || null;
  const tipoMetrica = (req.body.tipo_metrica || '').trim() || null;
  const valorObjetivo = Number(req.body.valor_objetivo);
  const fechaObjetivo = req.body.fecha_objetivo || null;

  if (!titulo) {
    return res.status(400).render('metas', {
      metas: (await pool.query('SELECT * FROM metas WHERE usuario_id = $1 ORDER BY creado DESC', [req.usuarioId])).rows,
      error: 'Ponle un título a tu meta.',
    });
  }
  if (!Number.isInteger(valorObjetivo) || valorObjetivo < 1) {
    return res.status(400).render('metas', {
      metas: (await pool.query('SELECT * FROM metas WHERE usuario_id = $1 ORDER BY creado DESC', [req.usuarioId])).rows,
      error: 'El objetivo debe ser un número entero mayor a 0.',
    });
  }

  try {
    await pool.query(
      `INSERT INTO metas (usuario_id, titulo, etiqueta, tipo_metrica, valor_objetivo, fecha_objetivo)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [req.usuarioId, titulo, etiqueta, tipoMetrica, valorObjetivo, fechaObjetivo]
    );
    res.redirect('/metas?guardado=1');
  } catch (err) {
    console.error('Error creando meta:', err.message);
    res.status(500).render('metas', {
      metas: (await pool.query('SELECT * FROM metas WHERE usuario_id = $1 ORDER BY creado DESC', [req.usuarioId])).rows,
      error: 'No se pudo guardar la meta.',
    });
  }
});

app.post('/metas/:id/estado', async (req, res) => {
  const estado = req.body.estado;
  if (!ESTADOS_META_VALIDOS.includes(estado)) {
    return res.status(400).send('Estado inválido.');
  }
  try {
    await pool.query('UPDATE metas SET estado = $1 WHERE id = $2 AND usuario_id = $3', [
      estado,
      req.params.id,
      req.usuarioId,
    ]);
  } catch (err) {
    console.error('Error cambiando estado de meta:', err.message);
    return res.status(500).send('No se pudo actualizar.');
  }
  res.redirect('/metas');
});

// rama-metas-progreso-manual (fast-follow pedido por el usuario, después
// de probar la app con un amigo): hasta ahora la ÚNICA forma de sumar
// progreso a una meta era indirecta -- capturar una Idea con la etiqueta
// exacta de la meta. Sin un botón directo, nadie "veía subir" la meta en
// la práctica. `cantidad` se acota entre 1 y 1000 (mismo criterio que el
// resto de la app: nunca confiar ciegamente en un número que manda el
// cliente, aunque acá no hay riesgo de seguridad real, es solo para
// evitar un typo gigante rompiendo la barra de progreso).
app.post('/metas/:id/sumar', async (req, res) => {
  const cantidad = Math.max(1, Math.min(1000, Number(req.body.cantidad) || 1));
  try {
    await pool.query(
      'UPDATE metas SET valor_actual = valor_actual + $1 WHERE id = $2 AND usuario_id = $3 AND estado = $4',
      [cantidad, req.params.id, req.usuarioId, 'activa']
    );
  } catch (err) {
    console.error('Error sumando progreso a meta:', err.message);
  }
  res.redirect('/metas');
});

// Deshace el auto-incremento aplicado por el toast de POST /captura --
// `cantidad` es exactamente lo que esa captura le sumó a esta meta (puede
// ser más de 1 si varios pensamientos de la misma Idea compartían
// etiqueta), nunca un valor arbitrario del cliente sin acotar: se clampea
// para que valor_actual nunca quede negativo aunque el usuario reintente
// el "deshacer" más de una vez o llegue tarde.
app.post('/metas/:id/deshacer', async (req, res) => {
  const cantidad = Math.max(1, Number(req.body.cantidad) || 1);
  try {
    await pool.query(
      'UPDATE metas SET valor_actual = GREATEST(0, valor_actual - $1) WHERE id = $2 AND usuario_id = $3',
      [cantidad, req.params.id, req.usuarioId]
    );
  } catch (err) {
    console.error('Error deshaciendo incremento de meta:', err.message);
  }
  res.redirect(req.get('referer') || '/metas');
});

// rama-metas-compartidas
app.post('/metas/compartida', async (req, res) => {
  const titulo = (req.body.titulo || '').trim();
  const etiqueta = (req.body.etiqueta || '').trim().toLowerCase() || null;
  const tipoMetrica = (req.body.tipo_metrica || '').trim() || null;
  const valorObjetivo = Number(req.body.valor_objetivo);
  const fechaObjetivo = req.body.fecha_objetivo || null;
  // Puede llegar como string suelto (1 amigo) o array (2+) según el
  // navegador -- se normaliza siempre a array antes de seguir.
  const idsElegidos = [].concat(req.body.participantes || []).map(Number).filter(Number.isInteger);

  const rerenderConError = async (mensajeError) => {
    const [{ rows: metas }, metasCompartidas, amigos] = await Promise.all([
      pool.query('SELECT * FROM metas WHERE usuario_id = $1 ORDER BY creado DESC', [req.usuarioId]),
      metasCompartidasDeUsuario(req.usuarioId),
      amigosAceptadosDe(req.usuarioId),
    ]);
    res.status(400).render('metas', { metas, metasCompartidas, amigos, error: mensajeError });
  };

  if (!titulo) return rerenderConError('Ponle un título a tu meta compartida.');
  if (!Number.isInteger(valorObjetivo) || valorObjetivo < 1) {
    return rerenderConError('El objetivo debe ser un número entero mayor a 0.');
  }
  if (!idsElegidos.length) {
    return rerenderConError('Elegí al menos un amigo para compartir la meta.');
  }

  const client = await pool.connect();
  try {
    // Nunca confiar en los ids que manda el cliente sin revalidar contra la
    // DB -- mismo criterio que POST /captura con la asignación de
    // pendientes. Si alguno de los elegidos ya no es amigo (se deshizo la
    // amistad justo entre medio, o el id era inventado), se descarta en
    // silencio en vez de fallar todo el guardado.
    const amigosReales = await amigosAceptadosDe(req.usuarioId);
    const idsAmigosReales = new Set(amigosReales.map((a) => a.id));
    const participantesValidos = idsElegidos.filter((id) => idsAmigosReales.has(id));
    if (!participantesValidos.length) {
      return rerenderConError('Ninguno de los amigos elegidos es válido -- no se creó la meta.');
    }

    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO metas_compartidas (creado_por, titulo, etiqueta, tipo_metrica, valor_objetivo, fecha_objetivo)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [req.usuarioId, titulo, etiqueta, tipoMetrica, valorObjetivo, fechaObjetivo]
    );
    const metaId = rows[0].id;
    // El creador también participa (si no, sería una meta que él mismo
    // armó pero de la que no forma parte, no tiene sentido).
    const todosLosParticipantes = [req.usuarioId, ...participantesValidos];
    for (const usuarioId of todosLosParticipantes) {
      await client.query(
        'INSERT INTO metas_compartidas_participantes (meta_compartida_id, usuario_id) VALUES ($1, $2)',
        [metaId, usuarioId]
      );
    }
    await client.query('COMMIT');
    res.redirect('/metas?guardado=1');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error creando meta compartida:', err.message);
    await rerenderConError('No se pudo guardar la meta compartida.');
  } finally {
    client.release();
  }
});

app.post('/metas/compartida/:id/estado', async (req, res) => {
  const estado = req.body.estado;
  if (!ESTADOS_META_VALIDOS.includes(estado)) {
    return res.status(400).send('Estado inválido.');
  }
  try {
    // Cualquier PARTICIPANTE puede archivar/completar/reactivar, no solo
    // quien la creó -- es compartida de verdad, no del dueño original con
    // invitados de segunda clase (mismo espíritu que el resto de la app
    // con amigos, ver COORDINACION.md sobre tareas asignadas).
    await pool.query(
      `UPDATE metas_compartidas SET estado = $1
       WHERE id = $2 AND EXISTS (
         SELECT 1 FROM metas_compartidas_participantes WHERE meta_compartida_id = $2 AND usuario_id = $3
       )`,
      [estado, req.params.id, req.usuarioId]
    );
  } catch (err) {
    console.error('Error cambiando estado de meta compartida:', err.message);
    return res.status(500).send('No se pudo actualizar.');
  }
  res.redirect('/metas');
});

// rama-metas-progreso-manual: mismo fast-follow que /metas/:id/sumar, pero
// para el caso que de verdad lo motivó -- el usuario y un amigo probando
// una meta compartida no tenían forma directa de sumar progreso, solo la
// vía indirecta de coincidencia de etiqueta al capturar una Idea. Suma al
// total del grupo Y al aporte individual de quien la usa en la misma
// transacción, para que ambos números nunca queden desincronizados entre
// sí (mismo cuidado que el resto de rutas de metas compartidas).
app.post('/metas/compartida/:id/sumar', async (req, res) => {
  const cantidad = Math.max(1, Math.min(1000, Number(req.body.cantidad) || 1));
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // El UPDATE de `aportado` se condiciona a `mc.estado = 'activa'` acá
    // mismo (no en un if aparte después) -- si no, una meta ya archivada
    // podría sumar al aporte individual sin sumar al total del grupo,
    // desincronizando los dos números entre sí.
    const { rows } = await client.query(
      `UPDATE metas_compartidas_participantes p SET aportado = aportado + $1
       FROM metas_compartidas mc
       WHERE p.meta_compartida_id = mc.id AND p.meta_compartida_id = $2
         AND p.usuario_id = $3 AND mc.estado = 'activa'
       RETURNING p.meta_compartida_id`,
      [cantidad, req.params.id, req.usuarioId]
    );
    if (rows.length) {
      await client.query('UPDATE metas_compartidas SET valor_actual = valor_actual + $1 WHERE id = $2', [
        cantidad,
        req.params.id,
      ]);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error sumando progreso a meta compartida:', err.message);
  } finally {
    client.release();
  }
  res.redirect('/metas');
});

// Deshace SOLO el aporte propio del usuario que pide deshacer -- nunca el
// de otro participante. Resta lo mismo del total compartido y de la fila
// de aportado propia, ambos clampeados a 0.
app.post('/metas/compartida/:id/deshacer', async (req, res) => {
  const cantidad = Math.max(1, Number(req.body.cantidad) || 1);
  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // OJO: no restar `cantidad` a ciegas del total compartido -- si el
      // aportado propio ya estaba en 0 (nunca contribuyó, o ya deshizo
      // antes), GREATEST lo clampea sin cambiar nada ahí, pero el total
      // compartido SÍ se restaría igual si no se calcula el delta real.
      // Se lee `aportado` con FOR UPDATE (bloquea la fila contra otro
      // deshacer simultáneo del mismo participante) para saber cuánto HAY
      // de verdad antes de restar, y solo esa cantidad -- nunca más -- se
      // aplica al total compartido. Así nadie puede "deshacer" una
      // contribución que no hizo y afectar el progreso de los demás.
      const { rows: actual } = await client.query(
        `SELECT aportado FROM metas_compartidas_participantes
         WHERE meta_compartida_id = $1 AND usuario_id = $2 FOR UPDATE`,
        [req.params.id, req.usuarioId]
      );
      if (actual.length) {
        const deltaReal = Math.min(cantidad, actual[0].aportado);
        if (deltaReal > 0) {
          await client.query(
            'UPDATE metas_compartidas_participantes SET aportado = aportado - $1 WHERE meta_compartida_id = $2 AND usuario_id = $3',
            [deltaReal, req.params.id, req.usuarioId]
          );
          await client.query(
            'UPDATE metas_compartidas SET valor_actual = GREATEST(0, valor_actual - $1) WHERE id = $2',
            [deltaReal, req.params.id]
          );
        }
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Error deshaciendo aporte a meta compartida:', err.message);
  }
  res.redirect(req.get('referer') || '/metas');
});

app.get('/recordatorios', async (req, res) => {
  const rango = RANGOS_VALIDOS.includes(req.query.rango) ? req.query.rango : 'todo';
  try {
    const { rows } = await pool.query(
      `SELECT id, texto, cuando, avisado FROM recordatorios WHERE usuario_id = $1 ${whereRango(rango, 'cuando')} ORDER BY id DESC`,
      [req.usuarioId]
    );
    const conectado = await pool.query('SELECT 1 FROM google_calendar_tokens WHERE usuario_id = $1', [
      req.usuarioId,
    ]);
    res.render('recordatorios', {
      recordatorios: rows,
      error: null,
      rango,
      googleConfigurado: Boolean(googleOAuthClient),
      googleConectado: conectado.rows.length > 0,
    });
  } catch (err) {
    console.error('Error consultando recordatorios:', err.message);
    res.status(500).render('recordatorios', {
      recordatorios: [],
      error: 'No se pudo leer la base de datos.',
      rango,
      googleConfigurado: Boolean(googleOAuthClient),
      googleConectado: false,
    });
  }
});

// rama-google-calendar (tarea 10, esqueleto sin probar): las 4 rutas de
// abajo nunca corrieron contra la API real de Google en esta sesión — no
// hay client_id/client_secret todavía. Ver COORDINACION.md.
app.get('/calendario/conectar', (req, res) => {
  if (!googleOAuthClient) {
    return res.status(500).send('Integración con Google Calendar no configurada (faltan variables de entorno).');
  }
  const url = googleOAuthClient.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent', // fuerza a Google a reemitir refresh_token aunque el usuario ya haya autorizado antes
    scope: ['https://www.googleapis.com/auth/calendar.events'],
    state: String(req.usuarioId),
  });
  res.redirect(url);
});

app.get('/calendario/callback', async (req, res) => {
  if (!googleOAuthClient) {
    return res.status(500).send('Integración con Google Calendar no configurada.');
  }
  const { code, state } = req.query;
  // state = usuarioId de cuando se generó la URL en /calendario/conectar — si no
  // coincide con la sesión actual, alguien está reusando/falsificando el callback.
  if (!code || Number(state) !== req.usuarioId) {
    return res.status(400).send('Callback de Google inválido.');
  }
  try {
    const { tokens } = await googleOAuthClient.getToken(code);
    const { iv, authTag, datos } = cifrarTokensGoogle(tokens);
    await pool.query(
      `INSERT INTO google_calendar_tokens (usuario_id, iv, auth_tag, datos_cifrados)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (usuario_id) DO UPDATE SET iv = $2, auth_tag = $3, datos_cifrados = $4, actualizado = now()`,
      [req.usuarioId, iv, authTag, datos]
    );
    res.redirect('/recordatorios?google=conectado');
  } catch (err) {
    console.error('Error en callback de Google Calendar:', err.message);
    res.status(500).send('No se pudo conectar con Google Calendar.');
  }
});

app.post('/calendario/desconectar', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM google_calendar_tokens WHERE usuario_id = $1', [
      req.usuarioId,
    ]);
    if (rows.length > 0 && googleOAuthClient) {
      // Mejor esfuerzo: si revocar contra Google falla, se borra igual localmente
      // (el usuario pidió desconectar, no queremos dejarlo "conectado" a la fuerza).
      try {
        const tokens = descifrarTokensGoogle(rows[0]);
        if (tokens.access_token) await googleOAuthClient.revokeToken(tokens.access_token);
      } catch (err) {
        console.error('No se pudo revocar el token en Google (se borra igual localmente):', err.message);
      }
    }
    await pool.query('DELETE FROM google_calendar_tokens WHERE usuario_id = $1', [req.usuarioId]);
  } catch (err) {
    console.error('Error desconectando Google Calendar:', err.message);
  }
  res.redirect('/recordatorios');
});

// Botón manual (tarea 8 / IA todavía no existe) para crear un evento a
// partir de un recordatorio puntual.
app.post('/recordatorios/:id/crear-evento-calendar', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).send('id inválido');
  }
  try {
    const { rows } = await pool.query(
      'SELECT id, texto, cuando FROM recordatorios WHERE id = $1 AND usuario_id = $2',
      [id, req.usuarioId]
    );
    if (rows.length === 0) {
      return res.status(404).send('Recordatorio no encontrado.');
    }
    const cliente = await obtenerClienteCalendarPara(req.usuarioId);
    if (!cliente) {
      return res.status(400).send('Primero conectá tu Google Calendar.');
    }
    const calendar = google.calendar({ version: 'v3', auth: cliente });
    const inicio = new Date(rows[0].cuando);
    const fin = new Date(inicio.getTime() + 30 * 60 * 1000); // 30 min de duración por defecto, sin UI para cambiarla todavía
    await calendar.events.insert({
      calendarId: 'primary',
      requestBody: {
        summary: rows[0].texto,
        start: { dateTime: inicio.toISOString() },
        end: { dateTime: fin.toISOString() },
      },
    });
    res.redirect('/recordatorios?evento=creado');
  } catch (err) {
    console.error('Error creando evento en Google Calendar:', err.message);
    res.status(500).send('No se pudo crear el evento en Google Calendar.');
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
      await pool.query('UPDATE pendientes SET asignado_a = NULL, asignado_en = NULL WHERE id = $1 AND usuario_id = $2', [id, req.usuarioId]);
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

    // rama-moneda-virtual: asignado_en marca cuándo empezó la asignación
    // actual, para el umbral anti-granjeo al completar (ver constante
    // UMBRAL_ANTI_GRANJEO_MINUTOS más abajo).
    await pool.query('UPDATE pendientes SET asignado_a = $1, asignado_en = now() WHERE id = $2 AND usuario_id = $3', [destinatario.id, id, req.usuarioId]);
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
// rama-invitar-amigos: se genera perezosamente (la primera vez que hace
// falta) en vez de en /registro, para no tocar esa ruta más de lo
// necesario y porque cuentas ya existentes también necesitan poder
// invitar sin haberse registrado de nuevo.
async function obtenerOCrearCodigoInvitacion(usuarioId) {
  const { rows } = await pool.query('SELECT codigo_invitacion FROM usuarios WHERE id = $1', [usuarioId]);
  if (rows[0] && rows[0].codigo_invitacion) return rows[0].codigo_invitacion;
  const codigo = generarCodigoInvitacion();
  await pool.query('UPDATE usuarios SET codigo_invitacion = $1 WHERE id = $2', [codigo, usuarioId]);
  return codigo;
}

app.get('/amigos', async (req, res) => {
  try {
    const [amigos, recibidas, enviadas, codigoInvitacion] = await Promise.all([
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
      obtenerOCrearCodigoInvitacion(req.usuarioId),
    ]);
    // rama-racha: una sola consulta para la racha propia + la de todos los
    // amigos (ver rachasDeUsuarios) en vez de una por fila.
    const idsParaRacha = [req.usuarioId, ...amigos.rows.map((a) => a.usuario_id)];
    const rachas = await rachasDeUsuarios(idsParaRacha);
    const amigosConRacha = amigos.rows.map((a) => ({ ...a, racha: rachas.get(a.usuario_id) || 0 }));

    res.render('amigos', {
      amigos: amigosConRacha,
      miRacha: rachas.get(req.usuarioId) || 0,
      recibidas: recibidas.rows,
      enviadas: enviadas.rows,
      codigoInvitacion,
      error: null,
    });
  } catch (err) {
    console.error('Error consultando amigos:', err.message);
    res.status(500).render('amigos', {
      amigos: [],
      miRacha: 0,
      recibidas: [],
      enviadas: [],
      codigoInvitacion: null,
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
    // rama-logros: solo revisa acá (quien acepta) -- el que solicitó recibe
    // su propio logro primer_amigo en su próxima acción que dispare una
    // revisión, mismo trade-off que ya acepta el resto de esta rama.
    await revisarYOtorgarLogros(req.usuarioId).catch((err) =>
      console.error('Error revisando logros tras aceptar amistad:', err.message)
    );
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

// rama-trazabilidad-social: rango y tamaño de página documentados en
// COORDINACION.md — mismo espíritu que VENCIDO_DIAS/LIMITE_INTENTOS más
// arriba: constantes nombradas, no números sueltos.
const TRAZABILIDAD_DIAS = 7;
const TRAZABILIDAD_PAGINA_TAMANO = 20;

app.get('/trazabilidad', async (req, res) => {
  const amistadId = Number(req.query.amistad_id);
  const pagina = Math.max(0, Number(req.query.pagina) || 0);
  if (!Number.isInteger(amistadId)) {
    return res.status(400).send('amistad_id inválido');
  }
  try {
    const pertenece = await usuarioPerteneceAmistad(req.usuarioId, amistadId);
    if (!pertenece) {
      return res.status(403).render('trazabilidad', {
        eventos: [], conteoSemana: [], amistadId: null, pagina: 0, paginaTamano: TRAZABILIDAD_PAGINA_TAMANO, saldoMoneda: 0, error: 'No tienes acceso a esta amistad.',
      });
    }
    const { rows: amistadRows } = await pool.query(
      'SELECT usuario_a_id, usuario_b_id FROM amistades WHERE id = $1',
      [amistadId]
    );
    const { usuario_a_id, usuario_b_id } = amistadRows[0];

    const { rows: eventos } = await pool.query(
      `SELECT e.id, e.completado_por, e.comentario, e.fecha, p.texto,
              u.nombre_usuario AS completado_por_nombre
       FROM eventos_completado e
       JOIN pendientes p ON p.id = e.pendiente_id
       JOIN usuarios u ON u.id = e.completado_por
       WHERE (p.usuario_id = $1 OR p.asignado_a = $1) AND (p.usuario_id = $2 OR p.asignado_a = $2)
         AND e.fecha >= now() - INTERVAL '${TRAZABILIDAD_DIAS} days'
       ORDER BY e.fecha DESC
       LIMIT $3 OFFSET $4`,
      [usuario_a_id, usuario_b_id, TRAZABILIDAD_PAGINA_TAMANO, pagina * TRAZABILIDAD_PAGINA_TAMANO]
    );

    // Contador semanal por persona: mismo criterio de "semana" que ya usa
    // GET /estadisticas (date_trunc('week', ... AT TIME ZONE 'America/Lima')),
    // aplicado a la fecha del evento en vez de a la fecha de creación.
    const { rows: conteoSemana } = await pool.query(
      `SELECT completado_por, COUNT(*)::int AS cantidad
       FROM eventos_completado e
       JOIN pendientes p ON p.id = e.pendiente_id
       WHERE (p.usuario_id = $1 OR p.asignado_a = $1) AND (p.usuario_id = $2 OR p.asignado_a = $2)
         AND date_trunc('week', e.fecha AT TIME ZONE 'America/Lima') = date_trunc('week', now() AT TIME ZONE 'America/Lima')
       GROUP BY completado_por`,
      [usuario_a_id, usuario_b_id]
    );

    // rama-moneda-virtual: saldo propio, para verificar que el sistema de
    // moneda está pagando de verdad (la vista real del saldo/planta la
    // arma la tarea 8, esto es solo un número de referencia por ahora).
    // rama-perfil-juego (tarea O): reusa perfilJuegoDeUsuario en vez de su
    // propia consulta aislada a `usuarios` (era la tercera copia del mismo
    // patrón, junto con barraSuperiorDeUsuario y GET /ia).
    const perfilJuego = await perfilJuegoDeUsuario(req.usuarioId);
    const saldoMoneda = perfilJuego ? perfilJuego.saldoMoneda : 0;

    res.render('trazabilidad', { eventos, conteoSemana, amistadId, pagina, paginaTamano: TRAZABILIDAD_PAGINA_TAMANO, saldoMoneda, error: null });
  } catch (err) {
    console.error('Error consultando trazabilidad:', err.message);
    res.status(500).render('trazabilidad', { eventos: [], conteoSemana: [], amistadId, pagina, paginaTamano: TRAZABILIDAD_PAGINA_TAMANO, saldoMoneda: 0, error: 'No se pudo leer la base de datos.' });
  }
});

// rama-ia-companera-fase1 (tarea 8 del roadmap): sin llamar ningún modelo
// de IA todavía (eso es la Fase 2, tarea 9, bloqueada) — esto es la
// planta/mascota visual, la tienda de moneda, y observaciones simples
// sobre datos propios del usuario.
app.get('/ia', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT ia_especie, ia_skin, ia_nombre, ia_tema_extra, saldo_moneda, comodines_perdon_disponibles FROM usuarios WHERE id = $1',
      [req.usuarioId]
    );
    let usuario = rows[0];
    if (!usuario || !usuario.ia_especie) {
      // Cuentas creadas antes de esta rama no tienen especie elegida —
      // se les asigna monstera por defecto (la especie insignia de la app)
      // en vez de bloquear la vista o forzar un flujo de "elegir ahora".
      await pool.query(
        "UPDATE usuarios SET ia_especie = 'monstera', ia_nombre = COALESCE(ia_nombre, 'Monstera') WHERE id = $1",
        [req.usuarioId]
      );
      usuario = { ...usuario, ia_especie: 'monstera', ia_nombre: (usuario && usuario.ia_nombre) || 'Monstera' };
    }
    // rama-perfil-juego (tarea O): se le pasa `usuarioFila` (ya la trajo la
    // consulta de arriba, con el ajuste de especie por defecto si aplicó)
    // para que perfilJuegoDeUsuario no dispare una segunda consulta.
    const perfil = await perfilJuegoDeUsuario(req.usuarioId, { usuarioFila: usuario });
    const observaciones = await observacionesIA(req.usuarioId);

    res.render('ia', {
      especie: perfil.especie,
      etapa: perfil.etapa,
      totalDeVida: perfil.totalDeVida,
      nombreIa: perfil.iaNombre || perfil.especie,
      skinActual: perfil.iaSkin,
      temaExtraActual: perfil.iaTemaExtra,
      saldoMoneda: perfil.saldoMoneda,
      comodinesDisponibles: perfil.comodinesDisponibles,
      observaciones,
      skinsDisponibles: IA_SKINS_DISPONIBLES,
      temasExtraDisponibles: IA_TEMAS_EXTRA_DISPONIBLES,
      costoSkin: IA_COSTO_SKIN,
      costoComodin: IA_COSTO_COMODIN_PERDON,
      costoTemaExtra: IA_COSTO_TEMA_EXTRA,
      error: null,
    });
  } catch (err) {
    console.error('Error consultando la IA compañera:', err.message);
    res.status(500).render('ia', {
      especie: 'monstera', etapa: etapaPorMoneda(0), totalDeVida: 0, nombreIa: 'tu planta', skinActual: 'clasico',
      temaExtraActual: null, saldoMoneda: 0, comodinesDisponibles: 0, observaciones: [], skinsDisponibles: IA_SKINS_DISPONIBLES,
      temasExtraDisponibles: IA_TEMAS_EXTRA_DISPONIBLES, costoSkin: IA_COSTO_SKIN, costoComodin: IA_COSTO_COMODIN_PERDON,
      costoTemaExtra: IA_COSTO_TEMA_EXTRA, error: 'No se pudo cargar tu planta compañera.',
    });
  }
});

app.post('/ia/nombre', async (req, res) => {
  const nombre = (req.body.nombre || '').trim().slice(0, 30);
  if (!nombre) {
    return res.status(400).send('El nombre no puede estar vacío.');
  }
  try {
    await pool.query('UPDATE usuarios SET ia_nombre = $1 WHERE id = $2', [nombre, req.usuarioId]);
  } catch (err) {
    console.error('Error renombrando la IA:', err.message);
    return res.status(500).send('No se pudo guardar el nombre.');
  }
  res.redirect('/ia');
});

// Un solo endpoint para las 3 compras de moneda de la Fase 1 (skin, tema
// extra, comodín) — mismo patrón simple que ya usa el resto del proyecto
// para acciones con pocas variantes válidas (ver /captura con su `tipo`).
// rama-fix-doble-release: los `client.release()` explícitos antes de los
// `return` de rechazo (tipo inválido / moneda insuficiente) quedaron
// duplicados con el `client.release()` del `finally` de más abajo -- ese
// `finally` ya cubre TODOS los caminos (éxito, rechazo con `return`,
// excepción), así que el release explícito de más arriba siempre corría
// una segunda vez sobre el mismo cliente. `pg-pool` lanza una excepción
// síncrona ante un doble release que no cae en ningún try/catch de Express
// -- tumbaba el proceso Node entero. Mismo bug (y mismo fix) que ya
// apareció dos veces en v0.3, ver rama-metas-compartidas en el historial
// de merges.
app.post('/ia/comprar', async (req, res) => {
  const tipo = req.body.tipo;
  const valor = req.body.valor;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let ok = false;
    if (tipo === 'skin' && IA_SKINS_DISPONIBLES.includes(valor)) {
      ok = await gastarMoneda(client, req.usuarioId, IA_COSTO_SKIN, `Skin: ${valor}`);
      if (ok) await client.query('UPDATE usuarios SET ia_skin = $1 WHERE id = $2', [valor, req.usuarioId]);
    } else if (tipo === 'tema_extra' && IA_TEMAS_EXTRA_DISPONIBLES.includes(valor)) {
      ok = await gastarMoneda(client, req.usuarioId, IA_COSTO_TEMA_EXTRA, `Tema extra: ${valor}`);
      if (ok) await client.query('UPDATE usuarios SET ia_tema_extra = $1 WHERE id = $2', [valor, req.usuarioId]);
    } else if (tipo === 'comodin_perdon') {
      ok = await gastarMoneda(client, req.usuarioId, IA_COSTO_COMODIN_PERDON, 'Comodín: perdonar racha');
      if (ok) await client.query('UPDATE usuarios SET comodines_perdon_disponibles = comodines_perdon_disponibles + 1 WHERE id = $1', [req.usuarioId]);
    } else {
      await client.query('ROLLBACK');
      return res.status(400).send('Compra inválida.');
    }
    if (!ok) {
      await client.query('ROLLBACK');
      return res.status(400).send('No te alcanza la moneda.');
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error en compra de la IA:', err.message);
    return res.status(500).send('No se pudo completar la compra.');
  } finally {
    client.release();
  }
  res.redirect('/ia');
});

// Consume un comodín ya comprado para marcar HOY como día protegido: no
// paga moneda de nuevo (eso ya pasó al completar tareas) ni toca la racha
// de /estadisticas ni la que paga la tarea 7 — solo la racha que se
// muestra en /ia (ver observacionesIA), a propósito para no arriesgar la
// lógica de pago ya probada.
// rama-fix-doble-release: mismo bug que /ia/comprar arriba -- el
// `client.release()` explícito antes del `return` de "sin comodines"
// duplicaba el del `finally`, tumbando el proceso Node.
app.post('/ia/usar-comodin', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'SELECT comodines_perdon_disponibles FROM usuarios WHERE id = $1 FOR UPDATE',
      [req.usuarioId]
    );
    if (!rows[0] || rows[0].comodines_perdon_disponibles <= 0) {
      await client.query('ROLLBACK');
      return res.status(400).send('No tenés comodines disponibles.');
    }
    await client.query(
      'UPDATE usuarios SET comodines_perdon_disponibles = comodines_perdon_disponibles - 1 WHERE id = $1',
      [req.usuarioId]
    );
    await client.query(
      `INSERT INTO racha_protecciones (usuario_id, fecha) VALUES ($1, (now() AT TIME ZONE 'America/Lima')::date)
       ON CONFLICT (usuario_id, fecha) DO NOTHING`,
      [req.usuarioId]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error usando comodín:', err.message);
    return res.status(500).send('No se pudo usar el comodín.');
  } finally {
    client.release();
  }
  res.redirect('/ia');
});

// rama-ajustes (Ronda — pulido y detalles de producto): decisiones
// documentadas en COORDINACION.md — "nombre visible" es nombre_usuario
// (no un campo nuevo), cambiar de especie no reinicia la etapa (se
// calcula siempre de la moneda ganada de por vida), sonidos vive en
// localStorage (no en la cuenta), desactivar push borra la(s) fila(s) de
// push_subscriptions, y el tema reusa POST /preferencia-tema tal cual.
app.get('/ajustes', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT nombre_usuario, ia_especie, email, pin_hash, password_hash, reflexion_ia_activa FROM usuarios WHERE id = $1',
      [req.usuarioId]
    );
    const usuario = rows[0];
    const { rows: pushRows } = await pool.query(
      'SELECT 1 FROM push_subscriptions WHERE usuario_id = $1 LIMIT 1',
      [req.usuarioId]
    );
    // rama-ia-companera-fase2-v2 (alerta de uso diario, ver COORDINACION.md):
    // sin concepto de rol/admin en el esquema -- mismo criterio ya usado
    // para restringir POST /notificar-prueba, comparación directa contra el
    // nombre de usuario guardado en la sesión. Solo se corre la query extra
    // para 'bruce', para no pagar el costo de la agregación en cada visita
    // de cualquier otro usuario.
    let llamadasIaHoy = null;
    let alertaLlamadasIa = false;
    if (req.session.nombre_usuario === 'bruce') {
      llamadasIaHoy = await contarLlamadasIaHoy();
      alertaLlamadasIa = llamadasIaHoy >= UMBRAL_ALERTA_LLAMADAS_IA_POR_DIA;
    }
    res.render('ajustes', {
      nombreUsuario: usuario ? usuario.nombre_usuario : '',
      especieActual: usuario && usuario.ia_especie ? usuario.ia_especie : 'monstera',
      especies: IA_ESPECIES,
      notificacionesActivas: pushRows.length > 0,
      vapidPublicKey: process.env.VAPID_PUBLIC_KEY || '',
      emailActual: usuario ? usuario.email : null,
      tienePin: !!(usuario && usuario.pin_hash),
      tieneEmailPassword: !!(usuario && usuario.password_hash),
      reflexionActiva: usuario ? usuario.reflexion_ia_activa : true,
      error: null,
      errorVincular: null,
      guardado: null,
      llamadasIaHoy,
      alertaLlamadasIa,
      umbralAlertaLlamadasIa: UMBRAL_ALERTA_LLAMADAS_IA_POR_DIA,
    });
  } catch (err) {
    console.error('Error consultando ajustes:', err.message);
    res.status(500).render('ajustes', {
      nombreUsuario: '', especieActual: 'monstera', especies: IA_ESPECIES,
      notificacionesActivas: false, vapidPublicKey: process.env.VAPID_PUBLIC_KEY || '',
      emailActual: null, tienePin: true, tieneEmailPassword: false, reflexionActiva: true,
      error: 'No se pudo leer la base de datos.', errorVincular: null, guardado: null,
      llamadasIaHoy: null, alertaLlamadasIa: false, umbralAlertaLlamadasIa: UMBRAL_ALERTA_LLAMADAS_IA_POR_DIA,
    });
  }
});

// rama-recapitulacion-diaria (tarea 11): opt-out exigido por la
// restricción de diseño del 2026-08-16 -- afecta SOLO la reflexión
// narrativa, el pago de moneda diario sigue corriendo igual.
app.post('/ajustes/reflexion', async (req, res) => {
  const activar = req.body.activar === 'true';
  try {
    await pool.query('UPDATE usuarios SET reflexion_ia_activa = $1 WHERE id = $2', [activar, req.usuarioId]);
    res.redirect('/ajustes');
  } catch (err) {
    console.error('Error actualizando reflexion_ia_activa:', err.message);
    res.redirect('/ajustes');
  }
});

app.post('/ajustes/nombre', async (req, res) => {
  const nombreUsuario = (req.body.nombre_usuario || '').trim().toLowerCase();
  if (!NOMBRE_USUARIO_REGEX.test(nombreUsuario)) {
    return res.status(400).send('El usuario debe tener entre 3 y 20 caracteres (letras, números o _).');
  }
  try {
    await pool.query('UPDATE usuarios SET nombre_usuario = $1 WHERE id = $2', [nombreUsuario, req.usuarioId]);
    req.session.nombre_usuario = nombreUsuario;
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).send('Ese nombre de usuario ya está en uso.');
    }
    console.error('Error cambiando nombre de usuario:', err.message);
    return res.status(500).send('No se pudo guardar el nombre.');
  }
  res.redirect('/ajustes?guardado=nombre');
});

app.post('/ajustes/especie', async (req, res) => {
  const especie = req.body.especie;
  if (!IA_ESPECIES.includes(especie)) {
    return res.status(400).send('Especie inválida.');
  }
  try {
    await pool.query('UPDATE usuarios SET ia_especie = $1 WHERE id = $2', [especie, req.usuarioId]);
  } catch (err) {
    console.error('Error cambiando especie:', err.message);
    return res.status(500).send('No se pudo guardar la especie.');
  }
  res.redirect('/ajustes?guardado=especie');
});

app.post('/ajustes/notificaciones', async (req, res) => {
  try {
    await pool.query('DELETE FROM push_subscriptions WHERE usuario_id = $1', [req.usuarioId]);
  } catch (err) {
    console.error('Error desactivando notificaciones:', err.message);
    return res.status(500).send('No se pudo desactivar.');
  }
  res.redirect('/ajustes?guardado=notificaciones');
});

// rama-login-email: vincula email+contraseña a una cuenta EXISTENTE (a
// diferencia de /registro/email, que crea una fila nueva). UPDATE sobre la
// propia fila (req.usuarioId, de la sesión) -- nunca crea una cuenta
// duplicada. Exige la credencial actual (PIN, o contraseña si por algún
// motivo ya no tiene PIN) antes de agregar una credencial nueva: agregar
// una forma de entrar a la cuenta es tan sensible como eliminarla -- mismo
// criterio que /ajustes/eliminar-cuenta, no debería alcanzar con tener la
// sesión abierta (por ejemplo, sesión dejada abierta en un dispositivo
// compartido).
app.post('/ajustes/vincular-email', limitarIntentos('vincular-email'), async (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  const password = req.body.password || '';
  const confirmarPassword = req.body.confirmar_password || '';
  const pin = req.body.pin || '';
  const passwordActual = req.body.password_actual || '';

  if (!EMAIL_REGEX.test(email)) {
    return auxiliarErrorAjustes(req, res, { errorVincular: 'Ingresa un email válido.' });
  }
  if (password.length < PASSWORD_MIN_LARGO) {
    return auxiliarErrorAjustes(req, res, { errorVincular: `La contraseña debe tener al menos ${PASSWORD_MIN_LARGO} caracteres.` });
  }
  if (password !== confirmarPassword) {
    return auxiliarErrorAjustes(req, res, { errorVincular: 'La contraseña y su confirmación no coinciden.' });
  }

  try {
    const { rows } = await pool.query('SELECT pin_hash, password_hash FROM usuarios WHERE id = $1', [req.usuarioId]);
    const usuario = rows[0];
    const credencialValida = usuario && usuario.pin_hash
      ? verificarPin(pin, usuario.pin_hash)
      : usuario && usuario.password_hash
        ? await bcrypt.compare(passwordActual, usuario.password_hash)
        : false;
    if (!credencialValida) {
      const mensaje = usuario && usuario.pin_hash ? 'PIN actual incorrecto.' : 'Contraseña actual incorrecta.';
      return auxiliarErrorAjustes(req, res, { errorVincular: mensaje });
    }
    const passwordHash = await bcrypt.hash(password, 12);
    await pool.query('UPDATE usuarios SET email = $1, password_hash = $2 WHERE id = $3', [email, passwordHash, req.usuarioId]);
  } catch (err) {
    if (err.code === '23505') {
      return auxiliarErrorAjustes(req, res, { errorVincular: 'Ese email ya está vinculado a otra cuenta.' });
    }
    console.error('Error vinculando email:', err.message);
    return auxiliarErrorAjustes(req, res, { errorVincular: 'Error del servidor, intenta de nuevo.' });
  }
  res.redirect('/ajustes?guardado=email');
});

// rama-terminos-privacidad (tarea E, parte 2): borrado REAL de cuenta, no
// lógico (a diferencia de `pendientes.eliminado` en el resto de la app) —
// es a pedido explícito del dueño de los datos. Plan completo, orden de
// DELETE y los 3 casos con decisión propia documentados en COORDINACION.md,
// confirmados por el usuario antes de escribir esto. Exige el PIN actual
// (mismo criterio que /recuperar: una acción destructiva no debería
// alcanzar con tener la sesión abierta). Todo en una transacción — si
// cualquier paso falla, no se borra nada.
// rama-login-email: mensajeError puede ser un string (va al slot de error
// general, como antes) o { errorVincular } (va al slot propio de la sección
// "vincular email" para no pisar/mezclarse con el de eliminar-cuenta).
async function auxiliarErrorAjustes(req, res, mensajeError) {
  const esVincular = mensajeError && typeof mensajeError === 'object';
  const { rows } = await pool.query(
    'SELECT nombre_usuario, ia_especie, email, pin_hash, password_hash FROM usuarios WHERE id = $1',
    [req.usuarioId]
  );
  const usuario = rows[0];
  const { rows: pushRows } = await pool.query(
    'SELECT 1 FROM push_subscriptions WHERE usuario_id = $1 LIMIT 1',
    [req.usuarioId]
  );
  res.status(400).render('ajustes', {
    nombreUsuario: usuario ? usuario.nombre_usuario : '',
    especieActual: usuario && usuario.ia_especie ? usuario.ia_especie : 'monstera',
    especies: IA_ESPECIES,
    notificacionesActivas: pushRows.length > 0,
    vapidPublicKey: process.env.VAPID_PUBLIC_KEY || '',
    emailActual: usuario ? usuario.email : null,
    tienePin: !!(usuario && usuario.pin_hash),
    tieneEmailPassword: !!(usuario && usuario.password_hash),
    error: esVincular ? null : mensajeError,
    errorVincular: esVincular ? mensajeError.errorVincular : null,
    guardado: null,
  });
}

app.post('/ajustes/eliminar-cuenta', limitarIntentos('eliminar-cuenta'), async (req, res) => {
  const pin = req.body.pin || '';
  const passwordActual = req.body.password_actual || '';
  const confirmacion = (req.body.confirmar || '').trim().toUpperCase();
  if (confirmacion !== 'ELIMINAR') {
    return auxiliarErrorAjustes(req, res, 'Escribe ELIMINAR (en mayúsculas) para confirmar. Tu cuenta no se eliminó.');
  }

  const usuarioId = req.usuarioId;
  const client = await pool.connect();
  try {
    const { rows } = await client.query('SELECT pin_hash, password_hash FROM usuarios WHERE id = $1', [usuarioId]);
    const usuario = rows[0];
    // rama-login-email: una cuenta 100% por email (sin PIN nunca) no tiene
    // nada que verificar en pin_hash -- verificarPin(x, null) siempre da
    // false, así que antes esta cuenta jamás hubiera podido eliminarse.
    // Se prueba con lo que la cuenta realmente tenga: PIN si lo tiene
    // (criterio de siempre), o la contraseña si no.
    const credencialValida = usuario && usuario.pin_hash
      ? verificarPin(pin, usuario.pin_hash)
      : usuario && usuario.password_hash
        ? await bcrypt.compare(passwordActual, usuario.password_hash)
        : false;
    if (!usuario || !credencialValida) {
      client.release();
      const mensaje = usuario && usuario.pin_hash ? 'PIN incorrecto. Tu cuenta no se eliminó.' : 'Contraseña incorrecta. Tu cuenta no se eliminó.';
      return auxiliarErrorAjustes(req, res, mensaje);
    }

    await client.query('BEGIN');

    // 1. Eventos de trazabilidad a borrar: los que este usuario completó,
    // O los que pertenecen a un pendiente propio (lo haya completado un
    // amigo asignado). Caso C confirmado: se pierden sin alternativa.
    const { rows: eventosRows } = await client.query(
      `SELECT e.id FROM eventos_completado e
       LEFT JOIN pendientes p ON p.id = e.pendiente_id
       WHERE e.completado_por = $1 OR p.usuario_id = $1`,
      [usuarioId]
    );
    const idsEventos = eventosRows.map((r) => r.id);

    // 2. moneda_transacciones: las propias, más cualquiera que apunte a un
    // evento_completado del paso 1 (puede ser de OTRO usuario — ver el
    // hallazgo documentado en COORDINACION.md).
    await client.query(
      'DELETE FROM moneda_transacciones WHERE usuario_id = $1 OR evento_completado_id = ANY($2::int[])',
      [usuarioId, idsEventos]
    );

    // 3. eventos_completado.
    await client.query('DELETE FROM eventos_completado WHERE id = ANY($1::int[])', [idsEventos]);

    // 4. historial_ediciones de pendientes propios.
    await client.query(
      'DELETE FROM historial_ediciones WHERE pendiente_id IN (SELECT id FROM pendientes WHERE usuario_id = $1)',
      [usuarioId]
    );

    // 5. reflexiones propias o de pendientes propios.
    await client.query(
      'DELETE FROM reflexiones WHERE usuario_id = $1 OR pendiente_id IN (SELECT id FROM pendientes WHERE usuario_id = $1)',
      [usuarioId]
    );

    // 6. Caso A confirmado: desasignar (no borrar) pendientes ajenos que
    // este usuario tenía asignados.
    await client.query(
      'UPDATE pendientes SET asignado_a = NULL, asignado_en = NULL WHERE asignado_a = $1 AND usuario_id != $1',
      [usuarioId]
    );

    // 7. Amistades donde participa.
    const { rows: amistadesRows } = await client.query(
      'SELECT id FROM amistades WHERE usuario_a_id = $1 OR usuario_b_id = $1',
      [usuarioId]
    );
    const idsAmistades = amistadesRows.map((r) => r.id);

    // 8. Caso B confirmado: se borran los mensajes de AMBOS lados de cada
    // amistad donde participa (no solo los propios), porque `mensajes`
    // tiene FK a `amistades`, que se borra en el paso 13.
    await client.query(
      'DELETE FROM mensajes WHERE autor_id = $1 OR amistad_id = ANY($2::int[])',
      [usuarioId, idsAmistades]
    );

    // 9. Mensajes de la sala general.
    await client.query('DELETE FROM mensajes_generales WHERE autor_id = $1', [usuarioId]);

    // 10-12. Suscripciones push, tokens de Google Calendar, protecciones de racha.
    await client.query('DELETE FROM push_subscriptions WHERE usuario_id = $1', [usuarioId]);
    await client.query('DELETE FROM google_calendar_tokens WHERE usuario_id = $1', [usuarioId]);
    await client.query('DELETE FROM racha_protecciones WHERE usuario_id = $1', [usuarioId]);

    // 13. Amistades.
    await client.query('DELETE FROM amistades WHERE id = ANY($1::int[])', [idsAmistades]);

    // 14. Pendientes propios (los ajenos ya se desasignaron en el paso 6).
    await client.query('DELETE FROM pendientes WHERE usuario_id = $1', [usuarioId]);

    // rama-fix-metas-eliminar-cuenta: metas (Fase 2 de v0.2) y metas
    // compartidas (rama-metas-compartidas) no existían cuando se escribió
    // originalmente esta ruta -- faltaban acá, lo que rompía el borrado con
    // violación de FK para cualquier cuenta que hubiera creado o
    // participado en una. Orden:
    //   a. Metas personales: propias de nadie más, borrado directo.
    //   b. La propia fila de participante en CUALQUIER meta compartida
    //      (haya sido creada por este usuario o por otro).
    //   c. Metas compartidas creadas por este usuario que TODAVÍA tienen
    //      otros participantes (tras el paso b): mismo criterio que el
    //      paso 6 de pendientes asignados -- preservar el dato ajeno en
    //      vez de borrarlo, así que `creado_por` pasa a NULL (ya es
    //      "solo informativo", ver comentario donde se define la tabla)
    //      en vez de arrastrar la meta compartida de los demás con la
    //      cuenta que se está eliminando.
    //   d. Metas compartidas que quedaron sin ningún participante (el
    //      creador la borra y era el único, o ya no quedan otros): esas
    //      sí se borran del todo, no tiene sentido una meta compartida
    //      sin nadie participando.
    await client.query('DELETE FROM metas WHERE usuario_id = $1', [usuarioId]);
    await client.query('DELETE FROM metas_compartidas_participantes WHERE usuario_id = $1', [usuarioId]);
    await client.query(
      `UPDATE metas_compartidas SET creado_por = NULL
       WHERE creado_por = $1 AND EXISTS (
         SELECT 1 FROM metas_compartidas_participantes WHERE meta_compartida_id = metas_compartidas.id
       )`,
      [usuarioId]
    );
    await client.query('DELETE FROM metas_compartidas WHERE creado_por = $1', [usuarioId]);

    // 15. Ideas, recordatorios, hechos.
    await client.query('DELETE FROM ideas WHERE usuario_id = $1', [usuarioId]);
    await client.query('DELETE FROM recordatorios WHERE usuario_id = $1', [usuarioId]);
    await client.query('DELETE FROM hechos WHERE usuario_id = $1', [usuarioId]);

    // rama-ia-companera-fase2-v2 (tarea 9 del roadmap): conversación con la
    // IA compañera, perfil acumulado, y log de llamadas -- las 3 tablas
    // nuevas de la tarea 9 referencian usuario_id sin ON DELETE CASCADE,
    // igual que el resto del esquema de este proyecto (el borrado en
    // cascada se hace acá explícitamente, no en la DB).
    await client.query('DELETE FROM mensajes_ia WHERE usuario_id = $1', [usuarioId]);
    await client.query('DELETE FROM perfil_ia WHERE usuario_id = $1', [usuarioId]);
    await client.query('DELETE FROM ia_llamadas WHERE usuario_id = $1', [usuarioId]);

    // rama-recapitulacion-diaria (tarea 11): mismo motivo que arriba --
    // recapitulacion_diaria.usuario_id tampoco tiene ON DELETE CASCADE.
    await client.query('DELETE FROM recapitulacion_diaria WHERE usuario_id = $1', [usuarioId]);

    // rama-logros: mismo motivo que las 2 tablas de arriba --
    // logros_desbloqueados.usuario_id tampoco tiene ON DELETE CASCADE.
    await client.query('DELETE FROM logros_desbloqueados WHERE usuario_id = $1', [usuarioId]);

    // 16. rama-login-email: tokens de reseteo de contraseña propios --
    // `reseteos_password.usuario_id` no tenía ON DELETE CASCADE, así que
    // sin este paso el DELETE de abajo fallaba por violación de FK para
    // cualquier cuenta que hubiera pedido un reseteo alguna vez (aunque
    // ya estuviera usado/vencido, la fila sigue existiendo).
    await client.query('DELETE FROM reseteos_password WHERE usuario_id = $1', [usuarioId]);

    // 17. La cuenta misma.
    await client.query('DELETE FROM usuarios WHERE id = $1', [usuarioId]);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
    console.error('Error eliminando cuenta:', err.message);
    return auxiliarErrorAjustes(req, res, 'No se pudo eliminar la cuenta. No se borró nada.');
  }
  client.release();

  // 18. Destruir la sesión actual. Limitación conocida y documentada en
  // COORDINACION.md: sesiones abiertas en otro dispositivo quedan
  // huérfanas en la tabla `session` hasta que expiren solas (30 días).
  req.session.destroy((err) => {
    if (err) console.error('Error destruyendo sesión tras eliminar cuenta:', err.message);
    res.redirect('/login?cuenta_eliminada=1');
  });
});

// Vista y rutas de chat. Todavía no está enlazada al menú de navegación
// principal (partials/nav.ejs) ni depende de la tabla amistades, que se
// construye en otra rama.
app.get('/chat', async (req, res) => {
  const amistadId = Number(req.query.amistad_id);
  const buscar = (req.query.buscar || '').trim();
  const vacio = { mensajes: [], amistadId: null, error: null, usuarioId: req.usuarioId, buscar, amigoId: null, misMetas: [], misMetasCompartidas: [] };
  if (!Number.isInteger(amistadId)) {
    return res.render('chat', vacio);
  }
  try {
    const pertenece = await usuarioPerteneceAmistad(req.usuarioId, amistadId);
    if (!pertenece) {
      return res.status(403).render('chat', { ...vacio, error: 'No tienes acceso a esta conversación.' });
    }
    // rama-chat-metas: se necesita el id del amigo (no solo saber que
    // pertenezco a la amistad) para el link a /chat/estadisticas y para
    // futuros usos -- una sola fila, ya se validó arriba que pertenezco.
    const { rows: filaAmistad } = await pool.query(
      'SELECT usuario_a_id, usuario_b_id FROM amistades WHERE id = $1',
      [amistadId]
    );
    const amigoId = filaAmistad.length
      ? (filaAmistad[0].usuario_a_id === req.usuarioId ? filaAmistad[0].usuario_b_id : filaAmistad[0].usuario_a_id)
      : null;

    const params = [amistadId, req.usuarioId];
    // rama-fix-chat-visual: se suma el JOIN a usuarios para traer el nombre
    // real del autor -- antes la vista mostraba "Usuario " + autor_id (el
    // ID interno crudo) porque esta consulta nunca lo trajo. Mismo patrón
    // que ya usa GET /chat-general (`u.nombre_usuario AS autor_nombre`,
    // LEFT JOIN por si la cuenta del autor ya no existe).
    // rama-chat-metas: se suman los LEFT JOIN a metas/metas_compartidas
    // para poder renderizar una "meta-card" en vez de texto plano cuando
    // el mensaje adjunta una meta -- mp/mc quedan NULL si el mensaje es de
    // texto normal. mcp_yo solo existe para saber si YO ya participo en la
    // meta compartida adjuntada (para mostrar u ocultar el botón "Unirme").
    let consulta = `SELECT m.id, m.amistad_id, m.autor_id, m.texto, m.fecha, m.leido, u.nombre_usuario AS autor_nombre,
        m.meta_personal_id, mp.titulo AS mp_titulo, mp.valor_actual AS mp_actual, mp.valor_objetivo AS mp_objetivo, mp.tipo_metrica AS mp_metrica, mp.estado AS mp_estado,
        m.meta_compartida_id, mc.titulo AS mc_titulo, mc.valor_actual AS mc_actual, mc.valor_objetivo AS mc_objetivo, mc.tipo_metrica AS mc_metrica, mc.estado AS mc_estado,
        (mcp_yo.usuario_id IS NOT NULL) AS mc_ya_participo
       FROM mensajes m
       LEFT JOIN usuarios u ON u.id = m.autor_id
       LEFT JOIN metas mp ON mp.id = m.meta_personal_id
       LEFT JOIN metas_compartidas mc ON mc.id = m.meta_compartida_id
       LEFT JOIN metas_compartidas_participantes mcp_yo ON mcp_yo.meta_compartida_id = m.meta_compartida_id AND mcp_yo.usuario_id = $2
       WHERE m.amistad_id = $1`;
    if (buscar) {
      params.push(`%${buscar}%`);
      consulta += ` AND m.texto ILIKE $${params.length}`;
    }
    consulta += ' ORDER BY m.fecha ASC';
    const [{ rows }, { rows: misMetas }, misMetasCompartidas] = await Promise.all([
      pool.query(consulta, params),
      pool.query('SELECT id, titulo, estado FROM metas WHERE usuario_id = $1 ORDER BY creado DESC', [req.usuarioId]),
      metasCompartidasDeUsuario(req.usuarioId),
    ]);
    // Se capturan los mensajes ANTES de marcarlos como leídos, para que la
    // vista todavía pueda mostrar cuáles llegaron sin leer en esta apertura
    // del chat. Solo se marcan los mensajes del OTRO usuario: los propios no
    // se tocan (su estado `leido` indica si el otro ya los vio).
    await pool.query(
      'UPDATE mensajes SET leido = true WHERE amistad_id = $1 AND autor_id != $2 AND leido = false',
      [amistadId, req.usuarioId]
    );
    res.render('chat', { mensajes: rows, amistadId, error: null, usuarioId: req.usuarioId, buscar, amigoId, misMetas, misMetasCompartidas });
  } catch (err) {
    console.error('Error consultando mensajes:', err.message);
    res.status(500).render('chat', { ...vacio, amistadId, error: 'No se pudo leer la base de datos.' });
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
    // rama-chat-general: conteo aparte (noLeidosGeneral), no se suma a
    // noLeidos — decisión documentada en COORDINACION.md. Usa
    // chat_general_visto_hasta en vez de una columna leido por mensaje.
    const { rows: generalRows } = await pool.query(
      `SELECT COUNT(*)::int AS no_leidos
       FROM mensajes_generales mg, usuarios u
       WHERE u.id = $1
         AND mg.autor_id != $1
         AND mg.fecha > COALESCE(u.chat_general_visto_hasta, to_timestamp(0))`,
      [req.usuarioId]
    );
    res.json({ noLeidos: rows[0].no_leidos, noLeidosGeneral: generalRows[0].no_leidos });
  } catch (err) {
    console.error('Error consultando notificaciones:', err.message);
    res.status(500).json({ error: 'No se pudo consultar notificaciones.' });
  }
});

// rama-chat-metas (optimización pedida por el usuario -- "quiero que sea
// veloz"): si el cliente pide JSON (fetch desde chat.js), responde con el
// mensaje recién creado en vez de forzar una recarga completa de /chat --
// el formulario plano sigue funcionando igual (progressive enhancement,
// mismo espíritu que `data-carga-manual` en partials/scripts.ejs) para
// quien tenga JS desactivado.
app.post('/mensajes', async (req, res) => {
  const amistadId = Number(req.body.amistad_id);
  const texto = (req.body.texto || '').trim();
  const quiereJson = (req.get('accept') || '').includes('application/json');
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
    const { rows } = await pool.query(
      'INSERT INTO mensajes (amistad_id, autor_id, texto, fecha, leido) VALUES ($1, $2, $3, now(), false) RETURNING id, fecha',
      [amistadId, req.usuarioId, texto]
    );
    if (quiereJson) {
      return res.json({ id: rows[0].id, fecha: rows[0].fecha, texto, autorId: req.usuarioId });
    }
  } catch (err) {
    console.error('Error creando mensaje:', err.message);
    if (quiereJson) return res.status(500).json({ error: 'No se pudo enviar el mensaje.' });
    return res.status(500).send('No se pudo enviar el mensaje.');
  }
  res.redirect('/chat?amistad_id=' + amistadId);
});

// rama-chat-metas: comparte una meta propia (personal) o una meta
// compartida en la que participo como un mensaje especial dentro del chat
// de una amistad -- el texto es solo un resumen legible (para que
// búsqueda de texto y notificaciones sigan funcionando sin cambios), la
// vista renderiza la meta-card real a partir de meta_personal_id/
// meta_compartida_id (ver GET /chat). Nunca las dos columnas a la vez.
app.post('/mensajes/meta', async (req, res) => {
  const amistadId = Number(req.body.amistad_id);
  const metaTipo = req.body.meta_tipo;
  const metaId = Number(req.body.meta_id);
  if (!Number.isInteger(amistadId) || !Number.isInteger(metaId) || !['personal', 'compartida'].includes(metaTipo)) {
    return res.status(400).send('Datos inválidos.');
  }
  try {
    const pertenece = await usuarioPerteneceAmistad(req.usuarioId, amistadId);
    if (!pertenece) {
      return res.status(403).send('No tienes acceso a esta conversación.');
    }
    if (metaTipo === 'personal') {
      // Solo se puede compartir una meta PROPIA -- nunca la de otro usuario,
      // aunque el id se adivine.
      const { rows } = await pool.query('SELECT titulo FROM metas WHERE id = $1 AND usuario_id = $2', [metaId, req.usuarioId]);
      if (!rows.length) return res.status(403).send('Esa meta no es tuya.');
      await pool.query(
        'INSERT INTO mensajes (amistad_id, autor_id, texto, meta_personal_id, fecha, leido) VALUES ($1, $2, $3, $4, now(), false)',
        [amistadId, req.usuarioId, `📎 Meta: ${rows[0].titulo}`, metaId]
      );
    } else {
      // Solo se puede compartir una meta compartida en la que YA participo.
      const { rows } = await pool.query(
        `SELECT mc.titulo FROM metas_compartidas mc
         JOIN metas_compartidas_participantes p ON p.meta_compartida_id = mc.id AND p.usuario_id = $2
         WHERE mc.id = $1`,
        [metaId, req.usuarioId]
      );
      if (!rows.length) return res.status(403).send('No participas en esa meta compartida.');
      await pool.query(
        'INSERT INTO mensajes (amistad_id, autor_id, texto, meta_compartida_id, fecha, leido) VALUES ($1, $2, $3, $4, now(), false)',
        [amistadId, req.usuarioId, `📎 Meta compartida: ${rows[0].titulo}`, metaId]
      );
    }
  } catch (err) {
    console.error('Error compartiendo meta en el chat:', err.message);
    return res.status(500).send('No se pudo compartir la meta.');
  }
  res.redirect('/chat?amistad_id=' + amistadId);
});

// rama-chat-metas: unirse a una meta compartida recibida como meta-card en
// el chat. Requisito de confianza (decisión documentada acá, no hay
// pedido explícito del usuario sobre el criterio exacto): quien se quiere
// unir tiene que ser amigo aceptado de quien CREÓ la meta -- mismo modelo
// de confianza que ya usa el resto de la app (nunca abrir una acción a
// cualquier usuario logueado solo porque adivinó un id). No hace falta
// ser amigo de TODOS los participantes, solo del creador.
app.post('/metas/compartida/:id/unirme', async (req, res) => {
  const metaId = Number(req.params.id);
  const amistadId = Number(req.body.amistad_id);
  if (!Number.isInteger(metaId)) return res.status(400).send('id inválido.');
  try {
    const { rows } = await pool.query('SELECT creado_por, estado FROM metas_compartidas WHERE id = $1', [metaId]);
    if (!rows.length) return res.status(404).send('Meta compartida no encontrada.');
    const { creado_por: creadoPor, estado } = rows[0];
    if (estado !== 'activa') return res.status(400).send('Esa meta ya no está activa.');
    let esAmigoDelCreador = creadoPor === req.usuarioId;
    if (!esAmigoDelCreador) {
      const { rows: amistadConCreador } = await pool.query(
        `SELECT 1 FROM amistades WHERE estado = 'aceptada' AND
         ((usuario_a_id = $1 AND usuario_b_id = $2) OR (usuario_a_id = $2 AND usuario_b_id = $1))`,
        [req.usuarioId, creadoPor]
      );
      esAmigoDelCreador = amistadConCreador.length > 0;
    }
    if (!esAmigoDelCreador) return res.status(403).send('No puedes unirte a esta meta.');
    await pool.query(
      'INSERT INTO metas_compartidas_participantes (meta_compartida_id, usuario_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [metaId, req.usuarioId]
    );
  } catch (err) {
    console.error('Error uniéndose a meta compartida:', err.message);
    return res.status(500).send('No se pudo unir a la meta.');
  }
  res.redirect(Number.isInteger(amistadId) ? '/chat?amistad_id=' + amistadId : '/metas');
});

// rama-chat-metas: "ventana de estadísticas" pedida explícitamente por el
// usuario -- metas cumplidas entre los dos amigos de esta amistad. Cuenta
// personales de cada quien por separado (mismo espíritu que la racha
// comparable de /amigos: solo el número, no el detalle de cada meta
// personal del otro) y lista las metas COMPARTIDAS completadas en las que
// ambos participan juntos (esas sí con título, porque ya son compartidas
// por definición).
app.get('/chat/estadisticas', async (req, res) => {
  const amistadId = Number(req.query.amistad_id);
  if (!Number.isInteger(amistadId)) return res.status(400).send('amistad_id inválido.');
  try {
    const pertenece = await usuarioPerteneceAmistad(req.usuarioId, amistadId);
    if (!pertenece) return res.status(403).send('No tienes acceso a esta conversación.');
    const { rows: filaAmistad } = await pool.query('SELECT usuario_a_id, usuario_b_id FROM amistades WHERE id = $1', [amistadId]);
    const amigoId = filaAmistad[0].usuario_a_id === req.usuarioId ? filaAmistad[0].usuario_b_id : filaAmistad[0].usuario_a_id;
    const [{ rows: conteos }, { rows: amigoFila }, { rows: compartidasJuntos }] = await Promise.all([
      pool.query(
        `SELECT usuario_id, COUNT(*)::int AS completadas FROM metas
         WHERE estado = 'completada' AND usuario_id IN ($1, $2) GROUP BY usuario_id`,
        [req.usuarioId, amigoId]
      ),
      pool.query('SELECT nombre_usuario FROM usuarios WHERE id = $1', [amigoId]),
      pool.query(
        `SELECT mc.id, mc.titulo, mc.valor_actual, mc.valor_objetivo, mc.tipo_metrica
         FROM metas_compartidas mc
         WHERE mc.estado = 'completada'
           AND EXISTS (SELECT 1 FROM metas_compartidas_participantes WHERE meta_compartida_id = mc.id AND usuario_id = $1)
           AND EXISTS (SELECT 1 FROM metas_compartidas_participantes WHERE meta_compartida_id = mc.id AND usuario_id = $2)
         ORDER BY mc.id DESC`,
        [req.usuarioId, amigoId]
      ),
    ]);
    const propiasCompletadas = conteos.find((c) => c.usuario_id === req.usuarioId)?.completadas || 0;
    const amigoCompletadas = conteos.find((c) => c.usuario_id === amigoId)?.completadas || 0;
    res.render('chat-estadisticas', {
      amistadId,
      amigoNombre: amigoFila[0]?.nombre_usuario || 'tu amigo',
      propiasCompletadas,
      amigoCompletadas,
      compartidasJuntos,
      error: null,
    });
  } catch (err) {
    console.error('Error consultando estadísticas de chat:', err.message);
    res.status(500).render('chat-estadisticas', {
      amistadId, amigoNombre: '', propiasCompletadas: 0, amigoCompletadas: 0, compartidasJuntos: [], error: 'No se pudo leer la base de datos.',
    });
  }
});

// rama-chat-general: sala única para todos los usuarios registrados, sin
// amistad de por medio. Paginación de 50 mensajes por vez (decisión
// documentada en COORDINACION.md) con cursor `antes` (id del mensaje más
// viejo ya cargado) para pedir la tanda anterior.
const MENSAJES_GENERALES_POR_PAGINA = 50;

app.get('/chat-general', async (req, res) => {
  const antesId = Number(req.query.antes);
  try {
    const params = [];
    let consulta = `SELECT m.id, m.autor_id, m.texto, m.fecha, u.nombre_usuario AS autor_nombre
       FROM mensajes_generales m
       LEFT JOIN usuarios u ON u.id = m.autor_id`;
    if (Number.isInteger(antesId)) {
      params.push(antesId);
      consulta += ` WHERE m.id < $${params.length}`;
    }
    params.push(MENSAJES_GENERALES_POR_PAGINA);
    consulta += ` ORDER BY m.id DESC LIMIT $${params.length}`;
    const { rows } = await pool.query(consulta, params);
    const mensajes = rows.reverse();

    const { rows: usuarioRows } = await pool.query(
      'SELECT chat_general_visto_hasta FROM usuarios WHERE id = $1',
      [req.usuarioId]
    );
    const vistoHasta = usuarioRows[0] ? usuarioRows[0].chat_general_visto_hasta : null;
    await pool.query('UPDATE usuarios SET chat_general_visto_hasta = now() WHERE id = $1', [req.usuarioId]);

    res.render('chat-general', {
      mensajes,
      usuarioId: req.usuarioId,
      vistoHasta,
      hayMasAntiguos: mensajes.length === MENSAJES_GENERALES_POR_PAGINA,
      primerId: mensajes.length > 0 ? mensajes[0].id : null,
      error: null,
    });
  } catch (err) {
    console.error('Error consultando chat general:', err.message);
    res.status(500).render('chat-general', {
      mensajes: [],
      usuarioId: req.usuarioId,
      vistoHasta: null,
      hayMasAntiguos: false,
      primerId: null,
      error: 'No se pudo leer la base de datos.',
    });
  }
});

app.post('/mensajes-general', async (req, res) => {
  const texto = (req.body.texto || '').trim();
  if (!texto) {
    return res.status(400).send('El texto no puede estar vacío');
  }
  try {
    await pool.query(
      'INSERT INTO mensajes_generales (autor_id, texto, fecha) VALUES ($1, $2, now())',
      [req.usuarioId, texto]
    );
  } catch (err) {
    console.error('Error creando mensaje general:', err.message);
    return res.status(500).send('No se pudo enviar el mensaje.');
  }
  res.redirect('/chat-general');
});

// rama-fix-404: página propia con el estilo visual de la app en vez del
// error genérico de Express ("Cannot GET /..."), para rutas que no
// existen. Va AL FINAL, después de todas las rutas -- Express solo llega
// acá si ninguna ruta anterior matcheó. `res.locals.barraSuperior` ya
// está poblado (o no) por el middleware global de arriba para CUALQUIER
// request que llegue hasta acá, logueado o no -- la vista usa eso para
// decidir si mostrar el nav y a dónde manda "Volver al inicio".
app.use((req, res) => {
  res.status(404).render('404');
});

ensureSchema()
  .catch((err) => console.error('Error preparando el esquema:', err.message))
  .finally(() => {
    app.listen(PORT, () => {
      console.log(`Servidor corriendo en http://localhost:${PORT}`);
    });
  });
