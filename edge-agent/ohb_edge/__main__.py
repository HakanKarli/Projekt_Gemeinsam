"""Einstiegspunkt des Edge-Agenten.

Der Ablauf je Zyklus:

1. Uhrzeit prüfen (gedrosselt, sie startet einen Unterprozess)
2. Sensoren lesen
3. Messung **zuerst in den Puffer schreiben** — mit Zeitstempel des Erfassungszeitpunkts
4. Puffer abarbeiten: senden, auf Bestätigung warten, erst danach löschen
5. Bis zum nächsten Takt warten

Zwei Regeln tragen das Ganze:

* **Der Zeitstempel entsteht beim Erfassen, nicht beim Senden.** Sonst bekäme eine
  nachgelieferte Nachricht einen neuen Zeitstempel und der Server könnte die
  Wiederholung nicht erkennen.
* **Gelöscht wird erst nach der Bestätigung des Brokers.** Alles andere ist
  Hoffnung, keine Zusicherung.
"""

from __future__ import annotations

import json
import logging
import signal
import sys
import time
import uuid
from datetime import datetime, timezone

from .buffer import BufferedReading, Outbox
from .clock import ClockGuard
from .config import Config, lade_oder_beende
from .models import MessageEnvelope, Reading
from .publisher import Publisher
from .sensors import SensorSource, erzeuge_quelle

log = logging.getLogger("ohb_edge")


class Agent:
    """Bindet Uhrzeit, Puffer, Datenquelle und Versand zusammen."""

    def __init__(self, config: Config, quelle: SensorSource) -> None:
        self._config = config
        self._quelle = quelle
        self._session_id = str(uuid.uuid4())

        self._clock = ClockGuard(
            require_sync=config.require_clock_sync,
            recheck_s=config.clock_recheck_s,
        )
        self._outbox = Outbox(
            config.buffer_path,
            max_entries=config.buffer_max_entries,
            session_id=self._session_id,
        )
        self._publisher = Publisher(config)

        self._stop = False
        self._statistik = {"erfasst": 0, "gesendet": 0, "lesefehler": 0}

    # ── Lebenszyklus ───────────────────────────────────────────────────

    def run(self) -> None:
        log.info(
            "Edge-Agent startet · Sensor %s · Takt %.1fs · Puffer %s",
            self._config.sensor_uuid,
            self._config.interval_s,
            self._config.buffer_path,
        )

        # Messungen aus einem früheren Lauf ohne gültige Uhr sind nicht mehr
        # korrigierbar — die monotone Uhr begann seither neu.
        self._outbox.quarantine_unrecoverable(self._session_id)

        self._clock.pruefe()
        if not self._clock.trusted:
            log.warning(
                "Uhrzeit noch nicht vertrauenswürdig (%s) — es wird gemessen und gepuffert, "
                "aber nicht gesendet",
                self._clock.status.grund,
            )

        self._publisher.start()

        naechster_takt = time.monotonic()
        while not self._stop:
            naechster_takt += self._config.interval_s
            self._zyklus()
            self._warte_bis(naechster_takt)

        self._beenden()

    def request_stop(self, signalnummer: int, _rahmen) -> None:
        """Signalbehandlung — beendet nach dem laufenden Zyklus."""
        log.info("Signal %s empfangen — beende nach dem laufenden Zyklus", signal.Signals(signalnummer).name)
        self._stop = True

    def _warte_bis(self, ziel_monotonic: float) -> None:
        """Wartet driftfrei bis zum nächsten Takt."""
        rest = ziel_monotonic - time.monotonic()
        if rest > 0:
            # In Scheiben warten, damit ein Signal nicht bis zum Taktende liegen bleibt.
            ende = time.monotonic() + rest
            while not self._stop and time.monotonic() < ende:
                time.sleep(min(0.25, ende - time.monotonic()))
        elif rest < -self._config.interval_s:
            log.warning("Takt um %.1fs überschritten — Erfassung oder Versand ist zu langsam", -rest)

    def _beenden(self) -> None:
        log.info("Beende geordnet")
        # Letzte Gelegenheit, den Puffer zu leeren, solange die Verbindung noch steht.
        try:
            self._flush()
        except Exception:  # noqa: BLE001 — beim Beenden darf nichts mehr durchschlagen
            log.exception("Letzter Versand fehlgeschlagen")

        self._publisher.stop()
        self._quelle.close()
        self._schreibe_status()
        self._outbox.close()

        log.info(
            "Beendet · erfasst %d · gesendet %d · im Puffer %d · in Quarantäne %d",
            self._statistik["erfasst"],
            self._statistik["gesendet"],
            self._outbox.pending_count(),
            self._outbox.quarantined_count(),
        )

    # ── Zyklus ─────────────────────────────────────────────────────────

    def _zyklus(self) -> None:
        self._clock.pruefe()
        self._erfasse()
        self._flush()
        self._schreibe_status()

    def _erfasse(self) -> None:
        """Liest die Quelle und legt das Ergebnis im Puffer ab."""
        try:
            messwerte = self._quelle.read()
        except Exception:  # noqa: BLE001 — ein defekter Sensor darf den Agenten nicht beenden
            self._statistik["lesefehler"] += 1
            log.exception("Lesen der Datenquelle fehlgeschlagen")
            return

        if not messwerte:
            return  # nichts Neues — bei ereignisgesteuerten Quellen der Normalfall

        # Wanduhr, monotone Uhr und Vertrauensstatus in EINEM Zug erheben,
        # damit sie zueinander passen.
        wanduhr, monoton, vertrauenswuerdig = self._clock.jetzt()

        self._outbox.append(
            Reading(
                captured_at=wanduhr,
                monotonic_s=monoton,
                clock_trusted=vertrauenswuerdig,
                measurements=tuple(messwerte),
            )
        )
        self._statistik["erfasst"] += 1

    def _flush(self) -> None:
        """Arbeitet den Puffer ab: älteste zuerst, löschen erst nach Bestätigung."""
        if not self._publisher.connected:
            return

        eintraege = self._outbox.pending(self._config.flush_batch_size)
        if not eintraege:
            return

        bestaetigt: list[int] = []
        for eintrag in eintraege:
            versandfertig = self._mache_versandfertig(eintrag)
            if versandfertig is None:
                # Zeitstempel (noch) nicht verantwortbar — später erneut versuchen.
                # Die Reihenfolge bleibt gewahrt, deshalb hier abbrechen.
                break

            nachricht = MessageEnvelope(
                sensor_uuid=self._config.sensor_uuid,
                sensor_name=self._config.sensor_name,
                gateway_id=self._config.gateway_id,
                event_driven=self._config.event_driven,
                reading=versandfertig,
            )

            if not self._publisher.publish_confirmed(nachricht.to_json()):
                # Keine Bestätigung: Eintrag bleibt liegen, nächster Zyklus versucht
                # es erneut. Abbrechen, damit die Reihenfolge erhalten bleibt.
                break

            bestaetigt.append(eintrag.row_id)

        if bestaetigt:
            self._outbox.confirm(bestaetigt)
            self._statistik["gesendet"] += len(bestaetigt)
            log.debug("%d Messungen bestätigt gesendet", len(bestaetigt))

    def _mache_versandfertig(self, eintrag: BufferedReading) -> Reading | None:
        """Stellt sicher, dass der Zeitstempel verantwortbar ist.

        :returns: Die (ggf. berichtigte) Messung oder ``None``, wenn sie noch nicht
                  gesendet werden darf.
        """
        if eintrag.reading.clock_trusted:
            return eintrag.reading

        # Ohne gültige Uhr erfasst. Korrigierbar nur, wenn die Uhr inzwischen steht
        # UND der Eintrag aus diesem Prozesslauf stammt — die monotone Uhr beginnt
        # bei jedem Start neu.
        if not self._clock.trusted or eintrag.session_id != self._session_id:
            return None

        korrigiert = self._clock.korrigiere(eintrag.reading.monotonic_s)
        if korrigiert is None:
            return None

        self._outbox.update_timestamp(eintrag.row_id, korrigiert)
        log.info(
            "Zeitstempel nachträglich berichtigt: %s -> %s",
            eintrag.reading.captured_at.isoformat(),
            korrigiert.isoformat(),
        )
        return eintrag.reading.with_timestamp(korrigiert)

    # ── Statusdatei ────────────────────────────────────────────────────

    def _schreibe_status(self) -> None:
        """Schreibt den Zustand für eine externe Überwachung.

        Bewusst eine Datei statt eines HTTP-Endpunkts: Ein Cron-Aufruf, der sie liest
        und einen Heartbeat an Uptime Kuma schickt, kommt ohne offenen Port aus.
        """
        if self._config.status_file is None:
            return

        zustand = {
            "sensor_uuid": self._config.sensor_uuid,
            "aktualisiert": datetime.now(timezone.utc).isoformat(),
            "verbunden": self._publisher.connected,
            "uhr_vertrauenswuerdig": self._clock.trusted,
            "uhr_grund": self._clock.status.grund,
            "puffer_offen": self._outbox.pending_count(),
            "puffer_quarantaene": self._outbox.quarantined_count(),
            **self._statistik,
        }

        try:
            self._config.status_file.parent.mkdir(parents=True, exist_ok=True)
            # Atomar schreiben: Ein Leser darf nie eine halbe Datei sehen.
            temporaer = self._config.status_file.with_suffix(".tmp")
            temporaer.write_text(json.dumps(zustand, ensure_ascii=False, indent=2), encoding="utf-8")
            temporaer.replace(self._config.status_file)
        except OSError as fehler:
            log.debug("Statusdatei nicht schreibbar: %s", fehler)


def richte_protokollierung_ein(stufe: str) -> None:
    logging.basicConfig(
        level=getattr(logging, stufe, logging.INFO),
        format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
        datefmt="%Y-%m-%dT%H:%M:%S%z",
        stream=sys.stdout,  # systemd sammelt stdout ins Journal
    )


def main() -> int:
    config = lade_oder_beende()
    richte_protokollierung_ein(config.log_level)

    import os

    art = os.environ.get("OHB_SOURCE", "demo").strip().lower()
    try:
        quelle = erzeuge_quelle(art)
    except (NotImplementedError, ValueError) as fehler:
        log.error("Datenquelle %r nicht verwendbar: %s", art, fehler)
        return 2

    agent = Agent(config, quelle)
    signal.signal(signal.SIGTERM, agent.request_stop)
    signal.signal(signal.SIGINT, agent.request_stop)

    try:
        agent.run()
    except Exception:  # noqa: BLE001 — Abbruch soll protokolliert werden, nicht nur im Stacktrace landen
        log.exception("Agent unerwartet beendet")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
