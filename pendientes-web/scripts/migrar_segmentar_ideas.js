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
//   node scripts/migrar_segmentar_ideas.js --limit=10    (dry-run, solo las primeras 10)
//   node scripts/migrar_segmentar_ideas.js --ejecutar    (muta la DB real)

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
// 'llama-3.3-70b-versatile' fue deprecado por Groq (confirmado 2026-08-17) --
// ver la misma nota en server.js. reasoning_effort:'low' es obligatorio con
// este modelo o rompe response_format:'json_object'.
const MODELO_IA_SEGMENTACION = 'openai/gpt-oss-120b';
const groqClient = process.env.GROQ_API_KEY ? { apiKey: process.env.GROQ_API_KEY } : null;

const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Rate limit del tier gratis de Groq (12000 TPM) — con 233 ideas seguidas
// sin pausa, la mayoría choca. Groq devuelve en el mensaje de error cuántos
// segundos esperar ("Please try again in 5.18s"); lo parseamos y reintentamos
// en vez de rendirnos al primer 429. MAX_REINTENTOS_429 cubre rachas largas
// sin loopear para siempre.
const MAX_REINTENTOS_429 = 8;

async function llamarGroqConReintento(system, texto) {
  for (let intento = 0; intento <= MAX_REINTENTOS_429; intento++) {
    const respuesta = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${groqClient.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODELO_IA_SEGMENTACION,
        // Subido de 1024 a 4096 -- confirmado con la prueba de 10 ideas
        // reales (2026-08-20) que 1024 no alcanza para bloques largos: Groq
        // cortaba el JSON a la mitad ("Failed to validate JSON") en varias
        // de las ideas de 800+ caracteres.
        max_tokens: 4096,
        reasoning_effort: 'low',
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: texto },
        ],
      }),
    });
    if (respuesta.status === 429 && intento < MAX_REINTENTOS_429) {
      const datos = await respuesta.json().catch(() => ({}));
      const mensaje = (datos.error && datos.error.message) || '';
      const match = mensaje.match(/try again in ([\d.]+)s/i);
      const esperaMs = match ? Math.ceil(parseFloat(match[1]) * 1000) + 300 : 2000 * (intento + 1);
      // console.log (no console.error): iban a stderr mientras el resto del
      // script usa stdout -- al capturar todo junto (2>&1) el orden entre
      // los dos streams no está garantizado y los mensajes salían
      // desordenados respecto al resultado de la idea que los generó
      // (confirmado 2026-08-20, causó ambigüedad real leyendo los logs).
      console.log(`  (rate limit, esperando ${(esperaMs / 1000).toFixed(2)}s y reintentando...)`);
      await esperar(esperaMs);
      continue;
    }
    return respuesta;
  }
}

// Copia de segmentarIdeaConGroq en server.js (misma lógica exacta, incluido
// el reintento) — si se ajusta una, ajustar la otra. Documentado también en
// COORDINACION.md al cerrar esta rama, para que quien mergee lo sepa.
// Etiqueta centinela: nunca la pone Groq (el prompt solo pide temas cortos
// tipo "trabajo"/"salud"), así que sirve para encontrar después, con un
// simple WHERE etiqueta = '_revision_manual', todo lo que Groq NO pudo
// segmentar de verdad -- a diferencia de null, que ahora solo significa
// "el modelo decidió no partirlo" (una decisión real, no una falla).
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
      // JSON válido, pero sin ningún pensamiento aprovechable (respuesta
      // vacía o solo con texto vacío) -- no es una excepción, así que antes
      // caía acá en silencio, indistinguible de "Groq decidió no partirlo".
      console.log('  (Groq devolvió JSON válido pero sin pensamientos aprovechables -- marcada para revisión manual)');
      return requiereRevision;
    }
    return limpios;
  } catch (err) {
    // Cualquier excepción real: red, status no-2xx, o JSON.parse -- estas sí
    // se logueaban antes, pero se deja igual de explícito para que "por qué
    // falló" quede junto al resultado en el mismo stream (ver nota de
    // console.log/console.error en llamarGroqConReintento).
    console.log(`  (error de Groq, marcada para revisión manual: ${err.message})`);
    return requiereRevision;
  }
}

async function asegurarBackup() {
  // Antes: si el backup ya tenía filas, se asumía completo y no se tocaba
  // más. Eso quedó desactualizado -- el backup se pobló una vez (233 filas,
  // prueba del 2026-08-17) y desde entonces se agregaron ideas nuevas (295
  // reales el 2026-08-20) que nunca quedaron respaldadas. Ahora completa lo
  // que falte en vez de asumir que "tiene filas" == "está completo".
  const { rows } = await pool.query(
    'SELECT id FROM ideas WHERE id NOT IN (SELECT id FROM ideas_backup_pre_segmentacion)'
  );
  if (rows.length === 0) {
    console.log('ideas_backup_pre_segmentacion ya cubre todas las ideas actuales — no falta nada.');
    return;
  }
  const { rowCount } = await pool.query(
    `INSERT INTO ideas_backup_pre_segmentacion (id, fecha, idea, estado, usuario_id)
     SELECT id, fecha, idea, estado, usuario_id FROM ideas WHERE id NOT IN (SELECT id FROM ideas_backup_pre_segmentacion)`
  );
  console.log(`Respaldo completado: ${rowCount} fila(s) nueva(s) copiadas a ideas_backup_pre_segmentacion (las que faltaban).`);
}

async function main() {
  const ejecutar = process.argv.includes('--ejecutar');
  const argDesde = process.argv.find((a) => a.startsWith('--desde='));
  const desde = argDesde ? Number(argDesde.split('=')[1]) : null;
  const argLimit = process.argv.find((a) => a.startsWith('--limit='));
  const limit = argLimit ? Number(argLimit.split('=')[1]) : null;
  const argIds = process.argv.find((a) => a.startsWith('--ids='));
  const ids = argIds ? argIds.split('=')[1].split(',').map(Number) : null;

  if (!groqClient) {
    console.log(
      '⚠️  No hay GROQ_API_KEY en .env — cada idea va a caer al fallback (sin segmentar, etiqueta null).\n' +
        '   Este dry-run sirve para ver la mecánica (conexión, conteo, formato de salida), NO la calidad real del corte.\n'
    );
  }

  await asegurarBackup();

  let sql;
  let params;
  if (ids) {
    sql = `SELECT id, fecha, idea, estado, usuario_id FROM ideas WHERE id = ANY($1::int[]) ORDER BY id`;
    params = [ids];
  } else {
    sql = desde ? 'SELECT id, fecha, idea, estado, usuario_id FROM ideas WHERE id >= $1 ORDER BY id' : 'SELECT id, fecha, idea, estado, usuario_id FROM ideas ORDER BY id';
    params = desde ? [desde] : [];
    if (limit) {
      sql += ` LIMIT $${params.length + 1}`;
      params.push(limit);
    }
  }
  const { rows: ideas } = await pool.query(sql, params);
  console.log(
    `${ideas.length} idea(s) encontradas${desde ? ` (retomando desde id >= ${desde})` : ''}${limit ? ` (limitado a ${limit})` : ''}. Modo: ${ejecutar ? 'EJECUTAR (mutando la DB real)' : 'dry-run (solo mostrar, no toca `ideas`)'}.\n`
  );

  let totalPensamientos = 0;
  let totalPartidas = 0;
  const idsRevisionManual = [];

  for (const fila of ideas) {
    const pensamientos = await segmentarIdeaConGroq(fila.idea);
    totalPensamientos += pensamientos.length;
    if (pensamientos.length > 1) totalPartidas += 1;
    if (pensamientos.some((p) => p.etiqueta === ETIQUETA_REVISION_MANUAL)) {
      idsRevisionManual.push(fila.id);
    }

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
  if (idsRevisionManual.length) {
    console.log(
      `⚠️  ${idsRevisionManual.length} idea(s) requieren revisión manual (Groq falló incluso tras reintentar, ` +
        `quedaron con etiqueta '${ETIQUETA_REVISION_MANUAL}', texto original preservado): ` +
        idsRevisionManual.join(', ')
    );
  }
  if (!ejecutar) {
    console.log('Dry-run: no se modificó la tabla `ideas`. Corré con --ejecutar para aplicar de verdad.');
  }

  await pool.end();
}

main().catch((err) => {
  console.error('Error fatal en la migración:', err);
  process.exit(1);
});
