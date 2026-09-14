import { useState, useEffect, useRef } from 'react';
import { getSensorData } from '../api';

/**
 * Pollt /api/sensordata für einen Sensor+Quantity alle `intervalMs` ms.
 * Beim Mount sofortiger Fetch der letzten `windowHours` Stunden.
 * Unmount → Interval gestoppt automatisch.
 *
 * @returns {{ data: Array<{timestamp, value, unit}>, loading: boolean, error: string|null }}
 */
export function useSensorPoller(sensorUuid, quantity, {
  intervalMs  = 20_000,
  windowHours = 6,
} = {}) {
  const [data,    setData]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  const aliveRef = useRef(true);

  useEffect(() => {
    if (!sensorUuid || !quantity) return;

    aliveRef.current = true;

    async function fetch() {
      const now  = new Date();
      const from = new Date(now.getTime() - windowHours * 60 * 60 * 1000).toISOString();
      const to   = now.toISOString();
      try {
        const rows = await getSensorData(sensorUuid, quantity, from, to, 5000);
        if (!aliveRef.current) return;
        // Normalisiert DB-Format { time, value, unit } → { timestamp, value, unit }
        setData(rows.map(r => ({ timestamp: r.time, value: r.value, unit: r.unit })));
        setError(null);
      } catch (err) {
        if (!aliveRef.current) return;
        setError(err.message);
      } finally {
        if (aliveRef.current) setLoading(false);
      }
    }

    setLoading(true);
    fetch();

    const id = setInterval(fetch, intervalMs);
    return () => {
      aliveRef.current = false;
      clearInterval(id);
    };
  }, [sensorUuid, quantity, intervalMs, windowHours]);

  return { data, loading, error };
}
