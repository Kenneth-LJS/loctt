import { useState } from "react";

import { Button } from "../ui/Button.tsx";
import { Icon } from "../ui/Icon.tsx";

/**
 * Export menu (BLK-14, 15, 16).
 *
 * The export follows the *filter*, not the selection — checking three
 * rows and exporting still yields the whole filtered set, because that
 * is what the count promises. If an "export selected" action is ever
 * added it has to be a separate, differently-labelled control.
 *
 * The `href` is the export URL, so it can be copied, bookmarked and
 * replayed, and nothing that affects the file lives only in React
 * state (BLK-37). A plain click is intercepted and fetched instead:
 * an `<a download>` cannot report a failure — a 500 produces no file
 * and no event, so the only signal is a download that never arrives
 * (BLK-43). A *modified* click is left to the browser.
 */
export function ExportMenu({
  total,
  queryString,
}: {
  /** Filter total, so the menu can say what will be exported. */
  readonly total: number;
  /** The same filter params the list request carries. */
  readonly queryString: string;
}) {
  const [open, setOpen] = useState(false);
  /**
   * BLK-34: a 5,000-row export takes seconds, and a menu that closes
   * with no other change looks like nothing happened. The browser owns
   * the download — which is why the list stays browsable throughout —
   * so this is a hint that the request is out, not a progress bar the
   * page could not honestly draw.
   *
   * The fetch owns the lifetime, so this clears when the request
   * settles rather than on a guessed timer.
   */
  const [pending, setPending] = useState(false);

  const [failure, setFailure] = useState<{ format: "csv" | "json"; reason: string } | undefined>(
    undefined,
  );

  /**
   * Task ids the server could not read, so they are missing from the
   * file it just handed over.
   *
   * BLK-44: the export may succeed and name what it skipped, or fail
   * and name the offending path — but "a truncated file that silently
   * omits the bad row with no mention" is the one outcome ruled out.
   * The body is a file and cannot carry an envelope, so the ids ride
   * on a header.
   */
  const [skipped, setSkipped] = useState<readonly string[]>([]);

  /**
   * Runs the export as a fetch and hands the result to the browser.
   *
   * A plain `<a download>` cannot report failure: a 500 produces no
   * file and no event, so the only signal is a download that never
   * appears (BLK-43). The `href` stays on the anchor so the URL is
   * still copyable and replayable (BLK-37) — this intercepts the click
   * rather than replacing the link.
   */
  const run = async (format: "csv" | "json"): Promise<void> => {
    setOpen(false);
    setFailure(undefined);
    setSkipped([]);
    setPending(true);
    try {
      const res = await fetch(href(format));
      if (!res.ok) {
        const body = await res.json().catch(() => undefined) as
          { message?: string } | undefined;
        setFailure({
          format,
          reason: body?.message ?? `the server returned ${String(res.status)}`,
        });
        return;
      }
      const unreadable = res.headers.get("X-Loctt-Unreadable");
      if (unreadable !== null && unreadable !== "") {
        setSkipped(unreadable.split("|").filter(Boolean));
      }
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `loctt-tasks.${format}`;
      a.click();
      // Revoked on the next turn: the browser has not necessarily
      // committed the blob fetch by the time click() returns, and a
      // 5,000-row export is where that gap is widest.
      setTimeout(() => { URL.revokeObjectURL(url); }, 0);
    } catch (err) {
      setFailure({ format, reason: (err as Error).message });
    } finally {
      setPending(false);
    }
  };

  const href = (format: "csv" | "json"): string => {
    const sp = new URLSearchParams(queryString);
    // Pagination is a view concern; an export is the whole match set.
    sp.delete("limit");
    sp.delete("offset");
    sp.set("format", format);
    return `/api/tasks/export?${sp.toString()}`;
  };

  return (
    <div className="relative">
      {/* B1 migration (K-3/S-3/S-4): the trigger is the shared Button
          (secondary, md) so Export lines up at the same pill height as
          Refresh and the facets, with the baked-in cursor/hover/focus
          states. The aria-label/expanded/haspopup and the `disabled` gate
          are carried across unchanged so the BLK export locators match. */}
      <Button
        variant="secondary"
        size="md"
        aria-label="Export"
        aria-expanded={open}
        aria-haspopup="menu"
        // Nothing to export is stated rather than offered: a menu that
        // downloads an empty file while saying "0 tasks exported" is
        // the misleading success BLK-35 rules out.
        disabled={total === 0}
        onClick={() => { setOpen(o => !o); }}
      >
        {pending ? "Preparing…" : (
          <span className="inline-flex items-center gap-1.5">
            <Icon name="download" size={14} />
            Export
            <Icon name="chevronDown" size={12} />
          </span>
        )}
      </Button>

      {open && (
        <div
          role="menu"
          aria-label="Export"
          className="absolute right-0 z-20 mt-1 min-w-[190px] rounded-md border border-border-subtle bg-bg-surface py-1 shadow-lg"
        >
          <p className="px-3 py-1.5 text-[0.7857rem] uppercase tracking-wide text-text-tertiary">
            {/* The filter total, not the page size — the file will hold
                every match, including rows not yet loaded. */}
            Export {total} {total === 1 ? "task" : "tasks"}
          </p>
          <a
            role="menuitem"
            href={href("csv")}
            download
            onClick={e => {
              // A modified click is the user asking the browser to
              // handle the URL — new tab, new window, download-as. The
              // href is still the export (BLK-37), so let it through
              // rather than hijacking it into a same-tab blob.
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
              e.preventDefault();
              void run("csv");
            }}
            className="block px-3 py-1.5 text-[0.8571rem] text-text-primary no-underline hover:bg-bg-muted"
          >
            CSV
          </a>
          <a
            role="menuitem"
            href={href("json")}
            download
            onClick={e => {
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
              e.preventDefault();
              void run("json");
            }}
            className="block px-3 py-1.5 text-[0.8571rem] text-text-primary no-underline hover:bg-bg-muted"
          >
            JSON
          </a>
        </div>
      )}

      {failure !== undefined && (
        <span role="status" className="ml-2 text-[0.8571rem] text-danger-fg">
          The {failure.format.toUpperCase()} export could not be created:
          {" "}{failure.reason}
          <Button
            variant="secondary"
            size="sm"
            className="ml-2"
            onClick={() => { void run(failure.format); }}
          >
            Retry
          </Button>
        </span>
      )}

      {skipped.length > 0 && (
        // The file downloaded; this says what is not in it. A status
        // rather than an alert: the export worked, and the tasks that
        // could not be read are a fact about the tracker rather than a
        // failure of this action (BLK-44).
        <span role="status" data-export-skipped="true" className="ml-2 text-[0.8571rem] text-warn-fg">
          {skipped.length} task{skipped.length === 1 ? "" : "s"} could not be read and
          {" "}{skipped.length === 1 ? "is" : "are"} missing from the file:
          {" "}<span className="font-mono">{skipped.join(", ")}</span>.
          {" "}Run <code className="font-mono">loctt doctor</code> to see why.
        </span>
      )}
    </div>
  );
}
