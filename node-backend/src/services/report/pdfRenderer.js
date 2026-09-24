/**
 * Darstellung des Audit-Reports als PDF.
 *
 * Reine Ausgabe: bekommt fertige Daten, kennt keine Datenbank. Dadurch lässt sich
 * die Datenauswahl (reportService) unabhängig testen — und die Formatierung ändern,
 * ohne die fachliche Logik zu berühren.
 */

const path = require('node:path');
const PDFDocument = require('pdfkit');
const logger = require('../../lib/logger');

const LOGO_PATH = path.resolve(__dirname, '..', '..', 'HHZ-Logo.png');
const TIMEZONE = 'Europe/Berlin';

/** Ab dieser Menge wird die Messwerttabelle gekürzt — sonst wächst der Report ins Unlesbare. */
const MAX_TABLE_ROWS = 50;

const COLORS = { ok: '#22c55e', violation: '#ef4444', muted: '#888888', line: '#cccccc', text: '#000000' };
const COLUMNS = [50, 200, 320];

/**
 * @param {Awaited<ReturnType<typeof import('../reportService').collect>>} report
 * @returns {Promise<Buffer>}
 */
function render(report) {
  const doc = new PDFDocument({
    size: 'A4',
    margin: 50,
    info: {
      Title: `Reinraum-Report ${report.room.name}`,
      Author: 'OHB Sensor Dashboard',
      Subject: `Zeitraum ${formatDate(report.period.from)} bis ${formatDate(report.period.to)}`,
    },
  });

  /** @type {Buffer[]} */
  const chunks = [];
  doc.on('data', (chunk) => chunks.push(chunk));
  const finished = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  const createdAt = new Date();
  renderCoverPage(doc, report, createdAt);

  for (const uuid of report.sensorUuids) {
    renderSensor(doc, report, uuid, createdAt);
  }

  renderFooter(doc, report, createdAt);
  doc.end();

  return finished;
}

function renderCoverPage(doc, report, createdAt) {
  try {
    const logoWidth = 160;
    const usableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    doc.image(LOGO_PATH, doc.page.margins.left + (usableWidth - logoWidth) / 2, doc.y, {
      width: logoWidth,
    });
    doc.moveDown(4);
  } catch (err) {
    logger.warn({ err, path: LOGO_PATH }, 'Logo für den Report nicht gefunden');
  }

  doc.fontSize(22).font('Helvetica-Bold').text('Reinraum-Report', { align: 'center' });
  doc.moveDown(0.5);
  doc.fontSize(14).font('Helvetica').text(report.room.name, { align: 'center' });
  doc.moveDown(0.3);
  doc.fontSize(10).text('OHB Sensor Dashboard — Audit-Report', { align: 'center' });
  doc.moveDown(1.5);

  doc.text(`Erstellt am: ${formatDate(createdAt)}`);
  doc.text(`Zeitraum: ${formatDate(report.period.from)} – ${formatDate(report.period.to)}`);
  doc.text(`Reinraum: ${report.room.name} (ID: ${report.room.id})`);
  doc.text(`Datenpunkte gesamt: ${report.totals.dataPoints}`);
  doc.text(
    `Schwellenwert-Verletzungen: ${report.totals.violationEvents} Ereignisse ` +
      `(Gesamtdauer: ${formatDuration(report.totals.violationSeconds)})`,
  );
  doc.moveDown(0.5);

  doc.fontSize(10).font('Helvetica-Bold').text('Sensor-Zuordnungen im Zeitraum:');
  doc.fontSize(8).font('Helvetica');
  for (const assignment of report.assignments) {
    const until = assignment.assigned_to ? formatDate(assignment.assigned_to) : formatDate(createdAt);
    doc.text(
      `  ${assignment.sensor_name} (${assignment.sensor_uuid})  —  ` +
        `${formatDate(assignment.assigned_from)} bis ${until}`,
    );
  }

  doc.moveDown(1);
  drawSeparator(doc);
  doc.moveDown(0.5);
}

function renderSensor(doc, report, uuid, createdAt) {
  const assignment = report.assignments.find((a) => a.sensor_uuid === uuid);
  const sensorName = assignment?.sensor_name ?? uuid;
  const quantities = Object.keys(report.measurements[uuid] ?? {}).sort();

  if (quantities.length === 0) {
    if (doc.y > 700) doc.addPage();
    doc.fontSize(13).font('Helvetica-Bold').text(sensorName);
    doc.fontSize(9).font('Helvetica').text('Keine Messdaten im gewählten Zeitraum.', { oblique: true });
    doc.moveDown(1);
    drawSeparator(doc);
    doc.moveDown(0.5);
    return;
  }

  for (const quantity of quantities) {
    renderChannel(doc, report, uuid, quantity, sensorName, createdAt);
  }
}

function renderChannel(doc, report, uuid, quantity, sensorName, createdAt) {
  const rows = report.measurements[uuid]?.[quantity] ?? [];
  const thresholds = report.thresholds[uuid]?.[quantity] ?? [];
  const violations = report.violations[uuid]?.[quantity] ?? [];
  const unit = rows[0]?.unit ?? '';

  if (doc.y > 650) doc.addPage();

  doc.fontSize(13).font('Helvetica-Bold').text(`${sensorName} — ${quantity}${unit ? ` [${unit}]` : ''}`);
  doc.fontSize(9).font('Helvetica').text(`UUID: ${uuid}  |  Reinraum: ${report.room.name}`);

  if (thresholds.length > 0) {
    doc.fontSize(8).font('Helvetica-Bold').text('Schwellenwert-Verlauf:');
    doc.font('Helvetica');
    for (const threshold of thresholds) {
      const until = threshold.valid_to ? formatDate(threshold.valid_to) : formatDate(createdAt);
      doc.text(
        `  Min: ${threshold.min_value ?? '–'} | Max: ${threshold.max_value ?? '–'}  ` +
          `(${formatDate(threshold.valid_from)} – ${until})`,
      );
    }
  }
  doc.moveDown(0.3);

  const values = rows.map((r) => Number(r.value));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const avg = values.reduce((a, b) => a + b, 0) / values.length;

  const violationPoints = violations.reduce((sum, v) => sum + (Number(v.data_points) || 0), 0);
  const violationSeconds = violations.reduce((sum, v) => sum + (Number(v.duration_sec) || 0), 0);

  doc.fontSize(9).font('Helvetica');
  doc.text(
    `Datenpunkte: ${rows.length}  |  Min: ${min.toFixed(2)}  |  ` +
      `Max: ${max.toFixed(2)}  |  Durchschnitt: ${avg.toFixed(2)}`,
  );
  doc.text(
    `Schwellenwert-Verletzungen: ${violations.length} Ereignisse ` +
      `(${violationPoints} Datenpunkte, Dauer: ${formatDuration(violationSeconds)})`,
  );
  doc.moveDown(0.3);

  renderMeasurementTable(doc, rows, violations, sensorName, quantity);

  if (violations.length > 0) {
    renderViolationList(doc, violations);
  }

  drawSeparator(doc);
  doc.moveDown(0.5);
}

function renderMeasurementTable(doc, rows, violations, sensorName, quantity) {
  const visible = rows.length > MAX_TABLE_ROWS ? rows.slice(-MAX_TABLE_ROWS) : rows;

  if (rows.length > MAX_TABLE_ROWS) {
    doc.fontSize(8).font('Helvetica-Oblique')
      .text(`(Zeige die letzten ${MAX_TABLE_ROWS} von ${rows.length} Datenpunkten)`);
    doc.moveDown(0.2);
  }

  drawTableHeader(doc);

  for (const row of visible) {
    if (doc.y > 750) {
      doc.addPage();
      doc.fontSize(8).font('Helvetica-Bold').text(`${sensorName} — ${quantity} (Fortsetzung)`, COLUMNS[0]);
      doc.moveDown(0.3);
      drawTableHeader(doc);
    }

    const violated = isWithinViolation(violations, row.time);
    const y = doc.y;
    doc.font('Helvetica').fontSize(7);
    doc.text(formatDate(row.time), COLUMNS[0], y);
    doc.text(Number(row.value).toFixed(2), COLUMNS[1], y);
    doc.fillColor(violated ? COLORS.violation : COLORS.ok).text(violated ? 'VERLETZUNG' : 'OK', COLUMNS[2], y);
    doc.fillColor(COLORS.text);
    doc.moveDown(0.1);
  }

  doc.moveDown(0.5);
}

function drawTableHeader(doc) {
  const y = doc.y;
  doc.fontSize(8).font('Helvetica-Bold');
  doc.text('Zeitpunkt', COLUMNS[0], y);
  doc.text('Wert', COLUMNS[1], y);
  doc.text('Status', COLUMNS[2], y);
  doc.moveDown(0.3);
}

function renderViolationList(doc, violations) {
  if (doc.y > 700) doc.addPage();

  doc.fontSize(9).font('Helvetica-Bold').fillColor(COLORS.violation);
  doc.text(`Schwellenwert-Verletzungen (${violations.length} Ereignisse):`);
  doc.fillColor(COLORS.text).font('Helvetica').fontSize(7);

  for (const event of violations) {
    const label = event.violation_type === 'below_min' ? 'UNTER MIN' : 'ÜBER MAX';
    const limit = event.violation_type === 'below_min' ? event.threshold_min : event.threshold_max;
    const end = event.ended_at ? formatDate(event.ended_at) : 'andauernd';
    const duration = event.duration_sec ? formatDuration(Number(event.duration_sec)) : 'läuft noch';

    doc.text(`  ${formatDate(event.started_at)} – ${end}  (${duration}, ${event.data_points} Punkte)`);
    doc.text(`    ${label} (Grenze: ${limit ?? '–'})  |  Extremwert: ${Number(event.peak_value).toFixed(2)}`);
  }

  doc.moveDown(0.5);
}

function renderFooter(doc, report, createdAt) {
  doc.fontSize(8).font('Helvetica').fillColor(COLORS.muted);
  doc.text(
    `Audit-Report für ${report.room.name} — erstellt vom OHB Sensor Dashboard am ${createdAt.toISOString()}`,
    50,
    doc.y + 20,
    { align: 'center' },
  );
}

/** Lag der Zeitpunkt innerhalb eines Verletzungs-Ereignisses? */
function isWithinViolation(violations, timestamp) {
  const time = new Date(timestamp).getTime();
  return violations.some((event) => {
    const start = new Date(event.started_at).getTime();
    const end = event.ended_at ? new Date(event.ended_at).getTime() : Infinity;
    return time >= start && time <= end;
  });
}

function formatDate(value) {
  if (!value) return '–';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '–';
  return date.toLocaleString('de-DE', {
    timeZone: TIMEZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return '0s';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = Math.floor(seconds % 60);

  const parts = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (rest > 0 || parts.length === 0) parts.push(`${rest}s`);
  return parts.join(' ');
}

function drawSeparator(doc) {
  doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor(COLORS.line).lineWidth(0.5).stroke();
}

/** Dateiname im Format Report_<Raum>_<Datum>.pdf */
function fileName(roomName) {
  const safeName = roomName.replace(/[^a-zA-Z0-9]/g, '_');
  return `Report_${safeName}_${new Date().toISOString().slice(0, 10)}.pdf`;
}

module.exports = { render, fileName, formatDate, formatDuration, isWithinViolation };
