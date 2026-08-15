/**
 * Gates the ticket→case partition for completeness.
 *
 *   npm run cases:partition           # report
 *   npm run cases:partition -- --check  # exit non-zero on any failure
 *
 * Every M1–M4 UI case must land in exactly one ticket, or be listed under
 * `## Unplaceable cases` with a reason. The three failures this catches:
 *
 *   - a case in no ticket        → it will never be built, and nothing says so
 *   - a case in two tickets      → both tickets can pass `--require` while
 *                                  each assumes the other built it
 *   - a fabricated case ID       → the ticket invented a requirement
 *
 * What it deliberately does not judge is whether a case sits with the *right*
 * ticket. That is not mechanically decidable, and is why the plan pairs this
 * script with a reviewing agent that did not author the partition.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { CaseIndex } from "../case-index/parse.ts";
import { parsePartition } from "./parse.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const INDEX_PATH = path.join(REPO_ROOT, "docs/dev/case-index.json");
const TICKETS_PATH = path.join(REPO_ROOT, "TEMP-WEB-TICKETS.md");

async function main(): Promise<void> {
  const check = process.argv.includes("--check");

  let index: CaseIndex;
  try {
    index = JSON.parse(await readFile(INDEX_PATH, "utf8")) as CaseIndex;
  } catch {
    console.error(`partition: cannot read docs/dev/case-index.json.\nRun: npm run cases:index`);
    process.exit(1);
    return;
  }

  const { tickets, unplaceable } = parsePartition(await readFile(TICKETS_PATH, "utf8"));

  const byId = new Map(index.cases.map((c) => [c.id, c]));
  // The partition covers UI cases only. Surface cases are scheduled by
  // severity in Phase 3, not by milestone, and have no ticket to sit in.
  const uiCases = index.cases.filter((c) => c.tree === "ui");

  const placement = new Map<string, string[]>();
  const fabricated: { ticket: string; id: string }[] = [];
  const surfaceInTicket: { ticket: string; id: string }[] = [];

  for (const ticket of tickets) {
    for (const id of ticket.cases) {
      const known = byId.get(id);
      if (known === undefined) {
        fabricated.push({ ticket: ticket.id, id });
        continue;
      }
      if (known.tree !== "ui") {
        surfaceInTicket.push({ ticket: ticket.id, id });
        continue;
      }
      const at = placement.get(id) ?? [];
      at.push(ticket.id);
      placement.set(id, at);
    }
  }

  const unplaceableIds = new Set(unplaceable.map((u) => u.id));
  const missing = uiCases.filter((c) => !placement.has(c.id) && !unplaceableIds.has(c.id));
  const duplicated = [...placement.entries()].filter(([, at]) => at.length > 1);
  const undeclared = tickets.filter((t) => !t.declared);
  const bothPlacedAndUnplaceable = [...unplaceableIds].filter((id) => placement.has(id));
  const unplaceableFabricated = [...unplaceableIds].filter((id) => !byId.has(id));

  let failed = false;
  const fail = (msg: string): void => {
    failed = true;
    console.error(msg);
  };

  if (undeclared.length > 0) {
    fail(`\n✗ ${String(undeclared.length)} ticket(s) have no "Cases:" line:`);
    for (const t of undeclared) console.error(`    ${t.id.padEnd(6)} ${t.title}`);
    console.error(`  A ticket with no declared cases sets its own exam at build time.`);
  }

  if (fabricated.length > 0) {
    fail(`\n✗ ${String(fabricated.length)} case ID(s) named by a ticket are not in the index:`);
    for (const f of fabricated) console.error(`    ${f.ticket.padEnd(6)} ${f.id}`);
    console.error(`  Case IDs come from docs/dev/case-index.json. Do not invent them.`);
  }

  if (surfaceInTicket.length > 0) {
    fail(`\n✗ ${String(surfaceInTicket.length)} surface case(s) placed in a UI ticket:`);
    for (const s of surfaceInTicket) console.error(`    ${s.ticket.padEnd(6)} ${s.id}`);
    console.error(`  Surface cases are scheduled by severity in Phase 3, not by milestone.`);
  }

  if (duplicated.length > 0) {
    fail(`\n✗ ${String(duplicated.length)} case(s) claimed by more than one ticket:`);
    for (const [id, at] of duplicated) console.error(`    ${id.padEnd(10)} ${at.join(", ")}`);
    console.error(`  Both tickets pass --require while each assumes the other built it.`);
  }

  if (bothPlacedAndUnplaceable.length > 0) {
    fail(`\n✗ ${String(bothPlacedAndUnplaceable.length)} case(s) both placed and listed unplaceable:`);
    for (const id of bothPlacedAndUnplaceable) console.error(`    ${id}`);
  }

  if (unplaceableFabricated.length > 0) {
    fail(`\n✗ ${String(unplaceableFabricated.length)} unplaceable case ID(s) are not in the index:`);
    for (const id of unplaceableFabricated) console.error(`    ${id}`);
  }

  if (missing.length > 0) {
    fail(`\n✗ ${String(missing.length)} UI case(s) are in no ticket and not listed unplaceable:`);
    for (const c of missing.slice(0, 40)) {
      console.error(`    ${c.id.padEnd(10)} ${(c.milestone ?? "--").padEnd(3)} ${c.title.slice(0, 60)}`);
    }
    if (missing.length > 40) console.error(`    … and ${String(missing.length - 40)} more`);
    console.error(`  A case in no ticket will never be built, and nothing records that.`);
  }

  const placed = placement.size;
  console.log(
    `\npartition: ${String(placed)}/${String(uiCases.length)} UI cases placed ` +
      `across ${String(tickets.length)} ticket(s).`,
  );
  if (unplaceable.length > 0) {
    console.log(`unplaceable: ${String(unplaceable.length)}`);
    for (const u of unplaceable) console.log(`    ${u.id.padEnd(10)} ${u.reason.slice(0, 70)}`);
  }

  if (!failed) console.log(`✓ every UI case is placed exactly once, or listed with a reason.`);

  process.exit(check && failed ? 1 : 0);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
