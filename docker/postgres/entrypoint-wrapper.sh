#!/bin/sh
# =============================================================
# Vorschaltung vor den Original-Einstiegspunkt des Postgres-Abbilds.
#
# Zweck: Besitzrechte des Sicherungsverzeichnisses richtigstellen.
#
# Hintergrund: /var/lib/pgbackrest ist ein benanntes Volume. Docker legt ein
# leeres Volume mit Besitzer root an und überdeckt damit den `chown` aus dem
# Dockerfile. PostgreSQLs Archiver läuft aber als Benutzer `postgres` und kann
# die Dateien dann nicht lesen — das archive_command scheitert bei JEDEM
# WAL-Segment, die Segmente stapeln sich, und irgendwann steht die Datenbank.
#
# Der Fehler ist besonders unangenehm, weil er still auftritt: Die Datenbank
# arbeitet normal weiter, nur die Sicherung läuft ins Leere.
# =============================================================

set -e

if [ "$(id -u)" = '0' ]; then
    for dir in /var/lib/pgbackrest /var/log/pgbackrest; do
        mkdir -p "$dir"
        chown -R postgres:postgres "$dir"
    done
fi

exec docker-entrypoint.sh "$@"
