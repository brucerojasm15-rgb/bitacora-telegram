
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
8. Commit, push, `gh pr close <viejo> --comment "..."`, `gh pr create`, verifica
   `gh pr view <nuevo> --json mergeable,mergeStateStatus` da CLEAN/MERGEABLE, luego
   `gh pr merge <nuevo> --merge --delete-branch=false`.
9. Registra el merge en "Historial de merges a main" (arriba) con el hash del commit de merge.

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
