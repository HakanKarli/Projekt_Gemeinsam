/**
 * Fehlermodell.
 *
 * Services werfen fachliche Fehler (`NotFoundError`, `ConflictError`), ohne HTTP zu
 * kennen. Die Zuordnung auf Statuscodes passiert an genau EINER Stelle — in
 * `http/middleware/errorHandler.js`.
 */

class AppError extends Error {
  /**
   * @param {number} status  HTTP-Status
   * @param {string} code    stabiler Fehlercode für Clients (nicht übersetzt)
   * @param {string} message menschenlesbare Beschreibung
   * @param {unknown} [details]
   */
  constructor(status, code, message, details) {
    super(message);
    this.name = new.target.name;
    this.status = status;
    this.code = code;
    if (details !== undefined) this.details = details;
    Error.captureStackTrace?.(this, new.target);
  }
}

class ValidationError extends AppError {
  constructor(message = 'Ungültige Eingabe', details) {
    super(400, 'validation_failed', message, details);
  }
}

class NotFoundError extends AppError {
  /** @param {string} resource z.B. "Reinraum" */
  constructor(resource = 'Ressource') {
    super(404, 'not_found', `${resource} nicht gefunden`);
  }
}

class ConflictError extends AppError {
  constructor(message = 'Konflikt mit dem aktuellen Zustand') {
    super(409, 'conflict', message);
  }
}

class ServiceUnavailableError extends AppError {
  constructor(message = 'Dienst vorübergehend nicht verfügbar', details) {
    super(503, 'unavailable', message, details);
  }
}

/**
 * PostgreSQL-Fehlercodes, die eine fachliche Bedeutung haben und deshalb nicht als
 * 500 durchgereicht werden sollen.
 * @see https://www.postgresql.org/docs/current/errcodes-appendix.html
 */
const PG_CODES = {
  invalid_text_representation: '22P02', // z.B. "abc" als UUID
  not_null_violation: '23502',
  foreign_key_violation: '23503',
  unique_violation: '23505',
  check_violation: '23514',
  exclusion_violation: '23P01', // überlappender tstzrange
  invalid_datetime_format: '22007',
  datetime_field_overflow: '22008',
};

/**
 * Verständliche Meldungen für die Bedingungen, die in der Datenbank definiert sind.
 *
 * Die REGEL steht in der Tabelle — dort gilt sie für jeden Schreibzugriff, auch für
 * solche, die nicht durch diese Anwendung laufen. Hier steht nur die WORTWAHL, damit
 * ein abgewiesener Schreibvorgang nicht als „verletzt eine Datenbank-Bedingung"
 * beim Nutzer ankommt.
 */
const CONSTRAINT_MESSAGES = {
  chk_threshold_hat_grenze: 'Mindestens einer der Werte min_value oder max_value muss gesetzt sein',
  chk_threshold_grenzen_sortiert: 'min_value darf nicht größer als max_value sein',
  sensor_assignments_sensor_uuid_valid_during_excl:
    'Für diesen Sensor besteht im angegebenen Zeitraum bereits eine Zuordnung',
  sensor_thresholds_sensor_uuid_quantity_valid_during_excl:
    'Für diese Messgröße besteht im angegebenen Zeitraum bereits ein Schwellenwert',
  cleanrooms_name_key: 'Ein Reinraum mit diesem Namen existiert bereits',
};

/**
 * Übersetzt einen pg-Fehler in einen AppError, sofern er fachlich deutbar ist.
 * Alles Unbekannte wird unverändert zurückgegeben und später als 500 behandelt.
 *
 * @param {unknown} err
 * @returns {unknown} AppError oder der ursprüngliche Fehler
 */
function fromPgError(err) {
  const { code, constraint } = /** @type {{ code?: string, constraint?: string }} */ (err) ?? {};
  const bekannteMeldung = constraint ? CONSTRAINT_MESSAGES[constraint] : undefined;

  switch (code) {
    case PG_CODES.invalid_text_representation:
    case PG_CODES.invalid_datetime_format:
    case PG_CODES.datetime_field_overflow:
      return new ValidationError('Parameter hat ein ungültiges Format');
    case PG_CODES.unique_violation:
      return new ConflictError(bekannteMeldung ?? 'Eintrag existiert bereits');
    case PG_CODES.exclusion_violation:
      return new ConflictError(
        bekannteMeldung ?? 'Zeitraum überschneidet sich mit einem bestehenden Eintrag',
      );
    case PG_CODES.foreign_key_violation:
      return new ValidationError(bekannteMeldung ?? 'Referenzierter Datensatz existiert nicht');
    case PG_CODES.not_null_violation:
    case PG_CODES.check_violation:
      return new ValidationError(bekannteMeldung ?? 'Wert verletzt eine Datenbank-Bedingung');
    default:
      return err;
  }
}

module.exports = {
  AppError,
  ValidationError,
  NotFoundError,
  ConflictError,
  ServiceUnavailableError,
  PG_CODES,
  fromPgError,
};
