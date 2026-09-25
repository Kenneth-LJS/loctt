/**
 * A crashed migration: the blocking screen, not a banner (XS-37).
 *
 * Deliberately not a `SchemaBanner` kind. Every other schema state
 * leaves the app browsable — the banner informs while the shell stays
 * navigable. This one does not: the tracker may be half-rewritten, so
 * there is nothing safe to show and nothing safe to click. The case is
 * explicit that this is "a distinct screen ... not a variant of the
 * banner", and that "no button in the UI can delete the sentinel,
 * because doing so blindly would resume against a half-migrated
 * tracker".
 *
 * So: no Retry, no Migrate now, no Continue anyway, no Dismiss. The
 * only thing offered is the information needed to recover by hand.
 */
export function InterruptedMigration({
  from,
  to,
  backup,
  sentinelPath,
}: {
  readonly from?: number | undefined;
  readonly to?: number | undefined;
  readonly backup?: string | undefined;
  readonly sentinelPath: string;
}) {
  return (
    <div
      role="alert"
      data-kind="interrupted"
      className="grid h-screen place-items-center bg-bg-canvas p-8"
    >
      <div className="max-w-xl">
        <h1 className="mb-3 text-lg font-semibold text-danger-fg">
          A schema migration did not finish
        </h1>
        <p className="mb-3 text-[0.9286rem] text-text-secondary">
          A previous migration crashed part-way. The data directory may be
          partly upgraded.
        </p>

        <dl className="mb-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[0.8571rem]">
          {from !== undefined && to !== undefined ? (
            <>
              <dt className="text-text-tertiary">Migrating</dt>
              <dd className="text-text-primary">
                v{from} → v{to}
              </dd>
            </>
          ) : null}
          <dt className="text-text-tertiary">Backup</dt>
          <dd className="break-all text-text-primary">
            {backup ?? "not recorded, read the sentinel file below"}
          </dd>
          <dt className="text-text-tertiary">Sentinel</dt>
          <dd className="break-all text-text-primary">{sentinelPath}</dd>
        </dl>

        <h2 className="mb-1 text-[0.9286rem] font-semibold text-text-primary">
          To recover
        </h2>
        <ol className="list-decimal space-y-1 pl-5 text-[0.9286rem] text-text-secondary">
          <li>
            Inspect the backup directory above. It holds{" "}
            <code className="rounded bg-bg-muted px-1 py-0.5 text-[0.8571rem]">
              .loctt/
            </code>{" "}
            as it was before the migration started.
          </li>
          <li>
            Restore it over the current{" "}
            <code className="rounded bg-bg-muted px-1 py-0.5 text-[0.8571rem]">
              .loctt/
            </code>{" "}
            if you want the tracker back the way it was.
          </li>
          <li>Delete the sentinel file once you are satisfied with the state on disk.</li>
          <li>
            Run{" "}
            <code className="rounded bg-bg-muted px-1 py-0.5 font-mono text-[0.8571rem]">
              loctt migrate
            </code>{" "}
            again, or{" "}
            <code className="rounded bg-bg-muted px-1 py-0.5 font-mono text-[0.8571rem]">
              loctt doctor
            </code>{" "}
            to check what state things are in first.
          </li>
        </ol>

      </div>
    </div>
  );
}
