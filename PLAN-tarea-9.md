# Tarea 9 — IA compañera conversacional (RAG + API de Claude) — diseño v2

> **Reemplaza el plan anterior** (aprobado antes, pero cero código llegó a escribirse — confirmado con el agente que iba a implementarlo). El usuario cambió el modelo de negocio de suscripción/premium a **gratis para todos con tope mensual**, y agregó una pieza nueva (perfil acumulado) que no estaba en la v1. Este plan reemplaza al anterior completo para tarea 9. La extensión de la planta (dos ejes de evolución + avatar + export) que el usuario pidió en el mismo mensaje **NO** es parte de este plan — va como bloque separado, después, una vez que este perfil acumulado exista con datos reales (ya documentado en `COORDINACION.md`, sección de tarea 8).

## Contexto

La tarea 9 (IA compañera conversacional, Fase 2) estaba bloqueada hasta que existiera un modelo de ingresos. El usuario primero confirmó suscripción/premium, y ahora — en el mismo día — lo reemplazó por una decisión final distinta: **la conversación con la IA es gratis para todos los usuarios**, con un tope de seguridad mensual (no para cobrar, solo para no gastar sin control). Como ya no hay suscripción de por medio, el costo de esta feature es 100% a cargo del dueño del proyecto — por eso la instrumentación de costo real (tokens × precio, por llamada) sigue siendo un requisito de día 1, ahora para vigilar gasto total en vez de justificar un precio de suscripción.

El enfoque sigue siendo RAG: antes de responder, se recupera del Postgres existente lo que el usuario realmente escribió, se arma el prompt con eso como contexto explícito, y recién ahí se llama a la API de Claude. Se agrega una pieza nueva: un **perfil acumulado** por usuario (resumen breve de patrones, ej. "suele posponer tareas de la mañana"), actualizado periódicamente (no en cada mensaje, sería carísimo) para dar continuidad entre sesiones de chat sin reprocesar todo el historial cada vez.

Modelo: **Claude Haiku 4.5** (ya confirmado antes, sigue vigente — es el más barato, coherente con que el acceso ahora es gratis).

## Contexto verificado en el código actual (sin cambios respecto al plan v1 — sigue siendo la fuente de verdad)

- `server.js` tiene 2672 líneas. `ensureSchema()` va de la línea 566 a 765.
- Chat existente (`GET/POST /chat` 2505–2597, `GET/POST /chat-general` 2605–2664): GET arma un SELECT parametrizado por `usuario_id` y renderiza; POST valida, `INSERT`, y **siempre `res.redirect()`**, nunca JSON.
- Rutas `/ia/*` existentes: `GET /ia` (2139–2186), `POST /ia/nombre` (2188–2200), `POST /ia/comprar` (2205–2240), `POST /ia/usar-comodin` (2247–2278). `observacionesIA()` (1052–1080) es estadística simple hoy.
- `views/ia.ejs:37-45` tiene el placeholder `<section class="ia-construccion">` que esta tarea reemplaza/extiende.
- `views/chat.ejs` es el patrón exacto a clonar para la vista del chat con la IA. CSS de burbujas ya existe en `public/style.css:856-943` — **reusable sin cambios**.
- Patrón de cliente condicional por env var faltante: `googleOAuthClient` en `server.js:28-39`.
- `moneda_transacciones`, `eventos_completado`, `historial_ediciones`: precedente de tabla de auditoría insert-only (`id SERIAL PRIMARY KEY`, FK a `usuarios(id)`, columna timestamp `DEFAULT now()`, snake_case).
- `GET /exportar` (1877-1915): patrón exacto de recuperación multi-tabla. `GET /estadisticas` (1434-1481): patrón de `Promise.all` con queries paralelas.
- `package.json` **ya tiene `@anthropic-ai/sdk`** — el agente que iba a implementar la v1 llegó a instalarlo (`npm install` corrido, `package.json`/`package-lock.json` modificados sin comitear en el worktree `rama-ia-companera-fase2`). Reusar eso, no reinstalar.
- Middleware de sesión (107-117) ya expone `req.usuarioId` en todas las rutas protegidas — con eso alcanza para el gating (que ahora es "estar logueado", nada más).

## Qué cambia respecto al plan v1 (resumen)

| | v1 (descartado) | v2 (este plan) |
|---|---|---|
| Acceso | Solo `es_premium = TRUE` | **Todos los usuarios logueados** |
| Columna nueva en `usuarios` | `es_premium` | **Ninguna** |
| Límite | 40 mensajes/día | **40 mensajes/MES** |
| Perfil acumulado | No existía | **Tabla nueva `perfil_ia`, actualizada cada 15 mensajes** |
| `ia_llamadas` | Sin distinguir tipo de llamada | **+ columna `motivo` (`'chat'` / `'perfil'`)** |
| Modelo | Haiku 4.5 | Haiku 4.5 (sin cambios) |

## Modelo de datos

**Sin columna `es_premium`.** Cualquier usuario con sesión activa tiene acceso — no hace falta tocar el esquema de `usuarios` para gating.

**Tabla `mensajes_ia`** (sin cambios respecto a v1 — sigue siendo necesaria, NO reusar `mensajes`/`mensajes_generales`, mismo razonamiento que antes: esas tablas exigen `amistad_id` o un `autor_id` real en `usuarios`, y la IA no es una fila de `usuarios`):
```js
await pool.query(`
  CREATE TABLE IF NOT EXISTS mensajes_ia (
    id SERIAL PRIMARY KEY,
    usuario_id INT REFERENCES usuarios(id),
    rol TEXT NOT NULL CHECK (rol IN ('usuario', 'ia')),
    texto TEXT NOT NULL,
    fecha TIMESTAMP DEFAULT now()
  )
`);
await pool.query(`
  CREATE INDEX IF NOT EXISTS idx_mensajes_ia_usuario_fecha ON mensajes_ia (usuario_id, fecha)
`);
```

**Tabla nueva `perfil_ia`** (el perfil acumulado — una fila por usuario, se actualiza con `UPDATE`/upsert, no se acumula historial de versiones porque no hace falta todavía):
```js
await pool.query(`
  CREATE TABLE IF NOT EXISTS perfil_ia (
    usuario_id INT PRIMARY KEY REFERENCES usuarios(id),
    resumen TEXT NOT NULL DEFAULT '',
    mensajes_en_resumen INT NOT NULL DEFAULT 0,
    actualizado TIMESTAMP DEFAULT now()
  )
`);
```
`usuario_id` como PK (no `id SERIAL`): es una relación 1:1 con `usuarios`, no hace falta historial — simplifica el upsert (`INSERT ... ON CONFLICT (usuario_id) DO UPDATE ...`). `mensajes_en_resumen` guarda cuántos mensajes de `mensajes_ia` ya se incorporaron al resumen, para saber cuándo toca la próxima actualización (ver sección siguiente). `resumen` arranca vacío (`''`) — un usuario nuevo sin historial todavía no tiene perfil, y el prompt debe manejar ese caso (sección vacía, sin mencionar "no tengo información" de forma rara).

**Tabla `ia_llamadas`** (mismo esquema que v1, **+1 columna nueva `motivo`** para distinguir llamadas de chat vs. de actualización de perfil — mismo criterio de nomenclatura que `moneda_transacciones.origen`):
```js
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
    fecha TIMESTAMP DEFAULT now()
  )
`);
```

Las 3 sentencias (mensajes_ia, perfil_ia, ia_llamadas) van en `ensureSchema()`, antes del `}` de cierre en la línea 765.

## Límite mensual

**40 mensajes/usuario/mes** (dentro del rango 30-50 que pidió el usuario — elegido igual al límite diario de la v1 porque ya estaba razonado y es un número redondo fácil de comunicar en la UI; ya quedó documentado así en `COORDINACION.md`). Reseteo por mes calendario `America/Lima`:
```js
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
```
Al alcanzarlo: `redirect('/ia/chat?error=limite_mensual')`, **antes** de llamar a la API — el mensaje en la UI debe ser neutral, sin mencionar pago ("Alcanzaste el límite de 40 mensajes este mes — volvé a hablar el mes que viene."). Constante `LIMITE_MENSAJES_IA_POR_MES = 40` cerca de `MODELO_IA_CHAT`.

## Perfil acumulado — diseño del disparador de actualización

**Disparador: contador de mensajes nuevos, no cron.** Después de guardar cada mensaje del usuario en `mensajes_ia`, comparar el total de mensajes del usuario contra `perfil_ia.mensajes_en_resumen`; si la diferencia llega a **15**, disparar una actualización de perfil (síncrona, dentro de la misma request de `POST /ia/chat`, después de responder el chat normal — no bloquea la respuesta al usuario si se hace después de armar la respuesta, pero si se quiere más simple para la primera versión, puede ir antes del `redirect` final, aceptando que esa request tarde un poco más).

**Por qué contador y no cron diario/semanal:** más simple (no agrega un `node-cron` nuevo ni una tarea en background separada), y se ajusta al uso real — un usuario que casi no usa el chat no gasta en actualizaciones de perfil que nadie va a leer, mientras que un usuario activo lo actualiza naturalmente más seguido. `UMBRAL_ACTUALIZAR_PERFIL = 15`: con el tope de 40 mensajes/mes, un usuario que agota el límite dispara ~2-3 actualizaciones de perfil al mes — suficiente para que el perfil no quede desactualizado, sin ser una llamada extra por cada mensaje.

**`async function actualizarPerfilIaSiCorresponde(usuarioId)`** (cerca de `construirContextoIA`):
1. Contar mensajes de `rol='usuario'` totales para el usuario, comparar con `perfil_ia.mensajes_en_resumen` (si no hay fila, tratar como 0).
2. Si la diferencia < 15, no hacer nada (return).
3. Si ≥ 15: traer los últimos ~30 mensajes (usuario + ia intercalados) de `mensajes_ia`, armar un prompt de resumen aparte (system corto: *"Resumí en 2-3 oraciones los patrones de comportamiento que notás en esta conversación — hábitos, horarios, temas recurrentes. Sé concreto y breve, en español."*), llamar a `anthropicClient.messages.create` con `max_tokens: 200` (mucho menor que el chat normal, es solo un resumen corto).
4. `INSERT INTO ia_llamadas` con `motivo='perfil'`, igual que la llamada de chat.
5. `UPSERT` en `perfil_ia`: `INSERT INTO perfil_ia (usuario_id, resumen, mensajes_en_resumen) VALUES ($1,$2,$3) ON CONFLICT (usuario_id) DO UPDATE SET resumen=$2, mensajes_en_resumen=$3, actualizado=now()`.
6. Si esta llamada falla, **no** debe romper la respuesta del chat normal — loguear el error (incluido en `ia_llamadas` con `error` seteado) y seguir; el perfil simplemente no se actualiza esta vez, se reintenta la próxima vez que se cruce el umbral.

## Función de recuperación (RAG) — igual que v1, + perfil

`async function construirContextoIA(usuarioId)`, mismas queries que v1 (pendientes activos, completados recientes, ideas, recordatorios, hechos, reflexiones — todas parametrizadas por `usuario_id`, en paralelo con `Promise.all`, reusando el patrón de `/exportar`/`/estadisticas`), **más una sección nueva con `perfil_ia.resumen`** si existe y no está vacío:

```
Sos la IA compañera de un usuario en una app de organización personal...
[igual que v1]

## Lo que ya sabemos de vos
{perfil_ia.resumen}
(si no hay perfil todavía, esta sección se omite por completo — no decir
"no tengo información sobre vos", simplemente no incluir el encabezado)

## Pendientes activos
...
[resto igual que v1: completados, ideas, recordatorios, hechos, reflexiones,
observaciones, identidad]
```

Historial de conversación: últimos ~10 turnos de `mensajes_ia`, igual que v1.

## Diseño del endpoint

**Cliente condicional** — igual que v1 (`server.js:28-39`, mismo patrón que `googleOAuthClient`).

**`GET /ia/chat`** (después de la línea 2278, junto a las demás `/ia/*`):
1. **Sin chequeo de premium** — solo requiere sesión (ya garantizado por el middleware global).
2. `SELECT id, rol, texto, fecha FROM mensajes_ia WHERE usuario_id=$1 ORDER BY fecha ASC LIMIT 200`, contar mensajes de este mes, render con `mensajes`, `restantesEsteMes`, `limiteMensual`, `error: req.query.error || null`.

**`POST /ia/chat`**:
1. Validar `texto` no vacío, recortar a ~2000 caracteres.
2. `anthropicClient` null → 500 "IA conversacional no configurada (falta ANTHROPIC_API_KEY)."
3. Límite mensual alcanzado → `redirect('/ia/chat?error=limite_mensual')` **antes** de llamar a la API.
4. `INSERT` mensaje del usuario primero.
5. `construirContextoIA` + armar `messages`, llamar `anthropicClient.messages.create({ model: MODELO_IA_CHAT, max_tokens: 1024, system, messages })`, midiendo latencia.
6. Éxito → `INSERT` mensaje `rol='ia'`, `INSERT INTO ia_llamadas` con `motivo='chat'` y costo real de `response.usage`.
7. Después de guardar la respuesta (éxito), llamar `actualizarPerfilIaSiCorresponde(usuarioId)` — sin bloquear la respuesta al usuario si falla (try/catch propio, no debe tirar la request completa).
8. Falla en la llamada de chat → `INSERT INTO ia_llamadas` con `motivo='chat'`, tokens/costo en 0, `error=err.message` (recortado ~500 chars), `redirect('/ia/chat?error=ia_no_disponible')`. Excepciones tipadas del SDK (`Anthropic.RateLimitError`, `Anthropic.APIConnectionError`, `Anthropic.APIStatusError`).
9. Éxito final → `redirect('/ia/chat')`.

**Costo por llamada** (igual que v1, precios de Haiku 4.5):
```js
const PRECIO_IA_ENTRADA_POR_MTOK = 1.00; // USD
const PRECIO_IA_SALIDA_POR_MTOK = 5.00;
function calcularCostoIaUsd(usage) {
  return (usage.input_tokens / 1e6) * PRECIO_IA_ENTRADA_POR_MTOK
       + (usage.output_tokens / 1e6) * PRECIO_IA_SALIDA_POR_MTOK;
}
```
Reusada tanto para las llamadas de chat como las de perfil (mismo cálculo, el `motivo` en `ia_llamadas` es lo que las distingue después).

## Diseño de la vista

**`views/ia-chat.ejs`** (nueva) — clon de `views/chat.ejs`, igual que v1, con dos cambios de texto: "Te quedan N de 40 mensajes este mes" (no "hoy"), y sin ningún bloque de "función premium" (ya no existe esa restricción) — si hay `error=limite_mensual`, mostrar el mensaje neutral sin mención de pago.

**`views/ia.ejs`:** reemplazar `<section class="ia-construccion">` (37-45) por un botón "Hablar con {nombreIa}" → `/ia/chat`, visible para cualquier usuario (sin condicional de premium).

**`GET /ia` (2139-2186):** **sin cambios** en el `SELECT` (ya no hace falta traer `es_premium`).

**Nav:** no se toca — mismo criterio que `/chat` hoy, se llega desde el botón en `/ia`.

## Costo estimado (ahora es 100% costo directo, sin ingreso de suscripción que lo compense — por eso importa más el TOTAL, no solo el costo por usuario)

**Costo por mensaje de chat** (contexto ligeramente más grande que v1 por la sección de perfil, ~1,900 tokens entrada / 200 salida): `(1900/1e6)×$1.00 + (200/1e6)×$5.00 ≈ $0.0029`.

**Costo por actualización de perfil** (~1,350 tokens entrada, ~80 salida): `(1350/1e6)×$1.00 + (80/1e6)×$5.00 ≈ $0.0018`.

**Por usuario que agota el límite mensual** (40 mensajes + ~2-3 actualizaciones de perfil, por el umbral de 15): `40×$0.0029 + 2.5×$0.0018 ≈ $0.116 + $0.0045 ≈ $0.12/mes`.

**Por usuario de uso moderado** (8 mensajes/mes, no llega a disparar actualización de perfil): `8×$0.0029 ≈ $0.023/mes`.

**Total mensual estimado, según cuántos usuarios activos usen la IA seguido:**

| Usuarios activos en el chat | Costo total/mes (uso moderado) | Costo total/mes (todos agotan el límite) |
|---|---|---|
| 5 | ~$0.12 | ~$0.60 |
| 20 | ~$0.46 | ~$2.40 |
| 50 | ~$1.15 | ~$6.00 |

Estos números excluyen infraestructura y son una estimación de diseño — la sesión que implemente debe recalcularlos con datos reales de `ia_llamadas` tras un piloto corto y dejarlo anotado en `COORDINACION.md`. Como ya no hay suscripción que lo compense, esto es directamente presupuesto del dueño del proyecto — vale la pena que revise `ia_llamadas` periódicamente (aunque sea con una query manual, no hace falta un dashboard) para confirmar que el gasto real se mantiene en este orden de magnitud.

## Alerta de gasto mensual (agregado 2026-08-13, pedido explícito del usuario)

**Objetivo:** no depender de que alguien se acuerde de revisar `ia_llamadas` a mano a medida que crecen los usuarios — un aviso visible cuando el gasto acumulado del mes (chat + perfil, todos los usuarios) cruza un umbral. **Nunca bloquea el servicio** — es puramente informativo.

**Umbral: `UMBRAL_ALERTA_GASTO_IA_USD = 20`** (dentro del rango $15-20 que dio el usuario, elegido en el extremo superior porque da más margen antes de la primera alerta y sigue siendo bajísimo comparado con cualquier escenario de la tabla de costo de arriba — incluso 50 usuarios agotando el límite todos los meses da ~$6/mes, muy por debajo de $20; cruzar el umbral señala algo fuera de lo esperado — mucho más uso del previsto, o un bug de costo real — no crecimiento orgánico normal).

**Función `async function obtenerGastoIaEsteMes()`** (sin `usuario_id`, es un total global — cerca de `contarMensajesIaEsteMes`):
```js
async function obtenerGastoIaEsteMes() {
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(costo_usd), 0)::numeric AS total FROM ia_llamadas
     WHERE date_trunc('month', fecha AT TIME ZONE 'America/Lima')
       = date_trunc('month', now() AT TIME ZONE 'America/Lima')`
  );
  return Number(rows[0].total);
}
```

**Dónde se chequea y se loguea:** en `POST /ia/chat`, después de cada `INSERT INTO ia_llamadas` exitoso (tanto de chat como de perfil), llamar `obtenerGastoIaEsteMes()` y, si el total ≥ `UMBRAL_ALERTA_GASTO_IA_USD`, `console.warn` con un mensaje claro (ej. `⚠️ Gasto de IA este mes: $X.XX (umbral de aviso: $20.00)`). Se chequea en cada request que agrega costo, sin deduplicar — es una sola query de agregación, barata, y en una app de este tamaño no genera spam de log real; si en el futuro se vuelve ruidoso, ajustar ahí (no ahora, no hace falta la complejidad de un flag "ya avisado este mes" desde el arranque).

**Dónde se ve sin tener que mirar logs — banner en `/ajustes`, SOLO para el dueño del proyecto:** el proyecto no tiene ningún concepto de rol/admin (confirmado — no existe una columna ni tabla de roles); el precedente ya establecido en este mismo proyecto para "solo el dueño" es comparación directa contra `req.session.nombre_usuario === 'bruce'` (mismo patrón ya usado para restringir `POST /notificar-prueba`, ver `COORDINACION.md`). En `GET /ajustes` (existe ya en `server.js`, buscar la ruta con `grep -n "app.get('/ajustes'"`): si `req.session.nombre_usuario === 'bruce'`, además de lo que ya carga esa ruta, llamar `obtenerGastoIaEsteMes()` y pasar `gastoIaEsteMes`/`alertaGastoIa` (booleano, `total >= UMBRAL_ALERTA_GASTO_IA_USD`) a la vista — para cualquier otro usuario, no se corre esa query extra (evita el costo de la agregación en cada visita a `/ajustes` de usuarios que no son el dueño).

En `views/ajustes.ejs`: si `alertaGastoIa`, mostrar un banner simple arriba de la página (mismo estilo visual que `.aviso-asignacion`/`.error` ya usados en otras vistas, con `--warning`): *"⚠️ Gasto de IA este mes: $X.XX (umbral de aviso: $20.00) — revisá `ia_llamadas` si esperabas menos."*

**Archivos adicionales a tocar por esta sección** (sumar a la tabla "Archivos a tocar/crear" de más abajo): `views/ajustes.ejs` (banner condicional), y la ruta `GET /ajustes` existente en `server.js` (agregar el chequeo condicional a `bruce`).

## Qué NO se construye en esta tarea

Igual que v1: sin base de datos vectorial, sin streaming (SSE), sin prompt caching todavía, sin tool use/multi-agente/MCP, sin rate limit distribuido (el límite mensual vive en Postgres, no en memoria). **Además, en esta v2:** sin pago/suscripción de ningún tipo (ya no aplica), sin panel de administración para ajustar el límite mensual o el umbral de actualización de perfil (quedan como constantes en código por ahora). La parte visual de "planta con dos ejes + avatar + export" (ya documentada en `COORDINACION.md`, extensión de tarea 8) **tampoco es parte de esta tarea** — depende de que este perfil acumulado tenga datos reales, se despacha después, como bloque separado.

## Archivos a tocar/crear

| Archivo | Cambio |
|---|---|
| `pendientes-web/package.json` | `@anthropic-ai/sdk` — **ya agregado** en el worktree, no repetir |
| `pendientes-web/.env.example` | `ANTHROPIC_API_KEY` con bloque de comentario (formato del bloque Google Calendar) |
| `pendientes-web/server.js` | `require` + cliente condicional (~32-39); constantes `MODELO_IA_CHAT`/`LIMITE_MENSAJES_IA_POR_MES`/`UMBRAL_ACTUALIZAR_PERFIL`/precios (~995-1007); 3 sentencias nuevas en `ensureSchema()` (antes de 765, **sin** `es_premium`); `construirContextoIA`/`contarMensajesIaEsteMes`/`calcularCostoIaUsd`/`actualizarPerfilIaSiCorresponde` (~1080); rutas `GET/POST /ia/chat` (después de 2278) |
| `pendientes-web/views/ia-chat.ejs` | **Nuevo** — clon de `chat.ejs`, sin bloque de premium |
| `pendientes-web/views/ia.ejs` | Reemplazar sección `ia-construccion` (37-45) por botón de acceso directo, sin condicional de premium |
| `pendientes-web/server.js` (`GET /ajustes`) | Agregar `obtenerGastoIaEsteMes()` condicional a `nombre_usuario === 'bruce'`, pasar `gastoIaEsteMes`/`alertaGastoIa` a la vista |
| `pendientes-web/views/ajustes.ejs` | Banner condicional de alerta de gasto (solo visible si `alertaGastoIa`) |
| `COORDINACION.md` | Ya tiene el diseño documentado (commit `75cdaf1`) — actualizar con el hash de implementación y costo real tras probar |

**No se toca:** `views/partials/nav.ejs`, `public/style.css`, `views/chat.ejs`/`views/chat-general.ejs`, ninguna columna de `usuarios` (a diferencia de v1, que agregaba `es_premium`).

## Orden sugerido de implementación

1. `ANTHROPIC_API_KEY` en `.env`/`.env.example` (el `npm install` de `@anthropic-ai/sdk` ya está hecho en el worktree).
2. Esquema en `ensureSchema()` (3 tablas, sin `es_premium`).
3. Backend: cliente condicional, constantes, `construirContextoIA`, `contarMensajesIaEsteMes`, `calcularCostoIaUsd`, `actualizarPerfilIaSiCorresponde`.
4. Rutas `GET/POST /ia/chat` con manejo de errores tipado y el disparo de actualización de perfil después de cada respuesta exitosa.
5. Vista `ia-chat.ejs` + cambios en `ia.ejs`.
6. Probar contra la DB real: chat funciona para cualquier usuario (sin gating), sin `ANTHROPIC_API_KEY` da 500, límite mensual bloquea en el mensaje 41, el perfil se actualiza al cruzar 15 mensajes nuevos (verificar `perfil_ia.resumen` no vacío y `ia_llamadas` con una fila `motivo='perfil'`), y que el resumen del perfil aparece efectivamente en el contexto de mensajes posteriores.
7. Recalcular la sección de costo con datos reales de `ia_llamadas` (separando `motivo='chat'` de `motivo='perfil'`).
8. Actualizar `COORDINACION.md` con el hash de implementación y el costo real medido.

## Verificación end-to-end

Con `.env` disponible (incluida una `ANTHROPIC_API_KEY` real) y servidor local corriendo:
1. `node --check server.js` limpio, `npm run ci` sin errores en las plantillas nuevas/tocadas.
2. Usuario de prueba descartable, sin ninguna bandera especial → `GET /ia/chat` funciona directo (sin bloqueo).
3. `POST /ia/chat` con una pregunta sobre pendientes/ideas reales creados para ese usuario → confirmar que la respuesta los menciona correctamente (no inventa nada) — verificar en `ia_llamadas` una fila `motivo='chat'` con tokens/costo/latencia reales.
4. Enviar 15 mensajes seguidos → confirmar que se disparó una actualización de perfil: `perfil_ia.resumen` no vacío, `perfil_ia.mensajes_en_resumen = 15`, una fila nueva en `ia_llamadas` con `motivo='perfil'`. Enviar un mensaje más y confirmar (leyendo el `system` armado, ej. con un log temporal) que el resumen del perfil aparece en el contexto.
5. Confirmar que el mensaje del usuario se guarda en `mensajes_ia` aunque la llamada a Anthropic falle (simular con una key inválida temporalmente) — no debe perderse, y que una falla en `actualizarPerfilIaSiCorresponde` no rompe la respuesta del chat normal.
6. Simular (manipulando `mensajes_ia` directo o enviando 40 reales) que se llega al mensaje 41 del mes → debe redirigir con `?error=limite_mensual` sin llamar a la API, y el texto no debe mencionar pago.
7. Confirmar que sin `ANTHROPIC_API_KEY` en el entorno, `anthropicClient` es `null` y la ruta responde 500 con el mensaje de configuración faltante, sin crashear el servidor.
8. Limpieza completa de usuarios/mensajes/perfiles de prueba al terminar.
