# Secretos del proyecto

Registro de qué claves existen, dónde viven y cuándo se rotaron por última vez.
Ningún valor real va en este archivo — solo nombres, ubicación y fechas.

No commitear nunca un `.env` — todos están en `.gitignore`. Cada worktree
necesita su propia copia de `pendientes-web/.env` (ver `.env.example`).

## En producción (Render → servicio `bitacora-telegram`, desde 2026-08-24)

**Railway quedó retirado el 2026-08-24**: la cuenta se quedó sin método de
pago, Railway mató el contenedor y la base de datos (servicio caído,
Postgres bloqueando conexiones nuevas). Se migró el hosting a **Render**
(tier gratis, sin tarjeta) y la base de datos a **Neon** (tier gratis, sin
tarjeta), restaurada desde el respaldo automático de ese mismo día
(09:47 UTC, ~10h de antigüedad en el momento de la migración -- ver
`.github/workflows/restore-db.yml`). Detalle completo del análisis de costos
que motivó a considerar alternativas de pago en
`COORDINACION.md` → "Análisis de punto de equilibrio".

**URL real de la app:** https://bitacora-telegram.onrender.com -- se duerme
tras 15 min sin tráfico (tier gratis), tarda ~1 min en despertar. Para no
mostrar una pantalla en blanco durante ese minuto, el link que se comparte
de verdad es el "front door" estático en GitHub Pages:
https://brucerojasm15-rgb.github.io/bitacora-telegram/ (`docs/index.html`,
nunca se duerme, hace polling y redirige apenas el servidor de Render
responde).

**Neon -- ojo con pooled vs. directa:** el connection string con `-pooler`
en el host (PgBouncer, modo transacción) tuvo un problema real viendo
datos recién restaurados vía DDL (`pg_restore`) -- se usa la conexión
**directa** (mismo host sin `-pooler`) como `DATABASE_URL` de producción
para evitar esa clase de sorpresa. Si en el futuro se necesita muchísima
concurrencia de conexiones, se puede reevaluar la pooled para consultas
normales (no para restores/migraciones).

| Variable | Para qué sirve | Última rotación |
|---|---|---|
| `DATABASE_URL` | Conexión a Postgres en Neon (directa, sin pooler) | 2026-08-24 -- migrado de Railway a Neon |
| `ACCESS_KEY` | Clave de acceso simple (legada, ver nota en `server.js`) | — |
| `SESSION_SECRET` | Firma la cookie de sesión (login real) | — |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Notificaciones push del navegador | — |
| `GMAIL_USER` | Cuenta Gmail que manda los correos (`brucerojasm15@gmail.com`) | 2026-08-24 |
| `GMAIL_APP_PASSWORD` | App Password de esa cuenta (SMTP vía nodemailer) -- recuperación de contraseña por email (rama-login-email) | 2026-08-24 |
| `GROQ_API_KEY` | IA (segmentación de ideas, modelo gratuito con límite diario) | 2026-08-17 |

Ninguna se ha rotado desde que se creó, salvo lo anotado arriba. No es
urgente rotarlas salvo sospecha de filtración — pero si se rota
`SESSION_SECRET`, todas las sesiones activas se cierran (los usuarios
tienen que volver a loguearse).

Para cambiar una variable en Render ahora: dashboard → servicio →
Environment, o vía API (`PUT /v1/services/{id}/env-vars` con el API key de
Account Settings → API Keys).

## Solo en local (nunca llegaron a producción)

| Variable | Dónde vive | Para qué sirve | Última rotación |
|---|---|---|---|
| `GROQ_API_KEY` | `a-worktrees/rama-segmentacion-ideas/pendientes-web/.env` | Segmentación de ideas con IA (Groq, modelo gratuito con límite diario) | **2026-08-17** — la anterior (creada 2026-08-16) se compartió sin querer en texto plano en un chat de Claude Code. Se revocó en console.groq.com/keys y se generó una nueva (`bitacora-segmentacion-dev-2026-08-17`). |

## Pendiente de configurar (no tiene valores reales todavía)

Google Calendar (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`,
`GOOGLE_TOKEN_ENCRYPTION_KEY`) — esqueleto sin probar, ver comentario en
`pendientes-web/.env.example`. Mientras no tengan valores reales, `/calendario/*`
responde 500 "no configurada" en vez de fallar feo.

## Cómo rotar una clave

1. Generar el valor nuevo en el proveedor correspondiente (Groq, Google Cloud
   Console, o `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
   para secretos propios como `SESSION_SECRET`).
2. Actualizarla en los `.env` locales que la usan.
3. Si también existe en Railway, actualizarla ahí (`railway variables --set`)
   y esperar el redeploy.
4. Revocar/invalidar el valor viejo en el proveedor.
5. Anotar la fecha en la tabla de arriba.

## Backups

Ver `.github/workflows/backup-db.yml` — respaldo automático diario de Postgres,
documentado ahí mismo (qué guarda, dónde, y cuánto se retiene).
