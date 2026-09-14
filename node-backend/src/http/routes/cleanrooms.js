const { Router } = require('express');
const { validate } = require('../middleware/validate');
const { registry, z, jsonResponse, errorResponses } = require('../openapi');
const S = require('../../domain/schemas');
const service = require('../../services/cleanroomService');

const router = Router();
const TAGS = ['Reinräume'];

registry.registerPath({
  method: 'get',
  path: '/api/cleanrooms',
  tags: TAGS,
  summary: 'Alle Reinräume auflisten',
  responses: { 200: jsonResponse(z.array(S.Cleanroom), 'Liste der Reinräume') },
});
router.get('/', async (_req, res) => {
  res.json(await service.list());
});

registry.registerPath({
  method: 'post',
  path: '/api/cleanrooms',
  tags: TAGS,
  summary: 'Reinraum anlegen',
  request: { body: { content: { 'application/json': { schema: S.CreateCleanroomBody } } } },
  responses: {
    201: jsonResponse(S.Cleanroom, 'Angelegter Reinraum'),
    ...errorResponses(400, 409),
  },
});
router.post('/', validate({ body: S.CreateCleanroomBody }), async (req, res) => {
  res.status(201).json(await service.create(req.valid.body.name));
});

registry.registerPath({
  method: 'delete',
  path: '/api/cleanrooms/{id}',
  tags: TAGS,
  summary: 'Reinraum löschen',
  description:
    'Laufende Zuordnungen werden abgeschlossen, Verletzungen behalten ihre Historie ' +
    'und verlieren lediglich den Raumbezug.',
  request: { params: S.IdParam },
  responses: {
    200: jsonResponse(z.object({ deleted: z.boolean() }), 'Gelöscht'),
    ...errorResponses(400, 404),
  },
});
router.delete('/:id', validate({ params: S.IdParam }), async (req, res) => {
  res.json(await service.remove(req.valid.params.id));
});

module.exports = router;
