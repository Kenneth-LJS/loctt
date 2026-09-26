import type { WorkflowConfig } from "@loctt/contracts";
import type { ReactNode } from "react";

import { ApiError } from "../api/client.ts";
import { useWorkflow } from "../api/hooks/useWorkflow.ts";
import { useWorkflowUsage } from "../api/hooks/useWorkflowMutations.ts";
import { Button } from "../ui/Button.tsx";
import { ErrorState } from "../ui/ErrorState.tsx";
import { LoadingState } from "../ui/LoadingState.tsx";
import { SettingsPanelHeader } from "./SettingsPanelHeader.tsx";

/**
 * The shell every Workflow panel sits in (SET-3, SET-33, SET-42).
 *
 * One frame rather than four copies, because three of the cases here
 * are about what happens when the config *cannot* be read, and that
 * answer has to be identical in every panel:
 *
 *  - SET-33: an invalid `workflow.yaml` shows the validation error
 *    naming the file and the offending entry — not an empty list,
 *    which would read as "you have no statuses configured", and not a
 *    stack trace. A Reload control re-parses without a server restart.
 *  - SET-42: an unreachable server is a different screen again, and
 *    the nav (owned by the shell above) stays standing either way.
 */

export function WorkflowPanelFrame({
  title,
  actions,
  children,
}: {
  readonly title: string;
  /**
   * A329 (B7): the panel's create control, rendered through
   * `SettingsPanelHeader`'s actions slot so title+actions match every
   * other Settings panel. Omitted by panels with no single create action
   * (Board columns keeps its own below-list "Add" — a different action,
   * per A329).
   */
  readonly actions?: ReactNode;
  readonly children: (args: {
    readonly workflow: WorkflowConfig;
    readonly usage: ReturnType<typeof useWorkflowUsage>["data"];
  }) => ReactNode;
}) {
  const workflow = useWorkflow();
  const usage = useWorkflowUsage();

  // A329: was a bare `<h1>`; switched to `SettingsPanelHeader` so
  // title+actions align with the rest of Settings while keeping the same
  // `data-testid="settings-panel-title"` every consumer already queries.
  const header = <SettingsPanelHeader title={title} {...(actions !== undefined ? { actions } : {})} />;

  // SET-33 vs SET-42: a config that will not parse and a server that is
  // not answering are different failures and must not render the same.
  // The 400 envelope's `config_invalid` is what separates them.
  if (workflow.isError) {
    const envelope = workflow.error instanceof ApiError ? workflow.error.envelope : undefined;
    const isConfigInvalid = envelope?.code === "config_invalid";
    return (
      <div data-testid="workflow-panel-error">
        {header}
        <div
          data-workflow-error={isConfigInvalid ? "config-invalid" : "unreachable"}
        >
          <ErrorState
            error={workflow.error}
            onRetry={() => { void workflow.refetch(); }}
            context={
              isConfigInvalid
                ? "reading .loctt/config/workflow.yaml"
                : "the workflow configuration"
            }
          />
          {/* SET-33: "A Reload action re-parses without a server
              restart." `ErrorState` renders a Retry only when the
              envelope's recovery is `retry`, and core marks a config
              error `command` — so on the one failure that most needs
              a re-read there was no control at all. This is that
              control, and it re-runs the query rather than reloading
              the page: the point of the case is that the *server* need
              not restart. */}
          <Button
            variant="secondary"
            testId="workflow-reload"
            onClick={() => { void workflow.refetch(); }}
            className="mt-3"
          >
            Reload from disk
          </Button>
        </div>
      </div>
    );
  }

  if (workflow.isLoading || workflow.data === undefined) {
    return (
      <div>
        {header}
        <LoadingState className="text-[0.9286rem] text-text-tertiary">Loading workflow…</LoadingState>
      </div>
    );
  }

  // SET-33: the tolerant loader does not throw on a hand-broken entry —
  // it returns a 200 with the bad entry omitted from its sub-list and
  // recorded under `broken`. Without this branch the panel rendered an
  // empty list, which reads as "you have no statuses configured" and
  // hides the real problem (K32). A broken sub-list gets the same error
  // surface an unparseable config would, distinct from an empty list and
  // from an unreachable server, naming the file and each entry's error.
  const broken = workflow.data.broken;
  const brokenPath = usage.data?.path ?? ".loctt/config/workflow.yaml";
  const brokenEntries: { sub: string; index: number; error: string; rawText: string }[] =
    broken === undefined
      ? []
      : (["statuses", "priorities", "task_types", "relationships", "custom_fields"] as const)
        .flatMap(sub =>
          (broken[sub] ?? []).map(e => ({
            sub, index: e.index, error: e.error, rawText: e.rawText,
          })));
  if (brokenEntries.length > 0) {
    return (
      <div data-testid="workflow-panel-error">
        {header}
        <div data-workflow-error="config-invalid">
          <div className="rounded-md border border-danger-fg/40 bg-bg-muted p-3 text-[0.9286rem]">
            <p className="font-medium text-danger-fg">
              {brokenPath} has an entry that does not parse.
            </p>
            <p className="mt-1 text-text-secondary">
              These entries were skipped. Fix them in the file, then reload.
            </p>
            <ul className="mt-2 list-none space-y-1 p-0" data-testid="workflow-broken-list">
              {brokenEntries.map(e => (
                <li
                  key={`${e.sub}-${String(e.index)}`}
                  data-testid={`workflow-broken-${e.sub}-${String(e.index)}`}
                  className="text-[0.8571rem] text-text-secondary"
                >
                  <code className="rounded bg-bg-surface px-1 py-0.5">
                    {e.sub}[{e.index}]
                  </code>{" "}
                  {e.error}
                </li>
              ))}
            </ul>
          </div>
          {/* SET-33: a Reload re-parses from disk without a server restart. */}
          <Button
            variant="secondary"
            testId="workflow-reload"
            onClick={() => { void workflow.refetch(); }}
            className="mt-3"
          >
            Reload from disk
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="workflow-panel">
      {header}
      {children({
        workflow: workflow.data,
        usage: usage.data,
      })}
    </div>
  );
}
