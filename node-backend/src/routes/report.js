const { Router } = require('express');
const PDFDocument = require('pdfkit');
const path = require('path');
const pool = require('../db');

const router = Router();
const LOGO_PATH = path.resolve(__dirname, '..', 'ohb-logo.png');

// POST /api/report
// Body: { cleanroom_id: number, from: "ISO", to: "ISO" }
router.post('/', async (req, res) => {
  try {
    const { cleanroom_id, from, to } = req.body;

    if (!cleanroom_id || !from || !to) {
      return res.status(400).json({ error: 'cleanroom_id, from und to sind erforderlich' });
    }

    const { rows: roomRows } = await pool.query(
      'SELECT id, name FROM cleanrooms WHERE id = $1', [cleanroom_id]
    );
    if (roomRows.length === 0) return res.status(404).json({ error: 'Reinraum nicht gefunden' });
    const room = roomRows[0];

    const { rows: assignments } = await pool.query(`
      SELECT sa.sensor_uuid, r.name AS sensor_name, r.gateway_id,
             lower(sa.valid_during) AS assigned_from,
             upper(sa.valid_during) AS assigned_to
      FROM sensor_assignments sa
      JOIN sensor_registry r ON r.sensor_uuid = sa.sensor_uuid
      WHERE sa.cleanroom_id = $1
        AND sa.valid_during && tstzrange($2::timestamptz, $3::timestamptz)
      ORDER BY r.name, lower(sa.valid_during)
    `, [cleanroom_id, from, to]);

    const sensorUuids = [...new Set(assignments.map(a => a.sensor_uuid))];

    if (sensorUuids.length === 0) {
      return res.status(400).json({
        error: 'Keine Sensoren waren im gewaehlten Zeitraum diesem Reinraum zugeordnet.',
      });
    }

    const { rows: data } = await pool.query(`
      SELECT sensor_uuid, quantity, unit, time, value
      FROM sensor_data
      WHERE sensor_uuid = ANY($1)
        AND time >= $2 AND time <= $3
      ORDER BY sensor_uuid, quantity, time
    `, [sensorUuids, from, to]);

    const grouped = {};
    for (const row of data) {
      if (!grouped[row.sensor_uuid]) grouped[row.sensor_uuid] = {};
      if (!grouped[row.sensor_uuid][row.quantity]) grouped[row.sensor_uuid][row.quantity] = [];
      grouped[row.sensor_uuid][row.quantity].push(row);
    }

    const { rows: thresholds } = await pool.query(`
      SELECT sensor_uuid, quantity, min_value, max_value,
             lower(valid_during) AS valid_from,
             upper(valid_during) AS valid_to
      FROM sensor_thresholds
      WHERE sensor_uuid = ANY($1)
        AND valid_during && tstzrange($2::timestamptz, $3::timestamptz)
      ORDER BY sensor_uuid, quantity, lower(valid_during)
    `, [sensorUuids, from, to]);

    const thresholdHistory = {};
    for (const t of thresholds) {
      if (!thresholdHistory[t.sensor_uuid]) thresholdHistory[t.sensor_uuid] = {};
      if (!thresholdHistory[t.sensor_uuid][t.quantity]) thresholdHistory[t.sensor_uuid][t.quantity] = [];
      thresholdHistory[t.sensor_uuid][t.quantity].push(t);
    }

    const { rows: violationRows } = await pool.query(`
      SELECT id, sensor_uuid, quantity, violation_type,
             threshold_min, threshold_max, valid_during,
             lower(valid_during) AS started_at,
             CASE WHEN upper(valid_during) = 'infinity' THEN NULL
                  ELSE upper(valid_during) END AS ended_at,
             CASE WHEN upper(valid_during) = 'infinity' THEN NULL
                  ELSE EXTRACT(EPOCH FROM (upper(valid_during) - lower(valid_during))) END AS duration_sec,
             first_value, last_value, peak_value, data_points
      FROM threshold_violations
      WHERE sensor_uuid = ANY($1)
        AND cleanroom_id = $2
        AND valid_during && tstzrange($3::timestamptz, $4::timestamptz)
      ORDER BY sensor_uuid, quantity, lower(valid_during)
    `, [sensorUuids, cleanroom_id, from, to]);

    const violationsBySensorQuantity = {};
    for (const v of violationRows) {
      if (!violationsBySensorQuantity[v.sensor_uuid]) violationsBySensorQuantity[v.sensor_uuid] = {};
      if (!violationsBySensorQuantity[v.sensor_uuid][v.quantity]) violationsBySensorQuantity[v.sensor_uuid][v.quantity] = [];
      violationsBySensorQuantity[v.sensor_uuid][v.quantity].push(v);
    }

    function isInViolation(sensor_uuid, quantity, timestamp) {
      const events = violationsBySensorQuantity[sensor_uuid]?.[quantity];
      if (!events) return false;
      const t = new Date(timestamp).getTime();
      for (const ev of events) {
        const s = new Date(ev.started_at).getTime();
        const e = ev.ended_at ? new Date(ev.ended_at).getTime() : Infinity;
        if (t >= s && t <= e) return true;
      }
      return false;
    }

    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const buffers = [];
    doc.on('data', (chunk) => buffers.push(chunk));
    const pdfReady = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(buffers))));

    try {
      const logoWidth = 160;
      const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const logoX = doc.page.margins.left + (pageWidth - logoWidth) / 2;
      doc.image(LOGO_PATH, logoX, doc.y, { width: logoWidth });
      doc.moveDown(4);
    } catch { /* Logo nicht gefunden */ }

    const reportTime = new Date();
    doc.fontSize(22).font('Helvetica-Bold').text('Reinraum-Report', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(14).font('Helvetica').text(room.name, { align: 'center' });
    doc.moveDown(0.3);
    doc.fontSize(10).text('OHB Sensor Dashboard — Audit-Report', { align: 'center' });
    doc.moveDown(1.5);

    doc.text(`Erstellt am: ${reportTime.toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })}`);
    doc.text(`Zeitraum: ${fmtDate(from)} – ${fmtDate(to)}`);
    doc.text(`Reinraum: ${room.name} (ID: ${room.id})`);
    doc.text(`Sensoren im Zeitraum: ${assignments.map(a => a.sensor_name).join(', ')}`);
    doc.text(`Datenpunkte gesamt: ${data.length}`);
    const totalViolDuration = violationRows.reduce((s, v) => s + (parseFloat(v.duration_sec) || 0), 0);
    doc.text(`Schwellenwert-Verletzungen: ${violationRows.length} Ereignisse (Gesamtdauer: ${fmtDuration(totalViolDuration)})`);
    doc.moveDown(0.5);

    doc.fontSize(10).font('Helvetica-Bold').text('Sensor-Zuordnungen im Zeitraum:');
    doc.fontSize(8).font('Helvetica');
    for (const a of assignments) {
      const aFrom = a.assigned_from ? fmtDate(a.assigned_from) : '–';
      const isOpen = !a.assigned_to || a.assigned_to === 'infinity' || isNaN(new Date(a.assigned_to).getTime());
      const aTo = isOpen ? fmtDate(reportTime) : fmtDate(a.assigned_to);
      doc.text(`  ${a.sensor_name} (${a.sensor_uuid})  —  ${aFrom} bis ${aTo}`);
    }
    doc.moveDown(1);
    drawLine(doc);
    doc.moveDown(0.5);

    for (const uuid of sensorUuids) {
      const sensorAssignment = assignments.find(a => a.sensor_uuid === uuid);
      const sensorName = sensorAssignment?.sensor_name ?? uuid;
      const quantities = grouped[uuid] ? Object.keys(grouped[uuid]).sort() : [];

      if (quantities.length === 0) {
        if (doc.y > 700) doc.addPage();
        doc.fontSize(13).font('Helvetica-Bold').text(sensorName);
        doc.fontSize(9).font('Helvetica').text('Keine Messdaten im gewaehlten Zeitraum.', { oblique: true });
        doc.moveDown(1);
        drawLine(doc);
        doc.moveDown(0.5);
        continue;
      }

      for (const quantity of quantities) {
        const rows = grouped[uuid][quantity] || [];
        const threshList = thresholdHistory[uuid]?.[quantity] || [];
        const unit = rows[0]?.unit ?? '';

        if (doc.y > 650) doc.addPage();

        doc.fontSize(13).font('Helvetica-Bold').text(`${sensorName} — ${quantity}${unit ? ` [${unit}]` : ''}`);
        doc.fontSize(9).font('Helvetica').text(`UUID: ${uuid}  |  Reinraum: ${room.name}`);

        if (threshList.length > 0) {
          doc.fontSize(8).font('Helvetica-Bold').text('Schwellenwert-Verlauf:');
          doc.font('Helvetica');
          for (const th of threshList) {
            const thFrom = th.valid_from ? fmtDate(th.valid_from) : '–';
            const thIsOpen = !th.valid_to || th.valid_to === 'infinity' || isNaN(new Date(th.valid_to).getTime());
            const thTo = thIsOpen ? fmtDate(reportTime) : fmtDate(th.valid_to);
            doc.text(`  Min: ${th.min_value ?? '–'} | Max: ${th.max_value ?? '–'}  (${thFrom} – ${thTo})`);
          }
        }
        doc.moveDown(0.3);

        if (rows.length === 0) {
          doc.fontSize(9).text('Keine Messdaten.', { oblique: true });
          doc.moveDown(1);
          drawLine(doc);
          doc.moveDown(0.5);
          continue;
        }

        const values = rows.map((r) => parseFloat(r.value));
        const min = Math.min(...values);
        const max = Math.max(...values);
        const avg = values.reduce((a, b) => a + b, 0) / values.length;

        const violations = violationsBySensorQuantity[uuid]?.[quantity] || [];
        const metricViolDuration = violations.reduce((s, v) => s + (parseFloat(v.duration_sec) || 0), 0);
        const metricViolPoints   = violations.reduce((s, v) => s + (parseInt(v.data_points)    || 0), 0);

        doc.fontSize(9).font('Helvetica');
        doc.text(`Datenpunkte: ${rows.length}  |  Min: ${min.toFixed(2)}  |  Max: ${max.toFixed(2)}  |  Durchschnitt: ${avg.toFixed(2)}`);
        doc.text(`Schwellenwert-Verletzungen: ${violations.length} Ereignisse (${metricViolPoints} Datenpunkte, Dauer: ${fmtDuration(metricViolDuration)})`);
        doc.moveDown(0.3);

        const tableRows = rows.length > 50 ? rows.slice(-50) : rows;
        if (rows.length > 50) {
          doc.fontSize(8).font('Helvetica-Oblique').text(`(Zeige letzte 50 von ${rows.length} Datenpunkten)`);
          doc.moveDown(0.2);
        }

        const colX = [50, 200, 320];
        doc.fontSize(8).font('Helvetica-Bold');
        doc.text('Zeitpunkt', colX[0], doc.y);
        doc.text('Wert', colX[1], doc.y - 10);
        doc.text('Status', colX[2], doc.y - 10);
        doc.moveDown(0.3);

        doc.font('Helvetica').fontSize(7);
        for (const r of tableRows) {
          if (doc.y > 750) {
            doc.addPage();
            doc.fontSize(8).font('Helvetica-Bold');
            doc.text(`${sensorName} — ${quantity} (Forts.)`, 50);
            doc.moveDown(0.3);
            doc.text('Zeitpunkt', colX[0], doc.y);
            doc.text('Wert', colX[1], doc.y - 10);
            doc.text('Status', colX[2], doc.y - 10);
            doc.moveDown(0.3);
            doc.font('Helvetica').fontSize(7);
          }

          const v = parseFloat(r.value);
          const status = isInViolation(uuid, quantity, r.time) ? 'VERLETZUNG' : 'OK';
          const yRow = doc.y;
          doc.text(fmtDate(r.time), colX[0], yRow);
          doc.text(v.toFixed(2), colX[1], yRow);
          doc.fillColor(status === 'OK' ? '#22c55e' : '#ef4444').text(status, colX[2], yRow);
          doc.fillColor('#000000');
          doc.moveDown(0.1);
        }

        doc.moveDown(0.5);

        if (violations.length > 0) {
          if (doc.y > 700) doc.addPage();
          doc.fontSize(9).font('Helvetica-Bold').fillColor('#ef4444');
          doc.text(`Schwellenwert-Verletzungen (${violations.length} Ereignisse):`);
          doc.fillColor('#000000').font('Helvetica').fontSize(7);
          for (const ev of violations) {
            const typeLabel = ev.violation_type === 'below_min' ? 'UNTER MIN' : 'UEBER MAX';
            const limit = ev.violation_type === 'below_min' ? ev.threshold_min : ev.threshold_max;
            const endStr = ev.ended_at ? fmtDate(ev.ended_at) : 'andauernd';
            const durStr = ev.duration_sec ? fmtDuration(ev.duration_sec) : 'laeuft noch';
            doc.text(`  ${fmtDate(ev.started_at)} – ${endStr}  (${durStr}, ${ev.data_points} Punkte)`);
            doc.text(`    ${typeLabel} (Grenze: ${limit})  |  Extremwert: ${parseFloat(ev.peak_value).toFixed(2)}`);
          }
          doc.moveDown(0.5);
        }

        drawLine(doc);
        doc.moveDown(0.5);
      }
    }

    doc.fontSize(8).font('Helvetica').fillColor('#888888');
    doc.text(
      `Audit-Report fuer ${room.name} — generiert von OHB Sensor Dashboard am ${new Date().toISOString()}`,
      50, doc.y + 20, { align: 'center' }
    );

    doc.end();
    const pdfBuffer = await pdfReady;

    const filename = `Report_${room.name.replace(/[^a-zA-Z0-9]/g, '_')}_${new Date().toISOString().slice(0, 10)}.pdf`;
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': pdfBuffer.length,
    });
    res.send(pdfBuffer);

  } catch (err) {
    console.error('[REPORT] Fehler:', err);
    res.status(500).json({ error: err.message });
  }
});

function fmtDate(iso) {
  if (!iso || iso === 'infinity' || iso === '-infinity') return '–';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '–';
  return d.toLocaleString('de-DE', {
    timeZone: 'Europe/Berlin',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function drawLine(doc) {
  doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#cccccc').lineWidth(0.5).stroke();
}

function fmtDuration(seconds) {
  if (!seconds || seconds <= 0) return '0s';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const parts = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  if (s > 0 || parts.length === 0) parts.push(`${s}s`);
  return parts.join(' ');
}

module.exports = router;
