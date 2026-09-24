import { Link } from "@tanstack/react-router";
import { Component, type ErrorInfo, type ReactNode } from "react";

import {
  Button,
  BUTTON_BASE,
  BUTTON_SIZE,
  BUTTON_VARIANT,
} from "../ui/Button.tsx";
import { cn } from "../ui/cn.ts";
import { Disclosure } from "../ui/Disclosure.tsx";

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
 *   - it makes no claim about the data, except to warn when a write
 *     was in flight that it may not have landed (K126)
 *   - it offers reload, and — at region scope — a narrower "try this
 *     region again" that does not cost the rest of the page
 *   - it keeps the stack out of the headline but retrievable
 *
 * The action row has two shapes, by scope (Ken's call):
 *
 *   - **Region-scoped** (a sidebar group, an editor): "Try {region}
 *     again" + "Reload". No back link — a sidebar group that broke has
 *     not taken the page away. The remount is cheap, occasionally
 *     recovers a state-dependent crash, and the alternative (a full
 *     reload) destroys unsaved description-editor text and open UI
 *     state elsewhere on the page.
 *   - **Route-level** (the whole main pane is gone): "Reload" + "Back
 *     to the task list". The narrow retry is *not* offered: at route
 *     level a render crash is rarely state-dependent, so a pure
 *     remount with unchanged props and unchanged data mostly refires
 *     the same crash — the button reproduces the error rather than
 *     recovering from it.
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
   * Offer the narrow "Try {region} again" remount. On by default,
   * which is the region-scoped shape.
   *
   * Turned *off* by the route-level boundary: with the whole main pane
   * gone, a remount with unchanged props and unchanged data mostly
   * refires the same crash, so the button reproduces the error instead
   * of recovering. Reload + a way out is the honest pair there.
   */
  readonly offerRetry?: boolean;
  /**
   * True when a write may have been in flight. ERR-35 forbids claiming
   * the last action landed; with this set the copy says so explicitly
   * rather than reassuring past what is known.
   */
  readonly writeInFlight?: boolean;
  /**
   * A320: renders the fallback as a bounded, centered content box
   * filling the viewport, instead of the inline region shape.
   *
   * Set by the route-level caller (`RouteError` in `router/index.tsx`)
   * and by the root-level boundary that catches a throw escaping the
   * app shell itself — both replace the *entire* page, so the card
   * needs to read as one screen rather than a region bounded by
   * surrounding chrome. A region-scoped boundary (a sidebar group, a
   * panel) keeps the default inline shape: it sits inside a layout
   * that already bounds it, and a second nested box would be a card
   * inside a card.
   */
  readonly fullPage?: boolean;
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
        // `!== false`, not `=== true`: this prop defaults *on*, so the
        // `=== true` idiom the other optional props use would silently
        // invert the default for every region-scoped caller that omits
        // it — which is all of them.
        offerRetry={this.props.offerRetry !== false}
        fullPage={this.props.fullPage === true}
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
  offerRetry = true,
  fullPage = false,
  onRetry,
}: {
  readonly region: string;
  readonly error: Error;
  readonly componentStack: string | null;
  readonly writeInFlight: boolean;
  readonly offerListLink?: boolean;
  readonly offerRetry?: boolean;
  /** A320: the bounded, centered full-page card. See `Props.fullPage`. */
  readonly fullPage?: boolean;
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

  const content = (
    <div
      className={
        fullPage
          ? // A320: a bounded content box, not a full-span block. Same
            // width as `Modal`'s dialog panel (`max-w-md`) so the two
            // "one centered card" surfaces in this app agree on a
            // size, and the same card chrome (`rounded-lg` +
            // `border-border-default` + `bg-bg-surface-raised` +
            // `shadow-overlay`) `Modal.tsx` uses for its panel.
            "w-full max-w-md rounded-lg border border-border-default bg-bg-surface-raised p-6 shadow-overlay"
          : "max-w-lg"
      }
      data-testid={fullPage ? "error-fallback-card" : undefined}
    >
      <h2 className="mb-2 text-[1.0714rem] font-semibold text-danger-fg">
        Something went wrong displaying {region}
      </h2>
      {writeInFlight ? (
        <p className="mb-2 text-[0.9286rem] text-warn-fg">
          A change was being saved, so it may not have been. Reload to check
          before trying it again.
        </p>
      ) : null}
      <div className="mb-3 flex gap-2">
        {offerRetry ? (
          <Button variant="primary" onClick={onRetry}>
            Try {region} again
          </Button>
        ) : null}
        {/* Primary when it is the only action that acts on this page
            — with the retry withdrawn at route level, Reload is the
            thing to do, and leaving it secondary beside the back
            link would give the row no primary at all. */}
        <Button
          variant={offerRetry ? "secondary" : "primary"}
          onClick={() => window.location.reload()}
        >
          Reload
        </Button>
        {offerListLink ? (
          // SHL-42: reload alone leaves a user whose route is broken
          // reloading the same broken route. A way *out* is the other
          // half of the recovery.
          //
          // Styled from the same constants `Button` uses rather than
          // a hand-spelled imitation: it sits beside Reload as a peer
          // now, and the hand-rolled copy had drifted (no
          // `font-medium`, no `transition-colors`, no
          // `cursor-pointer`, a literal `text-[0.9286rem]` instead of
          // `text-body`, and no `justify-center`), so the two read as
          // subtly different controls in the same row.
          <Link
            to="/list"
            className={cn(
              BUTTON_BASE,
              BUTTON_SIZE.md,
              BUTTON_VARIANT.secondary,
              "no-underline",
            )}
          >
            Back to the task list
          </Link>
        ) : null}
      </div>
      {/* ERR-37: the stack stays out of the headline but retrievable.
          Through the shared `Disclosure` so the summary is drawn with
          our caret — the native marker was rendering here as a literal
          `▸ Show details` (Ken's report). */}
      <Disclosure summary="Show details" className="text-text-tertiary">
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
      </Disclosure>
    </div>
  );

  // A320: full-page centers the card on both axes and fills the
  // viewport, matching `AppBootstrap`'s own `grid h-screen
  // place-items-center` loading gate so every full-screen state in the
  // app agrees on how it centers. The inline shape (region scope)
  // keeps the previous `h-full` grid, which centers within whatever
  // bounded region already wraps it (a sidebar group, a panel) rather
  // than the viewport.
  return (
    <div
      role="alert"
      className={
        fullPage
          ? "grid h-screen place-items-center bg-bg-canvas p-4"
          : "grid h-full place-items-center p-8"
      }
    >
      {content}
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
