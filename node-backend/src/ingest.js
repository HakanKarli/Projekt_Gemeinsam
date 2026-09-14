/**
 * Ingest-Worker: MQTT -> PostgreSQL.
 *
 * Der Kern steht in `handleMessage`: Die Bestätigung an den Broker (`done()`) fällt
 * ERST nach dem erfolgreichen Commit. Daraus ergibt sich die Verlustfreiheit der
 * gesamten Kette:
 *
 *   Datenbank nicht erreichbar -> Wiederholungen mit Backoff -> weiterhin erfolglos
 *   -> keine Bestätigung, Prozess beendet sich -> Neustart -> Session wird
 *   wiederaufgenommen -> Broker stellt erneut zu -> Idempotenz verhindert Duplikate
 *
 * Der Absturz ist hier der Reparaturmechanismus, nicht der Fehlerfall.
 */

const config = require('./config');
const logger = require('./lib/logger');
const db = require('./lib/db');
const { createIngestClient } = require('./ingest/mqttClient');
const { startHealthServer } = require('./ingest/healthServer');
const { SensorMessageSchema } = require('./ingest/messageSchema');
const ingestService = require('./ingest/ingestService');
const { installCrashHandlers, startWatchdog, fatalExit } = require('./lib/watchdog');
const { installShutdownHandlers, onShutdown, isShuttingDown } = require('./lib/shutdown');

/** Ab hier gilt eine Störung als nicht mehr durch Warten behebbar. */
const LIMITS = {
  mqttDisconnectedMs: 120_000,
  /** Ohne Nachricht in diesem Zeitraum gilt der Datenstrom als unterbrochen. */
  noMessageMs: 15 * 60_000,
};

/**
 * Wiederholungen bei Datenbankfehlern: 0,25 s, 0,5 s, 1 s, 2 s, 4 s — zusammen
 * rund 8 Sekunden. Das überbrückt kurze Aussetzer (Neustart einer Verbindung,
 * kurzzeitige Überlast), ohne den Prozess gleich zu beenden.
 */
const RETRY_DELAYS_MS = [250, 500, 1_000, 2_000, 4_000];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const HEARTBEAT_MS = 30_000;

const stats = {
  received: 0,
  persisted: 0,
  duplicates: 0,
  rejected: 0,
  consecutiveDbFailures: 0,
  lastMessageAt: Date.now(),
};

/**
 * @param {{ topic: string, payload: Buffer }} packet
 * @param {() => void} done  löst die MQTT-Bestätigung aus
 */
async function handleMessage(packet, done) {
  if (isShuttingDown()) return; // nichts Neues mehr annehmen; Broker stellt erneut zu

  stats.received += 1;
  stats.lastMessageAt = Date.now();

  const raw = packet.payload.toString();

  // ── Dauerhafter Fehler: bestätigen, sonst entsteht eine Endlosschleife ──
  let message;
  try {
    message = SensorMessageSchema.parse(JSON.parse(raw));
  } catch (err) {
    stats.rejected += 1;
    logger.warn({ err, topic: packet.topic }, 'Ungültige Nachricht — wird abgelegt und bestätigt');
    await ingestService.recordReject({
      topic: packet.topic,
      reason: err instanceof SyntaxError ? 'kein gültiges JSON' : err.message,
      payload: raw,
    });
    done();
    return;
  }

  // ── Vorübergehender Fehler: NICHT bestätigen ──
  //
  // WICHTIG: mqtt.js liefert keine weitere QoS-1-Nachricht aus, solange die
  // vorherige nicht bestätigt ist. Eine ausbleibende Bestätigung hält also die
  // gesamte Verarbeitung an — ein Zähler über mehrere Nachrichten könnte gar nicht
  // erst auflaufen. Deshalb: erst wiederholen, dann sofort beenden.
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      const { inserted, duplicates } = await ingestService.persist(message);

      stats.persisted += inserted;
      stats.duplicates += duplicates;
      stats.consecutiveDbFailures = 0;

      if (duplicates > 0) {
        logger.debug({ sensor: message.id, duplicates }, 'Wiederzustellung erkannt und verworfen');
      }
      if (stats.received % 100 === 0) {
        logger.info(
          { received: stats.received, persisted: stats.persisted, duplicates: stats.duplicates },
          'Ingest-Zwischenstand',
        );
      }

      done(); // ← ab hier darf der Broker die Nachricht vergessen
      return;
    } catch (err) {
      stats.consecutiveDbFailures += 1;

      if (attempt < RETRY_DELAYS_MS.length) {
        logger.warn(
          { err: err.message, sensor: message.id, attempt: attempt + 1 },
          'Persistenz fehlgeschlagen — neuer Versuch',
        );
        await sleep(RETRY_DELAYS_MS[attempt]);
        continue;
      }

      // Endgültig: Ohne Bestätigung hält der Broker die Nachricht. Der Neustart
      // stellt die Session wieder her, danach wird sie erneut zugestellt und die
      // Idempotenz verhindert Duplikate.
      logger.error(
        { err: err.message, sensor: message.id },
        'Persistenz dauerhaft fehlgeschlagen — keine Bestätigung, Neustart für Wiederzustellung',
      );
      fatalExit('Datenbank über alle Wiederholungen nicht erreichbar', { logger });
      return;
    }
  }
}

/** Meldet Lebenszeichen an Uptime Kuma. Fehlt der Push, schlägt dort ein Monitor an. */
function startHeartbeat() {
  if (!config.alerts.kumaPushUrl) {
    logger.debug('Kein KUMA_PUSH_URL gesetzt — Heartbeat deaktiviert');
    return null;
  }

  const timer = setInterval(() => {
    const url = `${config.alerts.kumaPushUrl}?status=up&msg=ok&ping=${stats.received}`;
    fetch(url, { signal: AbortSignal.timeout(5_000) }).catch((err) =>
      logger.debug({ err }, 'Heartbeat konnte nicht gesendet werden'),
    );
  }, HEARTBEAT_MS);

  timer.unref();
  return timer;
}

async function main() {
  installCrashHandlers({ logger });
  installShutdownHandlers({ logger });

  logger.info(
    { broker: config.mqtt.brokerUrl, topic: config.mqtt.topic, clientId: config.mqtt.clientId },
    'Ingest startet',
  );

  const mqttClient = createIngestClient({
    onMessage: (packet, done) => {
      // Fehler dürfen niemals aus dem Callback herausfallen — sonst stünde die
      // Verarbeitung ohne Logeintrag still.
      handleMessage(packet, done).catch((err) =>
        logger.error({ err }, 'Unerwarteter Fehler in der Nachrichtenverarbeitung'),
      );
    },
  });

  const healthServer = startHealthServer({
    port: config.ingest.healthPort,
    status: () => {
      const connected = mqttClient.isConnected();
      const msSinceMessage = Date.now() - stats.lastMessageAt;
      return {
        healthy: connected && stats.consecutiveDbFailures === 0,
        details: {
          mqtt_connected: connected,
          seconds_since_last_message: Math.round(msSinceMessage / 1000),
          consecutive_db_failures: stats.consecutiveDbFailures,
          received: stats.received,
          persisted: stats.persisted,
          duplicates: stats.duplicates,
          rejected: stats.rejected,
        },
      };
    },
  });

  const heartbeat = startHeartbeat();

  // Nur Störungen, die ein Neustart tatsächlich behebt.
  startWatchdog({
    logger,
    checks: [
      () =>
        !mqttClient.isConnected() && mqttClient.msSinceConnected() > LIMITS.mqttDisconnectedMs
          ? `MQTT seit ${Math.round(mqttClient.msSinceConnected() / 1000)} s getrennt`
          : null,
      () =>
        Date.now() - stats.lastMessageAt > LIMITS.noMessageMs && mqttClient.isConnected()
          ? `seit ${Math.round((Date.now() - stats.lastMessageAt) / 60_000)} min keine Nachricht trotz Verbindung`
          : null,
    ],
  });

  onShutdown('heartbeat', () => heartbeat && clearInterval(heartbeat));
  onShutdown('health-server', () => new Promise((resolve) => healthServer.close(() => resolve())));
  onShutdown('mqtt', () => mqttClient.end());
  onShutdown('database', () => db.close());
}

main().catch((err) => {
  logger.fatal({ err }, 'Ingest konnte nicht starten');
  process.exit(1);
});
