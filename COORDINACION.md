
# Coordinación entre ramas — pendientes-web

## Reglas para cualquier sesión de Claude Code que trabaje aquí

1. Al empezar, lee este archivo completo antes de tocar código.
2. Trabaja SOLO en tu rama asignada. Si no tienes una, créala: `git checkout -b rama-<feature>`.
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

### rama-amigos
- Estado: no existe todavía (mencionada como posible rama futura)
- Archivos tocados: —
- Último commit: —
- Pendientes/notas: si se crea, coordinar con rama-chat por la tabla `amistades`
  (ver nota arriba).

### rama-notificaciones
- Estado: commiteada, prueba end-to-end contra la DB real completada y en verde,
  lista para revisión de rama-integracion.
- Tarea: notificaciones/marcar como leído en el chat (usar la columna `leido`
  ya existente en la tabla `mensajes`).
- Nota sobre el punto de partida: esta rama se creó desde `main` actualizado
  (commit 9e07855), que todavía NO incluye el commit 084f810 de rama-amigos
  (agrega las tareas de notificaciones/tema oscuro al backlog) ni el resto
  de rama-amigos — esa rama sigue sin mergear a main. Tomé esta tarea
  porque el usuario la señaló directamente a partir del backlog visible en
  la rama-amigos ya commiteada (donde este archivo ya tenía esas líneas).
  Por eso abajo, en "Backlog de tareas", vuelvo a agregar esas entradas
  "desde cero" en la versión de este archivo de mi rama. Al mergear,
  rama-integracion debe resolver el conflicto de COORDINACION.md contra la
  versión de rama-amigos quedándose con la unión de ambas listas, sin
  perder ninguna entrada ni duplicar el checkbox de la tarea de amigos.
- Archivos tocados: pendientes-web/server.js (ruta GET /chat ahora marca
  como leídos (`leido = true`) los mensajes del OTRO usuario justo después
  de leerlos para la vista, sin tocar los mensajes propios; nueva ruta
  GET /notificaciones que devuelve en JSON `{ noLeidos }`, el total de
  mensajes sin leer del usuario logueado sumando todas sus amistades),
  pendientes-web/views/chat.ejs (aviso "🔔 Tenías N mensajes sin leer" al
  abrir una conversación con mensajes pendientes, distingue mensaje propio
  vs ajeno, indicador ✓/✓✓ de "visto" en los mensajes propios),
  pendientes-web/public/style.css (clases `.notificacion`, `.no-leido`,
  `.visto` — estilos mínimos con las variables ya existentes, sin
  rediseñar chat.ejs porque eso es la otra tarea pendiente del backlog).
- Decisión de alcance: NO toqué views/partials/nav.ejs. Agregar ahí un
  badge de notificaciones hubiera tocado un archivo que rama-amigos ya
  modificó (agregó el link a /amigos) sin estar mergeado todavía. Preferí
  exponer el conteo vía GET /notificaciones (JSON) para que quien integre
  un badge visual (en nav o una futura lista de conversaciones) lo consuma
  sin que yo tuviera que tocar ese archivo compartido sin coordinar antes.
- Qué se verificó: `node --check server.js` sin errores. `chat.ejs` se
  compiló con `ejs.compile()` sin errores de sintaxis, y se hizo un render
  de prueba con datos simulados (sin DB) que confirmó que el aviso de "sin
  leer", el punto de no-leído y el indicador de "visto" aparecen donde
  corresponde según autor/estado `leido`.
- ✅ Prueba end-to-end contra la DB real de Railway (misma que usan las
  demás ramas), ya completada: se creó `.env` local en el worktree con las
  mismas credenciales que usa el resto del equipo, se instalaron
  dependencias (`npm install`), se levantó `server.js` local, y se corrió
  un script desechable que:
  1) creó dos usuarios de prueba (`prueba_notif_a`, `prueba_notif_b`) y una
     fila en `amistades` entre ambos,
  2) logueó a los dos por sesión real (`POST /login`),
  3) A envió 3 mensajes a B (`POST /mensajes`) — confirmado en DB:
     `leido = false` en los 3, y `GET /notificaciones` de B devolvió
     `{"noLeidos":3}`,
  4) B abrió `/chat?amistad_id=X` — el HTML mostró el banner
     "🔔 Tenías 3 mensajes sin leer", y en DB los 3 mensajes pasaron a
     `leido = true` inmediatamente,
  5) `GET /notificaciones` de B después de abrir el chat devolvió
     `{"noLeidos":0}`,
  6) A abrió su propio chat y vio el indicador "✓✓" (visto) en sus
     mensajes propios — confirma que no se rompe nada cuando el emisor
     revisita el chat,
  7) flujo inverso: B respondió un mensaje, `GET /notificaciones` de A
     subió a `1` antes de abrir el chat y bajó a `0` justo después de
     abrir `/chat?amistad_id=X` como A,
  8) limpieza: se borraron los mensajes, la amistad y los dos usuarios de
     prueba al final del script — confirmado con una consulta posterior
     que ya no quedan filas de `prueba_notif_a`/`prueba_notif_b` en
     `usuarios`. El archivo `.env` local, `node_modules/` y el script de
     prueba nunca se comitearon (los dos primeros ya estaban en
     `.gitignore`; el script se borró al terminar) — `git status` quedó
     limpio antes del commit.
  Resultado: **todos los checks en verde** (contador de no-leídos sube al
  llegar un mensaje, baja a 0 al abrir el chat que lo contiene, DB refleja
  `leido=true` solo en los mensajes del otro usuario, indicador de "visto"
  funciona en ambos sentidos).
- Commit: 05758c1 (funcionalidad) y 1ed64b9 (registro de hash) — este
  commit de actualización de COORDINACION.md con el resultado de la
  prueba end-to-end queda registrado abajo tras el push.

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

## Onboarding para una sesión nueva (nuevo "trabajador")

Si eres una sesión de Claude Code nueva que se acaba de abrir en este repo:

1. Lee este archivo completo antes de escribir código.
2. Corre `git log --oneline -10` y `git branch -a` para ver el estado real.
3. Busca tu tarea en la sección "Backlog de tareas" de abajo. Si el usuario ya te dio
   una tarea directamente en el chat, usa esa en vez del backlog.
4. Crea tu rama desde `main` actualizado: `git checkout -b rama-<nombre-corto>`.
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
- [ ] Notificaciones/marcar como leído en el chat (usar columna `leido` ya
  existente en tabla mensajes) — asignada a: rama-notificaciones (en progreso)
- [ ] Aplicar tema visual oscuro a views/chat.ejs (creado después de rama-visual,
  no tiene el estilo aplicado) — asignada a: sin asignar
- [x] Sistema de amigos: agregar amigo, aceptar/rechazar solicitud, listar amigos
  — tomada por rama-amigos (rama commiteada, todavía no mergeada a main; ver su
  propia COORDINACION.md/sección para el detalle completo)

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
