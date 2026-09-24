import { useState, useEffect, useRef, useMemo, useCallback, memo } from 'react';
import { Plot, CHART, yRange } from '../lib/plot';
import { useMqttContext } from '../store/useMqttContext';
import { getSensorData } from '../api';
import './SensorPanel.css';

const ACCENT    = CHART.accent;
const GRID      = CHART.grid;
const BG        = CHART.bg;
const TEXT      = CHART.text;
const COLOR_MAX = CHART.max;
const COLOR_MIN = CHART.min;

// doubleClick: false — Plotlys eingebautes Reset-Verhalten setzt die Achse auf ein reines
// Daten-Autorange zurück und ignoriert dabei unsere Schwellenwert-Linien und das Polster aus
// yRange() (siehe unten). Das Ergebnis wirkt "komisch" verglichen mit der Ansicht, die nach
// einem neuen Messwert ohnehin gerendert wird. Der Doppelklick wird stattdessen selbst behandelt.
const PLOT_CONFIG = Object.freeze({ displayModeBar: false, responsive: true, scrollZoom: true, doubleClick: false });
const PLOT_STYLE  = Object.freeze({ width: '100%', height: '100%' });

// Zeitraum-Presets im Vollbild. "hours" wird direkt in from/to fuer getSensorData
// umgerechnet; 5000 ist der vom Backend erlaubte Maximalwert fuer "limit".
const RANGE_PRESETS  = [
    { label: '6h',      hours: 6 },
    { label: '12h',     hours: 12 },
    { label: '24h',     hours: 24 },
    { label: '1 Woche', hours: 24 * 7 },
];
const HISTORY_LIMIT = 5000;

function SensorPanel({
    initialTopic = '',
    sensorUuid   = '',
    quantity     = '',
    cleanroom    = '',
    minValue     = null,
    maxValue     = null,
    onEdit,
    editing      = false,
}) {
    const { subscribe, unsubscribe, addTopicListener, removeTopicListener, connected, sensorNames } = useMqttContext();

    const topic = initialTopic;
    const [fullscreen, setFullscreen] = useState(false);
    const [data,       setData]       = useState([]);
    const [resetNonce, setResetNonce] = useState(0);
    const prevTopicRef = useRef('');

    // Historische Ansicht im Vollbild: null = live (letzte MAX_POINTS aus dem
    // MQTT-Ringpuffer). Gesetzt, sobald ein Zeitraum-Preset angeklickt wurde.
    const [historyRange, setHistoryRange] = useState(null);   // Label des aktiven Presets
    const [historyData,  setHistoryData]  = useState(null);
    const [historyError, setHistoryError] = useState('');
    const [loadingRange, setLoadingRange] = useState(false);

    // Erzwingt beim Doppelklick, dass Plotly unseren aktuell berechneten Bereich
    // (Daten + Schwellenwert-Polster, siehe yAxisRange) neu übernimmt, statt auf
    // einen von Plotly selbst autorangierten Bereich zurückzufallen.
    const onPlotDoubleClick = useCallback(() => setResetNonce(n => n + 1), []);

    const onData = useCallback((newData) => setData(newData), []);

    // sensorUuid aus topic extrahieren falls Prop fehlt
    const slash          = topic.indexOf('/');
    const effectiveUuid  = sensorUuid || (slash >= 0 ? topic.slice(0, slash) : topic);
    const effectiveQty   = quantity   || (slash >= 0 ? topic.slice(slash + 1) : '');

    // Namen live aus Registry auflösen
    const resolvedName = sensorNames?.[effectiveUuid] || effectiveUuid;
    const displayLabel = resolvedName;

    // Laedt einen laengeren Zeitraum per REST nach (der MQTT-Ringpuffer haelt nur
    // die letzten 60 Live-Punkte, siehe useMqtt.js). Ersetzt nur die Chart-Daten —
    // der aktuelle Messwert im Kopf bleibt live.
    const loadRange = useCallback(async (preset) => {
        if (!effectiveUuid || !effectiveQty) return;
        setLoadingRange(true);
        setHistoryError('');
        try {
            const to   = new Date();
            const from = new Date(to.getTime() - preset.hours * 60 * 60 * 1000);
            const rows = await getSensorData(effectiveUuid, effectiveQty, from.toISOString(), to.toISOString(), HISTORY_LIMIT);
            setHistoryData(rows.map(r => ({ timestamp: r.time, value: parseFloat(r.value), unit: r.unit })));
            setHistoryRange(preset.label);
        } catch (err) {
            setHistoryError(err.message || 'Zeitraum konnte nicht geladen werden');
        } finally {
            setLoadingRange(false);
        }
    }, [effectiveUuid, effectiveQty]);

    const backToLive = useCallback(() => {
        setHistoryRange(null);
        setHistoryData(null);
        setHistoryError('');
    }, []);

    // Vollbild verlassen oder Sensor wechseln: zurueck zur Live-Ansicht.
    useEffect(() => { if (!fullscreen) backToLive(); }, [fullscreen, backToLive]);
    useEffect(() => { backToLive(); }, [topic, backToLive]);

    useEffect(() => {
        if (connected && topic) subscribe(topic);
    }, [connected, topic, subscribe]);

    useEffect(() => {
        const prev = prevTopicRef.current;
        if (prev && prev !== topic) {
            unsubscribe(prev);
            removeTopicListener(prev, onData);
        }
        if (topic) {
            subscribe(topic);
            addTopicListener(topic, onData);
        } else {
            // Teil derselben Synchronisation mit der Subscription wie der Zweig
            // darüber, nicht abgeleiteter Render-Zustand.
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setData([]);
        }
        prevTopicRef.current = topic;
        return () => { if (topic) removeTopicListener(topic, onData); };
    }, [topic, subscribe, unsubscribe, addTopicListener, removeTopicListener, onData]);

    useEffect(() => {
        if (!fullscreen) return;
        const onKey = (e) => { if (e.key === 'Escape') setFullscreen(false); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [fullscreen]);

    // Chart zeigt entweder den nachgeladenen Zeitraum oder den Live-Ringpuffer;
    // der aktuelle Messwert im Kopf bleibt davon unberuehrt immer live.
    const displayData = historyData ?? data;

    const latest  = data[data.length - 1];
    const unit    = (displayData[displayData.length - 1] ?? latest)?.unit ?? '';

    const thresholdShapes = useMemo(() => {
        const shapes = [];
        if (maxValue != null) shapes.push({
            type: 'line', xref: 'paper', yref: 'y',
            x0: 0, x1: 1, y0: maxValue, y1: maxValue,
            line: { color: COLOR_MAX, width: 1.5, dash: 'dash' },
        });
        if (minValue != null) shapes.push({
            type: 'line', xref: 'paper', yref: 'y',
            x0: 0, x1: 1, y0: minValue, y1: minValue,
            line: { color: COLOR_MIN, width: 1.5, dash: 'dash' },
        });
        return shapes;
    }, [minValue, maxValue]);

    const thresholdAnnotations = useMemo(() => {
        const anns = [];
        if (maxValue != null) anns.push({
            xref: 'paper', yref: 'y', x: 1, y: maxValue,
            xanchor: 'right', yanchor: 'bottom', text: `Max: ${maxValue}`,
            showarrow: false, font: { color: COLOR_MAX, size: 9 }, bgcolor: 'rgba(0,0,0,0)',
        });
        if (minValue != null) anns.push({
            xref: 'paper', yref: 'y', x: 1, y: minValue,
            xanchor: 'right', yanchor: 'top', text: `Min: ${minValue}`,
            showarrow: false, font: { color: COLOR_MIN, size: 9 }, bgcolor: 'rgba(0,0,0,0)',
        });
        return anns;
    }, [minValue, maxValue]);

    // Datengetriebener Y-Zoom: Minimum unten, Maximum oben (mit Polster),
    // Schwellenwerte bleiben im Bild. Plotly behält manuellen Zoom dank
    // konstantem uirevision bei.
    const yAxisRange = useMemo(() => {
        const vals = displayData.map((d) => d.value);
        if (minValue != null) vals.push(minValue);
        if (maxValue != null) vals.push(maxValue);
        return yRange(vals);
    }, [displayData, minValue, maxValue]);

    const plotLayout = useMemo(() => ({
        // historyRange in der Revision, damit ein Wechsel des Zeitraum-Presets
        // ebenfalls sauber auf den neu berechneten Bereich zurueckspringt statt
        // einen zuvor manuell gezoomten Ausschnitt beizubehalten.
        uirevision: `${topic}:${resetNonce}:${historyRange ?? 'live'}`,
        autosize: true,
        paper_bgcolor: BG,
        plot_bgcolor: BG,
        margin: { t: 8, r: 12, b: 36, l: 52 },
        xaxis: { type: 'date', color: TEXT, gridcolor: GRID, tickfont: { size: 10 }, showline: false },
        yaxis: {
            color: TEXT, gridcolor: GRID, tickfont: { size: 10 }, showline: false,
            title: { text: unit, font: { color: ACCENT, size: 11 } },
            ...(yAxisRange ? { range: yAxisRange, autorange: false } : {}),
        },
        font: { family: CHART.font, color: TEXT },
        showlegend: false,
        hovermode: 'x unified',
        shapes: thresholdShapes,
        annotations: thresholdAnnotations,
    }), [topic, resetNonce, historyRange, unit, yAxisRange, thresholdShapes, thresholdAnnotations]);

    const plotData = useMemo(() => [{
        x: displayData.map(d => new Date(d.timestamp)),
        y: displayData.map(d => d.value),
        type: 'scatter',
        mode: 'lines',
        line: { color: ACCENT, width: 2, shape: 'spline' },
        fill: 'tozeroy',
        fillcolor: 'rgba(0,170,255,0.08)',
        name: displayLabel,
    }], [displayData, displayLabel]);

    const latestVal    = latest ? parseFloat(latest.value) : null;
    const isViolating  = latestVal != null && (
        (maxValue != null && latestVal > maxValue) ||
        (minValue != null && latestVal < minValue)
    );

    const panelContent = (isFullscreen) => (
        <>
            {/* ── Header ── */}
            <div className={`sp-header${isViolating ? ' sp-header--violation' : ''}`}>
                <div className="sp-label-row">
                    <div className="sp-label-info">
                        <span className="sp-label-main">{displayLabel}</span>
                        {cleanroom && <span className="sp-label-room">{cleanroom}</span>}
                    </div>

                    {!editing && (
                        <div className="sp-btn-group">
                            {!isFullscreen && onEdit && (
                                <button className="btn btn-ghost sp-btn-icon" onClick={onEdit} title="Panel bearbeiten">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                                    </svg>
                                </button>
                            )}
                            <button
                                className="btn btn-ghost sp-btn-icon"
                                onClick={() => setFullscreen(v => !v)}
                                title={isFullscreen ? 'Vollbild verlassen (Esc)' : 'Vollbild'}
                            >
                                {isFullscreen
                                    ? <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" /></svg>
                                    : <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" /></svg>
                                }
                            </button>
                        </div>
                    )}
                </div>

                {latest && (
                    <div className="sp-meta">
                        <span className="sp-chip">{effectiveQty}</span>
                        <span className={`sp-value${isViolating ? ' sp-value--violation' : ''}`}>
                            {latest.value} <span className="sp-unit">{unit}</span>
                        </span>
                    </div>
                )}

                {(minValue != null || maxValue != null) && (
                    <div className="sp-thresholds">
                        {minValue != null && <span className="sp-threshold-badge sp-threshold-min">↓ Min: {minValue}</span>}
                        {maxValue != null && <span className="sp-threshold-badge sp-threshold-max">↑ Max: {maxValue}</span>}
                    </div>
                )}
            </div>

            {/* ── Zeitraum-Presets: nur im Vollbild, laedt per REST nach ── */}
            {isFullscreen && (
                <div className="sp-range-row">
                    <button
                        className={`sp-range-btn${!historyRange ? ' active' : ''}`}
                        onClick={backToLive}
                        title="Zurueck zur Live-Ansicht"
                    >
                        Live
                    </button>
                    {RANGE_PRESETS.map((preset) => (
                        <button
                            key={preset.label}
                            className={`sp-range-btn${historyRange === preset.label ? ' active' : ''}`}
                            onClick={() => loadRange(preset)}
                            disabled={loadingRange}
                        >
                            {preset.label}
                        </button>
                    ))}
                    {loadingRange && <span className="sp-range-status">lädt…</span>}
                    {!loadingRange && historyError && <span className="sp-range-status sp-range-error">{historyError}</span>}
                </div>
            )}

            {/* ── Chart ── */}
            <div className="sp-chart-wrap">
                {displayData.length === 0 ? (
                    <div className="sp-empty">
                        {!historyRange && <div className="sp-spinner" />}
                        <span>{historyRange ? 'Keine Daten in diesem Zeitraum' : 'Warte auf Daten…'}</span>
                    </div>
                ) : (
                    <Plot
                        data={plotData}
                        layout={plotLayout}
                        config={PLOT_CONFIG}
                        onDoubleClick={onPlotDoubleClick}
                        useResizeHandler
                        style={PLOT_STYLE}
                    />
                )}
            </div>
        </>
    );

    if (fullscreen) {
        return (
            <>
                <div className="sensor-panel glass-card sp-placeholder" />
                <div className="sp-fullscreen glass-card">{panelContent(true)}</div>
            </>
        );
    }

    return (
        <div className={`sensor-panel glass-card${isViolating ? ' sensor-panel--violation' : ''}`}>
            {panelContent(false)}
        </div>
    );
}

export default memo(SensorPanel);
