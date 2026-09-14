import { useState, useEffect, useCallback } from 'react';

// =============================================================
// Persistiert die Dashboard-Anordnung (Reihenfolge der Panels)
// und deren Sichtbarkeit lokal im Browser (localStorage).
// Panels werden über ihre stabile `id` (sensorUuid/quantity)
// referenziert.
// =============================================================
const LS_KEY = 'ohb-dashboard-layout';

function loadLayout() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY));
    return {
      order:  Array.isArray(raw?.order)  ? raw.order  : [],
      hidden: Array.isArray(raw?.hidden) ? raw.hidden : [],
    };
  } catch {
    return { order: [], hidden: [] };
  }
}

export function useDashboardLayout() {
  const [layout, setLayout] = useState(loadLayout);

  useEffect(() => {
    localStorage.setItem(LS_KEY, JSON.stringify(layout));
  }, [layout]);

  // Eingehende Panels nach gespeicherter Reihenfolge sortieren.
  // Unbekannte (neue) Panels behalten ihre Eingangsreihenfolge und
  // werden hinten angehängt (stabiler Sort).
  const sortPanels = useCallback((panels) => {
    const idx = new Map(layout.order.map((id, i) => [id, i]));
    return [...panels].sort((a, b) => {
      const ia = idx.has(a.id) ? idx.get(a.id) : Infinity;
      const ib = idx.has(b.id) ? idx.get(b.id) : Infinity;
      if (ia === ib) return 0;
      return ia < ib ? -1 : 1;
    });
  }, [layout.order]);

  const isHidden = useCallback(
    (id) => layout.hidden.includes(id),
    [layout.hidden],
  );

  const toggleHidden = useCallback((id) => {
    setLayout((prev) => {
      const set = new Set(prev.hidden);
      if (set.has(id)) set.delete(id);
      else set.add(id);
      return { ...prev, hidden: [...set] };
    });
  }, []);

  // Verschiebt `dragId` an die Position von `overId` innerhalb der
  // aktuell angezeigten Reihenfolge `allIds`.
  const reorder = useCallback((allIds, dragId, overId) => {
    if (dragId === overId) return;
    setLayout((prev) => {
      const base = [...allIds];
      const from = base.indexOf(dragId);
      const to   = base.indexOf(overId);
      if (from === -1 || to === -1) return prev;
      base.splice(to, 0, base.splice(from, 1)[0]);
      return { ...prev, order: base };
    });
  }, []);

  const reset = useCallback(() => setLayout({ order: [], hidden: [] }), []);

  return { sortPanels, isHidden, toggleHidden, reorder, reset, hiddenCount: layout.hidden.length };
}
