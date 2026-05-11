# Uninstalling LocTT

How to fully remove LocTT from a project.

## 1. Remove the data directory

Delete the `.loctt/` directory from your project:

```bash
rm -rf .loctt/
```

This removes all tasks, configuration, and state. If you want to keep your tasks for reference, copy or archive the directory first — each task is a readable markdown file under `.loctt/tasks/`.

## 2. Remove MCP server config

Remove the loctt entry from whichever MCP config you set up:

- **Claude Desktop:** Remove the `loctt` key from `mcpServers` in `~/Library/Application Support/Claude/claude_desktop_config.json`
- **VS Code:** Remove the `loctt` key from `.mcp.json`
- **Cursor:** Remove the `loctt` key from `.cursor/mcp.json` or via Cursor Settings

## 3. Remove agent instructions

Search your agent instruction files for "LocTT" (case-insensitive) and remove all related sections:

```bash
grep -ri "loctt" CLAUDE.md .cursorrules .github/copilot-instructions.md
```

Check whichever instruction files your project uses. If you followed the [naming convention](../mcp/agent-setup.md#naming-convention), all LocTT instructions should be findable with a single search.

## 4. Remove from `.gitignore`

If you added `.loctt/` to your `.gitignore`, remove that line.

## 5. Remove git sync branch

If you enabled git sync, a `.loctt` branch exists in your repo. To remove it:

```bash
git branch -D .loctt              # Delete local branch
git push origin --delete .loctt   # Delete remote branch (if pushed)
```

## 6. Uninstall the CLI

```bash
npm uninstall -g @loctt/cli
```

Or if you installed from source with `npm link`:

```bash
cd /path/to/loctt
npm unlink --workspace apps/cli
```
