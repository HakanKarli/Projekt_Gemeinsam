/**
 * Verteilerstelle für Live-Alarme an die verbundenen Browser.
 *
 * Der Heartbeat ist kein Beiwerk: Ohne regelmäßigen Verkehr schließen Proxys eine
 * SSE-Verbindung nach ihrem Leerlauf-Timeout, und der Browser bemerkt das erst beim
 * nächsten ausbleibenden Alarm — also genau dann, wenn es darauf ankommt.
 */

const logger = require('../lib/logger');

const HEARTBEAT_MS = 20_000;

/** @type {Set<import('express').Response>} */
const clients = new Set();

/** @type {NodeJS.Timeout | null} */
let heartbeatTimer = null;

/**
 * @param {import('express').Response} res  bereits mit SSE-Headern geöffnet
 */
function addSSEClient(res) {
  clients.add(res);
  res.write(':ok\n\n');
  logger.debug({ clients: clients.size }, 'SSE-Client verbunden');

  const remove = () => {
    if (clients.delete(res)) {
      logger.debug({ clients: clients.size }, 'SSE-Client getrennt');
    }
  };
  res.on('close', remove);
  res.on('error', remove);
}

/**
 * @param {unknown} data  wird als JSON übertragen
 */
function broadcast(data) {
  if (clients.size === 0) return;
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    try {
      client.write(payload);
    } catch (err) {
      logger.warn({ err }, 'Schreiben an SSE-Client fehlgeschlagen — Verbindung wird verworfen');
      clients.delete(client);
    }
  }
}

function startHeartbeat() {
  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(() => {
    for (const client of clients) {
      // Kommentarzeile: hält die Verbindung offen, ohne ein Ereignis auszulösen.
      client.write(': ping\n\n');
    }
  }, HEARTBEAT_MS);
  heartbeatTimer.unref();
}

function stopHeartbeat() {
  if (!heartbeatTimer) return;
  clearInterval(heartbeatTimer);
  heartbeatTimer = null;
}

/** Beim geordneten Beenden: Verbindungen aktiv schließen, sonst hängt server.close(). */
function closeAll() {
  for (const client of clients) {
    try {
      client.end();
    } catch {
      /* Verbindung war bereits tot */
    }
  }
  clients.clear();
  stopHeartbeat();
}

const clientCount = () => clients.size;

module.exports = { addSSEClient, broadcast, startHeartbeat, stopHeartbeat, closeAll, clientCount };
