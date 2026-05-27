import type { SchemaStatusResponse } from "@loctt/contracts";

import { useMigrate } from "../api/hooks/useSchema.ts";
import { useAppContext } from "../context/AppBootstrap.tsx";

/**
 * Red banner above the app shell that activates whenever the tracker
 * is in a non-current schema state. Writes are gated elsewhere via
 * `useAppContext().readOnly`; this component just surfaces the state
 * and the action.
 *
 * Three states from contracts:
 *   - outdated: tracker on disk < the binary supports → offer migrate
 *   - future:   tracker on disk > what we know about → tell the user
 *               to upgrade their LocTT binary (no migrate button)
 *   - unknown:  schema sentinel unreadable → ask them to run doctor
 *
 * The `current` and `missing` cases render nothing.
 */
export function SchemaBanner() {
  const { schemaStatus } = useAppContext();
  if (schemaStatus.kind === "current" || schemaStatus.kind === "missing") return null;
  return <BannerBody status={schemaStatus} />;
}

function BannerBody({ status }: { status: SchemaStatusResponse }) {
  const migrate = useMigrate();
  const offerMigrate = status.kind === "outdated";

  const { title, message } = describe(status);

  return (
    <div
      role="alert"
      className="bg-danger-bg text-danger-fg border-b border-danger-fg/30 px-6 py-3"
    >
      <div className="max-w-5xl mx-auto flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <strong className="font-semibold">{title}</strong>
        <span className="text-danger-fg/85 flex-1 min-w-0">{message}</span>
        {offerMigrate ? (
          <button
            type="button"
            disabled={migrate.isPending}
            onClick={() => migrate.mutate()}
            className="px-3 py-1.5 text-xs font-medium rounded-md bg-danger-fg text-bg-canvas hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {migrate.isPending ? "Migrating…" : "Migrate now"}
          </button>
        ) : null}
        {migrate.error ? (
          <span className="basis-full text-xs">Migration failed: {migrate.error.message}</span>
        ) : null}
      </div>
    </div>
  );
}

function describe(status: SchemaStatusResponse): { title: string; message: string } {
  switch (status.kind) {
    case "outdated":
      return {
        title: "Schema migration available.",
        message:
          `This tracker is on v${status.on_disk}; LocTT supports v${status.current}.`
          + " Writes are disabled until you migrate.",
      };
    case "future":
      return {
        title: "LocTT is out of date.",
        message:
          `This tracker is on v${status.on_disk} but this LocTT only knows v${status.current}.`
          + " Upgrade the LocTT binary before continuing.",
      };
    case "unknown":
      return {
        title: "Schema state is unreadable.",
        message: status.message,
      };
    // current + missing handled by SchemaBanner above
    default:
      return { title: "", message: "" };
  }
}
