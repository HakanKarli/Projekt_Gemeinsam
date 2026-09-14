/**
 * Validierung an der Systemgrenze.
 *
 * Geprüfte Werte landen in `req.valid` — die Original-Objekte `req.query` / `req.params`
 * bleiben unangetastet. Das ist bewusst: In Express 5 ist `req.query` nur noch lesbar,
 * die übliche Überschreib-Variante wäre also eine Sackgasse.
 *
 * Ab hier kann sich jeder Service darauf verlassen, dass Typen und Wertebereiche
 * stimmen. Genau das verhindert Fehler wie `sensor_uuid=abc`, die zuvor ungefiltert
 * bis in die Datenbank durchschlugen und den Prozess beendeten.
 */

const { ValidationError } = require('../../lib/errors');

/** @typedef {import('zod').ZodTypeAny} ZodTypeAny */

const PARTS = /** @type {const} */ (['params', 'query', 'body']);

/**
 * @param {Partial<Record<typeof PARTS[number], ZodTypeAny>>} schemas
 */
function validate(schemas) {
  return function validateRequest(req, _res, next) {
    /** @type {Record<string, unknown>} */
    const valid = {};

    for (const part of PARTS) {
      const schema = schemas[part];
      if (!schema) continue;

      const result = schema.safeParse(req[part]);
      if (!result.success) {
        return next(
          new ValidationError(
            `Ungültige Angaben in ${part}`,
            result.error.issues.map((issue) => ({
              field: issue.path.join('.') || part,
              message: issue.message,
              code: issue.code,
            })),
          ),
        );
      }
      valid[part] = result.data;
    }

    req.valid = valid;
    next();
  };
}

module.exports = { validate };
