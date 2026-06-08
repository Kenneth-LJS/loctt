import type { SchemaStatusResponse } from "@loctt/contracts";

/**
 * Schema-mismatch banner (CW-18). Surfaces above the app shell when
 * the on-disk schema version doesn't match what this build expects, so
 * the user understands why writes may be rejected (the server returns
 * 409 on a version mismatch for every non-exempt API route).
 *
 * Rendered for three kinds:
 *  - `outdated` — disk is behind; tell the user to run `loctt migrate`.
 *    The in-app "Migrate now" button + `POST /api/migrate` endpoint are
 *    deferred to M4; until then migration is CLI-driven.
 *  - `future`   — disk is ahead of this build; the fix is to upgrade
 *    the app, not migrate (you can't downgrade a schema).
 *  - `unknown`  — couldn't read/parse the version; show the message.
 *
 * `current` and `missing` render nothing: current is the happy path,
 * and missing means an uninitialized tracker, which the bootstrap
 * routes to the init wizard rather than a banner.
 */
export function SchemaBanner({ status }: { status: SchemaStatusResponse }) {
  if (status.kind === "current" || status.kind === "missing") return null;

  const { tone, title, detail } = describe(status);

  return (
    <div
      role="alert"
      data-kind={status.kind}
      className={[
        "flex flex-wrap items-center gap-x-2 gap-y-1 border-b px-4 py-2 text-[13px]",
        tone === "warn"
          ? "border-warn-fg/20 bg-warn-bg text-warn-fg"
          : "border-danger-fg/20 bg-danger-bg text-danger-fg",
      ].join(" ")}
    >
      <span className="font-semibold">{title}</span>
      <span className="opacity-90">{detail}</span>
    </div>
  );
}

function describe(status: SchemaStatusResponse): {
  tone: "warn" | "danger";
  title: string;
  detail: string;
} {
  switch (status.kind) {
    case "outdated":
      return {
        tone: "warn",
        title: "Schema out of date.",
        detail:
          `The data directory is at schema v${status.on_disk}, but this build expects ` +
          `v${status.current}. Run \`loctt migrate\` to update it. Writes are blocked ` +
          "until then.",
      };
    case "future":
      return {
        tone: "danger",
        title: "Schema too new.",
        detail:
          `The data directory is at schema v${status.on_disk}, ahead of this build ` +
          `(v${status.current}). Update LocTT to continue — a newer schema can't be ` +
          "downgraded.",
      };
    case "unknown":
      return {
        tone: "danger",
        title: "Schema version unreadable.",
        detail: status.message,
      };
    case "current":
    case "missing":
      // Unreachable: the caller returns null for these before calling
      // describe(). Kept in the switch for exhaustiveness.
      throw new Error(`describe() called for non-banner kind: ${status.kind}`);
  }
}
