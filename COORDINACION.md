
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
- Último commit: (pendiente de confirmar hash)
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
- [pendiente] merge de rama-chat → main
