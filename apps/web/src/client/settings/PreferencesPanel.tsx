import type { ThemePreference, UserSettings } from "@loctt/contracts";
import { Link } from "@tanstack/react-router";
import { useEffect } from "react";

import { useProjects } from "../api/hooks/sidebarData.ts";
import { useUserSettingsMutation } from "../api/hooks/useUserSettingsMutation.ts";
import { useUserSettings } from "../api/hooks/useWorkflow.ts";
import { adoptStoredTheme, useTheme } from "../theme/useTheme.ts";
import { Combobox, ComboboxButton, type ComboboxOption } from "../ui/Combobox.tsx";
import { ErrorState } from "../ui/ErrorState.tsx";
import { LoadingState } from "../ui/LoadingState.tsx";
import { ToolbarButton } from "../ui/ToolbarButton.tsx";

/**
 * Settings → Personal → My preferences (SET-11, PRU-14).
 *
 * Two preferences live here: the theme picker and the personal default
 * project.
 *
 * ## Theme is written to `settings.yaml`, not only to localStorage
 *
 * `useTheme` already stored the choice per browser, which is what
 * repaints without a flash on the next load. SET-11 asks for more:
 * the choice must be "written to the acting user's `settings.yaml`",
 * survive a server restart, and follow the *user* — switching to
 * another user shows theirs, switching back restores dark. A
 * per-browser key cannot do that; it is per-browser, not per-user.
 *
 * So both are written. localStorage stays the pre-mount cache (the
 * flash guard in `applyInitialTheme` runs before React, and therefore
 * before any fetch could answer); `settings.yaml` is the durable,
 * per-user truth that seeds it.
 *
 * ## PRU-14: the dead default is surfaced *here*
 *
 * A `default_project` pointing at a deleted project falls through to
 * the workspace default everywhere it is used, and the create modal
 * stays deliberately quiet about it — blocking a create over a stale
 * preference would be worse than falling through. But P7 admits no
 * carve-out for per-user preference drift, so the value has to appear
 * somewhere, and the case names the place: "Settings → My preferences
 * shows the default as unresolvable, naming `archive_me`".
 */

const THEMES: readonly { id: ThemePreference; label: string }[] = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
  { id: "system", label: "System" },
];

export function PreferencesPanel() {
  const settings = useUserSettings();
  const projects = useProjects();
  const save = useUserSettingsMutation();
  const { preference, setPreference } = useTheme();

  // The picker must show the *acting user's* stored choice, not
  // whatever this browser last cached. The shell adopts it on load
  // too, but the panel cannot depend on having been mounted under a
  // shell that already did: rendered on its own it would otherwise
  // report the previous user's theme as this user's setting (P1).
  const storedTheme = settings.data?.settings?.theme;
  useEffect(() => {
    if (storedTheme !== undefined) adoptStoredTheme(storedTheme);
  }, [storedTheme]);

  if (settings.isError) {
    return (
      <div>
        <h1 className="mb-2 text-lg font-semibold text-text-primary">My preferences</h1>
        <ErrorState
          error={settings.error}
          onRetry={() => { void settings.refetch(); }}
          context="reading your personal settings"
        />
      </div>
    );
  }
  if (settings.isLoading || settings.data === undefined) {
    return <LoadingState>Loading preferences…</LoadingState>;
  }

  const stored = settings.data.settings;

  /** Whole-document write: `PUT /api/user-settings` has no PATCH. */
  const patch = (next: Partial<UserSettings>): void => {
    save.mutate({ ...stored, ...next } as UserSettings);
  };

  const onPickTheme = (next: ThemePreference): void => {
    // Repaint first so the picker is not waiting on a round trip, then
    // persist. SET-11's first bullet is "picking dark repaints
    // immediately"; its second is that the choice reaches the file.
    setPreference(next);
    patch({ theme: next });
  };

  const items = projects.data?.items ?? [];
  const personalDefault = stored.default_project;
  // The dead value: set, but naming a project that is not there any
  // more. `projects.data === undefined` is "not loaded", which is not
  // evidence of absence — reporting it as unresolvable then would
  // accuse a healthy tracker on every first frame.
  const defaultIsDead =
    personalDefault !== undefined
    && projects.data !== undefined
    && !items.some(p => p.id === personalDefault);

  return (
    <div data-testid="preferences-panel">
      <h1 className="mb-6 text-lg font-semibold text-text-primary">My preferences</h1>

      <section className="mb-8">
        <h2 className="mb-1 text-[0.9286rem] font-semibold text-text-primary">Theme</h2>
        <p className="mb-2 text-[0.8571rem] text-text-secondary">
          Stored against your user, so it follows you between browsers.
          <span className="ml-1">system</span> tracks your OS setting.
        </p>
        <div role="radiogroup" aria-label="Theme" className="flex gap-2">
          {THEMES.map(t => (
            <ToolbarButton
              key={t.id}
              type="button"
              role="radio"
              aria-checked={preference === t.id}
              active={preference === t.id}
              testId={`theme-${t.id}`}
              onClick={() => { onPickTheme(t.id); }}
            >
              {t.label}
            </ToolbarButton>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-1 text-[0.9286rem] font-semibold text-text-primary">
          Default project
        </h2>
        <p className="mb-2 text-[0.8571rem] text-text-secondary">
          Where new tasks land when you do not pick a project. An explicit
          choice in the create form always wins.
        </p>
        {/* CONFIG-5 / P4: this is the *personal* default; the workspace
            default (the fallback when a user has none) is a different
            setting on a different panel. Cross-link so the two "default
            project" concepts are not mistaken for one. */}
        <p className="mb-2 text-[0.7857rem] text-text-tertiary">
          The workspace-wide fallback is in{" "}
          <Link
            to="/settings/$section"
            params={{ section: "projects" }}
            data-testid="preferences-workspace-default-link"
            className="text-accent underline hover:text-text-primary"
          >
            Settings → Projects
          </Link>
          .
        </p>

        {defaultIsDead ? (
          /* Not `role="alert"`: the user is reading a preferences page,
             not being interrupted. PRU-14 wants it surfaced here and
             quiet in the create modal. */
          <p
            role="status"
            data-testid="default-project-unresolvable"
            className="mb-2 rounded-md border border-border-subtle bg-warn-bg px-2 py-1 text-[0.8571rem] text-warn-fg"
          >
            Your default project{" "}
            <code>{personalDefault}</code> no longer
            exists. New tasks fall through to the workspace default until you
            pick another.
          </p>
        ) : null}

        {(() => {
          // Choosing "no personal default" removes the key rather than
          // storing "", which the contract rejects anyway
          // (`z.string().min(1)`).
          const clearDefault = (): void => {
            const { default_project: _dropped, ...rest } = stored;
            save.mutate(rest as UserSettings);
          };
          const active = items.filter(p => p.archived !== true);
          const projectOptions: ComboboxOption[] = active.map(p => ({ key: p.id, label: p.name }));
          // The trigger label: the picked project's name, or empty (the
          // placeholder) for "no personal default". A dead value shows as
          // empty here — the unresolvable notice above names it.
          const selectedValue = defaultIsDead ? undefined : personalDefault;
          const selectedLabel = selectedValue === undefined
            ? ""
            : active.find(p => p.id === selectedValue)?.name ?? "";
          return (
            // A211: the project list grows with the workspace — a
            // searchable Combobox, not a native <select>. "No personal
            // default" is the clear row.
            <Combobox
              label="Default project"
              options={projectOptions}
              value={selectedValue}
              onSelect={v => { patch({ default_project: v }); }}
              clear={{
                label: "No personal default (use the workspace default)",
                onClear: clearDefault,
                testId: "default-project-clear",
              }}
              listTestId="default-project-list"
              optionTestId={o => `default-project-option-${o.key}`}
              searchTestId="default-project-search"
              trigger={p => (
                <ComboboxButton
                  {...p}
                  testId="default-project-select"
                  dataValue={selectedValue ?? ""}
                  aria-label="Default project"
                  placeholder="No personal default (use the workspace default)"
                >
                  {selectedLabel}
                </ComboboxButton>
              )}
            />
          );
        })()}
      </section>

      {save.isError ? (
        // Was a generic "not saved" line that dropped the server's own
        // reason and offered no way to try again. ErrorState carries the
        // server message + Retry (re-sends the last write) — the standard
        // the rest of the app holds. The write is optimistic and rolled
        // back on failure, so the panel is already showing the last saved
        // values; the context line says so.
        <div className="mt-4" data-testid="preferences-save-error">
          <ErrorState
            error={save.error}
            context="Your preferences were not saved — the last saved values are shown"
            {...(save.variables !== undefined
              ? { onRetry: () => { save.mutate(save.variables); } }
              : {})}
          />
        </div>
      ) : null}
    </div>
  );
}
