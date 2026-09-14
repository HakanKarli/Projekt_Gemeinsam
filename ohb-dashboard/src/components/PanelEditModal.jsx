import { useState } from 'react';
import { useMqttContext } from '../store/useMqttContext';
import './PanelEditModal.css';

export default function PanelEditModal({ panel, onSave, onClose }) {
  const { sensorNames, updateSensorName } = useMqttContext();

  const uuid     = panel?.sensorUuid ?? '';
  const quantity = panel?.quantity   ?? '';
  const unit     = panel?.unit       ?? '';   // optional, wenn schon bekannt

  const [sensorName, setSensorName] = useState(sensorNames?.[uuid] || '');
  const [minValue,   setMinValue]   = useState(panel?.minValue != null ? String(panel.minValue) : '');
  const [maxValue,   setMaxValue]   = useState(panel?.maxValue != null ? String(panel.maxValue) : '');
  const [saving,     setSaving]     = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    const name = sensorName.trim();
    if (name && uuid) await updateSensorName(uuid, name);
    onSave({
      ...panel,
      minValue: minValue !== '' ? parseFloat(minValue) : null,
      maxValue: maxValue !== '' ? parseFloat(maxValue) : null,
    });
  }

  return (
    <div className="pem-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="pem-modal glass-card">
        <div className="pem-header">
          <h3>Panel konfigurieren</h3>
          <button className="btn btn-ghost pem-close" onClick={onClose}>✕</button>
        </div>

        <form onSubmit={handleSubmit} className="pem-form">

          <label>
            Sensor-Name
            <input
              className="pem-input"
              value={sensorName}
              onChange={e => setSensorName(e.target.value)}
              placeholder="z.B. Temperatursensor Eingang"
              autoFocus
            />
          </label>

          {/* Messgröße + Reinraum – nur Anzeige */}
          <div className="pem-info-row">
            <div className="pem-info-badge">
              <span className="pem-info-label">Messgröße</span>
              <span className="pem-info-value">{quantity || '–'}</span>
            </div>
            {panel?.cleanroom && (
              <div className="pem-info-badge">
                <span className="pem-info-label">Reinraum</span>
                <span className="pem-info-value">{panel.cleanroom}</span>
              </div>
            )}
          </div>

          {/* Schwellenwerte */}
          <div className="pem-row">
            <label>
              Mindestwert{unit ? ` (${unit})` : ''}
              <input
                className="pem-input"
                type="number"
                value={minValue}
                onChange={e => setMinValue(e.target.value)}
                placeholder="–"
                step="any"
              />
            </label>
            <label>
              Maximalwert{unit ? ` (${unit})` : ''}
              <input
                className="pem-input"
                type="number"
                value={maxValue}
                onChange={e => setMaxValue(e.target.value)}
                placeholder="–"
                step="any"
              />
            </label>
          </div>

          <div className="pem-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Abbrechen</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Wird gespeichert…' : 'Speichern'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
