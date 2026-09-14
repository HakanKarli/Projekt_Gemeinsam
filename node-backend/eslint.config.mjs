import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/**', 'coverage/**'] },

  {
    // Anwendungscode: CommonJS
    files: ['src/**/*.js', 'scripts/**/*.js', 'tools/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: {
      ...js.configs.recommended.rules,
      // Ungenutzte Parameter mit führendem _ sind Absicht (z.B. Express-Signaturen).
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // Ausgabe läuft über den Logger. Ausnahme: config.js, bevor der Logger existiert.
      'no-console': ['error', { allow: ['error'] }],
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
      'no-var': 'error',
      'object-shorthand': 'warn',
      'no-return-await': 'error',
    },
  },

  {
    // Kommandozeilen-Werkzeuge geben bewusst direkt auf der Konsole aus —
    // sie werden von Hand aufgerufen, nicht im Betrieb ausgeführt.
    files: ['tools/**/*.js'],
    rules: { 'no-console': 'off' },
  },

  {
    // Legacy-MVP-Dateien (Vorgänger von app.js/ingest.js + lib/logger.js):
    // nutzen bewusst console statt des strukturierten pino-Loggers. Ausnahme,
    // bis entschieden ist, ob sie auf den Logger umgestellt oder abgelöst werden.
    files: [
      'src/server.js',
      'src/mqttBridge.js',
      'src/seed.js',
      'src/migrate.js',
      'src/alertListener.js',
      'src/test.js',
    ],
    rules: { 'no-console': 'off' },
  },

  {
    // Tests und Werkzeugkonfiguration: ES-Module
    files: ['test/**/*.js', '*.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
];
