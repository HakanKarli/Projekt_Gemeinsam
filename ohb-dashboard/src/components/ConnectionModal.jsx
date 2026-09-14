import React, { useState } from 'react';
import { useMqttContext } from '../store/MqttContext';

export default function ConnectionModal({ onClose }) {
    const { brokerUrl, setBrokerUrl, enabled, setEnabled, connected, error } = useMqttContext();
    const [draft, setDraft] = useState(brokerUrl);

    const handleApply = () => {
        setBrokerUrl(draft);
        setEnabled(true);
        onClose();
    };

    const handleDisconnect = () => {
        setEnabled(false);
        onClose();
    };

    return (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
            <div className="modal-box glass-card">
                <div className="modal-header">
                    <span className="modal-title">MQTT Connection</span>
                    <button className="modal-close" onClick={onClose}>✕</button>
                </div>

                <div className="modal-field">
                    <label className="modal-label">Broker WebSocket URL</label>
                    <input
                        className="input"
                        id="input-broker-url"
                        placeholder="ws://192.168.1.10:9001"
                        value={draft}
                        onChange={e => setDraft(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleApply()}
                    />
                    <span style={{ fontSize: 11, color: 'var(--text-sub)' }}>
                        Format: <code style={{ color: 'var(--accent)' }}>ws://&lt;host&gt;:&lt;port&gt;</code>&nbsp;
                        (Mosquitto default WebSocket port: 9001)
                    </span>
                </div>

                {error && (
                    <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#ef4444' }}>
                        ⚠ {error}
                    </div>
                )}

                <div className="modal-actions">
                    {enabled && (
                        <button className="btn btn-danger" id="btn-disconnect" onClick={handleDisconnect}>
                            Disconnect
                        </button>
                    )}
                    <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
                    <button className="btn btn-primary" id="btn-connect" onClick={handleApply}>
                        {enabled ? 'Reconnect' : 'Connect'}
                    </button>
                </div>
            </div>
        </div>
    );
}
