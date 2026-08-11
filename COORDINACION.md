
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
