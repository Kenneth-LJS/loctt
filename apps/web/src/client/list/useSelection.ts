import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Row selection for the list view.
 *
 * BLK-18 allows two designs: clear the selection when the result set
 * changes, or keep it and state exactly how many selected tasks are no
 * longer visible. This implements the first. The second requires the
 * bar to carry a second count and every bulk action to target rows the
 * user cannot see — which is the situation BLK-18 exists to prevent,
 * and it is only worth that complexity if someone actually wants
 * cross-filter selection. Nobody has asked.
 *
 * What the case forbids either way is silence: a bar still claiming
 * "20 tasks selected" while operating on rows that scrolled out of the
 * filter. Clearing makes that unrepresentable.
 */
export interface Selection {
  readonly selected: ReadonlySet<string>;
  readonly count: number;
  readonly isSelected: (id: string) => boolean;
  readonly toggle: (id: string) => void;
  /** Selects exactly the ids given, replacing any current selection. */
  readonly selectAll: (ids: readonly string[]) => void;
  readonly clear: () => void;
}

export function useSelection(resultSetKey: string): Selection {
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());

  // Clearing runs in an effect keyed on the result set rather than in
  // the render body, so it happens once per change instead of on every
  // render that observes a new key.
  const previousKey = useRef(resultSetKey);
  useEffect(() => {
    if (previousKey.current === resultSetKey) return;
    previousKey.current = resultSetKey;
    setSelected(prev => (prev.size === 0 ? prev : new Set()));
  }, [resultSetKey]);

  const toggle = useCallback((id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback((ids: readonly string[]) => {
    // Replaces rather than unions. Through the UI the two are
    // indistinguishable — a union would only differ if the selection
    // held ids outside the current page, which clear-on-change makes
    // unreachable — but the hook's own contract is a replace, and
    // useSelection.test.ts pins it.
    setSelected(new Set(ids));
  }, []);

  const clear = useCallback(() => {
    setSelected(prev => (prev.size === 0 ? prev : new Set()));
  }, []);

  const isSelected = useCallback((id: string) => selected.has(id), [selected]);

  return {
    selected,
    count: selected.size,
    isSelected,
    toggle,
    selectAll,
    clear,
  };
}
