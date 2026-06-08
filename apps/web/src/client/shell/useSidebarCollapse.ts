import { useCallback, useEffect, useState } from "react";

/**
 * Collapsed/expanded state for the app sidebar, persisted to
 * localStorage under `tt-sidebar-collapsed` ("1" / "0") to match the
 * mockup's key so the preference carries over from the static mockups.
 *
 * The `[` keyboard shortcut toggles it (also per the mockup). The
 * listener is installed once and ignores keystrokes while a text input
 * or textarea is focused, so typing `[` in the search box or a future
 * editor doesn't fold the sidebar.
 */

const STORAGE_KEY = "tt-sidebar-collapsed";

function readStored(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(STORAGE_KEY) === "1";
}

function isEditableTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable;
}

export function useSidebarCollapse(): {
  collapsed: boolean;
  toggle: () => void;
} {
  const [collapsed, setCollapsed] = useState<boolean>(readStored);

  const toggle = useCallback(() => {
    setCollapsed(prev => {
      const next = !prev;
      if (typeof window !== "undefined") {
        window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      }
      return next;
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "[" || e.metaKey || e.ctrlKey || e.altKey) return;
      if (isEditableTarget(e.target)) return;
      e.preventDefault();
      toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  return { collapsed, toggle };
}
