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
 * `missing` — no `.schema-version` at all. Shown as a banner pointing at
 * `loctt migrate`, and deliberately NOT offering reinitialize: a
 * `.loctt/` that holds tasks but no version file is a *damaged*
 * tracker, not an empty one, so routing it to an init wizard risks
 * destroying real data. Only `current` renders nothing.
 *
 * This previously returned null for `missing` on the theory that the
 * bootstrap routed it to `/init` — which is a stub, so nothing routed
 * anywhere and the case below was unreachable.
 */
export function SchemaBanner({ status }: { status: SchemaStatusResponse }) {
  if (status.kind === "current") return null;

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
        // SHL-36: naming the backup is what makes the command runnable.
        // "Writes are blocked until you run this" without it asks the
        // user to take an irreversible-looking step on trust.
        detail:
          `The data directory is at schema v${status.on_disk}, but this build expects ` +
          `v${status.current}. Run \`loctt migrate\` to update it — it takes a backup ` +
          "before changing anything. Writes are blocked until then.",
      };
    case "future":
      return {
        tone: "danger",
        title: "Schema too new.",
        // SHL-35 forbids offering `loctt migrate` here: migration
        // cannot move a schema backwards, so the suggestion would only
        // invite a destructive attempt.
        detail:
          `The data directory is at schema v${status.on_disk}, ahead of this build ` +
          `(v${status.current}). Update LocTT to continue (\`npm install -g ` +
          "@loctt/cli@latest\`) — a newer schema can't be downgraded.",
      };
    case "unknown":
      return {
        tone: "danger",
        title: "Schema version unreadable.",
        // SHL-38: P4's rare exception still owes attempt, data state
        // and next action. The server's message alone is the attempt's
        // result and nothing else — it left the user unable to tell
        // whether anything had been touched.
        detail:
          `Reading the tracker's schema version did not produce a result that could ` +
          `be interpreted: ${status.message} Your data is untouched — nothing has ` +
          "been changed. Inspect `.loctt/.schema-version`, or run `loctt doctor`.",
      };
    case "missing":
      return {
        tone: "danger",
        title: "Not a recognized tracker.",
        detail:
          "The data directory has no `.schema-version`, so its layout can't be "
          + "confirmed. Run `loctt migrate` to stamp and upgrade it. Do not "
          + "reinitialize — a directory holding tasks is a damaged tracker, not "
          + "an empty one, and reinitializing would risk the data.",
      };
    case "interrupted":
      // XS-37 requires a *distinct screen*, not a banner variant: a
      // half-migrated tracker has nothing safe to browse behind a
      // banner. `AppBootstrap` intercepts this kind and renders
      // `InterruptedMigration` instead, so reaching here means that
      // routing has been lost — which is worth failing loudly for
      // rather than degrading into the very banner the case forbids.
      throw new Error("describe() called for the interrupted kind: use InterruptedMigration");
    case "current":
      // Unreachable: the caller returns null for `current` before
      // calling describe(). Kept in the switch for exhaustiveness.
      throw new Error(`describe() called for non-banner kind: ${status.kind}`);
  }
}
