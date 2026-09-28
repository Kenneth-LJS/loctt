/**
 * The two scripted surfaces — the built `loctt` binary and its MCP
 * server over stdio — plus `loctt doctor` as the after-every-step
 * health gate.
 */

import { execa } from "execa";

import { type McpClient, startMcpClient } from "../../integration/adapters/mcp-stdio.ts";
import { cliEntry } from "./paths.ts";

export interface ActionResult {
  /** Combined stdout + stderr of every command / call, in order. */
  readonly output: string;
  /** Set when the last command or call failed. */
  readonly error?: { readonly exitCode?: number; readonly message: string };
  /** A failure of an earlier command, which is always a test failure. */
  readonly earlyFailure?: string;
}

/** The environment the CLI and MCP server see: no ambient tracker. */
export function cleanEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined || k === "LOCTT_ROOT" || k === "LOCTT_DEBUG") continue;
    env[k] = v;
  }
  env["NO_COLOR"] = "1";
  return env;
}

export async function runCliArgv(
  argv: readonly string[],
  root: string,
  extraEnv: Record<string, string> = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const res = await execa(process.execPath, [cliEntry, ...argv], {
    cwd: root,
    env: { ...cleanEnv(), ...extraEnv },
    extendEnv: false,
    reject: false,
    timeout: 30_000,
    stdin: "ignore",
  });
  return {
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
    exitCode: typeof res.exitCode === "number" ? res.exitCode : -1,
  };
}

export async function runCliCommands(argvs: readonly (readonly string[])[], root: string): Promise<ActionResult> {
  const chunks: string[] = [];
  for (let i = 0; i < argvs.length; i++) {
    const argv = argvs[i] as readonly string[];
    const res = await runCliArgv(argv, root);
    const text = [res.stdout, res.stderr].filter(Boolean).join("\n");
    chunks.push(text);
    if (res.exitCode !== 0) {
      const line = `loctt ${argv.join(" ")} exited ${res.exitCode}: ${text}`;
      if (i < argvs.length - 1) return { output: chunks.join("\n"), earlyFailure: line };
      return { output: chunks.join("\n"), error: { exitCode: res.exitCode, message: text } };
    }
  }
  return { output: chunks.join("\n") };
}

export async function withMcp<T>(root: string, fn: (client: McpClient) => Promise<T>): Promise<T> {
  const client = await startMcpClient(root);
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

export async function runMcpCalls(
  client: McpClient,
  calls: ReadonlyArray<{ tool: string; args: Record<string, unknown> }>,
): Promise<ActionResult> {
  const chunks: string[] = [];
  for (let i = 0; i < calls.length; i++) {
    const call = calls[i] as { tool: string; args: Record<string, unknown> };
    let text: string;
    let isError: boolean;
    try {
      const res = await client.callTool(call.tool, call.args);
      text = res.content.map(c => c.text ?? "").join("\n");
      isError = res.isError === true;
    } catch (err) {
      // A protocol-level refusal (unknown tool, schema violation) arrives
      // as a thrown JSON-RPC error rather than an isError result.
      text = err instanceof Error ? err.message : String(err);
      isError = true;
    }
    chunks.push(text);
    if (isError) {
      const line = `${call.tool}(${JSON.stringify(call.args)}) failed: ${text}`;
      if (i < calls.length - 1) return { output: chunks.join("\n"), earlyFailure: line };
      return { output: chunks.join("\n"), error: { message: text } };
    }
  }
  return { output: chunks.join("\n") };
}

/**
 * `loctt doctor`'s findings: every check that is not ✓, as
 * `name: message` lines. An empty list means a clean bill of health.
 * Throws when doctor printed no checks at all (it crashed).
 */
export async function doctorFindings(root: string): Promise<string[]> {
  const res = await runCliArgv(["doctor"], root);
  const lines = res.stdout.split("\n").map(l => l.trim()).filter(Boolean);
  if (!lines.some(l => l.startsWith("✓") || l.startsWith("!") || l.startsWith("✗"))) {
    throw new Error(`loctt doctor printed no checks (exit ${res.exitCode}):\n${res.stdout}\n${res.stderr}`);
  }
  return lines.filter(l => l.startsWith("!") || l.startsWith("✗"));
}
