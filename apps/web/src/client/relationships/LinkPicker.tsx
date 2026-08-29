import type { StatusDef, WorkflowConfig } from "@loctt/contracts";
import { useState } from "react";

import { useTaskSearch } from "../api/hooks/useTaskSearch.ts";
import { StatusBadge } from "../list/cells.tsx";
import type { LinkKindOption } from "./group.ts";
import { linkKindOptions } from "./group.ts";

/**
 * "+ Add link" — kind first, then target (REL-7, REL-8, REL-29, REL-30,
 * REL-43).
 *
 * ## The kind list is the config, both sides of it
 *
 * REL-7. Every configured side is offerable, because "T-1 blocks T-2"
 * and "T-1 is blocked by T-2" are different statements and the user
 * may want either. Symmetric kinds appear once. Nothing is hardcoded:
 * a workspace with one relationship shows one option, and the option
 * text is the `label` / `inverse_label`, never the key.
 *
 * ## The picker stays open on a rejected add
 *
 * REL-22's fourth bullet, REL-43's third. A cycle refusal or a
 * nonexistent key leaves the typed text and the chosen kind in place
 * and renders the server's message *inside the picker*, at the control
 * the user acted on. Closing on failure would throw away the input
 * they need to correct, and a detached toast would put the reason
 * somewhere other than where the mistake was made (P4).
 *
 * ## Archived targets are refused before the request
 *
 * REL-30. Search already excludes them; the retired-key fallback can
 * still surface one, and selecting it is refused here by name with
 * unarchiving named as the next step — rather than letting core's
 * message be the only account of it. Core still refuses independently:
 * this is the near-side message, not the guard.
 */
export function LinkPicker({
  workflow,
  statusOf,
  selfId,
  selfKey,
  selfTitle,
  selfKeyHistory,
  pending,
  error,
  onSubmit,
  onCancel,
}: {
  readonly workflow: WorkflowConfig | undefined;
  readonly statusOf: (key: string | undefined) => StatusDef | undefined;
  readonly selfId: string;
  readonly selfKey: string;
  readonly selfTitle: string;
  /** Retired keys, which resolve to this task and so are also "self". */
  readonly selfKeyHistory: readonly string[];
  readonly pending: boolean;
  /** The server's own message from a rejected add, rendered verbatim. */
  readonly error: string | undefined;
  readonly onSubmit: (vars: { type: string; target: string }) => void;
  readonly onCancel: () => void;
}): React.JSX.Element {
  const options: readonly LinkKindOption[] = linkKindOptions(workflow);
  const [kind, setKind] = useState<string>(() => options[0]?.key ?? "");
  const [query, setQuery] = useState("");
  /**
   * A refusal raised here rather than by the server — currently only
   * the archived-target one. Kept apart from `error` so the caller's
   * server message is never overwritten by a local check and vice
   * versa.
   */
  const [localError, setLocalError] = useState<string | null>(null);

  const results = useTaskSearch(query, selfId);
  const trimmed = query.trim();

  /**
   * Whether the empty result set is empty *because the only match was
   * this task* — REL-29's first bullet, which is a different fact from
   * REL-43's "no task matches". Checked against the current key, every
   * retired key, and the ULID, because all three reach the same task.
   */
  const lower = trimmed.toLowerCase();
  const selfMatches =
    lower === selfKey.toLowerCase()
    || lower === selfId.toLowerCase()
    || selfKeyHistory.some(k => k.toLowerCase() === lower)
    || selfTitle.toLowerCase().includes(lower);

  const choose = (hit: { id: string; key: string; archived: boolean }): void => {
    if (hit.archived) {
      // REL-30's second and third bullets: name the target's key and
      // its state, and say what to do about it.
      setLocalError(
        `${hit.key} is archived, so it cannot be linked. Unarchive it first, `
        + `then add the link again.`,
      );
      return;
    }
    setLocalError(null);
    onSubmit({ type: kind, target: hit.key });
  };

  return (
    <div
      data-testid="link-picker"
      className="rounded-md border border-border-default bg-bg-surface-raised p-3"
    >
      <div className="mb-2 flex items-center gap-2">
        <label
          htmlFor="link-kind"
          className="text-[12px] font-medium text-text-secondary"
        >
          Kind
        </label>
        <select
          id="link-kind"
          data-testid="link-kind"
          value={kind}
          onChange={e => { setKind(e.target.value); }}
          className="rounded border border-border-subtle bg-bg-surface px-2 py-1 text-[13px] text-text-primary"
        >
          {options.map(o => (
            <option key={o.key} value={o.key}>{o.label}</option>
          ))}
        </select>
      </div>

      <label htmlFor="link-target" className="sr-only">
        Search for a task to link to {selfKey}
      </label>
      <input
        id="link-target"
        data-testid="link-target"
        autoFocus
        value={query}
        placeholder="Search by key or title…"
        onChange={e => {
          setQuery(e.target.value);
          setLocalError(null);
        }}
        onKeyDown={e => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onCancel();
          }
        }}
        className="w-full rounded border border-border-subtle bg-bg-surface px-2 py-1.5 text-[13px] text-text-primary"
      />

      {trimmed.length > 0 && (
        <ul
          data-testid="link-results"
          className="mt-2 max-h-56 list-none overflow-auto p-0"
        >
          {results.data?.map(hit => (
            <li key={hit.id}>
              <button
                type="button"
                data-testid="link-result"
                data-key={hit.key}
                disabled={pending}
                onClick={() => { choose(hit); }}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[13px] hover:bg-bg-muted"
              >
                <span className="shrink-0 font-mono text-[12px] text-text-secondary">
                  {hit.key}
                </span>
                {/* REL-8's fourth bullet: key + title + status, so two
                    similarly-titled tasks are distinguishable. */}
                <span className="min-w-0 flex-1 truncate text-text-primary">
                  {hit.title}
                </span>
                <StatusBadge def={statusOf(hit.status)} raw={hit.status} />
                {hit.archived && (
                  <span className="shrink-0 rounded bg-warning-fg/15 px-1 py-0.5 text-[11px] text-warning-fg">
                    Archived
                  </span>
                )}
                {hit.viaRetiredKey && (
                  <span className="shrink-0 text-[11px] text-text-tertiary">
                    former key
                  </span>
                )}
              </button>
            </li>
          ))}
          {results.isSuccess && results.data.length === 0 && (
            <li
              data-testid="link-no-results"
              className="px-2 py-1.5 text-[13px] text-text-tertiary"
            >
              {selfMatches
                ? (
                    /* REL-29's first bullet. The search *did* match —
                       it matched this task — and saying "no task
                       matches" would send the user hunting for a typo
                       in a key that is right in front of them. */
                    <>
                      “{trimmed}” is this task ({selfKey}). A task cannot link
                      to itself; search for a different one.
                    </>
                  )
                : (
                    /* REL-43's first two bullets. The typed text is named
                       back, and `key_history` is mentioned so a typo reads
                       differently from a key that was retired. */
                    <>
                      No task matches “{trimmed}”. Former keys resolve too, so
                      a retired key would have been found — check the spelling.
                    </>
                  )}
            </li>
          )}
        </ul>
      )}

      {(localError !== null || error !== undefined) && (
        <p
          role="alert"
          data-testid="link-error"
          className="mt-2 text-[13px] text-danger-fg"
        >
          {localError ?? error}
        </p>
      )}

      <div className="mt-2 flex justify-end">
        <button
          type="button"
          onClick={onCancel}
          className="rounded px-2 py-1 text-[13px] text-text-secondary hover:bg-bg-muted"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
