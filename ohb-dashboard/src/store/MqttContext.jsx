import { useState, useEffect, useCallback, useMemo } from 'react';
import { MqttContext } from './contexts';
import { useMqtt } from '../hooks/useMqtt';
import { getSensors, renameSensor } from '../api';

const LS_NAMES_KEY = 'ohb-sensor-names';

function loadLocalNames() {
    try { return JSON.parse(localStorage.getItem(LS_NAMES_KEY)) ?? {}; }
    catch { return {}; }
}

function saveLocalNames(map) {
    localStorage.setItem(LS_NAMES_KEY, JSON.stringify(map));
}

export function MqttProvider({ children }) {
    const [brokerUrl, setBrokerUrl] = useState('ws://localhost:9001');
    const [enabled,   setEnabled]   = useState(true);

    // Sensor-Namen: aus localStorage initialisieren, dann mit DB zusammenführen
    const [sensorNames, setSensorNames] = useState(() => loadLocalNames());

    const mqtt = useMqtt(brokerUrl, enabled);

    // DB-Namen laden und alle 30 s aktualisieren
    useEffect(() => {
        let alive = true;
        async function load() {
            try {
                const list = await getSensors();
                if (!alive) return;
                setSensorNames(prev => {
                    const next = { ...prev };
                    for (const s of list) {
                        // DB-Name überschreibt nur wenn er kein UUID-Fallback ist
                        if (s.name && s.name !== s.sensor_uuid) {
                            next[s.sensor_uuid] = s.name;
                        } else if (!next[s.sensor_uuid]) {
                            next[s.sensor_uuid] = s.sensor_uuid;
                        }
                    }
                    saveLocalNames(next);
                    return next;
                });
            } catch { /* Backend offline – lokale Namen behalten */ }
        }
        load();
        const id = setInterval(load, 30_000);
        return () => { alive = false; clearInterval(id); };
    }, []);

    // Sensor umbenennen – optimistisch lokal aktualisieren, dann API
    const updateSensorName = useCallback(async (uuid, name) => {
        setSensorNames(prev => {
            const next = { ...prev, [uuid]: name };
            saveLocalNames(next);
            return next;
        });
        try { await renameSensor(uuid, name); } catch { /* ignore – lokaler Name bleibt */ }
    }, []);

    const value = useMemo(() => ({
        ...mqtt,
        brokerUrl,
        setBrokerUrl,
        enabled,
        setEnabled,
        sensorNames,
        updateSensorName,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }), [mqtt.connected, mqtt.error, mqtt.discoveredTopics, mqtt.discoveredSensors, brokerUrl, enabled, sensorNames]);

    return (
        <MqttContext.Provider value={value}>
            {children}
        </MqttContext.Provider>
    );
}
