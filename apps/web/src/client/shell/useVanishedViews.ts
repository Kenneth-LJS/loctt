import { useEffect, useRef, useState } from "react";

import { readLocal, writeLocal } from "./storage.ts";

/**
 * Saved views that were in the sidebar and are not any more.
 *
 * SHL-32: a pin that vanishes without explanation is drift the user
 * cannot account for — they may have edited a different view, or on
 * another machine. `/api/views` simply omits a deleted view, so the
 * only way to notice is to remember what was there.
 *
 * The remembered set is per-browser and survives a reload, because
 * the case's scenario is "delete it while the UI is open, **then
 * refresh**" — an in-memory set would forget across exactly the
 * action that reveals the problem.
 *
 * Dismissing removes the pin, which here means forgetting the name:
 * the view is already gone from the config, so there is nothing else
 * to remove.
 */

const STORAGE_KEY = "tt-known-views";

interface KnownView {
  readonly id: string;
  readonly name: string;
}

function readKnown(): KnownView[] {
  const raw = readLocal(STORAGE_KEY);
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (v): v is KnownView =>
        typeof v === "object" && v !== null
        && typeof (v as KnownView).id === "string"
        && typeof (v as KnownView).name === "string",
    );
  } catch {
    // A corrupt store is not the user's problem and not worth a
    // message: forget everything and start remembering again.
    return [];
  }
}

export function useVanishedViews(
  current: readonly { id: string; name: string }[] | undefined,
): { vanished: readonly KnownView[]; dismiss: (id: string) => void } {
  const [vanished, setVanished] = useState<readonly KnownView[]>([]);
  // Names that have been explained and dismissed this session, so a
  // re-render does not resurrect them before the store write lands.
  const dismissed = useRef(new Set<string>());

  useEffect(() => {
    // `undefined` is "not loaded yet", which is not the same as "no
    // views" — treating it as the latter would report every pin as
    // vanished on the first frame of every load.
    if (current === undefined) return;

    const known = readKnown();
    const currentIds = new Set(current.map(v => v.id));
    const gone = known.filter(
      v => !currentIds.has(v.id) && !dismissed.current.has(v.id),
    );
    setVanished(gone);

    // Remember what exists now, plus anything still unexplained, so
    // the report survives the refresh the case describes.
    writeLocal(
      STORAGE_KEY,
      JSON.stringify([...current.map(v => ({ id: v.id, name: v.name })), ...gone]),
    );
  }, [current]);

  const dismiss = (id: string): void => {
    dismissed.current.add(id);
    setVanished(prev => prev.filter(v => v.id !== id));
    writeLocal(
      STORAGE_KEY,
      JSON.stringify(readKnown().filter(v => v.id !== id)),
    );
  };

  return { vanished, dismiss };
}
