/**
 * Vertrag der MQTT-Nachricht.
 *
 * Die Prüfung an dieser Stelle trennt zwei Fehlerarten, die im Ingest völlig
 * unterschiedlich behandelt werden müssen:
 *
 *   dauerhaft (Payload passt nicht zum Schema) -> bestätigen, sonst Endlosschleife
 *   vorübergehend (Datenbank nicht erreichbar) -> NICHT bestätigen, erneut zustellen
 *
 * Ohne diese Unterscheidung würde eine einzige kaputte Nachricht den gesamten
 * Ingest dauerhaft blockieren.
 */

const { z } = require('zod');
const { uuid, quantity } = require('../domain/schemas/common');

const MeasurementSchema = z.object({
  quantity: quantity(),
  unit: z.string().max(32).default(''),
  // Zahlen kommen gelegentlich als Zeichenkette an; coerce ist hier Absicht.
  value: z.coerce.number().finite(),
});

const SensorMessageSchema = z.object({
  id: uuid(),
  gateway_id: z.string().max(128).nullish(),
  name: z.string().max(200).nullish(),
  // 0 = zyklisch, 1 = event-getrieben
  event_driven: z.coerce.number().int().min(0).max(1).default(0),
  timestamp: z.coerce.date(),
  measurements: z.array(MeasurementSchema).min(1).max(200),
});

/** @typedef {z.infer<typeof SensorMessageSchema>} SensorMessage */

module.exports = { SensorMessageSchema, MeasurementSchema };
