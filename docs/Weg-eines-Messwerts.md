# Der Weg eines Messwerts

> Ein einzelner Temperaturwert, von der Sensorleitung bis in den PDF-Report — mit allen
> Zwischenstationen, den echten Bezeichnern und der Zusicherung, die an jeder Übergabe gilt.
>
> **Stand:** 28.07.2026 · Beschreibt den umgesetzten Zustand.

Verwandt: [Verlustfreiheit.md](Verlustfreiheit.md) (warum nichts verloren geht) ·
[Feldebene.md](Feldebene.md) (der Pi) · [openapi.yaml](openapi.yaml) (die Schnittstelle)

---

## Inhaltsverzeichnis

1. [Gesamtbild](#1-gesamtbild)
2. [Was der Messwert an jeder Station *ist*](#2-was-der-messwert-an-jeder-station-ist)
3. [Die Bezeichner im Überblick](#3-die-bezeichner-im-überblick)
4. [Zeitlicher Ablauf mit Bestätigungen](#4-zeitlicher-ablauf-mit-bestätigungen)
5. [Die drei Abzweigungen im Detail](#5-die-drei-abzweigungen-im-detail)
6. [Wo es hakt, wenn etwas ausfällt](#6-wo-es-hakt-wenn-etwas-ausfällt)

---

## 1. Gesamtbild

```mermaid
flowchart TB

    %% ══════════════ ① FELDEBENE ══════════════
    subgraph Z1["① RASPBERRY PI · am Messpunkt"]
        direction TB
        SENS["Sensor"]
        READ["sensors.py<br/>read()"]
        STAMP["models.py<br/>Zeitstempel + Format"]
        CLOCK{"clock.py<br/>Uhr gueltig?"}
        OUT[("outbox.sqlite3<br/>Tabelle outbox")]
        SEND["publisher.py"]

        SENS -->|"Rohwert ablesen"| READ
        READ -->|"quantity · unit · value"| STAMP
        STAMP -->|"captured_at = jetzt UTC<br/>+ monotone Marke"| CLOCK
        CLOCK -->|"nein: nur puffern"| OUT
        CLOCK -->|"ja"| OUT
        OUT -->|"write-ahead: erst ablegen"| SEND
        SEND -.->|"nach PUBACK: Zeile loeschen"| OUT
    end

    %% ══════════════ ② BROKER ══════════════
    subgraph Z2["② MOSQUITTO · Broker"]
        direction TB
        TOPIC["Topic<br/>sensors/SENSOR-UUID"]
        MDISK[("mosquitto.db<br/>Queue je Session")]
        TOPIC -->|"unbestaetigte Nachrichten<br/>auf Platte halten"| MDISK
    end

    %% ══════════════ ③ ABNEHMER ══════════════
    subgraph Z3["③ ZWEI ABNEHMER · beide abonnieren sensors/#"]
        direction LR
        ING["ingest<br/>QoS 1 · clean=false"]
        WS["Browser<br/>WebSocket ueber /mqtt"]
    end

    %% ══════════════ ④ TABELLEN ══════════════
    subgraph Z4["④ TABELLEN · PostgreSQL + TimescaleDB"]
        direction TB
        VAL{"Zod-Pruefung<br/>messageSchema.js"}

        REG[("sensor_registry<br/>WER misst")]
        DATA[("sensor_data<br/>WAS gemessen wurde<br/>Hypertable")]
        REJ[("ingest_rejects<br/>WAS unlesbar war")]

        TRG{"trg_check_threshold<br/>je neuer Zeile"}

        THR[("sensor_thresholds<br/>WELCHE Grenze galt")]
        ASG[("sensor_assignments<br/>IN WELCHEM Raum")]
        ROOM[("cleanrooms<br/>Raumnamen")]
        VIOL[("threshold_violations<br/>WANN + WIE LANGE verletzt")]

        VAL -->|"ungueltig: ablegen und bestaetigen"| REJ
        VAL -->|"gueltig"| REG
        VAL -->|"gueltig"| DATA

        DATA ==>|"AFTER INSERT"| TRG
        TRG -.->|"galt hier eine Grenze?"| THR
        TRG -.->|"welcher Raum damals?"| ASG
        ASG -.-> ROOM
        TRG ==>|"Ereignis anlegen<br/>Grenzen einfrieren"| VIOL
    end

    %% ══════════════ ⑤ AUSLIEFERUNG ══════════════
    subgraph Z5["⑤ AUSLIEFERUNG · nginx Port 80"]
        direction TB
        API["api<br/>Express"]
        NGX["nginx"]
        BROW["Browser<br/>Dashboard"]
        PDF["PDF-Report"]
        API --> NGX --> BROW
        API --> PDF
    end

    %% ══════════════ ⑥ ARCHIV ══════════════
    subgraph Z6["⑥ ARCHIV · pgBackRest"]
        direction TB
        WALF["archive_command"]
        REPO[("repo1<br/>lokales Volume")]
        S3[("S3 / NAS<br/>noch offen")]
        WALF -->|"WAL-Segment schieben"| REPO
        REPO -.->|"TODO: repo1-type=s3"| S3
    end

    %% ══════════════ VERBINDUNGEN ══════════════
    SEND ==>|"PUBLISH QoS 1<br/>eine Nachricht, N Messgroessen"| TOPIC
    TOPIC ==>|"zustellen"| ING
    TOPIC ==>|"zustellen"| WS
    ING ==>|"JSON pruefen"| VAL
    DATA -.->|"COMMIT ok -> PUBACK"| ING

    DATA -->|"WAL nach COMMIT"| WALF
    TRG -->|"pg_notify threshold_alert"| API

    DATA -->|"GET /api/sensordata<br/>Zeitreihe"| API
    VIOL -->|"GET /api/violations<br/>Alarmliste"| API
    REG -->|"GET /api/panels<br/>welche Kanaele gibt es"| API
    THR -->|"GET /api/thresholds"| API

    WS ==>|"Live-Kurve, ohne Datenbank"| BROW
    API -->|"SSE /api/alerts/stream"| BROW
    API -->|"HTTP POST"| NTFY["ntfy.sh<br/>Push aufs Handy"]

    %% ══════════════ FARBEN ══════════════
    classDef feld   fill:#1e3a5f,stroke:#38bdf8,stroke-width:2px,color:#e8eef6
    classDef broker fill:#713f12,stroke:#f59e0b,stroke-width:2px,color:#fff7e6
    classDef app    fill:#14532d,stroke:#22c55e,stroke-width:2px,color:#e6f9ec
    classDef tabelle fill:#3b0764,stroke:#a855f7,stroke-width:2px,color:#f5e8ff
    classDef logik  fill:#5b21b6,stroke:#c4b5fd,stroke-width:2px,color:#f5f3ff
    classDef out    fill:#0a2342,stroke:#00aaff,stroke-width:2px,color:#e8eef6
    classDef arch   fill:#374151,stroke:#9ca3af,stroke-width:2px,color:#f3f4f6

    class SENS,READ,STAMP,CLOCK,OUT,SEND feld
    class TOPIC,MDISK broker
    class ING,WS app
    class REG,DATA,REJ,THR,ASG,ROOM,VIOL tabelle
    class VAL,TRG logik
    class API,NGX,BROW,PDF,NTFY out
    class WALF,REPO,S3 arch
```

**So liest sich das Diagramm**

| Form | Bedeutung |
|---|---|
| `[( Zylinder )]` | Tabelle oder Datei — hier liegen Daten |
| `{ Raute }` | Prüfung oder Trigger — hier wird entschieden |
| `[ Kasten ]` | Programmteil — hier wird gearbeitet |
| `═══▶` fett | Der Messwert selbst wandert hier entlang |
| `───▶` normal | Abgeleitete Daten, Abfragen, Schreibvorgänge |
| `╌╌╌▶` gestrichelt | Lesezugriff, Bestätigung oder noch nicht umgesetzt |

**Die vier Tabellen, in die geschrieben wird**

| Tabelle | Bekommt | Von wem |
|---|---|---|
| `sensor_registry` | Kennung, Name, Gateway — **wer** misst | ingest, bei jeder Nachricht (nur bei Änderung) |
| `sensor_data` | Zeit, Messgröße, Einheit, Wert — **was** gemessen wurde | ingest, eine Zeile je Messgröße |
| `threshold_violations` | Beginn, Dauer, Extremwert — **wann** verletzt wurde | Trigger, nur beim Öffnen eines Ereignisses |
| `ingest_rejects` | Topic, Grund, Rohtext — **was** nicht lesbar war | ingest, bei ungültiger Nachricht |

**Die drei Tabellen, die nur gelesen werden**

| Tabelle | Beantwortet | Wer fragt |
|---|---|---|
| `sensor_thresholds` | Welche Grenze galt zum Messzeitpunkt? | Trigger, bei jeder neuen Zeile |
| `sensor_assignments` | In welchem Reinraum hing der Sensor damals? | Trigger, beim Anlegen eines Ereignisses |
| `cleanrooms` | Wie heißt der Raum? | Trigger und API |

> Beide Nachschlagetabellen werden **mit dem Messzeitpunkt** befragt, nicht mit `now()`.
> Deshalb bewertet der Report von vor drei Monaten mit dem Grenzwert, der damals galt.

---

## 2. Was der Messwert an jeder Station *ist*

Derselbe Wert — 22,4 °C — in seinen sechs Erscheinungsformen:

| # | Station | Gestalt |
|---|---|---|
| 1 | **Pi, im Speicher** | `Measurement(quantity="temperature", unit="°C", value=22.4)` |
| 2 | **Pi, im Puffer** | Zeile in `outbox`: `captured_at`, `monotonic_s`, `clock_trusted`, `measurements` (JSON) |
| 3 | **Auf der Leitung** | MQTT-Nachricht auf `sensors/a1b2…0001`, QoS 1 |
| 4 | **In der Datenbank** | Zeile in `sensor_data`: `time`, `sensor_uuid`, `quantity`, `unit`, `value` |
| 5 | **In der Antwort der API** | `{ "time": "…", "quantity": "temperature", "unit": "°C", "value": 22.4 }` |
| 6 | **Im PDF-Report** | Tabellenzeile mit Zeitpunkt, Wert und Status `OK` / `VERLETZUNG` |

### Die Nachricht auf der Leitung

```jsonc
// Topic: sensors/a1b2c3d4-0001-0001-0001-000000000001
{
  "id":           "a1b2c3d4-0001-0001-0001-000000000001",
  "gateway_id":   "gw-reinraum-221",
  "name":         "Temperatursensor Eingang",
  "event_driven": 0,
  "timestamp":    "2026-07-28T10:15:00.123Z",   // ← vom Pi gesetzt, TRAGEND
  "measurements": [
    { "quantity": "temperature", "unit": "°C",  "value": 22.4 },
    { "quantity": "pressure",    "unit": "hPa", "value": 1013.2 }
  ]
}
```

**Eine Nachricht wird zu N Zeilen.** Die zwei Messgrößen oben ergeben zwei Zeilen in
`sensor_data` — geschrieben in *einer* Transaktion mit *einem* Statement, damit eine
Nachricht niemals halb ankommt.

---

## 3. Die Bezeichner im Überblick

Alles, was man beim Suchen braucht:

| Station | Bezeichner |
|---|---|
| Pi sendet auf | `sensors/<sensor_uuid>` |
| Pi-Puffer | `/var/lib/ohb-edge/outbox.sqlite3`, Tabelle `outbox` |
| Pi-Kennung | `OHB_CLIENT_ID`, Vorgabe `ohb-edge-<8 Stellen der UUID>` |
| Broker-Ports | `1883` MQTT (Feld) · `9001` WebSocket (nur intern, über nginx) |
| Broker-Persistenz | `/mosquitto/data/mosquitto.db` |
| Ingest abonniert | `sensors/#`, QoS 1, `clean=false`, ClientId `ohb-ingest-1` |
| Prüfung der Nachricht | `src/ingest/messageSchema.js` (Zod) |
| Verworfene Nachrichten | Tabelle `ingest_rejects` |
| Messdaten | Hypertable `sensor_data` |
| Eindeutigkeit | `idx_sensor_data_uniq (sensor_uuid, quantity, time)` |
| Schwellenwert-Prüfung | Trigger `trg_check_threshold` → `check_threshold_violation()` |
| Alarm-Ereignisse | Tabelle `threshold_violations` |
| Alarm-Kanal | `pg_notify('threshold_alert', …)` |
| Zeitreihe abrufen | `GET /api/sensordata?sensor_uuid=…&quantity=…` |
| Dashboard-Kanäle | `GET /api/panels` |
| Live-Alarme | `GET /api/alerts/stream` (Server-Sent Events) |
| Report | `POST /api/report` |
| Browser erreicht MQTT über | `ws://<host>/mqtt` → nginx → `mosquitto:9001` |
| WAL-Archiv | `archive_command = pgbackrest --stanza=ohb archive-push %p` |
| Archivablage | `/var/lib/pgbackrest` — **S3 oder NAS noch offen** |

---

## 4. Zeitlicher Ablauf mit Bestätigungen

Der Unterschied zwischen „abgeschickt" und „angekommen":

```mermaid
sequenceDiagram
    autonumber
    participant PI as Raspberry Pi
    participant BUF as Tabelle outbox
    participant MQ as Mosquitto
    participant IN as ingest
    participant SD as Tabelle sensor_data
    participant TR as Trigger
    participant TV as Tabelle threshold_violations
    participant API as api
    participant BR as Browser

    Note over PI: Sensor gelesen, Zeitstempel gesetzt

    PI->>BUF: INSERT — write-ahead, vor dem Senden
    Note over BUF: Ab hier ueberlebt der Wert<br/>auch einen Stromausfall

    PI->>MQ: PUBLISH QoS 1
    MQ-->>PI: PUBACK
    PI->>BUF: DELETE — erst JETZT

    par Persistenzpfad
        MQ->>IN: PUBLISH QoS 1
        IN->>IN: Zod-Pruefung des JSON
        IN->>SD: BEGIN · UPSERT sensor_registry<br/>· INSERT sensor_data ON CONFLICT DO NOTHING · COMMIT
        SD-->>IN: COMMIT ok
        IN-->>MQ: PUBACK — erst JETZT
        Note over MQ: Nachricht wird geloescht
    and Live-Pfad
        MQ->>BR: WebSocket — ohne Umweg ueber die Datenbank
        BR->>BR: Ringpuffer 60 Punkte, rAF-Batch, Plotly
    end

    SD->>TR: AFTER INSERT, je geschriebener Zeile
    TR->>TR: liest sensor_thresholds: galt eine Grenze?

    alt Grenze verletzt und noch kein Ereignis offen
        TR->>TR: liest sensor_assignments: welcher Raum?
        TR->>TV: INSERT Ereignis, Grenzen einfrieren
        TV-->>API: pg_notify threshold_alert
        API->>BR: Server-Sent Event
        API->>API: HTTP POST an ntfy.sh
    else Ereignis laeuft bereits
        TR->>TV: UPDATE peak_value, data_points+1 — KEINE Meldung
    else keine Verletzung
        TR->>TV: offenes Ereignis schliessen
    end

    Note over SD: WAL-Segment voll oder archive_timeout 300 s
    SD->>SD: archive_command -> pgBackRest -> repo1
```

**Die zwei Bestätigungen sind der Kern:** Der Pi löscht erst nach dem `PUBACK` des
Brokers, der Ingest bestätigt erst nach dem `COMMIT` der Datenbank. Dazwischen liegt an
keiner Stelle ein Moment, in dem der Wert nur an einer Stelle existiert.

---

## 5. Die drei Abzweigungen im Detail

Ab dem Broker teilt sich der Weg dreifach.

```mermaid
flowchart LR
    MQ["Mosquitto<br/>sensors/#"]

    MQ -->|"① LIVE"| L["Browser<br/>WebSocket"]
    MQ -->|"② PERSISTENZ"| P["ingest schreibt<br/>sensor_registry + sensor_data"]
    P -->|"③ ARCHIV"| A["WAL -> pgBackRest -> repo1"]

    L --> L1["Latenz: Millisekunden<br/>Ringpuffer 60 Punkte<br/>ueberlebt Backend-Ausfall"]
    P --> P1["Latenz: Sekunden<br/>dauerhaft, indiziert<br/>Grundlage aller Auswertung"]
    A --> A1["Latenz: bis 5 min<br/>archive_timeout=300<br/>Wiederherstellung auf Zeitpunkt"]

    classDef live fill:#713f12,stroke:#f59e0b,color:#fff7e6
    classDef pers fill:#14532d,stroke:#22c55e,color:#e6f9ec
    classDef arch fill:#374151,stroke:#9ca3af,color:#f3f4f6
    class L,L1 live
    class P,P1 pers
    class A,A1 arch
```

### ① Live-Pfad — der Browser hört direkt mit

Der Browser abonniert `sensors/#` **selbst**, per WebSocket über nginx. Die Werte im
Chart kommen also nicht aus der Datenbank, sondern direkt vom Broker.

Warum: Fällt `api` oder `postgres` aus, laufen die Live-Kurven weiter. Der Ausfall wird
sichtbar (Historie und Alarme fehlen), aber der Reinraum bleibt beobachtbar.

Der Ringpuffer hält 60 Punkte je Kanal; die Aktualisierung läuft gebündelt über
`requestAnimationFrame`, damit fünf Nachrichten pro Sekunde nicht fünf Neuzeichnungen
je Chart auslösen.

### ② Persistenzpfad — die eigentliche Aufzeichnung

Hier entsteht alles, was später auswertbar ist: Historie, Statistik, Alarme, Reports.
Der Pfad ist der einzige, der Zusicherungen gibt — siehe
[Verlustfreiheit.md](Verlustfreiheit.md).

**Innerhalb dieses Pfads zweigt der Alarm ab.** Der Trigger läuft `AFTER INSERT FOR EACH
ROW` — also für jede geschriebene Zeile, in derselben Transaktion:

```mermaid
flowchart TD
    INS["neue Zeile in sensor_data"] --> T{"liest sensor_thresholds:<br/>galt eine Grenze<br/>zum Messzeitpunkt?"}
    T -->|"nein"| E["threshold_violations:<br/>offenes Ereignis schliessen"]
    T -->|"ja"| V{"Wert ausserhalb<br/>min / max?"}
    V -->|"nein"| E
    V -->|"ja"| O{"threshold_violations:<br/>laeuft bereits ein<br/>Ereignis dieses Typs?"}
    O -->|"ja"| U["UPDATE peak_value,<br/>data_points+1<br/>KEINE Benachrichtigung"]
    O -->|"nein"| N["liest sensor_assignments<br/>INSERT Ereignis<br/>Grenzen einfrieren + pg_notify"]
    N --> SSE["api -> SSE -> Browser"]
    N --> NTFY["api -> ntfy.sh -> Handy"]

    classDef ok  fill:#14532d,stroke:#22c55e,color:#e6f9ec
    classDef bad fill:#7f1d1d,stroke:#ef4444,color:#fee2e2
    class E ok
    class N,SSE,NTFY bad
```

Entscheidend: `pg_notify` feuert **nur beim Öffnen** eines Ereignisses. Eine
zehnminütige Überschreitung im Zwei-Sekunden-Takt erzeugt 300 Messwerte, aber genau
**einen** Alarm.

### ③ Archivpfad — von der Datenbank in die Sicherung

Der Messwert liegt nach dem `COMMIT` im Write-Ahead-Log. PostgreSQL ruft
`archive_command` auf, sobald ein WAL-Segment voll ist — spätestens aber nach
`archive_timeout = 300` Sekunden.

```mermaid
flowchart LR
    C["COMMIT auf sensor_data"] --> W["WAL-Segment"]
    W -->|"voll ODER 5 min"| AC["archive_command<br/>pgbackrest archive-push"]
    AC --> R[("repo1<br/>/var/lib/pgbackrest")]

    BF["ops/backup.ps1<br/>sonntags voll<br/>Mo-Sa differenziell"] --> R
    R --> PITR["Wiederherstellung<br/>auf beliebigen Zeitpunkt"]
    R -.->|"TODO"| S3[("S3 / NAS<br/>andere Hardware")]

    classDef have fill:#374151,stroke:#9ca3af,color:#f3f4f6
    classDef todo fill:#7f1d1d,stroke:#ef4444,color:#fee2e2
    class C,W,AC,R,BF,PITR have
    class S3 todo
```

> ⚠️ **Basissicherung und WAL-Archiv gehören zusammen.** Aus WAL-Segmenten allein
> lässt sich nichts wiederherstellen — sie sind Ergänzungen zu einer Basis. Ohne
> mindestens eine Vollsicherung meldet `pgbackrest info` folgerichtig
> `status: error (no valid backups)`.

**Der Archivpfad liegt derzeit auf derselben Hardware wie die Datenbank.** Das schützt
gegen Fehlbedienung und logische Fehler, nicht gegen Plattendefekt. Die Umstellung auf
S3 oder ein NAS ist eine Konfigurationszeile in `docker/postgres/pgbackrest.conf` —
siehe [Betriebshandbuch §6](Betriebshandbuch.md).

---

## 6. Wo es hakt, wenn etwas ausfällt

Dieselbe Reise, mit Störungen an jeder Station:

```mermaid
flowchart TB
    subgraph AUSFALL["Was passiert, wenn …"]
        direction TB
        A1["Sensor liefert nicht<br/>-> ingest_lag steigt<br/>-> /api/health/deep meldet 503<br/>-> Kuma alarmiert nach 5 min"]
        A2["Pi ohne Netz<br/>-> outbox.sqlite3 waechst<br/>-> nach Rueckkehr Nachlieferung<br/>-> Idempotenz verhindert Duplikate"]
        A3["Pi ohne gueltige Uhr<br/>-> wird gepuffert, NICHT gesendet<br/>-> Zeitstempel spaeter berichtigt<br/>-> nach Neustart: Quarantaene"]
        A4["Broker weg<br/>-> keine Live-Werte, keine Aufzeichnung<br/>-> Pi puffert weiter<br/>-> Historie bleibt bedienbar"]
        A5["Datenbank weg<br/>-> ingest wiederholt, beendet sich<br/>-> Broker haelt die Nachrichten<br/>-> Live-Kurven laufen weiter"]
        A6["api weg<br/>-> keine Historie, keine Alarme, kein PDF<br/>-> ingest schreibt unbeeindruckt weiter<br/>-> Live-Kurven laufen weiter"]
        A7["nginx weg<br/>-> nichts mehr im Browser erreichbar<br/>-> EINZIGER Punkt ohne Ausweichweg"]
    end

    classDef warn fill:#713f12,stroke:#f59e0b,color:#fff7e6
    classDef bad  fill:#7f1d1d,stroke:#ef4444,color:#fee2e2
    classDef ok   fill:#14532d,stroke:#22c55e,color:#e6f9ec
    class A2,A3,A5,A6 ok
    class A1,A4 warn
    class A7 bad
```

| Station | Datenverlust? | Wer merkt es? |
|---|---|---|
| Sensor defekt | ja — es entsteht nichts | `worst_lag_sec` in `/api/health/deep` |
| Pi ohne Netz | **nein** — Puffer bis rund 2,3 Tage | Kuma-Heartbeat des Pi bleibt aus |
| Pi ohne Uhr | **nein**, aber verzögert | `uhr_vertrauenswuerdig` in der Statusdatei |
| Broker aus | ⚠️ nur wenn der Pi nicht puffert | Kuma-MQTT-Monitor |
| Datenbank aus | **nein** — Broker puffert 500 000 Nachrichten | Kuma-Postgres-Monitor |
| `api` aus | nein | Kuma-HTTP-Monitor |
| Archiv scheitert | nein, aber keine Wiederherstellung möglich | `wal_archive_failing` |

Die vollständige Ausfallmatrix mit den ersten Schritten steht im
[Betriebshandbuch §3](Betriebshandbuch.md).
