-- =============================================================
-- Ablage für verworfene MQTT-Nachrichten ("Dead Letter").
--
-- Der Ingest unterscheidet zwei Fehlerarten:
--   vorübergehend (Datenbank weg)  -> kein Ack, der Broker stellt erneut zu
--   dauerhaft (Payload ungültig)   -> Ack, sonst entstünde eine Endlosschleife
--
-- Dauerhaft fehlerhafte Nachrichten dürfen aber nicht spurlos verschwinden: In
-- einem Auditsystem muss nachweisbar sein, was verworfen wurde und warum.
-- =============================================================

-- Up Migration

CREATE TABLE IF NOT EXISTS ingest_rejects (
    id          BIGSERIAL   PRIMARY KEY,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    topic       TEXT        NOT NULL,
    reason      TEXT        NOT NULL,
    payload     TEXT        NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ingest_rejects_time ON ingest_rejects (received_at DESC);

-- Down Migration

DROP TABLE IF EXISTS ingest_rejects;
