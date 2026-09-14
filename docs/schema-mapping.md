# Datenbankschema und Messgroessen

## Ablageort des Schemas

Das Basisschema liegt in:

- [`node-backend/migrations/0001_init.sql`](../node-backend/migrations/0001_init.sql)

Weitere Schemaaenderungen liegen in:

- [`node-backend/migrations/`](../node-backend/migrations/)

Die urspruengliche, inzwischen ergaenzte Schema-Datei liegt in:

- [`db-init/001_schema.sql`](../db-init/001_schema.sql)

Fuer den aktuellen Betrieb sind die Migrationen unter `node-backend/migrations/` massgeblich.

## Speicherung der Messgroesse

Die Tabelle `sensor_data` speichert die Messgroesse als freien Text:

```sql
quantity TEXT NOT NULL
```

Es gibt daher im Datenbankschema keine feste Enum-Liste. Die verwendeten Werte werden von den Sensoren beziehungsweise dem Simulator geliefert.

## Aktuell vereinbarte Werte

Die Definitionen stehen in [`edge-agent/ohb_edge/sensors.py`](../edge-agent/ohb_edge/sensors.py):

| Quantity | Bedeutung | Beispiel-Einheit |
|---|---|---|
| `temperature` | Temperatur | `degC` |
| `humidity` | Luftfeuchte | `%rH` |
| `pressure` | Druck | `hPa` |
| `eco2` | eCO2 | `ppm` |
| `tvoc` | TVOC | `ppb` |
| `wind_speed` | Luftstroemung | `m/s` |
| `pm2_5` | Feinstaub PM2.5 | `ug/m3` |
| `pm10` | Feinstaub PM10 | `ug/m3` |

Der Simulator verwendet dieselben Werte in [`MQTT_Publish_Test/mqtt_simulator.py`](../MQTT_Publish_Test/mqtt_simulator.py).

## Wichtige Abweichungen

Die Werte aus der offenen Abnahme-Notiz sind teilweise anders benannt:

| Notiz | Aktueller Projektwert |
|---|---|
| `pm25` | `pm2_5` |
| `mps` | `wind_speed` |

Die Namen muessen fuer Dashboard, API, Schwellenwerte und Alarmierung konsistent bleiben. Aktuell sollte daher `pm2_5` beziehungsweise `wind_speed` verwendet werden.

## Pruefung der realen Datenbank

Mit dieser Abfrage lassen sich alle tatsaechlich gespeicherten Messgroessen pruefen:

```sql
SELECT DISTINCT quantity
FROM sensor_data
ORDER BY quantity;
```

Das erwartete Ergebnis ist, je nach bereits eingegangenen Messungen, eine Teilmenge von:

```text
eco2
humidity
pm10
pm2_5
pressure
temperature
tvoc
wind_speed
```
