/**
 * Gemeinsame Typbeschreibung des Alarm-Ereignisses.
 *
 * Quelle ist der Datenbank-Trigger `check_threshold_violation()`; die Feldnamen sind
 * daher an das Schema gebunden und dürfen nicht abweichen — genau diese Abweichung
 * war die Ursache der "undefined"-Push-Nachrichten.
 *
 * @typedef {object} ViolationEvent
 * @property {number}      id              ID in threshold_violations
 * @property {string}      sensor_uuid
 * @property {string|null} [sensor_name]
 * @property {number|null} cleanroom_id
 * @property {string|null} [cleanroom_name]
 * @property {string}      quantity
 * @property {'below_min'|'above_max'} violation_type
 * @property {number}      value
 * @property {number|null} threshold_min
 * @property {number|null} threshold_max
 * @property {string}      time            ISO-8601
 */

module.exports = {};
