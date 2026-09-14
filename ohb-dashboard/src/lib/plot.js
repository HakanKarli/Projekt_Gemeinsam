// =============================================================
// Zentrales Plotly-Setup: EINE geteilte Factory-Instanz für alle
// Charts (statt pro Komponente neu zu erzeugen) + gemeinsames
// dunkles Theme und ein Helfer für den datengetriebenen Y-Zoom.
// =============================================================
import Plotly from 'plotly.js-dist-min';
import createPlotlyComponent from 'react-plotly.js/factory';

export const Plot = createPlotlyComponent(Plotly);

// ── Theme ───────────────────────────────────────────────────
export const CHART = Object.freeze({
  accent:   '#00aaff',
  grid:     'rgba(255,255,255,0.06)',
  bg:       'rgba(0,0,0,0)',
  text:     '#93a3b8',
  max:      '#ef4444',
  min:      '#f59e0b',
  font:     'Inter, system-ui, sans-serif',
});

// Farbpalette für Mehrfach-Serien (HistoryView).
export const SERIES_COLORS = Object.freeze([
  '#00aaff', '#22c55e', '#f59e0b', '#ef4444',
  '#a855f7', '#ec4899', '#14b8a6', '#f97316',
]);

/**
 * Berechnet einen "rangezoomten" Y-Bereich aus den Werten:
 * Minimum nahe unten, Maximum nahe oben, mit etwas Polster.
 * Gibt `undefined` zurück wenn keine Werte vorhanden sind
 * (dann soll Plotly automatisch skalieren).
 *
 * @param {Array<number|string>} values
 * @param {number} padFrac  Polster als Anteil der Spannweite (Default 8%)
 * @param {number} minPad   Mindest-Polster (absolut)
 */
export function yRange(values, padFrac = 0.08, minPad = 0) {
  if (!values || values.length === 0) return undefined;

  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) {
    const n = typeof v === 'number' ? v : parseFloat(v);
    if (Number.isNaN(n)) continue;
    if (n < lo) lo = n;
    if (n > hi) hi = n;
  }
  if (lo === Infinity) return undefined;

  if (lo === hi) {
    const pad = Math.max(Math.abs(lo) * 0.05, minPad || 1);
    return [lo - pad, hi + pad];
  }
  const pad = Math.max((hi - lo) * padFrac, minPad);
  return [lo - pad, hi + pad];
}
