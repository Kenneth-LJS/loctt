/**
 * The out-of-band half of tests/e2e/08 (B43): clone the remote, commit a
 * marker file on the `loctt` branch and push it, as another machine
 * would. No loctt command can do this, so it is a step script.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

export default function push({ root, vars }: { root: string; vars: Record<string, unknown> }): string {
  const remote = vars["remote"];
  if (typeof remote !== "string") throw new Error("no remote: the case needs `git: remote`");
  const clone = mkdtempSync(path.join(path.dirname(root), "rt-clone-"));
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.com",
    GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@example.com",
    GIT_TERMINAL_PROMPT: "0",
  };
  const git = (...args: string[]): string => execFileSync("git", args, { cwd: clone, env, encoding: "utf-8" });
  try {
    execFileSync("git", ["clone", "-q", remote, clone], { env, encoding: "utf-8" });
    git("checkout", "-q", "loctt");
    writeFileSync(path.join(clone, "out-of-band.txt"), "external\n");
    git("add", "out-of-band.txt");
    git("commit", "-q", "-m", "external commit");
    git("push", "-q", "origin", "loctt");
    return "pushed";
  } finally {
    rmSync(clone, { recursive: true, force: true });
  }
}
