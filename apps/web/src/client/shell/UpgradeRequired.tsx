import type { MigrateResponse, MigrationPlanResponse } from "@loctt/contracts";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useId, useRef } from "react";

import { apiClient, ApiError } from "../api/client.ts";
import { LogoMark } from "../ui/brand/LogoMark.tsx";
import { Button } from "../ui/Button.tsx";
import { Callout } from "../ui/Callout.tsx";
import { Disclosure } from "../ui/Disclosure.tsx";
import { Icon } from "../ui/Icon.tsx";

/**
 * The Upgrade screen: a tracker older than this build (K154).
 *
 * Upgrades are intentional on every surface. The server refuses every
 * API route on an older tracker (409, kind `outdated`), so nothing else
 * in the app can work, and this screen replaces the shell rather than
 * sitting above a browsable app that would only show refusals. The top
 * bar keeps the brand so the page still reads as LocTT.
 *
 * What it says, per messaging.md: what is happening ("This tracker needs
 * upgrading from 0.1.0 to 0.4.0."), the one consequence ("A backup is
 * made first."), the steps in plain words (collapsed, from
 * `/api/migrate/plan`, a risky step flagged), and one action, Upgrade.
 * On success the app reloads. On failure it says what happened, what it
 * did to the data, and what to do next, with the backup path when
 * restoring it is the fix.
 *
 * `onUpgraded` exists for tests; the app reloads the page.
 */
export function UpgradeRequired({
  from,
  to,
  onUpgraded = () => { window.location.reload(); },
}: {
  readonly from: string;
  readonly to: string;
  readonly onUpgraded?: () => void;
}) {
  const titleId = useId();
  const upgradeRef = useRef<HTMLButtonElement>(null);
  // A333's guard: `isPending` only turns true after React commits, so
  // two clicks in the same tick both read false and both POST
  // /api/migrate. A ref flips synchronously.
  const inFlight = useRef(false);

  const plan = useQuery<MigrationPlanResponse>({
    queryKey: ["migrate-plan"],
    queryFn: () => apiClient.get<MigrationPlanResponse>("/api/migrate/plan"),
    retry: false,
  });

  const upgrade = useMutation<MigrateResponse, Error, void>({
    mutationFn: () => apiClient.post<MigrateResponse>("/api/migrate", {}),
    onSettled: () => { inFlight.current = false; },
    onSuccess: () => { onUpgraded(); },
  });

  // Focus lands on the one action, so a keyboard user can upgrade (or
  // read up from it) without hunting for it.
  useEffect(() => { upgradeRef.current?.focus(); }, []);

  const failure = upgrade.isError ? describeFailure(upgrade.error) : null;
  const steps = plan.data?.steps ?? [];

  return (
    <div className="flex h-screen flex-col bg-bg-canvas text-text-primary">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border-default bg-bg-surface px-4 text-[1rem] font-semibold">
        <LogoMark size={22} />
        <span>LocTT</span>
      </div>

      <div className="grid flex-1 place-items-center overflow-auto px-4 py-8">
        <section
          role="alert"
          aria-labelledby={titleId}
          data-kind="outdated"
          data-testid="upgrade-required"
          className="w-full max-w-[34rem] rounded-lg border border-border-default bg-bg-surface p-6 shadow-sm"
        >
          <div className="mb-4 flex items-start gap-3">
            <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-warn-bg text-warn-fg">
              <Icon name="arrowUp" size={16} />
            </span>
            <div className="min-w-0">
              <h1 id={titleId} className="text-heading font-semibold text-text-primary">
                Upgrade needed
              </h1>
              <p className="mt-1 text-body text-text-secondary" data-testid="upgrade-required-message">
                This tracker needs upgrading from {from} to {to}.
              </p>
              <p className="text-body text-text-secondary">A backup is made first.</p>
            </div>
          </div>

          {steps.length > 0 && (
            <Disclosure
              summary={steps.length === 1 ? "What changes (1 step)" : `What changes (${String(steps.length)} steps)`}
              data-testid="upgrade-required-steps"
              className="mb-5 ml-11 [&>summary]:min-h-6"
            >
              <ol className="mt-2 space-y-3">
                {steps.map(step => (
                  <li key={`${step.from}-${step.to}`} className="text-body">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-medium text-text-primary">{step.description}</span>
                      <span className="text-label text-text-tertiary">{step.from} → {step.to}</span>
                      {step.risky === true && (
                        <span
                          data-testid="upgrade-step-risky"
                          className="rounded bg-warn-bg px-1.5 py-0.5 text-label font-medium text-warn-fg"
                        >
                          Risky
                        </span>
                      )}
                    </div>
                    {step.changes !== undefined && (
                      <p className="mt-0.5 text-label text-text-secondary">{step.changes}</p>
                    )}
                  </li>
                ))}
              </ol>
            </Disclosure>
          )}

          {failure !== null && (
            <Callout tone="danger" role="alert" testId="upgrade-required-failed" className="mb-4 ml-11 flex-col gap-1">
              <span>{failure.headline}</span>
              {failure.next !== undefined && <span>{failure.next}</span>}
              {failure.backup !== undefined && (
                <code className="mt-1 block break-all rounded bg-bg-muted px-1.5 py-1 font-mono text-label text-text-primary select-all">
                  {failure.backup}
                </code>
              )}
            </Callout>
          )}

          {upgrade.isSuccess ? (
            <p role="status" className="ml-11 text-body text-text-secondary" data-testid="upgrade-required-done">
              Upgraded to {upgrade.data.to}. Reloading…
            </p>
          ) : failure?.canRetry === false ? (
            <div className="ml-11">
              <Button
                variant="secondary"
                size="md"
                testId="upgrade-required-reload"
                onClick={() => { window.location.reload(); }}
              >
                Reload
              </Button>
            </div>
          ) : (
            <div className="ml-11">
              <Button
                ref={upgradeRef}
                variant="primary"
                size="md"
                testId="upgrade-required-button"
                loading={upgrade.isPending}
                // `loading` hides the label from assistive tech; the name
                // stays "Upgrade" while it runs.
                aria-label="Upgrade"
                onClick={() => {
                  if (inFlight.current) return;
                  inFlight.current = true;
                  upgrade.mutate();
                }}
              >
                Upgrade
              </Button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

interface FailureCopy {
  readonly headline: string;
  readonly next?: string;
  readonly backup?: string;
  /** False when a bare retry would run over a half-upgraded tracker. */
  readonly canRetry: boolean;
}

/**
 * What happened, what it did to the data, and what to do next
 * (messaging.md §2). Three outcomes, told apart by the envelope:
 *
 *  - A step failed after the backup (`data_state: "unknown"`): the
 *    tracker may be part-upgraded. No retry (SET-37): restoring the
 *    backup the sentinel names is the fix, so its path is shown.
 *  - Refused before anything ran (`not_saved`, or no data state): the
 *    server's reason, "Nothing was changed.", and Upgrade stays.
 *  - No answer at all: the outcome is unknown, so say how to find out.
 */
function describeFailure(err: Error): FailureCopy {
  const envelope = err instanceof ApiError ? err.envelope : undefined;
  if (envelope === undefined) {
    return {
      headline: "The server stopped responding.",
      next: "Reload to see whether the upgrade finished.",
      canRetry: false,
    };
  }
  if (envelope.data_state === "unknown") {
    const status = envelope.schema_status;
    const backup = status?.kind === "interrupted" ? status.backup : undefined;
    return {
      headline: `The upgrade didn't finish. ${envelope.message}`,
      next: backup !== undefined
        ? "The tracker may be partly upgraded. Restore .loctt/ from this backup, then reload:"
        : "The tracker may be partly upgraded. Restore .loctt/ from the backup named in .loctt/.schema-migration-in-progress, then reload.",
      ...(backup !== undefined ? { backup } : {}),
      canRetry: false,
    };
  }
  return {
    headline: envelope.message,
    next: [envelope.detail, "Nothing was changed."].filter(Boolean).join(" "),
    canRetry: true,
  };
}
