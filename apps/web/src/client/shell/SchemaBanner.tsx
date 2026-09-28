import type { SchemaStatusResponse } from "@loctt/contracts";

/**
 * Schema-mismatch banner (CW-18). Surfaces above the app shell when
 * the on-disk schema version can't be used by this build, so the user
 * understands why writes are refused (the server returns 409 on a
 * mismatch for every non-exempt API route).
 *
 * Rendered for three kinds:
 *  - `future`   — disk is ahead of this build; the fix is to upgrade
 *    the app, not migrate (you can't downgrade a schema).
 *  - `unknown`  — couldn't read/parse the version; show the message.
 *  - `missing`  — no `.schema-version` at all. Says to write the file,
 *    and deliberately does NOT offer reinitialize: a `.loctt/` that
 *    holds tasks but no version file is a *damaged* tracker, not an
 *    empty one, so routing it to an init wizard risks destroying real
 *    data.
 *
 * Two kinds never reach here: `outdated` gets the Upgrade screen
 * (`UpgradeRequired`, K154, which took over this banner's in-app
 * migration and its A333 double-click guard) and `interrupted` gets
 * `InterruptedMigration`. `AppBootstrap` routes both. No kind offers a
 * migrate control here (SET-30): on `future` it would attempt a
 * downgrade, on `missing`/`unknown` it would run over a tracker whose
 * layout is unconfirmed. Only `current` renders nothing.
 */
export function SchemaBanner({ status }: { status: SchemaStatusResponse }) {
  if (status.kind === "current") return null;

  const { tone, title, detail } = describe(status);

  return (
    <div
      role="alert"
      data-kind={status.kind}
      className={[
        "flex flex-wrap items-center gap-x-2 gap-y-1 border-b px-4 py-2 text-[0.9286rem]",
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
      // K154: an older tracker gets the Upgrade screen, not a banner.
      // `AppBootstrap` routes this kind to `UpgradeRequired`, so reaching
      // here means that routing has been lost.
      throw new Error("describe() called for the outdated kind: use UpgradeRequired");
    case "future":
      return {
        tone: "danger",
        title: "Schema too new.",
        // SHL-35 forbids offering `loctt migrate` here: migration
        // cannot move a schema backwards, so the suggestion would only
        // invite a destructive attempt.
        detail:
          `This tracker needs loctt ${status.on_disk} or newer. This build reads ` +
          `format ${status.current}. Update LocTT to continue (\`npm install -g ` +
          "loctt@latest\`). A newer format can't be downgraded.",
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
          `be interpreted: ${status.message} Your data is untouched. Nothing has ` +
          "been changed. Open Settings → Diagnostics to run the health checks. If the " +
          "schema file itself is corrupt, inspect `.loctt/.schema-version` by hand.",
      };
    case "missing":
      return {
        tone: "danger",
        title: "Not a recognized tracker.",
        detail:
          // Not `loctt migrate`: it refuses a tracker with no recorded
          // version, so naming it sends the user to a second refusal
          // (A366). The fix is to write the file; doctor says what to
          // write, so this copy names no version it cannot know.
          "The data directory has no `.schema-version`, so its layout can't be "
          + "confirmed. Write the tracker's format version into `.loctt/.schema-version`, "
          + "then reload. `loctt doctor` says which version to write. Do not "
          + "reinitialize. A directory holding tasks is a damaged tracker, not "
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
