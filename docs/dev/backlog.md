# Backlog

Work Ken has decided to do. Each item came from `known-gaps.md` (an open
defect) or a ruling, and carries the decision it rests on. When an item
ships, delete it here; its record lives in `decisions.md` and git.

Status: **todo** · **deciding** (a PM/UI call is pending, not Ken's) ·
**in progress** · **needs Ken** (blocked on a question to Ken).

---

## B38 · One package, `loctt` (K139) — **in progress**

- Rename `@loctt/cli` to `loctt` (bin `loctt`), with core, the web
  client and the MCP server bundled. `@loctt/mcp` and `@loctt/web`
  become private workspaces; remove the `loctt-mcp` bin and
  `publishConfig`s; `prepublishOnly` only on `loctt`.
- READMEs, `docs/user/*` install instructions, MCP setup (`loctt mcp` /
  `npx -y loctt mcp`), release-readiness.md B4, CHANGELOG.
- `npm run test:packaging`: pack and install the one package outside the
  repo and run `loctt`, `loctt ui` and `loctt mcp`; the manifest check
  covers it; nothing else is publishable.
- Ken unpublishes `@loctt/cli` and `@loctt/mcp` himself.

