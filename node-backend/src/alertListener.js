/**
 * alertListener.js
 * ----------------
 * Lauscht per LISTEN/NOTIFY auf PostgreSQL-Channel "threshold_alert".
 * Wird vom Trigger check_threshold_violation() benachrichtigt,
 * sobald ein neues Violation-Event erstellt wird.
 *
 * Benachrichtigungen:
 *   - ntfy.sh (Push aufs Handy)  ✓
 *   - Telegram Bot               (vorbereitet)
 *   - Email (nodemailer)          (vorbereitet)
 */

const { Client } = require('pg');

const CHANNEL = 'threshold_alert';
const NTFY_TOPIC  = process.env.NTFY_TOPIC  || 'ohb-cleanroom-alerts';
const NTFY_SERVER = process.env.NTFY_SERVER || 'https://ntfy.sh';

/* ── SSE-Clients verwalten ───────────────────────── */
const sseClients = new Set();

function addSSEClient(res) {
  sseClients.add(res);
  res.on('close', () => sseClients.delete(res));
}

function broadcastSSE(data) {
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    client.write(payload);
  }
}

/** Label-Map fuer lesbare Log-Ausgabe */
const VIOLATION_LABELS = {
  above_max: 'UEBER MAXIMUM',
  below_min: 'UNTER MINIMUM',
};

/**
 * Push-Notification via ntfy.sh senden.
 * Handy-App "ntfy" installieren → Topic abonnieren → fertig.
 */
async function sendNtfy(data, label, limit) {
  const url = `${NTFY_SERVER}/${NTFY_TOPIC}`;
  const title = `${data.metric} - ${label}`;
  const body  = [
    `Sensor: ${data.sensor_id}`,
    `Wert: ${data.value} (Grenzwert: ${limit})`,
    `Raum-ID: ${data.cleanroom_id ?? 'unbekannt'}`,
    `Zeit: ${new Date(data.time).toLocaleString('de-DE')}`,
  ].join('\n');

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Title':    title,
        'Priority': '4',
        'Tags':     'warning,rotating_light',
      },
      body,
    });
    if (res.ok) {
      console.log(`[ALERT] ntfy.sh Push gesendet → ${NTFY_TOPIC}`);
    } else {
      console.error(`[ALERT] ntfy.sh Fehler: ${res.status} ${res.statusText}`);
    }
  } catch (err) {
    console.error('[ALERT] ntfy.sh nicht erreichbar:', err.message);
  }
}

/**
 * Startet den LISTEN-Client.
 * Nutzt eine eigene pg.Client-Verbindung (nicht den Pool),
 * weil LISTEN eine persistente Verbindung braucht.
 */
async function startAlertListener() {
  const client = new Client({
    host:     process.env.POSTGRES_HOST || 'localhost',
    port:     parseInt(process.env.POSTGRES_PORT || '5432'),
    database: process.env.POSTGRES_DB   || 'ohb_sensordata',
    user:     process.env.POSTGRES_USER || 'postgres',
    password: process.env.POSTGRES_PASSWORD || '',
  });

  await client.connect();
  await client.query(`LISTEN ${CHANNEL}`);
  console.log(`[ALERT] Lausche auf PostgreSQL-Channel "${CHANNEL}"`);

  client.on('notification', (msg) => {
    if (msg.channel !== CHANNEL) return;

    try {
      const data = JSON.parse(msg.payload);
      const label = VIOLATION_LABELS[data.violation_type] || data.violation_type;
      const limit = data.violation_type === 'above_max'
        ? data.threshold_max
        : data.threshold_min;

      console.log(
        `[ALERT] ⚠ SCHWELLENWERT-VERLETZUNG ⚠\n` +
        `        Sensor:   ${data.sensor_uuid}\n` +
        `        Quantity: ${data.quantity}\n` +
        `        Typ:      ${label}\n` +
        `        Wert:     ${data.value}  (Grenzwert: ${limit})\n` +
        `        Raum-ID:  ${data.cleanroom_id ?? 'unbekannt'}\n` +
        `        Zeit:     ${data.time}`
      );

      // Push-Notification via ntfy.sh
      sendNtfy(data, label, limit);

      // Live-Alert an alle verbundenen Frontend-Clients (SSE)
      broadcastSSE(data);

    } catch (err) {
      console.error('[ALERT] Fehler beim Parsen der Notification:', err.message);
    }
  });

  // Reconnect bei Verbindungsverlust
  client.on('error', (err) => {
    console.error('[ALERT] Verbindungsfehler:', err.message);
    console.log('[ALERT] Versuche Reconnect in 5 Sekunden...');
    setTimeout(() => startAlertListener(), 5000);
  });

  client.on('end', () => {
    console.warn('[ALERT] Verbindung geschlossen. Reconnect in 5 Sekunden...');
    setTimeout(() => startAlertListener(), 5000);
  });
}

module.exports = { startAlertListener, addSSEClient };
