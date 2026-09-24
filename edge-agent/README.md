# OHB Edge-Agent

Läuft auf dem Raspberry Pi am Messpunkt: erfasst Sensorwerte, **setzt den
Zeitstempel**, puffert dauerhaft und sendet mit Zusicherung an den MQTT-Broker.

Damit beginnt die verlustfreie Kette am Sensor statt erst am Broker.
Einordnung, warum dieser Agent bislang nicht im Einsatz ist:
[../docs/Architektur.md](../docs/Architektur.md#13-feldebene).

---

## Was der Agent zusichert

| Zusicherung | Mechanismus |
|---|---|
| **Keine Messung geht durch Netz- oder Brokerausfall verloren** | Jede Messung wird **vor** dem Senden in einen SQLite-Puffer geschrieben und erst nach dem `PUBACK` des Brokers gelöscht |
| **Keine Messung geht durch Stromausfall verloren** | Der Puffer liegt auf der Platte, nicht im Arbeitsspeicher |
| **Keine doppelten Werte auf dem Server** | Der Zeitstempel entsteht beim **Erfassen**. Eine nachgelieferte Nachricht trägt denselben Schlüssel und wird serverseitig als Wiederholung erkannt |
| **Keine falschen Zeitstempel** | Ohne vertrauenswürdige Uhr wird gepuffert, aber nicht gesendet. Sobald die Uhr steht, werden die gepufferten Zeitpunkte über die monotone Uhr **rückwirkend berichtigt** |
| **Kein vollgelaufenes Dateisystem** | Der Puffer hat eine Obergrenze; bei Überlauf werden die ältesten Einträge verworfen und laut protokolliert |

---

## Einrichtung auf dem Pi

```bash
sudo useradd --system --home /opt/ohb-edge --shell /usr/sbin/nologin ohb
sudo mkdir -p /opt/ohb-edge /etc/ohb-edge
sudo chown ohb:ohb /opt/ohb-edge

# Paket ablegen
sudo -u ohb cp -r ohb_edge /opt/ohb-edge/
sudo -u ohb python3 -m venv /opt/ohb-edge/.venv
sudo -u ohb /opt/ohb-edge/.venv/bin/pip install -r requirements.txt

# Konfiguration
sudo cp config.example.env /etc/ohb-edge/agent.env
sudo chmod 640 /etc/ohb-edge/agent.env      # enthält ggf. das Broker-Passwort
sudo chown root:ohb /etc/ohb-edge/agent.env
sudo nano /etc/ohb-edge/agent.env           # UUID, Broker, Quelle eintragen

# Dienst
sudo cp systemd/ohb-edge.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now ohb-edge
journalctl -u ohb-edge -f
```

### Sensor-UUID erzeugen

```bash
python3 -c "import uuid; print(uuid.uuid4())"
```

> ⚠️ **Die UUID darf sich nie ändern.** Sie bildet zusammen mit Messgröße und
> Zeitstempel den Schlüssel, über den der Server Wiederholungen erkennt. Eine neue
> UUID erzeugt serverseitig einen neuen Sensor — ohne Raumzuordnung, ohne
> Schwellenwerte und damit ohne Alarmierung.

---

## Die Datenquelle anpassen

**Das ist die einzige Datei, die angefasst werden muss:** `ohb_edge/sensors.py`.

Der Vertrag ist schmal:

```python
class MeineQuelle:
    def read(self) -> list[Measurement]: ...   # alle Messgrößen dieses Zyklus
    def close(self) -> None: ...
```

Drei vorbereitete Platzhalter mit Grundgerüst im Docstring:

| Klasse | Für |
|---|---|
| `GpioSource` | Sensoren direkt am Pi (I²C, SPI, GPIO) |
| `SerialSource` | Messgerät über USB oder serielle Schnittstelle |
| `UpstreamMqttSource` | Werte kommen bereits per MQTT von einem anderen Broker |

Auswahl über `OHB_SOURCE` in der Konfiguration. `OHB_SOURCE=demo` erzeugt plausible
Werte ohne Hardware — damit lässt sich die gesamte Kette prüfen, bevor etwas
angeschlossen ist.

### Regeln für die Umsetzung

- `read()` darf blockieren, aber nicht lange. Über etwa einer Sekunde verschiebt sich
  der Messtakt. Bei langsamen Bussen in einem eigenen Thread lesen und hier den
  zuletzt bekannten Wert liefern.
- Fehler dürfen geworfen werden — die Schleife fängt sie, protokolliert und misst
  weiter. Ein defekter Sensor legt den Agenten nicht lahm.
- Eine **leere Liste** bedeutet „gerade nichts Neues" und ist zulässig.
- `quantity` muss exakt der serverseitigen Schreibweise entsprechen. Die Konstanten
  aus `sensors.py` verwenden — ein Tippfehler erzeugt einen Kanal ohne Schwellenwert
  und damit ohne Alarmierung.

---

## Uhrzeit

Ein Raspberry Pi hat **keine batteriegepufferte Echtzeituhr**. Der Agent behandelt das
in zwei Stufen:

1. **Nicht senden, was er nicht verantworten kann.** Solange `timedatectl` keine
   NTP-Synchronität meldet, wandern Messungen in den Puffer, aber nicht auf die
   Leitung.
2. **Nachträglich berichtigen.** Zu jeder Messung wird die monotone Uhr festgehalten.
   Wird die Wanduhr später vertrauenswürdig, berechnet der Agent den wahren Zeitpunkt
   jeder gepufferten Messung und sendet sie mit korrektem Zeitstempel.

Überlebt ein **Neustart** die Phase ohne gültige Uhr, sind diese Messungen nicht mehr
korrigierbar — die monotone Uhr beginnt bei jedem Start neu. Sie werden dann in
Quarantäne gestellt statt mit falscher Zeit versendet:

```sql
-- Auf dem Pi
SELECT * FROM outbox WHERE state = 'quarantined';
```

**Mit RTC-Modul** (DS3231, wenige Euro, I²C) entfällt das Problem an der Wurzel. Dann
`OHB_REQUIRE_CLOCK_SYNC=false` setzen — bei ortsfesten Messstellen mit Auditanspruch
die angemessene Lösung.

---

## Betrieb

### Zustand ansehen

```bash
systemctl status ohb-edge
journalctl -u ohb-edge -n 50
cat /run/ohb-edge/status.json
```

```jsonc
{
  "sensor_uuid": "…",
  "verbunden": true,
  "uhr_vertrauenswuerdig": true,
  "uhr_grund": "NTP synchronisiert",
  "puffer_offen": 0,          // > 0 über längere Zeit = Verbindungsproblem
  "puffer_quarantaene": 0,    // > 0 = Zeitstempel unrettbar, siehe oben
  "erfasst": 1834,
  "gesendet": 1834,
  "lesefehler": 0             // > 0 = Sensor prüfen
}
```

### An Uptime Kuma anbinden

Ein Cron-Eintrag, der die Statusdatei liest und einen Heartbeat schickt — dann fällt
ein hängender Pi zentral auf:

```bash
*/2 * * * * test "$(jq -r .verbunden /run/ohb-edge/status.json)" = "true" \
  && curl -fsS "https://kuma.intern/api/push/ABC?status=up" >/dev/null
```

### Puffer einsehen

```bash
sudo -u ohb sqlite3 /var/lib/ohb-edge/outbox.sqlite3 \
  "SELECT state, count(*) FROM outbox GROUP BY state;"
```

---

## Entwurfsentscheidungen

**Warum immer erst in den Puffer schreiben, auch wenn die Verbindung steht?**
Zwischen Messung und Bestätigung liegt ein Zeitfenster. Fällt darin der Strom, ist die
Messung ohne Puffer verloren — und Stromausfälle sind genau der Fall, für den ein
Reinraum eine lückenlose Aufzeichnung braucht.

**Verschleißt das die SD-Karte?** Abgemildert durch `journal_mode=WAL` (sequenzielle
Anhängedatei statt verstreuter Schreibvorgänge), `synchronous=NORMAL` (ein `fsync` je
Prüfpunkt) und gebündeltes Löschen bestätigter Einträge. Für Dauerbetrieb sind
Industriekarten mit pSLC dennoch die richtige Wahl.

**Warum bricht der Versand beim ersten Fehlschlag ab?** Um die Reihenfolge zu wahren.
Zeitreihendaten sollen in der Reihenfolge ankommen, in der sie entstanden sind; der
nächste Zyklus setzt an derselben Stelle fort.

**Warum keine eigene Wiederverbindungsschleife?** `paho` bringt sie mit
(`reconnect_delay_set`). Eine zweite daneben führt zu konkurrierenden Verbindungen mit
derselben ClientId — die werfen sich gegenseitig dauerhaft aus dem Netz.

---

## Prüfung ohne Hardware

```bash
export OHB_SENSOR_UUID=$(python3 -c "import uuid; print(uuid.uuid4())")
export OHB_SOURCE=demo OHB_BROKER_HOST=127.0.0.1 OHB_BUFFER_PATH=/tmp/outbox.sqlite3
python3 -m ohb_edge
```

Mit falschem Port starten → Messungen sammeln sich im Puffer. Auf den richtigen Port
wechseln → der Rückstand wird nachgeliefert, der Puffer läuft auf 0.
