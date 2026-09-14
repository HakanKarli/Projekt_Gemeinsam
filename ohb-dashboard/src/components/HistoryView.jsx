import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Plot, CHART, SERIES_COLORS, yRange } from '../lib/plot';
import { getSensors, getSensorMetrics, getSensorData, getThresholds, getAssignmentHistory } from '../api';
import { sensorLabel, sensorTitle } from '../sensorLabel';
import './HistoryView.css';

const ACCENT = CHART.accent;
const GRID = CHART.grid;
const BG = CHART.bg;
const TEXT = CHART.text;
const PLOT_CONFIG = Object.freeze({ displayModeBar: true, responsive: true, scrollZoom: true });
const PLOT_STYLE = Object.freeze({ width: '100%', height: '100%' });
const COLORS = SERIES_COLORS;

export default function HistoryView() {
  const [sensors, setSensors] = useState([]);
  const [selectedSensor, setSelectedSensor] = useState('');
  const [quantities, setQuantities] = useState([]);
  const [selectedQuantities, setSelectedQuantities] = useState([]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [loading, setLoading] = useState(false);
  const [chartData, setChartData] = useState(null);
  const [thresholds, setThresholds] = useState([]);
  const [roomHistory, setRoomHistory] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    getSensors().then(setSensors).catch(() => {});
    const now = new Date();
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    setTo(toLocalISO(now));
    setFrom(toLocalISO(dayAgo));
  }, []);

  useEffect(() => {
    setQuantities([]);
    setSelectedQuantities([]);
    setChartData(null);
    if (!selectedSensor) return;

    getSensorMetrics(selectedSensor)
      .then((q) => {
        setQuantities(q);
        setSelectedQuantities(q);
      })
      .catch(() => setQuantities([]));
  }, [selectedSensor]);

  function toLocalISO(d) {
    const offset = d.getTimezoneOffset();
    return new Date(d.getTime() - offset * 60000).toISOString().slice(0, 16);
  }

  function toggleQuantity(q) {
    setSelectedQuantities((prev) =>
      prev.includes(q) ? prev.filter((x) => x !== q) : [...prev, q]
    );
  }

  const handleLoad = useCallback(async () => {
    setError('');
    if (!selectedSensor) return setError('Bitte einen Sensor auswaehlen.');
    if (!selectedQuantities.length) return setError('Mindestens eine Quantity auswaehlen.');
    if (!from || !to) return setError('Zeitraum angeben.');

    setLoading(true);
    try {
      const fromISO = new Date(from).toISOString();
      const toISO = new Date(to).toISOString();

      const results = await Promise.all(
        selectedQuantities.map(async (quantity) => {
          const rows = await getSensorData(selectedSensor, quantity, fromISO, toISO, 5000);
          return { quantity, rows };
        })
      );

      const [thresh, history] = await Promise.all([
        getThresholds(selectedSensor).catch(() => []),
        getAssignmentHistory(selectedSensor).catch(() => []),
      ]);

      setChartData(results);
      setThresholds(thresh);
      setRoomHistory(history);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [selectedSensor, selectedQuantities, from, to]);

  function setTimeRange(hours) {
    const now = new Date();
    const past = new Date(now.getTime() - hours * 60 * 60 * 1000);
    setTo(toLocalISO(now));
    setFrom(toLocalISO(past));
  }

  const sensorInfo = sensors.find((s) => s.sensor_uuid === selectedSensor);

  const stats = useMemo(() => {
    if (!chartData) return null;
    return chartData.map(({ quantity, rows }) => {
      if (rows.length === 0) return { quantity, count: 0 };
      const values = rows.map((r) => parseFloat(r.value));
      return {
        quantity,
        unit: rows[0]?.unit ?? '',
        count: rows.length,
        min: Math.min(...values).toFixed(2),
        max: Math.max(...values).toFixed(2),
        avg: (values.reduce((a, b) => a + b, 0) / values.length).toFixed(2),
      };
    });
  }, [chartData]);

  return (
    <div className="history-view">
      <h2 className="history-title">Verlauf</h2>

      <div className="history-controls glass-card">
        <div className="history-field">
          <label className="history-label">Sensor</label>
          <select
            className="input history-select"
            value={selectedSensor}
            onChange={(e) => setSelectedSensor(e.target.value)}
          >
            <option value="">— Sensor auswaehlen —</option>
            {sensors.map((s) => (
              <option key={s.sensor_uuid} value={s.sensor_uuid} title={sensorTitle(s)}>
                {sensorLabel(s)}
              </option>
            ))}
          </select>
        </div>

        {quantities.length > 0 && (
          <div className="history-field">
            <label className="history-label">Quantities</label>
            <div className="history-chip-row">
              {quantities.map((q) => (
                <button
                  key={q}
                  className={`history-chip ${selectedQuantities.includes(q) ? 'active' : ''}`}
                  onClick={() => toggleQuantity(q)}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="history-field">
          <label className="history-label">Zeitraum</label>
          <div className="history-time-row">
            <input type="datetime-local" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
            <span className="history-time-sep">–</span>
            <input type="datetime-local" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="history-quick-btns">
            <button className="btn btn-ghost btn-sm" onClick={() => setTimeRange(1)}>1h</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setTimeRange(6)}>6h</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setTimeRange(24)}>24h</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setTimeRange(72)}>3 Tage</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setTimeRange(168)}>7 Tage</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setTimeRange(720)}>30 Tage</button>
          </div>
        </div>

        <button className="btn btn-primary history-load-btn" onClick={handleLoad} disabled={loading}>
          {loading ? 'Lade Daten...' : 'Daten laden'}
        </button>

        {error && <p className="history-error">{error}</p>}
      </div>

      {chartData && (
        <div className="history-chart-section">
          {sensorInfo && (
            <div className="history-sensor-info">
              <span><strong>{sensorInfo.name}</strong></span>
              {sensorInfo.gateway_id && <span> · Gateway: {sensorInfo.gateway_id}</span>}
              {sensorInfo.cleanroom_name && <span> · {sensorInfo.cleanroom_name}</span>}
            </div>
          )}

          {roomHistory.length > 0 && (
            <div className="history-room-timeline glass-card">
              <span className="history-label">Raumzuordnungen im Zeitraum</span>
              <div className="history-room-list">
                {roomHistory.map((a, i) => {
                  const vFrom = a.valid_from ? new Date(a.valid_from).toLocaleString('de-DE') : '–';
                  const vTo = a.valid_to ? new Date(a.valid_to).toLocaleString('de-DE') : 'aktuell';
                  return (
                    <div key={i} className="history-room-entry">
                      <span className="history-room-name">{a.cleanroom_name}</span>
                      <span className="history-room-range">{vFrom} — {vTo}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {stats && (
            <div className="history-stats-row">
              {stats.map(({ quantity, unit, count, min, max, avg }, i) => (
                <div key={quantity} className="history-stat-card glass-card" style={{ borderLeftColor: COLORS[i % COLORS.length] }}>
                  <span className="history-stat-metric">{quantity}{unit ? ` [${unit}]` : ''}</span>
                  {count > 0 ? (
                    <>
                      <span className="history-stat-val">{count} Punkte</span>
                      <span className="history-stat-detail">Min: {min} · Max: {max} · Avg: {avg}</span>
                    </>
                  ) : (
                    <span className="history-stat-val">Keine Daten</span>
                  )}
                </div>
              ))}
            </div>
          )}

          {chartData.map(({ quantity, rows }, i) => {
            if (rows.length === 0) return null;

            const thresh = thresholds.find((t) => t.quantity === quantity);
            const color = COLORS[i % COLORS.length];
            const unit = rows[0]?.unit ?? '';

            const yVals = rows.map((r) => parseFloat(r.value));
            // Schwellenwerte in den sichtbaren Bereich einbeziehen, damit die
            // gestrichelten Linien beim Y-Zoom nicht aus dem Bild fallen.
            const rangeVals = [...yVals];
            if (thresh?.min_value != null) rangeVals.push(parseFloat(thresh.min_value));
            if (thresh?.max_value != null) rangeVals.push(parseFloat(thresh.max_value));
            const yr = yRange(rangeVals);

            const traces = [{
              x: rows.map((r) => new Date(r.time)),
              y: yVals,
              type: 'scatter',
              mode: 'lines',
              line: { color, width: 1.5, shape: 'spline' },
              fill: 'tozeroy',
              fillcolor: `${color}11`,
              name: quantity,
            }];

            const shapes = [];
            if (thresh?.min_value != null) {
              shapes.push({
                type: 'line', xref: 'paper', x0: 0, x1: 1,
                y0: parseFloat(thresh.min_value), y1: parseFloat(thresh.min_value),
                line: { color: '#f97316', width: 1, dash: 'dash' },
              });
            }
            if (thresh?.max_value != null) {
              shapes.push({
                type: 'line', xref: 'paper', x0: 0, x1: 1,
                y0: parseFloat(thresh.max_value), y1: parseFloat(thresh.max_value),
                line: { color: '#ef4444', width: 1, dash: 'dash' },
              });
            }

            const layout = {
              autosize: true,
              paper_bgcolor: BG,
              plot_bgcolor: BG,
              margin: { t: 30, r: 20, b: 40, l: 55 },
              title: { text: `${quantity}${unit ? ` [${unit}]` : ''}`, font: { color: TEXT, size: 13 }, x: 0.02 },
              xaxis: { type: 'date', color: TEXT, gridcolor: GRID, tickfont: { size: 10 } },
              yaxis: { color: TEXT, gridcolor: GRID, tickfont: { size: 10 }, ...(yr ? { range: yr, autorange: false } : {}) },
              font: { family: 'Inter, sans-serif', color: TEXT },
              showlegend: false,
              hovermode: 'x unified',
              shapes,
            };

            return (
              <div key={quantity} className="history-chart-card glass-card">
                <Plot
                  data={traces}
                  layout={layout}
                  config={PLOT_CONFIG}
                  useResizeHandler
                  style={PLOT_STYLE}
                />
                {thresh && (
                  <div className="history-thresh-hint">
                    Schwellenwerte: {thresh.min_value != null && `Min ${thresh.min_value}`}
                    {thresh.min_value != null && thresh.max_value != null && ' · '}
                    {thresh.max_value != null && `Max ${thresh.max_value}`}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
