/**
 * Fachliche Schemata — die einzige Quelle der Wahrheit.
 *
 * Jede Definition wird dreifach verwendet:
 *   1. Eingabeprüfung an der Systemgrenze (http/middleware/validate.js)
 *   2. Beschreibung der Antworten in der OpenAPI-Dokumentation
 *   3. Typinformation im Editor über z.infer
 *
 * Dadurch kann die Dokumentation nicht von der Implementierung abweichen — sie
 * entsteht aus demselben Objekt, gegen das geprüft wird.
 */

const { z } = require('zod');
const { extendZodWithOpenApi } = require('@asteasolutions/zod-to-openapi');
const { uuid, quantity, isoDateTime, idParam } = require('./common');

extendZodWithOpenApi(z);

/* ── Gemeinsame Bausteine ───────────────────────────────────────── */

const ErrorResponse = z
  .object({
    error: z.object({
      code: z.string().describe('Stabiler Fehlercode für Clients'),
      message: z.string(),
      details: z.unknown().optional(),
    }),
    requestId: z.string().describe('Korrelations-ID, auch im Header X-Request-Id'),
  })
  .openapi('ErrorResponse');

/* ── Reinräume ──────────────────────────────────────────────────── */

const Cleanroom = z
  .object({
    id: z.number().int(),
    name: z.string(),
  })
  .openapi('Cleanroom');

const CreateCleanroomBody = z
  .object({ name: z.string().min(1).max(200) })
  .openapi('CreateCleanroomBody');

const IdParam = z.object({ id: idParam() });

/* ── Sensoren ───────────────────────────────────────────────────── */

const Sensor = z
  .object({
    sensor_uuid: z.string(),
    name: z.string(),
    gateway_id: z.string().nullable(),
    event_driven: z.number().int().describe('0 = zyklisch, 1 = event-getrieben'),
    created_at: z.date().or(z.string()),
    cleanroom_id: z.number().int().nullable(),
    cleanroom_name: z.string().nullable(),
    quantities: z.array(z.string()).describe('Bisher gemessene Größen'),
  })
  .openapi('Sensor');

const SensorUuidParam = z.object({ sensor_uuid: uuid() });

const RenameSensorBody = z
  .object({ name: z.string().min(1).max(200) })
  .openapi('RenameSensorBody');

/* ── Zuordnungen ────────────────────────────────────────────────── */

const Assignment = z
  .object({
    id: z.number().int(),
    sensor_uuid: z.string(),
    sensor_name: z.string().nullable(),
    gateway_id: z.string().nullable(),
    cleanroom_id: z.number().int(),
    cleanroom_name: z.string(),
    valid_during: z.unknown().describe('Gültigkeitszeitraum als tstzrange'),
  })
  .openapi('Assignment');

const AssignmentHistoryEntry = z
  .object({
    id: z.number().int(),
    sensor_uuid: z.string(),
    cleanroom_id: z.number().int(),
    cleanroom_name: z.string(),
    valid_from: z.date().or(z.string()).nullable(),
    valid_to: z.date().or(z.string()).nullable().describe('null = bis auf Weiteres'),
  })
  .openapi('AssignmentHistoryEntry');

const CreateAssignmentBody = z
  .object({
    sensor_uuid: uuid(),
    cleanroom_id: z.number().int().positive(),
  })
  .openapi('CreateAssignmentBody');

const AssignmentHistoryQuery = z.object({ sensor_uuid: uuid() });

/* ── Schwellenwerte ─────────────────────────────────────────────── */

const Threshold = z
  .object({
    id: z.number().int(),
    sensor_uuid: z.string(),
    quantity: z.string(),
    min_value: z.number().nullable(),
    max_value: z.number().nullable(),
    valid_during: z.unknown(),
  })
  .openapi('Threshold');

const ThresholdQuery = z.object({ sensor_uuid: uuid().optional() });

const SetThresholdBody = z
  .object({
    sensor_uuid: uuid(),
    quantity: quantity(),
    min_value: z.number().nullish(),
    max_value: z.number().nullish(),
  })
  .refine((v) => v.min_value != null || v.max_value != null, {
    message: 'Mindestens einer der Werte min_value oder max_value muss gesetzt sein',
  })
  .refine((v) => v.min_value == null || v.max_value == null || v.min_value <= v.max_value, {
    message: 'min_value darf nicht größer als max_value sein',
  })
  .openapi('SetThresholdBody');

/* ── Messdaten ──────────────────────────────────────────────────── */

const DataPoint = z
  .object({
    time: z.date().or(z.string()),
    quantity: z.string(),
    unit: z.string(),
    value: z.number(),
  })
  .openapi('DataPoint');

const SensorDataQuery = z
  .object({
    sensor_uuid: uuid(),
    quantity: quantity(),
    from: isoDateTime().optional().describe('Standard: vor 24 Stunden'),
    to: isoDateTime().optional().describe('Standard: jetzt'),
    limit: z.coerce.number().int().min(1).max(5000).default(500),
  })
  .openapi('SensorDataQuery');

const MetricsQuery = z.object({ sensor_uuid: uuid() });

/* ── Panels ─────────────────────────────────────────────────────── */

const Panel = z
  .object({
    id: z.string().describe('sensor_uuid/quantity — stabile Kennung des Kanals'),
    sensor_uuid: z.string(),
    sensor_name: z.string(),
    quantity: z.string(),
    unit: z.string().nullable(),
    cleanroom_id: z.number().int().nullable(),
    cleanroom_name: z.string().nullable(),
    min_value: z.number().nullable(),
    max_value: z.number().nullable(),
  })
  .openapi('Panel');

const PanelQuery = z.object({
  cleanroom_id: z.coerce.number().int().positive().optional(),
});

/* ── Verletzungen ───────────────────────────────────────────────── */

const Violation = z
  .object({
    id: z.number().int(),
    sensor_uuid: z.string(),
    sensor_name: z.string().nullable(),
    cleanroom_id: z.number().int().nullable(),
    cleanroom_name: z.string().nullable(),
    quantity: z.string(),
    violation_type: z.enum(['below_min', 'above_max']),
    threshold_min: z.number().nullable(),
    threshold_max: z.number().nullable(),
    started_at: z.date().or(z.string()),
    ended_at: z.date().or(z.string()).nullable().describe('null = läuft noch'),
    duration_sec: z.number().nullable(),
    first_value: z.number(),
    last_value: z.number().nullable(),
    peak_value: z.number().describe('Extremster Wert des Ereignisses'),
    data_points: z.number().int(),
    acknowledged: z.boolean(),
  })
  .openapi('Violation');

const ViolationQuery = z
  .object({
    cleanroom_id: z.coerce.number().int().positive().optional(),
    sensor_uuid: uuid().optional(),
    quantity: quantity().optional(),
    from: isoDateTime().optional(),
    to: isoDateTime().optional(),
    active: z.enum(['true', 'false']).optional().describe('true = noch laufend'),
    acknowledged: z.enum(['true', 'false']).optional(),
    limit: z.coerce.number().int().min(1).max(5000).default(200),
  })
  .openapi('ViolationQuery');

const ViolationSummaryEntry = z
  .object({
    cleanroom_id: z.number().int().nullable(),
    cleanroom_name: z.string().nullable(),
    quantity: z.string(),
    violation_type: z.enum(['below_min', 'above_max']),
    event_count: z.number().int(),
    total_data_points: z.number().int(),
    total_duration_sec: z.number().nullable(),
    first_event: z.date().or(z.string()),
    last_event: z.date().or(z.string()),
  })
  .openapi('ViolationSummaryEntry');

const SummaryQuery = z.object({
  from: isoDateTime().optional(),
  to: isoDateTime().optional(),
});

/* ── Report ─────────────────────────────────────────────────────── */

const ReportBody = z
  .object({
    cleanroom_id: z.number().int().positive(),
    from: isoDateTime(),
    to: isoDateTime(),
  })
  .refine((v) => new Date(v.from) < new Date(v.to), {
    message: 'from muss vor to liegen',
  })
  .openapi('ReportBody');

/* ── Betriebszustand ────────────────────────────────────────────── */

const HealthReport = z
  .object({
    status: z.enum(['ok', 'degraded']),
    problems: z.array(z.string()),
    metrics: z.object({
      worst_lag_sec: z.number().nullable().describe('Alter der ältesten letzten Messung'),
      open_alerts: z.number().int(),
      db_bytes: z.number().int(),
      archive_enabled: z.boolean().nullable(),
      archive_backlog: z.number().int().nullable(),
      archive_last_failed: z.date().or(z.string()).nullable()
        .describe('Zeitpunkt der letzten gescheiterten Archivierung — historisch, nicht zwingend aktuell'),
      archive_last_success: z.date().or(z.string()).nullable()
        .describe('Ist er jünger als archive_last_failed, läuft die Archivierung wieder'),
    }),
    thresholds: z.object({
      max_ingest_lag_sec: z.number(),
      max_archive_backlog: z.number().int(),
    }),
  })
  .openapi('HealthReport');

module.exports = {
  z,
  ErrorResponse,
  Cleanroom,
  CreateCleanroomBody,
  IdParam,
  Sensor,
  SensorUuidParam,
  RenameSensorBody,
  Assignment,
  AssignmentHistoryEntry,
  AssignmentHistoryQuery,
  CreateAssignmentBody,
  Threshold,
  ThresholdQuery,
  SetThresholdBody,
  DataPoint,
  SensorDataQuery,
  MetricsQuery,
  Panel,
  PanelQuery,
  Violation,
  ViolationQuery,
  ViolationSummaryEntry,
  SummaryQuery,
  ReportBody,
  HealthReport,
};
