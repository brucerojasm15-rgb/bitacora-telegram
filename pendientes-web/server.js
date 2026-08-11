require('dotenv').config();

const express = require('express');
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
app.use(express.static(__dirname + '/public'));
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// Página mínima sin datos: si no llegó ?clave en la URL, intenta reinyectarla
// desde localStorage (solo la que ya se guardó en un acceso válido previo)
// antes de rendirse con un 403 en blanco.
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

async function ensureSchema() {
  await pool.query(`
    ALTER TABLE pendientes
      ADD COLUMN IF NOT EXISTS contador_posposiciones INT DEFAULT 0,
      ADD COLUMN IF NOT EXISTS necesita_reflexion BOOLEAN DEFAULT false
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
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id SERIAL PRIMARY KEY,
      endpoint TEXT,
      p256dh TEXT,
      auth TEXT,
      creado TIMESTAMP DEFAULT now()
    )
  `);
}

app.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, texto, creado, necesita_reflexion FROM pendientes WHERE hecho = FALSE ORDER BY creado ASC'
    );
    res.render('index', {
      pendientes: rows,
      error: null,
      clave: req.clave,
      vapidPublicKey: process.env.VAPID_PUBLIC_KEY || '',
    });
  } catch (err) {
    console.error('Error consultando pendientes:', err.message);
    res.status(500).render('index', {
      pendientes: [],
      error: 'No se pudo leer la base de datos.',
      clave: req.clave,
      vapidPublicKey: process.env.VAPID_PUBLIC_KEY || '',
    });
  }
});

app.post('/pendientes', async (req, res) => {
  const texto = (req.body.texto || '').trim();
  if (!texto) {
    return res.status(400).send('El texto no puede estar vacío');
  }
  try {
    await pool.query(
      'INSERT INTO pendientes (texto, creado, hecho) VALUES ($1, now(), FALSE)',
      [texto]
    );
  } catch (err) {
    console.error('Error creando pendiente:', err.message);
  }
  res.redirect(`/?clave=${encodeURIComponent(req.clave)}`);
});

app.post('/pendientes/:id/completar', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).send('id inválido');
  }
  try {
    await pool.query('UPDATE pendientes SET hecho = TRUE WHERE id = $1', [id]);
  } catch (err) {
    console.error('Error marcando pendiente como hecho:', err.message);
  }
  res.redirect(`/?clave=${encodeURIComponent(req.clave)}`);
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
       WHERE id = $1`,
      [id]
    );
  } catch (err) {
    console.error('Error posponiendo pendiente:', err.message);
  }
  res.redirect(`/?clave=${encodeURIComponent(req.clave)}`);
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
      'INSERT INTO reflexiones (pendiente_id, pregunta, respuesta) VALUES ($1, $2, $3)',
      [id, '¿Qué pasa?', respuesta]
    );
    await client.query(
      'UPDATE pendientes SET contador_posposiciones = 0, necesita_reflexion = FALSE WHERE id = $1',
      [id]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error guardando reflexion:', err.message);
  } finally {
    client.release();
  }
  res.redirect(`/?clave=${encodeURIComponent(req.clave)}`);
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
  const clave = process.env.ACCESS_KEY || '';
  return {
    title: 'Bitácora',
    body: 'No has registrado nada hecho hoy — ¿qué avanzaste?',
    actions: [
      { action: 'abrir', title: 'Abrir' },
      { action: 'agregar', title: 'Agregar pendiente' },
    ],
    data: {
      defaultUrl: `/?clave=${clave}`,
      urls: {
        abrir: `/?clave=${clave}`,
        agregar: `/?clave=${clave}#nuevo-pendiente`,
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
  if (rango === '7') return `WHERE ${columnaFecha} >= NOW() - INTERVAL '7 days'`;
  if (rango === '30') return `WHERE ${columnaFecha} >= NOW() - INTERVAL '30 days'`;
  return '';
}

app.get('/ideas', async (req, res) => {
  const rango = RANGOS_VALIDOS.includes(req.query.rango) ? req.query.rango : 'todo';
  try {
    const { rows } = await pool.query(
      `SELECT id, fecha, idea, estado FROM ideas ${whereRango(rango, 'fecha::timestamptz')} ORDER BY id DESC`
    );
    res.render('ideas', { ideas: rows, error: null, clave: req.clave, rango });
  } catch (err) {
    console.error('Error consultando ideas:', err.message);
    res.status(500).render('ideas', { ideas: [], error: 'No se pudo leer la base de datos.', clave: req.clave, rango });
  }
});

app.get('/recordatorios', async (req, res) => {
  const rango = RANGOS_VALIDOS.includes(req.query.rango) ? req.query.rango : 'todo';
  try {
    const { rows } = await pool.query(
      `SELECT id, texto, cuando, avisado FROM recordatorios ${whereRango(rango, 'cuando')} ORDER BY id DESC`
    );
    res.render('recordatorios', { recordatorios: rows, error: null, clave: req.clave, rango });
  } catch (err) {
    console.error('Error consultando recordatorios:', err.message);
    res.status(500).render('recordatorios', { recordatorios: [], error: 'No se pudo leer la base de datos.', clave: req.clave, rango });
  }
});

app.get('/hechos', async (req, res) => {
  const rango = RANGOS_VALIDOS.includes(req.query.rango) ? req.query.rango : 'todo';
  try {
    const { rows } = await pool.query(
      `SELECT id, texto, cuando FROM hechos ${whereRango(rango, 'cuando')} ORDER BY id DESC`
    );
    res.render('hechos', { hechos: rows, error: null, clave: req.clave, rango });
  } catch (err) {
    console.error('Error consultando hechos:', err.message);
    res.status(500).render('hechos', { hechos: [], error: 'No se pudo leer la base de datos.', clave: req.clave, rango });
  }
});

app.get('/pendientes/:id/editar', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).send('id inválido');
  }
  try {
    const { rows } = await pool.query('SELECT id, texto FROM pendientes WHERE id = $1', [id]);
    if (rows.length === 0) {
      return res.status(404).send('Pendiente no encontrado');
    }
    res.render('editar', { pendiente: rows[0], clave: req.clave });
  } catch (err) {
    console.error('Error cargando pendiente para editar:', err.message);
    res.status(500).send('No se pudo cargar el pendiente');
  }
});

app.post('/pendientes/:id/editar', async (req, res) => {
  const id = Number(req.params.id);
  const texto = (req.body.texto || '').trim();
  if (!Number.isInteger(id)) {
    return res.status(400).send('id inválido');
  }
  if (!texto) {
    return res.status(400).send('El texto no puede estar vacío');
  }
  try {
    await pool.query('UPDATE pendientes SET texto = $1 WHERE id = $2', [texto, id]);
  } catch (err) {
    console.error('Error actualizando pendiente:', err.message);
  }
  res.redirect(`/?clave=${encodeURIComponent(req.clave)}`);
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
      { nombre: 'Pendientes', query: 'SELECT * FROM pendientes ORDER BY id' },
      { nombre: 'Ideas', query: 'SELECT * FROM ideas ORDER BY id' },
      { nombre: 'Recordatorios', query: 'SELECT * FROM recordatorios ORDER BY id' },
      { nombre: 'Hechos', query: 'SELECT * FROM hechos ORDER BY id' },
      { nombre: 'Reflexiones', query: 'SELECT * FROM reflexiones ORDER BY id' },
    ];

    for (const { nombre, query } of tablas) {
      const { rows, fields } = await pool.query(query);
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

ensureSchema()
  .catch((err) => console.error('Error preparando el esquema:', err.message))
  .finally(() => {
    app.listen(PORT, () => {
      console.log(`Servidor corriendo en http://localhost:${PORT}`);
    });
  });
