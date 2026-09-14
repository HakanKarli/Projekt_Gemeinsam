// =============================================================
// Hilfsfunktionen zur Darstellung von Sensoren in Dropdowns.
// Ziel: möglichst viele Infos auf einen Blick – Name, gemessene
// Größen und (Kurz-)UUID – mit allen Details im Hover-Tooltip.
// =============================================================

// Menschenlesbare Labels für Messgrößen (Fallback: der rohe Code).
const QUANTITY_LABELS = {
  temperature: 'Temperatur',
  humidity:    'Luftfeuchte',
  pressure:    'Druck',
  eco2:        'eCO₂',
  tvoc:        'TVOC',
  wind_speed:  'Strömung',
  pm2_5:       'PM2.5',
};

export const quantityLabel = (q) => QUANTITY_LABELS[q] ?? q;

// "temperature","humidity" -> "Temperatur, Luftfeuchte"
export const quantitiesText = (quantities = []) =>
  quantities.map(quantityLabel).join(', ');

// Kurzform der UUID, z.B. "fa8d0dc0"
export const shortUuid = (uuid = '') => (uuid ? uuid.slice(0, 8) : '');

/**
 * Sichtbares Dropdown-Label, z.B.:
 *   "T5V7 · Temperatur, Luftfeuchte · fa8d0dc0… · Reinraum 221"
 * Optionen erlauben das Ein-/Ausblenden von UUID und Raum.
 */
export function sensorLabel(s, { withId = true, withRoom = true } = {}) {
  const parts = [s.name || s.sensor_uuid];

  if (s.quantities?.length) parts.push(quantitiesText(s.quantities));
  if (withId && s.sensor_uuid) parts.push(`${shortUuid(s.sensor_uuid)}…`);
  if (withRoom && s.cleanroom_name) parts.push(s.cleanroom_name);

  return parts.join(' · ');
}

/**
 * Vollständige Info für das title-Attribut (Tooltip beim Hovern),
 * inklusive kompletter UUID.
 */
export function sensorTitle(s) {
  const lines = [
    `Name: ${s.name || '–'}`,
    `UUID: ${s.sensor_uuid}`,
  ];
  if (s.quantities?.length) lines.push(`Misst: ${quantitiesText(s.quantities)}`);
  if (s.gateway_id)         lines.push(`Gateway: ${s.gateway_id}`);
  if (s.cleanroom_name)     lines.push(`Reinraum: ${s.cleanroom_name}`);
  lines.push(`Modus: ${s.event_driven ? 'event-getrieben' : 'zyklisch'}`);
  return lines.join('\n');
}
