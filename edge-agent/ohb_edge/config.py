"""Konfiguration des Edge-Agenten.

Wird beim Start EINMAL geprüft: Fehlt oder taugt ein Wert nicht, bricht der Prozess
sofort mit einer lesbaren Meldung ab. Auf einem Gerät ohne Bildschirm ist das der
Unterschied zwischen "Konfigurationsfehler beim Start" und "läuft scheinbar, sendet
aber nichts".

Bewusst nur Standardbibliothek: Auf einem Raspberry Pi zählt jede Abhängigkeit, die
bei einem Systemwechsel nachinstalliert werden muss.
"""

from __future__ import annotations

import os
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

UUID_MUSTER = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")


class Konfigurationsfehler(Exception):
    """Wird beim Start geworfen und beendet den Prozess mit einer Meldung."""


@dataclass(frozen=True, slots=True)
class Config:
    """Vollständige Laufzeitkonfiguration.

    ``frozen`` weil eine Konfiguration, die sich zur Laufzeit ändert, jede Fehlersuche
    unmöglich macht.
    """

    # ── Identität ──────────────────────────────────────────────────────
    sensor_uuid: str
    """Kennung dieses Messpunkts. Bildet mit ``quantity`` und Zeitstempel den
    Schlüssel, über den der Server Wiederholungen erkennt — darf sich deshalb
    NIEMALS ändern."""

    sensor_name: str
    gateway_id: str
    event_driven: int

    # ── MQTT ───────────────────────────────────────────────────────────
    broker_host: str
    broker_port: int
    broker_username: str | None
    broker_password: str | None
    client_id: str
    """Fest und je Pi eindeutig. Ohne stabile ClientId findet der Broker die
    persistente Sitzung beim Reconnect nicht wieder."""
    keepalive: int
    publish_timeout_s: float

    # ── Messung ────────────────────────────────────────────────────────
    interval_s: float

    # ── Puffer ─────────────────────────────────────────────────────────
    buffer_path: Path
    buffer_max_entries: int
    """Obergrenze. Wird sie erreicht, verwirft der Puffer die ÄLTESTEN Einträge —
    ein vollgelaufenes Dateisystem legt den Pi sonst vollständig lahm."""
    flush_batch_size: int

    # ── Uhrzeit ────────────────────────────────────────────────────────
    require_clock_sync: bool
    """Auf ``false`` setzen, wenn ein RTC-Modul verbaut ist: Dann ist die Uhr auch
    ohne Netz vertrauenswürdig."""
    clock_recheck_s: float

    # ── Betrieb ────────────────────────────────────────────────────────
    log_level: str
    status_file: Path | None
    """Optionale Statusdatei für externe Überwachung (z.B. ein Kuma-Push per Cron)."""

    topic: str = field(init=False)

    def __post_init__(self) -> None:
        object.__setattr__(self, "topic", f"sensors/{self.sensor_uuid}")


def _text(name: str, default: str | None = None, *, pflicht: bool = False) -> str:
    wert = os.environ.get(name, default)
    if pflicht and not wert:
        raise Konfigurationsfehler(f"{name} ist erforderlich")
    return (wert or "").strip()


def _zahl(name: str, default: float, *, minimum: float | None = None) -> float:
    roh = os.environ.get(name)
    if roh is None or roh.strip() == "":
        return default
    try:
        wert = float(roh)
    except ValueError as fehler:
        raise Konfigurationsfehler(f"{name} ist keine Zahl: {roh!r}") from fehler
    if minimum is not None and wert < minimum:
        raise Konfigurationsfehler(f"{name} muss mindestens {minimum} sein, ist {wert}")
    return wert


def _ganzzahl(name: str, default: int, *, minimum: int | None = None) -> int:
    return int(_zahl(name, default, minimum=minimum))


def _wahrheit(name: str, default: bool) -> bool:
    roh = os.environ.get(name)
    if roh is None or roh.strip() == "":
        return default
    return roh.strip().lower() in {"1", "true", "yes", "ja", "on"}


def lade_konfiguration() -> Config:
    """Liest die Konfiguration aus der Umgebung und prüft sie vollständig."""
    sensor_uuid = _text("OHB_SENSOR_UUID", pflicht=True)
    if not UUID_MUSTER.match(sensor_uuid):
        raise Konfigurationsfehler(
            f"OHB_SENSOR_UUID hat nicht das Format 8-4-4-4-12: {sensor_uuid!r}"
        )

    # Ohne eigene Vorgabe wird die ClientId aus der Kennung abgeleitet. Sie muss je
    # Pi eindeutig sein — zwei Clients mit derselben Id werfen sich gegenseitig
    # dauerhaft aus der Verbindung.
    client_id = _text("OHB_CLIENT_ID") or f"ohb-edge-{sensor_uuid[:8]}"

    passwort = os.environ.get("OHB_BROKER_PASSWORD")
    benutzer = os.environ.get("OHB_BROKER_USERNAME")
    if benutzer and not passwort:
        raise Konfigurationsfehler("OHB_BROKER_USERNAME gesetzt, aber OHB_BROKER_PASSWORD fehlt")

    status_datei = _text("OHB_STATUS_FILE")

    config = Config(
        sensor_uuid=sensor_uuid,
        sensor_name=_text("OHB_SENSOR_NAME") or sensor_uuid,
        gateway_id=_text("OHB_GATEWAY_ID", "unbekannt"),
        event_driven=1 if _wahrheit("OHB_EVENT_DRIVEN", False) else 0,
        broker_host=_text("OHB_BROKER_HOST", "127.0.0.1"),
        broker_port=_ganzzahl("OHB_BROKER_PORT", 1883, minimum=1),
        broker_username=benutzer or None,
        broker_password=passwort or None,
        client_id=client_id,
        keepalive=_ganzzahl("OHB_KEEPALIVE_S", 30, minimum=5),
        publish_timeout_s=_zahl("OHB_PUBLISH_TIMEOUT_S", 10.0, minimum=1.0),
        interval_s=_zahl("OHB_INTERVAL_S", 2.0, minimum=0.1),
        buffer_path=Path(_text("OHB_BUFFER_PATH", "/var/lib/ohb-edge/outbox.sqlite3")),
        buffer_max_entries=_ganzzahl("OHB_BUFFER_MAX_ENTRIES", 100_000, minimum=100),
        flush_batch_size=_ganzzahl("OHB_FLUSH_BATCH_SIZE", 200, minimum=1),
        require_clock_sync=_wahrheit("OHB_REQUIRE_CLOCK_SYNC", True),
        clock_recheck_s=_zahl("OHB_CLOCK_RECHECK_S", 30.0, minimum=1.0),
        log_level=_text("OHB_LOG_LEVEL", "INFO").upper(),
        status_file=Path(status_datei) if status_datei else None,
    )

    if config.flush_batch_size > config.buffer_max_entries:
        raise Konfigurationsfehler("OHB_FLUSH_BATCH_SIZE darf OHB_BUFFER_MAX_ENTRIES nicht übersteigen")

    return config


def lade_oder_beende() -> Config:
    """Wie :func:`lade_konfiguration`, beendet den Prozess aber bei Fehlern sauber."""
    try:
        return lade_konfiguration()
    except Konfigurationsfehler as fehler:
        print(
            f"\nKonfiguration ungültig — Prozess wird beendet.\n  {fehler}\n\n"
            f"Vorlage aller erwarteten Variablen: config.example.env\n",
            file=sys.stderr,
        )
        raise SystemExit(2) from fehler
