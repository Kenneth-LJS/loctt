import type { ProjectDef } from "@loctt/contracts";
import { useState } from "react";

import { ApiError } from "../api/client.ts";
import { useCreateProject } from "../api/hooks/useProjectMutations.ts";
import { Button } from "../ui/Button.tsx";
import { Field } from "../ui/Field.tsx";
import { ResponsiveDialog } from "../ui/ResponsiveDialog.tsx";
import { TextField } from "../ui/TextField.tsx";
import { slugify, validateNewProject } from "./projectForm.ts";

/**
 * The self-contained New-project create form (K100). It owns its own
 * mutation (`useCreateProject`), its client-side validation
 * (`validateNewProject` — slug/prefix uniqueness), and its error
 * anchoring. Extracted from `ProjectsPanel` so BOTH the Settings panel and
 * the sidebar's "+ New project" render the *same* create surface — the
 * sidebar opens it directly instead of deep-linking to Settings (U10),
 * without forking a second create form (the K100 violation K100 exists to
 * prevent).
 */
export function CreateProjectForm({
  existing,
  onDone,
}: {
  readonly existing: readonly ProjectDef[];
  readonly onDone: () => void;
}) {
  const [name, setName] = useState("");
  const [prefix, setPrefix] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const create = useCreateProject();

  // PRU-19/PRU-35/PRU-36: the conflict is surfaced *before* submit,
  // from the project list the panel already holds. No round-trip
  // half-creates the project.
  const problems = validateNewProject(
    { name, prefix, slug: slugTouched ? slug : slugify(name) },
    existing,
  );
  const effectiveSlug = slugTouched ? slug : slugify(name);
  const blocked = problems.name !== undefined
    || problems.prefix !== undefined
    || problems.slug !== undefined
    || name.trim().length === 0
    || prefix.trim().length === 0;

  const submit = () => {
    if (blocked) return;
    create.mutate(
      {
        name: name.trim(),
        prefix: prefix.trim(),
        ...(effectiveSlug.length > 0 ? { slug: effectiveSlug } : {}),
      },
      { onSuccess: onDone },
    );
  };

  const serverField = create.error instanceof ApiError
    ? create.error.envelope?.field
    : undefined;
  const serverMessage = create.error instanceof ApiError
    ? create.error.envelope?.message ?? create.error.message
    : create.error?.message;

  return (
    <div className="grid gap-3">
      <div className="grid gap-1">
        <Field label="Name">
          <TextField
            data-testid="project-create-name"
            value={name}
            onChange={e => { setName(e.target.value); }}
          />
        </Field>
        {problems.name !== undefined && (
          <p role="alert" data-testid="project-create-name-problem" className="text-meta text-danger-fg">
            {problems.name}
          </p>
        )}
      </div>

      <div className="grid gap-1">
        {/* PRU-5 wanted the cost stated rather than the field left
            silent. The old wording — "Changeable later only by renaming
            every task in the project" — overstated it twice: it read as
            MANUAL work (the app rewrites the keys itself,
            `core/projects/prefix.ts:111`) and it omitted that old keys
            keep resolving through `key_history`. Ken, 2026-09-22:
            "prefix's description makes it sound like the user will need
            to manually rename it themselves." The example carries the
            meaning; the cost belongs in the confirm flow that a prefix
            change already has (PRU-44/PRU-45), not here. */}
        <Field label="Prefix" hint="Starts every task key, like WEB-1">
          <TextField
            data-testid="project-create-prefix"
            value={prefix}
            onChange={e => { setPrefix(e.target.value); }}
          />
        </Field>
        {problems.prefix !== undefined && (
          <p role="alert" data-testid="project-create-prefix-problem" className="text-meta text-danger-fg">
            {problems.prefix}
          </p>
        )}
      </div>

      <div className="grid gap-1">
        <Field label="Slug" hint="Used in links and cannot be changed later">
          <TextField
            data-testid="project-create-slug"
            value={effectiveSlug}
            onChange={e => { setSlugTouched(true); setSlug(e.target.value); }}
          />
        </Field>
        {problems.slug !== undefined && (
          <p role="alert" data-testid="project-create-slug-problem" className="text-meta text-danger-fg">
            {problems.slug}
          </p>
        )}
      </div>

      {create.isError && (
        <p
          role="alert"
          data-testid={`project-create-error${serverField !== undefined ? `-${serverField}` : ""}`}
          className="text-[0.8571rem] text-danger-fg"
        >
          {serverMessage}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button
          variant="primary"
          testId="project-create-submit"
          disabled={blocked}
          loading={create.isPending}
          aria-label="Create project"
          onClick={submit}
        >
          Create project
        </Button>
      </div>
    </div>
  );
}

/**
 * The New-project dialog: the shared `ResponsiveDialog` wrapper around
 * {@link CreateProjectForm}. Rendered by both the Settings Projects panel
 * and the sidebar so the two open the identical create surface (U10 / K100).
 */
export function CreateProjectDialog({
  existing,
  onClose,
}: {
  readonly existing: readonly ProjectDef[];
  readonly onClose: () => void;
}) {
  return (
    <ResponsiveDialog title="New project" onClose={onClose}>
      <CreateProjectForm existing={existing} onDone={onClose} />
    </ResponsiveDialog>
  );
}
