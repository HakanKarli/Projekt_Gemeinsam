# =============================================================
# TimescaleDB mit pgBackRest.
#
# pgBackRest muss IM Datenbank-Container liegen, weil PostgreSQL das
# archive_command dort ausführt. Ein Sidecar-Container könnte das nicht leisten.
#
# Warum pgBackRest und nicht pg_dump: Ein pg_restore von Hypertables erfordert
# zwingend die Klammer timescaledb_pre_restore() / timescaledb_post_restore().
# Wer das vergisst, erhält eine Datenbank mit zerstörten Hypertable-Metadaten und
# merkt es erst im Ernstfall. Physische Sicherungen berühren diese Metadaten nicht.
# =============================================================

FROM timescale/timescaledb:latest-pg17

RUN apk add --no-cache pgbackrest

COPY pgbackrest.conf /etc/pgbackrest/pgbackrest.conf

# Läuft einmalig beim ersten Start einer leeren Datenbank (als Benutzer postgres).
COPY initdb/ /docker-entrypoint-initdb.d/

# Stellt vor dem Start die Besitzrechte des Sicherungsverzeichnisses richtig —
# siehe ausführliche Begründung im Skript.
COPY entrypoint-wrapper.sh /usr/local/bin/entrypoint-wrapper.sh

RUN chmod +x /usr/local/bin/entrypoint-wrapper.sh /docker-entrypoint-initdb.d/*.sh \
    && mkdir -p /var/lib/pgbackrest /var/log/pgbackrest \
    && chown -R postgres:postgres /var/lib/pgbackrest /var/log/pgbackrest /etc/pgbackrest

ENTRYPOINT ["/usr/local/bin/entrypoint-wrapper.sh"]
CMD ["postgres"]
