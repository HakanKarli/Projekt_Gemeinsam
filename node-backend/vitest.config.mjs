import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.js'],
    // Der Start eines TimescaleDB-Containers dauert je nach Maschine 15–40 s.
    testTimeout: 30_000,
    hookTimeout: 120_000,
    // Datenbanktests teilen sich einen Container pro Datei; parallele Dateien
    // würden mehrere Container gleichzeitig starten und die Maschine ausbremsen.
    fileParallelism: false,
    reporters: ['default'],
  },
});
