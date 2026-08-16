// rama-segmentacion-ideas (Fase 1 de v0.2, ver COORDINACION.md): migración
// retroactiva — parte las ideas existentes en pensamientos atómicos +
// etiqueta, igual que hace POST /captura con las ideas nuevas.
//
// Por defecto corre en modo --dry-run: NO TOCA la tabla `ideas`, solo
// imprime qué haría Groq con cada idea real. Pasa --ejecutar para que mute
// de verdad (respaldo primero en ideas_backup_pre_segmentacion, nunca se
// pierde el texto original).
//
// Uso:
//   node scripts/migrar_segmentar_ideas.js              (dry-run, no toca nada)
//   node scripts/migrar_segmentar_ideas.js --ejecutar    (muta la DB real)

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODELO_IA_SEGMENTACION = 'llama-3.3-70b-versatile';
const groqClient = process.env.GROQ_API_KEY ? { apiKey: process.env.GROQ_API_KEY } : null;

// Copia de segmentarIdeaConGroq en server.js (misma lógica exacta) — si se
// ajusta una, ajustar la otra. Documentado también en COORDINACION.md al
// cerrar esta rama, para que quien mergee lo sepa.
async function segmentarIdeaConGroq(texto) {
  const sinSegmentar = [{ texto, etiqueta: null }];
  if (!groqClient) return sinSegmentar;

  const system = `Recibís una "idea" que un usuario escribió de corrido en una app de bitácora personal.
Tu trabajo: partirla en pensamientos atómicos (una idea/tarea/observación completa por pensamiento) y ponerle una etiqueta corta de tema a cada uno (1-3 palabras, minúsculas, sin tildes, ej: "trabajo", "salud", "fundo", "compras").
Si el texto YA es un solo pensamiento atómico, devolvelo tal cual en un único elemento — no inventes cortes artificiales.
No agregues, resumas ni interpretes contenido que no esté en el texto original; solo separá y etiquetá.
Respondé ÚNICAMENTE con JSON en este formato exacto, sin texto adicional ni markdown:
{"pensamientos":[{"texto":"...","etiqueta":"..."}]}`;

  try {
    const respuesta = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${groqClient.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODELO_IA_SEGMENTACION,
        max_tokens: 1024,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: texto },
        ],
      }),
    });
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
    return limpios.length ? limpios : sinSegmentar;
  } catch (err) {
    console.error(`  (error de Groq, se deja sin segmentar: ${err.message})`);
    return sinSegmentar;
  }
}

async function asegurarBackup() {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS total FROM ideas_backup_pre_segmentacion');
  if (rows[0].total > 0) {
    console.log(`ideas_backup_pre_segmentacion ya tiene ${rows[0].total} fila(s) — no se vuelve a poblar.`);
    return;
  }
  const { rowCount } = await pool.query(
    'INSERT INTO ideas_backup_pre_segmentacion (id, fecha, idea, estado, usuario_id) SELECT id, fecha, idea, estado, usuario_id FROM ideas'
  );
  console.log(`Respaldo creado: ${rowCount} fila(s) copiadas a ideas_backup_pre_segmentacion.`);
}

async function main() {
  const ejecutar = process.argv.includes('--ejecutar');

  if (!groqClient) {
    console.log(
      '⚠️  No hay GROQ_API_KEY en .env — cada idea va a caer al fallback (sin segmentar, etiqueta null).\n' +
        '   Este dry-run sirve para ver la mecánica (conexión, conteo, formato de salida), NO la calidad real del corte.\n'
    );
  }

  await asegurarBackup();

  const { rows: ideas } = await pool.query('SELECT id, fecha, idea, estado, usuario_id FROM ideas ORDER BY id');
  console.log(
    `${ideas.length} idea(s) encontradas. Modo: ${ejecutar ? 'EJECUTAR (mutando la DB real)' : 'dry-run (solo mostrar, no toca `ideas`)'}.\n`
  );

  let totalPensamientos = 0;
  let totalPartidas = 0;

  for (const fila of ideas) {
    const pensamientos = await segmentarIdeaConGroq(fila.idea);
    totalPensamientos += pensamientos.length;
    if (pensamientos.length > 1) totalPartidas += 1;

    console.log(`[idea #${fila.id}] "${fila.idea}"`);
    pensamientos.forEach((p, i) =>
      console.log(`  -> (${i + 1}/${pensamientos.length}) [${p.etiqueta || 'sin etiqueta'}] ${p.texto}`)
    );

    if (ejecutar) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('DELETE FROM ideas WHERE id = $1', [fila.id]);
        for (const p of pensamientos) {
          await client.query(
            'INSERT INTO ideas (fecha, idea, estado, usuario_id, etiqueta) VALUES ($1, $2, $3, $4, $5)',
            [fila.fecha, p.texto, fila.estado, fila.usuario_id, p.etiqueta]
          );
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`  ERROR migrando idea #${fila.id}, se dejó sin tocar: ${err.message}`);
      } finally {
        client.release();
      }
    }
  }

  const promedio = ideas.length ? (totalPensamientos / ideas.length).toFixed(2) : '0';
  console.log(
    `\nResumen: ${ideas.length} idea(s) originales -> ${totalPensamientos} pensamiento(s) atómico(s) ` +
      `(promedio ${promedio} por idea, ${totalPartidas} idea(s) se partieron en más de un pensamiento).`
  );
  if (!ejecutar) {
    console.log('Dry-run: no se modificó la tabla `ideas`. Corré con --ejecutar para aplicar de verdad.');
  }

  await pool.end();
}

main().catch((err) => {
  console.error('Error fatal en la migración:', err);
  process.exit(1);
});
