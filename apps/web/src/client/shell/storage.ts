/**
 * `localStorage` that cannot take the app down.
 *
 * SHL-18: with storage blocked (private mode, or a browser configured
 * to deny site data) every `localStorage` access throws a
 * `SecurityError`. Both shell preferences read storage during the
 * initial render, so an unguarded `getItem` took out the whole app at
 * boot — the shell never rendered at all.
 *
 * The contract: reads return `null` when storage is unavailable, and
 * writes are dropped. In-session state still works; it simply does not
 * survive a reload, which is the degradation the case asks for. No
 * toast — an unavailable store is the browser's decision, not an error
 * the user can act on.
 */

export function readLocal(key: string): string | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeLocal(key: string, value: string): void {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(key, value);
  } catch {
    // Blocked, or the quota is full. Neither is recoverable here and
    // neither should interrupt the interaction that triggered it.
  }
}

/**
 * `sessionStorage`, with the same contract as `readLocal`/`writeLocal`.
 *
 * Used for per-tab state that must survive a reload but not a closed
 * tab: the description editor's unsaved draft (A338). Blocked storage
 * or a full quota degrades to "no draft" silently, as above.
 */
export function readSession(key: string): string | null {
  try {
    if (typeof window === "undefined") return null;
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeSession(key: string, value: string): void {
  try {
    if (typeof window === "undefined") return;
    window.sessionStorage.setItem(key, value);
  } catch {
    // Blocked, or the quota is full. Dropped, as with `writeLocal`.
  }
}

export function removeSession(key: string): void {
  try {
    if (typeof window === "undefined") return;
    window.sessionStorage.removeItem(key);
  } catch {
    // Blocked: there is nothing stored to remove.
  }
}
