import type { WorkflowConfig } from "@loctt/contracts";
import type { ReactNode } from "react";

import { ApiError } from "../api/client.ts";
import { useWorkflow } from "../api/hooks/useWorkflow.ts";
import { useWorkflowUsage } from "../api/hooks/useWorkflowMutations.ts";
import { ErrorState } from "../ui/ErrorState.tsx";

/**
 * The shell every Workflow panel sits in (SET-3, SET-33, SET-42).
 *
 * One frame rather than four copies, because three of the cases here
 * are about what happens when the config *cannot* be read, and that
 * answer has to be identical in every panel:
 *
 *  - SET-3: the panel names the absolute path of the file it reflects.
 *  - SET-33: an invalid `workflow.yaml` shows the validation error
 *    naming the file and the offending entry — not an empty list,
 *    which would read as "you have no statuses configured", and not a
 *    stack trace. A Reload control re-parses without a server restart.
 *  - SET-42: an unreachable server is a different screen again, and
 *    the nav (owned by the shell above) stays standing either way.
 */

export function WorkflowPanelFrame({
  title,
  description,
  children,
}: {
  readonly title: string;
  readonly description?: ReactNode;
  readonly children: (args: {
    readonly workflow: WorkflowConfig;
    readonly path: string;
    readonly usage: ReturnType<typeof useWorkflowUsage>["data"];
  }) => ReactNode;
}) {
  const workflow = useWorkflow();
  const usage = useWorkflowUsage();

  const header = (
    <>
      <h1 data-testid="settings-panel-title" className="mb-1 text-lg font-semibold text-text-primary">
        {title}
      </h1>
      {description !== undefined && (
        <p className="mb-3 text-[13px] text-text-secondary">{description}</p>
      )}
    </>
  );

  // SET-33 vs SET-42: a config that will not parse and a server that is
  // not answering are different failures and must not render the same.
  // The 400 envelope's `config_invalid` is what separates them.
  if (workflow.isError) {
    const envelope = workflow.error instanceof ApiError ? workflow.error.envelope : undefined;
    const isConfigInvalid = envelope?.code === "config_invalid";
    return (
      <div className="p-8" data-testid="workflow-panel-error">
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
          <button
            type="button"
            data-testid="workflow-reload"
            onClick={() => { void workflow.refetch(); }}
            className="mt-3 h-8 rounded-md border border-border-default px-3 text-[13px]"
          >
            Reload from disk
          </button>
        </div>
      </div>
    );
  }

  if (workflow.isLoading || workflow.data === undefined) {
    return (
      <div className="p-8">
        {header}
        <p className="text-[13px] text-text-tertiary">Loading workflow…</p>
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
      <div className="p-8" data-testid="workflow-panel-error">
        {header}
        <div data-workflow-error="config-invalid">
          <div className="rounded-md border border-danger-fg/40 bg-bg-muted p-3 text-[13px]">
            <p className="font-medium text-danger-fg">
              {brokenPath} has an entry that does not parse.
            </p>
            <p className="mt-1 text-text-secondary">
              The rest of the file loaded, but these entries were skipped —
              this is not an empty configuration. Fix them in the file, then
              reload.
            </p>
            <ul className="mt-2 list-none space-y-1 p-0" data-testid="workflow-broken-list">
              {brokenEntries.map(e => (
                <li
                  key={`${e.sub}-${String(e.index)}`}
                  data-testid={`workflow-broken-${e.sub}-${String(e.index)}`}
                  className="text-[12px] text-text-secondary"
                >
                  <code className="rounded bg-bg-surface px-1 py-0.5 font-mono">
                    {e.sub}[{e.index}]
                  </code>{" "}
                  {e.error}
                </li>
              ))}
            </ul>
          </div>
          {/* SET-33: a Reload re-parses from disk without a server restart. */}
          <button
            type="button"
            data-testid="workflow-reload"
            onClick={() => { void workflow.refetch(); }}
            className="mt-3 h-8 rounded-md border border-border-default px-3 text-[13px]"
          >
            Reload from disk
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8" data-testid="workflow-panel">
      {header}
      {children({
        workflow: workflow.data,
        // Usage carries the path (SET-3). When usage itself failed the
        // panel still renders the config; it falls back to the
        // relative path rather than claiming an absolute one it does
        // not have.
        path: usage.data?.path ?? ".loctt/config/workflow.yaml",
        usage: usage.data,
      })}
      <p data-testid="workflow-config-path" className="mt-6 text-[11px] text-text-tertiary">
        Reflects{" "}
        <code className="rounded bg-bg-muted px-1 py-0.5 font-mono">
          {usage.data?.path ?? ".loctt/config/workflow.yaml"}
        </code>
        . Editing that file directly and refreshing shows the change —
        this panel is a lens, not a cache.
      </p>
    </div>
  );
}
