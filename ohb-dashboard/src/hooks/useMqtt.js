import { useState, useEffect, useRef, useCallback } from 'react';
import mqtt from 'mqtt';

const MAX_POINTS    = 60;
const SENSORS_TOPIC = 'sensors/#';

export function useMqtt(brokerUrl, enabled) {
    const clientRef = useRef(null);
    const [connected, setConnected] = useState(false);
    const [error,     setError]     = useState(null);

    const messagesRef      = useRef({});
    const listenersRef     = useRef(new Map());
    const dirtyTopicsRef   = useRef(new Set());
    const rafRef           = useRef(null);

    // Track unique virtual topics and unique sensor UUIDs
    const discoveredTopicsSetRef  = useRef(new Set());
    const discoveredSensorsSetRef = useRef(new Set());
    const [discoveredTopics,  setDiscoveredTopics]  = useState([]);
    const [discoveredSensors, setDiscoveredSensors] = useState([]);

    const flushListeners = useCallback(() => {
        rafRef.current = null;
        const dirty = dirtyTopicsRef.current;
        if (dirty.size === 0) return;
        const topics = [...dirty];
        dirty.clear();
        for (const t of topics) {
            const cbs = listenersRef.current.get(t);
            if (cbs) {
                const data = messagesRef.current[t] ?? [];
                cbs.forEach(cb => cb(data));
            }
        }
    }, []);

    useEffect(() => {
        if (!enabled || !brokerUrl) return;

        const client = mqtt.connect(brokerUrl, {
            protocolVersion: 4,
            keepalive: 30,
            reconnectPeriod: 3000,
            connectTimeout: 10000,
            clientId: `ohb-dashboard-${Math.random().toString(16).slice(2, 8)}`,
        });
        clientRef.current = client;

        client.on('connect', () => { setConnected(true); setError(null); client.subscribe(SENSORS_TOPIC); });
        client.on('error',   (err) => setError(err.message));
        client.on('close',   () => setConnected(false));

        client.on('message', (_topic, payload) => {
            try {
                const msg = JSON.parse(payload.toString());
                const { id: sensor_uuid, timestamp, measurements } = msg;
                if (!sensor_uuid || !Array.isArray(measurements)) return;

                // Track unique sensor UUID
                if (!discoveredSensorsSetRef.current.has(sensor_uuid)) {
                    discoveredSensorsSetRef.current.add(sensor_uuid);
                    setDiscoveredSensors([...discoveredSensorsSetRef.current]);
                }

                for (const meas of measurements) {
                    const virtualTopic = `${sensor_uuid}/${meas.quantity}`;
                    const point = { timestamp, value: meas.value, unit: meas.unit };

                    const history = messagesRef.current[virtualTopic] ?? [];
                    messagesRef.current[virtualTopic] = history.length >= MAX_POINTS
                        ? [...history.slice(-(MAX_POINTS - 1)), point]
                        : [...history, point];
                    dirtyTopicsRef.current.add(virtualTopic);

                    if (!discoveredTopicsSetRef.current.has(virtualTopic)) {
                        discoveredTopicsSetRef.current.add(virtualTopic);
                        setDiscoveredTopics([...discoveredTopicsSetRef.current]);
                    }
                }

                if (!rafRef.current) {
                    rafRef.current = requestAnimationFrame(flushListeners);
                }
            } catch { /* ignore malformed */ }
        });

        return () => {
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
            client.end(true);
            setConnected(false);
            clientRef.current = null;
        };
    }, [brokerUrl, enabled, flushListeners]);

    const subscribe   = useCallback(() => {}, []);
    const unsubscribe = useCallback((topic) => { delete messagesRef.current[topic]; }, []);

    const addTopicListener = useCallback((topic, cb) => {
        const map = listenersRef.current;
        if (!map.has(topic)) map.set(topic, new Set());
        map.get(topic).add(cb);
        const existing = messagesRef.current[topic];
        if (existing?.length) cb(existing);
    }, []);

    const removeTopicListener = useCallback((topic, cb) => {
        const set = listenersRef.current.get(topic);
        if (set) { set.delete(cb); if (set.size === 0) listenersRef.current.delete(topic); }
    }, []);

    return { connected, error, subscribe, unsubscribe, addTopicListener, removeTopicListener, discoveredTopics, discoveredSensors };
}
