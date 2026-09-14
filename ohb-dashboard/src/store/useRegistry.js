import { useContext } from 'react';
import { RegistryContext } from './contexts';

/** Zugriff auf die gemeinsamen Stammdaten (Sensoren, Reinräume). */
export function useRegistry() {
  const context = useContext(RegistryContext);
  if (!context) throw new Error('useRegistry muss innerhalb von <RegistryProvider> verwendet werden');
  return context;
}
