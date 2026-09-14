/**
 * Y-Bereich der Diagramme.
 *
 * Reine Berechnung ohne DOM — genau die Art Logik, die sich billig absichern lässt
 * und deren Fehler in einem Diagramm sonst nur "irgendwie komisch" aussehen.
 */

import { describe, it, expect } from 'vitest';
import { yRange } from '../src/lib/plot';

describe('yRange', () => {
  it('liefert ohne Werte undefined, damit Plotly selbst skaliert', () => {
    expect(yRange([])).toBeUndefined();
    expect(yRange(undefined)).toBeUndefined();
  });

  it('legt ein Polster um die Spannweite', () => {
    const [low, high] = yRange([10, 20]);
    expect(low).toBeLessThan(10);
    expect(high).toBeGreaterThan(20);
    // Standardpolster sind 8 % der Spannweite
    expect(low).toBeCloseTo(9.2, 5);
    expect(high).toBeCloseTo(20.8, 5);
  });

  it('erzeugt auch bei konstanten Werten einen sichtbaren Bereich', () => {
    const [low, high] = yRange([21, 21, 21]);
    expect(high).toBeGreaterThan(low);
  });

  it('ignoriert unlesbare Werte statt NaN zu liefern', () => {
    const [low, high] = yRange([10, 'kaputt', 20]);
    expect(Number.isNaN(low)).toBe(false);
    expect(Number.isNaN(high)).toBe(false);
  });

  it('verarbeitet Zahlen als Zeichenkette — so kommen sie aus der Datenbank', () => {
    expect(yRange(['10', '20'])).toEqual(yRange([10, 20]));
  });

  it('liefert undefined, wenn ausschließlich unlesbare Werte anliegen', () => {
    expect(yRange(['a', 'b'])).toBeUndefined();
  });
});
