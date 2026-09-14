import React, { useState, useEffect } from 'react';
import { getSensors, getSensorMetrics, getThresholds } from '../api';
import SensorPanel from './SensorPanel';
import './RoomView.css';

export default function RoomView({ room }) {
  const [panels, setPanels] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    async function load() {
      try {
        const allSensors = await getSensors();
        const roomSensors = allSensors.filter(s => s.cleanroom_id === room.id);

        const results = await Promise.all(
          roomSensors.map(async (sensor) => {
            const [quantities, thresholds] = await Promise.all([
              getSensorMetrics(sensor.sensor_uuid),
              getThresholds(sensor.sensor_uuid).catch(() => []),
            ]);
            return quantities.map(quantity => {
              const thresh = thresholds.find(t => t.quantity === quantity) ?? null;
              return {
                key:        `${sensor.sensor_uuid}/${quantity}`,
                topic:      `${sensor.sensor_uuid}/${quantity}`,
                sensorUuid: sensor.sensor_uuid,
                quantity,
                cleanroom:  room.name,
                minValue:   thresh?.min_value != null ? parseFloat(thresh.min_value) : null,
                maxValue:   thresh?.max_value != null ? parseFloat(thresh.max_value) : null,
              };
            });
          })
        );

        if (!cancelled) setPanels(results.flat());
      } catch {
        if (!cancelled) setPanels([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [room.id]);

  if (loading) {
    return (
      <div className="room-loading">
        <div className="sp-spinner" />
        <span>Lade Sensoren...</span>
      </div>
    );
  }

  if (panels.length === 0) {
    return (
      <div className="room-empty">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" opacity=".3">
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" />
        </svg>
        <span>Keine Sensoren in <strong>{room.name}</strong> zugewiesen.</span>
        <span className="room-empty-hint">Sensoren koennen ueber die Konfiguration zugewiesen werden.</span>
      </div>
    );
  }

  return (
    <div className="room-view">
      <div className="room-view-header">
        <h2 className="room-view-title">{room.name}</h2>
        <span className="room-view-count">{panels.length} Kanal{panels.length !== 1 ? 'e' : ''}</span>
      </div>
      <div className="dashboard-grid">
        {panels.map((p) => (
          <SensorPanel
            key={p.key}
            initialTopic={p.topic}
            sensorUuid={p.sensorUuid}
            quantity={p.quantity}
            cleanroom={p.cleanroom}
            minValue={p.minValue}
            maxValue={p.maxValue}
          />
        ))}
      </div>
    </div>
  );
}
