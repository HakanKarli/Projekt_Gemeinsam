/**
 * Alle sichtbaren Zeichenketten an einer Stelle.
 *
 * Zuvor standen im selben Bildschirm "Uebersicht", "Reinraeume" und "Loeschen" neben
 * "Übersicht", "Messgröße" und "Schwellenwerte" — das liest sich wie zwei
 * verschiedene Produkte. Gleichzeitig ist dies der Einstiegspunkt, falls je eine
 * zweite Sprache dazukommt.
 */

export const de = {
  app: {
    title: 'Sensor Dashboard',
  },

  nav: {
    heading: 'Navigation',
    overview: 'Übersicht',
    history: 'Verlauf',
    cleanrooms: 'Reinräume',
    noCleanrooms: 'Keine Reinräume konfiguriert',
    configuration: 'Konfiguration',
    openSidebar: 'Navigation öffnen',
    closeSidebar: 'Navigation schließen',
  },

  header: {
    alerts: 'Alarme',
    exportPdf: 'PDF-Report',
    mqtt: 'MQTT',
    connected: 'Verbunden',
    disconnected: 'Getrennt',
    error: 'Fehler',
    connectionState: 'Verbindungszustand zum Broker',
  },

  dashboard: {
    title: 'Übersicht',
    channels: (count) => `${count} Kanäle`,
    hidden: (count) => `${count} ausgeblendet`,
    editLayout: 'Layout bearbeiten',
    done: 'Fertig',
    reset: 'Zurücksetzen',
    resetHint: 'Reihenfolge und Sichtbarkeit zurücksetzen',
    editHint: 'Ziehen zum Sortieren · Auge zum Aus- und Einblenden',
    loading: 'Lade zugeordnete Sensoren…',
    empty: 'Keine Sensoren einem Reinraum zugeordnet.',
    emptyHint: 'Konfiguration → Sensoren → Sensor einem Raum zuordnen.',
    backendError: (message) => `Verbindung zum Backend fehlgeschlagen: ${message}`,
    dragHandle: 'Ziehen zum Verschieben',
    show: 'Einblenden',
    hide: 'Ausblenden',
  },

  panel: {
    waiting: 'Warte auf Daten…',
    edit: 'Panel bearbeiten',
    fullscreen: 'Vollbild',
    exitFullscreen: 'Vollbild verlassen (Esc)',
    min: 'Min',
    max: 'Max',
  },

  config: {
    title: 'Konfiguration',
    tabs: { cleanrooms: 'Reinräume', sensors: 'Sensoren', thresholds: 'Schwellenwerte' },
    add: 'Hinzufügen',
    delete: 'Löschen',
    rename: 'Umbenennen',
    assign: 'Zuordnen',
    reassign: 'Neu zuordnen',
    set: 'Setzen',
    newCleanroom: 'Neuer Reinraum (z.B. Reinraum 221)',
    noCleanrooms: 'Keine Reinräume vorhanden',
    renameSensor: 'Sensor umbenennen',
    assignSensor: 'Sensor einem Raum zuordnen',
    registeredSensors: 'Registrierte Sensoren',
    noSensors: 'Keine Sensoren vorhanden — warten auf MQTT-Daten',
    noThresholds: 'Keine Schwellenwerte vorhanden',
    newName: 'Neuer Name',
    chooseSensor: '— Sensor wählen —',
    chooseCleanroom: '— Reinraum wählen —',
    chooseQuantity: '— Messgröße —',
    chooseSensorFirst: '— zuerst Sensor wählen —',
    loadingQuantities: 'Lade…',
    columns: {
      id: 'ID',
      name: 'Name',
      measures: 'Misst',
      uuid: 'UUID',
      gateway: 'Gateway',
      cleanroom: 'Reinraum',
      quantity: 'Messgröße',
      min: 'Min',
      max: 'Max',
      sensor: 'Sensor',
    },
  },

  alerts: {
    title: 'Schwellenwert-Alarme',
    filterOpen: 'Offen',
    filterActive: 'Aktiv',
    filterAll: 'Alle',
    refresh: 'Aktualisieren',
    acknowledge: 'Quittieren',
    none: 'Keine Alarme vorhanden',
    loading: 'Laden…',
    lastAlert: 'Letzter Alarm',
    statusAcknowledged: 'Quittiert',
    statusEnded: 'Beendet',
    statusActive: 'Aktiv',
    aboveMax: 'Über Maximum',
    belowMin: 'Unter Minimum',
    running: 'laufend',
    columns: {
      status: 'Status',
      sensor: 'Sensor',
      quantity: 'Messgröße',
      type: 'Typ',
      value: 'Wert',
      limit: 'Grenzwert',
      start: 'Beginn',
      duration: 'Dauer',
      points: 'Punkte',
    },
  },

  report: {
    title: 'Reinraum-Report erstellen',
    cleanroom: 'Reinraum',
    period: 'Zeitraum',
    from: 'Von',
    to: 'Bis',
    generate: 'Report als PDF erzeugen',
    generating: 'Wird erzeugt…',
    hint:
      'Alle Sensoren, die im gewählten Zeitraum diesem Reinraum zugeordnet waren, werden ' +
      'einbezogen. Schwellenwert-Änderungen werden historisch korrekt berücksichtigt.',
    chooseCleanroom: 'Bitte einen Reinraum wählen.',
    choosePeriod: 'Bitte einen Zeitraum angeben.',
  },

  history: {
    title: 'Verlauf',
    sensor: 'Sensor',
    quantities: 'Messgrößen',
    period: 'Zeitraum',
    load: 'Daten laden',
    loading: 'Lade Daten…',
    roomHistory: 'Raumzuordnungen im Zeitraum',
    current: 'aktuell',
    noData: 'Keine Daten',
    points: (count) => `${count} Punkte`,
    chooseSensor: 'Bitte einen Sensor wählen.',
    chooseQuantity: 'Mindestens eine Messgröße wählen.',
    choosePeriod: 'Bitte einen Zeitraum angeben.',
    thresholds: 'Schwellenwerte',
  },

  connection: {
    title: 'MQTT-Verbindung',
    brokerUrl: 'Broker-Adresse (WebSocket)',
    hint: 'Standard hinter nginx: derselbe Host unter /mqtt',
    connect: 'Verbinden',
    reconnect: 'Neu verbinden',
    disconnect: 'Trennen',
    cancel: 'Abbrechen',
  },

  common: {
    close: 'Dialog schließen',
    cancel: 'Abbrechen',
    save: 'Speichern',
    saving: 'Wird gespeichert…',
    loading: 'Lädt…',
    none: '–',
  },
};

export default de;
