require('dotenv').config();

const express = require('express');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

app.set('view engine', 'ejs');
app.set('views', __dirname + '/views');
app.use(express.static(__dirname + '/public'));
app.use(express.urlencoded({ extended: false }));

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

app.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, texto, creado FROM pendientes WHERE hecho = FALSE ORDER BY creado ASC'
    );
    res.render('index', { pendientes: rows, error: null, clave: req.clave });
  } catch (err) {
    console.error('Error consultando pendientes:', err.message);
    res.status(500).render('index', { pendientes: [], error: 'No se pudo leer la base de datos.', clave: req.clave });
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

app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
