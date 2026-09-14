/**
 * Server-Sent Events für Live-Alarme.
 *
 * SSE statt WebSocket, weil die Richtung eindeutig ist (Server -> Browser) und
 * `EventSource` Auto-Reconnect ohne Zusatzcode mitbringt.
 */

const { Router } = require('express');
const { registry } = require('../openapi');
const { addSSEClient } = require('../../alerts/sseHub');

const router = Router();

registry.registerPath({
  method: 'get',
  path: '/api/alerts/stream',
  tags: ['Alarme'],
  summary: 'Live-Kanal für Alarme (Server-Sent Events)',
  description: [
    'Dauerhafte Verbindung im Format `text/event-stream`. Jede neu geöffnete',
    'Schwellenwert-Verletzung wird als JSON-Ereignis gesendet.',
    '',
    'Alle 20 Sekunden folgt eine Kommentarzeile (`: ping`) als Lebenszeichen — ohne sie',
    'schließen Proxys die Verbindung nach ihrem Leerlauf-Timeout.',
    '',
    'Die Nutzlast entspricht `Violation`, ergänzt um `value` (auslösender Messwert).',
  ].join('\n'),
  responses: {
    200: {
      description: 'Ereignisstrom',
      content: { 'text/event-stream': { schema: { type: 'string' } } },
    },
  },
});
router.get('/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Verhindert Zwischenpufferung durch nginx; ohne diesen Header kämen Alarme
    // erst an, wenn der Puffer voll ist.
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();
  addSSEClient(res);
});

module.exports = router;
