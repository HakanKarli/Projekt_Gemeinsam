import { useContext } from 'react';
import { MqttContext } from './contexts';

/**
 * Zugriff auf die MQTT-Verbindung.
 *
 * Bewusst in einer eigenen Datei: React Fast Refresh arbeitet nur zuverlässig,
 * wenn ein Modul ausschließlich Komponenten exportiert.
 */
export function useMqttContext() {
  const context = useContext(MqttContext);
  if (!context) throw new Error('useMqttContext muss innerhalb von <MqttProvider> verwendet werden');
  return context;
}

/**
 * Broker-Adresse aus der aktuellen Seite ableiten.
 *
 * Hinter nginx erreicht der Browser den Broker unter demselben Host über /mqtt.
 * Das ersetzt die fest verdrahtete Adresse `ws://localhost:9001` und funktioniert
 * damit auch über TLS und aus dem übrigen Netz.
 */
export function defaultBrokerUrl() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/mqtt`;
}
