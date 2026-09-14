const { Router } = require('express');
const { validate } = require('../middleware/validate');
const { registry, errorResponses } = require('../openapi');
const S = require('../../domain/schemas');
const reportService = require('../../services/reportService');
const pdfRenderer = require('../../services/report/pdfRenderer');

const router = Router();

registry.registerPath({
  method: 'post',
  path: '/api/report',
  tags: ['Report'],
  summary: 'Audit-Report als PDF erzeugen',
  description: [
    'Berücksichtigt alle Sensoren, die im gewählten Zeitraum diesem Reinraum zugeordnet',
    'WAREN — nicht die heute zugeordneten. Schwellenwert-Änderungen werden mit ihrem',
    'jeweiligen Gültigkeitszeitraum ausgewiesen, und jeder Messwert wird gegen den',
    'Grenzwert bewertet, der zu seinem Zeitpunkt galt.',
  ].join('\n'),
  request: { body: { content: { 'application/json': { schema: S.ReportBody } } } },
  responses: {
    200: {
      description: 'PDF-Dokument',
      content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } },
    },
    ...errorResponses(400, 404),
  },
});
router.post('/', validate({ body: S.ReportBody }), async (req, res) => {
  const report = await reportService.collect(req.valid.body);
  const pdf = await pdfRenderer.render(report);

  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="${pdfRenderer.fileName(report.room.name)}"`,
    'Content-Length': pdf.length,
  });
  res.send(pdf);
});

module.exports = router;
