/**
 * Scenario operations — surface-independent descriptions of what to do
 * to a tracker. Each adapter knows how to execute these against its own
 * interface (CLI in-process, CLI spawn, MCP stdio).
 *
 * Refs (`ref` fields) are CLI-style keys (`T-1`, `T-2`) — adapters
 * resolve them in their natural way.
 */

export type Op =
  | { kind: "create"; title: string; status?: string; priority?: string; task_type?: string; body?: string }
  | { kind: "set_field"; ref: string; field: string; value: string }
  | { kind: "unset_field"; ref: string; field: string }
  | { kind: "replace_body"; ref: string; body: string }
  | { kind: "append_body"; ref: string; text: string }
  | { kind: "archive"; ref: string }
  | { kind: "unarchive"; ref: string }
  | { kind: "delete"; ref: string }
  | { kind: "link"; from: string; type: string; to: string }
  | { kind: "unlink"; from: string; type: string; to: string };

export interface ScenarioAdapter {
  /** Human-readable name for failure messages. */
  readonly name: string;

  /**
   * Execute the scenario against an isolated workspace.
   * The workspace is created with `withTmpLoctt` defaults (init=true)
   * by the caller; the adapter just runs ops against it in order.
   */
  run(ops: readonly Op[], root: string): Promise<void>;
}
