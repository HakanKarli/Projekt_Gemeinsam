import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { RegistryContext } from './contexts';
import { getSensors, getCleanrooms, renameSensor } from '../api';

/**
 * Stammdaten: Sensoren und Reinräume.
 *
 * EIN Abruf für die gesamte Anwendung. Zuvor holten MqttContext (alle 30 s),
 * Sidebar, ConfigPanel, HistoryView und DashboardGrid dieselbe Sensorliste
 * unabhängig voneinander — dieselben Daten auf fünf Wegen, ohne gemeinsamen Stand.
 *
 * `refresh()` ersetzt zusätzlich das bisherige Durchreichen eines `dataVersion`-
 * Zählers durch die Komponentenhierarchie.
 */



const LS_NAMES_KEY = 'ohb-sensor-names';
const REFRESH_MS = 30_000;

/** Zuletzt bekannte Namen — hält die Anzeige lesbar, wenn das Backend kurz fehlt. */
function loadCachedNames() {
  try {
    return JSON.parse(localStorage.getItem(LS_NAMES_KEY)) ?? {};
  } catch {
    return {};
  }
}

export function RegistryProvider({ children }) {
  const [sensors, setSensors] = useState([]);
  const [cleanrooms, setCleanrooms] = useState([]);
  const [cachedNames, setCachedNames] = useState(loadCachedNames);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [version, setVersion] = useState(0);

  const requestIdRef = useRef(0);

  const load = useCallback(async () => {
    const current = ++requestIdRef.current;
    try {
      const [sensorRows, roomRows] = await Promise.all([getSensors(), getCleanrooms()]);
      if (current !== requestIdRef.current) return;

      setSensors(sensorRows);
      setCleanrooms(roomRows);
      setError(null);

      // Namen zwischenspeichern, damit ein kurzer Backend-Ausfall keine UUIDs zeigt.
      setCachedNames((previous) => {
        const next = { ...previous };
        for (const sensor of sensorRows) {
          if (sensor.name && sensor.name !== sensor.sensor_uuid) next[sensor.sensor_uuid] = sensor.name;
        }
        localStorage.setItem(LS_NAMES_KEY, JSON.stringify(next));
        return next;
      });
    } catch (err) {
      if (current !== requestIdRef.current) return;
      setError(err.message);
    } finally {
      if (current === requestIdRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  /** Nach schreibenden Aktionen aufrufen — lädt neu und stößt abhängige Ansichten an. */
  const refresh = useCallback(async () => {
    await load();
    setVersion((value) => value + 1);
  }, [load]);

  /** Optimistisch lokal umbenennen, dann speichern. */
  const updateSensorName = useCallback(
    async (sensorUuid, name) => {
      setCachedNames((previous) => {
        const next = { ...previous, [sensorUuid]: name };
        localStorage.setItem(LS_NAMES_KEY, JSON.stringify(next));
        return next;
      });
      await renameSensor(sensorUuid, name);
      await refresh();
    },
    [refresh],
  );

  /** Anzeigename eines Sensors, mit Rückfall auf die zwischengespeicherte Fassung. */
  const nameOf = useCallback(
    (sensorUuid) => {
      const known = sensors.find((sensor) => sensor.sensor_uuid === sensorUuid)?.name;
      if (known && known !== sensorUuid) return known;
      return cachedNames[sensorUuid] ?? sensorUuid;
    },
    [sensors, cachedNames],
  );

  const value = useMemo(
    () => ({ sensors, cleanrooms, loading, error, version, refresh, updateSensorName, nameOf }),
    [sensors, cleanrooms, loading, error, version, refresh, updateSensorName, nameOf],
  );

  return <RegistryContext.Provider value={value}>{children}</RegistryContext.Provider>;
}

