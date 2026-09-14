/**
 * Bausteine, die von mehreren Schemata geteilt werden.
 *
 * Eine Definition je Begriff — dieselbe UUID-Prüfung gilt für den MQTT-Vertrag, die
 * Abfrageparameter der API und die OpenAPI-Beschreibung. Wo dieselbe Regel mehrfach
 * geschrieben wird, laufen die Kopien früher oder später auseinander.
 */

const { z } = require('zod');

/**
 * Sensor-Kennung im Format 8-4-4-4-12.
 *
 * BEWUSST `guid()` und nicht `uuid()`: Zod prüft mit `uuid()` die Versions- und
 * Variantenbits nach RFC 4122. PostgreSQL akzeptiert im Typ `uuid` dagegen jede
 * 32-stellige Hexadezimalfolge — und die Feldgeräte vergeben strukturierte
 * Kennungen wie `a1b2c3d4-0001-0001-0001-000000000001`, die RFC 4122 verletzen.
 * Mit `uuid()` würde die Anwendung sämtliche real vorhandenen Sensoren abweisen.
 */
const uuid = () =>
  z.guid().describe('Sensor-Kennung im Format 8-4-4-4-12');

/** Bezeichner einer Messgröße, z.B. "temperature". */
const quantity = () => z.string().min(1).max(64).describe('Messgröße');

/** Zeitpunkt als ISO-8601-Zeichenkette. */
const isoDateTime = () => z.iso.datetime({ offset: true }).describe('Zeitpunkt nach ISO 8601');

/** Positive Ganzzahl aus einem Pfadsegment. */
const idParam = () => z.coerce.number().int().positive();

module.exports = { uuid, quantity, isoDateTime, idParam };
