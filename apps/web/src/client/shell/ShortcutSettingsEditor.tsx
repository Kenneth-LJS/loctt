import { useId, useState } from "react";

import { isUnknownOutcome } from "../api/client.ts";
import { Button } from "../ui/Button.tsx";
import { Callout } from "../ui/Callout.tsx";
import { ConfirmDialog } from "../ui/ConfirmDialog.tsx";
import { ErrorState } from "../ui/ErrorState.tsx";
import { LoadingState } from "../ui/LoadingState.tsx";
import { Toggle } from "../ui/Toggle.tsx";
import { groupsOf, ShortcutKeys } from "./ShortcutKeys.tsx";
import { useKeyboardShortcutSettings } from "./useKeyboardShortcutSettings.ts";

/**
 * The single-key shortcut switches (K133, A11Y-43), as one component
 * used in two places: Settings → Personal → Keyboard, and the `?`
 * dialog's Customize view. One component so the two cannot drift.
 *
 * Top to bottom: the master "Single-key shortcuts" switch; the
 * shortcuts grouped as the `?` dialog groups them, each with its keys
 * (display only, K133 has no rebinding) and its own switch; "Reset to
 * default", which asks first and then turns everything back on.
 *
 * While the master is off, the per-shortcut switches are disabled but
 * keep their state (as the K125 Filters group's children do), so
 * turning the master back on restores the user's choices.
 */
/**
 * The sentence for a shortcut switch whose save failed. A timed-out
 * write may have landed, so it gets K134's unknown-outcome wording
 * rather than a claim that nothing was saved (A350).
 */
export function shortcutSaveFailure(err: unknown): string {
  return isUnknownOutcome(err)
    ? "Your changes may not have been saved. Please try again."
    : "Couldn't save your shortcut settings. Try again.";
}

export function ShortcutSettingsEditor({
  testIdPrefix = "shortcut-settings",
  headingLevel = 3,
}: {
  readonly testIdPrefix?: string;
  /**
   * The level of the group headings. They sit one below whatever heads
   * the editor: the `?` dialog's title is an h2, Settings → Keyboard's
   * is an h1 and its reference groups beside the editor are h2 (A350).
   */
  readonly headingLevel?: 2 | 3;
}) {
  const GroupHeading = headingLevel === 2 ? "h2" : "h3";
  const { state, change, reset, settingsQuery, save } = useKeyboardShortcutSettings();
  const [confirmReset, setConfirmReset] = useState(false);
  const masterId = useId();

  if (settingsQuery.isError) {
    return (
      <ErrorState
        error={settingsQuery.error}
        onRetry={() => { void settingsQuery.refetch(); }}
        context="reading your shortcut settings"
      />
    );
  }
  if (settingsQuery.data === undefined) {
    return <LoadingState>Loading shortcuts…</LoadingState>;
  }

  return (
    <div data-testid={testIdPrefix} data-single-key={state.singleKey ? "on" : "off"}>
      <div className="mb-4 flex min-h-[24px] items-center justify-between gap-3">
        <label htmlFor={masterId} className="text-[0.9286rem] font-semibold text-text-primary">
          Single-key shortcuts
        </label>
        <Toggle
          id={masterId}
          checked={state.singleKey}
          onChange={e => { change({ singleKey: e.currentTarget.checked }); }}
          data-testid={`${testIdPrefix}-master`}
        />
      </div>

      {groupsOf(state.shortcuts).map(({ group, items }) => (
        <section key={group} className="mb-4">
          <GroupHeading className="mb-1.5 text-[0.8571rem] font-semibold uppercase tracking-wide text-text-tertiary">
            {group}
          </GroupHeading>
          <ul className="m-0 list-none p-0">
            {items.map(s => (
              <li
                key={s.id}
                data-testid={`${testIdPrefix}-row-${s.id}`}
                data-active={s.active ? "true" : "false"}
                className="flex min-h-[32px] items-center justify-between gap-3 border-b border-border-subtle py-1 last:border-b-0"
              >
                <span
                  className={[
                    "flex-1 text-[0.9286rem]",
                    state.singleKey ? "text-text-primary" : "text-text-tertiary",
                  ].join(" ")}
                >
                  {s.action}
                </span>
                <span className="shrink-0">
                  <ShortcutKeys spec={s} />
                </span>
                <Toggle
                  checked={s.on}
                  disabled={!state.singleKey}
                  onChange={e => {
                    const on = e.currentTarget.checked;
                    change(on ? { on: [s.id] } : { off: [s.id] });
                  }}
                  data-testid={`${testIdPrefix}-toggle-${s.id}`}
                  aria-label={s.action}
                />
              </li>
            ))}
          </ul>
        </section>
      ))}

      {save.isError ? (
        <Callout tone="danger" role="alert" testId={`${testIdPrefix}-error`} className="mb-3">
          {shortcutSaveFailure(save.error)}
        </Callout>
      ) : null}

      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => { setConfirmReset(true); }}
        testId={`${testIdPrefix}-reset`}
      >
        Reset to default
      </Button>

      {confirmReset ? (
        <ConfirmDialog
          title="Reset all shortcuts to their defaults?"
          confirmLabel="Reset"
          onConfirm={() => {
            reset();
            setConfirmReset(false);
          }}
          onCancel={() => { setConfirmReset(false); }}
          testId={`${testIdPrefix}-reset-dialog`}
          confirmTestId={`${testIdPrefix}-reset-confirm`}
          cancelTestId={`${testIdPrefix}-reset-cancel`}
        />
      ) : null}
    </div>
  );
}
