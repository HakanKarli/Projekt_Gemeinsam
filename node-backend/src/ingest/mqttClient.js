/**
 * MQTT-Verbindung des Ingest-Workers.
 *
 * Drei Einstellungen entscheiden über Verlustfreiheit — alle drei fehlten zuvor:
 *
 *   clientId (fest)  Ohne stabile ID findet der Broker die Session beim Reconnect
 *                    nicht wieder; die gepufferten Nachrichten wären verloren.
 *   clean: false     Der Broker hält unbestätigte Nachrichten für uns vor, solange
 *                    wir weg sind. Das ist der eigentliche Puffer des Systems.
 *   qos: 1           "Mindestens einmal" — die Bestätigung steuern wir selbst.
 *
 * Die Bestätigung (PUBACK) sendet mqtt.js erst, wenn der übergebene Callback
 * aufgerufen wird. Genau das nutzt der Ingest: Der Callback läuft NACH dem Commit.
 */

const mqtt = require('mqtt');
const config = require('../config');
const logger = require('../lib/logger');

/**
 * @param {object} options
 * @param {(packet: { topic: string, payload: Buffer }, done: () => void) => void} options.onMessage
 * @returns {{ client: import('mqtt').MqttClient, isConnected: () => boolean, msSinceConnected: () => number, end: () => Promise<void> }}
 */
function createIngestClient({ onMessage }) {
  let lastConnectedAt = Date.now();

  const client = mqtt.connect(config.mqtt.brokerUrl, {
    clientId: config.mqtt.clientId,
    clean: false,
    // Subscriptions leben in der Session weiter; blindes Neu-Abonnieren würde die
    // Wiederaufnahme unterlaufen.
    resubscribe: false,
    reconnectPeriod: 2_000,
    connectTimeout: 10_000,
    keepalive: 30,
    // MQTT 3.1.1: persistente Sessions ohne Ablauffrist-Aushandlung.
    protocolVersion: 4,
  });

  client.on('connect', (connack) => {
    lastConnectedAt = Date.now();

    if (connack.sessionPresent) {
      logger.info(
        { broker: config.mqtt.brokerUrl, clientId: config.mqtt.clientId },
        'Verbunden — bestehende Session wiederaufgenommen, unbestätigte Nachrichten folgen',
      );
      return;
    }

    logger.info({ broker: config.mqtt.brokerUrl }, 'Verbunden — neue Session, abonniere');
    client.subscribe(config.mqtt.topic, { qos: 1 }, (err, granted) => {
      if (err) {
        logger.error({ err, topic: config.mqtt.topic }, 'Abonnement fehlgeschlagen');
        return;
      }
      logger.info({ granted: granted?.map((g) => `${g.topic}@qos${g.qos}`) }, 'Abonnement aktiv');
    });
  });

  client.on('reconnect', () => logger.warn('Verbindung wird wiederhergestellt'));
  client.on('close', () => logger.warn('Verbindung geschlossen'));
  client.on('error', (err) => logger.error({ err }, 'MQTT-Fehler'));

  // Kernstück: Übernahme der Nachrichtenverarbeitung inklusive Bestätigungszeitpunkt.
  client.handleMessage = (packet, done) => {
    onMessage(packet, done);
  };

  return {
    client,
    isConnected: () => client.connected,
    msSinceConnected: () => Date.now() - lastConnectedAt,
    end: () =>
      new Promise((resolve) => {
        // false = laufende Bestätigungen noch abschließen lassen.
        client.end(false, {}, () => resolve());
      }),
  };
}

module.exports = { createIngestClient };
