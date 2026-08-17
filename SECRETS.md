# Secretos del proyecto

Registro de qué claves existen, dónde viven y cuándo se rotaron por última vez.
Ningún valor real va en este archivo — solo nombres, ubicación y fechas.

No commitear nunca un `.env` — todos están en `.gitignore`. Cada worktree
necesita su propia copia de `pendientes-web/.env` (ver `.env.example`).

## En producción (Railway → proyecto `tender-upliftment` → servicio `bitacora-telegram`)

| Variable | Para qué sirve | Última rotación |
|---|---|---|
| `DATABASE_URL` | Conexión a Postgres (referencia automática al servicio `Postgres`) | — |
| `ACCESS_KEY` | Clave de acceso simple (legada, ver nota en `server.js`) | — |
| `SESSION_SECRET` | Firma la cookie de sesión (login real) | — |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Notificaciones push del navegador | — |

Ninguna de estas se ha rotado nunca desde que se creó. No es urgente rotarlas
salvo sospecha de filtración — pero si se rota `SESSION_SECRET`, todas las
sesiones activas se cierran (los usuarios tienen que volver a loguearse).

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
