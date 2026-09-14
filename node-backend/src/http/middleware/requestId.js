/**
 * Vergibt jeder Anfrage eine Korrelations-ID.
 *
 * Ohne sie lässt sich eine Fehlermeldung aus dem Frontend nicht der zugehörigen
 * Logzeile zuordnen. Eine bereits vorhandene ID (z.B. von nginx) wird übernommen.
 */

const { randomUUID } = require('node:crypto');

const HEADER = 'x-request-id';

function requestId(req, res, next) {
  const incoming = req.get(HEADER);
  req.id = incoming && incoming.length <= 200 ? incoming : randomUUID();
  res.setHeader(HEADER, req.id);
  next();
}

module.exports = { requestId, REQUEST_ID_HEADER: HEADER };
