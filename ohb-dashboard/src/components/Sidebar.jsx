import React, { useState, useEffect } from 'react';
import { getCleanrooms, getSensors } from '../api';
import './Sidebar.css';

export default function Sidebar({ open, onToggle, onSelectRoom, selectedRoom, onConfigOpen, historyActive, onSelectHistory, dataVersion }) {
  const [rooms, setRooms] = useState([]);
  const [sensorCounts, setSensorCounts] = useState({});

  useEffect(() => {
    loadData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataVersion]);

  async function loadData() {
    try {
      const [roomData, sensorData] = await Promise.all([getCleanrooms(), getSensors()]);
      setRooms(roomData);
      // Sensoren pro Raum zaehlen
      const counts = {};
      for (const s of sensorData) {
        if (s.cleanroom_id) {
          counts[s.cleanroom_id] = (counts[s.cleanroom_id] || 0) + 1;
        }
      }
      setSensorCounts(counts);
    } catch {
      // ignore
    }
  }

  return (
    <>
      {/* Toggle-Button (immer sichtbar) */}
      <button className="sidebar-toggle" onClick={onToggle} title={open ? 'Sidebar schliessen' : 'Sidebar oeffnen'}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          {open
            ? <><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></>
            : <><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></>
          }
        </svg>
      </button>

      {/* Sidebar Panel */}
      <aside className={`sidebar ${open ? 'sidebar-open' : ''}`}>
        <div className="sidebar-header">
          <span className="sidebar-title">Navigation</span>
        </div>

        {/* Uebersicht */}
        <button
          className={`sidebar-item ${!selectedRoom && !historyActive ? 'active' : ''}`}
          onClick={() => onSelectRoom(null)}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" />
          </svg>
          <span>Uebersicht</span>
        </button>

        {/* Verlauf (Historie) */}
        <button
          className={`sidebar-item ${historyActive ? 'active' : ''}`}
          onClick={onSelectHistory}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
          </svg>
          <span>Verlauf</span>
        </button>

        {/* Reinraeume */}
        <div className="sidebar-section-label">Reinraeume</div>

        {rooms.length === 0 && (
          <div className="sidebar-empty">Keine Reinraeume konfiguriert</div>
        )}

        {rooms.map((room) => (
          <button
            key={room.id}
            className={`sidebar-item ${selectedRoom?.id === room.id ? 'active' : ''}`}
            onClick={() => onSelectRoom(room)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" />
            </svg>
            <span className="sidebar-item-label">{room.name}</span>
            {sensorCounts[room.id] && (
              <span className="sidebar-badge">{sensorCounts[room.id]}</span>
            )}
          </button>
        ))}

        {/* Spacer */}
        <div className="sidebar-spacer" />

        {/* Konfiguration */}
        <div className="sidebar-footer">
          <button className="sidebar-item sidebar-config" onClick={onConfigOpen}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            <span>Konfiguration</span>
          </button>
        </div>
      </aside>
    </>
  );
}
