/**
 * Fixture helpers that register an entity and hand back its **id**.
 *
 * Task frontmatter stores entity references as ULIDs (P-2), and every
 * write path now resolves a name to its id and refuses one that
 * resolves to nothing. Before that, a fixture could invent `"bug"` and
 * the write succeeded — storing a reference to a label that did not
 * exist, which `doctor` later reported as dangling.
 *
 * The fixtures were not wrong to be written that way: they matched what
 * the product did. These helpers exist so the correct thing is also the
 * easy thing, rather than something each test has to remember.
 *
 * Each wraps the real `create*` function, so a change to entity
 * creation reaches the fixtures instead of letting them drift.
 *
 * Test-only. Nothing in `src/` outside a `.test.ts` should import this.
 */

import type { SprintState } from "@loctt/contracts";

import { createLabel } from "../labels/manage.js";
import { createMilestone } from "../milestones/manage.js";
import { createSprint } from "../sprints/manage.js";
import { createUser } from "../users/lifecycle.js";

/** Registers a label and returns its id. */
export async function seedLabel(locttDir: string, name: string): Promise<string> {
  return (await createLabel(locttDir, { name })).id;
}

/**
 * Registers a user and returns its id.
 *
 * `initLoctt` already creates a default user from the machine's
 * account, so a fixture that reuses that name gets an ambiguity error
 * rather than a resolution failure. Pass a name the tracker does not
 * already hold.
 */
export async function seedUser(locttDir: string, name: string): Promise<string> {
  return (await createUser(locttDir, { name })).id;
}

/** Registers a milestone and returns its id. */
export async function seedMilestone(locttDir: string, name: string): Promise<string> {
  return (await createMilestone(locttDir, { name })).id;
}

/**
 * Registers a sprint and returns its id.
 *
 * Dates default to a fixed fortnight and state to `active`, because
 * `createSprint` requires all three and validates `end >= start` — a
 * caller that does not care should not have to invent valid ones.
 */
export async function seedSprint(
  locttDir: string,
  name: string,
  overrides: { start_date?: string; end_date?: string; state?: SprintState } = {},
): Promise<string> {
  return (await createSprint(locttDir, {
    name,
    start_date: overrides.start_date ?? "2026-01-01",
    end_date: overrides.end_date ?? "2026-01-14",
    state: overrides.state ?? "active",
  })).id;
}

/**
 * Registers several labels at once, returning ids in the order given.
 *
 * The common shape in these fixtures is two or three labels on one
 * task, and awaiting each separately buries the assertion.
 *
 * The return type is a mapped tuple rather than `string[]` so
 * `const [a, b] = await seedLabels(dir, "a", "b")` gives `string`, not
 * `string | undefined` — otherwise every call site needs a cast, which
 * is exactly the friction this module exists to remove.
 */
export async function seedLabels<const N extends readonly string[]>(
  locttDir: string,
  ...names: N
): Promise<{ -readonly [K in keyof N]: string }> {
  const ids: string[] = [];
  // Sequential rather than Promise.all: each write takes the state
  // lock, so concurrent creates would contend for it.
  for (const name of names) ids.push(await seedLabel(locttDir, name));
  return ids as { -readonly [K in keyof N]: string };
}
