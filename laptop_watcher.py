"""
LAPTOP_WATCHER.PY — v0.3 — compañero de bot_bitacora_sqlite.py que corre en la laptop

Qué hace, cada 15 segundos:
  1. Avisa al bot (vía la base de datos) que TU laptop está conectada
     (identificado por tu propio ID de Telegram — el bot es multiusuario,
     cada quien conecta su propia laptop).
  2. Si hay una exportación pendiente tuya (pedida con /exportar desde el
     celular), la guarda en este mismo folder como Bitacora_de_Vida.xlsx,
     SIEMPRE reemplazando el archivo anterior — nunca se crean copias
     Bitacora_de_Vida_1.xlsx, _2.xlsx, etc.

Cómo correrlo:
    1. En esta misma carpeta, define las variables de entorno:
           DATABASE_URL     (obligatoria, la misma que usa el bot en la nube)
           MI_TELEGRAM_ID   (obligatoria, tu ID de Telegram)
           TELEGRAM_TOKEN   (opcional, para el aviso de "listo" por Telegram)
    2. python laptop_watcher.py
    3. Déjalo corriendo mientras quieras que la laptop reciba exportaciones.
       Para detenerlo: Ctrl+C

requirements_watcher.txt:
    psycopg2-binary
    requests
"""

import os
import time
from datetime import datetime, timezone
from pathlib import Path

import psycopg2
import requests

DATABASE_URL = os.environ.get("DATABASE_URL", "")
TOKEN = os.environ.get("TELEGRAM_TOKEN", "")
MI_ID = os.environ.get("MI_TELEGRAM_ID", "")

CARPETA = Path(__file__).resolve().parent
ARCHIVO_SALIDA = CARPETA / "Bitacora_de_Vida.xlsx"

INTERVALO_SEGUNDOS = 15


def get_conn():
    return psycopg2.connect(DATABASE_URL)


def init_tablas():
    con = get_conn(); cur = con.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS laptop_heartbeat (
            usuario_id BIGINT PRIMARY KEY, last_seen TIMESTAMPTZ
        )
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS export_status (
            usuario_id BIGINT PRIMARY KEY,
            pending BOOLEAN DEFAULT FALSE,
            completado BOOLEAN DEFAULT FALSE,
            excel_data BYTEA,
            cantidad INTEGER,
            solicitado_en TIMESTAMPTZ,
            completado_en TIMESTAMPTZ
        )
    """)
    con.commit(); cur.close(); con.close()


def avisar_conectada():
    con = get_conn(); cur = con.cursor()
    cur.execute("""
        INSERT INTO laptop_heartbeat (usuario_id, last_seen) VALUES (%s, %s)
        ON CONFLICT (usuario_id) DO UPDATE SET last_seen = EXCLUDED.last_seen
    """, (MI_ID, datetime.now(timezone.utc)))
    con.commit(); cur.close(); con.close()


def revisar_export_pendiente():
    con = get_conn(); cur = con.cursor()
    cur.execute("""
        SELECT excel_data, cantidad FROM export_status
        WHERE usuario_id = %s AND pending = TRUE AND completado = FALSE
    """, (MI_ID,))
    fila = cur.fetchone()
    if not fila:
        cur.close(); con.close()
        return None
    excel_data, cantidad = fila
    cur.execute("""
        UPDATE export_status
        SET pending = FALSE, completado = TRUE, completado_en = %s
        WHERE usuario_id = %s
    """, (datetime.now(timezone.utc), MI_ID))
    con.commit(); cur.close(); con.close()
    return bytes(excel_data), cantidad


def guardar_archivo(datos):
    # Mismo nombre siempre: se sobrescribe, nunca se acumulan copias.
    ARCHIVO_SALIDA.write_bytes(datos)


def avisar_telegram(cantidad):
    if not TOKEN or not MI_ID:
        return
    try:
        requests.post(
            f"https://api.telegram.org/bot{TOKEN}/sendMessage",
            json={
                "chat_id": MI_ID,
                "text": f"✅ Bitácora guardada en tu laptop ({cantidad} ideas)\n{ARCHIVO_SALIDA}",
            },
            timeout=10,
        )
    except requests.RequestException:
        pass


def main():
    if not DATABASE_URL:
        print("Falta DATABASE_URL en las variables de entorno. No puedo conectarme.")
        return
    if not MI_ID:
        print("Falta MI_TELEGRAM_ID en las variables de entorno (tu ID de Telegram).")
        return
    init_tablas()
    print(f"Vigía corriendo. Las exportaciones se guardarán en: {ARCHIVO_SALIDA}")
    print("Presiona Ctrl+C para detener.")
    try:
        while True:
            avisar_conectada()
            resultado = revisar_export_pendiente()
            if resultado:
                datos, cantidad = resultado
                guardar_archivo(datos)
                print(f"📊 Bitácora exportada ({cantidad} ideas) -> {ARCHIVO_SALIDA}")
                avisar_telegram(cantidad)
            time.sleep(INTERVALO_SEGUNDOS)
    except KeyboardInterrupt:
        print("\nVigía detenido.")


if __name__ == "__main__":
    main()
