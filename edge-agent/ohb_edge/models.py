"""Datenstrukturen des Nachrichtenvertrags.

Maßgeblich ist ``node-backend/src/ingest/messageSchema.js`` auf der Serverseite.
Weicht eine Änderung hier davon ab, landen die Nachrichten in ``ingest_rejects``
statt in ``sensor_data``.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timezone


@dataclass(frozen=True, slots=True)
class Measurement:
    """Ein einzelner Messwert."""

    quantity: str
    """Bezeichner der Messgröße, z.B. ``temperature``. Freitext — ein Tippfehler
    erzeugt serverseitig einen neuen Kanal ohne Schwellenwert und damit ohne
    Alarmierung. Konstanten verwenden, nicht Zeichenketten streuen."""

    unit: str
    value: float

    def as_dict(self) -> dict:
        return {"quantity": self.quantity, "unit": self.unit, "value": self.value}


@dataclass(frozen=True, slots=True)
class Reading:
    """Eine vollständige Messung: alle Messgrößen eines Zyklus mit ihrem Zeitpunkt.

    Der Zeitstempel wird beim ERFASSEN gesetzt, nicht beim Senden. Das ist keine
    Feinheit: Er bildet zusammen mit Sensorkennung und Messgröße den Schlüssel, über
    den der Server eine Wiederholung erkennt. Würde er beim Senden gesetzt, bekäme
    eine nachgelieferte Nachricht einen neuen Zeitstempel, kollidierte mit nichts und
    landete ein zweites Mal in der Datenbank.
    """

    captured_at: datetime
    """Zeitpunkt der Messung in UTC."""

    monotonic_s: float
    """Wert der monotonen Uhr zum selben Zeitpunkt.

    Dient der nachträglichen Korrektur: Läuft der Pi ohne gültige Wanduhr an, lässt
    sich aus dem Abstand zweier monotoner Werte der wahre Zeitpunkt berechnen, sobald
    die Wanduhr vertrauenswürdig wird. Siehe :mod:`ohb_edge.clock`.
    """

    clock_trusted: bool
    """War die Wanduhr zum Erfassungszeitpunkt vertrauenswürdig?"""

    measurements: tuple[Measurement, ...]

    def with_timestamp(self, korrigiert: datetime) -> "Reading":
        """Kopie mit berichtigtem Zeitstempel (nach Uhrzeit-Korrektur)."""
        return Reading(
            captured_at=korrigiert,
            monotonic_s=self.monotonic_s,
            clock_trusted=True,
            measurements=self.measurements,
        )


@dataclass(frozen=True, slots=True)
class MessageEnvelope:
    """Die versandfertige MQTT-Nachricht."""

    sensor_uuid: str
    sensor_name: str
    gateway_id: str
    event_driven: int
    reading: Reading

    def as_payload(self) -> dict:
        return {
            "id": self.sensor_uuid,
            "gateway_id": self.gateway_id,
            "name": self.sensor_name,
            "event_driven": self.event_driven,
            # Millisekunden genügen; der Server speichert timestamptz.
            "timestamp": _iso8601(self.reading.captured_at),
            "measurements": [m.as_dict() for m in self.reading.measurements],
        }

    def to_json(self) -> str:
        # ensure_ascii=False, damit Einheiten wie °C und µg/m³ lesbar bleiben.
        return json.dumps(self.as_payload(), ensure_ascii=False, separators=(",", ":"))


def _iso8601(zeitpunkt: datetime) -> str:
    """ISO 8601 in UTC mit Millisekunden und ``Z``-Suffix."""
    utc = zeitpunkt.astimezone(timezone.utc)
    return utc.strftime("%Y-%m-%dT%H:%M:%S.") + f"{utc.microsecond // 1000:03d}Z"
