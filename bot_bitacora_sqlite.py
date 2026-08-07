"""
BOT_BITACORA_POSTGRES.PY — ideas + exportar + recordar + hice/hoy + necesito/pendientes

Comandos:
- (mensaje normal)      -> guarda una idea
- /exportar             -> te manda el Excel con tus ideas
- /recordar <min> <qué> -> te avisa en X minutos
- /necesito <qué>       -> agrega una actividad pendiente
- /pendientes           -> muestra tus actividades pendientes
- /hice <qué>           -> registra algo que TERMINASTE (y lo saca de pendientes si estaba)
- /hoy                  -> muestra lo que terminaste hoy

requirements.txt:
    python-telegram-bot[job-queue]
    psycopg2-binary
    openpyxl
"""

from telegram import Update
from telegram.ext import Application, MessageHandler, CommandHandler, filters, ContextTypes
import psycopg2
import openpyxl
from datetime import datetime, timezone, timedelta
import os
import io

TOKEN = os.environ.get("TELEGRAM_TOKEN", "")
MI_ID = int(os.environ.get("MI_TELEGRAM_ID", "0"))
DATABASE_URL = os.environ.get("DATABASE_URL", "")

PERU_OFFSET = timedelta(hours=-5)  # Perú es UTC-5


def get_conn():
    return psycopg2.connect(DATABASE_URL)


def init_db():
    con = get_conn()
    cur = con.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS ideas (
            id SERIAL PRIMARY KEY, fecha TEXT, idea TEXT, estado TEXT
        )
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS recordatorios (
            id SERIAL PRIMARY KEY, texto TEXT, cuando TIMESTAMPTZ, avisado BOOLEAN DEFAULT FALSE
        )
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS hechos (
            id SERIAL PRIMARY KEY, texto TEXT, cuando TIMESTAMPTZ
        )
    """)
    # Tabla nueva: actividades pendientes
    cur.execute("""
        CREATE TABLE IF NOT EXISTS pendientes (
            id SERIAL PRIMARY KEY, texto TEXT, creado TIMESTAMPTZ, hecho BOOLEAN DEFAULT FALSE
        )
    """)
    con.commit()
    cur.close()
    con.close()


def guardar_idea(texto):
    con = get_conn(); cur = con.cursor()
    ahora = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    cur.execute("INSERT INTO ideas (fecha, idea, estado) VALUES (%s, %s, %s)", (ahora, texto, None))
    con.commit(); cur.close(); con.close()


def guardar_recordatorio(texto, cuando):
    con = get_conn(); cur = con.cursor()
    cur.execute("INSERT INTO recordatorios (texto, cuando) VALUES (%s, %s)", (texto, cuando))
    con.commit(); cur.close(); con.close()


def guardar_hecho(texto):
    con = get_conn(); cur = con.cursor()
    cur.execute("INSERT INTO hechos (texto, cuando) VALUES (%s, %s)", (texto, datetime.now(timezone.utc)))
    con.commit(); cur.close(); con.close()


def guardar_pendiente(texto):
    con = get_conn(); cur = con.cursor()
    cur.execute("INSERT INTO pendientes (texto, creado) VALUES (%s, %s)", (texto, datetime.now(timezone.utc)))
    con.commit(); cur.close(); con.close()


def listar_pendientes():
    con = get_conn(); cur = con.cursor()
    cur.execute("SELECT texto, creado FROM pendientes WHERE hecho = FALSE ORDER BY creado")
    filas = cur.fetchall()
    cur.close(); con.close()
    return filas


def marcar_pendiente_hecho(texto):
    """Si el texto coincide con un pendiente, lo marca como hecho."""
    con = get_conn(); cur = con.cursor()
    cur.execute("UPDATE pendientes SET hecho = TRUE WHERE hecho = FALSE AND LOWER(texto) LIKE LOWER(%s)",
                ('%' + texto + '%',))
    con.commit(); cur.close(); con.close()


def hechos_de_hoy():
    con = get_conn(); cur = con.cursor()
    ahora_peru = datetime.now(timezone.utc) + PERU_OFFSET
    inicio_dia_peru = ahora_peru.replace(hour=0, minute=0, second=0, microsecond=0)
    inicio_utc = inicio_dia_peru - PERU_OFFSET
    cur.execute("SELECT texto, cuando FROM hechos WHERE cuando >= %s ORDER BY cuando", (inicio_utc,))
    filas = cur.fetchall()
    cur.close(); con.close()
    return filas


def generar_excel_en_memoria():
    con = get_conn(); cur = con.cursor()
    cur.execute("SELECT fecha, idea, estado FROM ideas ORDER BY id")
    filas = cur.fetchall()
    cur.close(); con.close()
    wb = openpyxl.Workbook(); ws = wb.active; ws.title = "Hoja 1"
    ws.append(["Fecha", "Idea_Cruda", "Estado"])
    for fecha, idea, estado in filas:
        ws.append([fecha, idea, estado])
    buffer = io.BytesIO(); wb.save(buffer); buffer.seek(0)
    return buffer, len(filas)


# ============================================================
# HANDLERS
# ============================================================

async def recibir_mensaje(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.effective_user.id != MI_ID:
        return
    texto = update.message.text
    if not texto:
        return
    guardar_idea(texto)
    await update.message.reply_text("✍️ Idea guardada (permanente).")


async def comando_exportar(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.effective_user.id != MI_ID:
        return
    await update.message.reply_text("📊 Armando tu bitácora...")
    buffer, cantidad = generar_excel_en_memoria()
    await update.message.reply_document(document=buffer, filename="Bitacora_de_Vida.xlsx",
                                        caption=f"Tu bitácora con {cantidad} ideas.")


async def comando_recordar(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.effective_user.id != MI_ID:
        return
    args = context.args
    if len(args) < 2 or not args[0].isdigit():
        await update.message.reply_text(
            "Para recordar:\n/recordar <minutos> <qué>\n\nEj:\n/recordar 30 comprar naranjas\n/recordar 1440 regar (24h)")
        return
    minutos = int(args[0]); texto = " ".join(args[1:])
    cuando = datetime.now(timezone.utc) + timedelta(minutes=minutos)
    guardar_recordatorio(texto, cuando)
    hora_peru = (cuando + PERU_OFFSET).strftime("%H:%M")
    await update.message.reply_text(f"⏰ Listo. Te recuerdo: \"{texto}\"\nEn {minutos} min (~{hora_peru}, hora Perú).")


async def comando_necesito(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Agrega una actividad pendiente. Ej: /necesito sacar el pasaporte"""
    if update.effective_user.id != MI_ID:
        return
    if not context.args:
        await update.message.reply_text("Escribí qué necesitás hacer. Ej:\n/necesito sacar el pasaporte")
        return
    texto = " ".join(context.args)
    guardar_pendiente(texto)
    await update.message.reply_text(f"📌 Anotado como pendiente: \"{texto}\"\nEscribí /pendientes para ver toda tu lista.")


async def comando_pendientes(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Muestra las actividades pendientes."""
    if update.effective_user.id != MI_ID:
        return
    filas = listar_pendientes()
    if not filas:
        await update.message.reply_text("No tenés pendientes anotados. 🎉\nPara agregar: /necesito <qué>")
        return
    lineas = ["📋 Tus actividades pendientes:\n"]
    for i, (texto, creado) in enumerate(filas, 1):
        lineas.append(f"{i}. {texto}")
    lineas.append("\nCuando termines una, escribí /hice <qué> y sale de la lista. 💪")
    await update.message.reply_text("\n".join(lineas))


async def comando_hice(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Registra algo TERMINADO y lo saca de pendientes si estaba."""
    if update.effective_user.id != MI_ID:
        return
    if not context.args:
        await update.message.reply_text("Escribí qué terminaste. Ej:\n/hice arreglé la cadena de mi bici")
        return
    texto = " ".join(context.args)
    guardar_hecho(texto)
    marcar_pendiente_hecho(texto)
    await update.message.reply_text(f"✅ ¡Hecho! Registrado: \"{texto}\"\nUn paso más. Escribí /hoy para ver todo lo de hoy.")


async def comando_hoy(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Muestra lo que terminaste hoy."""
    if update.effective_user.id != MI_ID:
        return
    filas = hechos_de_hoy()
    if not filas:
        await update.message.reply_text(
            "Hoy todavía no registraste nada terminado.\nCuando cierres algo, escribí /hice <qué>.\nAunque sea chico, cuenta. 💪")
        return
    lineas = ["✅ Lo que terminaste hoy:\n"]
    for texto, cuando in filas:
        hora = (cuando + PERU_OFFSET).strftime("%H:%M")
        lineas.append(f"• {texto}  ({hora})")
    lineas.append(f"\nTotal: {len(filas)} cosa(s) hecha(s). Bien ahí. 🐆")
    await update.message.reply_text("\n".join(lineas))


async def revisar_recordatorios(context: ContextTypes.DEFAULT_TYPE):
    con = get_conn(); cur = con.cursor()
    ahora = datetime.now(timezone.utc)
    cur.execute("SELECT id, texto FROM recordatorios WHERE avisado = FALSE AND cuando <= %s", (ahora,))
    vencidos = cur.fetchall()
    for rid, texto in vencidos:
        await context.bot.send_message(chat_id=MI_ID, text=f"🔔🔔 RECORDATORIO: {texto}")
        cur.execute("UPDATE recordatorios SET avisado = TRUE WHERE id = %s", (rid,))
    con.commit(); cur.close(); con.close()


def main():
    init_db()
    app = Application.builder().token(TOKEN).build()
    app.add_handler(CommandHandler("exportar", comando_exportar))
    app.add_handler(CommandHandler("recordar", comando_recordar))
    app.add_handler(CommandHandler("necesito", comando_necesito))
    app.add_handler(CommandHandler("pendientes", comando_pendientes))
    app.add_handler(CommandHandler("hice", comando_hice))
    app.add_handler(CommandHandler("hoy", comando_hoy))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, recibir_mensaje))
    app.job_queue.run_repeating(revisar_recordatorios, interval=60, first=10)
    print("Bot corriendo: ideas + exportar + recordar + necesito/pendientes + hice/hoy.")
    app.run_polling()


if __name__ == "__main__":
    main()
