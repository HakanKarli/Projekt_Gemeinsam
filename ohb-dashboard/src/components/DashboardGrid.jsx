import { useState, useEffect, useRef } from 'react';
import SensorPanel from './SensorPanel';
import PanelEditModal from './PanelEditModal';
import { useMqttContext } from '../store/useMqttContext';
import { useDashboardLayout } from '../hooks/useDashboardLayout';
import { getSensors, getSensorMetrics, getThresholds, setThreshold as apiSetThreshold } from '../api';
import './DashboardGrid.css';

const REFRESH_MS = 60_000;

export default function DashboardGrid({ dataVersion }) {
  const { discoveredTopics } = useMqttContext();
  const { sortPanels, isHidden, toggleHidden, reorder, reset, hiddenCount } = useDashboardLayout();

  const [panels,        setPanels]        = useState([]);
  const [loading,       setLoading]       = useState(true);
  const [error,         setError]         = useState(null);
  const [editTarget,    setEditTarget]    = useState(null);
  const [editMode,      setEditMode]      = useState(false);

  // Drag & Drop State
  const dragIdRef = useRef(null);
  const [dragId, setDragId] = useState(null);
  const [overId, setOverId] = useState(null);

  // UUIDs der zugeordneten Sensoren – für MQTT-Discovery-Filter
  const assignedUuidsRef = useRef(new Set());

  // ── DB laden ──────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const sensors  = await getSensors();
        const assigned = sensors.filter(s => s.cleanroom_id);

        assignedUuidsRef.current = new Set(assigned.map(s => s.sensor_uuid));

        const results = await Promise.all(
          assigned.map(async sensor => {
            const [quantities, thresholds] = await Promise.all([
              getSensorMetrics(sensor.sensor_uuid).catch(() => []),
              getThresholds(sensor.sensor_uuid).catch(() => []),
            ]);

            return quantities.map(qty => {
              const thresh = thresholds.find(t => t.quantity === qty) ?? null;
              return {
                id:         `${sensor.sensor_uuid}/${qty}`,
                topic:      `${sensor.sensor_uuid}/${qty}`,
                sensorUuid: sensor.sensor_uuid,
                quantity:   qty,
                cleanroom:  sensor.cleanroom_name ?? '',
                minValue:   thresh?.min_value != null ? parseFloat(thresh.min_value) : null,
                maxValue:   thresh?.max_value != null ? parseFloat(thresh.max_value) : null,
              };
            });
          })
        );

        if (!cancelled) {
          setPanels(results.flat());
          setLoading(false);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) { setError(err.message); setLoading(false); }
      }
    }

    load();
    const id = setInterval(load, REFRESH_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [dataVersion]);

  // ── MQTT-Discovery: neue Messgrößen für zugeordnete Sensoren ──────
  useEffect(() => {
    if (!discoveredTopics?.length) return;

    setPanels(prev => {
      const existing = new Set(prev.map(p => p.topic));
      const toAdd = discoveredTopics.filter(t => {
        const uuid = t.slice(0, t.indexOf('/'));
        return assignedUuidsRef.current.has(uuid) && !existing.has(t);
      });
      if (!toAdd.length) return prev;

      return [...prev, ...toAdd.map(t => {
        const slash = t.indexOf('/');
        return {
          id:         t,
          topic:      t,
          sensorUuid: t.slice(0, slash),
          quantity:   t.slice(slash + 1),
          cleanroom:  '',
          minValue:   null,
          maxValue:   null,
        };
      })];
    });
  }, [discoveredTopics]);

  // ── Bearbeiten (Schwellenwerte) ───────────────────────────────────
  async function handleSave(cfg) {
    try {
      await apiSetThreshold(cfg.sensorUuid, cfg.quantity, cfg.minValue, cfg.maxValue);
    } catch { /* Optimistisch aktualisieren auch wenn API-Aufruf scheitert */ }

    setPanels(prev =>
      prev.map(p => p.id === cfg.id ? { ...p, minValue: cfg.minValue, maxValue: cfg.maxValue } : p)
    );
    setEditTarget(null);
  }

  // ── Drag & Drop ───────────────────────────────────────────────────
  const handleDragStart = (e, id) => {
    dragIdRef.current = id;
    setDragId(id);
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', id); } catch { /* Safari */ }
  };
  const handleDragOver = (e, id) => {
    if (!editMode) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (id !== overId) setOverId(id);
  };
  const handleDrop = (e, id, orderedIds) => {
    e.preventDefault();
    const from = dragIdRef.current;
    if (from && from !== id) reorder(orderedIds, from, id);
    dragIdRef.current = null;
    setDragId(null);
    setOverId(null);
  };
  const handleDragEnd = () => {
    dragIdRef.current = null;
    setDragId(null);
    setOverId(null);
  };

  // ── Render ────────────────────────────────────────────────────────
  if (loading) return (
    <div className="dg-status">
      <div className="sp-spinner" />
      <span>Lade zugeordnete Sensoren…</span>
    </div>
  );

  if (error) return (
    <div className="dg-status dg-error">
      <span>Verbindung zum Backend fehlgeschlagen: {error}</span>
    </div>
  );

  if (panels.length === 0) return (
    <div className="dg-status">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" opacity=".4">
        <path d="M12 2a10 10 0 1 0 0 20A10 10 0 0 0 12 2z" /><path d="M12 8v4m0 4h.01" />
      </svg>
      <span>
        Keine Sensoren einem Reinraum zugeordnet.<br />
        <small>Konfiguration → Sensoren → Sensor einem Raum zuordnen.</small>
      </span>
    </div>
  );

  const ordered     = sortPanels(panels);
  const orderedIds  = ordered.map(p => p.id);
  const visible     = editMode ? ordered : ordered.filter(p => !isHidden(p.id));

  return (
    <>
      {/* ── Toolbar ── */}
      <div className="dg-toolbar">
        <div className="dg-toolbar-info">
          <h2 className="dg-title">Übersicht</h2>
          <span className="pill">{visible.length} Kanäle</span>
          {hiddenCount > 0 && !editMode && (
            <span className="pill dg-pill-muted">{hiddenCount} ausgeblendet</span>
          )}
        </div>

        <div className="dg-toolbar-actions">
          {editMode && (
            <>
              <span className="dg-edit-hint">Ziehen zum Sortieren · Auge zum Aus-/Einblenden</span>
              <button className="btn btn-ghost btn-sm dg-reset-btn" onClick={reset} title="Reihenfolge & Sichtbarkeit zurücksetzen">
                Zurücksetzen
              </button>
            </>
          )}
          <button
            className={`btn btn-sm ${editMode ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => { setEditMode(v => !v); handleDragEnd(); }}
          >
            {editMode ? (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                Fertig
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" /></svg>
                Layout bearbeiten
              </>
            )}
          </button>
        </div>
      </div>

      {/* ── Grid ── */}
      <div className={`dashboard-grid${editMode ? ' dashboard-grid--edit' : ''}`}>
        {visible.map(panel => {
          const hidden = isHidden(panel.id);
          return (
            <div
              key={panel.id}
              className={
                'dg-cell'
                + (editMode ? ' dg-cell--edit' : '')
                + (dragId === panel.id ? ' dg-cell--dragging' : '')
                + (overId === panel.id && dragId !== panel.id ? ' dg-cell--over' : '')
                + (hidden ? ' dg-cell--hidden' : '')
              }
              draggable={editMode}
              onDragStart={(e) => handleDragStart(e, panel.id)}
              onDragOver={(e) => handleDragOver(e, panel.id)}
              onDrop={(e) => handleDrop(e, panel.id, orderedIds)}
              onDragEnd={handleDragEnd}
            >
              {editMode && (
                <div className="dg-cell-bar">
                  <span className="dg-grip" title="Ziehen zum Verschieben">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>
                  </span>
                  <button
                    className="dg-eye"
                    onClick={() => toggleHidden(panel.id)}
                    title={hidden ? 'Einblenden' : 'Ausblenden'}
                  >
                    {hidden
                      ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" /></svg>
                      : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
                    }
                  </button>
                </div>
              )}

              <SensorPanel
                initialTopic={panel.topic}
                sensorUuid={panel.sensorUuid}
                quantity={panel.quantity}
                cleanroom={panel.cleanroom}
                minValue={panel.minValue}
                maxValue={panel.maxValue}
                onEdit={() => setEditTarget(panel)}
                editing={editMode}
              />
            </div>
          );
        })}
      </div>

      {editTarget !== null && (
        <PanelEditModal
          panel={editTarget}
          onSave={handleSave}
          onClose={() => setEditTarget(null)}
        />
      )}
    </>
  );
}
