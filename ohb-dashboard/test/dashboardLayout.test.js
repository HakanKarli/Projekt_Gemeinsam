/**
 * Reihenfolge und Sichtbarkeit der Panels.
 *
 * Der Zustand liegt im localStorage und überlebt damit einen Neustart des Browsers.
 * Fehler hier führen dazu, dass ein Nutzer seine Anordnung verliert — unauffällig,
 * aber ärgerlich.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDashboardLayout } from '../src/hooks/useDashboardLayout';

const panel = (id) => ({ id });

beforeEach(() => localStorage.clear());

describe('useDashboardLayout', () => {
  it('behält die Eingangsreihenfolge, solange nichts gespeichert ist', () => {
    const { result } = renderHook(() => useDashboardLayout());
    const sorted = result.current.sortPanels([panel('a'), panel('b'), panel('c')]);
    expect(sorted.map((p) => p.id)).toEqual(['a', 'b', 'c']);
  });

  it('verschiebt ein Panel an die Position eines anderen', () => {
    const { result } = renderHook(() => useDashboardLayout());

    act(() => result.current.reorder(['a', 'b', 'c'], 'c', 'a'));

    const sorted = result.current.sortPanels([panel('a'), panel('b'), panel('c')]);
    expect(sorted.map((p) => p.id)).toEqual(['c', 'a', 'b']);
  });

  it('hängt unbekannte Panels hinten an, statt sie zu verlieren', () => {
    const { result } = renderHook(() => useDashboardLayout());

    act(() => result.current.reorder(['a', 'b'], 'b', 'a'));

    const sorted = result.current.sortPanels([panel('a'), panel('b'), panel('neu')]);
    expect(sorted.map((p) => p.id)).toEqual(['b', 'a', 'neu']);
  });

  it('blendet Panels aus und wieder ein', () => {
    const { result } = renderHook(() => useDashboardLayout());

    act(() => result.current.toggleHidden('a'));
    expect(result.current.isHidden('a')).toBe(true);
    expect(result.current.hiddenCount).toBe(1);

    act(() => result.current.toggleHidden('a'));
    expect(result.current.isHidden('a')).toBe(false);
  });

  it('überdauert das erneute Einhängen der Komponente', () => {
    const first = renderHook(() => useDashboardLayout());
    act(() => first.result.current.toggleHidden('a'));
    first.unmount();

    const second = renderHook(() => useDashboardLayout());
    expect(second.result.current.isHidden('a')).toBe(true);
  });

  it('setzt alles zurück', () => {
    const { result } = renderHook(() => useDashboardLayout());

    act(() => {
      result.current.toggleHidden('a');
      result.current.reorder(['a', 'b'], 'b', 'a');
    });
    act(() => result.current.reset());

    expect(result.current.hiddenCount).toBe(0);
    expect(result.current.sortPanels([panel('a'), panel('b')]).map((p) => p.id)).toEqual(['a', 'b']);
  });

  it('übersteht beschädigte Daten im localStorage', () => {
    localStorage.setItem('ohb-dashboard-layout', '{kaputt');
    const { result } = renderHook(() => useDashboardLayout());
    expect(result.current.hiddenCount).toBe(0);
  });
});
