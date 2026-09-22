import { Link } from "@tanstack/react-router";
import { Component, type ErrorInfo, type ReactNode } from "react";

import { Button } from "../ui/Button.tsx";

/**
 * A render-crash boundary scoped to one named region.
 *
 * ERR-34 makes the scoping the point: a throw inside a task row must
 * not white-page the app, and the top-level boundary is "the last
 * resort, not the first". So this is designed to be wrapped around
 * regions — the main pane, a sidebar group, an editor — rather than
 * installed once at the root.
 *
 * What the fallback owes the user, per ERR-35/36/37:
 *   - it names the region in user terms, not a component name
 *   - it says this is a *display* fault and that the tasks on disk are
 *     unaffected — without claiming an in-flight write landed
 *   - it offers reload, and a narrower "try this region again" that
 *     does not cost the rest of the page
 *   - it keeps the stack out of the headline but retrievable
 */

interface Props {
  /** User-facing name of what broke: "the task list", not "ListView". */
  readonly region: string;
  /**
   * Offer a link back to the list alongside reload (SHL-42).
   *
   * Set by the route-level boundary, where the whole main pane is
   * gone and the user needs somewhere to go. Off by default: a
   * sidebar group that failed has not taken the page away, and a
   * boundary around the list itself must not offer to navigate to
   * the list.
   */
  readonly offerListLink?: boolean;
  /**
   * True when a write may have been in flight. ERR-35 forbids claiming
   * the last action landed; with this set the copy says so explicitly
   * rather than reassuring past what is known.
   */
  readonly writeInFlight?: boolean;
  readonly children: ReactNode;
}

interface State {
  readonly error: Error | null;
  readonly componentStack: string | null;
  /** Bumped by "Try again" purely to guarantee a state change. */
  readonly attempt: number;
}

export class RegionErrorBoundary extends Component<Props, State> {
  override state: State = { error: null, componentStack: null, attempt: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // ERR-37: the detail belongs in the console, where a bug report can
    // pick it up, not in the headline the user reads first.
    console.error(`[loctt] render error in ${this.props.region}`, error, info.componentStack);
    this.setState({ componentStack: info.componentStack ?? null });
  }

  private readonly retry = (): void => {
    this.setState(s => ({ error: null, componentStack: null, attempt: s.attempt + 1 }));
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (error === null) {
      // No remount key is needed: React unmounts the subtree when a
      // boundary catches, so clearing the error remounts the children
      // from scratch and a stateful child cannot carry the state that
      // broke it across the retry. A `key` here was tried and proved
      // redundant — it survived its own mutation test.
      return <>{this.props.children}</>;
    }
    return (
      <RegionErrorFallback
        region={this.props.region}
        error={error}
        componentStack={this.state.componentStack}
        writeInFlight={this.props.writeInFlight === true}
        offerListLink={this.props.offerListLink === true}
        onRetry={this.retry}
      />
    );
  }
}

export function RegionErrorFallback({
  region,
  error,
  componentStack,
  writeInFlight,
  offerListLink = false,
  onRetry,
}: {
  readonly region: string;
  readonly error: Error;
  readonly componentStack: string | null;
  readonly writeInFlight: boolean;
  readonly offerListLink?: boolean;
  readonly onRetry: () => void;
}) {
  const details = [
    `Error: ${error.message}`,
    `Region: ${region}`,
    `Route: ${typeof window === "undefined" ? "unknown" : window.location.pathname + window.location.search}`,
    `LocTT: ${APP_VERSION}`,
    componentStack === null ? "" : `Component stack:${componentStack}`,
  ]
    .filter(line => line !== "")
    .join("\n");

  return (
    <div role="alert" className="grid h-full place-items-center p-8">
      <div className="max-w-lg">
        <h2 className="mb-2 text-[1.0714rem] font-semibold text-danger-fg">
          Something went wrong displaying {region}
        </h2>
        <p className="mb-2 text-[0.9286rem] text-text-secondary">
          Something in the app failed to draw — a bug on our side, not a
          problem with your data. Your tasks are files in{" "}
          <code className="rounded bg-bg-muted px-1 py-0.5 text-[0.8571rem]">.loctt/</code>{" "}
          and a rendering fault cannot change them.
        </p>
        {writeInFlight ? (
          <p className="mb-2 text-[0.9286rem] text-warn-fg">
            A change was being saved when this happened, so we can&rsquo;t tell you
            whether that one landed. Reload and check before repeating it.
          </p>
        ) : null}
        <div className="mb-3 flex gap-2">
          <Button variant="primary" onClick={onRetry}>
            Try {region} again
          </Button>
          <Button variant="secondary" onClick={() => window.location.reload()}>
            Reload
          </Button>
          {offerListLink ? (
            // SHL-42: reload alone leaves a user whose route is broken
            // reloading the same broken route. A way *out* is the other
            // half of the recovery.
            <Link
              to="/list"
              className="flex h-8 items-center rounded-md border border-border-default bg-bg-surface px-3 text-[0.9286rem] text-text-secondary no-underline hover:bg-bg-muted"
            >
              Back to the task list
            </Link>
          ) : null}
        </div>
        <details className="text-[0.8571rem] text-text-tertiary">
          <summary className="cursor-pointer select-none">Show details</summary>
          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-bg-muted p-2 text-[0.7857rem]">
            {details}
          </pre>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void navigator.clipboard?.writeText(details)}
            className="mt-2"
          >
            Copy details
          </Button>
        </details>
      </div>
    </div>
  );
}

/**
 * Build version, stamped for bug reports (ERR-37). Falls back rather
 * than throwing — an unknown version must not be the thing that breaks
 * the screen explaining a break.
 */
const APP_VERSION =
  (globalThis as { __LOCTT_VERSION__?: string }).__LOCTT_VERSION__ ?? "unknown";
