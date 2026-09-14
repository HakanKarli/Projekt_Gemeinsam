"""MQTT-Versand mit Zusicherung.

Drei Einstellungen entscheiden über Verlustfreiheit:

``client_id`` (fest)
    Ohne stabile Kennung findet der Broker die Sitzung beim Reconnect nicht wieder.

``clean_session=False``
    Der Broker hält unbestätigte Nachrichten vor, solange dieser Client weg ist.

``qos=1``
    "Mindestens einmal" — der Broker bestätigt mit ``PUBACK``. Erst danach darf der
    Puffer den Eintrag löschen.

Der Gegenpart auf der Serverseite arbeitet spiegelbildlich: Der Ingest bestätigt eine
Nachricht erst nach dem Datenbank-Commit. Zusammen ergibt das eine Kette, in der jede
Übergabe eine Bestätigung kennt.

Doppelte Zustellung ist dabei ausdrücklich erlaubt: Der Server erkennt sie am
Schlüssel ``(sensor_uuid, quantity, timestamp)`` und verwirft sie folgenlos.
"""

from __future__ import annotations

import logging
import threading

import paho.mqtt.client as mqtt

from .config import Config

log = logging.getLogger(__name__)


class Publisher:
    """Verbindung zum Broker mit bestätigtem Versand."""

    def __init__(self, config: Config) -> None:
        self._config = config
        self._verbunden = threading.Event()

        self._client = mqtt.Client(
            callback_api_version=mqtt.CallbackAPIVersion.VERSION2,
            client_id=config.client_id,
            # Persistente Sitzung: Der Broker merkt sich unbestätigte Nachrichten.
            clean_session=False,
            protocol=mqtt.MQTTv311,
        )

        if config.broker_username:
            self._client.username_pw_set(config.broker_username, config.broker_password)

        # Automatischer Wiederverbindungsversuch mit Backoff, statt eigener Schleife.
        self._client.reconnect_delay_set(min_delay=1, max_delay=60)

        self._client.on_connect = self._on_connect
        self._client.on_disconnect = self._on_disconnect

    # ── Lebenszyklus ───────────────────────────────────────────────────

    def start(self) -> None:
        """Baut die Verbindung auf und startet den Netzwerk-Thread.

        Ein fehlgeschlagener Erstversuch ist kein Fehler: Der Agent misst und puffert
        weiter, ``loop_start`` versucht es im Hintergrund erneut.
        """
        log.info(
            "Verbinde mit %s:%d als %s",
            self._config.broker_host,
            self._config.broker_port,
            self._config.client_id,
        )
        try:
            self._client.connect_async(
                self._config.broker_host,
                self._config.broker_port,
                keepalive=self._config.keepalive,
            )
        except OSError as fehler:
            log.warning("Erstverbindung fehlgeschlagen (%s) — es wird weiter versucht", fehler)

        self._client.loop_start()

    def stop(self) -> None:
        """Beendet die Verbindung geordnet."""
        self._client.loop_stop()
        try:
            self._client.disconnect()
        except OSError:
            pass

    @property
    def connected(self) -> bool:
        return self._verbunden.is_set()

    # ── Versand ────────────────────────────────────────────────────────

    def publish_confirmed(self, payload: str) -> bool:
        """Sendet und wartet auf die Bestätigung des Brokers.

        :returns: ``True``, wenn der Broker bestätigt hat. Nur dann darf der Eintrag
                  aus dem Puffer entfernt werden.
        """
        if not self._verbunden.is_set():
            return False

        info = self._client.publish(self._config.topic, payload, qos=1)

        if info.rc != mqtt.MQTT_ERR_SUCCESS:
            log.debug("Senden abgelehnt (rc=%s)", info.rc)
            return False

        try:
            info.wait_for_publish(timeout=self._config.publish_timeout_s)
        except (ValueError, RuntimeError) as fehler:
            # Tritt auf, wenn die Verbindung während des Wartens abbricht.
            log.debug("Warten auf Bestätigung abgebrochen: %s", fehler)
            return False

        return info.is_published()

    # ── Rückrufe ───────────────────────────────────────────────────────

    def _on_connect(self, _client, _userdata, connect_flags, reason_code, _properties) -> None:
        if reason_code.is_failure:
            log.warning("Verbindung abgelehnt: %s", reason_code)
            return

        self._verbunden.set()
        if connect_flags.session_present:
            log.info("Verbunden — bestehende Sitzung wiederaufgenommen")
        else:
            log.info("Verbunden — neue Sitzung")

    def _on_disconnect(self, _client, _userdata, _flags, reason_code, _properties) -> None:
        self._verbunden.clear()
        if reason_code == 0:
            log.info("Verbindung geordnet beendet")
        else:
            log.warning("Verbindung verloren (%s) — Wiederverbindung läuft", reason_code)
