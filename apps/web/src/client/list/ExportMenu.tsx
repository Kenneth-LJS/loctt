import { useState } from "react";

/**
 * Export menu (BLK-14, 15, 16).
 *
 * The export follows the *filter*, not the selection — checking three
 * rows and exporting still yields the whole filtered set, because that
 * is what the count promises. If an "export selected" action is ever
 * added it has to be a separate, differently-labelled control.
 *
 * The link is a real `<a download>` rather than a fetch-then-blob: the
 * URL is the export (BLK-37), so it can be copied, bookmarked and
 * replayed, and nothing that affects the file lives only in React
 * state.
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
      <button
        type="button"
        aria-label="Export"
        aria-expanded={open}
        aria-haspopup="menu"
        // Nothing to export is stated rather than offered: a menu that
        // downloads an empty file while saying "0 tasks exported" is
        // the misleading success BLK-35 rules out.
        disabled={total === 0}
        onClick={() => { setOpen(o => !o); }}
        className="rounded-md border border-border-subtle px-2.5 py-1 text-[12px] font-medium text-text-secondary hover:bg-bg-muted disabled:opacity-50"
      >
        Export ▾
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Export"
          className="absolute right-0 z-20 mt-1 min-w-[190px] rounded-md border border-border-subtle bg-bg-surface py-1 shadow-lg"
        >
          <p className="px-3 py-1.5 text-[11px] uppercase tracking-wide text-text-tertiary">
            {/* The filter total, not the page size — the file will hold
                every match, including rows not yet loaded. */}
            Export {total} {total === 1 ? "task" : "tasks"}
          </p>
          <a
            role="menuitem"
            href={href("csv")}
            download
            onClick={() => { setOpen(false); }}
            className="block px-3 py-1.5 text-[12px] text-text-primary no-underline hover:bg-bg-muted"
          >
            CSV
          </a>
          <a
            role="menuitem"
            href={href("json")}
            download
            onClick={() => { setOpen(false); }}
            className="block px-3 py-1.5 text-[12px] text-text-primary no-underline hover:bg-bg-muted"
          >
            JSON
          </a>
        </div>
      )}
    </div>
  );
}
