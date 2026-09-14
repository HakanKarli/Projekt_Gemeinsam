/**
 * Zentrale, validierte Konfiguration.
 *
 * Wird beim Start EINMAL geprüft: Fehlt oder taugt eine Variable nicht, bricht der
 * Prozess sofort mit einer lesbaren Meldung ab. Das ist der Unterschied zwischen
 * "Konfigurationsfehler beim Start" und "undefined landet drei Schichten tiefer im
 * Verbindungsaufbau und erzeugt eine unverständliche Fehlermeldung".
 */

const path = require('node:path');

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const { z } = require('zod');

/** Kommagetrennte Liste -> Array; "*" bleibt als Einzelwert erhalten. */
const csv = z
  .string()
  .default('*')
  .transform((value) => value.split(',').map((entry) => entry.trim()).filter(Boolean));

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).default('info'),

  POSTGRES_HOST: z.string().min(1).default('127.0.0.1'),
  POSTGRES_PORT: z.coerce.number().int().positive().default(5432),
  POSTGRES_DB: z.string().min(1).default('ohb_sensordata'),
  POSTGRES_USER: z.string().min(1).default('postgres'),
  POSTGRES_PASSWORD: z.string().min(1, 'darf nicht leer sein'),

  MQTT_BROKER_URL: z.string().min(1).default('mqtt://127.0.0.1:1883'),
  MQTT_CLIENT_ID: z.string().min(1).default('ohb-ingest-1'),
  MQTT_TOPIC: z.string().min(1).default('sensors/#'),

  PORT: z.coerce.number().int().positive().default(3001),
  HEALTH_PORT: z.coerce.number().int().positive().default(3002),
  CORS_ORIGINS: csv,

  NTFY_SERVER: z.string().url().default('https://ntfy.sh'),
  NTFY_TOPIC: z.string().min(1).default('ohb-cleanroom-alerts'),
  KUMA_PUSH_URL: z.string().default(''),

  HEALTH_MAX_INGEST_LAG_SEC: z.coerce.number().positive().default(300),
  HEALTH_MAX_ARCHIVE_BACKLOG: z.coerce.number().int().positive().default(200),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  const lines = parsed.error.issues.map(
    (issue) => `  - ${issue.path.join('.') || '(Wurzel)'}: ${issue.message}`,
  );
  // Bewusst console statt Logger: Der Logger hängt selbst an der Konfiguration.
  console.error(
    `\nKonfiguration ungültig — Prozess wird beendet.\n${lines.join('\n')}\n\n` +
      `Vorlage aller erwarteten Variablen: node-backend/.env.example\n`,
  );
  process.exit(1);
}

const env = parsed.data;

/** @typedef {z.infer<typeof EnvSchema>} Env */

const config = Object.freeze({
  env: env.NODE_ENV,
  isProduction: env.NODE_ENV === 'production',
  isTest: env.NODE_ENV === 'test',
  logLevel: env.LOG_LEVEL,

  http: Object.freeze({
    port: env.PORT,
    corsOrigins: Object.freeze(env.CORS_ORIGINS),
  }),

  db: Object.freeze({
    host: env.POSTGRES_HOST,
    port: env.POSTGRES_PORT,
    database: env.POSTGRES_DB,
    user: env.POSTGRES_USER,
    password: env.POSTGRES_PASSWORD,
  }),

  mqtt: Object.freeze({
    brokerUrl: env.MQTT_BROKER_URL,
    clientId: env.MQTT_CLIENT_ID,
    topic: env.MQTT_TOPIC,
  }),

  ingest: Object.freeze({
    healthPort: env.HEALTH_PORT,
  }),

  alerts: Object.freeze({
    ntfyServer: env.NTFY_SERVER,
    ntfyTopic: env.NTFY_TOPIC,
    kumaPushUrl: env.KUMA_PUSH_URL || null,
  }),

  health: Object.freeze({
    maxIngestLagSec: env.HEALTH_MAX_INGEST_LAG_SEC,
    maxArchiveBacklog: env.HEALTH_MAX_ARCHIVE_BACKLOG,
  }),
});

module.exports = config;
