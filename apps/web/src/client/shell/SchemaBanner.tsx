import type { MigrateResponse, SchemaStatusResponse } from "@loctt/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { apiClient,ApiError } from "../api/client.ts";

/**
 * Schema-mismatch banner (CW-18). Surfaces above the app shell when
 * the on-disk schema version doesn't match what this build expects, so
 * the user understands why writes may be rejected (the server returns
 * 409 on a version mismatch for every non-exempt API route).
 *
 * Rendered for three kinds:
 *  - `outdated` — disk is behind. Carries the in-app **Migrate now**
 *    button, which states what will happen before it runs and then
 *    POSTs to `/api/migrate` (SET-15, XS-36). `loctt migrate` remains
 *    equivalent from a terminal.
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
        "flex flex-wrap items-center gap-x-2 gap-y-1 border-b px-4 py-2 text-[0.9286rem]",
        tone === "warn"
          ? "border-warn-fg/20 bg-warn-bg text-warn-fg"
          : "border-danger-fg/20 bg-danger-bg text-danger-fg",
      ].join(" ")}
    >
      <span className="font-semibold">{title}</span>
      <span className="opacity-90">{detail}</span>
      {/*
        SET-30: Migrate is offered for `outdated` ONLY. On `future` it
        would attempt a downgrade; on `missing`/`unknown` it would run
        over a tracker whose layout is unconfirmed. The button's
        *absence* on those kinds is the assertion, so this condition is
        deliberately an equality check rather than a "not current".
        `interrupted` never reaches here at all — AppBootstrap renders
        a dedicated screen for it.
      */}
      {status.kind === "outdated" && (
        <MigrateNow from={status.on_disk} to={status.current} />
      )}
    </div>
  );
}

/**
 * SET-15 / XS-36: the in-app migration.
 *
 * Two-step by design. The first click reveals what will happen — the
 * from/to versions and that a backup snapshot of `.loctt/` is written
 * to a sibling directory first — and only the second runs it. That is
 * SET-15's "states what will happen before it runs", and it also makes
 * the button un-double-clickable: the confirm is a different control
 * from the trigger, and it disables itself while pending.
 */
function MigrateNow({ from, to }: { readonly from: number; readonly to: number }) {
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const migrate = useMutation<MigrateResponse, Error, void>({
    mutationFn: () => apiClient.post<MigrateResponse>("/api/migrate", {}),
    onSuccess: () => {
      // The banner reads `/api/info`; dropping it is what clears the
      // banner without a page reload, and re-enables the rest of the
      // app in the same session (SET-15's last bullet).
      void qc.invalidateQueries();
    },
  });

  if (migrate.isSuccess) {
    return (
      <span data-testid="schema-migrate-success" className="opacity-90">
        Migrated from v{String(migrate.data.from)} to v{String(migrate.data.to)}.
        {migrate.data.backupPath !== undefined && ` Backup: ${migrate.data.backupPath}`}
      </span>
    );
  }

  if (migrate.isError) {
    /*
      SET-37 / XS-36's failure bullet: a partial migration is not a
      success and must not be offered a bare "try again". The server
      returns `data_state: "unknown"` with a `command` recovery
      precisely because a multi-step run cannot say how far it got.
    */
    const envelope = migrate.error instanceof ApiError ? migrate.error.envelope : undefined;
    return (
      <span data-testid="schema-migrate-failed" data-migrate-state="failed" className="opacity-90">
        The migration did not complete: {migrate.error.message} The tracker may
        be part-migrated — check the backup directory before retrying, and
        recover with{" "}
        <code className="rounded bg-black/10 px-1 py-0.5 font-mono text-[0.8571rem] select-all">
          {envelope?.recovery?.kind === "command" && envelope.recovery.command !== undefined
            ? envelope.recovery.command
            : "loctt migrate"}
        </code>{" "}
        from a terminal.
      </span>
    );
  }

  if (!confirming) {
    return (
      <button
        type="button"
        data-testid="schema-migrate-now"
        onClick={() => { setConfirming(true); }}
        className="rounded border border-current/30 px-2 py-0.5 text-[0.8571rem] font-medium"
      >
        Migrate now
      </button>
    );
  }

  return (
    <span data-testid="schema-migrate-confirm" className="flex items-center gap-2">
      <span className="opacity-90">
        This will copy `.loctt/` to a sibling backup directory, then step the
        schema from v{String(from)} to v{String(to)}.
      </span>
      <button
        type="button"
        data-testid="schema-migrate-confirm-button"
        disabled={migrate.isPending}
        onClick={() => { migrate.mutate(); }}
        className="rounded border border-current/30 px-2 py-0.5 text-[0.8571rem] font-medium disabled:opacity-50"
      >
        {migrate.isPending ? "Migrating…" : "Run migration"}
      </button>
      <button
        type="button"
        onClick={() => { setConfirming(false); }}
        className="rounded border border-current/30 px-2 py-0.5 text-[0.8571rem]"
      >
        Cancel
      </button>
    </span>
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
