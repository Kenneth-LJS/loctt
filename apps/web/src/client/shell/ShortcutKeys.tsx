import type { ShortcutSpec } from "./shortcuts.ts";

const KBD =
  "rounded border border-border-subtle bg-bg-muted px-1.5 py-0.5 text-[0.7857rem] text-text-primary";
const SEP = "mx-1 text-[0.7857rem] text-text-tertiary";

/**
 * A shortcut's key caps, display only (K133: the keys are fixed).
 *
 * A sequence renders as separate keys with "then" between them: `g` `l`
 * is two keystrokes, and printing `g + l` would teach the user to hold
 * them together, which does nothing. The Go-to shortcut's three
 * sequences share their `g`, so they render as `g then l / b / t`.
 */
export function ShortcutKeys({ spec }: { readonly spec: ShortcutSpec }) {
  const first = spec.bindings[0];
  if (first === undefined) return null;
  const sharedPrefix =
    spec.bindings.length > 1
    && spec.bindings.every(b => b.keys.length === 2 && b.keys[0] === first.keys[0]);

  if (sharedPrefix) {
    return (
      <span data-testid={`shortcut-keys-${spec.id}`}>
        <kbd className={KBD}>{first.keys[0]}</kbd>
        <span className={SEP}>then</span>
        {spec.bindings.map((b, i) => (
          <span key={b.command}>
            {i > 0 ? <span className={SEP}>/</span> : null}
            <kbd className={KBD} title={b.action}>{b.keys[1]}</kbd>
          </span>
        ))}
      </span>
    );
  }

  return (
    <span data-testid={`shortcut-keys-${spec.id}`}>
      {spec.bindings.map((b, bi) => (
        <span key={b.command}>
          {bi > 0 ? <span className={SEP}>/</span> : null}
          {b.keys.map((k, i) => (
            <span key={`${k}-${String(i)}`}>
              {i > 0 ? <span className={SEP}>then</span> : null}
              <kbd className={KBD}>{k}</kbd>
            </span>
          ))}
        </span>
      ))}
    </span>
  );
}

/** The catalog grouped for display, in table order. */
export function groupsOf<T extends { readonly group: string }>(
  shortcuts: readonly T[],
): { group: string; items: T[] }[] {
  const order: string[] = [];
  const byGroup = new Map<string, T[]>();
  for (const s of shortcuts) {
    let bucket = byGroup.get(s.group);
    if (bucket === undefined) {
      bucket = [];
      byGroup.set(s.group, bucket);
      order.push(s.group);
    }
    bucket.push(s);
  }
  return order.map(g => ({ group: g, items: byGroup.get(g) ?? [] }));
}
