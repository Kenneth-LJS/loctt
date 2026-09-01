/**
 * Skip-to-main-content (A11Y-44).
 *
 * The case's first bullet: "the first stop is a skip-to-main-content
 * link, visible when focused". Its last bullet gives the reason —
 * without it, "verify the header + sidebar are few enough stops that
 * reaching the table doesn't take dozens of Tab presses on a tracker
 * with 30 projects (SHL-21)". The sidebar renders a row per project
 * and per saved view, so the stop count is a function of the user's
 * data and cannot be bounded by design. The link is the answer.
 *
 * Rendered first in the DOM so it is the first tab stop, and
 * positioned off-screen until focused rather than hidden — a
 * `display:none` link is not focusable, so it would never appear.
 */
export const MAIN_CONTENT_ID = "main-content";

export function SkipLink() {
  return (
    <a
      href={`#${MAIN_CONTENT_ID}`}
      data-testid="skip-link"
      onClick={e => {
        // The bare hash href moves the *document* fragment but not
        // always focus, and in a client-routed app it also rewrites
        // the URL — which would push a `#main-content` entry into
        // history that Back then has to walk through. Handling it
        // directly focuses the pane and leaves the URL alone.
        e.preventDefault();
        const main = document.getElementById(MAIN_CONTENT_ID);
        if (main === null) return;
        main.focus();
        main.scrollIntoView();
      }}
      className="sr-only rounded-md border border-border-default bg-bg-surface-raised px-3 py-2 text-[13px] font-medium text-text-primary shadow-overlay focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-[80] focus:outline-2 focus:outline-offset-2 focus:outline-accent"
    >
      Skip to main content
    </a>
  );
}
