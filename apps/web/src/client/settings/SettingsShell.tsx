import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { useIsNarrow } from "../shell/useIsNarrow.ts";
import { Icon } from "../ui/Icon.tsx";
import { Sheet } from "../ui/Sheet.tsx";
import { BackupPanel } from "./BackupPanel.tsx";
import { BoardColumnsPanel } from "./BoardColumnsPanel.tsx";
import { CalendarPanel } from "./CalendarPanel.tsx";
import { CardLayoutPanel } from "./CardLayoutPanel.tsx";
import { CustomFieldsPanel } from "./CustomFieldsPanel.tsx";
import { DiagnosticsPanel } from "./DiagnosticsPanel.tsx";
import { EnumCollectionPanel } from "./EnumCollectionPanel.tsx";
import { EstimationPanel } from "./EstimationPanel.tsx";
import { GitSyncPanel } from "./GitSyncPanel.tsx";
import { KeyboardPanel } from "./KeyboardPanel.tsx";
import { LabelsPanel } from "./LabelsPanel.tsx";
import { MilestonesPanel } from "./MilestonesPanel.tsx";
import { PreferencesPanel } from "./PreferencesPanel.tsx";
import { ProjectsPanel } from "./ProjectsPanel.tsx";
import { RelationshipsSettingsPanel } from "./RelationshipsSettingsPanel.tsx";
import { SavedViewsPanel } from "./SavedViewsPanel.tsx";
import {
  findSection,
  sectionsInGroup,
  SETTINGS_GROUPS,
  type SettingsSection,
} from "./sections.ts";
import { SidebarGroupsPanel } from "./SidebarGroupsPanel.tsx";
import { SidebarPinsPanel } from "./SidebarPinsPanel.tsx";
import { SprintsPanel } from "./SprintsPanel.tsx";
import { TimelinePanel } from "./TimelinePanel.tsx";
import { UsersPanel } from "./UsersPanel.tsx";

/**
 * The `/settings/$section` shell (SET-2, SET-32, SET-42).
 *
 * The nav is rendered by the shell and is **never** replaced by a
 * panel's failure: SET-42 wants the nav intact while the API is down,
 * and SET-32 wants it intact for an unknown section. That is why the
 * nav lives here and each panel owns only its own content pane — a
 * panel that throws takes the pane, not the page.
 */

/** The grouped section links, shared by the md+ side rail and the mobile
 *  picker sheet. `onNavigate` lets the sheet close itself on a pick. */
function SectionLinks({ active, onNavigate }: { readonly active: string; readonly onNavigate?: () => void }) {
  return (
    <>
      {SETTINGS_GROUPS.map(group => (
        <div key={group} className="mb-4 last:mb-0 md:last:mb-0">
          {/* Non-interactive heading (SET-2): it neither navigates nor
              collapses, so it cannot navigate away by accident. */}
          <h2 className="mb-1 px-2 text-[0.7857rem] font-semibold uppercase tracking-wide text-text-tertiary">
            {group}
          </h2>
          <ul className="list-none p-0 m-0">
            {sectionsInGroup(group).map(section => (
              <li key={section.id}>
                <Link
                  to="/settings/$section"
                  params={{ section: section.id }}
                  data-testid={`settings-nav-${section.id}`}
                  aria-current={section.id === active ? "page" : undefined}
                  onClick={onNavigate}
                  className={
                    "block rounded-md px-2 py-1 text-[0.9286rem] no-underline "
                    + (section.id === active
                      ? "bg-bg-muted font-medium text-text-primary"
                      : "text-text-secondary hover:bg-bg-muted")
                  }
                >
                  {section.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </>
  );
}

function SectionNav({ active }: { readonly active: string }) {
  const isNarrow = useIsNarrow(768); // md
  const [pickerOpen, setPickerOpen] = useState(false);

  // Below md: a single picker button naming the current section, opening a
  // sheet with the full grouped list — 24 links stacked above every panel
  // pushed the content a full screen down (UX eval #6). At md+ the fixed
  // side rail is unchanged.
  if (isNarrow) {
    const current = findSection(active);
    return (
      <>
        <nav aria-label="Settings sections" data-testid="settings-nav" className="w-full border-b border-border-subtle bg-bg-surface p-3">
          <button
            type="button"
            data-testid="settings-nav-picker"
            onClick={() => { setPickerOpen(true); }}
            className="flex w-full items-center justify-between rounded-md border border-border-default px-3 py-2 text-[0.9286rem] text-text-primary hover:bg-bg-muted"
          >
            <span><span className="text-text-tertiary">Settings — </span>{current?.label ?? active}</span>
            <Icon name="chevronDown" className="text-text-tertiary" />
          </button>
        </nav>
        {pickerOpen && (
          <Sheet title="Settings" testId="settings-nav-sheet" onClose={() => { setPickerOpen(false); }}>
            <SectionLinks active={active} onNavigate={() => { setPickerOpen(false); }} />
          </Sheet>
        )}
      </>
    );
  }

  return (
    <nav
      aria-label="Settings sections"
      data-testid="settings-nav"
      // At `md`+ the fixed side rail, scrolling vertically so a long
      // section list cannot overflow a short viewport.
      className="w-full max-h-none overflow-y-auto border-b border-border-subtle bg-bg-surface p-3 md:w-56 md:shrink-0 md:border-r md:border-b-0"
    >
      <SectionLinks active={active} />
    </nav>
  );
}

/**
 * SET-32: an unknown section. Rendered *inside* the content pane with
 * the nav still standing, naming what was asked for and listing the
 * valid sections. Deliberately not a redirect — a silent redirect
 * hides that the pasted link was wrong.
 */
function UnknownSection({ requested }: { readonly requested: string }) {
  return (
    <div role="alert" data-testid="settings-unknown-section">
      <h1 className="mb-2 text-lg font-semibold text-text-primary">
        No settings section called{" "}
        <code className="rounded bg-bg-muted px-1 py-0.5 text-[1.0714rem]">
          {requested}
        </code>
      </h1>
      <p className="mb-4 text-[0.9286rem] text-text-secondary">
        The link may have a typo, or the section may have been renamed.
        These are the sections this tracker has:
      </p>
      <ul className="m-0 grid list-none grid-cols-2 gap-x-6 gap-y-1 p-0">
        {SETTINGS_GROUPS.flatMap(g => sectionsInGroup(g)).map(s => (
          <li key={s.id}>
            <Link
              to="/settings/$section"
              params={{ section: s.id }}
              className="text-[0.9286rem] text-accent hover:underline"
            >
              {s.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A section that is real but whose panel has not been built yet. */
function NotBuiltYet({ section }: { readonly section: SettingsSection }) {
  return (
    <div data-testid="settings-not-built">
      <h1 className="mb-2 text-lg font-semibold text-text-primary">
        {section.label}
      </h1>
      <p className="text-[0.9286rem] text-text-secondary">
        This panel is not built yet. Its settings can be changed by
        editing the files under{" "}
        <code className="rounded bg-bg-muted px-1 py-0.5">
          .loctt/config/
        </code>{" "}
        or with the <code className="font-mono">loctt</code> CLI.
      </p>
    </div>
  );
}

function Panel({ section }: { readonly section: SettingsSection }) {
  if (section.id === "projects") return <ProjectsPanel />;
  if (section.id === "users") return <UsersPanel />;
  if (section.id === "statuses") return <EnumCollectionPanel collection="statuses" />;
  if (section.id === "priorities") return <EnumCollectionPanel collection="priorities" />;
  if (section.id === "task-types") return <EnumCollectionPanel collection="task_types" />;

  if (section.id === "relationships") return <RelationshipsSettingsPanel />;
  if (section.id === "custom-fields") return <CustomFieldsPanel />;
  if (section.id === "estimation") return <EstimationPanel />;
  if (section.id === "calendar") return <CalendarPanel />;
  if (section.id === "labels") return <LabelsPanel />;
  if (section.id === "milestones") return <MilestonesPanel />;
  if (section.id === "sprints") return <SprintsPanel />;
  if (section.id === "saved-views") return <SavedViewsPanel />;
  if (section.id === "board-columns") return <BoardColumnsPanel />;
  if (section.id === "timeline") return <TimelinePanel />;
  if (section.id === "sync") return <GitSyncPanel />;
  if (section.id === "backup") return <BackupPanel />;
  if (section.id === "diagnostics") return <DiagnosticsPanel />;

  // Personal (M4.4).
  if (section.id === "preferences") return <PreferencesPanel />;
  if (section.id === "card-layout") return <CardLayoutPanel />;
  if (section.id === "sidebar-pins") return <SidebarPinsPanel />;
  if (section.id === "sidebar-groups") return <SidebarGroupsPanel />;
  if (section.id === "keyboard") return <KeyboardPanel />;
  return <NotBuiltYet section={section} />;
}

export function SettingsShell({ section }: { readonly section: string }) {
  const resolved = findSection(section);
  return (
    // A `div`, not a `main` — the shell above already owns `<main>`.
    // R1: `flex-col` below `md` stacks the section bar above the pane so
    // neither is crushed on a narrow viewport; `md:flex-row` restores the
    // two-pane side-rail layout. `overflow-hidden` keeps the shell from
    // forcing horizontal body scroll — overflow lives in the panes.
    <div className="flex h-full flex-col overflow-hidden bg-bg-canvas font-sans text-text-primary md:flex-row">
      <SectionNav active={section} />
      {/* The settings pane owns the panel padding — one source of truth
          (K-layout). Every panel (and the frame the workflow panels share)
          renders with no outer page padding of its own, so switching
          sections cannot shift the content in or out. A nested sub-panel
          like ReconcilePanel adds no page padding for the same reason. */}
      <div data-testid="settings-pane" className="min-w-0 flex-1 overflow-auto p-8">
        {resolved
          ? <Panel section={resolved} />
          : <UnknownSection requested={section} />}
      </div>
    </div>
  );
}
