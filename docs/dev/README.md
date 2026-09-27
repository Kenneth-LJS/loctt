# Contributing to LocTT

Developer documentation. For using LocTT, see the
[user documentation](../user/README.md).

## Orientation

- [Architecture](reference/architecture.md) — monorepo layout, data model,
  task identity.
- [Schema reference](reference/schema-reference.md) — file formats
  (`task.md`, `workflow.yaml`, …).
- [Development](process/development.md) — building, running, and testing
  locally.

## Rules and decisions

- [Invariants](reference/invariants.md) — rules a change must not break.
- [Decisions](decisions.md) — locked design decisions, including what is
  deliberately not built.
- [Markdown extensions](reference/markdown-extensions.md) — what the body
  editor must round-trip.
- [Build loop](process/build-loop.md) — how a web-UI ticket gets built and
  verified.
- [Known gaps](known-gaps.md) — understood defects not yet fixed.

## Acceptance criteria

Cases describing observable behaviour, one file per flow — the
specification each surface is built against.

- [UI test cases](../../tests/cases/ui-test-cases/) — plus the P1–P10
  principles in its [README](../../tests/cases/ui-test-cases/README.md).
- [CLI & MCP test cases](../../tests/cases/surface-test-cases/).
- [`case-index.json`](../../tests/cases/case-index.json) — the
  machine-readable index; see [tools/README.md](../../tools/README.md) for
  the coverage gate.
