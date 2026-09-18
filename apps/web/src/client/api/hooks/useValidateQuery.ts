import { useEffect, useState } from "react";

import { apiClient } from "../client.ts";

/**
 * Live DSL validation for the advanced editor (VUE-8, VUE-31..34,
 * A11Y-53).
 *
 * The four error kinds come from the server, which derives them from
 * core's error *classes* — see `handleValidateQuery`. The client does
 * not re-derive them by matching message text, so rewording core's
 * copy cannot silently change which state the UI renders.
 */
export interface QueryValidation {
  readonly valid: boolean;
  readonly kind?: "syntax" | "unknown_field" | "unknown_value";
  readonly message?: string;
  readonly position?: number;
  readonly suggestions?: readonly string[];
}

/**
 * Debounced so the marker updates *while typing* (VUE-8) without a
 * request per keystroke, and so the error is announced on settle
 * rather than on every keystroke (A11Y-53). `settleMs` is injectable
 * to keep tests off real timers.
 */
export function useValidateQuery(query: string, settleMs = 300): {
  readonly result: QueryValidation | null;
  readonly settled: boolean;
} {
  const [result, setResult] = useState<QueryValidation | null>(null);
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    // An empty box is not an error the user needs shouting about —
    // it is the starting state. Clearing here also prevents a stale
    // marker from a previous query outliving the text it described.
    if (query.trim().length === 0) {
      setResult(null);
      setSettled(false);
      return;
    }

    setSettled(false);
    let cancelled = false;
    const t = setTimeout(() => {
      void apiClient
        .post<QueryValidation>("/api/query/validate", { query })
        .then(r => {
          if (cancelled) return;
          setResult(r);
          setSettled(true);
        })
        .catch(() => {
          // A validation request that itself fails must not be shown
          // as a *query* error — the query may be fine. Leaving the
          // previous marker is wrong too, so the marker clears and
          // the run action reports the failure (VUE-39).
          if (cancelled) return;
          setResult(null);
          setSettled(true);
        });
    }, settleMs);

    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, settleMs]);

  return { result, settled };
}
