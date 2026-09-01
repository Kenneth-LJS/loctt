import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initLoctt } from "@loctt/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createWebApp } from "./server.js";

/**
 * `POST /api/query/validate` — the route behind the advanced editor's
 * live markers (VUE-8, VUE-31..34, A11Y-53).
 *
 * The point of the route is that it carries `position` and
 * `suggestions` as *fields*. Both existed in core all along and were
 * being flattened into a message string on every other path
 * (LST-44/LST-45), which a marker cannot be placed from. These tests
 * pin the envelope shape the client stubs, so a change to core's error
 * classes surfaces here rather than as a silently mispositioned caret.
 */
describe("POST /api/query/validate", () => {
  let root: string;
  let app: ReturnType<typeof createWebApp>;
  let base: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "loctt-web-qvalidate-"));
    await initLoctt(root);
    app = createWebApp({ root, port: 0 });
    await app.start();
    const addr = app.server.address();
    base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : app.port}`;
  });

  afterEach(async () => {
    await app.stop();
    await rm(root, { recursive: true, force: true });
  });

  const validate = async (query: string) => {
    const res = await fetch(`${base}/api/query/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Loctt-Client": "test" },
      body: JSON.stringify({ query }),
    });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };

  // @verifies VUE-8
  it("reports a well-formed query as valid", async () => {
    const { status, body } = await validate("status = backlog");
    expect(status).toBe(200);
    expect(body["valid"]).toBe(true);
  });

  // @verifies VUE-28
  it("reports a valid query that matches nothing as valid, not as an error", async () => {
    // The distinction VUE-28 rests on: "no rows" is a *result*, and
    // must never arrive at the UI wearing an error's clothes.
    // `wont_do` is a real configured status with no tasks in a fresh
    // tracker — valid query, zero rows. (`blocked` is deliberately not
    // used: it is not a default status key, so it would be VUE-33's
    // unknown-value case, not VUE-28's.)
    const { body } = await validate("status = wont_do");
    expect(body["valid"]).toBe(true);
    expect(body["kind"]).toBeUndefined();
  });

  // @verifies VUE-31
  it("classifies a syntax error and reports the offending token's position", async () => {
    const { body } = await validate("status = = done");
    expect(body["valid"]).toBe(false);
    expect(body["kind"]).toBe("syntax");
    // Position 9 is the second "=" — the marker is placed from this.
    expect(body["position"]).toBe(9);
    expect("status = = done".charAt(9)).toBe("=");
  });

  // @verifies VUE-32
  it("distinguishes an unknown field from a syntax error and suggests a match", async () => {
    const { body } = await validate("assignne = alice");
    expect(body["kind"]).toBe("unknown_field");
    expect(body["suggestions"]).toEqual(["assignee"]);
    // Not a generic syntax failure: the string parses fine.
    expect(body["kind"]).not.toBe("syntax");
  });

  // @verifies VUE-33
  it("distinguishes an unknown enum value from an unknown field", async () => {
    const { body } = await validate("status = frobnik");
    expect(body["kind"]).toBe("unknown_value");
    expect(String(body["message"])).toContain("frobnik");
  });

  // @verifies VUE-33
  it("offers the key when a status label was typed where a key was required", async () => {
    // The case's third bullet. "In progress" is the *label*; the
    // stored value is the key, and the message must bridge the two.
    const { body } = await validate('status = "In progress"');
    expect(body["kind"]).toBe("unknown_value");
    expect(body["suggestions"]).toContain("in_progress");
  });

  // @verifies VUE-34
  it("reports an unterminated string at its opening quote", async () => {
    const { body } = await validate('text ~ "unclosed');
    expect(body["kind"]).toBe("syntax");
    expect(body["position"]).toBe(7);
    expect('text ~ "unclosed'.charAt(7)).toBe('"');
    expect(String(body["message"])).toMatch(/unterminated/i);
  });

  // @verifies VUE-34
  it("gives an unbalanced parenthesis a different message from an unterminated string", async () => {
    const paren = await validate("(status = done and priority = high");
    const quote = await validate('text ~ "unclosed');
    expect(paren.body["message"]).not.toBe(quote.body["message"]);
    // Both specific, neither a shared generic "parse failed".
    expect(String(paren.body["message"])).not.toMatch(/unterminated string/i);
  });

  // @verifies VUE-8
  it("does not offer the removed relationship.* grammar", async () => {
    const { body } = await validate("relationship.type = blocks");
    expect(body["valid"]).toBe(false);
    // Rejected by name, pointing at the replacement — so an editor
    // that suggested it would be contradicted by the validator.
    expect(String(body["message"])).toContain("has_link");

    // POSITIVE CONTROL: the replacement grammar really is accepted, so
    // the rejection above is about `relationship.*` and not about the
    // route rejecting everything.
    const ok = await validate("status = backlog");
    expect(ok.body["valid"]).toBe(true);
  });

  // @verifies VUE-23
  it("validates a 2,000-character query without truncating it", async () => {
    const long = `${"status = backlog or ".repeat(120)}status = backlog`;
    expect(long.length).toBeGreaterThan(2000);
    const { body } = await validate(long);
    expect(body["valid"]).toBe(true);
  });

  // @verifies VUE-23
  it("reports a position deep inside a long query accurately", async () => {
    // Error markers must "still resolve to correct positions deep into
    // the string" — a position that saturated or wrapped would land
    // the caret in the wrong place with no visible symptom.
    const prefix = `${"status = backlog and ".repeat(100)}`;
    const { body } = await validate(`${prefix}status = frobnik`);
    expect(body["kind"]).toBe("unknown_value");
    expect(body["position"]).toBe(prefix.length);
  });
});
