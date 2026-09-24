# Grafana → Gruppe 1: Verbindungsdaten

Zweck: Damit Grafana gegen die Postgres-Datenbank von Gruppe 1 laufen kann,
fehlen aktuell vier Angaben. Ohne sie lässt sich keine Datasource anlegen —
Grafana braucht Netzwerk, Host, Zugangsdaten und muss die gelieferten
`quantity`-Werte auch tatsächlich sehen.

**Status:** Alle vier Punkte sind noch offen — die Werte müssen von Gruppe 1
kommen bzw. bei ihnen live geprüft werden. Dieses Dokument ist die Anfrage an
sie *und* die Vorlage, in die ihre Antworten eingetragen werden.

## Die vier offenen Punkte

### 1. Docker-Netzwerkname ihres Stacks

Grafana muss im selben Docker-Netzwerk hängen wie ihre Postgres, sonst löst
sich der Hostname nicht auf.

Von Gruppe 1 erfragen:

```bash
docker network ls
```

— oder direkt aus ihrer `docker-compose.yml` unter dem Top-Level-Schlüssel
`networks:` ablesen.

**Ergebnis (eintragen, sobald bekannt):** `_____________________`

→ kommt als `GRUPPE1_NETWORK` in unsere `.env`.

### 2. Container-Name ihrer Postgres

Das ist der DB-Host aus Sicht von Grafana (Docker-DNS löst Container-Namen im
gemeinsamen Netzwerk auf — nicht `localhost`, nicht die IP).

Von Gruppe 1 erfragen bzw. bei ihnen ausführen:

```bash
docker ps --format "table {{.Names}}\t{{.Image}}"
```

Zu bestätigen: Heißt der Postgres-Container wirklich `postgres`? Falls nicht,
den tatsächlichen Namen eintragen.

**Ergebnis (eintragen, sobald bekannt):** `_____________________`

→ kommt als `GRUPPE1_POSTGRES_HOST` in unsere `.env`.

### 3. DB-Name + Zugangsdaten

Laut ihrer Compose-Datei: DB-Name `ohb_sensordata`.

**Wichtig:** Nicht den Postgres-Superuser aus ihrer `.env` verwenden. Ein
Superuser-Zugang darf nicht in einem veröffentlichten Repo dokumentiert
werden — stattdessen einen Read-Only-User anlegen lassen.

Query für Gruppe 1, bei ihnen als Superuser gegen `ohb_sensordata`
auszuführen:

```sql
CREATE ROLE grafana_ro WITH LOGIN PASSWORD '<starkes_passwort_hier>';
GRANT CONNECT ON DATABASE ohb_sensordata TO grafana_ro;
GRANT USAGE ON SCHEMA public TO grafana_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO grafana_ro;
-- Falls nach dem Anlegen des Users noch neue Tabellen dazukommen:
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO grafana_ro;
```

Diese Query soll dauerhaft in ihrer `db-bereitstellung.md` liegen — in diesem
Repo existiert eine solche Datei noch nicht; falls gewünscht, legen wir sie
hier parallel unter `docs/db-bereitstellung.md` an, sobald der User bei ihnen
tatsächlich existiert.

**Ergebnis (eintragen, sobald bekannt):**

| Feld | Wert |
|---|---|
| DB-Name | `ohb_sensordata` |
| User | `grafana_ro` (oder ihr tatsächlicher Name) |
| Passwort | _____________________ |

→ kommen als `GRUPPE1_POSTGRES_DB`, `GRUPPE1_POSTGRES_USER`,
`GRUPPE1_POSTGRES_PASSWORD` in unsere `.env`.

### 4. Live-Bestätigung der Messgrößen

Einmal gegen ihre echte DB laufen lassen, zum Abgleich mit
[`schema-mapping.md`](./schema-mapping.md) (siehe auch
[`quantity-verification.md`](./quantity-verification.md) für den Hintergrund
dieser Prüfung):

```sql
SELECT DISTINCT quantity
FROM sensor_data
ORDER BY quantity;
```

**Ergebnis (eintragen, sobald bekannt):**

```text
_____________________
```

Stimmen die Werte mit der Tabelle in `schema-mapping.md` überein, läuft
Grafana ohne weitere Anpassung. Bei Abweichungen: siehe
`quantity-verification.md`, Abschnitt 2 (dort sind `pm25`/`pm2_5` und
`mps`/`wind_speed` bereits als bekannte Abweichungen dokumentiert).

## Eintrag in `.env`

Sobald alle vier Punkte beantwortet sind, folgende Variablen in die `.env`
übernehmen (Vorlage folgt unten in `.env.example`):

```dotenv
GRUPPE1_NETWORK=
GRUPPE1_POSTGRES_HOST=
GRUPPE1_POSTGRES_PORT=5432
GRUPPE1_POSTGRES_DB=ohb_sensordata
GRUPPE1_POSTGRES_USER=
GRUPPE1_POSTGRES_PASSWORD=
```

## Wie Grafana damit verbunden wird

Grafana ist aktuell nicht Teil von `docker-compose.yml` — bewusste
Entscheidung gegen einen dauerhaften Grafana-Container (siehe
[`Architektur.md`](./Architektur.md)). Für diese punktuelle Prüfung reicht ein temporärer
Container im Netzwerk von Gruppe 1:

```bash
docker run -d --name grafana-check \
  --network "$GRUPPE1_NETWORK" \
  -p 3000:3000 \
  grafana/grafana:latest
```

In Grafana als Postgres-Datasource:

| Feld | Wert |
|---|---|
| Host | `$GRUPPE1_POSTGRES_HOST:$GRUPPE1_POSTGRES_PORT` |
| Database | `$GRUPPE1_POSTGRES_DB` |
| User | `$GRUPPE1_POSTGRES_USER` |
| Password | `$GRUPPE1_POSTGRES_PASSWORD` |
| SSL Mode | `disable` (nur internes Docker-Netzwerk) |

Der Container-Name aus Punkt 2 ist der Host — **nicht** `localhost` und
**nicht** die IP, weil beide Container im selben Docker-Netzwerk über
Docker-DNS kommunizieren.
