const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const express = require('express');
const cors = require('cors');
const pool = require('./db');
const { startAlertListener, addSSEClient } = require('./alertListener');

const app = express();
const PORT = process.env.PORT || 3001;

// -- Middleware --
app.use(cors());
app.use(express.json());

// -- SSE-Endpoint fuer Live-Alerts --
app.get('/api/alerts/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type':  'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection':    'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });
  res.write(':ok\n\n');
  addSSEClient(res);
});

// -- Routes --
app.use('/api/cleanrooms',  require('./routes/cleanrooms'));
app.use('/api/sensors',     require('./routes/sensors'));
app.use('/api/assignments', require('./routes/assignments'));
app.use('/api/thresholds',  require('./routes/thresholds'));
app.use('/api/sensordata',  require('./routes/sensordata'));
app.use('/api/violations',  require('./routes/violations'));
app.use('/api/report',      require('./routes/report'));

// -- Health-Check --
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// -- Start --
// Schema absichern (z.B. event_driven-Spalte), bevor Requests bedient werden.
pool.ensureSchema()
  .catch((err) => console.error('[SERVER] Schema-Setup fehlgeschlagen:', err.message))
  .finally(() => {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`[SERVER] Laeuft auf http://0.0.0.0:${PORT} (alle Netzwerk-Interfaces)`);
      console.log(`[SERVER] API-Docs: /api/health, /api/cleanrooms, /api/sensors, ...`);

      // LISTEN/NOTIFY fuer Schwellenwert-Alarme starten
      startAlertListener().catch((err) => {
        console.error('[SERVER] Alert-Listener konnte nicht gestartet werden:', err.message);
      });
    });
  });
