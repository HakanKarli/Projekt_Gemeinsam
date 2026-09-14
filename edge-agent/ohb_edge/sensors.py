"""Datenerfassung — HIER LIEGT DIE ANPASSUNG JE MESSPUNKT.

Der übrige Agent ist fertig und muss nicht angefasst werden. Auszutauschen ist
ausschließlich die Klasse, die die Messwerte liefert.

Der Vertrag ist bewusst schmal:

.. code-block:: python

    class MeineQuelle:
        def read(self) -> list[Measurement]: ...
        def close(self) -> None: ...

``read()`` liefert alle Messgrößen dieses Messpunkts in einem Zug. Sie landen
gemeinsam in EINER Nachricht mit EINEM Zeitstempel — der Server schreibt sie in einer
Transaktion.

**Regeln für die Umsetzung:**

* ``read()`` darf blockieren, aber nicht lange. Alles über etwa einer Sekunde
  verschiebt den Messtakt. Bei langsamen Bussen einen eigenen Thread verwenden und
  hier den zuletzt gelesenen Wert zurückgeben.
* Fehler dürfen geworfen werden. Die Schleife fängt sie ab, protokolliert und misst
  weiter — ein defekter Sensor legt den Agenten nicht lahm.
* Eine **leere Liste** ist zulässig und bedeutet "gerade nichts Neues". Es wird dann
  keine Nachricht erzeugt. Für ereignisgesteuerte Quellen ist das der Normalfall.
* ``quantity`` muss exakt zur serverseitigen Schreibweise passen. Konstanten
  verwenden (siehe unten), keine Zeichenketten im Code verstreuen — ein Tippfehler
  erzeugt einen neuen Kanal ohne Schwellenwert und damit ohne Alarmierung.
"""

from __future__ import annotations

import logging
import math
import random
import time
from typing import Protocol

from .models import Measurement

log = logging.getLogger(__name__)


# ── Vereinbarte Bezeichner ─────────────────────────────────────────────
# Müssen mit dem übereinstimmen, was auf dem Server konfiguriert ist.
class Quantity:
    TEMPERATURE = "temperature"
    HUMIDITY = "humidity"
    PRESSURE = "pressure"
    ECO2 = "eco2"
    TVOC = "tvoc"
    WIND_SPEED = "wind_speed"
    PM2_5 = "pm2_5"
    PM10 = "pm10"


class Unit:
    CELSIUS = "°C"
    PERCENT_RH = "%rH"
    HECTOPASCAL = "hPa"
    PPM = "ppm"
    PPB = "ppb"
    METER_PER_SECOND = "m/s"
    MICROGRAM_PER_M3 = "µg/m³"


class SensorSource(Protocol):
    """Schnittstelle jeder Datenquelle."""

    def read(self) -> list[Measurement]:
        """Liest alle Messgrößen dieses Messpunkts."""
        ...

    def close(self) -> None:
        """Gibt Betriebsmittel frei (Bus, Port, Verbindung)."""
        ...


# ══════════════════════════════════════════════════════════════════════
# PLATZHALTER 1 — Sensoren direkt am Pi (GPIO / I²C / SPI)
# ══════════════════════════════════════════════════════════════════════
class GpioSource:
    """Sensoren am I²C- oder SPI-Bus des Raspberry Pi.

    TODO: Mit der tatsächlichen Hardware ausfüllen. Typischer Aufbau mit ``smbus2``
    oder den Herstellerbibliotheken (z.B. ``adafruit-circuitpython-*``)::

        import board, busio, adafruit_bme280

        def __init__(self):
            i2c = busio.I2C(board.SCL, board.SDA)
            self._bme = adafruit_bme280.Adafruit_BME280_I2C(i2c, address=0x76)

        def read(self):
            return [
                Measurement(Quantity.TEMPERATURE, Unit.CELSIUS,    round(self._bme.temperature, 2)),
                Measurement(Quantity.HUMIDITY,    Unit.PERCENT_RH, round(self._bme.humidity, 1)),
                Measurement(Quantity.PRESSURE,    Unit.HECTOPASCAL, round(self._bme.pressure, 1)),
            ]
    """

    def __init__(self) -> None:
        raise NotImplementedError(
            "GpioSource muss an die verbaute Hardware angepasst werden — siehe Docstring"
        )

    def read(self) -> list[Measurement]:
        raise NotImplementedError

    def close(self) -> None:
        pass


# ══════════════════════════════════════════════════════════════════════
# PLATZHALTER 2 — Messgerät über USB / serielle Schnittstelle
# ══════════════════════════════════════════════════════════════════════
class SerialSource:
    """Messgerät an einer seriellen Schnittstelle (auch USB-Seriell-Wandler).

    TODO: Protokoll des Geräts einsetzen. Grundgerüst mit ``pyserial``::

        import serial

        def __init__(self, port="/dev/ttyUSB0", baudrate=9600):
            self._port = serial.Serial(port, baudrate, timeout=1.0)

        def read(self):
            self._port.reset_input_buffer()      # veraltete Zeilen verwerfen
            self._port.write(b"READ\\r\\n")
            zeile = self._port.readline().decode("ascii", errors="replace").strip()
            if not zeile:
                return []                        # nichts Neues — kein Fehler
            temperatur = _zerlege(zeile)
            return [Measurement(Quantity.TEMPERATURE, Unit.CELSIUS, temperatur)]

    Hinweis: Der Gerätepfad ``/dev/ttyUSB0`` ist nicht stabil. Für den Dauerbetrieb
    eine udev-Regel auf die Seriennummer anlegen und einen festen Namen wie
    ``/dev/ohb-sensor`` vergeben.
    """

    def __init__(self, port: str = "/dev/ttyUSB0", baudrate: int = 9600) -> None:
        raise NotImplementedError(
            "SerialSource muss an das Geräteprotokoll angepasst werden — siehe Docstring"
        )

    def read(self) -> list[Measurement]:
        raise NotImplementedError

    def close(self) -> None:
        pass


# ══════════════════════════════════════════════════════════════════════
# PLATZHALTER 3 — vorgelagerter MQTT-Broker
# ══════════════════════════════════════════════════════════════════════
class UpstreamMqttSource:
    """Werte kommen bereits per MQTT von einem anderen Broker oder Gateway.

    Der Agent wirkt dann als **Umsetzer**: Er abonniert das fremde Format, bringt es
    in den Vertrag dieses Systems und übernimmt Zeitstempel, Pufferung und
    Zusicherung.

    TODO: Abonnement und Umsetzung ausfüllen. Grundgerüst::

        def __init__(self, host, topic):
            self._letzte: dict[str, Measurement] = {}
            self._client = mqtt.Client(callback_api_version=mqtt.CallbackAPIVersion.VERSION2)
            self._client.on_message = self._on_message
            self._client.connect(host)
            self._client.subscribe(topic, qos=1)
            self._client.loop_start()

        def _on_message(self, client, userdata, msg):
            fremd = json.loads(msg.payload)
            self._letzte["temperature"] = Measurement(
                Quantity.TEMPERATURE, Unit.CELSIUS, float(fremd["temp_c"])
            )

        def read(self):
            werte = list(self._letzte.values())
            self._letzte.clear()      # nur NEUE Werte weitergeben
            return werte

    Wichtig: ``_letzte`` nach dem Auslesen leeren. Sonst würde derselbe Wert in jedem
    Zyklus erneut gesendet — mit neuem Zeitstempel, also als scheinbar neue Messung.
    Die serverseitige Idempotenz greift dagegen nicht, weil sich der Zeitstempel
    unterscheidet.
    """

    def __init__(self, host: str, topic: str) -> None:
        raise NotImplementedError(
            "UpstreamMqttSource muss an das Quellformat angepasst werden — siehe Docstring"
        )

    def read(self) -> list[Measurement]:
        raise NotImplementedError

    def close(self) -> None:
        pass


# ══════════════════════════════════════════════════════════════════════
# Vorgabe zum Ausprobieren — erzeugt plausible Werte ohne Hardware
# ══════════════════════════════════════════════════════════════════════
class DemoSource:
    """Erzeugt gleichmäßig schwankende Werte.

    Damit lässt sich die gesamte Kette — Puffer, Uhrzeit, Zusicherung, Server —
    prüfen, bevor Hardware angeschlossen ist. **Nicht für den Betrieb.**
    """

    def __init__(self) -> None:
        self._start = time.monotonic()
        log.warning("DemoSource aktiv — es werden KEINE echten Messwerte erfasst")

    def read(self) -> list[Measurement]:
        t = time.monotonic() - self._start
        return [
            Measurement(
                Quantity.TEMPERATURE,
                Unit.CELSIUS,
                round(22.0 + 2.0 * math.sin(t / 30) + random.uniform(-0.2, 0.2), 2),
            ),
            Measurement(
                Quantity.HUMIDITY,
                Unit.PERCENT_RH,
                round(45.0 + 5.0 * math.sin(t / 90) + random.uniform(-1, 1), 1),
            ),
        ]

    def close(self) -> None:
        pass


def erzeuge_quelle(art: str) -> SensorSource:
    """Wählt die Quelle anhand von ``OHB_SOURCE``."""
    quellen = {
        "demo": DemoSource,
        "gpio": GpioSource,
        "serial": SerialSource,
    }
    if art == "upstream_mqtt":
        raise NotImplementedError(
            "UpstreamMqttSource benötigt eigene Parameter — in erzeuge_quelle() ergänzen"
        )

    if art not in quellen:
        raise ValueError(f"Unbekannte Quelle {art!r}. Erlaubt: {', '.join(quellen)}, upstream_mqtt")
    return quellen[art]()
