const mqtt = require('mqtt');

const BROKER_URL = 'mqtt://192.168.188.57:1883';
const TOPIC      = '#'; // Wildcard: alle Topics empfangen

const client = mqtt.connect(BROKER_URL, {
  clientId: `ohb-test-${Math.random().toString(16).slice(2, 8)}`,
});

client.on('connect', () => {
  console.log(`Verbunden mit ${BROKER_URL}`);
  client.subscribe(TOPIC, (err) => {
    if (err) console.error('Subscribe fehlgeschlagen:', err.message);
    else     console.log(`Subscribed: ${TOPIC}\nWarte auf Nachrichten...\n`);
  });
});

client.on('message', (topic, payload) => {
  console.log(`[${new Date().toISOString()}] ${topic}`);
  try {
    console.log(JSON.stringify(JSON.parse(payload.toString()), null, 2));
  } catch {
    console.log(payload.toString());
  }
  console.log('---');
});

client.on('error',   (err) => console.error('Fehler:', err.message));
client.on('close',   ()    => console.log('Verbindung getrennt'));
