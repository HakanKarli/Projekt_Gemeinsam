# OHB Reinraum Sensor Dashboard — Projektübersicht

> Vollständige Architektur-Dokumentation des Systems: Datenfluss von der Sensorik über MQTT
> und TimescaleDB bis in das React-Dashboard, inklusive Schwellenwert-Engine, Alarmkette
> und PDF-Reporting.
>
> **Stand:** 27.07.2026 · **Branch:** `main` · **Commit:** `4fbcd06`
>
> ⚠️ **Dieses Dokument beschreibt Version 1.0.0 (Stand 03.06.2026).**
> Mit dem Umbau auf 2.0.0 haben sich Backend-Struktur, Ingest-Pfad und Betriebsmodell
> geändert. Was noch gilt: Datenmodell, Zeitraum-Versionierung, Trigger-Logik und die
> fachlichen Abläufe. Was nicht mehr gilt: die Dateistruktur des Backends
> (§16), die Prozesslandschaft (§4) und die Altlastenliste (§18).
>
> Aktueller Stand: [CHANGELOG.md](../CHANGELOG.md) ·
> [Betriebshandbuch.md](Betriebshandbuch.md) ·
> [openapi.yaml](openapi.yaml) · [Zielarchitektur.md](Zielarchitektur.md) ·
> [Engineering-Standards.md](Engineering-Standards.md)

---

## Inhaltsverzeichnis

1. [Zweck & Systemüberblick](#1-zweck--systemüberblick)
2. [Technologie-Stack](#2-technologie-stack)
3. [Systemarchitektur](#3-systemarchitektur)
4. [Laufzeit-Topologie & Ports](#4-laufzeit-topologie--ports)
5. [Datenfluss — die zwei Pfade](#5-datenfluss--die-zwei-pfade)
6. [MQTT-Vertrag & Auto-Registrierung](#6-mqtt-vertrag--auto-registrierung)
7. [Datenmodell](#7-datenmodell)
8. [Zeitliche Gültigkeit (`tstzrange`)](#8-zeitliche-gültigkeit-tstzrange)
9. [Schwellenwert-Engine](#9-schwellenwert-engine)
10. [Alarmkette: NOTIFY → SSE → Push](#10-alarmkette-notify--sse--push)
11. [REST-API-Referenz](#11-rest-api-referenz)
12. [Frontend-Architektur](#12-frontend-architektur)
13. [Performance-Strategie](#13-performance-strategie)
14. [PDF-Report-Pipeline](#14-pdf-report-pipeline)
15. [Design-System](#15-design-system)
16. [Verzeichnisstruktur](#16-verzeichnisstruktur)
17. [Betrieb & Konfiguration](#17-betrieb--konfiguration)
18. [Bekannte Altlasten & offene Punkte](#18-bekannte-altlasten--offene-punkte)

---

## 1. Zweck & Systemüberblick

Das System überwacht **Reinraum-Umgebungsparameter** (Temperatur, Druck, eCO₂, TVOC,
Luftströmung, Partikel) in Echtzeit und dokumentiert sie **audit-sicher**. Drei fachliche
Kernanforderungen prägen die Architektur:

| Anforderung | Architektur-Konsequenz |
|---|---|
| **Echtzeit-Sicht** — Werte müssen ohne merkliche Latenz im Dashboard erscheinen | Browser abonniert MQTT **direkt** per WebSocket, nicht über das Backend |
| **Lückenlose Historie** — jede Messung muss dauerhaft nachvollziehbar sein | TimescaleDB-Hypertable + parallele Persistenz-Bridge |
| **Nachvollziehbarkeit über die Zeit** — „welcher Grenzwert galt am 12.03. in Raum 221?" | Alle Stammdaten sind **zeitraum-versioniert** (`tstzrange`), nichts wird überschrieben |

Daraus folgt das zentrale Architekturprinzip: **Live-Pfad und Persistenz-Pfad sind
entkoppelt.** Der Broker ist der einzige gemeinsame Punkt. Fällt das Backend aus, laufen
die Live-Charts weiter; fällt der Browser aus, wird trotzdem lückenlos persistiert.

---

## 2. Technologie-Stack

| Schicht | Technologie | Version | Ort |
|---|---|---|---|
| **Feldebene** | Python + `paho-mqtt` (Simulator) | 3.10+ | `MQTT_Publish_Test/` |
| **Messaging** | Eclipse Mosquitto | 2.x | Docker |
| **Datenhaltung** | PostgreSQL + TimescaleDB | PG 17 | Docker |
| **Backend** | Node.js, Express, `pg`, `mqtt`, PDFKit | Node ≥ 22 · Express 4.21 | Host-Prozess |
| **Frontend** | React, Vite, Plotly.js, MQTT.js | React 19.2 · Vite 7.3 | Host-Prozess / Browser |
| **Push** | ntfy.sh (HTTP) | — | extern |

**Bewusst gewählte Nicht-Entscheidungen:** kein State-Management-Framework (Redux/Zustand) —
React Context genügt; kein ORM — reines parametrisiertes SQL; keine Container für Node/React —
nur die Infrastruktur läuft in Docker, die Anwendungsprozesse laufen auf dem Host.

---

## 3. Systemarchitektur

```mermaid
flowchart LR
    subgraph FELD["FELDEBENE"]
        direction TB
        SIM["mqtt_simulator.py<br/>5 Sensoren · alle 2 s"]
        HW["Reale Sensorik<br/>über Gateway"]
    end

    subgraph DOCKER["DOCKER COMPOSE"]
        direction TB
        MOSQ["Mosquitto 2<br/>MQTT 1883 · WebSocket 9001"]
        PG[("PostgreSQL 17<br/>TimescaleDB<br/>Port 5432")]
    end

    subgraph NODE["NODE.JS PROZESSE · Host"]
        direction TB
        BRIDGE["mqttBridge.js<br/>Ingest-Worker"]
        API["server.js<br/>Express REST · Port 3001"]
        ALERT["alertListener.js<br/>LISTEN/NOTIFY + SSE-Hub"]
    end

    subgraph CLIENT["BROWSER"]
        direction TB
        UI["React 19 Dashboard<br/>Vite Dev-Server 5173"]
    end

    NTFY["ntfy.sh<br/>Mobile Push"]

    SIM     -->|"publish sensors/UUID"| MOSQ
    HW      -.->|"publish"| MOSQ
    MOSQ    -->|"subscribe sensors/#"| BRIDGE
    MOSQ    ==>|"WebSocket · Live-Werte"| UI
    BRIDGE  -->|"INSERT sensor_data"| PG
    PG      -->|"pg_notify threshold_alert"| ALERT
    ALERT   -->|"HTTP POST"| NTFY
    ALERT   -.->|"broadcast"| API
    API     -->|"REST · Historie, Stammdaten, PDF"| UI
    API     ==>|"Server-Sent Events · Alarme"| UI
    API     <-->|"SQL Pool"| PG

    classDef feld  fill:#1e3a5f,stroke:#38bdf8,stroke-width:2px,color:#e8eef6
    classDef infra fill:#3b0764,stroke:#a855f7,stroke-width:2px,color:#f5e8ff
    classDef node  fill:#14532d,stroke:#22c55e,stroke-width:2px,color:#e6f9ec
    classDef ui    fill:#0a2342,stroke:#00aaff,stroke-width:2px,color:#e8eef6
    classDef ext   fill:#713f12,stroke:#f59e0b,stroke-width:2px,color:#fff7e6

    class SIM,HW feld
    class MOSQ,PG infra
    class BRIDGE,API,ALERT node
    class UI ui
    class NTFY ext
```

**Legende der Kantenstärken:** `===` fette Linien = Echtzeit-Kanäle (Push),
`-->` normale Linien = Request/Response oder Batch, `-.->` gestrichelt = optional/intern.

---

## 4. Laufzeit-Topologie & Ports

```mermaid
flowchart TB
    subgraph HOST["Host-Maschine · Windows"]
        direction LR

        subgraph D["Docker-Netzwerk"]
            direction TB
            P1["postgres<br/>Volume: pgdata"]
            P2["mosquitto<br/>Volumes: data, log"]
        end

        subgraph N["Node-Prozesse · npm / node"]
            direction TB
            N1["server.js"]
            N2["mqttBridge.js"]
            N3["mqtt_simulator.py"]
        end

        subgraph V["Vite Dev-Server"]
            V1["ohb-dashboard"]
        end
    end

    P1 ---|"5432"| N1
    P1 ---|"5432"| N2
    P2 ---|"1883"| N2
    P2 ---|"1883"| N3
    P2 ---|"9001 · WS"| V1
    N1 ---|"3001 · HTTP/SSE"| V1

    classDef dock fill:#3b0764,stroke:#a855f7,color:#f5e8ff
    classDef proc fill:#14532d,stroke:#22c55e,color:#e6f9ec
    classDef vite fill:#0a2342,stroke:#00aaff,color:#e8eef6
    class P1,P2 dock
    class N1,N2,N3 proc
    class V1 vite
```

| Port | Dienst | Protokoll | Konsument |
|---|---|---|---|
| `5432` | PostgreSQL/TimescaleDB | TCP/SQL | `server.js`, `mqttBridge.js`, `seed.js` |
| `1883` | Mosquitto | MQTT | `mqttBridge.js`, Simulator, reale Gateways |
| `9001` | Mosquitto | MQTT over WebSocket | **Browser** (`useMqtt`) |
| `3001` | Express | HTTP + SSE | Browser (`api.js`, `AlertPanel`) |
| `5173` | Vite | HTTP | Entwickler-Browser |

> `vite --host` und `app.listen(PORT, '0.0.0.0')` binden bewusst auf allen Interfaces —
> das Dashboard ist damit im LAN erreichbar. `api.js` leitet die Backend-Adresse aus
> `window.location.hostname` ab, funktioniert also ohne Umkonfiguration von jedem Gerät aus.

**Startsequenz** (`start.ps1`):

```mermaid
flowchart LR
    A["docker compose up -d"] --> B{"Postgres<br/>healthy?"}
    B -->|"max. 20 × 2 s"| B
    B -->|"ja"| C["server.js<br/>npm run dev"]
    C --> D["mqttBridge.js"]
    D --> E["mqtt_simulator.py"]
    E --> F["vite dev<br/>npm run dev"]
    B -->|"Timeout"| X["Warnung ausgeben,<br/>trotzdem fortfahren"]

    classDef ok fill:#14532d,stroke:#22c55e,color:#e6f9ec
    classDef warn fill:#7f1d1d,stroke:#ef4444,color:#fee
    class A,C,D,E,F ok
    class X warn
```

---

## 5. Datenfluss — die zwei Pfade

Der wichtigste Punkt der gesamten Architektur: **Ein Messwert nimmt zwei unabhängige Wege.**

```mermaid
sequenceDiagram
    autonumber
    participant S as Sensor / Simulator
    participant M as Mosquitto
    participant B as mqttBridge.js
    participant DB as TimescaleDB
    participant TR as Trigger check_threshold_violation
    participant AL as alertListener.js
    participant UI as React Dashboard

    Note over S,UI: PFAD 1 — Live-Visualisierung · Latenz ~ Millisekunden

    S->>M: publish sensors/UUID · JSON
    M-->>UI: WebSocket 9001 · sensors/#
    UI->>UI: JSON parsen, virtuelles Topic bilden<br/>UUID/QUANTITY
    UI->>UI: Ringpuffer 60 Punkte je Kanal
    UI->>UI: requestAnimationFrame-Batch → Plotly-Update

    Note over S,UI: PFAD 2 — Persistenz & Auswertung · Latenz ~ Sekunden

    M-->>B: MQTT 1883 · sensors/#
    B->>DB: UPSERT sensor_registry
    loop je Messgröße
        B->>DB: INSERT INTO sensor_data
        DB->>TR: AFTER INSERT FOR EACH ROW
        alt Grenzwert verletzt
            TR->>DB: Violation-Event öffnen / fortschreiben
            TR-->>AL: pg_notify threshold_alert
            AL-->>UI: SSE /api/alerts/stream
            AL->>AL: HTTP POST an ntfy.sh
        else Wert im Normalbereich
            TR->>DB: offenes Event schließen
        end
    end

    Note over UI: Historie, Statistik und Stammdaten<br/>kommen ausschließlich per REST aus Pfad 2
```

### Konsequenzen dieser Trennung

| Szenario | Auswirkung |
|---|---|
| Backend/Bridge offline | Live-Charts laufen weiter, **keine** Persistenz, **keine** Alarme |
| Browser geschlossen | Persistenz und Alarme laufen unverändert weiter |
| Broker offline | Beide Pfade stehen; MQTT.js reconnectet automatisch alle 3 s |
| Datenbank offline | Bridge-Insert schlägt fehl (Nachricht verworfen), Live-Sicht unbeeinträchtigt |

---

## 6. MQTT-Vertrag & Auto-Registrierung

### Topic-Schema

```
sensors/<sensor-uuid>          ← Publisher schreibt hierhin
sensors/#                      ← Bridge und Browser abonnieren komplett
```

### Nachrichtenformat

```jsonc
{
  "id":           "a1b2c3d4-0001-0001-0001-000000000001",  // UUID, Pflicht
  "gateway_id":   "gw-reinraum-221",                        // optional
  "name":         "Temperatursensor Eingang",               // optional
  "event_driven": 0,                                        // 0 = zyklisch, 1 = event-getrieben
  "timestamp":    "2026-07-27T10:15:00.000Z",               // ISO-8601
  "measurements": [
    { "quantity": "temperature", "unit": "°C",  "value": 22.4 },
    { "quantity": "pressure",    "unit": "hPa", "value": 1013.2 }
  ]
}
```

Ein Sensor kann **mehrere Messgrößen** in einer Nachricht liefern. Jede Messgröße wird zu
einer eigenen Zeile in `sensor_data` und im Frontend zu einem eigenen Panel
(„Kanal" = `sensor_uuid` + `quantity`).

### Zero-Config-Onboarding

Sensoren müssen **nicht** vorab angelegt werden — sie registrieren sich selbst:

```mermaid
flowchart TD
    MSG["MQTT-Nachricht trifft ein"] --> CHK{"UUID bereits in<br/>sensor_registry?"}
    CHK -->|"nein"| INS["INSERT<br/>name := gemeldeter Name<br/>oder UUID als Platzhalter"]
    CHK -->|"ja"| UPD{"Name noch<br/>UUID-Platzhalter?"}
    UPD -->|"ja"| TAKE["Gemeldeten Namen übernehmen"]
    UPD -->|"nein"| KEEP["Manuellen Namen SCHÜTZEN<br/>nur gateway_id / event_driven<br/>aktualisieren"]
    INS --> VIS["Sensor erscheint in<br/>Konfiguration → Sensoren"]
    TAKE --> VIS
    KEEP --> VIS
    VIS --> ASG["Manuell: Reinraum zuordnen<br/>+ Schwellenwerte setzen"]
    ASG --> DASH["Panel erscheint im Dashboard"]

    classDef auto fill:#14532d,stroke:#22c55e,color:#e6f9ec
    classDef man  fill:#1e3a5f,stroke:#38bdf8,color:#e8eef6
    classDef prot fill:#713f12,stroke:#f59e0b,color:#fff7e6
    class MSG,CHK,INS,UPD,TAKE,VIS auto
    class ASG,DASH man
    class KEEP prot
```

> **Wichtiges Detail** in `mqttBridge.js`: Die `ON CONFLICT DO UPDATE`-Klausel besitzt ein
> nachgestelltes `WHERE`, das den Schreibvorgang komplett überspringt, wenn sich nichts
> geändert hat. Bei 5 Sensoren × alle 2 s spart das dauerhaftes Table-Bloat auf
> `sensor_registry`. Ein manuell vergebener Name wird nie von einem MQTT-Payload überschrieben.

**Nur zugeordnete Sensoren erscheinen im Dashboard.** `DashboardGrid` filtert auf
`s.cleanroom_id != null` — ein neu registrierter, aber noch nicht zugeordneter Sensor bleibt
zunächst unsichtbar. Das ist gewollt: es verhindert, dass fremde MQTT-Teilnehmer das
Dashboard fluten.

---

## 7. Datenmodell

```mermaid
erDiagram
    CLEANROOMS ||--o{ SENSOR_ASSIGNMENTS : "beherbergt"
    SENSOR_REGISTRY ||--o{ SENSOR_ASSIGNMENTS : "wird zugeordnet"
    SENSOR_REGISTRY ||--o{ SENSOR_THRESHOLDS : "besitzt Grenzwerte"
    SENSOR_REGISTRY ||--o{ THRESHOLD_VIOLATIONS : "verursacht"
    CLEANROOMS ||--o{ THRESHOLD_VIOLATIONS : "Kontext zum Zeitpunkt"
    SENSOR_REGISTRY ||..o{ SENSOR_DATA : "misst · ohne FK"

    SENSOR_REGISTRY {
        UUID sensor_uuid PK "Identität aus MQTT-Payload"
        TEXT name "manuell oder gemeldet"
        TEXT gateway_id "Herkunfts-Gateway"
        SMALLINT event_driven "0 zyklisch · 1 event-getrieben"
        TIMESTAMPTZ created_at "Erstkontakt"
    }

    CLEANROOMS {
        SERIAL id PK
        TEXT name UK "z.B. Reinraum 221"
    }

    SENSOR_ASSIGNMENTS {
        SERIAL id PK
        UUID sensor_uuid FK
        INTEGER cleanroom_id FK
        TSTZRANGE valid_during "EXCLUDE gist verhindert Overlap"
    }

    SENSOR_THRESHOLDS {
        SERIAL id PK
        UUID sensor_uuid FK
        TEXT quantity "temperature, eco2, ..."
        FLOAT8 min_value "NULL = keine Untergrenze"
        FLOAT8 max_value "NULL = keine Obergrenze"
        TSTZRANGE valid_during "historisiert"
    }

    SENSOR_DATA {
        TIMESTAMPTZ time PK "Hypertable-Partitionsschlüssel"
        UUID sensor_uuid "kein FK · Insert-Performance"
        TEXT quantity
        TEXT unit
        FLOAT8 value
    }

    THRESHOLD_VIOLATIONS {
        BIGSERIAL id PK
        UUID sensor_uuid FK
        INTEGER cleanroom_id FK "Raum zum Ereigniszeitpunkt"
        TEXT quantity
        TEXT violation_type "below_min oder above_max"
        FLOAT8 threshold_min "eingefrorene Grenze"
        FLOAT8 threshold_max "eingefrorene Grenze"
        TSTZRANGE valid_during "infinity = laufend"
        FLOAT8 first_value
        FLOAT8 last_value
        FLOAT8 peak_value "extremster Wert"
        INTEGER data_points "Anzahl Verstöße"
        BOOLEAN acknowledged
    }
```

### Tabellen im Detail

| Tabelle | Rolle | Besonderheit |
|---|---|---|
| `sensor_registry` | Identitäts-Register aller je gesehenen Sensoren | wird von der Bridge selbstständig befüllt |
| `cleanrooms` | Räume/Bereiche | `name` ist `UNIQUE`; Seed legt „Reinraum 221" und „Infoboard" an |
| `sensor_assignments` | *welcher Sensor war wann in welchem Raum* | `EXCLUDE USING gist` schließt überlappende Zuordnungen physisch aus |
| `sensor_thresholds` | *welche Grenze galt wann* | dito, zusätzlich nach `quantity` getrennt |
| `sensor_data` | Messreihe | **TimescaleDB-Hypertable**, automatische Zeit-Chunks |
| `threshold_violations` | Verletzungs­**ereignisse**, nicht Einzelmesswerte | ein Event fasst beliebig viele Verstöße zusammen |

### Index-Strategie

| Index | Typ | Zweck |
|---|---|---|
| `idx_sensor_data_lookup (sensor_uuid, quantity, time DESC)` | B-Tree | trägt jede Chart-Abfrage |
| `idx_violations_range` | **GiST** | Range-Overlap `&&` für Zeitraum-Filter |
| `idx_violations_active … WHERE upper(valid_during) = 'infinity'` | Partial | findet laufende Alarme ohne Full Scan |
| `idx_violations_ack … WHERE NOT acknowledged` | Partial | Badge „offene Alarme" |
| `EXCLUDE USING gist` auf assignments/thresholds | GiST Constraint | Datenintegrität statt Applikationslogik |

> Die GiST-Constraints sind der Grund für `CREATE EXTENSION btree_gist` — sie kombinieren
> Gleichheitsvergleich (`sensor_uuid WITH =`) mit Range-Overlap (`valid_during WITH &&`)
> in einem einzigen Index.

---

## 8. Zeitliche Gültigkeit (`tstzrange`)

Drei Tabellen sind **zeitraum-versioniert**. Nichts wird überschrieben oder gelöscht —
ein „Update" schließt den alten Zeitraum und öffnet einen neuen.

```sql
-- Muster für JEDE Stammdatenänderung (Assignments, Thresholds)
UPDATE …  SET valid_during = tstzrange(lower(valid_during), now())
          WHERE … AND valid_during @> now();          -- alten Satz schließen
INSERT … VALUES (…, tstzrange(now(), 'infinity'));    -- neuen Satz öffnen
```

Beides läuft in **einer Transaktion** (`BEGIN … COMMIT`), damit nie eine Lücke oder eine
Überlappung entsteht — Letzteres würde die `EXCLUDE`-Constraint ohnehin abweisen.

```mermaid
gantt
    title Beispiel-Historie eines Temperatursensors
    dateFormat  YYYY-MM-DD
    axisFormat  %d.%m.

    section Raumzuordnung
    Reinraum 221            :done,   a1, 2026-01-01, 2026-03-15
    Infoboard               :active, a2, 2026-03-15, 2026-07-27

    section Schwellenwert temperature
    Max 25 Grad             :done,   t1, 2026-01-01, 2026-02-20
    Max 23 Grad             :active, t2, 2026-02-20, 2026-07-27

    section Verletzungs-Events
    above_max Event 1       :crit,   v1, 2026-02-22, 2026-02-23
    above_max Event 2       :crit,   v2, 2026-05-04, 2026-05-05
```

**Was das ermöglicht:** Der PDF-Report für den 22.02. weiß, dass damals Grenzwert
„Max 23" galt und der Sensor in „Reinraum 221" hing — obwohl beides inzwischen anders ist.
Genau das macht den Report audit-tauglich.

**Soft-Delete:** `DELETE /api/thresholds/:id` löscht nicht, sondern setzt
`upper(valid_during) = now()`. Die Zeile bleibt als historischer Beleg erhalten.

---

## 9. Schwellenwert-Engine

Die Auswertung läuft **vollständig in der Datenbank** — als `AFTER INSERT … FOR EACH ROW`-
Trigger auf `sensor_data`. Kein Node-Prozess pollt Werte; die Logik kann nicht umgangen
werden, egal welcher Client schreibt.

### Entscheidungsbaum der Trigger-Funktion

```mermaid
flowchart TD
    IN(["INSERT INTO sensor_data"]) --> T1{"Aktiver Schwellenwert für<br/>sensor_uuid + quantity<br/>zum Messzeitpunkt?"}

    T1 -->|"nein"| C1["Offenes Event schließen<br/>upper := NEW.time"]
    T1 -->|"ja"| T2{"Wert außerhalb<br/>min / max?"}

    T2 -->|"nein · alles OK"| C2["Offenes Event schließen<br/>upper := NEW.time"]
    T2 -->|"ja"| T3{"Bereits offenes Event<br/>desselben Typs?"}

    T3 -->|"ja"| UPD["Event FORTSCHREIBEN<br/>last_value, peak_value,<br/>data_points + 1"]
    T3 -->|"nein"| NEW1["Event anderen Typs schließen"]

    NEW1 --> ROOM["Raum aus sensor_assignments<br/>zum Messzeitpunkt ermitteln"]
    ROOM --> INS["Neues Event anlegen<br/>valid_during von NEW.time bis infinity<br/>Grenzwerte einfrieren"]
    INS --> NOT["pg_notify('threshold_alert', …)"]

    C1 --> DONE(["RETURN NEW"])
    C2 --> DONE
    UPD --> DONE
    NOT --> DONE

    classDef ok   fill:#14532d,stroke:#22c55e,color:#e6f9ec
    classDef bad  fill:#7f1d1d,stroke:#ef4444,color:#fee2e2
    classDef warn fill:#713f12,stroke:#f59e0b,color:#fff7e6
    class C1,C2 ok
    class INS,NOT,NEW1 bad
    class UPD warn
```

### Warum Events statt Einzelverstößen?

Bei 2-Sekunden-Takt erzeugt eine 10-minütige Grenzwertüberschreitung **300 Messwerte** —
aber nur **einen** Alarm. Das Event aggregiert:

- `first_value` — Wert beim Auslösen
- `peak_value` — Extremwert (`GREATEST` bei `above_max`, `LEAST` bei `below_min`)
- `last_value` — letzter Wert vor Beendigung
- `data_points` — Anzahl der betroffenen Messungen
- `duration_sec` — berechnet aus dem `tstzrange`

`pg_notify` feuert **nur beim Öffnen** eines Events, nicht bei jedem Verstoß —
das verhindert Alarm-Spam auf Handy und SSE-Kanal.

### Lebenszyklus eines Verletzungs-Events

```mermaid
stateDiagram-v2
    direction LR
    [*] --> Normalbetrieb

    Normalbetrieb --> Aktiv : Grenze verletzt · INSERT + pg_notify
    Aktiv --> Aktiv : weiterer Verstoß · peak/data_points aktualisieren
    Aktiv --> Beendet : Wert wieder im Bereich · upper := now
    Aktiv --> Beendet : Schwellenwert gelöscht
    Aktiv --> AktivNeu : Typwechsel below_min ↔ above_max
    AktivNeu --> Beendet : Wert wieder im Bereich

    Aktiv --> Quittiert : PATCH /api/violations/{id}/acknowledge
    Beendet --> Quittiert : PATCH /api/violations/{id}/acknowledge
    Quittiert --> [*]

    note right of Aktiv
        upper(valid_during) = infinity
        Anzeige-Badge: AKTIV
    end note

    note right of Beendet
        Zeitraum geschlossen
        duration_sec berechenbar
    end note
```

---

## 10. Alarmkette: NOTIFY → SSE → Push

```mermaid
sequenceDiagram
    autonumber
    participant TR as PG-Trigger
    participant PG as Channel threshold_alert
    participant AL as alertListener.js<br/>dedizierte pg.Client-Verbindung
    participant SSE as SSE-Client-Set
    participant UI as AlertPanel.jsx
    participant NT as ntfy.sh

    Note over AL: Beim Serverstart: LISTEN threshold_alert

    UI->>SSE: EventSource GET /api/alerts/stream
    SSE-->>UI: ":ok" · Verbindung offen halten

    TR->>PG: pg_notify · JSON-Payload
    PG-->>AL: notification-Event
    AL->>AL: Payload parsen · Konsolen-Log
    par Fan-out
        AL-->>SSE: broadcastSSE zu allen Clients
        SSE-->>UI: data: {…}
        UI->>UI: Live-Banner + Tabelle neu laden
    and
        AL->>NT: HTTP POST · Title, Priority 4, Tags
        NT-->>AL: 200 OK
    end

    Note over AL: Bei Verbindungsverlust:<br/>Reconnect nach 5 s
```

**Warum eine eigene `pg.Client`-Verbindung?** `LISTEN` benötigt eine **persistente**
Verbindung. Ein Pool würde die Verbindung nach jedem Query zurückgeben und die
Registrierung verlieren — deshalb betreibt `alertListener.js` bewusst eine Verbindung
außerhalb des Pools aus `db.js`.

**SSE statt WebSocket:** Alarme fließen nur in eine Richtung (Server → Browser).
`EventSource` bringt Auto-Reconnect ohne Zusatzcode mit. Das `AlertPanel` öffnet den Stream
**beim Mount**, nicht beim Öffnen des Dialogs — Alarme werden also auch empfangen, während
das Panel geschlossen ist.

---

## 11. REST-API-Referenz

Basis-URL: `http://<host>:3001/api` · CORS offen für alle Origins · JSON-Body

```mermaid
flowchart LR
    ROOT["/api"] --> H["/health<br/>GET"]
    ROOT --> AL["/alerts/stream<br/>GET · SSE"]
    ROOT --> CR["/cleanrooms"]
    ROOT --> SE["/sensors"]
    ROOT --> AS["/assignments"]
    ROOT --> TH["/thresholds"]
    ROOT --> SD["/sensordata"]
    ROOT --> VI["/violations"]
    ROOT --> RE["/report<br/>POST · PDF"]

    CR --> CR1["GET · POST<br/>DELETE /:id"]
    SE --> SE1["GET<br/>PATCH /:uuid · DELETE /:uuid"]
    AS --> AS1["GET · POST<br/>GET /history"]
    TH --> TH1["GET · POST<br/>DELETE /:id · Soft-Delete"]
    SD --> SD1["GET · GET /metrics"]
    VI --> VI1["GET · GET /summary<br/>PATCH /:id/acknowledge"]

    classDef grp fill:#0a2342,stroke:#00aaff,color:#e8eef6
    classDef leaf fill:#1e293b,stroke:#64748b,color:#cbd5e1
    class ROOT,CR,SE,AS,TH,SD,VI grp
    class H,AL,RE,CR1,SE1,AS1,TH1,SD1,VI1 leaf
```

| Methode | Pfad | Parameter | Zweck |
|---|---|---|---|
| `GET` | `/health` | — | Liveness-Probe |
| `GET` | `/alerts/stream` | — | **SSE**-Kanal für Live-Alarme |
| `GET` | `/cleanrooms` | — | alle Räume |
| `POST` | `/cleanrooms` | `{name}` | Raum anlegen · `409` bei Duplikat |
| `DELETE` | `/cleanrooms/:id` | — | Raum löschen, Zuordnungen aufräumen, Violations entkoppeln |
| `GET` | `/sensors` | — | Registry **+ aktueller Raum + gemessene Größen** (3 JOINs) |
| `PATCH` | `/sensors/:uuid` | `{name}` | umbenennen |
| `DELETE` | `/sensors/:uuid` | — | kaskadiert über Violations → Thresholds → Assignments → Registry |
| `GET` | `/assignments` | — | aktuell gültige Zuordnungen |
| `GET` | `/assignments/history` | `sensor_uuid` | vollständige Raum-Historie |
| `POST` | `/assignments` | `{sensor_uuid, cleanroom_id}` | umziehen · transaktional |
| `GET` | `/thresholds` | `sensor_uuid?` | aktuell gültige Grenzwerte |
| `POST` | `/thresholds` | `{sensor_uuid, quantity, min_value, max_value}` | neue Version setzen |
| `DELETE` | `/thresholds/:id` | — | **Soft-Delete** über Zeitraum-Schließung |
| `GET` | `/sensordata` | `sensor_uuid`, `quantity`, `from`, `to`, `limit` | Zeitreihe · Default 24 h / 500 Punkte · Cap 5000 |
| `GET` | `/sensordata/metrics` | `sensor_uuid` | verfügbare Messgrößen (`DISTINCT quantity`) |
| `GET` | `/violations` | `cleanroom_id`, `sensor_uuid`, `quantity`, `from`, `to`, `active`, `acknowledged`, `limit` | Alarm-Liste mit berechneter Dauer |
| `GET` | `/violations/summary` | `from`, `to` | Aggregat je Raum × Größe × Typ |
| `PATCH` | `/violations/:id/acknowledge` | — | quittieren |
| `POST` | `/report` | `{cleanroom_id, from, to}` | **PDF-Binary** |

---

## 12. Frontend-Architektur

### Komponentenbaum

```mermaid
flowchart TD
    MAIN["main.jsx<br/>createRoot · StrictMode"] --> APP["App.jsx<br/>View-Router über useState"]
    APP --> PROV["MqttProvider<br/>store/MqttContext.jsx"]

    PROV --> HDR["Header<br/>Status · Alarme · PDF · MQTT"]
    PROV --> SIDE["Sidebar<br/>Räume · Verlauf · Konfiguration"]
    PROV --> MAINV{{"Aktive Ansicht"}}
    PROV --> ALP["AlertPanel<br/>SSE-Consumer · immer gemountet"]

    MAINV -->|"Default"| DG["DashboardGrid<br/>alle zugeordneten Kanäle"]
    MAINV -->|"Raum gewählt"| RV["RoomView 🔸<br/>Kanäle eines Raums"]
    MAINV -->|"Verlauf"| HV["HistoryView 🔸<br/>REST-Zeitreihen"]

    DG --> SP["SensorPanel<br/>memo · Plotly Live-Chart"]
    RV --> SP
    DG --> PEM["PanelEditModal<br/>Name + Grenzwerte"]

    APP -.->|"lazy"| CM["ConnectionModal 🔸"]
    APP -.->|"lazy"| CP["ConfigPanel 🔸<br/>3 Tabs"]
    APP -.->|"lazy"| RP["ReportPanel 🔸<br/>PDF-Export"]

    SP --> PLOT["lib/plot.js<br/>geteilte Plotly-Factory + Theme"]
    HV --> PLOT

    classDef core  fill:#0a2342,stroke:#00aaff,stroke-width:2px,color:#e8eef6
    classDef view  fill:#14532d,stroke:#22c55e,color:#e6f9ec
    classDef modal fill:#3b0764,stroke:#a855f7,color:#f5e8ff
    classDef lib   fill:#1e293b,stroke:#64748b,color:#cbd5e1

    class MAIN,APP,PROV,HDR,SIDE core
    class DG,RV,HV,SP view
    class CM,CP,RP,PEM,ALP modal
    class PLOT,MAINV lib
```

> 🔸 = per `React.lazy()` code-gesplittet, wird erst beim ersten Aufruf geladen.

### Wer holt woher seine Daten?

Das ist die zentrale Orientierungshilfe im Frontend:

```mermaid
flowchart LR
    subgraph SRC1["MQTT · WebSocket 9001"]
        M1["Live-Messwerte"]
    end
    subgraph SRC2["REST · Port 3001"]
        R1["Stammdaten & Historie"]
    end
    subgraph SRC3["SSE · Port 3001"]
        S1["Alarm-Events"]
    end
    subgraph SRC4["localStorage"]
        L1["UI-Präferenzen"]
    end

    M1 --> SP["SensorPanel<br/>Chart-Verlauf"]
    R1 --> DG["DashboardGrid<br/>Panel-Liste, Grenzwerte"]
    R1 --> HV["HistoryView<br/>Zeitreihen, Statistik"]
    R1 --> CP["ConfigPanel<br/>CRUD"]
    R1 --> SB["Sidebar<br/>Räume, Zähler"]
    R1 --> AP["AlertPanel<br/>Alarm-Tabelle"]
    S1 --> AP
    R1 --> CTX["MqttContext<br/>Sensor-Namen · alle 30 s"]
    L1 --> CTX
    L1 --> DG

    classDef mq fill:#713f12,stroke:#f59e0b,color:#fff7e6
    classDef rs fill:#14532d,stroke:#22c55e,color:#e6f9ec
    classDef ss fill:#7f1d1d,stroke:#ef4444,color:#fee2e2
    classDef ls fill:#1e293b,stroke:#64748b,color:#cbd5e1
    class M1 mq
    class R1 rs
    class S1 ss
    class L1 ls
```

### State-Management

| Ebene | Mechanismus | Inhalt |
|---|---|---|
| **Global** | `MqttContext` (React Context) | MQTT-Verbindung, Broker-URL, Sensor-Namen, Topic-Listener |
| **View-Routing** | `useState` in `App.jsx` | aktive Ansicht, offene Modals, `dataVersion`-Zähler |
| **Panel-Layout** | `useDashboardLayout` → `localStorage` | Reihenfolge + ausgeblendete Panels |
| **Komponenten-lokal** | `useState` / `useRef` | Formulare, Ladezustände, Drag & Drop |

**`dataVersion` als Invalidierungs-Signal:** Beim Schließen des `ConfigPanel` erhöht `App.jsx`
einen Zähler. `DashboardGrid` und `Sidebar` haben ihn in der Dependency-Liste ihres
`useEffect` und laden dadurch sofort neu — ein leichtgewichtiger Ersatz für einen
Query-Cache, ohne zusätzliche Bibliothek.

### Custom Hooks

| Hook | Aufgabe | Status |
|---|---|---|
| `useMqtt(brokerUrl, enabled)` | Broker-Verbindung, Ringpuffer, Listener-Registry, rAF-Batching, Topic-Discovery | aktiv |
| `useDashboardLayout()` | Panel-Reihenfolge & Sichtbarkeit persistieren | aktiv |
| `useSensorPoller(uuid, quantity)` | REST-Polling einer Zeitreihe alle 20 s | **derzeit nirgends importiert** — Reserve für einen MQTT-freien Betriebsmodus |

### Browser-Persistenz

| `localStorage`-Key | Inhalt | Schreiber |
|---|---|---|
| `ohb-sensor-names` | UUID → Anzeigename (Offline-Fallback) | `MqttContext` |
| `ohb-dashboard-layout` | `{ order: [], hidden: [] }` | `useDashboardLayout` |

---

## 13. Performance-Strategie

Bei 5 Sensoren × ~2 Messgrößen × alle 2 s laufen dauerhaft ~5 Nachrichten/s durch den
Browser — jede könnte mehrere Plotly-Charts neu zeichnen. Vier Maßnahmen verhindern das:

```mermaid
flowchart TD
    MSG["MQTT-Nachricht"] --> BUF["1 · Ringpuffer<br/>max. 60 Punkte je Kanal<br/>messagesRef · useRef"]
    BUF --> DIRTY["2 · Dirty-Set<br/>nur geänderte Topics vormerken"]
    DIRTY --> RAF["3 · requestAnimationFrame<br/>ein Flush pro Frame,<br/>nicht pro Nachricht"]
    RAF --> LIS["Listener je Topic aufrufen"]
    LIS --> MEMO["4 · React.memo + useMemo<br/>nur betroffenes SensorPanel<br/>rendert neu"]
    MEMO --> PLOTLY["Plotly-Update<br/>uirevision hält Zoom"]

    classDef step fill:#0a2342,stroke:#00aaff,color:#e8eef6
    class MSG,BUF,DIRTY,RAF,LIS,MEMO,PLOTLY step
```

**Weitere Maßnahmen:**

| Maßnahme | Ort | Wirkung |
|---|---|---|
| Eine geteilte Plotly-Factory | `lib/plot.js` | Plotly wird **einmal** instanziiert statt je Komponente |
| `manualChunks` für `plotly` und `mqtt` | `vite.config.js` | kleinerer Initial-Bundle, besseres Browser-Caching |
| `React.lazy` für Sekundär-Views | `App.jsx` | Verlauf/Config/Report laden erst bei Bedarf |
| Eingefrorene Config-Objekte (`Object.freeze`) | `SensorPanel`, `HistoryView` | stabile Props → keine unnötigen Plotly-Rerenders |
| `uirevision` konstant je Topic | `SensorPanel` | manueller Zoom überlebt Datenaktualisierungen |
| Datengetriebener Y-Zoom (`yRange`) | `lib/plot.js` | Kurve füllt die Fläche, Grenzwertlinien bleiben im Bild |
| Server-seitiges `LIMIT` (Cap 5000) | `routes/sensordata.js` | schützt vor Abfragen über Monatszeiträume |

---

## 14. PDF-Report-Pipeline

```mermaid
sequenceDiagram
    autonumber
    participant U as ReportPanel.jsx
    participant API as routes/report.js
    participant DB as PostgreSQL
    participant PDF as PDFKit

    U->>API: POST /api/report<br/>{cleanroom_id, from, to}
    API->>DB: Raum laden
    API->>DB: Zuordnungen im Zeitraum<br/>valid_during && [from, to]
    Note over API: Keine Sensoren im Zeitraum → HTTP 400
    API->>DB: Messdaten aller beteiligten Sensoren
    API->>DB: Schwellenwert-HISTORIE im Zeitraum
    API->>DB: Violation-Events des Raums

    API->>API: Gruppieren nach Sensor → Messgröße
    API->>PDF: Titelblatt · OHB-Logo · Kennzahlen
    loop je Sensor × Messgröße
        API->>PDF: Statistik Min/Max/Ø + Grenzwert-Verlauf
        API->>PDF: Tabelle · letzte 50 Punkte<br/>Status grün OK / rot VERLETZUNG
        API->>PDF: Ereignisliste mit Dauer und Extremwert
    end
    PDF-->>API: Buffer
    API-->>U: application/pdf<br/>Content-Disposition attachment
    U->>U: Blob → Object-URL → Download
```

**Audit-Qualität:** Der Report zieht die Sensorliste aus den **historischen** Zuordnungen
(`valid_during && tstzrange(from, to)`), nicht aus dem aktuellen Zustand. Ein Sensor, der
inzwischen umgezogen ist, taucht trotzdem korrekt auf — mit dem Grenzwert, der damals galt.
Die Statuskennzeichnung je Messzeile stammt aus `isInViolation()`, das jeden Zeitstempel
gegen die Event-Zeiträume prüft.

---

## 15. Design-System

Definiert in `ohb-dashboard/src/index.css` als CSS Custom Properties — Dark Theme mit
Glassmorphism (`.glass-card`), abgestimmt auf die OHB-Markenfarbe.

| Token-Gruppe | Beispiele |
|---|---|
| **Flächen** | `--bg #090d14` · `--bg-elev rgba(17,28,48,.66)` · `--bg-panel` |
| **Marke** | `--navy #0a2342` · `--accent #00aaff` · `--accent-glow` |
| **Semantik** | `--success #22c55e` · `--warn #f59e0b` · `--danger #ef4444` |
| **Text** | `--text #e8eef6` · `--text-sub #93a3b8` · `--text-faint` |
| **Form** | `--radius-lg 18px` · `--radius 13px` · `--radius-pill` |
| **Raster** | `--space-1 … --space-6` (4 – 32 px) |
| **Tiefe** | `--shadow-sm` · `--shadow` · `--shadow-lg` · `--ring` |

Die Chart-Farben in `lib/plot.js` (`CHART`, `SERIES_COLORS`) spiegeln dieselbe Palette —
Grenzwertlinien nutzen `--danger` für Max und `--warn` für Min, konsistent zu den Badges
in den Panel-Headern. Typografie durchgängig **Inter** (Google Fonts, per `@import`).

---

## 16. Verzeichnisstruktur

```
OHB_Project/
├── docker-compose.yml           # Postgres + Mosquitto
├── start.ps1                    # Ein-Klick-Start aller 5 Prozesse
├── README.md                    # Setup-Anleitung (teilweise veraltet, s. §18)
│
├── db-init/                     # läuft NUR bei leerem pgdata-Volume
│   ├── 001_schema.sql           # Tabellen, Hypertable, Indizes, Trigger  ← Referenz
│   └── 002_seed.sql             # Reinräume
│
├── mosquitto/
│   └── mosquitto.conf           # Listener 1883 (MQTT) + 9001 (WebSocket)
│
├── MQTT_Publish_Test/
│   └── mqtt_simulator.py        # 5 Sensoren, Sinus + Rauschen, alle 2 s
│
├── node-backend/
│   ├── .env                     # Zugangsdaten (nicht im Repo)
│   └── src/
│       ├── server.js            # Express-Bootstrap, Routen-Mount, SSE
│       ├── db.js                # pg.Pool + ensureSchema()
│       ├── mqttBridge.js        # MQTT → SQL Ingest
│       ├── alertListener.js     # LISTEN/NOTIFY + SSE-Hub + ntfy
│       ├── seed.js              # Reinräume nachträglich anlegen
│       ├── migrate.js           # Runner für migrations/*.sql
│       ├── test.js              # MQTT-Sniffer (Debug-Werkzeug)
│       ├── ohb-logo.png         # Logo für PDF-Kopf
│       ├── migrations/
│       │   └── 001_threshold_violations.sql   # VERALTET, s. §18
│       └── routes/              # ein Router je Ressource
│           ├── cleanrooms.js  assignments.js  sensors.js
│           ├── thresholds.js  sensordata.js   violations.js
│           └── report.js
│
└── ohb-dashboard/
    ├── vite.config.js           # React-Plugin + manualChunks
    └── src/
        ├── main.jsx  App.jsx  api.js  sensorLabel.js  index.css
        ├── lib/plot.js          # geteilte Plotly-Factory + Theme + yRange
        ├── store/MqttContext.jsx
        ├── hooks/               # useMqtt · useDashboardLayout · useSensorPoller
        └── components/          # je Komponente .jsx + .css
```

---

## 17. Betrieb & Konfiguration

### Start / Stopp

```powershell
.\start.ps1                  # alles starten (Docker + 4 Prozessfenster)

docker compose up -d         # nur Infrastruktur
docker compose down          # stoppen, Daten bleiben erhalten
docker compose down -v       # stoppen UND alle Daten löschen
docker compose ps            # Health-Status prüfen
```

### Umgebungsvariablen (`node-backend/.env`)

| Variable | Default | Bedeutung |
|---|---|---|
| `POSTGRES_HOST` | `localhost` | bei IPv6-Problemen auf `127.0.0.1` setzen |
| `POSTGRES_PORT` | `5432` | |
| `POSTGRES_DB` | `ohb_sensordata` | |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` | `postgres` / — | muss zu `docker-compose.yml` passen |
| `MQTT_BROKER_URL` | `mqtt://localhost:1883` | Broker der Bridge |
| `PORT` | `3001` | Express-Port |
| `NTFY_TOPIC` | `ohb-cleanroom-alerts` | ntfy-Topic für Push |
| `NTFY_SERVER` | `https://ntfy.sh` | ggf. eigene ntfy-Instanz |

### Datenbank-Initialisierung

```mermaid
flowchart LR
    A["docker compose up -d"] --> B{"Volume pgdata<br/>leer?"}
    B -->|"ja"| C["db-init/*.sql<br/>werden ausgeführt"]
    B -->|"nein"| D["übersprungen"]
    C --> E["ensureSchema()<br/>beim Start von<br/>server.js + mqttBridge.js"]
    D --> E
    E --> F["ADD COLUMN IF NOT EXISTS<br/>event_driven"]

    classDef a fill:#14532d,stroke:#22c55e,color:#e6f9ec
    classDef b fill:#713f12,stroke:#f59e0b,color:#fff7e6
    class A,C,E,F a
    class D b
```

> **Wichtig:** `db-init/` läuft ausschließlich beim **allerersten** Start eines leeren
> Volumes. Schema-Änderungen an bestehenden Installationen gehören deshalb in
> `ensureSchema()` in `db.js` — die Funktion ist idempotent und läuft bei jedem Prozessstart.

### Inbetriebnahme eines neuen Sensors

1. Sensor publiziert auf `sensors/<uuid>` → erscheint automatisch in `sensor_registry`
2. **Konfiguration → Sensoren** → umbenennen (optional) → **Reinraum zuordnen**
3. **Konfiguration → Schwellenwerte** → Sensor + Messgröße wählen → Min/Max setzen
4. Panel erscheint in der Übersicht; ab jetzt greift die Alarm-Engine

---

## 18. Bekannte Altlasten & offene Punkte

> **Stand 28.07.2026: Die Punkte 1 bis 6 sind mit Version 2.0.0 behoben**, Punkt 8
> ebenfalls (zentrale Fehlerbehandlung, REL-01). Offen bleibt Punkt 7 — die
> Zugangsbeschränkung; siehe AUD-01 in [Engineering-Standards.md](Engineering-Standards.md)
> und Abschnitt 6 des [Betriebshandbuchs](Betriebshandbuch.md).
> Die folgende Liste bleibt als Beleg des Ausgangszustands erhalten.

Beim Durchgang durch die Codebasis sind folgende Inkonsistenzen aufgefallen:

| # | Fund | Ort | Auswirkung |
|---|---|---|---|
| 1 | **ntfy-Push zeigt „undefined"**: `sendNtfy()` liest `data.metric` und `data.sensor_id`, der Trigger sendet aber `quantity` und `sensor_uuid` | `alertListener.js:47-50` | Push-Titel und Sensorzeile bleiben leer; SSE und UI sind korrekt |
| 2 | **Migration ist veraltet**: `001_threshold_violations.sql` referenziert die alte Struktur (`sensors.sensor_id`, `metric`) | `node-backend/src/migrations/` | `node src/migrate.js` würde gegen das aktuelle Schema fehlschlagen. Referenz ist `db-init/001_schema.sql` |
| 3 | **README beschreibt altes Topic-Schema** (`reinraum1/lps22/#`) und einen Seed, der Assignments anlegt | `README.md` | Anleitung führt in die Irre; tatsächlich gilt `sensors/#` und Seed legt nur Räume an |
| 4 | **Toter Code im Simulator**: `build_payload()` referenziert undefiniertes `GATEWAY_ID` und `sensor["name"]` | `mqtt_simulator.py:125` | Funktion wird von `main()` nicht aufgerufen, Simulator läuft; Aufruf würde `NameError` werfen |
| 5 | **`useSensorPoller` nirgends importiert** | `hooks/useSensorPoller.js` | funktionsfähig, aber ungenutzt — brauchbar für einen MQTT-freien Modus |
| 6 | **Bridge schreibt ohne Batching**: ein `INSERT` je Messgröße, kein `COPY`, keine Transaktion | `mqttBridge.js:90-98` | bei aktueller Last unkritisch; bei vielen Sensoren der erste Skalierungspunkt |
| 7 | **Kein Authentifizierungs-Layer**: CORS offen, MQTT `allow_anonymous true`, keine API-Keys | `server.js`, `mosquitto.conf` | für den geschlossenen Laborbetrieb ok, für Produktivbetrieb zu schließen |
| 8 | **Fehlerbehandlung in async-Routen** teils ohne `try/catch` (z. B. `cleanrooms` POST, `sensordata`) | diverse Routen | unbehandelte Rejections in Express 4 führen zu hängenden Requests statt `500` |

### Naheliegende Ausbaustufen

- **TimescaleDB ausreizen:** Continuous Aggregates für Stunden-/Tagesmittel, Retention-Policy,
  Kompression älterer Chunks — die Hypertable liegt bereits vor, die Features sind ungenutzt.
- **Bridge-Robustheit:** Batch-Insert plus Pufferung bei DB-Ausfall statt Nachrichtenverlust.
- **Reverse Proxy:** Nginx vor Vite-Build, Backend und Mosquitto-WS → ein Port, TLS, Auth.
- **Alarm-Historie im Frontend** aus `/violations/summary` visualisieren (bislang nur API).

---

*Erstellt aus der Analyse der vollständigen Codebasis · `docs/Projektübersicht.md`*
