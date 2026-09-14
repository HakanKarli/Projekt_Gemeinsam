import { useState, useEffect, useCallback, useRef } from 'react';
import { getPanels } from '../api';

/**
 * Lädt das Panel-Manifest.
 *
 * Ersetzt die zuvor in DashboardGrid und RoomView doppelt vorhandene Logik, die je
 * Sensor zwei zusätzliche Anfragen stellte (1 + 2N). Jetzt genügt eine Anfrage —
 * unabhängig von der Zahl der Sensoren.
 *
 * @param {object} [options]
 * @param {number} [options.cleanroomId]  auf einen Reinraum einschränken
 * @param {number} [options.refreshMs]    Intervall für Stammdaten-Änderungen
 * @param {number} [options.version]      erzwingt sofortiges Neuladen bei Änderung
 */
export function useSensorPanels({ cleanroomId, refreshMs = 60_000, version = 0 } = {}) {
  const [panels, setPanels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Verhindert, dass eine verspätete Antwort einen neueren Zustand überschreibt.
  const requestIdRef = useRef(0);

  const load = useCallback(async () => {
    const current = ++requestIdRef.current;
    try {
      const rows = await getPanels(cleanroomId);
      if (current !== requestIdRef.current) return;

      setPanels(
        rows.map((row) => ({
          ...row,
          // Der Kanal ist gleichzeitig das virtuelle MQTT-Topic, unter dem die
          // Live-Werte im Browser ankommen.
          topic: row.id,
          minValue: row.min_value,
          maxValue: row.max_value,
        })),
      );
      setError(null);
    } catch (err) {
      if (current !== requestIdRef.current) return;
      setError(err.message);
    } finally {
      if (current === requestIdRef.current) setLoading(false);
    }
  }, [cleanroomId]);

  useEffect(() => {
    setLoading(true);
    load();

    if (!refreshMs) return undefined;
    const timer = setInterval(load, refreshMs);
    return () => clearInterval(timer);
  }, [load, refreshMs, version]);

  return { panels, loading, error, reload: load };
}
