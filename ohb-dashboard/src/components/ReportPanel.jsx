import React, { useState, useEffect } from 'react';
import { getCleanrooms, generateReport } from '../api';
import './ReportPanel.css';

export default function ReportPanel({ onClose }) {
  const [rooms, setRooms] = useState([]);
  const [selectedRoom, setSelectedRoom] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    getCleanrooms().then(setRooms).catch(() => {});
    // Standardzeitraum: letzte 24h
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    setTo(toLocalISO(now));
    setFrom(toLocalISO(yesterday));
  }, []);

  function toLocalISO(d) {
    const offset = d.getTimezoneOffset();
    const local = new Date(d.getTime() - offset * 60000);
    return local.toISOString().slice(0, 16);
  }

  async function handleGenerate() {
    setError('');
    if (!selectedRoom) return setError('Bitte einen Reinraum auswaehlen.');
    if (!from || !to) return setError('Zeitraum angeben.');

    setLoading(true);
    try {
      const blob = await generateReport(
        parseInt(selectedRoom),
        new Date(from).toISOString(),
        new Date(to).toISOString()
      );
      // Download ausloesen
      const roomName = rooms.find(r => String(r.id) === selectedRoom)?.name || 'Report';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Report_${roomName.replace(/[^a-zA-Z0-9]/g, '_')}_${new Date().toISOString().slice(0, 10)}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="report-box glass-card">
        <div className="modal-header">
          <span className="modal-title">Reinraum-Report erstellen</span>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>

        <div className="report-content">
          {/* ── Reinraum ── */}
          <section className="report-section">
            <h3 className="report-section-title">Reinraum</h3>
            <select
              className="input"
              value={selectedRoom}
              onChange={(e) => setSelectedRoom(e.target.value)}
            >
              <option value="">— Reinraum auswaehlen —</option>
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
            <p className="report-hint">
              Alle Sensoren, die im gewaehlten Zeitraum diesem Reinraum zugeordnet waren, werden automatisch einbezogen.
              Schwellenwert-Aenderungen werden historisch korrekt beruecksichtigt.
            </p>
          </section>

          {/* ── Zeitraum ── */}
          <section className="report-section">
            <h3 className="report-section-title">Zeitraum</h3>
            <div className="report-time-row">
              <label>
                Von
                <input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} className="input" />
              </label>
              <label>
                Bis
                <input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} className="input" />
              </label>
            </div>
          </section>

          {/* ── Error ── */}
          {error && <p className="report-error">{error}</p>}

          {/* ── Button ── */}
          <button
            className="btn btn-primary report-generate"
            onClick={handleGenerate}
            disabled={loading}
          >
            {loading ? 'Wird generiert...' : 'Report als PDF generieren'}
          </button>
        </div>
      </div>
    </div>
  );
}
