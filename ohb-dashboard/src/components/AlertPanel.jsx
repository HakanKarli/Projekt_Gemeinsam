import React, { useState, useEffect, useRef, useCallback } from 'react';
import { getViolations, acknowledgeViolation } from '../api';
import './AlertPanel.css';

const API_BASE = `http://${window.location.hostname}:3001/api`;

const TYPE_LABELS = {
  above_max: 'Ueber Maximum',
  below_min: 'Unter Minimum',
};

function fmtTime(ts) {
  if (!ts) return '–';
  return new Date(ts).toLocaleString('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function fmtDuration(sec) {
  if (sec == null) return 'laufend';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export default function AlertPanel({ open, onClose }) {
  const [violations, setViolations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('unacknowledged');
  const [liveAlerts, setLiveAlerts] = useState([]);
  const eventSourceRef = useRef(null);

  useEffect(() => {
    const es = new EventSource(`${API_BASE}/alerts/stream`);
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        setLiveAlerts((prev) => [data, ...prev].slice(0, 20));
        loadViolations();
      } catch { /* ignore */ }
    };
    eventSourceRef.current = es;
    return () => es.close();
  }, []);

  const loadViolations = useCallback(async () => {
    try {
      setLoading(true);
      const params = { limit: '100' };
      if (filter === 'unacknowledged') params.acknowledged = 'false';
      if (filter === 'active') params.active = 'true';
      const data = await getViolations(params);
      setViolations(data);
    } catch (err) {
      console.error('Violations laden fehlgeschlagen:', err);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { loadViolations(); }, [loadViolations]);

  async function handleAck(id) {
    try {
      await acknowledgeViolation(id);
      setViolations((prev) => prev.map((v) =>
        v.id === id ? { ...v, acknowledged: true } : v
      ));
    } catch (err) {
      console.error('Quittierung fehlgeschlagen:', err);
    }
  }

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="alert-panel glass-card" onClick={(e) => e.stopPropagation()}>

        <div className="alert-panel-header">
          <h2 className="modal-title">Schwellenwert-Alarme</h2>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>

        {liveAlerts.length > 0 && (
          <div className="alert-live-banner">
            <span className="alert-live-dot" />
            Letzter Alarm: {liveAlerts[0].sensor_name ?? liveAlerts[0].sensor_uuid} – {liveAlerts[0].quantity} = {liveAlerts[0].value}
          </div>
        )}

        <div className="alert-filters">
          {[
            ['unacknowledged', 'Offen'],
            ['active', 'Aktiv'],
            ['all', 'Alle'],
          ].map(([key, label]) => (
            <button
              key={key}
              className={`btn ${filter === key ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setFilter(key)}
            >
              {label}
            </button>
          ))}
          <button className="btn btn-ghost" onClick={loadViolations} style={{ marginLeft: 'auto' }}>
            Aktualisieren
          </button>
        </div>

        <div className="alert-table-wrap">
          {loading ? (
            <div className="alert-loading">Laden...</div>
          ) : violations.length === 0 ? (
            <div className="alert-empty">Keine Alarme vorhanden</div>
          ) : (
            <table className="alert-table">
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Sensor</th>
                  <th>Quantity</th>
                  <th>Typ</th>
                  <th>Wert</th>
                  <th>Grenzwert</th>
                  <th>Beginn</th>
                  <th>Dauer</th>
                  <th>Punkte</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {violations.map((v) => (
                  <tr key={v.id} className={v.acknowledged ? 'alert-row-ack' : 'alert-row-open'}>
                    <td>
                      {v.acknowledged ? (
                        <span className="alert-badge alert-badge-ack">Quittiert</span>
                      ) : v.ended_at ? (
                        <span className="alert-badge alert-badge-closed">Beendet</span>
                      ) : (
                        <span className="alert-badge alert-badge-active">Aktiv</span>
                      )}
                    </td>
                    <td title={v.sensor_uuid}>{v.sensor_name ?? v.sensor_uuid}</td>
                    <td>{v.quantity}</td>
                    <td>{TYPE_LABELS[v.violation_type] || v.violation_type}</td>
                    <td className="alert-value">{v.peak_value ?? v.first_value}</td>
                    <td>
                      {v.violation_type === 'above_max' ? `max ${v.threshold_max}` : `min ${v.threshold_min}`}
                    </td>
                    <td>{fmtTime(v.started_at)}</td>
                    <td>{fmtDuration(v.duration_sec)}</td>
                    <td>{v.data_points}</td>
                    <td>
                      {!v.acknowledged && (
                        <button className="btn btn-primary btn-sm" onClick={() => handleAck(v.id)}>
                          Quittieren
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
