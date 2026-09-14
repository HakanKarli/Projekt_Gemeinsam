#!/bin/sh
# =============================================================
# Legt die pgBackRest-Stanza an — einmalig beim ersten Start einer leeren
# Datenbank. Läuft als Benutzer `postgres`, damit die erzeugten Dateien dem
# Archiver gehören.
#
# Ohne diesen Schritt ist archive_mode aktiv, aber das Ziel existiert nicht:
# Jedes WAL-Segment scheitert mit Fehler 103, die Segmente sammeln sich an und
# füllen die Platte. Genau diesen Zustand meldet /api/health/deep über
# `wal_archive_failing` — er soll aber gar nicht erst entstehen.
#
# stanza-create ist wiederholbar; ein erneuter Aufruf ändert nichts.
# =============================================================

set -e

echo "[pgbackrest] Lege Stanza 'ohb' an"
pgbackrest --stanza=ohb --log-level-console=info stanza-create || {
    echo "[pgbackrest] WARNUNG: stanza-create fehlgeschlagen."
    echo "[pgbackrest] Nach dem Start nachholen:"
    echo "[pgbackrest]   docker compose exec -u postgres postgres pgbackrest --stanza=ohb stanza-create"
}
