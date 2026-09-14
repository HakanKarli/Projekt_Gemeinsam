import React, { useState, useEffect } from 'react';
import * as api from '../api';
import { sensorLabel, sensorTitle, quantitiesText } from '../sensorLabel';
import './ConfigPanel.css';

const TABS = ['Reinraeume', 'Sensoren', 'Schwellenwerte'];

export default function ConfigPanel({ onClose }) {
  const [tab, setTab] = useState(0);

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="config-box glass-card">
        <div className="modal-header">
          <span className="modal-title">Konfiguration</span>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>

        <div className="config-tabs">
          {TABS.map((label, i) => (
            <button
              key={label}
              className={`config-tab ${i === tab ? 'active' : ''}`}
              onClick={() => setTab(i)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="config-content">
          {tab === 0 && <CleanroomsTab />}
          {tab === 1 && <SensorsTab />}
          {tab === 2 && <ThresholdsTab />}
        </div>
      </div>
    </div>
  );
}

/* ================================================================
   Tab 1: Reinraeume
   ================================================================ */
function CleanroomsTab() {
  const [rooms, setRooms] = useState([]);
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    try { setRooms(await api.getCleanrooms()); }
    catch (e) { setError(e.message); }
  };

  // Einmaliger Ladevorgang beim Mounten — kein abzuleitender Wert, sondern ein
  // Abruf vom Server, deshalb bewusst außerhalb der Regel.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, []);

  const handleAdd = async () => {
    if (!name.trim()) return;
    setError('');
    try {
      await api.createCleanroom(name.trim());
      setName('');
      await load();
    } catch (e) { setError(e.message); }
  };

  const handleDelete = async (id) => {
    setError('');
    try {
      await api.deleteCleanroom(id);
      await load();
    } catch (e) { setError(e.message); }
  };

  return (
    <div className="config-tab-content">
      {error && <div className="config-error">{error}</div>}

      <div className="config-form-row">
        <input
          className="input"
          placeholder="Neuer Reinraum (z.B. Reinraum 221)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
        />
        <button className="btn btn-primary" onClick={handleAdd}>Hinzufuegen</button>
      </div>

      <table className="config-table">
        <thead>
          <tr><th>ID</th><th>Name</th><th></th></tr>
        </thead>
        <tbody>
          {rooms.map((r) => (
            <tr key={r.id}>
              <td>{r.id}</td>
              <td>{r.name}</td>
              <td>
                <button className="btn btn-danger btn-sm" onClick={() => handleDelete(r.id)}>
                  Loeschen
                </button>
              </td>
            </tr>
          ))}
          {rooms.length === 0 && (
            <tr><td colSpan={3} className="config-empty">Keine Reinraeume vorhanden</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/* ================================================================
   Tab 2: Sensoren + Zuordnung
   Sensoren registrieren sich automatisch per MQTT.
   Hier koennen sie umbenannt und einem Reinraum zugeordnet werden.
   ================================================================ */
function SensorsTab() {
  const [sensors, setSensors] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [error, setError] = useState('');

  const [assignSensorUuid, setAssignSensorUuid] = useState('');
  const [assignRoomId, setAssignRoomId] = useState('');
  const [renameUuid, setRenameUuid] = useState('');
  const [renameName, setRenameName] = useState('');

  const load = async () => {
    try {
      const [s, r] = await Promise.all([api.getSensors(), api.getCleanrooms()]);
      setSensors(s);
      setRooms(r);
    } catch (e) { setError(e.message); }
  };

  // Einmaliger Ladevorgang beim Mounten — kein abzuleitender Wert, sondern ein
  // Abruf vom Server, deshalb bewusst außerhalb der Regel.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, []);

  const handleAssign = async () => {
    if (!assignSensorUuid || !assignRoomId) return;
    setError('');
    try {
      await api.createAssignment(assignSensorUuid, parseInt(assignRoomId));
      setAssignSensorUuid('');
      setAssignRoomId('');
      await load();
    } catch (e) { setError(e.message); }
  };

  const handleRename = async () => {
    if (!renameUuid || !renameName.trim()) return;
    setError('');
    try {
      await api.renameSensor(renameUuid, renameName.trim());
      setRenameUuid('');
      setRenameName('');
      await load();
    } catch (e) { setError(e.message); }
  };

  const handleDelete = async (uuid) => {
    setError('');
    try {
      await api.deleteSensor(uuid);
      await load();
    } catch (e) { setError(e.message); }
  };

  return (
    <div className="config-tab-content">
      {error && <div className="config-error">{error}</div>}

      <h3 className="config-subtitle">Sensor umbenennen</h3>
      <div className="config-form-row">
        <select className="input" value={renameUuid} onChange={(e) => setRenameUuid(e.target.value)}>
          <option value="">-- Sensor --</option>
          {sensors.map((s) => (
            <option key={s.sensor_uuid} value={s.sensor_uuid} title={sensorTitle(s)}>{sensorLabel(s)}</option>
          ))}
        </select>
        <input
          className="input"
          placeholder="Neuer Name"
          value={renameName}
          onChange={(e) => setRenameName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleRename()}
        />
        <button className="btn btn-primary" onClick={handleRename}>Umbenennen</button>
      </div>

      <h3 className="config-subtitle">Sensor einem Raum zuordnen</h3>
      <div className="config-form-row">
        <select className="input" value={assignSensorUuid} onChange={(e) => setAssignSensorUuid(e.target.value)}>
          <option value="">-- Sensor --</option>
          {sensors.map((s) => (
            <option key={s.sensor_uuid} value={s.sensor_uuid} title={sensorTitle(s)}>{sensorLabel(s)}</option>
          ))}
        </select>
        <select className="input" value={assignRoomId} onChange={(e) => setAssignRoomId(e.target.value)}>
          <option value="">-- Reinraum --</option>
          {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        <button className="btn btn-primary" onClick={handleAssign}>Zuordnen</button>
      </div>

      <h3 className="config-subtitle">Registrierte Sensoren</h3>
      <table className="config-table">
        <thead>
          <tr><th>Name</th><th>Misst</th><th>UUID</th><th>Gateway</th><th>Reinraum</th><th></th></tr>
        </thead>
        <tbody>
          {sensors.map((s) => (
            <tr key={s.sensor_uuid} title={sensorTitle(s)}>
              <td>
                {s.name}
                {s.event_driven ? <span className="config-badge" title="event-getrieben"> ⚡</span> : null}
              </td>
              <td>{quantitiesText(s.quantities) || '–'}</td>
              <td><code style={{ fontSize: '0.75em' }}>{s.sensor_uuid}</code></td>
              <td>{s.gateway_id || '–'}</td>
              <td>{s.cleanroom_name || '–'}</td>
              <td>
                <button
                  className="btn btn-sm"
                  style={{ marginRight: 6 }}
                  onClick={() => { setAssignSensorUuid(s.sensor_uuid); setAssignRoomId(''); }}
                  title="Raum zuweisen"
                >
                  {s.cleanroom_name ? 'Neu zuordnen' : 'Zuordnen'}
                </button>
                <button className="btn btn-danger btn-sm" onClick={() => handleDelete(s.sensor_uuid)}>
                  Loeschen
                </button>
              </td>
            </tr>
          ))}
          {sensors.length === 0 && (
            <tr><td colSpan={6} className="config-empty">Keine Sensoren vorhanden — warten auf MQTT-Daten</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/* ================================================================
   Tab 3: Schwellenwerte
   ================================================================ */
function ThresholdsTab() {
  const [thresholds,  setThresholds]  = useState([]);
  const [sensors,     setSensors]     = useState([]);
  const [quantities,  setQuantities]  = useState([]);   // verfügbare Messgrößen des gewählten Sensors
  const [loadingQty,  setLoadingQty]  = useState(false);
  const [error,       setError]       = useState('');

  const [selSensor, setSelSensor] = useState('');
  const [quantity,  setQuantity]  = useState('');
  const [minVal,    setMinVal]    = useState('');
  const [maxVal,    setMaxVal]    = useState('');

  const load = async () => {
    try {
      const [t, s] = await Promise.all([api.getThresholds(), api.getSensors()]);
      setThresholds(t);
      setSensors(s);
    } catch (e) { setError(e.message); }
  };

  // Einmaliger Ladevorgang beim Mounten — kein abzuleitender Wert, sondern ein
  // Abruf vom Server, deshalb bewusst außerhalb der Regel.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, []);

  // Messgrößen laden sobald ein Sensor gewählt wird
  useEffect(() => {
    // Rücksetzen bei fehlender Auswahl ist Teil derselben Synchronisation mit
    // der Auswahl wie der Abruf darunter, nicht abgeleiteter Render-Zustand.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!selSensor) { setQuantities([]); setQuantity(''); return; }
    setLoadingQty(true);
    setQuantity('');
    api.getSensorMetrics(selSensor)
      .then(qtys => { setQuantities(qtys); if (qtys.length === 1) setQuantity(qtys[0]); })
      .catch(() => setQuantities([]))
      .finally(() => setLoadingQty(false));
  }, [selSensor]);

  const handleSet = async () => {
    if (!selSensor || !quantity) return;
    setError('');
    try {
      await api.setThreshold(
        selSensor,
        quantity,
        minVal !== '' ? parseFloat(minVal) : null,
        maxVal !== '' ? parseFloat(maxVal) : null,
      );
      setQuantity('');
      setMinVal('');
      setMaxVal('');
      await load();
    } catch (e) { setError(e.message); }
  };

  const handleDelete = async (id) => {
    setError('');
    try {
      await api.deleteThreshold(id);
      await load();
    } catch (e) { setError(e.message); }
  };

  const sensorName = (uuid) => sensors.find(s => s.sensor_uuid === uuid)?.name ?? uuid;

  return (
    <div className="config-tab-content">
      {error && <div className="config-error">{error}</div>}

      <div className="config-form-row">
        {/* Sensor-Dropdown */}
        <select className="input" value={selSensor} onChange={(e) => setSelSensor(e.target.value)}>
          <option value="">-- Sensor --</option>
          {sensors.map((s) => (
            <option key={s.sensor_uuid} value={s.sensor_uuid} title={sensorTitle(s)}>{sensorLabel(s)}</option>
          ))}
        </select>

        {/* Messgröße-Dropdown – befüllt sich nach Sensorwahl */}
        <select
          className="input"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          disabled={!selSensor || loadingQty}
        >
          <option value="">
            {!selSensor ? '-- zuerst Sensor wählen --' : loadingQty ? 'Lade…' : '-- Messgröße --'}
          </option>
          {quantities.map((q) => (
            <option key={q} value={q}>{q}</option>
          ))}
        </select>

        <input className="input" type="number" placeholder="Min" value={minVal} onChange={(e) => setMinVal(e.target.value)} />
        <input className="input" type="number" placeholder="Max" value={maxVal} onChange={(e) => setMaxVal(e.target.value)} />
        <button className="btn btn-primary" onClick={handleSet} disabled={!selSensor || !quantity}>Setzen</button>
      </div>

      <table className="config-table">
        <thead>
          <tr><th>Sensor</th><th>Messgröße</th><th>Min</th><th>Max</th><th></th></tr>
        </thead>
        <tbody>
          {thresholds.map((t) => (
            <tr key={t.id}>
              <td>{sensorName(t.sensor_uuid)}</td>
              <td>{t.quantity}</td>
              <td>{t.min_value ?? '–'}</td>
              <td>{t.max_value ?? '–'}</td>
              <td>
                <button className="btn btn-danger btn-sm" onClick={() => handleDelete(t.id)}>
                  Loeschen
                </button>
              </td>
            </tr>
          ))}
          {thresholds.length === 0 && (
            <tr><td colSpan={5} className="config-empty">Keine Schwellenwerte vorhanden</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
