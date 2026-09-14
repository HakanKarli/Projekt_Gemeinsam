"""Dauerhafter Ausgangspuffer auf Basis von SQLite.

Das Muster ist dasselbe wie im Ingest auf der Serverseite, nur spiegelbildlich:
**erst festhalten, dann senden, erst nach Bestätigung vergessen.**

Warum überhaupt schreiben, wenn die Verbindung steht? Weil zwischen Messung und
Bestätigung ein Zeitfenster liegt. Fällt in diesem Fenster der Strom, ist die Messung
ohne Puffer verloren — und genau Stromausfälle sind der Fall, für den ein Reinraum
eine lückenlose Aufzeichnung braucht.

**Verschleiß der SD-Karte** ist dabei die berechtigte Gegenfrage. Drei Maßnahmen:

* ``journal_mode=WAL`` — Schreibvorgänge gehen sequenziell in eine Anhängedatei
  statt verstreut in die Datenbankdatei
* ``synchronous=NORMAL`` — ein ``fsync`` je Prüfpunkt statt je Schreibvorgang
* Bestätigte Einträge werden **gebündelt** gelöscht, nicht einzeln

Bei einem Messzyklus alle zwei Sekunden ergibt das eine Last, die auch eine
handelsübliche Karte über Jahre trägt. Für Dauerbetrieb sind Industriekarten mit
pSLC dennoch die richtige Wahl.
"""

from __future__ import annotations

import json
import logging
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from .models import Measurement, Reading

log = logging.getLogger(__name__)

SCHEMA = """
CREATE TABLE IF NOT EXISTS outbox (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    captured_at       TEXT    NOT NULL,   -- bester bekannter Zeitpunkt, ISO 8601
    monotonic_s       REAL    NOT NULL,   -- Marke der monotonen Uhr
    clock_trusted     INTEGER NOT NULL,   -- war die Wanduhr beim Erfassen gültig?
    session_id        TEXT    NOT NULL,   -- Prozesslauf, in dem erfasst wurde
    measurements      TEXT    NOT NULL,   -- JSON-Liste
    state             TEXT    NOT NULL DEFAULT 'pending',  -- pending | quarantined
    created_at        TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_outbox_pending ON outbox (id) WHERE state = 'pending';
"""


@dataclass(frozen=True, slots=True)
class BufferedReading:
    """Ein Eintrag aus dem Puffer."""

    row_id: int
    reading: Reading
    session_id: str


class Outbox:
    """Dauerhafter FIFO-Puffer für noch nicht bestätigte Messungen."""

    def __init__(self, pfad: Path, *, max_entries: int, session_id: str) -> None:
        self._max_entries = max_entries
        self._session_id = session_id

        pfad.parent.mkdir(parents=True, exist_ok=True)
        # check_same_thread=False: Die paho-Rückrufe laufen in einem eigenen Thread.
        # Zugriffe werden über die Schleife in __main__ serialisiert.
        self._db = sqlite3.connect(pfad, check_same_thread=False, isolation_level=None)
        self._db.row_factory = sqlite3.Row
        self._db.execute("PRAGMA journal_mode=WAL")
        self._db.execute("PRAGMA synchronous=NORMAL")
        self._db.execute("PRAGMA busy_timeout=5000")
        self._db.executescript(SCHEMA)

        log.info("Puffer geöffnet: %s (%d Einträge offen)", pfad, self.pending_count())

    # ── Schreiben ──────────────────────────────────────────────────────

    def append(self, reading: Reading) -> int:
        """Legt eine Messung ab, BEVOR gesendet wird."""
        cursor = self._db.execute(
            """INSERT INTO outbox
               (captured_at, monotonic_s, clock_trusted, session_id, measurements, created_at)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (
                reading.captured_at.isoformat(),
                reading.monotonic_s,
                1 if reading.clock_trusted else 0,
                self._session_id,
                json.dumps([m.as_dict() for m in reading.measurements], ensure_ascii=False),
                datetime.now(timezone.utc).isoformat(),
            ),
        )
        self._verdraenge_bei_ueberlauf()
        return int(cursor.lastrowid)

    def _verdraenge_bei_ueberlauf(self) -> None:
        """Hält die Puffergröße unter der Obergrenze.

        Verworfen werden die ÄLTESTEN Einträge. Das ist die unangenehmere, aber
        richtige Wahl: Ein vollgelaufenes Dateisystem legt den Pi vollständig lahm —
        dann gingen nicht nur die ältesten, sondern alle folgenden Messungen verloren.
        """
        anzahl = self.total_count()
        if anzahl <= self._max_entries:
            return

        ueberhang = anzahl - self._max_entries
        self._db.execute(
            "DELETE FROM outbox WHERE id IN (SELECT id FROM outbox ORDER BY id LIMIT ?)",
            (ueberhang,),
        )
        log.error(
            "Puffer übergelaufen: %d älteste Messungen verworfen (Grenze %d). "
            "Die Verbindung zum Broker fehlt seit sehr langer Zeit.",
            ueberhang,
            self._max_entries,
        )

    # ── Lesen ──────────────────────────────────────────────────────────

    def pending(self, limit: int) -> list[BufferedReading]:
        """Älteste offene Einträge — FIFO, damit die Reihenfolge erhalten bleibt."""
        zeilen = self._db.execute(
            "SELECT * FROM outbox WHERE state = 'pending' ORDER BY id LIMIT ?",
            (limit,),
        ).fetchall()
        return [self._zu_eintrag(zeile) for zeile in zeilen]

    @staticmethod
    def _zu_eintrag(zeile: sqlite3.Row) -> BufferedReading:
        messwerte = tuple(
            Measurement(quantity=m["quantity"], unit=m["unit"], value=float(m["value"]))
            for m in json.loads(zeile["measurements"])
        )
        return BufferedReading(
            row_id=int(zeile["id"]),
            session_id=str(zeile["session_id"]),
            reading=Reading(
                captured_at=datetime.fromisoformat(zeile["captured_at"]),
                monotonic_s=float(zeile["monotonic_s"]),
                clock_trusted=bool(zeile["clock_trusted"]),
                measurements=messwerte,
            ),
        )

    def pending_count(self) -> int:
        return int(self._db.execute("SELECT count(*) FROM outbox WHERE state = 'pending'").fetchone()[0])

    def quarantined_count(self) -> int:
        return int(self._db.execute("SELECT count(*) FROM outbox WHERE state = 'quarantined'").fetchone()[0])

    def total_count(self) -> int:
        return int(self._db.execute("SELECT count(*) FROM outbox").fetchone()[0])

    # ── Abschließen ────────────────────────────────────────────────────

    def confirm(self, row_ids: list[int]) -> None:
        """Löscht bestätigte Einträge — gebündelt, um Schreibvorgänge zu sparen."""
        if not row_ids:
            return
        platzhalter = ",".join("?" * len(row_ids))
        self._db.execute(f"DELETE FROM outbox WHERE id IN ({platzhalter})", row_ids)

    def update_timestamp(self, row_id: int, korrigiert: datetime) -> None:
        """Schreibt einen nachträglich berichtigten Zeitstempel zurück."""
        self._db.execute(
            "UPDATE outbox SET captured_at = ?, clock_trusted = 1 WHERE id = ?",
            (korrigiert.isoformat(), row_id),
        )

    def quarantine_unrecoverable(self, aktuelle_session: str) -> int:
        """Stellt Einträge in Quarantäne, deren Zeitstempel nicht mehr zu retten ist.

        Betroffen sind Messungen, die in einem FRÜHEREN Prozesslauf ohne gültige Uhr
        erfasst wurden: Die monotone Uhr begann seither neu, der wahre Zeitpunkt ist
        nicht mehr berechenbar.

        Sie werden bewusst **nicht gelöscht** — in einem Auditsystem muss nachweisbar
        bleiben, dass gemessen und warum nicht übertragen wurde. Sie werden aber auch
        nicht mit falscher Zeit versendet.
        """
        cursor = self._db.execute(
            """UPDATE outbox SET state = 'quarantined'
               WHERE state = 'pending' AND clock_trusted = 0 AND session_id <> ?""",
            (aktuelle_session,),
        )
        anzahl = cursor.rowcount or 0
        if anzahl:
            log.error(
                "%d Messungen in Quarantäne: ohne gültige Uhr erfasst und seither neu gestartet — "
                "ihr Zeitpunkt ist nicht mehr rekonstruierbar. Abfrage: "
                "SELECT * FROM outbox WHERE state = 'quarantined'",
                anzahl,
            )
        return anzahl

    def close(self) -> None:
        try:
            self._db.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        finally:
            self._db.close()
