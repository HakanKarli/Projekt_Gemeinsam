const { Router } = require('express');
const { validate } = require('../middleware/validate');
const { registry, z, jsonResponse, errorResponses } = require('../openapi');
const S = require('../../domain/schemas');
const service = require('../../services/panelService');

const router = Router();

registry.registerPath({
  method: 'get',
  path: '/api/panels',
  tags: ['Messdaten'],
  summary: 'Panel-Manifest für das Dashboard',
  description: [
    'Liefert alle darzustellenden Kanäle in EINER Anfrage — Sensor, Reinraum,',
    'Messgröße, Einheit und den aktuell gültigen Schwellenwert.',
    '',
    'Ersetzt das frühere Vorgehen, bei dem das Frontend die Sensorliste holte und',
    'danach je Sensor zwei weitere Anfragen stellte.',
    '',
    'Enthalten sind ausschließlich Kanäle von Sensoren, die aktuell einem Reinraum',
    'zugeordnet sind.',
  ].join('\n'),
  request: { query: S.PanelQuery },
  responses: {
    200: jsonResponse(z.array(S.Panel), 'Kanäle'),
    ...errorResponses(400),
  },
});
router.get('/', validate({ query: S.PanelQuery }), async (req, res) => {
  res.json(await service.list(req.valid.query));
});

module.exports = router;
