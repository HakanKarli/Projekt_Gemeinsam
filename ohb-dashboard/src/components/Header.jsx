import React from 'react';
import { useMqttContext } from '../store/useMqttContext';
import './Header.css';

export default function Header({ onSettingsOpen, onReportOpen, onAlertOpen }) {
    const { connected, error } = useMqttContext();

    return (
        <header className="header">
            <div className="header-left">
                <div className="header-logo">
                    <img
                        src="/ohb-logo.png"
                        alt="OHB Logo"
                        className="header-logo-img"
                    />
                    <span className="header-brand-sub">Sensor Dashboard</span>
                </div>
            </div>

            <div className="header-right">
                <div className={`status-badge ${connected ? 'status-ok' : error ? 'status-err' : 'status-off'}`}>
                    <span className="status-dot" />
                    <span>{connected ? 'Connected' : error ? 'Error' : 'Disconnected'}</span>
                </div>
                <button
                    className="btn btn-ghost btn-alert"
                    onClick={onAlertOpen}
                    title="Schwellenwert-Alarme"
                >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" />
                    </svg>
                    Alarme
                </button>
                <button
                    className="btn btn-ghost"
                    id="btn-export-pdf"
                    onClick={onReportOpen}
                    title="Sensor-Report erstellen"
                >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="12" y1="18" x2="12" y2="12" /><line x1="9" y1="15" x2="15" y2="15" />
                    </svg>
                    Export PDF
                </button>
                <button className="btn btn-ghost" id="btn-settings" onClick={onSettingsOpen}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                    </svg>
                    MQTT
                </button>
            </div>
        </header>
    );
}
