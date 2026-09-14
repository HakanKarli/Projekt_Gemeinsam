import { useState, useEffect, useRef, useMemo, useCallback, memo } from 'react';
import { Plot, CHART, yRange } from '../lib/plot';
import { useMqttContext } from '../store/MqttContext';
import './SensorPanel.css';

const ACCENT    = CHART.accent;
const GRID      = CHART.grid;
const BG        = CHART.bg;
const TEXT      = CHART.text;
const COLOR_MAX = CHART.max;
const COLOR_MIN = CHART.min;

const PLOT_CONFIG = Object.freeze({ displayModeBar: false, responsive: true, scrollZoom: true });
const PLOT_STYLE  = Object.freeze({ width: '100%', height: '100%' });

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
    const prevTopicRef = useRef('');

    const onData = useCallback((newData) => setData(newData), []);

    // sensorUuid aus topic extrahieren falls Prop fehlt
    const slash          = topic.indexOf('/');
    const effectiveUuid  = sensorUuid || (slash >= 0 ? topic.slice(0, slash) : topic);
    const effectiveQty   = quantity   || (slash >= 0 ? topic.slice(slash + 1) : '');

    // Namen live aus Registry auflösen
    const resolvedName = sensorNames?.[effectiveUuid] || effectiveUuid;
    const displayLabel = resolvedName;

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

    const latest  = data[data.length - 1];
    const unit    = latest?.unit ?? '';

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
        const vals = data.map((d) => d.value);
        if (minValue != null) vals.push(minValue);
        if (maxValue != null) vals.push(maxValue);
        return yRange(vals);
    }, [data, minValue, maxValue]);

    const plotLayout = useMemo(() => ({
        uirevision: topic,
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
    }), [topic, unit, yAxisRange, thresholdShapes, thresholdAnnotations]);

    const plotData = useMemo(() => [{
        x: data.map(d => new Date(d.timestamp)),
        y: data.map(d => d.value),
        type: 'scatter',
        mode: 'lines',
        line: { color: ACCENT, width: 2, shape: 'spline' },
        fill: 'tozeroy',
        fillcolor: 'rgba(0,170,255,0.08)',
        name: displayLabel,
    }], [data, displayLabel]);

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

            {/* ── Chart ── */}
            <div className="sp-chart-wrap">
                {data.length === 0 ? (
                    <div className="sp-empty">
                        <div className="sp-spinner" />
                        <span>Warte auf Daten…</span>
                    </div>
                ) : (
                    <Plot
                        data={plotData}
                        layout={plotLayout}
                        config={PLOT_CONFIG}
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
