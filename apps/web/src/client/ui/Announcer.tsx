import { createContext, type ReactNode, useCallback, useContext, useMemo, useRef, useState } from "react";

/**
 * The app's screen-reader announcement channel.
 *
 * A11Y-24 is the case this exists for: async outcomes must be
 * announced, "a non-sighted user can tell a failed save from a
 * successful one without inspecting the field". Several surfaces
 * already carry their own `role="alert"` — the settings panels, the
 * init wizard — and those stay as they are, because an error rendered
 * *at* its field is both visible and announced by one element. This
 * channel is for outcomes with no durable surface of their own: a
 * status save that succeeded, a result count that changed, a route
 * that was entered.
 *
 * ## Two regions, not one
 *
 * `polite` waits for the reader to finish its sentence; `assertive`
 * interrupts. A11Y-24 requires the failure to be "assertive enough to
 * interrupt — a silent failure is the worst case in P4 terms", while
 * A11Y-25 requires the count to be polite and A11Y-35 requires a
 * success toast not to stomp on what the user is doing. One region
 * with a switched `aria-live` does not work: changing the attribute
 * and the text in the same paint is a documented way to get the change
 * dropped entirely by some readers.
 *
 * ## Why the text is keyed rather than just set
 *
 * A11Y-24's third bullet: "announcements are not duplicated (once per
 * event, not once per re-render)". Setting the same string twice does
 * not re-announce it — the region's text did not change — so a second
 * identical failure would be silent. The counter makes each
 * announcement a distinct render without changing what is read: the
 * key changes, the text node is replaced, the reader speaks again.
 */

type Politeness = "polite" | "assertive";

interface AnnouncerApi {
  /**
   * Announces `message`. `assertive` interrupts; the default waits.
   */
  announce: (message: string, politeness?: Politeness) => void;
}

const AnnouncerContext = createContext<AnnouncerApi | undefined>(undefined);

interface Announcement {
  readonly seq: number;
  readonly text: string;
}

export function AnnouncerProvider({ children }: { readonly children: ReactNode }) {
  const [polite, setPolite] = useState<Announcement>({ seq: 0, text: "" });
  const [assertive, setAssertive] = useState<Announcement>({ seq: 0, text: "" });
  const seq = useRef(1);

  const announce = useCallback((message: string, politeness: Politeness = "polite") => {
    const next = { seq: seq.current++, text: message };
    if (politeness === "assertive") setAssertive(next);
    else setPolite(next);
  }, []);

  const api = useMemo(() => ({ announce }), [announce]);

  return (
    <AnnouncerContext.Provider value={api}>
      {children}
      {/* Visually hidden, not `display:none` — a hidden region is not
          announced at all. `aria-atomic` so the whole message is read
          rather than only the changed words, which is A11Y-51's "not
          truncated to the first sentence". */}
      {/* No `role` on either region — `aria-live` alone is what makes
          a region live, and the roles are what a live region needs
          only when it has no `aria-live`.

          Adding `role="status"`/`role="alert"` here was measurably
          wrong: these regions are mounted for the app's whole
          lifetime, so a permanent `role="alert"` means every
          `getByRole("alert")` in the app matches this empty div as
          well as the real error it was looking for. Five existing
          tests went red on exactly that, and the same ambiguity would
          reach a real screen reader user navigating by role — an
          always-present "alert" landmark that never has anything in
          it. The banners and field errors keep their roles; the
          channel itself is anonymous. */}
      <div
        aria-live="polite"
        aria-atomic="true"
        data-testid="announcer-polite"
        className="sr-only"
      >
        <span key={polite.seq}>{polite.text}</span>
      </div>
      <div
        aria-live="assertive"
        aria-atomic="true"
        data-testid="announcer-assertive"
        className="sr-only"
      >
        <span key={assertive.seq}>{assertive.text}</span>
      </div>
    </AnnouncerContext.Provider>
  );
}

/**
 * Announcing is optional by design: this returns a no-op when no
 * provider is mounted.
 *
 * Every unit test that renders a panel in isolation would otherwise
 * have to wrap it in a provider, and the failure mode of forgetting is
 * a thrown error deep in a component that has nothing to do with
 * announcements. A missing announcement is a degradation; a crash is
 * not. `useToasts` throws because a toast that silently does not
 * appear loses the user's only route to a created task — the tradeoff
 * genuinely differs.
 */
const NOOP: AnnouncerApi = { announce: () => undefined };

export function useAnnouncer(): AnnouncerApi {
  return useContext(AnnouncerContext) ?? NOOP;
}
