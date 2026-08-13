
# Coordinación entre ramas — pendientes-web

## Reglas para cualquier sesión de Claude Code que trabaje aquí

1. Al empezar, lee este archivo completo antes de tocar código.
2. Trabaja SOLO en tu rama asignada, y hazlo en tu propio **worktree** (carpeta
   aparte), NUNCA con `git checkout` directo en `C:\Users\lenovo\Desktop\a`
   — esa carpeta la comparten todas las sesiones a la vez, y cambiarle la
   rama ahí se la cambia a todas las demás sin avisar (nos pasó varias veces
   en esta misma sesión). Desde `C:\Users\lenovo\Desktop\a`, crea tu worktree
   con:
   ```
   git worktree add "C:\Users\lenovo\Desktop\a-worktrees\rama-<feature>" -b rama-<feature> origin/main
   ```
   Eso te deja una carpeta propia (`C:\Users\lenovo\Desktop\a-worktrees\rama-<feature>`)
   ya parada en tu rama, sin tocar el checkout de nadie más. Trabaja siempre
   desde ahí (`cd` a esa carpeta antes de cualquier otro comando).
3. Antes de modificar `server.js`, revisa la sección "Estado de ramas" abajo — si otra rama
   ya está tocando el mismo archivo/función, escribe aquí qué vas a tocar tú también para
   anticipar conflictos.
4. Al terminar tu sesión (o una tarea importante), actualiza tu propia sección con:
   - Qué hiciste
   - Qué archivos tocaste
   - Si comiteaste o no (y el hash del commit)
   - Pendientes o huecos conocidos
5. NUNCA hagas merge a main sin que la rama-integracion lo confirme aquí.
6. Si detectas un hueco de seguridad o bug en OTRA rama, documéntalo en su sección,
   no lo arregles tú mismo salvo que el usuario lo autorice explícitamente.
7. No borres el historial de otras ramas en este archivo. Solo agrega o actualiza tu sección.
8. **[Agregada 2026-08-13, tras un incidente real] Antes de combinar ramas y llevarlas a
   producción, mostrá el diff completo resultante y esperá un "aprobado" explícito del
   usuario.** Esto aplica a CUALQUIER forma de combinar código de más de una rama —
   `git merge`, `git cherry-pick`, o reconstrucción manual con la herramienta de edición
   (la receta de abajo) — antes de que ese resultado se pushee y/o se mergee a `main`.
   Concretamente:
   - Después de combinar (y antes de pushear/mergear), mostrale al usuario el diff real
     y completo contra el punto de partida (`git diff <base>..HEAD`), no un resumen en
     prosa de "qué se combinó". Si el diff es muy largo, mostralo en partes, pero mostralo
     — no lo reemplaces por una descripción.
   - Esperá una respuesta que diga explícitamente **"aprobado"** (o equivalente inequívoco
     y específico a ESE diff) antes de pushear o mergear.
   - **Una instrucción general dada ANTES de ver el diff — como "mergea", "constrúyelo
     sobre todo lo pendiente", o similar — NO cuenta como esa aprobación**, aunque haya
     sido dicha con la intención de autorizar el trabajo. La aprobación tiene que venir
     DESPUÉS de mostrar el diff completo, sobre ese diff específico.
   - Esto aplica en cadena: si combinás rama A y B, mostrás el diff y te aprueban, y
     DESPUÉS agregás una rama C encima, hace falta un nuevo diff + nueva aprobación antes
     de pushear/mergear esa versión ampliada — la aprobación de A+B no cubre A+B+C.
   - Por qué existe esta regla: una sesión combinó 5 ramas (incluida una — "chat general" —
     que el usuario había pedido agregar al backlog y construir, pero nunca vio como diff
     antes de que se mergeara) usando `git cherry-pick` (no bloqueado por
     `.claude/settings.json`, a diferencia de `git merge`/`rebase`) sin pedir esta
     confirmación puntual, interpretando una instrucción general anterior como suficiente.
     El usuario no había visto el resultado combinado antes de que llegara a `main`.

## Estado de ramas

### rama-chat
- Estado: commit hecho, lista para merge
- Archivos tocados: server.js (tabla mensajes, tabla amistades, helper usuarioPerteneceAmistad, rutas GET /chat y POST /mensajes), views/chat.ejs (nuevo)
- Último commit: 90f06ad
- Pendientes/notas: se cerró un hueco de seguridad IDOR — ambas rutas ahora verifican
  que el usuario logueado pertenezca a la amistad_id antes de leer/escribir mensajes.
  Probado: bloquea con 403 sin membresía, permite con membresía real.
- Nota para el merge: si en el futuro existe rama-amigos y también crea la tabla
  `amistades` con más columnas (estado de solicitud, fecha, etc.), quedarse con la
  versión más completa y ajustar el helper `usuarioPerteneceAmistad` a los nombres
  de columna finales.

### rama-visual
- Estado: commiteada
- Archivos tocados: public/style.css, public/manifest.json, views/index.ejs (script inline de transiciones), views/partials/head.ejs
- Último commit: 6e3328f
- Pendientes/notas: tema oscuro con variables CSS, botones más grandes, animación de
  check verde al completar y resalte ámbar al posponer, respeta prefers-reduced-motion.
  No tocó server.js ni lógica de sesión/login/usuarios.

### rama-amigos (entrada histórica — ver sección completa más abajo)
- Ver "rama-amigos (reconstruida como rama-amigos-integrada)" más abajo:
  ya se creó, se implementó y se mergeó a main.

### rama-fix-login-mayusculas
- Estado: ✅ MERGEADA a main (commit de merge 780bd7f, desplegado y verificado
  en producción). HOTFIX urgente, reportado por el usuario en vivo (no podía
  entrar como "Bruce" en producción).
- Tarea: el login comparaba `nombre_usuario` sensible a mayúsculas/minúsculas.
  El teclado del celular autocapitaliza la primera letra del campo, así que
  cualquier usuario que loguee desde el celular con autocapitalización activada
  (el caso normal) fallaría al loguearse aunque su usuario y PIN sean correctos.
  Confirmado contra la DB real: usuario "bruce"/PIN "2006" coincidía
  perfectamente, pero "Bruce" (con B mayúscula) fallaba.
- Fix: en `/login`, `nombreUsuario` ahora se normaliza con `.toLowerCase()`
  antes de la consulta y de guardar en la sesión. Se verificó que no rompe a
  ningún usuario existente (solo hay 1 usuario en la DB real, "bruce", ya en
  minúsculas). También se agregó `autocapitalize="none" autocorrect="off"
  spellcheck="false" autocomplete="username"` al input de usuario en
  `login.ejs` para que el teclado del celular deje de autocapitalizar.
- Archivos tocados: server.js (ruta POST /login), views/login.ejs.
- Creada desde origin/main. Nota para quien mergee rama-registro después: esa
  rama también debería normalizar a minúsculas en /registro (y en
  /amigos/solicitar de rama-amigos) para mantener la consistencia — no se tocó
  ninguna de esas dos ramas desde aquí para no invadir su alcance.
- Qué se verificó: contra la DB real de Railway, servidor local, login con
  "Bruce", "BRUCE", "bruce", "BrUcE" y PIN 2006 → los 4 dan 302 (login exitoso).
- Pide confirmación al usuario antes de mergear a main (el merge está bloqueado
  por permisos del proyecto de todas formas).

### rama-notificaciones (reconstruida como rama-notificaciones-integrada)
- Estado: ✅ MERGEADA a main como rama-notificaciones-integrada (PR #3,
  commit de merge b06b36e). PR #2, el original, se cerró sin mergear.
- Tarea: notificaciones/marcar como leído en el chat (usar la columna `leido`
  ya existente en la tabla `mensajes`). Trabajo original hecho en
  `rama-notificaciones` (commits 05758c1, 1ed64b9, 2001c94) por otra sesión,
  con prueba end-to-end completa contra la DB real ya documentada ahí.
- Por qué existe esta rama con otro nombre: al abrir el PR de
  `rama-notificaciones` contra `main`, GitHub lo marcó como CONFLICTING.
  El conflicto real era solo en `COORDINACION.md`: tanto esta rama como
  `rama-fix-login-mayusculas` agregan su propia sección nueva justo antes de
  "### rama-integracion" — dos inserciones distintas en el mismo punto del
  archivo, algo que un merge de 3 vías basado en líneas no puede resolver
  solo aunque el contenido final no sea realmente incompatible. Se confirmó
  con una simulación de merge de 3 vías (`diff3`) fuera de git que el único
  archivo con conflicto real era `COORDINACION.md`; `server.js`, `chat.ejs`,
  `style.css` y `login.ejs` mergeaban limpio. Como este proyecto tiene
  bloqueado `git merge`/`git checkout main` por permisos (a propósito, ver
  `.claude/settings.json`), no había forma de resolver el conflicto con un
  merge de git local. Se optó por crear esta rama nueva directamente desde
  `origin/main` actualizado y reaplicar a mano los mismos cambios de código
  de `rama-notificaciones` (verificados línea por línea contra el diff
  original), en vez de forzar un permiso nuevo.
- Archivos tocados (idénticos a rama-notificaciones original): server.js
  (GET /chat marca como leídos los mensajes del otro usuario, nueva ruta
  GET /notificaciones), views/chat.ejs (banner de no leídos, indicador
  ✓/✓✓), public/style.css (clases .notificacion, .no-leido, .visto).
- Qué se verificó: `node --check server.js` sin errores. Prueba end-to-end
  repetida contra la DB real de Railway con 2 usuarios de prueba nuevos: 3
  mensajes de A a B → `GET /notificaciones` de B da `{"noLeidos":3}` → B abre
  el chat → aparece el banner "sin leer" y el indicador ✓✓ NO aparece para B
  (son mensajes ajenos) → `GET /notificaciones` de B baja a `{"noLeidos":0}`
  → confirmado en DB que los 3 mensajes quedaron `leido=true` → A ve sus
  propios mensajes con ✓✓. Usuarios/mensajes/amistad de prueba borrados al
  terminar.
- rama-notificaciones (la original) queda sin mergear — su contenido ya vive
  en esta rama nueva. No se borró el branch remoto por si el usuario quiere
  revisarlo, pero no hace falta abrir PR desde ahí.

### rama-registro (reconstruida como rama-registro-integrada)
- Estado: ✅ MERGEADA a main como rama-registro-integrada (PR #5, commit de
  merge 6e3dd8b). PR #4, el original, se cerró sin mergear.
- Tarea: registro público de usuarios (`/registro`) + rate limiting en
  `/login` y `/registro`. Trabajo original hecho en `rama-registro`
  (commits a64d1fd, f5e0235, f903792).
- Por qué existe esta rama con otro nombre: mismo motivo que
  rama-notificaciones-integrada — el PR de `rama-registro` contra `main`
  quedó CONFLICTING. A diferencia de esa vez, aquí SÍ había un conflicto de
  código real (confirmado con `diff3` fuera de git, no solo el de
  COORDINACION.md): tanto el hotfix de `/login` (main) como esta rama
  modificaban la misma línea de `app.post('/login', ...)` — main le agregó
  `.toLowerCase()`, esta rama le agregó el middleware `limitarIntentos('login')`.
  Se resolvió a mano combinando ambos:
  `app.post('/login', limitarIntentos('login'), async (req, res) => { const nombreUsuario = (...).trim().toLowerCase();`.
  El resto de los archivos (registro.ejs nuevo, login.ejs con el link) no
  tenían conflicto real.
- Archivos tocados (igual que rama-registro original, más la línea de
  /login combinada): server.js, views/registro.ejs (nuevo), views/login.ejs.
- Qué se verificó contra la DB real de Railway: login existente
  ("Bruce"/2006, ya con el hotfix de mayúsculas) sigue funcionando → 302;
  registro de un usuario nuevo con mayúscula inicial → 302; login
  inmediatamente después con ese mismo usuario en minúscula → 302. Usuario
  de prueba borrado al terminar.
- rama-registro (la original) queda sin mergear — su contenido ya vive en
  esta rama nueva.

### rama-amigos (reconstruida como rama-amigos-integrada)
- Estado: ✅ MERGEADA a main como rama-amigos-integrada (PR #6, commit de
  merge 10c9a7e) — la última de las tres ramas pendientes, ya integrada con
  rama-notificaciones y rama-registro en main.
- Tarea: sistema de amigos — agregar amigo, aceptar/rechazar solicitud,
  listar amigos. Trabajo original en `rama-amigos` (commits 125507f,
  d8ee391, 57b08fd, 8653d66, a1aba4b).
- Por qué existe esta rama con otro nombre: mismo motivo que las dos
  anteriores — el PR contra `main` quedaba CONFLICTING solo por
  `COORDINACION.md` (confirmado con `diff3` fuera de git: `server.js`,
  `login.ejs` y `nav.ejs` mergeaban limpio, sin conflicto real de código).
- Antes de aplicar el `ALTER TABLE amistades ADD COLUMN estado ... DEFAULT
  'pendiente'` + el filtro `estado = 'aceptada'` en `usuarioPerteneceAmistad`,
  se verificó contra la DB real que la tabla `amistades` está vacía (0 filas)
  — así que este cambio de esquema no puede romper ningún chat existente al
  aplicarse en producción.
- Archivos tocados (idénticos a rama-amigos original): server.js (ALTER
  TABLE amistades, filtro estado='aceptada' en usuarioPerteneceAmistad,
  rutas /amigos, /amigos/solicitar, /amigos/:id/aceptar,
  /amigos/:id/rechazar), views/amigos.ejs (nuevo), views/partials/nav.ejs
  (link a /amigos).
- Qué se verificó contra la DB real de Railway (usuarios de prueba nuevos,
  creados y borrados en el script): A solicita amistad a B escribiendo su
  usuario en MAYÚSCULA (prueba la normalización a minúsculas) → 302; chat
  antes de aceptar → 403; B acepta → 302; chat después de aceptar → 200; A
  manda un mensaje → 302; `GET /notificaciones` de B (ruta de
  rama-notificaciones, ya en main) detecta el mensaje nuevo →
  `{"noLeidos":1}`, confirma que ambas features quedaron bien integradas; A
  ve a B en "Mis amigos". Limpieza completa al terminar.
- rama-amigos (la original) queda sin mergear — su contenido ya vive en
  esta rama nueva.

### rama-tema-chat
- Estado: ✅ MERGEADA a main vía PR #8 (commit de merge e694dee).
- Tarea: aplicar tema visual oscuro a views/chat.ejs (último ítem del
  backlog original). Antes, chat.ejs no tenía ningún estilo propio más
  allá de lo agregado por rama-notificaciones (.notificacion, .no-leido,
  .visto) — la lista de mensajes se veía como un `<ul>` sin estilo.
- Cambios: burbujas de chat en `public/style.css` (`.chat-mensajes`,
  reutilizando las variables de color ya existentes): mensajes ajenos
  alineados a la izquierda con el fondo `--bg-elevated`, mensajes propios
  alineados a la derecha con `--accent-strong` (como cualquier app de
  chat), animación sutil de entrada (respeta `prefers-reduced-motion`,
  igual que el resto de la app). También se estilizó `.filtro-rango` (el
  form para saltar a un `amistad_id`), que tampoco tenía estilo. Se ajustó
  levemente el markup de `chat.ejs` para agrupar fecha + indicador de
  leído/visto en la misma línea dentro de la burbuja.
- Archivos tocados: public/style.css, views/chat.ejs (solo markup, sin
  tocar server.js).
- Qué se verificó: `ejs.renderFile` con datos simulados (sin DB) confirmó
  que compila y que las clases `mensaje-propio`/`mensaje-otro`/`no-leido`
  aparecen donde corresponde. Contra la DB real de Railway (2 usuarios de
  prueba, amistad ya aceptada, 2 mensajes reales): `GET /chat` → 200, sin
  errores de render, con las clases nuevas presentes en el HTML. No se
  pudo tomar captura de pantalla en esta sesión (sin herramientas de
  navegador disponibles) — se generó una vista previa HTML con el CSS
  real incrustado y se le envió al usuario para que la revise él mismo
  antes de mergear.

### rama-historial-ediciones
- Estado: commiteada, lista para merge.
- Tarea: guardar el texto anterior de un pendiente antes de sobrescribirlo al
  editar, sin cambiar nada visible para el usuario. Reacciona a un hueco
  encontrado en revisión: la regla de "historial inmutable" planeada para B8.6
  ya estaba siendo violada por `POST /pendientes/:id/editar` en producción
  (sobrescribía sin dejar rastro).
- Cambios: `ensureSchema()` agrega `historial_ediciones (id, pendiente_id
  REFERENCES pendientes(id), texto_anterior, editado)`. `POST
  /pendientes/:id/editar` ahora lee el texto actual, lo inserta en
  `historial_ediciones`, y recién después actualiza — las tres cosas en una
  sola transacción (si algo falla, no queda ni historial a medias ni el texto
  sin actualizar).
- Archivos tocados: server.js únicamente.
- Qué se verificó: con un usuario y pendiente de prueba 100% descartables
  (creados vía `POST /registro` real, borrados al terminar) — dos ediciones
  seguidas → 2 filas en `historial_ediciones`, cada una con el texto correcto
  de antes de cada cambio; el texto visible para el usuario sigue siendo solo
  el actual.
- Commit: 8eeb45d.
- Pendiente/nota para quien decida sobre B8.6: el botón "Eliminar" (backlog
  B7) sigue sin construirse — si se construye, debería ser borrado lógico
  (columna `eliminado boolean`), no `DELETE` real, para no contradecir esta
  misma regla de inmutabilidad. Decisión del usuario, no tomada todavía.

### rama-recuperacion-pin
- Estado: worktree creado, sin código todavía — lista para que alguien la tome.
- Tarea: código de recuperación de PIN (ver Backlog de tareas).
- Ya tiene worktree propio en `C:\Users\lenovo\Desktop\a-worktrees\rama-recuperacion-pin`,
  con `npm install` ya corrido en `pendientes-web/`. Falta copiar `.env` a mano
  (bloqueado por permisos para la sesión que la creó) antes de poder correr el
  server localmente ahí.
- Esta rama también sirvió para probar que `git worktree` funciona bien en esta
  máquina Windows (carpeta aislada, rama independiente, `npm install` sin
  problemas) — ver la nueva regla 2 y el paso 4 de onboarding arriba.

### rama-estadisticas
- Estado: ✅ commiteada, lista para merge.
- Tarea: panel de estadísticas — nueva ruta `GET /estadisticas` con métricas
  simples (completadas por semana, pendientes vencidos, racha de días
  seguidos completando algo), todo de solo lectura sobre la tabla
  `pendientes` ya existente (columnas `hecho`, `creado`), sin tablas nuevas.
- Archivos tocados: server.js (helpers `formatearDiaLima`/`diaAnterior`/
  `calcularRacha` y constante `VENCIDO_DIAS` junto a `whereRango`; nueva ruta
  `GET /estadisticas` agregada justo después de `/hechos`, sin tocar otras
  rutas), views/estadisticas.ejs (nuevo), views/partials/nav.ejs (una línea
  nueva con el link). No toqué public/style.css — reuso clases ya existentes
  (`.count`, `.empty`, `.error`, `table`) para no pisar a rama-visual/
  rama-tema-chat que ya lo tocaron.
- Definiciones usadas (documentadas también en la vista):
  - "Completadas por semana": `pendientes` con `hecho = TRUE`, agrupadas por
    `date_trunc('week', creado AT TIME ZONE 'America/Lima')`. LIMITACIÓN: la
    tabla no tiene columna de fecha de completado, así que se usa `creado`
    como aproximación — si un pendiente se completa días después de
    creado, esta métrica lo cuenta en la semana en que se CREÓ, no en la que
    se completó.
  - "Vencido": pendiente con `hecho = FALSE` y `creado < NOW() - INTERVAL
    '7 days'` (constante `VENCIDO_DIAS = 7` en server.js).
  - "Racha": días consecutivos (calendario America/Lima) con al menos un
    pendiente `hecho = TRUE`, contando hacia atrás desde hoy; usa `creado`
    como fecha de referencia (misma limitación de arriba). Si hoy todavía no
    se completó nada, no rompe la racha (el día no terminó) y se cuenta
    desde ayer.
- Qué se probó contra la DB real de Railway (servidor en puerto 3104, dos
  usuarios de prueba descartables creados vía `POST /registro` real y
  borrados al terminar, pendientes insertados directo por SQL para controlar
  `creado`):
  - Usuario 1, 7 pendientes de prueba con offsets de días controlados
    (hoy, ayer, anteayer, hace 8 y 10 días, mezclando `hecho` true/false):
    `GET /estadisticas` → 200. Racha calculada = 3 (coincide con 3 días
    consecutivos hecho=TRUE armados a propósito, con un cuarto completado
    aislado 10 días atrás que correctamente NO extendió la racha). Vencidos
    = 2 (los dos `hecho=FALSE` creados hace 8 y 10 días; el creado hace 1
    día correctamente excluido). Completadas por semana: 3 buckets exactos
    — `2026-08-10` → 2, `2026-08-03` → 1, `2026-07-27` → 1 — verificados
    tanto en el HTML devuelto como con una consulta SQL independiente hecha
    desde el script de prueba (mismos números).
  - Usuario 2 (sin pendientes): `GET /estadisticas` → 200, sin errores,
    mostrando los 3 mensajes de estado vacío ("Sin racha activa todavía",
    "No hay pendientes vencidos", "Todavía no hay pendientes completados").
  - Ambos usuarios de prueba y sus pendientes fueron borrados al final de
    cada script. Scripts `_test_*.js` temporales borrados antes de
    commitear.
- Pendiente/hueco conocido: no hay columna de fecha de completado en
  `pendientes`, así que "por semana" y "racha" son aproximaciones basadas en
  `creado` (documentado arriba y en la vista). Si en el futuro se agrega una
  columna tipo `completado_en`, estas dos queries deberían migrar a usarla.

### rama-categorias
- Estado: ✅ commiteada, lista para merge.
- Tarea: categorías/etiquetas en pendientes (ronda 2026-08-11) — columna
  `categoria` en tabla `pendientes`, UI para asignarla al crear/editar, y
  filtro por categoría en `GET /`.
- Cambios en `server.js`:
  - `ensureSchema()`: `ALTER TABLE pendientes ADD COLUMN IF NOT EXISTS
    categoria TEXT` (mismo patrón idempotente que el resto de la función).
  - Constante `CATEGORIAS_VALIDAS = ['personal', 'trabajo', 'fundo', 'salud',
    'otro']` (lista cerrada, mismo espíritu que `RANGOS_VALIDOS`): cualquier
    valor recibido que no esté en la lista se guarda/filtra como "sin
    categoría" en vez de fallar.
  - `GET /`: acepta `?categoria=<valor>`; si es válido agrega `AND categoria
    = $2` a la query y pasa `categoriaFiltro` + `categorias` a la vista.
  - `POST /pendientes`: guarda `categoria` (o `null` si no viene o no es
    válida).
  - `GET /pendientes/:id/editar`: ahora trae también `categoria` y pasa la
    lista `categorias` a la vista para prellenar el `<select>`.
  - `POST /pendientes/:id/editar`: guarda `categoria` junto con `texto` en
    el mismo UPDATE ya usado por rama-historial-ediciones (no rompe esa
    transacción, solo se agregó una columna más al SET).
- Cambios en vistas: `views/index.ejs` (select de categoría en el form de
  "Agregar pendiente", selector de filtro `?categoria=` reusando la clase
  `.filtro` ya existente, columna nueva "Categoría" en la tabla mostrada
  como `#categoria`), `views/editar.ejs` (select de categoría, preseleccionada
  con la categoría actual del pendiente).
- `public/style.css`: agregado `.nuevo select` (estilo simple, coherente con
  `.nuevo input`/`.nuevo button` ya existentes) — no se tocó nada del tema
  oscuro de rama-visual, solo se reutilizaron sus variables CSS.
- Archivos tocados: `pendientes-web/server.js`, `pendientes-web/views/index.ejs`,
  `pendientes-web/views/editar.ejs`, `pendientes-web/public/style.css`.
- Qué se verificó: `node --check server.js` sin errores. Contra la DB real de
  Railway con usuario descartable `test_categorias_temp` (creado vía
  `POST /registro`, borrado al terminar junto con sus pendientes e historial
  de ediciones asociado): creé un pendiente con categoría `trabajo` y otro
  con `personal` → ambos aparecen en `/` con su `#categoria` visible;
  `GET /?categoria=trabajo` solo devuelve el de trabajo, `GET
  /?categoria=personal` solo el de personal; abrí `/pendientes/:id/editar`
  del primero y confirmé que el `<option value="trabajo" selected>` viene
  marcado; lo edité cambiando la categoría a `fundo` →
  `GET /?categoria=fundo` ahora lo incluye y `GET /?categoria=trabajo` ya no.
  Limpieza completa confirmada en DB (pendientes, historial_ediciones y
  usuario de prueba borrados, 0 filas restantes).
- No toqué `historial_ediciones` (rama-historial-ediciones) ni las rutas
  /amigos, /chat, /notificaciones — solo pendientes.
- Commit: 5920efd.

### rama-busqueda
- Estado: ✅ commiteada, lista para merge.
- Tarea: búsqueda de texto en pendientes (`GET /`, query param `q`) y en el
  chat (`GET /chat`, query param `buscar`), del backlog "Ronda nueva
  (2026-08-11)".
- Cambios en `server.js`: `app.get('/', ...)` arma la consulta con un
  `WHERE hecho = FALSE AND usuario_id = $1` base y, si `req.query.q` viene
  no vacío, agrega ` AND texto ILIKE $2` con el patrón `%q%` como parámetro
  ($2, nunca concatenado directo — mismo estilo parametrizado que ya usa
  todo el archivo). `app.get('/chat', ...)` hace lo mismo sobre `mensajes`
  con `req.query.buscar`, pero el filtro se arma DESPUÉS de
  `usuarioPerteneceAmistad(req.usuarioId, amistadId)` — la verificación de
  acceso sigue corriendo primero sin excepciones, tanto con como sin
  `buscar`; no se tocó el helper ni su lógica. El `UPDATE ... SET leido =
  true` (de rama-notificaciones) sigue marcando como leídos TODOS los
  mensajes no leídos de la conversación, no solo los que matchean el
  filtro — es intencional, el filtro solo afecta qué se muestra.
- Cambios en vistas: `views/index.ejs` — form GET simple (`?q=`) arriba de
  la lista, reutilizando la clase `.filtro-rango` ya estilizada por
  rama-tema-chat; mensaje de "vacío" distinto cuando hay `q` sin
  resultados. `views/chat.ejs` — se agregó un input `buscar` al mismo form
  GET que ya existía para `amistad_id` (para que ambos viajen juntos al
  recargar `/chat`), más un link "Limpiar" y mensaje de "vacío" distinto
  cuando hay `buscar` sin resultados. Sin cambios de esquema (ninguna
  tabla/columna nueva), como estaba previsto.
- Qué se probó contra la DB real de Railway (servidor local en puerto
  3103, usuarios 100% descartables creados vía `POST /registro` real):
  1) 3 pendientes con textos distintos, uno con una palabra única
     ("ZORROVERDE") → `GET /?q=zorroverde` (minúscula, confirma
     case-insensitive de ILIKE) devuelve solo ese pendiente, los otros 2
     no aparecen. `GET /?q=palabraquenoexiste123` devuelve el mensaje de
     "sin resultados".
  2) Segundo usuario de prueba + amistad aceptada entre ambos (por el
     flujo real: `/amigos/solicitar` + `/amigos/:id/aceptar`) + 3 mensajes
     con textos distintos, uno con palabra única ("CAFEXTRAORDINARIO") →
     `GET /chat?amistad_id=X&buscar=cafextraordinario` devuelve solo ese
     mensaje.
  3) Un tercer usuario de prueba SIN pertenecer a esa amistad →
     `GET /chat?amistad_id=X&buscar=cafextraordinario` → 403, confirmando
     que la búsqueda no abre ningún atajo alrededor de
     `usuarioPerteneceAmistad`.
  Los 3 usuarios de prueba, sus pendientes, la amistad y los mensajes se
  borraron al terminar (verificado con una consulta final que no queda
  ningún `testbusca_*` en `usuarios`).
- Nota/hueco encontrado (no relacionado con esta tarea, no se tocó nada al
  respecto): durante las pruebas se observó una condición de carrera
  preexistente, intermitente y de ventana muy corta, en el guardado de
  sesión contra la DB remota — inmediatamente después de `POST /registro`
  (o análogo), una request siguiente disparada sin ninguna pausa a veces
  no ve todavía `usuario_id` en la sesión (se comporta como no
  autenticado un instante) y solo se estabiliza con un pequeño delay o una
  query intermedia. Se reprodujo 2 de ~5 veces en scripts de prueba con
  fetch inmediato tras registro; con cualquier pausa/round-trip de por
  medio (como en el flujo normal de un usuario real navegando) no se
  reprodujo. No afecta la lógica de `usuarioPerteneceAmistad` en sí (se
  confirmó con consultas directas a la tabla `session` que, cuando la
  sesión SÍ está guardada, el 403 se aplica correctamente incluso con
  `buscar` presente). Podría valer la pena investigarlo aparte si alguna
  sesión ve login intermitente fallando justo después de registrarse.
- Puerto local usado para pruebas: 3103.
- Commit: fe793c6.

### rama-tareas-compartidas
- Estado: ✅ commiteada, lista para merge (pendiente de push/PR).
- Tarea (backlog "Ronda nueva 2026-08-11"): permitir asignar un pendiente
  propio a un amigo — columna `asignado_a` en `pendientes`, validada contra
  `amistades` (misma tabla/convención que `usuarioPerteneceAmistad`), y que
  el pendiente asignado aparezca también en el `/` de quien lo recibió.
- Alcance deliberadamente chico (indicado por el usuario): NO se construyeron
  carpetas compartidas, tablero, posponer con duración ni aviso a 30 min —
  eso es la visión más grande "B8.3" en el documento maestro del usuario,
  pospuesta a v0.2 a propósito. Esta rama solo agrega la columna y el
  mecanismo simple de asignar/ver.
- Archivos tocados: `server.js` (ensureSchema agrega `asignado_a INT
  REFERENCES usuarios(id)` nullable; nueva función `usuariosSonAmigos(idA,
  idB)` — variante de `usuarioPerteneceAmistad` para cuando se tienen los
  dos ids de usuario en vez de un `amistad_id`, misma tabla `amistades` y
  mismo criterio `estado = 'aceptada'`; `GET /` ahora trae `usuario_id =
  $1 OR asignado_a = $1` con JOIN a `usuarios` para el nombre del creador;
  `GET /pendientes/:id/editar` trae también la lista de amigos y el
  `asignado_a` actual; nueva ruta `POST /pendientes/:id/asignar`, valida que
  el pendiente sea propio y que el destino sea amigo aceptado, rechaza con
  403 si no — el body vacío quita la asignación), `views/index.ejs` (marca
  "Asignado por @fulano" + "Solo lectura" en los pendientes recibidos, sin
  botones de completar/posponer/editar para esos), `views/editar.ejs`
  (selector de amigos + botón "Guardar asignación"), `public/style.css`
  (`.badge-asignado`, `.solo-lectura`, `.asignado-actual`, `.asignar-form`,
  reusando las variables de color existentes).
- Decisión de alcance explícita: el usuario que RECIBE la asignación NO
  puede completar/posponer/editar el pendiente (las rutas existentes siguen
  exigiendo `usuario_id = req.usuarioId`, sin tocarlas) — por ahora es solo
  visibilidad de lectura con la marca "Asignado por @fulano". Si el usuario
  quiere que el destinatario también pueda completarlo, es un cambio
  pequeño y separado (agregar `OR asignado_a = req.usuarioId` a esas rutas)
  pero no se hizo acá para no ampliar el alcance sin pedirlo.
- Qué se probó (contra la DB real de Railway, puerto 3102, con
  `_test_compartidas.js` — borrado antes de commitear): 3 usuarios
  descartables (`test_compartidas_a/b/c`) vía `POST /registro` real. A crea
  un pendiente → A intenta asignarlo a C (sin amistad) → 403 rechazado en
  servidor. Se crea la amistad A-B `aceptada` directo por SQL. A asigna el
  mismo pendiente a B → 302, `asignado_a` queda correcto en DB. B abre `/`
  → ve el pendiente con la marca "Asignado por @test_compartidas_a" y
  "Solo lectura" (sin botones de acción). C (sin amistad ni asignación) NO
  ve el pendiente en su `/`. Reintento de asignar a C sigue dando 403.
  Limpieza completa al terminar: pendiente, amistad y los 3 usuarios de
  prueba borrados de la DB real.
- Commit: 34dddbe. PR abierto contra main: #14
  (https://github.com/brucerojasm15-rgb/bitacora-telegram/pull/14), NO
  mergeado por esta sesión (bloqueado por permisos, además la regla del
  protocolo es que rama-integracion o el usuario deciden el merge).

### rama-ci-basica
- Estado: commiteada, lista para merge.
- Tarea: agrega verificación automática por PR (GitHub Actions) — hasta ahora
  toda la validación de sintaxis/plantillas antes de mergear se hacía a mano
  en cada sesión. `.github/workflows/ci.yml` corre en cada PR/push a main:
  `npm install` + `npm run ci` dentro de `pendientes-web/`.
- Archivos nuevos: `.github/workflows/ci.yml`, `pendientes-web/scripts/
  verificar.js` (sin DB ni variables de entorno: `node --check` a todos los
  `.js` del proyecto — excepto `node_modules` — y `ejs.compile()` a todos
  los `.ejs` de `views/`, incluidos los partials), `package.json` (nuevo
  script `"ci": "node scripts/verificar.js"`).
- No reemplaza la prueba end-to-end contra la DB real que se sigue haciendo
  a mano antes de mergear una rama con lógica nueva — solo atrapa errores de
  sintaxis/plantillas rotas automáticamente, antes de que alguien los vea.
- Probado localmente: `npm run ci` da OK en los 16 archivos actuales
  (1 `.js` + 15 `.ejs`).
- No incluye `anthropics/claude-code-action` ni `anthropics/
  claude-code-security-review` (las Actions oficiales de Claude Code) —
  esas requieren instalar la GitHub App vía `/install-github-app` desde una
  terminal interactiva del usuario (permisos OAuth + secreto de API key),
  algo que ninguna sesión de Claude Code puede hacer por su cuenta.

### rama-recuperacion-pin
- Estado: ✅ commiteada, lista para merge.
- Tarea (backlog): código de recuperación de PIN — generarlo una sola vez al
  crear la cuenta, mostrarlo al usuario UNA vez, guardarlo hasheado (nunca en
  texto plano), y una ruta `GET/POST /recuperar` que permita fijar un PIN
  nuevo si se ingresa el código correcto. Objetivo: que nadie quede bloqueado
  de su propia cuenta si olvida el PIN.
- Cambios en `server.js`:
  - `ensureSchema()`: `ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS
    codigo_recuperacion_hash TEXT` (mismo patrón idempotente del resto).
  - `generarCodigoRecuperacion()`: código de 10 caracteres (formato
    `XXXXX-XXXXX`) con alfabeto sin `0/O/1/I/L` para evitar confusión al
    copiarlo a mano. Se hashea con las mismas `crearPinHash`/`verificarPin`
    ya existentes (genéricas para cualquier string, se reusaron tal cual sin
    tocarlas).
  - `POST /registro`: además del PIN, genera y guarda el hash del código de
    recuperación; en vez de redirigir a `/` directo, renderiza
    `codigo-recuperacion.ejs` mostrándolo una vez (la sesión ya queda
    iniciada, "Continuar" lleva a `/`).
  - Nuevas rutas `GET/POST /recuperar` (agregada al bypass del middleware de
    sesión junto con `/login` y `/registro`, ya que es para gente sin
    sesión): valida usuario + código contra el hash guardado, exige un PIN
    nuevo válido (mismo `PIN_REGEX`), y si todo calza actualiza `pin_hash` Y
    rota el código a uno nuevo (se muestra de nuevo, una sola vez) —
    el código es de un solo uso, el viejo deja de servir apenas se usa.
    `POST /recuperar` usa `limitarIntentos('recuperar')` (mismo helper ya
    existente, sin tocar su lógica ni las rutas de login/registro).
- Vistas nuevas: `views/recuperar.ejs` (formulario, mismo estilo
  `.login-form` que login/registro), `views/codigo-recuperacion.ejs`
  (muestra el código, reusada tanto por `/registro` como por `/recuperar`
  vía las props `mensaje`/`continuarUrl`). `views/login.ejs`: agregado el
  link "¿Olvidaste tu PIN?" hacia `/recuperar`.
- `public/style.css`: `.codigo-recuperacion` (caja monoespaciada, letras
  separadas, reusa `--bg-elevated`/`--border` ya existentes) y
  `.aviso-codigo` (texto de advertencia con `--warning`).
- Qué se verificó: `npm run ci` (sintaxis + compilación de las 18 plantillas,
  incluidas las 2 nuevas) sin errores. Contra la DB real de Railway (servidor
  local puerto 3105, usuario descartable `test_recu_pin_tmp` creado vía
  `POST /registro` real, borrado al terminar): registro devuelve el código;
  código incorrecto en `/recuperar` → error genérico "Usuario o código
  incorrecto" (sin distinguir si el usuario existe, mismo estilo que
  login); login con el PIN nuevo ANTES de recuperar → falla (el PIN viejo
  seguía activo); `/recuperar` con el código correcto → 200, devuelve un
  código NUEVO distinto al anterior, y actualiza el PIN; login con el PIN
  viejo → falla; login con el PIN nuevo → 302 a `/`; reintentar `/recuperar`
  con el código YA USADO (rotado) → falla, confirma que es de un solo uso.
  Usuario de prueba borrado de la DB real al terminar.
- No se tocó `limitarIntentos`, ni las rutas `/login`/`/registro` más allá de
  agregar la generación/guardado del código en el registro (como pedía el
  backlog explícitamente).
- Hueco conocido (documentado en el backlog original, fuera de alcance de
  esta rama): no hay forma de recuperar la cuenta si el usuario pierde el
  código de recuperación (se comporta igual que antes de esta rama en ese
  caso — requeriría intervención manual en la DB).
- Commit: 912b745. Mergeada a main vía PR #24 (ver Historial de merges abajo).

### rama-eliminar-pendientes
- Estado: ✅ commiteada, lista para merge.
- Tarea: botón "Eliminar" para pendientes (decisión pendiente en la sección
  de rama-historial-ediciones, arriba). Implementado como **borrado
  lógico**, nunca `DELETE` real — motivo no solo de consistencia con la
  regla de inmutabilidad de `historial_ediciones`, sino que un `DELETE`
  real directamente fallaría por la FK (`historial_ediciones.pendiente_id
  REFERENCES pendientes(id)` sin `ON DELETE CASCADE`, a propósito) en
  cuanto el pendiente tuviera alguna edición registrada.
- Cambios en `server.js`:
  - `ensureSchema()`: `ALTER TABLE pendientes ADD COLUMN IF NOT EXISTS
    eliminado BOOLEAN DEFAULT false` (mismo patrón idempotente del resto).
  - Nueva ruta `POST /pendientes/:id/eliminar`: `UPDATE ... SET eliminado =
    TRUE WHERE id = $1 AND usuario_id = $2` (solo el dueño puede eliminar).
  - `GET /`: agrega `AND p.eliminado = FALSE` al filtro existente — un
    pendiente eliminado deja de listarse (tanto los propios como los
    asignados por un amigo).
  - Guardas `AND eliminado = FALSE` agregadas a las mutaciones existentes
    para que un formulario viejo en el navegador no pueda resucitar o
    modificar algo ya eliminado: `POST .../completar`, `POST .../posponer`,
    el `UPDATE` de `POST .../reflexion`, el `SELECT` de
    `GET .../editar` (ahora responde 404 si está eliminado), el `SELECT`
    inicial de `POST .../editar`, y el `SELECT` de "propios" en
    `POST .../asignar`.
  - `GET /exportar`: la hoja "Pendientes" ahora excluye los eliminados
    (`AND eliminado = FALSE`) — las demás hojas (Ideas, Recordatorios,
    Hechos, Reflexiones) no se tocaron.
- Vista: `views/index.ejs` — botón "🗑️ Eliminar" junto a Completar/Posponer/
  Editar (oculto para los pendientes asignados por un amigo, igual que esos
  otros botones), con `confirm()` antes de enviar y la misma animación
  `fila-saliendo` que ya usan completar/posponer (sin recarga completa).
  `public/style.css`: `.eliminar-form button` reusa el mismo patrón visual
  que `.logout-form button` (texto en `--danger`, sin fondo) — no se creó
  un componente nuevo.
- Qué se verificó: `npm run ci` (19 archivos) sin errores. Contra la DB real
  de Railway (servidor local puerto 3107, usuario descartable
  `test_borrado_log` creado vía `POST /registro` real): crear pendiente →
  aparece en `/`; eliminar → desaparece de `/`; `GET .../editar` del
  pendiente eliminado → 404; `POST .../completar` sobre el pendiente
  eliminado → sigue redirigiendo 302 (no rompe) pero se confirmó por
  consulta directa a la DB que `hecho` se quedó en `FALSE` (el guard
  funcionó, no lo completó). Usuario y pendiente de prueba borrados al
  terminar.
- Hallazgo aparte (no tocado en esta rama, reportado al usuario): la ruta
  `GET /estadisticas` no existe en `server.js` a pesar de que
  `views/estadisticas.ejs` sí está en el repo y el nav (`partials/nav.ejs`)
  tiene el link "📊 Estadísticas" — se perdió en algún merge/reconstrucción
  posterior a rama-estadisticas (PR #15). Confirmado con sesión real: GET
  autenticado a `/estadisticas` → 404. Pendiente de que alguien la
  reconstruya.
- Commit: 9d0e2ad. Mergeada a main vía PR #27 (ver Historial de merges abajo).

### rama-fix-estadisticas
- Estado: ✅ commiteada, lista para merge.
- Tarea: reconstruir `GET /estadisticas`, que había desaparecido de
  `server.js` en algún merge posterior a rama-estadisticas (PR #15) —
  detectado y agregado al backlog por rama-eliminar-pendientes.
- Cambios: se recuperó el código original del commit `515c6a8` (helpers
  `formatearDiaLima`/`diaAnterior`/`calcularRacha`, constante
  `VENCIDO_DIAS`, y la ruta en sí, con sus 3 queries en paralelo) y se
  reinsertó en `server.js` tal cual, con un solo ajuste necesario: las 3
  queries ahora excluyen `eliminado = TRUE` (columna que no existía cuando
  se escribió el código original — la agregó rama-eliminar-pendientes
  después). `views/estadisticas.ejs` y el link del nav ya estaban en el
  repo, no se tocaron.
- Qué se verificó: `npm run ci` sin errores. Contra la DB real de Railway
  (servidor local puerto 3108, usuario descartable `test_estad_fix`,
  pendientes de prueba insertados directo por SQL con fechas controladas,
  igual que hizo la sesión original de rama-estadisticas): racha calculada
  = 3 (3 días consecutivos armados a propósito, con un cuarto completado
  aislado 10 días atrás que correctamente no la extendió); vencidos = 2
  (los `hecho=FALSE` de hace 8 y 10 días; el de hace 1 día correctamente
  excluido) — verificado también con una consulta SQL independiente
  (mismo resultado). Caso nuevo agregado a la prueba (no existía en la
  sesión original, por la columna `eliminado`): un pendiente sin completar
  de hace 9 días pero con `eliminado = TRUE` NO aparece como vencido, y uno
  completado hoy pero eliminado NO cuenta para la racha — confirma que el
  ajuste funciona. Usuario y pendientes de prueba borrados al terminar.
- Commit: 60e35bd. Mergeada a main vía PR #29 (ver Historial de merges abajo).

### rama-fix-recuperar-pin
- Estado: ✅ commiteada, lista para merge.
- Tarea: tarea 1 (SEGURIDAD, bloqueante) de la ronda "2026-08-12 — roadmap
  grande" — `/recuperar` exigía solo `nombre_usuario` + código; cualquiera
  con el código podía resetear el PIN de otra cuenta sin saber su PIN
  actual (hueco documentado en la sección de rama-recuperacion-pin).
- Cambios en `server.js` (`POST /recuperar` únicamente, no se tocó
  `/login`, `/registro` ni `limitarIntentos`):
  - Nuevo campo `pinActual = req.body.pin_actual`, agregado a la validación
    de "campos completos" junto a `nombreUsuario`/`codigo`.
  - El `SELECT` ahora trae también `pin_hash` (antes solo traía
    `codigo_recuperacion_hash`).
  - La condición de éxito ahora exige `verificarPin(codigo,
    codigo_recuperacion_hash) Y verificarPin(pinActual, pin_hash)` — si
    CUALQUIERA de los dos falla, se devuelve el mismo mensaje genérico que
    ya existía ("Usuario o código incorrecto"), sin cambiar el texto, para
    no revelar cuál de los dos factores falló.
  - El resto de la ruta (generar PIN nuevo, rotar el código de
    recuperación, mostrarlo una vez) no se tocó.
- Vista: `views/recuperar.ejs` — un input más (`pin_actual`, mismo patrón
  `type="password" inputmode="numeric" pattern="\d{4,6}"` que el resto de
  los campos de PIN), ubicado entre el código y el PIN nuevo.
- Qué se verificó: `npm run ci` sin errores. Contra la DB real de Railway
  (servidor local puerto 3109, usuario descartable `test_fix_recup`,
  creado y borrado en la prueba) — los 3 casos exactos que pedía la tarea,
  más algunos extra:
  1. Código correcto + PIN actual incorrecto → falla con el mensaje
     genérico; se confirmó además que el PIN NO cambió (login con el PIN
     original siguió funcionando después del intento fallido).
  2. Código incorrecto + PIN actual correcto → falla con el mismo mensaje
     genérico.
  3. Sin el campo `pin_actual` en el body (simula un formulario viejo/
     incompleto) → rechazado por la validación de campos completos, no
     llega ni a intentar verificar nada.
  4. Ambos correctos → funciona igual que antes: 200, PIN actualizado,
     código de recuperación rotado y mostrado una vez. Confirmado con
     login: el PIN nuevo entra (302), el PIN viejo ya no (mensaje de
     error).
  Usuario de prueba borrado de la DB real al terminar.
- Esto desbloquea la tarea 2 (registro público) del mismo roadmap, que
  tenía como condición explícita no desplegarse hasta que este fix
  estuviera "probado y confirmado".
- Commit: ead2985. Mergeada a main vía PR #32 (ver Historial de merges abajo).

### rama-limite-registro
- Estado: ✅ commiteada, lista para merge.
- Tarea: tarea 2 de la ronda "2026-08-12 — roadmap grande" — confirmar/
  ajustar el límite de registro público por IP/hora.
- **Decisión de diseño (límite y porqué):** `limitarIntentos('registro')` ya
  existente (8 intentos/15min ≈ 32/hora por IP) protege contra fuerza bruta,
  pero cuenta intentos totales (éxito o fracaso) — alguien con paciencia
  podría espaciar sus requests para no gatillarlo y aun así crear decenas de
  cuentas falsas por hora sin que ese límite se active. Se agregó un
  segundo límite, independiente, que cuenta SOLO registros **exitosos**:
  `LIMITE_REGISTROS_EXITOSOS_POR_HORA = 5` por IP, ventana de 1 hora fija
  (mismo patrón de `Map` con `resetAt` que ya usa `limitarIntentos`, sin
  reusar la misma estructura porque mide algo distinto). Elegí 5 porque esta
  app es para un grupo chico de amigos/familia (ver sistema de amistades y
  chat en el resto de este archivo), no una red pública — 5 cubre el caso
  legítimo más exigente esperable (varias personas de la misma red
  registrándose seguido) y queda muy por debajo del límite de fuerza bruta
  existente (32/hora), para que farmear cuentas automatizadas deje de ser
  rentable sin bloquear el uso real. Documentado también como comentario en
  el propio código, junto a la constante.
- Cambios en `server.js`: `registrosPorIp` (Map), constantes
  `LIMITE_REGISTROS_EXITOSOS_POR_HORA`/`VENTANA_REGISTROS_MS`, helpers
  `limiteRegistrosAlcanzado(ip)`/`registrarAltaExitosa(ip)`, un
  `setInterval` de limpieza (mismo patrón que el de `intentosPorIp`). En
  `POST /registro`: chequeo de `limiteRegistrosAlcanzado(req.ip)` justo
  antes del `try` (mismo estilo que las demás validaciones, error propio:
  "Se alcanzó el límite de cuentas nuevas desde esta red en la última
  hora..."), y `registrarAltaExitosa(req.ip)` justo después del `INSERT`
  exitoso. No se tocó `limitarIntentos`, `/login`, ni `/recuperar` — ambos
  límites de `/registro` (el de intentos y el nuevo de altas exitosas)
  corren en paralelo, independientes.
- Qué se verificó: `npm run ci` sin errores. Contra la DB real de Railway
  (servidor local puerto 3110, 5 usuarios descartables `test_limreg_1..5`):
  los primeros 5 registros desde la misma IP se crean con éxito; el 6to,
  misma IP, se rechaza con el mensaje del límite nuevo y NO crea la cuenta
  (confirmado que no quedó una 6ta fila en `usuarios`). Los 5 usuarios de
  prueba se borraron de la DB real al terminar.
- Commit: a7d868e. Mergeada a main vía PR #34 (ver Historial de merges
  abajo). Verificado en producción con 1 registro de prueba real (no se
  agotó el cupo completo de 5/hora a propósito, para no bloquear registros
  reales desde el mismo IP compartido durante la hora siguiente).

### rama-captura-rapida
- Estado: commiteada, lista para probar contra la DB real antes de merge
  (ver "Qué se verificó" abajo — falta esa prueba end-to-end).
- Tarea: chat de captura rápida (tarea 3 del roadmap 2026-08-12) — input de
  texto libre con botones Pendiente/Idea/Recordatorio debajo para clasificar
  antes de guardar.
- Decisión de esquema (tomada al implementar, como pide el enunciado): se
  reusan las 3 tablas ya existentes `pendientes`/`ideas`/`recordatorios` (las
  mismas que llena el bot de Telegram) en vez de crear una tabla única con
  columna `tipo`. Motivo: las 3 ya tienen `usuario_id` (agregado por
  rama-categorias/rama-tareas-compartidas) y ya las leen `/`, `/ideas`,
  `/recordatorios` y `/exportar` tal cual — una tabla nueva hubiera obligado
  a mantener dos representaciones del mismo dato. `POST /captura` valida el
  `tipo` contra `TIPOS_CAPTURA_VALIDOS` e inserta en la tabla que
  corresponde; si el tipo es `recordatorio` exige `cuando` antes de guardar.
- Archivos tocados: server.js (rutas GET/POST /captura), views/captura.ejs
  (nuevo), public/style.css (`.captura-form`, `.captura-tipos`,
  `.captura-cuando`), views/partials/nav.ejs (link nuevo).
- **Sonido por acción — resuelto.** `Bash(curl*)`/`Bash(wget*)` estaban en el
  `deny` de `.claude/settings.json` (raíz del proyecto y de este worktree);
  el usuario confirmó explícitamente que quería habilitarlos para esta tarea,
  así que se sacaron de la lista (resto de las reglas deny intacto) y se usó
  el acceso de red para bajar audio real de mixkit.co, categoría "Sound
  Effects" — licencia "Free License" (mixkit.co/license/#sfxFree: libre para
  uso personal y comercial, sin atribución requerida). 3 archivos en
  `public/sonidos/`:
  - `enviar.mp3` — "Select click", https://mixkit.co/free-sound-effects/click/
    (id 1109, https://assets.mixkit.co/active_storage/sfx/1109/1109-preview.mp3)
  - `completar.mp3` — "Correct answer tone", https://mixkit.co/free-sound-effects/correct/
    (id 2870, https://assets.mixkit.co/active_storage/sfx/2870/2870-preview.mp3)
  - `eliminar.mp3` — "Fast small sweep transition", https://mixkit.co/free-sound-effects/swoosh/
    (id 166, https://assets.mixkit.co/active_storage/sfx/166/166-preview.mp3)

  Helper nuevo `public/sonidos.js` (`reproducirSonido(nombre)`, incluido
  globalmente desde `views/partials/scripts.ejs`). Enganchado en:
  `index.ejs` (sonido `completar`/`eliminar` dentro de los handlers `fetch`
  ya existentes — no hubo que tocar la lógica async), y `captura.ejs` (sonido
  `enviar`). En `captura.ejs` los 3 botones dejaron de tener
  `name="tipo" value="..."` (ese patrón no deja tiempo de reproducir nada
  antes de navegar) y pasaron a `data-tipo` + un `<input type="hidden"
  name="tipo">`: el `submit` ahora se intercepta, dispara el sonido, y recién
  ahí llama `form.submit()` con ~180ms de margen. De paso esto unificó los
  dos listeners que había antes (uno para revelar el campo de fecha, otro
  para validar el submit) en uno solo.
- Archivos tocados (además de los ya listados arriba): public/sonidos.js
  (nuevo), public/sonidos/enviar.mp3, public/sonidos/completar.mp3,
  public/sonidos/eliminar.mp3 (nuevos, binarios), views/partials/scripts.ejs
  (`<script src="/sonidos.js">`), views/index.ejs (2 líneas,
  `reproducirSonido(...)` dentro de los handlers de completar/eliminar),
  views/captura.ejs (markup de los botones + reescritura del submit).
- Qué se verificó: `node --check server.js` y `node --check` de cada
  `<script>` inline extraído (captura.ejs, index.ejs, sonidos.js) sin
  errores; `ejs.renderFile('views/captura.ejs', ...)` con datos simulados
  renderiza bien y contiene `/sonidos.js` + el input oculto nuevo; los 3 MP3
  se verificaron con sus primeros bytes (`FF FB` = cabecera MPEG audio
  válida, no una página de error). Falta la prueba end-to-end contra la DB
  real de Railway (esta sesión no tenía esa conexión disponible) y
  confirmar a oído que los 3 sonidos se sienten bien en volumen/duración —
  pendiente para el usuario antes de mergear.

### rama-chat-general
- Estado: commiteada, sin probar contra la DB real (ver "Qué se verificó").
- Tarea: chat general — una sola sala compartida por todos los usuarios
  registrados, sin necesidad de amistad. Pedido directo del usuario el
  2026-08-12, agregado al backlog (ver nota en esa entrada sobre por qué se
  portó a mano desde `rama-notificaciones-recordatorios`). Creada desde
  `origin/main` (PR #35, commit 2c929e6) — no depende de ninguna rama del
  roadmap grande.
- Decisiones de esquema (tomadas al implementar):
  1. **Tabla propia `mensajes_generales`** (id, autor_id, texto, fecha) — no
     se reusó `mensajes`, que está atada a `amistad_id` y no tiene sentido
     sin una amistad de por medio.
  2. **No-leídos con timestamp, no columna `leido` por mensaje.** El chat
     1-a-1 marca `leido` por fila porque solo hay 2 participantes; acá
     potencialmente participan todos los usuarios de la app, así que marcar
     "visto" por mensaje y por usuario sería una tabla de cruce que crece
     como (mensajes × usuarios). Se agregó una sola columna,
     `usuarios.chat_general_visto_hasta TIMESTAMP`, que se actualiza a
     `now()` cada vez que el usuario abre `/chat-general`. `GET
     /notificaciones` cuenta mensajes de otros con `fecha >
     chat_general_visto_hasta` para el badge de no-leídos.
  3. **`noLeidosGeneral` aparte de `noLeidos` en `GET /notificaciones`**, no
     sumado — para no cambiar en silencio el significado de un campo que ya
     consume el frontend del chat 1-a-1 (que además tiene semántica
     distinta: "sin leer" ahí es por mensaje, acá es "desde que abriste la
     sala").
  4. **Paginación: 50 mensajes por vez**, cursor `?antes=<id>` (el mensaje
     más viejo ya cargado) para pedir la tanda anterior — elegido porque es
     el mismo orden de magnitud que "todo el historial visible de un
     vistazo" sin cargar una sala que, a diferencia del chat 1-a-1, puede
     acumular mensajes de varios usuarios a la vez.
  5. **Se muestra el nombre de usuario real (`nombre_usuario`), no
     "Usuario <id>"** como hace el chat 1-a-1 — en una sala con más de 2
     personas, saber quién escribió cada mensaje deja de ser algo obvio por
     contexto.
- Archivos tocados: `server.js` (tabla `mensajes_generales`, columna
  `usuarios.chat_general_visto_hasta`, rutas `GET /chat-general` y `POST
  /mensajes-general`, extensión de `GET /notificaciones`),
  `views/chat-general.ejs` (nuevo, reusa las clases `.chat-mensajes`/
  `.mensaje-propio`/`.mensaje-otro`/`.btn-link`/`.nuevo` ya existentes —
  no hizo falta tocar `style.css`), `views/partials/nav.ejs` (link nuevo).
- Qué se verificó: `node --check server.js` sin errores; `ejs.renderFile`
  de `chat-general.ejs` para 3 estados (vacío, con mensajes, error) sin
  errores. **No se probó contra la DB real** — este worktree no tiene
  `pendientes-web/.env` (gitignored, `git worktree add` no lo copia).
  Pendiente antes de mergear: confirmar que el `ALTER TABLE` corre limpio,
  que un mensaje nuevo de un usuario aparece para los demás, que
  `chat_general_visto_hasta` efectivamente baja el contador de
  `noLeidosGeneral` a 0 al abrir la sala, y que la paginación con `?antes=`
  trae la tanda correcta.

### rama-notificaciones-recordatorios
- Estado: commiteada, sin probar contra la DB real (ver "Qué se verificó").
- Tarea: notificaciones push para recordatorios (tarea 4 del roadmap
  2026-08-12) — depende de la tarea 3 (rama-captura-rapida, commiteada
  74e5c3b/1ad1dcd, todavía no mergeada a main). Creada desde
  `origin/main` actualizado (PR #35, commit 2c929e6) en un worktree nuevo
  (`a-worktrees/rama-notificaciones-recordatorios`) — NO incluye todavía el
  código de rama-captura-rapida porque esa rama no está mergeada; la tabla
  `recordatorios` que necesita esta tarea ya existe desde antes (la crea el
  bot), así que no hay bloqueo real.
- Decisiones de esquema (tomadas al implementar):
  1. **No se separa la suscripción push por función.** Ya existe un botón
     "Activar notificaciones" en `index.ejs` que suscribe al navegador
     contra `push_subscriptions` y ya se usa para el aviso diario genérico
     (`revisarYNotificarSiNoHayHechosHoy`). Se reusa la misma suscripción
     para recordatorios en vez de pedir un segundo permiso/botón — un
     usuario que ya activó notificaciones no debería tener que activarlas
     de nuevo para que le avisen sus recordatorios.
  2. **`push_subscriptions` sí necesitaba `usuario_id`.** Antes no lo tenía
     — `enviarPushATodos()` manda a *todas* las suscripciones sin filtrar,
     lo cual está bien para el aviso diario genérico pero mandaría el
     recordatorio de un usuario a los navegadores de todos los demás. Se
     agrega `ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS
     usuario_id INT REFERENCES usuarios(id)` (nullable — las suscripciones
     viejas quedan sin dueño y se siguen usando solo para el aviso
     genérico, no para recordatorios) y `/suscribir` ahora guarda
     `req.usuarioId` en el INSERT (y lo actualiza si el endpoint ya
     existía, por si el mismo navegador quedó suscrito con otra sesión
     antes).
  3. **Cron nuevo, cada minuto:** seguí el mismo patrón que
     `revisarYNotificarSiNoHayHechosHoy` (node-cron, ya en package.json).
     `revisarYNotificarRecordatoriosPendientes()` busca
     `recordatorios` con `avisado = FALSE AND cuando <= now() AND
     usuario_id IS NOT NULL` (los que no tienen dueño no se pueden
     dirigir a nadie, se ignoran), manda el push con
     `enviarPushAUsuario(usuario_id, ...)` (función nueva, mismo código
     que `enviarPushATodos` pero filtrado por `usuario_id`), y marca
     `avisado = TRUE` después de intentarlo — no reintenta si el push falla,
     mismo criterio de "mejor esfuerzo" que ya usa el resto del sistema de
     push (no hay cola de reintentos en ningún lado).
- Archivos tocados: server.js (ALTER TABLE, `/suscribir`, nueva función
  `enviarPushAUsuario`, nuevo cron `revisarYNotificarRecordatoriosPendientes`
  cada minuto). No hizo falta tocar `sw.js` (el `push` handler ya es
  genérico: título/cuerpo/acciones desde el payload) ni el botón de
  `index.ejs` (ya manda la suscripción con
  sesión activa).
- Qué se verificó: `node --check server.js` sin errores. **No se probó
  contra la DB real** — este worktree nuevo no tiene `pendientes-web/.env`
  (está en `.gitignore`, `git worktree add` no lo copia) y el usuario pidió
  seguir sin resolver eso por ahora. Falta antes de mergear: confirmar que
  el `ALTER TABLE` corre limpio, que `/suscribir` guarda `usuario_id`
  correctamente, y sobre todo probar el cron end-to-end (crear un
  recordatorio con `cuando` en el pasado desde `/captura` — o directo por
  SQL — y confirmar que en el siguiente minuto llega el push solo al
  usuario dueño, no a otras suscripciones, y que `avisado` queda en TRUE).
- Commit: pendiente de crear en esta misma sesión.

### rama-trazabilidad-social
- Estado: commiteada, sin probar contra la DB real (ver "Qué se verificó").
- Tarea: tareas asignadas — completar + trazabilidad social (tarea 6 del
  roadmap 2026-08-12). Depende de la tarea 4: creada desde
  `rama-notificaciones-recordatorios` (rama local, commit `68d43d5`, NO
  desde `origin/main`) porque necesita `enviarPushAUsuario()` y
  `push_subscriptions.usuario_id` de esa rama — tampoco mergeada a main
  todavía. Cadena de dependencias del roadmap, no un descuido: tarea 3 → 4 →
  6, ninguna de las tres está en main aún.
- Decisiones de esquema (tomadas al implementar):
  1. **`POST /pendientes/:id/completar` se amplía, no se duplica.** Pasa a
     aceptar `usuario_id = $2 OR asignado_a = $2`. Es la misma acción
     (marcar `hecho=TRUE`); una ruta nueva hubiera significado mantener el
     mismo UPDATE en dos lugares. Lo único condicionado al caso compartido
     (evento de trazabilidad + notificación push) es si la tarea tenía
     `asignado_a IS NOT NULL` — no quién la completó.
  2. **Comentario y trazabilidad en tabla nueva `eventos_completado`**
     (`pendiente_id`, `completado_por`, `comentario`, `fecha`), no columnas
     en `pendientes`. Mismo criterio que `historial_ediciones`: un evento de
     completado es un hecho inmutable separado del estado actual del
     pendiente. Se registra sin importar si completó el dueño o la persona
     asignada (visible para ambos).
  3. **Feed: últimos 7 días, paginado de a 20**
     (`TRAZABILIDAD_DIAS`/`TRAZABILIDAD_PAGINA_TAMANO`, constantes
     nombradas junto a `VENCIDO_DIAS`/`LIMITE_INTENTOS`). 7 días en vez de
     14 para que el feed se sienta "reciente" y no una lista larga —
     consistente con el criterio semanal que ya usa `/estadisticas`.
     Paginación simple `LIMIT/OFFSET` vía `?pagina=N`.
  4. **Contador semanal por persona:** mismo criterio de "semana" que
     `GET /estadisticas` (`date_trunc('week', ... AT TIME ZONE
     'America/Lima')`), aplicado a `eventos_completado.fecha` en vez de a
     `pendientes.creado` — no se pudo reusar el código literal porque es
     otra tabla, pero sí el criterio de corte de semana.
  5. **Notificación:** al completar una tarea compartida, se notifica al
     OTRO miembro (si completó el dueño, se avisa al asignado, y
     viceversa) con `enviarPushAUsuario()`.
- Archivos tocados: server.js (tabla `eventos_completado`, `/pendientes/:id/
  completar` ampliada, ruta nueva `GET /trazabilidad`), views/index.ejs
  (botón "Completar" + comentario opcional reemplazando el antiguo "Solo
  lectura" para tareas asignadas), views/trazabilidad.ejs (nuevo),
  views/amigos.ejs (link "📊 Actividad" junto al de chat),
  public/style.css (`.completar-asignado-form` reusa las reglas de
  `.reflexion-form` por selector compartido; se borró `.solo-lectura`, que
  quedó sin ningún uso tras el cambio de `index.ejs`).
- Qué se verificó: `node --check server.js` sin errores; `ejs.renderFile`
  con datos simulados (sin DB) para `trazabilidad.ejs` (caso con eventos y
  caso de error 403), `index.ejs` (con una tarea asignada, confirmando que
  aparece `completar-asignado-form` y ya no `solo-lectura`) y `amigos.ejs`
  (confirmando el link nuevo). **No se probó contra la DB real** — este
  worktree tampoco tiene `pendientes-web/.env` (mismo motivo de siempre).
  Falta antes de mergear: crear una amistad y una tarea asignada de
  prueba, completarla desde ambos roles (dueño y asignado), confirmar que
  `eventos_completado` se llena una sola vez por completado, que
  `/trazabilidad` solo muestra eventos de esa amistad específica (no de
  otras), y que el push le llega al usuario correcto.

### rama-google-calendar
- Estado: **ESQUELETO SIN PROBAR.** Compila y renderiza, pero nunca corrió
  contra la API real de Google — no hay `client_id`/`client_secret` todavía.
  No mergear a producción hasta confirmar el flujo real con credenciales
  verdaderas.
- Tarea: integración con Google Calendar (tarea 10 del roadmap 2026-08-12).
  Depende solo de la tarea 4 (notificaciones push) — NO depende de la tarea
  6 (trazabilidad social), que se desarrolló en paralelo en otro
  worktree/rama (`rama-trazabilidad-social`); no se tocó nada de eso desde
  acá. Creada desde `rama-notificaciones-recordatorios` (commit `68d43d5`,
  no `origin/main`) en worktree nuevo
  (`a-worktrees/rama-google-calendar`) — hereda `push_subscriptions.
  usuario_id` y `enviarPushAUsuario`, aunque esta tarea en concreto no los
  usa todavía (el botón de crear evento es manual, no dispara push).
- Decisiones de esquema (tomadas al implementar):
  1. **Tabla propia `google_calendar_tokens`, 1 fila por usuario** (no por
     dispositivo, a diferencia de `push_subscriptions`): el refresh_token es
     por cuenta de Google, no por navegador/sesión. `PRIMARY KEY
     (usuario_id)` en vez de `id SERIAL` — no hace falta más de una fila por
     usuario nunca.
  2. **Cifrado AES-256-GCM** (`crypto.createCipheriv`, ya se usaba `crypto`
     en el archivo para el hash del PIN) en vez de un modo sin autenticación
     — GCM detecta si el texto cifrado fue alterado, no solo lo oculta. IV
     aleatorio de 12 bytes por fila (recomendado para GCM), guardado junto
     con el `auth_tag` y el texto cifrado en columnas separadas. Clave en
     `GOOGLE_TOKEN_ENCRYPTION_KEY` (`.env`, 32 bytes en hex) — a propósito
     NO se reusa `SESSION_SECRET` (son secretos con propósitos distintos,
     rotarlos por separado sin arrastrar el otro).
  3. **`access_token` y `refresh_token` se cifran juntos como un solo JSON**
     (`cifrarTokensGoogle`/`descifrarTokensGoogle` reciben/devuelven el
     objeto completo que da la librería `googleapis`, no un token a la vez)
     — un solo cipher por guardado, más simple que cifrar cada campo aparte.
  4. **Renovación de `access_token`:** `obtenerClienteCalendarPara(usuarioId)`
     crea un cliente OAuth2 con las credenciales del usuario y escucha el
     evento `'tokens'` del SDK de `googleapis` — si Google renueva el
     access_token solo (pasa automático cuando expira), se vuelve a cifrar y
     guardar. Sin esto, la integración se rompería en silencio después del
     primer vencimiento (~1 hora, típico en tokens de Google).
  5. **Revocación al desconectar:** `POST /calendario/desconectar` intenta
     `googleOAuthClient.revokeToken(...)` contra Google antes de borrar la
     fila local, pero es "mejor esfuerzo" — si falla (red, token ya
     inválido, etc.) se borra igual localmente. No se probó nunca de verdad
     (necesita credenciales reales).
  6. **Botón manual, no automático:** como la tarea 8 (IA) no existe
     todavía, `POST /recordatorios/:id/crear-evento-calendar` es un botón
     que aparece en `views/recordatorios.ejs` por cada fila SOLO si el
     usuario ya conectó Calendar. Duración fija de 30 minutos por evento
     (`inicio` = `recordatorios.cuando`, `fin` = +30 min) — no hay UI para
     cambiarla, documentado como límite conocido, no bug.
  7. **`state` del flujo OAuth = `usuarioId`** (no un token CSRF aparte):
     `/calendario/callback` valida que el `state` que vuelve de Google
     coincida con `req.usuarioId` de la sesión actual, para no aceptar un
     callback armado a mano contra la cuenta de otro usuario.
- Archivos tocados: server.js (cliente OAuth condicional, funciones de
  cifrado/descifrado, `obtenerClienteCalendarPara`, tabla
  `google_calendar_tokens`, rutas `/calendario/conectar`,
  `/calendario/callback`, `/calendario/desconectar`,
  `/recordatorios/:id/crear-evento-calendar`, `GET /recordatorios` ahora
  pasa `googleConfigurado`/`googleConectado` a la vista),
  views/recordatorios.ejs (botones conectar/desconectar/crear evento),
  package.json (`googleapis` nuevo), .env.example (`GOOGLE_CLIENT_ID`,
  `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`,
  `GOOGLE_TOKEN_ENCRYPTION_KEY`, documentadas con el link a Google Cloud
  Console y el comando para generar la clave de cifrado).
- Qué se verificó: `node --check server.js` sin errores;
  `ejs.renderFile('views/recordatorios.ejs', ...)` con datos simulados para
  los 3 estados posibles (sin configurar / configurado sin conectar /
  conectado) — los botones correctos aparecen en cada uno. **Nunca se probó
  contra la API real de Google** (no hay credenciales) — ni el flujo OAuth
  completo, ni la creación de un evento real, ni la renovación de
  access_token, ni la revocación. Tampoco se probó contra la DB real de
  Railway (este worktree tampoco tiene `pendientes-web/.env`).
- **Para que esto funcione de verdad, el dueño del proyecto necesita:**
  1. Crear un proyecto en Google Cloud Console (console.cloud.google.com),
     habilitar la "Google Calendar API".
  2. Configurar la pantalla de consentimiento OAuth (tipo Externo si la
     cuenta de Google no es Workspace; agregar el scope
     `calendar.events`).
  3. Crear credenciales OAuth 2.0 tipo "Aplicación web", con
     `GOOGLE_REDIRECT_URI` (una URL por entorno: local y la de Railway en
     producción) como URI de redireccionamiento autorizado.
  4. Copiar `client_id`/`client_secret` a `.env` (local) y a las variables
     de entorno del servicio en Railway (producción) — nunca comitearlos.
  5. Generar `GOOGLE_TOKEN_ENCRYPTION_KEY` con el comando que ya está en
     `.env.example`.
  6. Recién ahí probar el flujo completo: conectar → crear un recordatorio
     de prueba → botón "Crear evento" → confirmar que aparece en Google
     Calendar → desconectar → confirmar que la fila se borra de
     `google_calendar_tokens`.
- Commit: pendiente de crear en esta misma sesión.

### rama-tema-jungla
- Estado: commiteada, sin probar contra la DB real ni en un navegador de
  verdad (ver "Verificación del rediseño visual" más abajo).
- Tarea: tarea 5 del roadmap 2026-08-12 (rediseño "Jungla/Monstera"). Como
  esta tarea toca prácticamente todos los `.ejs` y estaba despachada al
  final a propósito (para no chocar con el resto del roadmap en paralelo),
  y para cuando se retomó ya había 4 ramas terminadas sin mergear
  (captura-rápida, chat-general, notificaciones-recordatorios,
  trazabilidad-social) más una quinta solo esqueleto (google-calendar), el
  usuario pidió construir el tema sobre TODO ese trabajo combinado en vez
  de solo sobre `origin/main` — para no tener que rehacer el tema después
  de cada merge.
- **Combinación (este commit):** se creó esta rama desde `origin/main`
  (commit `2c929e6`) y se incorporó el código de las 5 ramas vía
  `git cherry-pick` de cada commit individual, EN ESTE ORDEN:
  `rama-captura-rapida` (74e5c3b, 1ad1dcd) → `rama-chat-general` (1bb44dd)
  → `rama-notificaciones-recordatorios` (68d43d5, 5aa4c0c, 7f0d407) →
  `rama-trazabilidad-social` (d8685d2) → `rama-google-calendar` (9e34f9a).
  No se usó `git merge` ni `git rebase` (bloqueados a propósito por
  `.claude/settings.json`).
  - `server.js` no tuvo NINGÚN conflicto real en ningún paso — los 5
    bloques son aditivos en zonas distintas del archivo, incluida la
    ampliación de `/pendientes/:id/completar` de trazabilidad-social
    (aplicó limpio porque ya tenía debajo el `server.js` de
    notificaciones-recordatorios, del cual depende).
  - `COORDINACION.md` sí tuvo conflicto en cada paso — siempre el mismo
    patrón ya conocido (cada rama insertando su propia sección `###
    rama-X` justo antes de `### rama-integracion`): se resolvió
    conservando AMBOS lados en secuencia, nunca eligiendo uno solo.
  - Un conflicto de contenido real (no solo de punto de inserción): el
    ítem de backlog "Chat general" existía duplicado — se había agregado
    primero en `rama-notificaciones-recordatorios` (commit `5aa4c0c`) y
    por separado, a mano, en `rama-chat-general` (que no dependía de esa
    rama). Se dejó una sola copia, con nota explicando el porqué de la
    duplicación original.
  - `.claude/settings.json`: se confirmó al final que `curl`/`wget` siguen
    fuera del `deny` (ya venían así desde el segundo commit de
    rama-captura-rapida).
- Verificado: `npm install` sin errores (incluida la dependencia nueva
  `googleapis` de google-calendar); `node --check server.js` sin errores;
  grep confirmando que las rutas clave de las 5 ramas existen todas en el
  `server.js` final (`/captura`, `/chat-general`, `/mensajes-general`,
  `/suscribir` con `usuario_id`, `enviarPushAUsuario`, `/pendientes/:id/
  completar` con `OR asignado_a`, `/trazabilidad`, las 4 rutas de
  `/calendario/*`); `ejs.renderFile(...)` con datos simulados para las 6
  vistas nuevas o tocadas por cualquiera de las 5 ramas (`index.ejs`,
  `captura.ejs`, `chat-general.ejs`, `trazabilidad.ejs`, `amigos.ejs`,
  `recordatorios.ejs`) — las 6 renderizan sin error.
- **Nada de esto se probó contra la DB real** (ninguna de las 5 ramas
  originales lo había hecho tampoco, mismo motivo de siempre: sin `.env`
  en el worktree) — sigue pendiente, ahora acumulado en un solo lugar en
  vez de en 5 ramas separadas.
- **Rediseño visual (este commit):** aplicado sobre la combinación de
  arriba. Paleta y tokens derivados ya habían sido aprobados por el usuario
  en un mockup aparte antes de tocar código real (mismos valores acá, para
  que el mockup y la app real no diverjan):
  - Claro: fondo `#F4F1E8`, verde (ahora `--accent`) `#2D5A3D`, acento cálido
    nuevo (`--tono`) `#D4A574`. Oscuro: fondo `#1A2620`, verde `#7CB88F`,
    mismo `--tono`. El resto de los tokens (superficie, texto, bordes,
    semánticos danger/success/warning) se derivaron para buen contraste en
    los dos modos — quedaron documentados como comentario arriba del
    `:root` en `public/style.css`.
  - Se reusaron los NOMBRES de variable que ya existían (`--accent`,
    `--bg-elevated`, `--radius`, etc.) para no tener que tocar cada regla
    del archivo — solo los valores cambiaron. `--radius`/`--radius-sm`
    subieron de 10px/8px a 20px/14px ("bordes redondeados generosos").
    Reemplaza al tema oscuro anterior (rama-tema-chat/rama-visual) a
    propósito, como pide el enunciado — no quedaron los dos en paralelo.
  - **Toggle claro/oscuro: columna `usuarios.tema` (no localStorage).**
    Decisión: persiste entre dispositivos de la misma cuenta, y permite que
    el HTML salga del servidor ya con el `data-theme` correcto (script
    inline al principio de `partials/head.ejs`, antes del `<link
    rel="stylesheet">`) sin parpadeo del tema equivocado — con
    `localStorage` eso no es posible porque el servidor no sabe la
    preferencia al renderizar. Middleware nuevo expone `tema` a todas las
    vistas vía `res.locals` (una consulta liviana más por request
    logueado). Ruta nueva `POST /preferencia-tema`. Botón en
    `partials/nav.ejs` (ícono sol/luna según el tema ACTUAL, no el que se
    va a activar).
  - **Íconos SVG nuevos** (`views/partials/icono.ejs`, un solo set
    reusado en todo el proyecto, estilo lucide/heroicons outline 24x24):
    🔔→campana, 🗑️→papelera, ✔→check, ✓✓→doble-check, ❌→x, 🔐→candado,
    ✏️→lápiz, 🔥→llama, 📋→portapapeles, 💡→bombilla, ⚡→rayo, 🤝→personas,
    💬→chat, 📊→gráfico, 📥→descarga, 📅→calendario, ⏰→reloj, ⏳→arena
    (hourglass — distinto de "reloj" a propósito: posponer no es lo mismo
    que un recordatorio con hora fija), ← →→flecha-izq/flecha-der, más
    sol/luna para el toggle. **`●` (punto de "mensaje sin leer" en
    `chat.ejs`) se dejó como texto a propósito, no es emoji real** — es un
    carácter geométrico simple que ya hereda `var(--accent)` como
    cualquier texto, sin la inconsistencia visual entre plataformas que sí
    tienen los emoji de verdad (que es la razón real de reemplazarlos).
  - **Ilustración de monstera** (`views/partials/monstera.ejs`, un
    `<path>` de la hoja + `<mask>` con elipses para las fenestraciones) en
    los 3 lugares pedidos: estado vacío de pendientes (`index.ejs`, tanto
    el render inicial como el que arma el JS al completar el último
    pendiente — ver bug de abajo), `login.ejs`, `registro.ejs`. Favicon
    nuevo en `public/favicon.svg` (versión standalone, sin depender de
    variables CSS ya que un favicon se carga fuera del contexto de la
    página). **Los íconos PWA existentes (`public/icons/icon-192.png`,
    `icon-512.png`, PNG rasterizados) NO se regeneraron** — no es viable
    sin herramientas de imagen desde acá. Quedan pendientes de actualizar
    a mano con la ilustración nueva; mientras tanto el `manifest.json`
    sigue apuntando a los viejos (funcionan, solo no tienen el estilo
    nuevo).
  - Nombres de sección sin tocar (Pendientes, Ideas, Recordatorios, etc.)
    en las 15 vistas, incluidas las 6 que trajeron las otras ramas
    (`captura.ejs`, `chat-general.ejs`, `trazabilidad.ejs`,
    `recordatorios.ejs` con Google Calendar, etc.) — no eran parte del
    alcance original de la tarea 5 (se escribió antes de que existieran)
    pero quedarían visualmente a medias si no se tocaban también.
  - **Bug real encontrado y corregido durante la verificación (no por el
    render de EJS, que no lo detecta):** el estado vacío que arma
    `index.ejs` por JS (cuando se completa el último pendiente sin
    recargar la página) insertaba el SVG multi-línea de la monstera
    dentro de un string JS con comillas simples — comillas simples no
    aceptan saltos de línea crudos, así que el JS quedaba con un
    "Unterminated string literal" en el navegador aunque EJS lo renderizara
    sin error del lado del servidor. Se cambió esa asignación a un
    template literal (backticks). Después de esto, se extrajeron y
    validaron con `node --check` los 47 bloques `<script>` inline de las
    15 vistas (no solo la sintaxis EJS/HTML) para no repetir la misma
    clase de bug en otro lado.
  - Otro bug real, distinto (de EJS, no de JS): un comentario de
    documentación dentro de `views/partials/icono.ejs` incluía, como
    texto de ejemplo, la sintaxis literal `<%- include(...) %>` — el
    parser de EJS no entiende comentarios, así que interpretó eso como
    una tag real y rompió el balance de tags de TODO archivo que
    incluyera este partial (`Could not find matching close tag`). Se
    corrigió reescribiendo el comentario sin mostrar la sintaxis literal.
- **Verificación del rediseño visual:** `node --check server.js` limpio.
  Grep final de emoji (rango Unicode ampliado, no solo los 4 del
  enunciado original — la primera pasada con un rango más angosto se
  había comido ⏰/⏳ silenciosamente) sobre `server.js` y las 15 `.ejs`:
  cero coincidencias reales (el único resultado es el `●` documentado
  arriba). `ejs.renderFile(...)` con datos simulados para las 15 vistas,
  cubriendo también sus variantes de error/vacío/con-datos donde aplica:
  las 20 combinaciones renderizan sin error. Los 47 `<script>` inline
  resultantes se extrajeron y pasaron `node --check` uno por uno (detectó
  el bug del template literal, ver arriba). **Lo que NO se pudo probar**:
  contra la DB real (sigue sin `.env` en este worktree) y en un navegador
  de verdad — el toggle, el favicon, y que el `data-theme` server-side
  efectivamente evite el parpadeo, son cosas que solo se confirman
  mirando la app corriendo. Recomendado antes de mergear: abrir la app
  localmente, tocar el toggle unas cuantas veces, y mirar las 3
  ilustraciones de monstera.

### rama-moneda-virtual
- Estado: commiteada (sobre `rama-tema-jungla`, no rama propia), sin
  probar contra la DB real.
- Tarea: sistema de moneda virtual (tarea 7 del roadmap 2026-08-12) —
  depende de la tarea 6 (trazabilidad social), ya en esta misma rama.
- Decisiones numéricas (constantes nombradas en `server.js`, junto a la
  ruta `POST /pendientes/:id/completar`):
  - `MONEDA_POR_TAREA_ASIGNADA = 10`: monto base por tarea asignada
    completada. Número redondo, fácil de razonar; con esta base + bonus de
    racha, un día activo entre dos amigos (2-5 tareas) queda cómodo debajo
    del límite diario sin agotarlo de entrada.
  - `REPARTO_COMPLETA_PCT = 0.7` / `REPARTO_ASIGNO_PCT = 0.3`: tal cual pide
    el enunciado. En el código, la parte de quien asignó se calcula como
    `total - parteCompleta` (no `total * 0.3`) para que la suma de las dos
    partes nunca pierda una moneda por redondeo — verificado a mano con
    varios valores de racha (0, 1, 3, 7 días) antes de commitear.
  - `BONUS_MONEDA_POR_DIA_RACHA = 2`: se suma al pozo ANTES de repartir
    70/30 (no solo a quien completa), para que también le convenga a quien
    asigna sostener una racha real con su amigo. Racha reusa
    `calcularRacha`/`formatearDiaLima` ya existentes en `/estadisticas`,
    pero contada sobre `eventos_completado.fecha` (fecha de completado) en
    vez de `pendientes.creado`, con su propia columna
    `eventos_completado.cuenta_para_racha` (ver anti-granjeo abajo).
  - `LIMITE_MONEDA_DIARIA = 100` monedas ganadas por día por usuario
    (`origen = 'ganada'` solamente). Con la base+bonus de arriba, hacen
    falta varias tareas seguidas con racha alta en el mismo día para
    acercarse al límite — deja margen para un día muy activo sin ser
    efectivamente ilimitado. `pagarMoneda()` paga parcial si el límite ya
    está casi consumido, nunca niega la transacción entera.
  - `UMBRAL_ANTI_GRANJEO_MINUTOS = 10`: si se completa una tarea asignada
    antes de que pasen 10 minutos desde que `asignado_en` se marcó (columna
    nueva en `pendientes`, se setea en `POST /pendientes/:id/asignar`), se
    paga el monto base igual pero con bonus de racha en 0 y
    `cuenta_para_racha = FALSE` (no participa en el cálculo de racha
    futuro) — mismo espíritu que `VENCIDO_DIAS`: un número que ningún uso
    legítimo rural/familiar rozaría por accidente, pero que sí frena
    asignar-y-completar-al-toque para farmear.
- Modelo de datos: tabla nueva `moneda_transacciones` (log inmutable:
  usuario_id, cantidad, `origen` TEXT `'ganada'`/`'comprada'`, motivo,
  `evento_completado_id` opcional, fecha) MÁS `usuarios.saldo_moneda INT`
  (acumulado de lectura rápida, no hay que sumar el log cada vez). La
  columna `origen` ya distingue `ganada` de `comprada` desde ahora — eso lo
  pide explícitamente la tarea 8 más adelante ("modelo de datos preparado
  para compra futura con dinero real"), y no cuesta nada agregarla ya en
  vez de una migración después; nada de esta tarea escribe `'comprada'`
  todavía, queda reservado.
- Superficie visible (fuera del pedido explícito de la tarea, pero sin
  esto el sistema es invisible/no verificable): se agregó el saldo propio
  en `/trazabilidad` ("Tu saldo: N monedas", ícono nuevo `moneda` en
  `partials/icono.ejs`). La vista real de saldo/planta es tarea de la
  tarea 8, esto es solo un número de referencia.
- Archivos tocados: `server.js` (schema en `ensureSchema`, `asignado_en`
  en `/asignar`, constantes + helpers `rachaTareasAsignadas`/
  `monedaGanadaHoy`/`pagarMoneda`, `POST /pendientes/:id/completar`
  reescrita para pagar dentro de la misma transacción que ya insertaba en
  `eventos_completado`), `views/trazabilidad.ejs`, `views/partials/icono.ejs`.
- Qué se verificó: `node --check server.js` limpio; `ejs.renderFile` de
  `trazabilidad.ejs` en los 2 estados (con datos y con error) incluyendo el
  saldo nuevo; grep de emoji sobre todo `server.js` + `.ejs` en cero;
  matemática del reparto 70/30 verificada a mano para 4 valores de racha
  distintos, sin pérdida de redondeo en ningún caso. **No probado contra la
  DB real** (sin `.env` en este worktree) — falta confirmar en producción
  que el `ALTER TABLE`/`CREATE TABLE` corre limpio y que completar una
  tarea asignada de verdad acredita el saldo a las dos personas.

### rama-ia-companera-fase1
- Estado: commiteada, sin probar contra la DB real (mismo motivo de
  siempre — sin `.env` en este worktree).
- Tarea: IA compañera visual — Fase 1 (tarea 8 del roadmap 2026-08-12).
  Depende de la tarea 7 (moneda virtual), ya mergeada a `main`. Construida
  directo sobre `rama-tema-jungla` (sin rama aparte), igual que la 7.
- Decisiones numéricas y de modelado (tomadas antes de implementar):
  - **Curva de moneda por etapa: `[0, 50, 200, 500]`** (semilla/brote/
    joven/adulta). Progresiva a propósito (cada salto cuesta más que
    alcanzar el anterior). Pensada para uso real entre 2 amigos —
    `LIMITE_MONEDA_DIARIA = 100`/día de la tarea 7 es difícil de agotar
    todos los días, así que asumí un promedio más realista de 1-3 tareas
    asignadas completadas por día (~20-30 monedas/día): brote a los ~2
    días activos (una recompensa rápida y motivadora), joven a la ~1
    semana, adulta a las ~3 semanas (un logro real, no algo que se
    alcanza en un día).
  - **La etapa NO se persiste como columna** — se calcula en vivo
    (`etapaPorMoneda`) a partir de la moneda **ganada de por vida**
    (`origen IN ('ganada','comprada')` de `moneda_transacciones`), nunca
    del `saldo_moneda` gastable. Motivo: si la etapa dependiera del saldo
    actual, gastar moneda en un skin haría "retroceder" la planta —
    contraintuitivo y desalentaría gastar. Así, gastar nunca resta
    crecimiento, solo el saldo disponible para comprar cosas nuevas.
  - **Especie y nombre sí se persisten**: `usuarios.ia_especie` (elegida
    una sola vez, al registrarse, en `POST /registro`), `usuarios.
    ia_nombre` (editable libremente, gratis — es solo texto, no un
    recurso visual/funcional). `usuarios.ia_skin`/`ia_tema_extra` guardan
    la última compra activa de cada tipo (no hay inventario de varios
    skins simultáneos en esta fase, comprar uno nuevo reemplaza al
    anterior).
  - **Origen `'gastada'` nuevo en `moneda_transacciones.origen`** — la
    tarea 7 solo pedía distinguir `'ganada'` de `'comprada'` (para la
    compra futura de moneda con dinero real, todavía sin implementar).
    Hacía falta un tercer valor para registrar el GASTO de moneda en el
    mismo log en vez de abrir una tabla aparte; `cantidad` va negativa en
    esas filas. No es una columna nueva, solo un valor de texto más en
    una columna que ya no tenía `CHECK` — no hizo falta migración.
  - **Costos**: skin `30`, tema visual extra `60`, comodín "perdonar
    racha" `40` — números elegidos para que un skin sea alcanzable con
    2-3 tareas asignadas, y el comodín/tema un poco más esforzados sin
    ser inalcanzables. Constantes nombradas (`IA_COSTO_SKIN`, etc.), no
    números sueltos.
  - **El comodín de "perdonar racha" NO toca la racha de `/estadisticas`
    ni la de la tarea 7 que paga moneda** (`rachaTareasAsignadas`) — eso
    hubiera significado modificar lógica de pago ya probada, para una
    Fase 1 que ni siquiera tiene IA real todavía. En cambio, usarlo
    inserta una fila en una tabla nueva `racha_protecciones` (fecha
    "perdonada" para ese usuario) que SOLO afecta la racha que se
    muestra dentro de `/ia` (`observacionesIA`, que arma su propio set de
    días incluyendo los protegidos antes de llamar a `calcularRacha`).
    Documentado en el propio código. Si en el futuro se quiere que el
    comodín también proteja la racha de pago de la tarea 7, es un cambio
    aparte y deliberado, no algo que se coló acá.
  - Especies (`monstera`, `cactus`, `ficus`, `suculenta`) ilustradas en
    `views/partials/planta.ejs`, mismo patrón SVG que `partials/
    monstera.ejs` (de hecho la etapa "adulta" de la especie monstera
    reusa exactamente ese mismo `<path>`/`<mask>`, para quedar coherente
    con el resto de la marca). En la etapa "semilla" las 4 especies se
    ven iguales a propósito — todavía no hay nada que las distinga.
- Archivos tocados: `server.js` (schema, constantes `IA_*`,
  `etapaPorMoneda`, `monedaAcumuladaDeVida`, `gastarMoneda`,
  `observacionesIA`, rutas `GET /ia`, `POST /ia/nombre`, `POST
  /ia/comprar`, `POST /ia/usar-comodin`, `GET`/`POST /registro`
  ampliadas), `views/partials/planta.ejs` (nuevo), `views/ia.ejs`
  (nuevo), `views/registro.ejs` (selector de especie), `views/partials/
  nav.ejs` (link nuevo), `views/partials/icono.ejs` (ícono `planta`
  nuevo), `public/style.css` (`.especie-*`, `.ia-*`, con su bloque
  `prefers-reduced-motion` para la animación de transición de etapa).
- Qué se verificó: `node --check server.js` limpio; CSS con llaves
  balanceadas; `ejs.renderFile` de `registro.ejs` e `ia.ejs` (estado
  normal, etapa máxima, y camino de error) sin errores; las 16
  combinaciones especie×etapa de `partials/planta.ejs` renderizan y
  contienen un `<svg>` válido; grep de emoji sobre todo el proyecto en
  cero. **No probado contra la DB real** (sin `.env` en este worktree) —
  falta confirmar que las columnas/tabla nuevas migran limpio, que
  elegir especie al registrarse la guarda, y que gastar/ganar moneda
  mueve la etapa como se espera.

### rama-tema-jungla (limpieza)
- Estado: commiteada.
- Tarea: pasada de simplificación/optimización sobre todo lo agregado hoy
  (rango `2c929e6..HEAD`, tareas 3/4/5/6/7/8/10-esqueleto + chat general),
  escrito por agentes distintos que no se vieron entre sí — sin cambiar
  comportamiento, código ya en producción vía PR #36.
- Simplificado: `enviarPushATodos` y `enviarPushAUsuario` solo diferían en
  el WHERE de la consulta — el envío + limpieza de suscripciones muertas
  (404/410) era código idéntico duplicado. Factorizado en
  `enviarPushASubscripciones(rows, payloadObjeto)`, llamado por ambas con
  su propio SELECT. Firmas públicas y comportamiento sin cambios
  (verificado: mismos call sites, mismo shape de retorno `{enviadas,
  total}`).
- Evaluado y dejado como estaba (a propósito, forzar la unificación
  complicaba más de lo que simplificaba):
  - El `<mask>` de fenestraciones de monstera en `partials/monstera.ejs`
    vs. el de `partials/planta.ejs` (etapa adulta de la especie monstera):
    son dos ilustraciones independientes en contextos distintos (marca fija
    vs. tabla de 16 combinaciones especie×etapa) — compartir el `<mask>`
    real exigiría anidar un partial dentro de otro con scoping de id
    cruzado, más complejidad que las ~4 líneas que se ahorrarían.
  - Los dos cron (`revisarYNotificarSiNoHayHechosHoy` vs.
    `revisarYNotificarRecordatoriosPendientes`): estructura real distinta
    (uno chequea un conteo y manda un broadcast condicional, el otro itera
    N filas mandando push individual y actualizando cada una) — no hay
    abstracción común limpia que valga la pena.
  - Los `~9` queries secuenciales de `POST /pendientes/:id/completar`
    cuando hay `asignado_a` (UPDATE + INSERT evento + 2×pagarMoneda de 3
    queries cada uno + racha): parece mucho pero es una acción humana
    infrecuente (completar UNA tarea), no un path caliente — no es un N+1
    real, es una transacción con varios pasos. Priorizar claridad sobre
    ahorrar un par de queries acá no vale la pena.
- Sin bugs reales encontrados durante la revisión (solo la duplicación ya
  descrita, que es prolijidad, no un bug).
- Qué se verificó: `node --check server.js` limpio, confirmado que los 3
  call sites de `enviarPushATodos`/`enviarPushAUsuario` no cambiaron
  (mismos argumentos, mismo retorno desestructurado), grep de emoji sobre
  todo el proyecto en cero. No se tocó ninguna vista en esta pasada, así
  que los renders ya verificados en las secciones de arriba siguen
  vigentes.

### rama-ajustes
- Estado: en progreso.
- Tarea: tarea C de "Ronda — pulido y detalles de producto" (2026-08-13) —
  página de perfil/ajustes. Despachada en paralelo con las tareas A, B, D,
  E, F, G de la misma ronda, cada una en su propio worktree — no toca
  archivos fuera de su alcance.
- Decisiones (documentadas antes de escribir código, como pide la regla 8):
  1. **Ruta: `/ajustes`** — consistente con el resto de nombres de ruta en
     español de una sola palabra ya usados (`/amigos`, `/captura`,
     `/estadisticas`).
  2. **"Nombre visible" = `nombre_usuario`** (no un campo nuevo). Es el
     único nombre de cuenta que existe hoy — agregar un "display name"
     aparte hubiera sido una columna redundante. Reusa la misma validación
     de `/registro` (`NOMBRE_USUARIO_REGEX`, normalizado a minúsculas,
     mismo manejo del error `23505` por duplicado). También actualiza
     `req.session.nombre_usuario` de una vez, por consistencia con cómo lo
     graba `/login`/`/registro`, aunque hoy no se lea en ningún otro lado.
  3. **Cambiar de especie NO reinicia la etapa de la planta.** La etapa
     (`etapaPorMoneda`, tarea 8) se calcula siempre a partir de la moneda
     ganada de por vida (`moneda_transacciones`), nunca de `ia_especie` —
     cambiar la especie no toca esa tabla, así que la etapa sigue igual
     automáticamente. No hizo falta código extra para esto, solo
     confirmarlo y documentarlo.
  4. **Sonidos: `localStorage`, no columna en `usuarios`.** A diferencia
     del tema visual (que si vive en `usuarios.tema` para que el HTML
     salga del servidor ya correcto y no parpadee), la preferencia de
     sonido no afecta el HTML inicial en absoluto — solo si `public/
     sonidos.js` reproduce audio o no, una decisión 100% del lado del
     cliente. Guardar esto en el servidor no evitaría ningún parpadeo,
     solo agregaría una vuelta a la DB innecesaria. Clave
     `localStorage.sonidosActivos`, ausente o `'si'` = activado (default),
     `'no'` = desactivado. `reproducirSonido()` en `public/sonidos.js` **se
     modificó** para respetar esta bandera — si no, el toggle de esta
     página sería cosmético y no apagaría nada de verdad.
  5. **Desactivar notificaciones push = borrar la(s) fila(s) de
     `push_subscriptions`** del usuario actual, no una columna de opt-out
     nueva. Reactivar ya significa volver a tocar "Activar
     notificaciones", que vuelve a correr `POST /suscribir` — ese flujo ya
     existe y ya inserta si no hay fila, así que una columna de opt-out
     solo hubiera sido estado duplicado (¿la fila existe pero está
     "apagada", o no existe? dos formas de representar lo mismo). Borrar
     es más simple y coherente con que el propio `enviarPushASubscripciones`
     ya borra filas muertas (404/410) de la misma tabla.
  6. **Tema claro/oscuro/sistema: reusa `POST /preferencia-tema` tal
     cual**, sin ruta nueva — la página de ajustes solo muestra 3 opciones
     (claro/oscuro/sistema) que postean ahí, igual que ya hace el toggle
     del nav pero con las 3 opciones visibles en vez de solo alternar
     entre 2.
- Archivos tocados: `server.js` (rutas `GET /ajustes`, `POST /ajustes/
  nombre`, `POST /ajustes/especie`, `POST /ajustes/notificaciones`),
  `views/ajustes.ejs` (nuevo), `views/partials/nav.ejs` (link nuevo),
  `views/partials/icono.ejs` (ícono `ajustes` nuevo, engranaje estilo
  lucide), `public/sonidos.js` (respeta la bandera de `localStorage`),
  `public/style.css` (`.ajustes-*`, reusando los tokens ya existentes).
- Qué se verificó: `node --check server.js` limpio; `ejs.renderFile(...)`
  de `views/ajustes.ejs` con datos simulados realistas (con y sin
  suscripción push activa); grep de emoji sobre todo el proyecto en cero.
  Sin DB real en este worktree (sin `.env`, mismo motivo de siempre) — sin
  probar contra Postgres real.
- **NO PUSHEADO, SIN PR** — regla 8: el hilo principal muestra el diff
  completo al usuario y espera su "aprobado" antes de pushear/mergear.

### rama-integracion
- Estado: —
- Última acción: —
- Responsable de: revisar qué ramas están "lista para merge", mergear a main una por
  una en orden seguro, resolver conflictos, y registrar cada merge abajo.

## Historial de merges a main

(agregar una línea por cada merge realizado, con fecha, rama y resultado)

- 2026-08-11 — merge de rama-visual (6e3328f) → main: sin conflictos, probado
  localmente (login + / + style.css sirviendo bien), commit de merge 1707a86, pusheado.
- 2026-08-11 — merge de rama-chat (90f06ad) → main: sin conflictos con server.js
  (rama-visual no lo había tocado). Probado localmente tras el merge: login, 403 sin
  membresía en amistad_id, envío de mensaje real con membresía válida, y 403 sigue
  bloqueando después. Commit de merge f248c9c, pusheado.
- 2026-08-11 — merge de rama-fix-login-mayusculas (85b5d83) → main vía PR #1: sin
  conflictos. Desplegado en Railway y verificado en producción: login con
  "Bruce"/"BRUCE"/"bruce" (mayúsculas mixtas) funciona. Commit de merge 780bd7f.
- 2026-08-11 — merge de rama-notificaciones-integrada (05b4c10) → main vía PR #3:
  el PR original de rama-notificaciones (#2) quedó CONFLICTING solo por
  COORDINACION.md (dos ramas insertando su sección en el mismo punto del
  archivo — confirmado con diff3 que no había conflicto de código real). Se
  reconstruyó la rama desde main actualizado reaplicando el mismo código, se
  reprobó end-to-end contra la DB real, y se mergeó limpio. PR #2 cerrado sin
  mergear. Commit de merge b06b36e.
- 2026-08-11 — merge de rama-registro-integrada (138d9ae) → main vía PR #5: el
  PR original de rama-registro (#4) quedó CONFLICTING con un conflicto de
  código real (la misma línea de POST /login tocada por el hotfix y por esta
  rama). Se reconstruyó la rama desde main actualizado combinando ambos
  cambios a mano (`limitarIntentos('login')` + `.toLowerCase()`), se reprobó
  contra la DB real, y se mergeó limpio. PR #4 cerrado sin mergear. Commit de
  merge 6e3dd8b.
- 2026-08-11 — merge de rama-amigos-integrada (44dcd24) → main vía PR #6: el
  PR original de rama-amigos quedó CONFLICTING solo por COORDINACION.md
  (mismo patrón que rama-notificaciones). Se verificó antes de aplicar el
  ALTER TABLE que `amistades` estaba vacía en la DB real (0 filas). Se
  reconstruyó la rama desde main actualizado reaplicando el mismo código, se
  reprobó end-to-end contra la DB real (incluida la integración con
  GET /notificaciones ya mergeada), y se mergeó limpio. Commit de merge
  10c9a7e.
- 2026-08-11 — merge de rama-tema-chat (e6c51ee) → main vía PR #8: sin
  conflictos (mergeStateStatus CLEAN). Última tarea del backlog original
  (tema oscuro para chat.ejs) ya cerrada. Commit de merge e694dee.
- 2026-08-11 — merge de rama-estadisticas (515c6a8) → main vía PR #15: sin
  conflictos (CLEAN/MERGEABLE). Primera de 4 tareas delegadas en paralelo a
  agentes en worktrees separados. Commit de merge a85e7ce.
- 2026-08-11 — merge de rama-categorias-v2 (4b52c92) → main vía PR #18: el
  PR original de rama-categorias quedó CONFLICTING después del merge de
  rama-estadisticas (ambas tocaban `GET /` y `ensureSchema`). Reconstruida
  desde main actualizado (mismo patrón que rondas anteriores), reprobada y
  mergeada limpia. Commit de merge 3f499e4.
- 2026-08-11 — merge de rama-busqueda-v2 (7a05bbb) → main vía PR #19: el PR
  original de rama-busqueda quedó CONFLICTING tras rama-categorias-v2
  (ambas tocaban `GET /` y `views/index.ejs`). Reconstruida desde main
  actualizado combinando el filtro de categoría con la búsqueda por texto,
  reprobada y mergeada limpia. Commit de merge 91b6c64.
- 2026-08-11 — merge de rama-tareas-compartidas-v2 (e668857) → main vía PR
  #20: el PR original de rama-tareas-compartidas (#14) quedó CONFLICTING
  tras los tres merges anteriores. Reconstruida desde main actualizado
  (columna `asignado_a`, `usuariosSonAmigos()`, ruta `/pendientes/:id/
  asignar`, badge "Asignado por" + modo solo lectura en index.ejs, selector
  de amigos en editar.ejs). Verificada sintaxis (`node -c`) y renderizado de
  plantillas con datos simulados; NO se repitió la prueba end-to-end contra
  la DB real en esta reconstrucción (el worktree no tenía `.env`) — se
  mergeó con esa salvedad explícita, confirmada por el usuario. Commit de
  merge c56dc6c. Con esto, las 4 tareas delegadas en paralelo están
  mergeadas a main.
- 2026-08-12 — merge de rama-recuperacion-pin (912b745) → main vía PR #24:
  sin conflictos (mergeStateStatus CLEAN), CI (`verificar`) en verde. Cierra
  el último ítem del backlog original (código de recuperación de PIN).
  Probado end-to-end contra la DB real antes de abrir el PR (ver su sección
  arriba). Commit de merge 00ad9ce.
- 2026-08-12 — merge de rama-eliminar-pendientes (9d0e2ad) → main vía PR
  #27: sin conflictos (mergeStateStatus CLEAN), CI (`verificar`) en verde.
  Botón "Eliminar" con borrado lógico (columna `eliminado`), cierra la
  decisión pendiente anotada en la sección de rama-historial-ediciones.
  Probado end-to-end contra la DB real antes de abrir el PR (ver su sección
  arriba). Commit de merge 8894d7b.
- 2026-08-12 — merge de rama-fix-estadisticas (60e35bd) → main vía PR #29:
  sin conflictos (mergeStateStatus CLEAN), CI (`verificar`) en verde.
  Reconstruye `GET /estadisticas`, que se había perdido en un merge
  anterior — bug detectado y documentado por rama-eliminar-pendientes.
  Probado end-to-end contra la DB real con fechas controladas por SQL
  antes de abrir el PR (ver su sección arriba). Commit de merge 656e096.
- 2026-08-12 — merge de rama-fix-recuperar-pin (ead2985) → main vía PR #32:
  sin conflictos (mergeStateStatus CLEAN), CI (`verificar`) en verde. Tarea
  1 (SEGURIDAD, bloqueante) del roadmap 2026-08-12: `/recuperar` ahora
  exige PIN actual + código, cierra el hueco de reseteo de PIN ajeno.
  Desbloquea la tarea 2 (registro público) del mismo roadmap. Probado
  end-to-end contra la DB real antes de abrir el PR (ver su sección
  arriba). Commit de merge 0fd4410.
- 2026-08-12 — merge de rama-limite-registro (a7d868e) → main vía PR #34:
  sin conflictos (mergeStateStatus CLEAN), CI (`verificar`) en verde. Tarea
  2 del roadmap 2026-08-12: límite de 5 cuentas nuevas exitosas por IP/hora,
  independiente del límite de intentos ya existente. Probado end-to-end
  contra la DB real antes de abrir el PR (ver su sección arriba) y
  verificado en producción. Commit de merge 752a1cd.
- 2026-08-12 — merge de rama-tema-jungla (b42d3bd) → main vía PR #36
  (mergeStateStatus CLEAN): combina las tareas 3 (captura rápida), 4
  (push recordatorios), 6 (trazabilidad social), 10 (Google Calendar,
  **solo esqueleto sin probar**), chat general (fuera del roadmap
  numerado), 5 (rediseño visual "Jungla/Monstera") y 7 (moneda virtual)
  — 5 ramas independientes reconciliadas a mano (sin `git merge`, ver
  sección `rama-tema-jungla` arriba) más el tema visual y la moneda
  construidos encima. **A diferencia de los merges anteriores de esta
  tabla, este NO se probó contra la DB real antes de mergear** — solo
  `node --check` + `ejs.renderFile` con datos simulados en cada paso.
  Pendiente urgente post-merge: confirmar que las migraciones nuevas
  (`push_subscriptions.usuario_id`, `mensajes_generales`,
  `eventos_completado`, `moneda_transacciones`,
  `usuarios.saldo_moneda`/`tema`, `google_calendar_tokens`, etc.) corren
  limpio contra Railway, y mirar el rediseño visual en un navegador de
  verdad por primera vez. Commit de merge f6a2847.
- 2026-08-13 — merge de rama-tema-jungla (segunda tanda, 03d3929) → main
  vía PR #37 (mergeStateStatus CLEAN): tarea 7 (moneda virtual), tarea 8
  (IA compañera visual — Fase 1), una limpieza de duplicación entre
  `enviarPushATodos`/`enviarPushAUsuario`, y un fix real encontrado
  recién en esta ronda — el campo de fecha de Captura rápida se
  mostraba siempre en vez de solo al elegir "Recordatorio" (`.captura-
  cuando { display: flex }` le ganaba al atributo `hidden` en la
  cascada). **A diferencia del merge anterior (f6a2847), este sí se
  probó contra la DB real y en un navegador de verdad**, con
  capturas de pantalla: login, Pendientes, Captura rápida, Mi planta,
  Chat general, Recordatorios, Amigos y Estadísticas, en claro y
  oscuro, con la cuenta real de producción. Health-check post-merge:
  `/login` → 200. Pendiente: confirmar a mano que el campo de fecha
  aparece al tocar "Recordatorio" (la prueba automatizada de esa
  interacción puntual no pudo completarse por un problema de
  herramientas, no del código); probar la moneda/IA con dos usuarios
  reales completando tareas asignadas entre sí; una fila con texto muy
  largo en Pendientes se ve rara (preexistente, no introducido por
  este PR). Commit de merge 84a415e.

## Receta: reconstruir una rama sobre main actualizado (PR quedó CONFLICTING)

Este patrón se usó y funcionó de forma confiable 4 veces seguidas (rama-notificaciones-integrada,
rama-registro-integrada, rama-categorias-v2, rama-busqueda-v2, rama-tareas-compartidas-v2). NO
intentes arreglar el PR viejo con un commit encima — falla incluso cuando el contenido final es
compatible, porque el merge de 3 vías se confunde con el historial divergente. Reconstruye la
rama entera desde main actualizado:

1. `git checkout -b rama-<feature>-v2 origin/main` (si ya existe un -v2, sube el número).
2. Trae el código ya probado de la rama vieja SOLO para copiar/entender, no para mergear:
   `git show origin/rama-<feature>:pendientes-web/server.js > /tmp/mt/old_server.js` (y lo mismo
   para cualquier otro archivo tocado). En Windows, usa la ruta real
   `C:/Users/.../AppData/Local/Temp/mt/...`, no `/tmp/...` — Node no la resuelve igual.
3. Antes de leer/diffear archivos completos: corre `git diff --stat origin/main -- <archivo>` para
   ver cuánto cambió. Si el archivo es grande (como `style.css`), NO vuelques el diff completo —
   lee solo la cola nueva o usa un diff acotado. Volcar diffs enteros innecesarios es la forma más
   rápida de inflar el contexto sin necesidad.
4. Aplica a mano (Edit tool) solo los cambios reales de la rama vieja sobre el `server.js`/vistas
   actuales de main, entendiendo la intención de cada lado — no un merge automático.
5. Para `COORDINACION.md`: extrae SOLO la sección propia de la rama vieja (el bloque
   `### rama-<feature>` hasta el siguiente `### `) con un script Node chico que busque el heading
   anclado a salto de línea (`'\n### rama-<feature>'`, nunca sin el `\n` — un match sin anclar
   puede caer dentro de una mención entre comillas en otra sección) e insértalo en el
   `COORDINACION.md` actual de main, justo antes de `### rama-integracion`.
6. `node -c server.js` para sintaxis. Si hay vistas EJS nuevas/tocadas, valídalas con
   `ejs.render(...)` y datos simulados (sin necesitar la DB) antes de gastar una prueba real.
7. Prueba end-to-end contra la DB real SOLO si tienes `.env` en ese worktree (los worktrees no lo
   traen por defecto, está en `.gitignore` a propósito). Si no lo tienes, dilo explícitamente al
   reportar en vez de saltarte la prueba en silencio, y que el usuario decida si mergea igual.
8. **Commit local, pero todavía NO push ni PR.** Primero mostrale al usuario el diff completo
   (`git diff <punto-de-partida>..HEAD`, no un resumen) de lo que vas a llevar a producción, y
   esperá un "aprobado" explícito sobre ESE diff (ver regla 8 de "Reglas para cualquier sesión",
   arriba — una instrucción general dada antes de ver el diff no alcanza). Si combinaste más de
   una rama en este proceso, este es el diff de la combinación completa, no de una rama sola.
9. Recién con el "aprobado": push, `gh pr close <viejo> --comment "..."`, `gh pr create`, verifica
   `gh pr view <nuevo> --json mergeable,mergeStateStatus` da CLEAN/MERGEABLE, luego
   `gh pr merge <nuevo> --merge --delete-branch=false`.
10. Registra el merge en "Historial de merges a main" (arriba) con el hash del commit de merge.

### Para varias ramas en conflicto entre sí (delegación en paralelo)

Si vas a reconstruir varias ramas seguidas (porque se delegaron en paralelo y ahora chocan entre
sí), NO lo hagas todo en un solo hilo largo — cada reconstrucción sucesiva arrastra el contexto
(diffs, lecturas, pruebas) de las anteriores aunque ya no las necesite, y eso es lo que más
infla el costo en tokens. Mejor:

- Delega cada reconstrucción a un agente/subagente nuevo (Agent tool, `isolation: "worktree"`),
  aunque tengan que correr en orden (cada uno depende de que main ya tenga el merge anterior) —
  no hace falta que sean paralelos entre sí para ahorrar, el ahorro viene de que cada uno arranca
  con contexto limpio y solo devuelve un resumen corto al hilo principal.
- Dale a cada agente un prompt autocontenido: qué rama reconstruir, qué archivos tocó
  originalmente (según su propia sección en COORDINACION.md), y que siga esta receta.
- El hilo principal (rama-integracion) solo necesita el resumen de cada uno para decidir el
  siguiente paso, no los diffs ni las pruebas completas.
- **El paso 8/9 de la receta (mostrar el diff completo y esperar "aprobado" antes de
  push/PR/merge) lo hace el hilo principal, con el usuario, no cada subagente por su
  cuenta.** Un subagente puede commitear localmente, pero no debe pushear, abrir PR, ni
  mergear — eso queda para cuando el hilo principal junte el resultado final (de una rama
  o de varias combinadas) y lo muestre completo al usuario.

## Onboarding para una sesión nueva (nuevo "trabajador")

Si eres una sesión de Claude Code nueva que se acaba de abrir en este repo:

1. Lee este archivo completo antes de escribir código.
2. Corre `git log --oneline -10` y `git branch -a` para ver el estado real.
3. Busca tu tarea en la sección "Backlog de tareas" de abajo. Si el usuario ya te dio
   una tarea directamente en el chat, usa esa en vez del backlog.
4. Crea tu worktree desde `main` actualizado (NUNCA `git checkout` directo en
   `C:\Users\lenovo\Desktop\a` — ver regla 2 de arriba):
   ```
   cd "C:\Users\lenovo\Desktop\a"
   git fetch origin
   git worktree add "C:\Users\lenovo\Desktop\a-worktrees\rama-<nombre-corto>" -b rama-<nombre-corto> origin/main
   ```
   Luego `cd` a esa carpeta nueva y trabaja siempre desde ahí. Copia
   `pendientes-web\.env` a tu worktree a mano si necesitas correr el server
   localmente (no está en git, cada worktree necesita su propia copia; y ojo,
   una sesión con el deny de `*.env*` activo no va a poder copiarlo ella
   misma — hazlo tú o pídeselo a una sesión sin esa restricción). También
   corre `npm install` en `pendientes-web/` dentro de tu worktree — los
   `node_modules` tampoco se comparten entre worktrees.
5. Agrega tu sección en "Estado de ramas" con tu tarea y estado "en progreso" ANTES
   de escribir código.
6. Mueve tu tarea del backlog a "en progreso" (o táchala con ~~texto~~) para que
   nadie más la tome por error.
7. No toques archivos fuera de tu tarea. Si necesitas tocar algo que otra rama ya
   está usando, avisa aquí y espera confirmación del usuario antes de seguir.
8. Al terminar, actualiza tu sección con qué hiciste, archivos tocados, hash del
   commit, y cualquier hueco o pendiente que quede.
9. No mergees a main tú mismo — eso lo hace rama-integracion, o el usuario lo pide
   explícitamente.

## Backlog de tareas (agregar aquí antes de asignar a una rama nueva)

Formato: `- [ ] Descripción corta — asignada a: (rama, o "sin asignar")`

- [ ] Sin asignar — ejemplo de cómo agregar una tarea nueva aquí
- [x] BUG: `GET /estadisticas` no existe en `server.js` (404 confirmado en
  producción y local) aunque `views/estadisticas.ejs` y el link de nav
  siguen ahí — se perdió en algún merge/reconstrucción posterior a
  rama-estadisticas (PR #15). — tomada por rama-fix-estadisticas
- [x] Registro público de usuarios + rate limiting básico en login/registro — tomada por rama-registro
- [x] Notificaciones/marcar como leído en el chat (usar columna `leido` ya
  existente en tabla mensajes) — tomada por rama-notificaciones
- [x] Aplicar tema visual oscuro a views/chat.ejs (creado después de rama-visual,
  no tenía el estilo aplicado) — tomada por rama-tema-chat
- [x] Código de recuperación de PIN: generarlo una sola vez al crear la cuenta
  (`POST /registro`), mostrárselo al usuario UNA vez justo después de registrarse
  (no queda guardado en texto plano — igual que el PIN, se guarda hasheado en una
  columna nueva, ej. `codigo_recuperacion_hash`), y una ruta nueva tipo
  `GET/POST /recuperar` que permita fijar un PIN nuevo si se ingresa el código
  correcto para ese usuario. Objetivo: que nadie quede bloqueado de su propia
  cuenta si olvida el PIN (ya casi pasó una vez en esta sesión). Sin tocar el
  rate limiting ya existente (`limitarIntentos`) ni las rutas /login o /registro
  más allá de lo necesario para generar el código. — tomada por rama-recuperacion-pin
- [ ] **Chat general: una sola sala para todos los usuarios registrados.**
  Distinto del chat 1-a-1 que ya existe (`amistades`/`mensajes`,
  `usuarioPerteneceAmistad`): acá NO hace falta ser amigos para verse — todo
  usuario logueado participa en la misma sala. Pedido por el usuario el
  2026-08-12, no depende de ninguna tarea del roadmap grande de esa misma
  fecha (puede arrancar en cualquier momento, en paralelo con cualquier otra
  rama activa) y tampoco está incluido en ese "Plan de despacho" — es un
  ítem aparte.
  - Esquema sugerido (decidir y documentar al implementar, mismo criterio
    que el resto del roadmap): tabla nueva `mensajes_generales` (id,
    autor_id, texto, fecha) — NO reusar `mensajes`, que está atada a
    `amistad_id` y no tiene sentido para una sala sin amistad de por medio.
  - Decidir si hay o no indicador de "no leídos" para la sala general (el
    chat 1-a-1 lo tiene vía columna `leido` por mensaje — con potencialmente
    todos los usuarios de la app en una sola sala, marcar leído por mensaje
    y por usuario puede no escalar igual; una alternativa más simple es un
    timestamp `visto_hasta` por usuario y contar mensajes más nuevos que
    eso). Documentar la elección y el porqué.
  - Decidir paginación/límite de mensajes mostrados (una sala compartida por
    todos crece más rápido que un chat 1-a-1) — no cargar el historial
    completo siempre.
  - Reusar el estilo visual ya existente de `views/chat.ejs` (burbujas,
    tema oscuro de rama-tema-chat) en vez de reinventar un diseño nuevo.
  — asignada a: `rama-chat-general` (commiteada, sin probar contra la DB
  real — ver su sección en "Estado de ramas") — Depende de: nada.
  - Nota: este ítem se agregó primero en `rama-notificaciones-recordatorios`
    (commit 5aa4c0c) y por separado, a mano, en `rama-chat-general` (que no
    dependía de esa rama) — al combinar todo en `rama-tema-jungla` quedó
    una sola copia, ya no hace falta la nota de duplicación.

### Ronda nueva (2026-08-11) — propuesta por el usuario, mejoras a definir por rama

- [x] Categorías/etiquetas en pendientes: agregar columna `categoria` (o tabla
  aparte) a la tabla `pendientes`, UI para asignar categoría al crear/editar
  una tarea, y filtro por categoría en la vista principal (`/`). — tomada por
  rama-categorias-v2
- [x] Tareas compartidas con amigos: permitir asignar un pendiente a un amigo
  (no solo verlo uno mismo) — requiere columna tipo `asignado_a` en
  `pendientes` y reusar la tabla `amistades`/`usuarioPerteneceAmistad` ya
  existente para validar que solo se puede compartir con un amigo real. —
  tomada por rama-tareas-compartidas-v2
- [x] Búsqueda de texto en pendientes y en el chat: input de búsqueda en `/`
  que filtre pendientes por texto, e input de búsqueda en `/chat` que filtre
  mensajes por texto dentro de una amistad. — tomada por rama-busqueda-v2
- [x] Panel de estadísticas: nueva ruta `/estadisticas` con métricas simples
  (tareas completadas por semana, pendientes vencidos, racha de días
  seguidos completando algo), reusando datos ya existentes en `pendientes`
  (no requiere tablas nuevas). — tomada por rama-estadisticas

Nota de coordinación: las 4 tareas de esta ronda tocan `server.js` y
probablemente `views/index.ejs`/`views/chat.ejs` en zonas distintas — cada
rama debe anotar en su sección de "Estado de ramas" exactamente qué rutas y
qué parte del archivo toca, apenas empiece, para anticipar conflictos igual
que en la ronda anterior.

### Ronda nueva (2026-08-12) — roadmap grande, propuesta por el usuario

Diez tareas nuevas, con dependencias explícitas entre varias. Antes de asignar
cualquiera de estas a una rama: **leé el plan de despacho completo abajo**, no
solo la tarea individual — el orden importa y algunas están bloqueadas hasta
que otra termine.

**Regla para quien tome cualquiera de estas tareas:** actualizá tu sección en
"Estado de ramas" (arriba) ANTES de escribir código, y documentá ahí mismo
cualquier decisión de diseño (esquema de tablas, límites numéricos, balances
de moneda, etc.) **antes** de implementarla — no después. Esta ronda tiene
varias tareas que piden explícitamente "decide el número, documenta el
porqué": esa decisión se toma y se registra en el momento de implementar esa
tarea puntual, no antes (yo no la resolví al armar este backlog, a propósito,
para no adivinar un número sin estar viendo el código real en ese momento).

#### Plan de despacho (orden real de construcción, decidido respetando las dependencias marcadas)

```
Fase 0 (bloqueante, primero, nada de registro público sin esto)
  └── 1. Fix /recuperar: exigir PIN actual + código

Fase 1 (gateada por Fase 0 — no deploy hasta que 0 esté confirmado)
  └── 2. Registro público + límite por IP/hora

Fase 2 (sin dependencias, puede arrancar en paralelo con 0/1)
  └── 3. Chat de captura rápida (Pendiente/Idea/Recordatorio)

Fase 3 (depende de 3)
  └── 4. Notificaciones push para recordatorios

Fase 4 (ambas dependen SOLO de 4, pueden correr en paralelo entre sí)
  ├── 6. Tareas asignadas + trazabilidad social
  └── 10. Integración Google Calendar

Fase 5 (depende de 6)
  └── 7. Sistema de moneda virtual

Fase 6 (depende de 7)
  └── 8. IA compañera visual — Fase 1

Bloqueada indefinidamente, NO despachar todavía
  └── 9. IA compañera conversacional — Fase 2 (requiere modelo de ingresos
        definido por el dueño del proyecto; no hay fecha)

Sin dependencias funcionales, pero despachar AL FINAL a propósito
  └── 5. Rediseño visual "Jungla/Monstera"
```

**Por qué el rediseño visual (tarea 5) va al final aunque no depende de nada
técnicamente:** toca "TODOS los .ejs y server.js" para reemplazar cada emoji
por un ícono SVG — si se despacha en paralelo con cualquier otra tarea de esta
ronda, cada rama nueva que agregue una vista o un botón (captura rápida,
trazabilidad social, IA) va a chocar con ella constantemente y forzar
reconstrucciones repetidas (el mismo problema que ya vivimos con la ronda de
categorías/búsqueda/estadísticas en paralelo). Mejor esperar a que el resto
del roadmap funcional esté estable y aplicar el rediseño en una sola pasada
sobre una base quieta. Es una decisión de orden de despacho, no de prioridad:
el usuario puede pedir adelantarla si quiere verla antes.

**Por qué Google Calendar (10) puede ir en paralelo con trazabilidad social/
moneda/IA (6→7→8) y no en la misma cadena:** el enunciado original solo la
hace depender de notificaciones push (4), no de trazabilidad social — son
subsistemas independientes que comparten la infraestructura de push pero no
se tocan entre sí (uno lee `pendientes`/`amistades`, el otro habla con la API
de Google). Separarlas en dos cadenas paralelas después de la Fase 3 acorta
el tiempo total sin generar conflictos de archivo entre ellas.

---

- [x] **1. [SEGURIDAD, bloqueante] Arreglar `/recuperar` para exigir el PIN
  actual ADEMÁS del código de recuperación.** Ahora mismo `/recuperar` solo
  pide `nombre_usuario` + código — cualquiera que tenga el código puede
  resetear el PIN sin saber el PIN actual (documentado como hueco conocido
  en la sección de rama-recuperacion-pin, arriba). Agregar un campo más al
  formulario y a la validación del backend: el PIN actual también debe
  verificar contra `pin_hash` con `verificarPin()`, además del código contra
  `codigo_recuperacion_hash`. Si CUALQUIERA de los dos falla, mismo error
  genérico que ya existe ("Usuario o código incorrecto") para no revelar
  cuál de los dos fue. Probar con un usuario descartable que: código
  correcto + PIN viejo incorrecto → falla; código incorrecto + PIN correcto
  → falla; ambos correctos → funciona igual que antes (PIN nuevo + código
  nuevo). — asignada a: sin asignar (sugerido: `rama-fix-recuperar-pin`)
  — Depende de: nada. Bloquea: tarea 2 (no deploy de registro público sin
  esto confirmado).

- [x] **2. Confirmar/ajustar registro público + límite por IP/hora.** Nota
  importante para quien tome esto: `POST /registro` **ya existe y ya es
  público** (sin invitación, sin sesión previa — ver el middleware de
  autenticación en `server.js`), y ya pasa por `limitarIntentos('registro')`
  (8 intentos cada 15 min por IP — ver la constante `LIMITE_INTENTOS`).
  Esa protección ya existe pero está pensada contra fuerza bruta de login,
  no específicamente contra spam de cuentas nuevas — evaluar si 8/15min
  (≈32/hora) es un límite razonable específicamente para *registros exitosos*
  o si hace falta uno más estricto y separado solo para altas de cuenta
  (decidir el número en el momento de implementar, documentarlo acá con el
  porqué, igual que pide el enunciado original). — asignada a: sin asignar
  (sugerido: `rama-limite-registro`) — Depende de: tarea 1, **ya resuelta y
  confirmada en producción** (PR #32, commit de merge 0fd4410, ver Historial
  de merges) — el bloqueo de despliegue ya no aplica, esta tarea queda libre
  para tomarse y desplegarse normalmente.

- [ ] **3. Chat de captura rápida.** Input tipo chat de texto libre, con
  botones debajo (Pendiente / Idea / Recordatorio) para clasificar antes de
  enviar. Decidir en el momento de implementar el esquema más limpio (tabla
  única con columna `tipo`, o mantener las 3 tablas separadas `pendientes`/
  `ideas`/`recordatorios` ya existentes e insertar en la que corresponda
  según el botón elegido) y documentar esa decisión acá antes de escribir el
  `ensureSchema()`. Sonido distinto según acción (enviar, completar,
  eliminar): usar audios cortos con licencia libre (mixkit.co,
  freesound.org) — **nunca generarlos ni usar ninguno sin verificar la
  licencia primero**, documentar de dónde salió cada archivo de audio usado.
  Si el tipo elegido es "Recordatorio", pedir fecha/hora antes de guardar. —
  asignada a: `rama-captura-rapida` (commiteada, falta prueba end-to-end
  contra la DB real — ver su sección en "Estado de ramas") — Depende de:
  nada, puede arrancar en paralelo con 1/2.

- [ ] **4. Notificaciones push para recordatorios.** Depende de la tarea 3
  (necesita que existan recordatorios con fecha/hora capturados desde el
  chat rápido, o al menos la tabla/columna de recordatorios ya definida por
  esa tarea). Web Push API vía el paquete `web-push` (ya está en
  `package.json`, ya se usa para el recordatorio diario genérico — ver
  `enviarPushATodos()` en `server.js`). Las VAPID keys son secretas: van en
  `.env` (ya existen `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`), nunca
  hardcodeadas ni comiteadas. Falta: pedir permiso de notificaciones desde
  el frontend específicamente para recordatorios (ya existe un botón
  genérico "Activar notificaciones" en `index.ejs`, evaluar si se reusa o se
  separa), guardar la suscripción (ya existe `push_subscriptions`, evaluar
  si alcanza o hace falta asociarla a `usuario_id`), y un proceso (cron,
  mismo patrón que `revisarYNotificarSiNoHayHechosHoy` con `node-cron`) que
  revise recordatorios pendientes y dispare la notificación a la hora
  indicada. — asignada a: `rama-notificaciones-recordatorios` (commiteada,
  sin probar contra la DB real — ver su sección en "Estado de ramas") —
  Depende de: tarea 3.

- [ ] **5. Rediseño visual "Jungla/Monstera".** Paleta modo claro (fondo
  `#F4F1E8`, verde `#2D5A3D`, acento `#D4A574`) y modo oscuro (fondo
  `#1A2620`, verde `#7CB88F`, mismo acento `#D4A574`). Toggle claro/oscuro
  guardado en preferencia del usuario (columna nueva en `usuarios`, o
  `localStorage` — decidir y documentar en el momento). Ilustración SVG de
  hoja de monstera (con fenestraciones) en: estado vacío de pendientes,
  login/registro, favicon. Mantener los nombres de sección normales
  (Pendientes, Ideas, Recordatorios) — el tema visual cambia colores/iconos,
  no la terminología. Bordes redondeados generosos. Reemplazar TODOS los
  emojis existentes por íconos SVG en línea coherentes con la paleta
  (lucide-icons o heroicons, MIT/libre): 🔔 → campana, 🗑️ → papelera, ✔ →
  check, ✓✓ → doble check — revisar TODO `server.js` y TODOS los `.ejs`
  (incluidos partials) para no dejar ningún emoji suelto, `npm run ci` no
  detecta esto porque no es un error de sintaxis, hay que revisarlo a mano
  o con un grep de emojis antes de dar la tarea por terminada. **NO
  reemplazar el tema oscuro ya existente (de rama-tema-chat/rama-visual) sin
  coordinarlo — esta tarea lo reemplaza/actualiza a propósito, no es un
  conflicto, es la continuación esperada.** — asignada a: `rama-tema-jungla`
  (commiteada, sin probar en navegador ni contra DB real — ver su sección
  en "Estado de ramas") — Depende de: nada funcionalmente, pero
  **despachar al final** (ver "Plan de despacho" arriba, razón documentada
  ahí).

- [ ] **6. Tareas asignadas: marcar como hecha + trazabilidad social.** Botón
  "Completar" visible SOLO para la persona asignada (ahora mismo
  `views/index.ejs` le muestra "Solo lectura" sin ningún botón — hay que
  agregar uno nuevo, sin tocar el `POST /pendientes/:id/completar` existente
  que sigue exigiendo `usuario_id = req.usuarioId`; este nuevo botón necesita
  su propia ruta o ampliar esa con `OR asignado_a = req.usuarioId`, decidir y
  documentar cuál). Al completar, permitir un comentario opcional de texto
  (sin foto) — columna nueva, decidir dónde (¿tabla `pendientes` o una nueva
  tabla de eventos de trazabilidad? documentar). Guardar quién completó y
  cuándo, visible para ambos usuarios de la amistad. Agregar feed de
  actividad compartido (últimos 7–14 días, paginado — decidir el rango
  exacto y el tamaño de página, documentar el porqué). Agregar contador de
  "tareas completadas esta semana" por persona (mismo criterio de semana que
  ya usa `/estadisticas` — reusar, no reinventar). Notificación push al
  completar: cuando alguien completa una tarea que otro le asignó, quien
  asignó recibe una notificación reusando `enviarPushATodos` (o una variante
  que envíe a un solo usuario en vez de a todos — probablemente hace falta
  esa variante, evaluar). — asignada a: `rama-trazabilidad-social`
  (commiteada, sin probar contra la DB real — ver su sección en "Estado de
  ramas") — Depende de: tarea 4 (notificaciones push).

- [ ] **7. Sistema de moneda virtual.** Moneda ganada al completar una tarea
  asignada (no una tarea propia — solo las que vienen de `asignado_a`, para
  que tenga sentido social), con bonus por racha (reusar el concepto de
  racha ya definido en `/estadisticas`, adaptado a "racha completando tareas
  asignadas" si es distinto de la racha general — documentar la diferencia
  si la hay). Reparto 70% quien completa / 30% quien asignó — constantes
  nombradas, no números sueltos en el código. Límite de moneda ganable por
  día: decidir el número en el momento de implementar y documentar el
  porqué (pensar en cuántas tareas asignadas reales se esperan por día entre
  dos amigos para que el límite no se sienta arbitrario). Anti-granjeo:
  no contar hacia la racha ni pagar el bonus completo tareas completadas en
  un tiempo sospechosamente corto desde que fueron asignadas — decidir el
  umbral de tiempo mínimo y documentarlo (con el mismo espíritu que
  `VENCIDO_DIAS` en estadísticas: una constante nombrada y explicada). —
  asignada a: `rama-moneda-virtual` (commiteada sobre `rama-tema-jungla`,
  sin probar contra la DB real — ver su sección en "Estado de ramas") —
  Depende de: tarea 6.

- [ ] **8. IA compañera visual — Fase 1.** Selección de especie de planta al
  registrarse (monstera, cactus, ficus, suculenta — mínimo 4 opciones), cada
  una con su set de ilustraciones para etapas de crecimiento (semilla →
  brote → joven → adulta). Crece según moneda acumulada: decidir un balance
  razonable de moneda necesaria por etapa en el momento de implementar y
  documentar el razonamiento (probablemente progresivo, cada etapa cuesta
  más que la anterior — decidir la curva exacta ahí, no acá). Ventana "IA en
  construcción" mostrando la etapa actual (placeholder de la Fase 2, sin
  conversación real todavía). Observaciones basadas en datos propios del
  usuario (patrones de horario, frecuencia, racha) — estadística simple
  sobre las tablas ya existentes, **sin llamar a ningún modelo de IA en esta
  fase**. Animación suave de transición entre etapas (CSS, respetar
  `prefers-reduced-motion` igual que el resto de la app). Usos de la moneda:
  cambiar skin/nombre/personalidad de la IA, comodines funcionales (perdonar
  una tarea vencida sin romper la racha), temas visuales adicionales.
  **Dejar el modelo de datos preparado para compra futura de moneda con
  dinero real** (columna de origen en la tabla de moneda: `ganada` vs
  `comprada`, o un enum — decidir y documentar) **pero sin integrar ningún
  proveedor de pagos todavía** — eso no es parte de esta tarea. — asignada a:
  `rama-ia-companera-fase1` (commiteada, sin probar contra la DB real —
  ver su sección en "Estado de ramas") — Depende de: tarea 7.

- [ ] **9. [BLOQUEADA — no despachar todavía] IA compañera conversacional
  real — Fase 2.** Integrar la API de Claude para que la planta hable de
  verdad con el usuario. Depende de que exista un modelo de ingresos activo
  (ej. suscripción/premium) — **el dueño del proyecto no lo ha definido
  todavía, así que esta tarea no se asigna a ninguna rama hasta que exista
  esa decisión de negocio.** Cuando se desbloquee: hay costo real por uso,
  definir antes de lanzar un límite de mensajes por usuario/día y si el
  acceso es exclusivo de usuarios con suscripción activa. La API key de
  Claude es secreta: va en `.env`, nunca hardcodeada ni comiteada.
  Documentar en esta misma sección de `COORDINACION.md` el costo estimado
  por usuario activo (mensajes/día × precio por token, con la referencia de
  precios vigente en ese momento) **para aprobación explícita del dueño del
  proyecto antes de lanzar** — no desplegar solo con la aprobación de la
  sesión que la construya. — asignada a: sin asignar, NO tomar hasta nuevo
  aviso — Depende de: decisión de negocio externa (modelo de ingresos), no
  de otra tarea de este backlog.

- [ ] **10. Integración con Google Calendar.** OAuth explícito, mismo patrón
  que cualquier conector tipo Claude (pantalla de consentimiento clara,
  scope mínimo necesario). La IA (o, si la Fase 1 de la tarea 8 todavía no
  está lista, un botón manual) crea eventos en el calendario a partir de un
  recordatorio. Registrar la app en Google Cloud Console; `client_id` y
  `client_secret` en `.env`, nunca hardcodeados ni comiteados. Botón para
  desconectar la integración. Token de acceso (y refresh token) **cifrado en
  la base de datos, nunca en texto plano** — decidir el mecanismo de cifrado
  en el momento de implementar (ej. `crypto.createCipheriv` con una clave en
  `.env` separada de las demás) y documentarlo. Cada usuario solo accede a
  SU PROPIO calendario — validar en cada llamada con el mismo criterio que
  ya usa `usuarioPerteneceAmistad()` (nunca confiar en un id que venga del
  cliente sin cruzarlo contra la sesión). Esta es la primera de una fase
  futura de integraciones — Gmail y Spotify quedan explícitamente para
  después, no se abren en esta tarea. — asignada a: `rama-google-calendar`
  (ESQUELETO SIN PROBAR, ver su sección en "Estado de ramas" — falta que el
  dueño del proyecto genere credenciales reales de Google Cloud Console) —
  Depende de: tarea 4 (notificaciones push). Puede
  correr en paralelo con las tareas 6/7/8 (cadena de trazabilidad social),
  no depende de ellas.

### Ronda — pulido y detalles de producto (2026-08-13, propuesta por el usuario)

Siete tareas de pulido, ninguna asignada todavía — **quedan registradas para despachar
después, no se toman ahora**. Mismo criterio que el resto del backlog: quien tome una de
estas decide los detalles concretos (textos, números, nombres de rutas) en el momento de
implementar y lo documenta en su propia sección de "Estado de ramas" ANTES de escribir
código, no acá — acá va el enunciado y las decisiones que ya vienen fijadas por el usuario.

- [ ] **A. Estados vacíos con tema jungla.** Cuando no hay pendientes, ideas o
  recordatorios, mostrar una ilustración temática en vez de una pantalla en blanco —
  reusar el mismo enfoque SVG de la ilustración de monstera (`<path>` + `<mask>` para
  fenestraciones) ya usado en el rediseño visual (`views/partials/monstera.ejs`) y en la
  planta compañera (`views/partials/planta.ejs`), para que no sea una ilustración nueva
  desconectada del resto. Un estado distinto por sección (Pendientes, Ideas,
  Recordatorios) — decidir en el momento si son 3 variantes de la misma ilustración base
  o 3 ilustraciones separadas, y el texto corto y cálido de cada una (documentar el texto
  elegido, no dejarlo "por ahí" solo en el código). — asignada a: sin asignar — Depende
  de: nada (el sistema de ilustraciones ya existe, tarea 5).

- [ ] **B. Onboarding para usuarios nuevos.** Recorrido corto (3-4 pasos) inmediatamente
  después de `POST /registro`, explicando Pendientes/Ideas/Recordatorios y terminando en
  la elección de especie de planta (que hoy pasa dentro del formulario de registro mismo,
  tarea 8 — decidir en el momento si el onboarding absorbe ese paso o si sigue en el
  registro y el onboarding solo lo menciona, y documentar cuál). Debe poder saltarse en
  cualquier paso. Se muestra UNA sola vez — decidir dónde vive esa bandera (columna nueva
  en `usuarios`, ej. `onboarding_visto`, es lo más simple y consistente con el resto del
  esquema) y documentarlo. — asignada a: sin asignar — Depende de: tarea 8 (selección de
  especie, ya existe).

- [ ] **C. Página de perfil/ajustes.** Ruta nueva (decidir el nombre exacto, ej.
  `/ajustes` o `/perfil` — ser consistente con el resto de nombres de ruta en español ya
  usados en el proyecto — y documentarlo) con: cambiar nombre visible, cambiar la especie
  de planta ya elegida (revisar si esto debe resetear la etapa de crecimiento o no —
  probablemente no, la etapa depende de moneda ganada de por vida, no de la especie —
  documentar la decisión igual), activar/desactivar sonidos (decidir dónde se guarda esa
  preferencia — `localStorage` alcanza acá, a diferencia del tema visual, porque no hace
  falta que el servidor la conozca de antemano para evitar parpadeo — documentar el
  porqué de la diferencia con la tarea del tema), activar/desactivar notificaciones push
  (esto ya tiene su mecanismo — botón "Activar notificaciones" — decidir cómo se
  desactiva: ¿borrar la fila de `push_subscriptions`, o una columna de opt-out separada
  que preserve la suscripción por si se reactiva? documentar), y alternar claro/oscuro
  manualmente (el toggle en el nav ya existe — esta página solo necesita reflejar/exponer
  la misma preferencia `usuarios.tema`, no duplicar el mecanismo). — asignada a:
  `rama-ajustes` (en progreso, despachada en paralelo con A/B/D/E/F/G — ver su sección en
  "Estado de ramas") — Depende de: nada funcionalmente.

- [ ] **D. Invitar amigos con enlace/código.** Código corto o enlace único por usuario
  (decidir el formato — un token corto tipo el ya usado para `codigo_recuperacion_hash`
  es un precedente directo en este proyecto, reusar ese criterio de generarlo
  hasheado/de un solo uso o de vida larga, documentar cuál de los dos y por qué) que al
  abrirse lleva directo al registro con la solicitud de amistad pre-cargada. El código NO
  debe exponer datos sensibles del usuario que invita — en particular, nunca debe ser
  simplemente su `id` numérico ni su `nombre_usuario` en texto plano si eso permite
  enumerar cuentas; decidir el mecanismo exacto (token aleatorio opaco guardado en una
  tabla/columna que lo resuelve al `usuario_id` real del lado del servidor) y
  documentarlo. — asignada a: sin asignar — Depende de: sistema de amigos (ya existe).

- [ ] **E. Términos de servicio y política de privacidad + borrado de cuenta.** Página
  estática (decidir la ruta, ej. `/terminos` — documentar) explicando qué datos se
  guardan (cuenta, pendientes, mensajes, y si aplica la ubicación implícita en las
  notificaciones push — VAPID/push no comparte ubicación geográfica real, aclarar eso
  explícitamente en el texto para no sobre-declarar) y para qué se usan. Enlazarla desde
  `/registro`. Agregar una opción en ajustes (ver tarea C) para que el usuario elimine su
  cuenta — **esto es un DELETE real, no borrado lógico** (a diferencia del resto de la
  app, que usa `eliminado = TRUE` en `pendientes` — acá es a pedido explícito del dueño
  de los datos, así que corresponde borrar de verdad): pendientes propios, mensajes
  propios (1-a-1 y de la sala general), amistades donde participa, suscripciones push,
  tokens de Google Calendar si los tiene, saldo/transacciones de moneda, y la fila de
  `usuarios` misma. Decidir en el momento el orden de los DELETE respetando las foreign
  keys existentes (o si hace falta `ON DELETE CASCADE` nuevo en alguna, documentarlo) y
  qué pasa con mensajes/pendientes que OTROS usuarios referencian de este usuario borrado
  (ej. un pendiente que este usuario tenía asignado por un amigo — decidir si se
  desasigna o si el pendiente se borra igual, documentar el criterio). — asignada a: sin
  asignar — Depende de: nada, pero tocar esto con cuidado por ser destructivo de verdad.

- [ ] **F. Búsqueda y filtros en pendientes/ideas.** Buscar por texto, filtrar por
  categoría existente, y filtrar por estado (completado/pendiente). **Reusar el patrón de
  query ya existente en `GET /`** (que ya arma la consulta con `categoriaFiltro`/`q` de
  forma incremental) **en vez de duplicar la lógica** — extenderlo o extraerlo a un
  helper compartido si `/ideas` también lo necesita, decidir cuál de las dos y
  documentarlo. — asignada a: sin asignar — Depende de: nada (categorías y búsqueda en
  pendientes ya existen; esto es extender el filtro de estado y llevar el mismo patrón a
  `/ideas`).

- [ ] **G. PWA instalable de verdad.** `manifest.json` ya existe — revisar si falta algo
  (`start_url`, `display`, `theme_color` ya actualizado a la paleta Jungla/Monstera —
  confirmar que coincide con `#2D5A3D` usado en `partials/head.ejs`). Service worker
  (`public/sw.js`) ya existe y ya maneja `push`/`notificationclick` (tarea 4) — esta
  tarea NO crea uno nuevo, evalúa si el que ya está alcanza para el ciclo de vida de
  instalación de una PWA (cache de assets estáticos, offline básico) o si hace falta
  ampliarlo, y documentar qué se agregó. Iconos en varios tamaños — hoy solo existen
  `icon-192.png`/`icon-512.png` (rasterizados, quedaron sin regenerar con la ilustración
  nueva del rediseño visual, ver la sección de `rama-tema-jungla` más arriba — evaluar si
  esta tarea es el momento de regenerarlos o si sigue pendiente aparte, documentar la
  decisión). Validar el flujo real de "agregar a pantalla de inicio" en Android y iOS
  (Safari/iOS tiene su propio criterio de instalabilidad, distinto de Chrome/Android —
  probar ambos, no asumir que uno implica el otro). — asignada a: sin asignar — Depende
  de: notificaciones push (tarea 4, ya mergeada — la dependencia ya está satisfecha,
  comparten `public/sw.js`).

## Cómo agregar un trabajador nuevo (para el usuario)

1. Escribe la tarea nueva en "Backlog de tareas" arriba (o pídele a cualquier sesión
   activa que la agregue).
2. Abre una terminal nueva en la carpeta del repo y corre `claude`.
3. Pégale este mensaje:
   ```
   Eres una nueva sesión de Claude Code en el repo pendientes-web. Lee
   COORDINACION.md completo, toma la tarea del backlog que dice "[describe la
   tarea]", créate tu rama, y sigue el protocolo de onboarding del archivo.
   ```
4. Esa sesión se pone al día sola — no necesitas explicarle el contexto del
   proyecto a mano.
