#!/usr/bin/env node
/**
 * Schreibt die Schnittstellenbeschreibung nach docs/openapi.yaml.
 *
 * Die Datei liegt im Repository, damit Änderungen an der Schnittstelle im Diff
 * sichtbar werden — eine Beschreibung, die nur zur Laufzeit existiert, prüft niemand.
 * Die CI ruft dieses Skript auf und bricht ab, wenn die Datei nicht mehr zum Code
 * passt (`git diff --exit-code`).
 *
 * YAML statt JSON ausschließlich wegen der Lesbarkeit im Diff.
 */

const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');

// Die Pfade registrieren sich, während die Anwendung zusammengebaut wird. Es genügt
// also nicht, das Routen-Modul zu laden — die Registrierung muss auch laufen.
// Ein Port wird dabei nicht belegt: createApp() startet keinen Server.
const { createApp } = require('../src/app');
const { buildDocument } = require('../src/http/openapi');

createApp();

const TARGET = path.resolve(__dirname, '..', '..', 'docs', 'openapi.yaml');

const document = buildDocument();
// aliasDuplicateObjects: false — sonst ersetzt der Serializer wiederholte Objekte
// durch YAML-Anker (&a1 / *a1). Das ist gültig, aber im Diff schwer zu lesen und
// wird nicht von jedem OpenAPI-Werkzeug verstanden.
const yaml = YAML.stringify(document, { lineWidth: 100, aliasDuplicateObjects: false });

const header = [
  '# =============================================================',
  '# ERZEUGTE DATEI — nicht von Hand bearbeiten.',
  '#',
  '# Quelle sind die Zod-Schemata in src/domain/schemas/ und die',
  '# registerPath-Aufrufe in src/http/routes/.',
  '# Neu erzeugen:  npm run openapi:export',
  '# =============================================================',
  '',
].join('\n');

fs.mkdirSync(path.dirname(TARGET), { recursive: true });
fs.writeFileSync(TARGET, header + yaml, 'utf8');

const pathCount = Object.keys(document.paths).length;
const schemaCount = Object.keys(document.components?.schemas ?? {}).length;
process.stdout.write(`docs/openapi.yaml geschrieben — ${pathCount} Pfade, ${schemaCount} Schemata\n`);

// Der Verbindungs-Pool wurde beim Zusammenbau angelegt; ohne expliziten Abschluss
// bliebe der Prozess offen.
process.exit(0);
