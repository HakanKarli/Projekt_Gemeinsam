"""
mqtt_simulator.py
Sendet simulierte Sensor-Daten an einen MQTT-Broker.

{
    "id":           "<sensor-uuid>",
    "gateway_id":   "<string>",
    "name":         "<string>",        # vom Sensor gemeldeter Name
    "event_driven": 0,                 # 0 = zyklisch, 1 = event-getrieben
    "timestamp":    "<ISO-8601>",
    "measurements": [{ "quantity": "<string>", "unit": "<string>", "value": <number> }]
}

Topic-Prefix: sensors/<sensor-uuid>

Voraussetzung:  pip install paho-mqtt
"""

import json
import math
import random
import time
from datetime import datetime, timezone

import paho.mqtt.client as mqtt

# ── Einstellungen ──────────────────────────────────────────────────────────────
BROKER_HOST = "localhost"
BROKER_PORT = 1883
INTERVAL    = 2.0           # Sekunden zwischen zwei Nachrichten

# ── Simulierte Sensoren ────────────────────────────────────────────────────────
# Feste UUIDs → werden automatisch in sensor_registry eingetragen.
# gateway_id entspricht dem Reinraum (für spätere Zuordnung).
SENSORS = [
    # ── Reinraum 221 ──────────────────────────────────────────────────────────
    {
        "id":         "a1b2c3d4-0001-0001-0001-000000000001",
        "gateway_id": "gw-reinraum-221",
        "measurements": [
            {
                "quantity": "temperature",
                "unit":     "°C",
                "fn": lambda t: round(22.0 + 2.0 * math.sin(t / 30) + random.uniform(-0.2, 0.2), 2),
            },
            {
                "quantity": "pressure",
                "unit":     "hPa",
                "fn": lambda t: round(1013.0 + 1.5 * math.sin(t / 120) + random.uniform(-0.1, 0.1), 1),
            },
        ],
    },
    {
        "id":         "a1b2c3d4-0001-0001-0001-000000000002",
        "gateway_id": "gw-reinraum-221",
        "measurements": [
            {
                "quantity": "eco2",
                "unit":     "ppm",
                "fn": lambda t: round(400.0 + 50.0 * math.sin(t / 40) + random.uniform(-5, 5), 0),
            },
            {
                "quantity": "tvoc",
                "unit":     "ppb",
                "fn": lambda t: round(max(0, 30.0 + 15.0 * math.sin(t / 50) + random.uniform(-2, 2)), 0),
            },
        ],
    },
    {
        "id":         "a1b2c3d4-0001-0001-0001-000000000003",
        "gateway_id": "gw-reinraum-221",
        "measurements": [
            {
                "quantity": "wind_speed",
                "unit":     "m/s",
                "fn": lambda t: round(max(0, 0.5 + 0.3 * math.sin(t / 35) + random.uniform(-0.05, 0.05)), 2),
            },
        ],
    },
    {
        "id":         "a1b2c3d4-0001-0001-0001-000000000004",
        "gateway_id": "gw-reinraum-221",
        "measurements": [
            {
                "quantity": "pm2_5",
                "unit":     "µg/m³",
                "fn": lambda t: round(max(0, 5.0 + 3.0 * math.sin(t / 60) + random.uniform(-0.5, 0.5)), 1),
            },
            {
                "quantity": "pm10",
                "unit":     "µg/m³",
                "fn": lambda t: round(max(0, 10.0 + 4.0 * math.sin(t / 60) + random.uniform(-1, 1)), 1),
            },
        ],
    },

    # ── Infoboard ─────────────────────────────────────────────────────────────
    {
        "id":         "b2c3d4e5-0002-0002-0002-000000000001",
        "gateway_id": "gw-infoboard",
        "measurements": [
            {
                "quantity": "temperature",
                "unit":     "°C",
                "fn": lambda t: round(21.0 + 1.5 * math.sin(t / 45) + random.uniform(-0.3, 0.3), 2),
            },
            {
                "quantity": "humidity",
                "unit":     "%rH",
                "fn": lambda t: round(45.0 + 5.0 * math.sin(t / 90) + random.uniform(-1, 1), 1),
            },
        ],
    },
]
# ──────────────────────────────────────────────────────────────────────────────


def on_connect(client, userdata, flags, rc):
    if rc == 0:
        print(f"Verbunden mit {BROKER_HOST}:{BROKER_PORT}")
    else:
        print(f"❌  Verbindung fehlgeschlagen (rc={rc})")


def build_payload(sensor: dict, t: float) -> dict:
    """Baut eine MQTT-Nachricht im mqttBridge-kompatiblen Format."""
    return {
        "id": sensor["id"],
        "gateway_id": GATEWAY_ID,
        "name": sensor["name"],
        "event_driven": sensor.get("event_driven", 0),
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "measurements": [
            {
                "quantity": meas["quantity"],
                "unit": meas["unit"],
                "value": meas["fn"](t),
            }
            for meas in sensor["measurements"]
        ],
    }


def format_measurements(measurements: list[dict]) -> str:
    """Formatiert Messwerte für die Konsolenausgabe."""
    return ", ".join(
        f"{m['quantity']}={m['value']} {m['unit']}" for m in measurements
    )


def main():
    client = mqtt.Client(client_id="ohb-simulator")
    client.on_connect = on_connect
    client.connect(BROKER_HOST, BROKER_PORT, keepalive=60)
    client.loop_start()

    t = 0.0
    sensor_count = len(SENSORS)
    print(f"Sende alle {INTERVAL}s fuer {sensor_count} Sensoren ...  (Ctrl+C zum Beenden)\n")

    try:
        while True:
            ts_iso = datetime.now(timezone.utc).isoformat()

            for sensor in SENSORS:
                measurements = [
                    {
                        "quantity": m["quantity"],
                        "unit":     m["unit"],
                        "value":    m["fn"](t),
                    }
                    for m in sensor["measurements"]
                ]

                payload = {
                    "id":           sensor["id"],
                    "gateway_id":   sensor["gateway_id"],
                    "timestamp":    ts_iso,
                    "measurements": measurements,
                }

                topic = f"sensors/{sensor['id']}"
                client.publish(topic, json.dumps(payload), qos=0)

                meas_str = ", ".join(
                    f"{m['quantity']}={m['value']} {m['unit']}" for m in measurements
                )
                print(f"  -> [{sensor['gateway_id']}] {sensor['id'][-4:]}  {meas_str}")

            print()
            t += INTERVAL
            time.sleep(INTERVAL)

    except KeyboardInterrupt:
        print("\nSimulator gestoppt.")
    finally:
        client.loop_stop()
        client.disconnect()


if __name__ == "__main__":
    main()
