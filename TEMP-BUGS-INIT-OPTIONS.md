# Bug: `loctt init` silently drops `--project-key` and `--project-label`

Found 2026-08-14 while adding `calendar.yaml` to init for the timezone
work. Not investigated yet — parked deliberately to keep that batch
focused. Verified against source, not inferred.

**Layer:** `apps/cli` + `packages/core`. **Surfaces affected:** CLI only.

## What's there

`apps/cli/src/commands/init.ts:13-20` reads two flags and forwards them:

```ts
const projectKey = getArg(args, "--project-key");
const projectLabel = getArg(args, "--project-label");
const result = await initLoctt(root, {
  prefix,
  docs,
  ...(projectKey ? { projectKey } : {}),
  ...(projectLabel ? { projectLabel } : {}),
});
```

But `InitOptions` (`packages/core/src/init/init.ts:25-34`) declares only
`prefix`, `projectName`, and `docs`. There is no `projectKey` and no
`projectLabel`. Core reads `options.projectName` at line 49 and defaults
it to `"Tasks"`.

So both flags parse fine, get spread into the options object, and are
then ignored. `loctt init --project-label Backend` creates a project
named "Tasks".

Both flags are documented in `apps/cli/src/usage.ts:19`, so this is a
documented-but-nonfunctional interface, not an undocumented gap.

## Why it type-checks

The spread is conditional (`...(projectKey ? { projectKey } : {})`).
Spreading a wider object literal into a parameter position doesn't
trigger TypeScript's excess-property check the way a direct literal
would, so the extra keys pass silently. A direct
`initLoctt(root, { projectKey })` would have failed to compile.

## Open questions before fixing

1. **Which name is right?** Core says `projectName`, the CLI says
   `--project-label`. `defaultProjectsYaml(projectId, projectName, prefix)`
   writes it as the project's display name. Check what
   `projects.yaml` calls the field (`schema-reference.md:404`) and make
   all three agree rather than picking one arbitrarily.
2. **What is `--project-key` supposed to do?** Core generates the
   project id as a ULID (`init.ts:60-61`) and takes the key prefix from
   `--prefix` separately. It's unclear what a caller-supplied project
   key would set — possibly nothing, in which case the flag should be
   removed from usage rather than implemented.
3. **Does anything else call `initLoctt` with these?** Check the web
   and MCP surfaces before changing the signature.

## Suggested fix sketch

Once (1) and (2) are answered: rename or add the fields on
`InitOptions`, thread them into `defaultProjectsYaml`, and add a CLI
test asserting `--project-label X` actually lands in `projects.yaml` —
the current `init.test.ts:80` calls `initLoctt` directly with
`projectName`, which is why the CLI-level gap went unnoticed.

Consider also whether the conditional-spread pattern is used elsewhere
to pass options into core; the same silent-drop failure mode would
apply anywhere it is.
