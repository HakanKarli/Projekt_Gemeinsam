import { createContext } from 'react';

/**
 * Context-Objekte getrennt von den Providern.
 *
 * React Fast Refresh arbeitet nur zuverlässig, wenn ein Modul ausschließlich
 * Komponenten exportiert. Ohne diese Trennung verliert jede Änderung an einem
 * Provider den Zustand der gesamten Anwendung.
 */

export const MqttContext = createContext(null);
export const RegistryContext = createContext(null);
