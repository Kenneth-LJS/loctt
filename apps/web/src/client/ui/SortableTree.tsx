import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";

import { Icon } from "./Icon.tsx";

/**
 * The one reorder primitive (K156): a list, or a tree, whose items move
 * within their own level by drag or by keyboard.
 *
 * Every reorderable list in the web client uses it: every relationship
 * group on the task page (through `relationships/TaskTree.tsx`) and every
 * Settings list. The board keeps its own card drag, which moves cards
 * between columns and is a different gesture.
 *
 * ## Shape
 *
 * `items` with stable ids (`getId`) and, when `nesting` is on, children
 * (`getChildren`). `maxDepth` caps how many levels render (unlimited by
 * default); `startCollapsed` decides whether items with children start
 * folded. An item moves **within its own level only**: it keeps its
 * parent, so a drag never re-parents and a drop on another level's row
 * is refused. `canReorder` turns handles off per level (the task page
 * reorders only depth 0); `disabled` shows them but inert (a write in
 * flight, K125's switched-off group).
 *
 * ## Drag
 *
 * The row is the HTML5 drag source (its handle is the visible grip), and
 * each row of the same level is a drop target. While dragging, a 2px
 * accent line is drawn between the two items where the drop would land,
 * at that level's indentation: below the hovered row when moving down,
 * above it when moving up. Hovering the row's own slot draws nothing,
 * because that drop would change nothing. The line clears on drag end,
 * when the pointer leaves the list, and over anything in it that is not
 * a drop target (the gaps between rows). A nested draggable (a link)
 * does not start a reorder, and neither does a press on a nested row
 * that cannot move itself: the browser would otherwise drag the nearest
 * draggable ancestor, a row the person never grabbed.
 *
 * ## Keyboard: pick up, move, drop (REL-15)
 *
 * Space or Enter on a handle picks the item up; an arrow key also picks
 * it up if nothing is held. Arrows move it within its level, and the
 * rows re-render in the pending order, with the same drop line marking
 * the edge it moved across. Enter or Space drops it, calling `onMove`
 * once (a drop where it started calls nothing and is announced as
 * staying there); Escape puts it back and calls nothing. Focus leaving the handle
 * (to another control or to nothing) and the handle turning disabled
 * also put it back. Every step is announced through a polite live
 * region.
 *
 * ## The held item is an id, never an index
 *
 * A pickup or a drag remembers the item's id and how far it has moved,
 * and finds the item in `items` again on every render. A refetch that
 * adds, removes or reorders rows mid-move therefore still moves, and
 * writes, the item that was picked up. If that item disappears, the move
 * is cancelled and announced.
 *
 * ## Leading controls and alignment
 *
 * Each row's content is the caller's (`renderItem`); the primitive hands
 * it `ctx.leading`, a fixed 24px handle slot (a spacer when the level
 * cannot reorder, so content lines up either way) followed by the
 * expand toggle, which exists and takes space only on an item that has
 * children to show. Levels indent by the slot plus the row gap, so a
 * child's slot sits under its parent's toggle and its content starts to
 * the right of its parent's.
 *
 * ## Nothing moves on its own
 *
 * The primitive keeps no copy of the items. What it renders is what the
 * caller passes, except for the keyboard pickup's pending order, so a
 * failed write snaps back simply by the caller not changing `items`.
 *
 * One exception, for callers that re-render only from a refetch (the
 * task page): when `onMove` returns a promise, a keyboard drop keeps
 * showing the dropped order until `items` changes, so the row does not
 * flicker back to the stored order and its handle keeps focus. A
 * rejected promise puts the stored order back at once.
 */

export interface SortableLevel {
  /** The parent's id, or null at the top level. */
  readonly parentId: string | null;
  /** 0 at the top level. */
  readonly depth: number;
}

export interface SortableMove {
  readonly parentId: string | null;
  /** Index of the moved item in its level, as `items` holds it. */
  readonly fromIndex: number;
  /** The index it lands at, counted in the list with it removed and reinserted. */
  readonly toIndex: number;
  /** The neighbour it now sits directly before (when moved up or to the top). */
  readonly before?: string;
  /** The neighbour it now sits directly after (when moved down or to the end). */
  readonly after?: string;
}

export interface SortableRowContext {
  /** The handle slot and, for an item with children, the expand toggle. Render it first. */
  readonly leading: ReactNode;
  readonly depth: number;
  readonly parentId: string | null;
  /** Rendered position in its level, 0-based. */
  readonly index: number;
  readonly count: number;
  /** True when the item has children that this tree renders. */
  readonly hasChildren: boolean;
  readonly expanded: boolean;
  /** True while this item is being dragged or is picked up from the keyboard. */
  readonly moving: boolean;
}

export interface SortableTreeTestIds<T> {
  /** The row (`<li>`); omitted when undefined. */
  readonly row?: (item: T, level: SortableLevel) => string | undefined;
  /** The handle button. Defaults to "drag-handle". */
  readonly handle?: (item: T, level: SortableLevel) => string;
  /** The expand toggle. Defaults to "tree-toggle". */
  readonly toggle?: string;
  /** The live region. Defaults to "reorder-announcement". */
  readonly announcement?: string;
}

export interface SortableTreeProps<T> {
  readonly items: readonly T[];
  readonly getId: (item: T) => string;
  readonly getChildren?: (item: T) => readonly T[] | undefined;
  /** How the item is named in its handle's label and the announcements. */
  readonly itemName: (item: T) => string;
  readonly renderItem: (item: T, ctx: SortableRowContext) => ReactNode;
  /**
   * Called once per move. Returning a promise keeps a keyboard drop's
   * order on screen until `items` changes, or until the promise rejects.
   */
  readonly onMove: (move: SortableMove) => void | Promise<unknown>;
  /** Off: a flat list, children ignored. */
  readonly nesting?: boolean;
  /** How many levels render. Unlimited by default. */
  readonly maxDepth?: number;
  readonly startCollapsed?: boolean;
  /** Whether a level's items get handles at all. Every level by default. */
  readonly canReorder?: (level: SortableLevel) => boolean;
  /** Handles shown but inert. */
  readonly disabled?: boolean | ((level: SortableLevel) => boolean);
  readonly testIds?: SortableTreeTestIds<T>;
  /** Extra attributes for a row's `<li>` (an `id` anchor, a data hook). */
  readonly rowAttributes?: (
    item: T,
    level: SortableLevel & { readonly index: number },
  ) => Record<string, string | undefined>;
  /** Classes for every level's `<ul>` (row spacing). */
  readonly listClassName?: string;
}

/** Width of the handle slot, in px. */
export const HANDLE_SLOT_PX = 24;
/**
 * One level of indentation: the handle slot plus the row's 8px gap, so a
 * child's handle slot starts where its parent's toggle does and its
 * content starts to the right of the parent's.
 */
export const INDENT_PX = HANDLE_SLOT_PX + 8;

type Edge = "above" | "below";

interface Held {
  /** The level's path key: ancestor ids joined by "/", "" at the top. */
  readonly level: string;
  readonly parentId: string | null;
  /** The held item. Its index is looked up by this on every render. */
  readonly id: string;
  /** How many places it has moved from its stored index (0 while dragging). */
  readonly delta: number;
}

interface LevelInfo<T> {
  readonly items: readonly T[];
  readonly parentId: string | null;
  readonly depth: number;
}

/** Where a held item is now: its stored index and its pending one. */
interface Placed<T> {
  readonly info: LevelInfo<T>;
  readonly origin: number;
  readonly current: number;
}

export function SortableTree<T>({
  items,
  getId,
  getChildren,
  itemName,
  renderItem,
  onMove,
  nesting = false,
  maxDepth = Number.POSITIVE_INFINITY,
  startCollapsed = false,
  canReorder = () => true,
  disabled = false,
  testIds,
  rowAttributes,
  listClassName = "",
}: SortableTreeProps<T>): React.JSX.Element {
  const [pickup, setPickup] = useState<Held | null>(null);
  const [dragging, setDragging] = useState<Held | null>(null);
  /** The id of the row (in `dragging`'s level) the pointer is over. */
  const [over, setOver] = useState<string | null>(null);
  /**
   * A keyboard drop whose write is still landing: its order stays on
   * screen while `items` is the array it was dropped on (see "Nothing
   * moves on its own").
   */
  const [settling, setSettling] = useState<{ readonly held: Held; readonly items: readonly T[] } | null>(null);
  const [announcement, setAnnouncement] = useState("");
  /** Items whose expanded state differs from `startCollapsed`'s default, by path. */
  const [toggled, setToggled] = useState<ReadonlySet<string>>(new Set());
  const handles = useRef(new Map<string, HTMLButtonElement>());
  /** The pickup as of the last commit, for the deferred blur check. */
  const pickupRef = useRef<Held | null>(null);
  /** The row the last pointer press landed in, for `onDragStart`. */
  const pressedRow = useRef<Element | null>(null);

  const isDisabled = (level: SortableLevel): boolean =>
    typeof disabled === "function" ? disabled(level) : disabled;

  const childrenOf = (item: T, depth: number): readonly T[] =>
    nesting && depth + 1 < maxDepth ? (getChildren?.(item) ?? []) : [];

  // Every level this tree renders, by path key, so a held item is found
  // by id wherever it now sits.
  const levels = new Map<string, LevelInfo<T>>();
  const collect = (levelItems: readonly T[], depth: number, parentId: string | null, key: string): void => {
    levels.set(key, { items: levelItems, parentId, depth });
    for (const item of levelItems) {
      const kids = childrenOf(item, depth);
      if (kids.length > 0) collect(kids, depth + 1, getId(item), pathOf(key, getId(item)));
    }
  };
  collect(items, 0, null, "");

  /** Where `held` is now, or null if its item or its level is gone. */
  const place = (held: Held | null): Placed<T> | null => {
    if (held === null) return null;
    const info = levels.get(held.level);
    if (info === undefined) return null;
    const origin = info.items.findIndex(i => getId(i) === held.id);
    if (origin < 0) return null;
    const current = Math.min(Math.max(origin + held.delta, 0), info.items.length - 1);
    return { info, origin, current };
  };

  /** Whether `held` can still move: its item is there and its level is live. */
  const usable = (held: Held): boolean => {
    const placed = place(held);
    if (placed === null) return false;
    const level = { parentId: placed.info.parentId, depth: placed.info.depth };
    return canReorder(level) && !isDisabled(level);
  };

  // A held item that vanished (a refetch dropped it) or whose level went
  // inert mid-move: cancel, so a later Enter or drop cannot write a
  // stale move.
  const pickupLost = pickup !== null && !usable(pickup);
  const draggingLost = dragging !== null && !usable(dragging);
  useEffect(() => {
    if (!pickupLost && !draggingLost) return;
    if (pickupLost) setPickup(null);
    if (draggingLost) {
      setDragging(null);
      setOver(null);
    }
    setAnnouncement("Move cancelled");
  }, [pickupLost, draggingLost]);

  // A settling drop ends once the items it was dropped on are replaced.
  useEffect(() => {
    if (settling !== null && settling.items !== items) setSettling(null);
  }, [settling, items]);

  // A re-render in the pending order can move the held row's DOM node,
  // which drops focus to nothing; put it back so the next arrow key
  // still lands. Never taken from another control.
  useLayoutEffect(() => {
    pickupRef.current = pickup;
    if (pickup === null) return;
    const el = handles.current.get(pathOf(pickup.level, pickup.id));
    const active = document.activeElement;
    if (el !== undefined && active !== el && (active === null || active === document.body)) el.focus();
  });

  const cancelPickup = (level: string, id: string): void => {
    const p = pickupRef.current;
    if (p === null || p.level !== level || p.id !== id) return;
    pickupRef.current = null;
    setPickup(null);
    setAnnouncement("Move cancelled");
  };

  const commit = (
    parentId: string | null,
    siblings: readonly T[],
    from: number,
    to: number,
  ): void | Promise<unknown> => {
    if (to === from) return;
    const rest = siblings.filter((_, i) => i !== from);
    const anchor = to > from ? rest[to - 1] : rest[to];
    return onMove({
      parentId,
      fromIndex: from,
      toIndex: to,
      ...(anchor === undefined
        ? {}
        : to > from
          ? { after: getId(anchor) }
          : { before: getId(anchor) }),
    });
  };

  const onHandleKeyDown = (
    e: React.KeyboardEvent<HTMLButtonElement>,
    item: T,
    levelKey: string,
    parentId: string | null,
    siblings: readonly T[],
  ): void => {
    const id = getId(item);
    const count = siblings.length;
    const origin = siblings.findIndex(s => getId(s) === id);
    if (origin < 0) return;
    const held = pickup !== null && pickup.level === levelKey && pickup.id === id ? pickup : null;
    const current = held === null ? origin : Math.min(Math.max(origin + held.delta, 0), count - 1);
    const name = itemName(item);

    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const to = current + (e.key === "ArrowUp" ? -1 : 1);
      if (to < 0 || to >= count) {
        if (held === null) return;
        setAnnouncement(`${name} is at position ${String(current + 1)} of ${String(count)}`);
        return;
      }
      setPickup({ level: levelKey, parentId, id, delta: to - origin });
      setAnnouncement(`${name} moved to position ${String(to + 1)} of ${String(count)}`);
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (held === null) {
        setSettling(null);
        setPickup({ level: levelKey, parentId, id, delta: 0 });
        setAnnouncement(`${name} picked up, position ${String(origin + 1)} of ${String(count)}`);
        return;
      }
      setPickup(null);
      if (current === origin) {
        setAnnouncement(`${name} stayed at position ${String(origin + 1)} of ${String(count)}`);
        return;
      }
      setAnnouncement(`${name} dropped at position ${String(current + 1)} of ${String(count)}`);
      const result = commit(parentId, siblings, origin, current);
      if (result instanceof Promise) {
        const entry = { held: { level: levelKey, parentId, id, delta: current - origin }, items };
        setSettling(entry);
        result.then(undefined, () => {
          setSettling(s => (s === entry ? null : s));
        });
      }
      return;
    }
    if (e.key === "Escape" && held !== null) {
      // Only the pickup is cancelled; an enclosing dialog stays open.
      e.preventDefault();
      e.stopPropagation();
      setPickup(null);
      setAnnouncement("Move cancelled");
    }
  };

  const settled = settling !== null && settling.items === items ? settling.held : null;

  const renderLevel = (
    levelItems: readonly T[],
    depth: number,
    parentId: string | null,
    levelKey: string,
  ): React.JSX.Element => {
    const level: SortableLevel = { parentId, depth };
    const reorderable = canReorder(level);
    const inert = isDisabled(level);
    // The picked-up item, and the order it is shown in (a pickup's, or a
    // settling drop's).
    const heldHere = pickup !== null && pickup.level === levelKey && !pickupLost ? pickup : null;
    const held = heldHere === null ? null : place(heldHere);
    const pending = held ?? (settled !== null && settled.level === levelKey ? place(settled) : null);
    const rendered = pending === null ? levelItems : moveInArray(levelItems, pending.origin, pending.current);
    const draggingHere = dragging !== null && dragging.level === levelKey && !draggingLost ? dragging : null;
    const dragged = draggingHere === null ? null : place(draggingHere);
    const overIndex = dragged === null || over === null ? -1 : levelItems.findIndex(i => getId(i) === over);

    // Where the line goes in this level, as [rendered index, edge].
    let line: readonly [number, Edge] | null = null;
    if (dragged !== null && overIndex >= 0 && overIndex !== dragged.origin) {
      line = [overIndex, dragged.origin < overIndex ? "below" : "above"];
    } else if (held !== null && held.current !== held.origin) {
      line = [held.current, held.current < held.origin ? "above" : "below"];
    }

    return (
      <ul className={`m-0 list-none p-0 ${listClassName}`}>
        {rendered.map((item, index) => {
          const id = getId(item);
          const path = pathOf(levelKey, id);
          const kids = childrenOf(item, depth);
          const hasChildren = kids.length > 0;
          const expanded = hasChildren && (startCollapsed ? toggled.has(path) : !toggled.has(path));
          const edge = line !== null && line[0] === index ? line[1] : undefined;
          const isHeld = heldHere?.id === id;
          const isDragged = draggingHere?.id === id;
          const moving = isHeld || isDragged;
          const name = itemName(item);
          const canDrag = reorderable && !inert;

          const handle = reorderable ? (
            <button
              type="button"
              ref={el => {
                if (el === null) handles.current.delete(path);
                else handles.current.set(path, el);
              }}
              data-testid={testIds?.handle?.(item, level) ?? "drag-handle"}
              data-sortable-handle=""
              disabled={inert}
              aria-label={
                `Reorder ${name}, position ${String(index + 1)} of ${String(rendered.length)}. `
                + "Arrow up and down to move, Enter to drop, Escape to cancel."
              }
              onKeyDown={e => { onHandleKeyDown(e, item, levelKey, parentId, levelItems); }}
              onBlur={e => {
                if (!isHeld) return;
                // Focus moving to another control ends the pickup
                // without a write.
                if (e.relatedTarget !== null) {
                  cancelPickup(levelKey, id);
                  return;
                }
                // Focus going to nothing also ends it, but a re-render
                // that moves this row does that too, and the layout
                // effect above puts focus straight back. So look once
                // the event is over. (A window losing focus leaves this
                // handle the active element, so the pickup survives.)
                window.setTimeout(() => {
                  const el = handles.current.get(path);
                  if (el !== undefined && document.activeElement === el) return;
                  cancelPickup(levelKey, id);
                }, 0);
              }}
              // B4/WCAG 2.5.8: a visible 24px target. A208: the drawn icon.
              className="inline-flex min-h-[24px] min-w-[24px] shrink-0 cursor-grab items-center justify-center rounded text-text-tertiary hover:bg-bg-muted hover:text-text-secondary disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
            >
              <Icon name="drag" size={14} />
            </button>
          ) : (
            <span aria-hidden="true" data-sortable-spacer="" className="inline-block h-6 w-6 shrink-0" />
          );

          const toggle = hasChildren ? (
            <button
              type="button"
              data-testid={testIds?.toggle ?? "tree-toggle"}
              aria-expanded={expanded}
              aria-label={`${expanded ? "Collapse" : "Expand"} ${name}`}
              onClick={() => {
                setToggled(prev => {
                  const next = new Set(prev);
                  if (next.has(path)) next.delete(path);
                  else next.add(path);
                  return next;
                });
              }}
              className="inline-flex min-h-[24px] min-w-[24px] shrink-0 items-center justify-center rounded text-text-tertiary hover:bg-bg-muted"
            >
              <Icon name={expanded ? "chevronDown" : "chevronRight"} size={14} />
            </button>
          ) : null;

          const extra = rowAttributes?.(item, { ...level, index }) ?? {};

          return (
            <li
              key={path}
              {...extra}
              data-testid={testIds?.row?.(item, level)}
              data-sortable-row=""
              data-depth={String(depth)}
              data-position={String(index + 1)}
              data-dragging={isDragged ? "true" : undefined}
              data-picked-up={isHeld ? "true" : undefined}
              // SET-6: the drop indicator is an attribute a test can read,
              // not only a line a person can see.
              data-drop-indicator={edge}
              draggable={canDrag}
              onDragStart={e => {
                // A nested draggable (a link) or a deeper row starts its own drag.
                if (!canDrag || e.target !== e.currentTarget) return;
                // A press on a nested row that cannot move (a disabled
                // level, a level with no handles) makes the browser drag
                // the nearest draggable ancestor, this row. That is not
                // the row the person grabbed: no drag.
                const pressed = pressedRow.current;
                if (pressed !== null && pressed !== e.currentTarget && e.currentTarget.contains(pressed)) {
                  e.preventDefault();
                  e.stopPropagation();
                  return;
                }
                e.stopPropagation();
                // A synthetic event (a test, a dispatched drag) may carry none.
                const dt = e.dataTransfer as DataTransfer | null | undefined;
                if (dt !== null && dt !== undefined) {
                  dt.effectAllowed = "move";
                  dt.setData("text/plain", name);
                }
                setPickup(null);
                setSettling(null);
                setDragging({ level: levelKey, parentId, id, delta: 0 });
                setOver(null);
              }}
              onDragOver={e => {
                if (draggingHere === null) return;
                e.preventDefault();
                e.stopPropagation();
                const dt = e.dataTransfer as DataTransfer | null | undefined;
                if (dt !== null && dt !== undefined) dt.dropEffect = "move";
                if (over !== id) setOver(id);
              }}
              onDrop={e => {
                if (draggingHere === null) return;
                e.preventDefault();
                e.stopPropagation();
                setDragging(null);
                setOver(null);
                if (dragged === null) return;
                const movedName = itemName(levelItems[dragged.origin] as T);
                const count = String(levelItems.length);
                // `index` is this row's place in the stored order: no
                // pickup is shown while dragging.
                if (index === dragged.origin) {
                  setAnnouncement(`${movedName} stayed at position ${String(index + 1)} of ${count}`);
                  return;
                }
                setAnnouncement(`${movedName} moved to position ${String(index + 1)} of ${count}`);
                const result = commit(parentId, levelItems, dragged.origin, index);
                // A drag shows nothing pending, so a failure has nothing
                // to put back here; the caller reports it.
                if (result instanceof Promise) result.catch(() => undefined);
              }}
              onDragEnd={e => {
                e.stopPropagation();
                setDragging(null);
                setOver(null);
              }}
              className={`relative ${moving ? "opacity-60" : ""}`}
            >
              {renderItem(item, {
                leading: <>{handle}{toggle}</>,
                depth,
                parentId,
                index,
                count: rendered.length,
                hasChildren,
                expanded,
                moving,
              })}
              {edge !== undefined && (
                <div
                  aria-hidden="true"
                  data-testid="drop-line"
                  data-edge={edge}
                  className={`pointer-events-none absolute inset-x-0 z-10 h-0.5 rounded-full bg-accent ${edge === "above" ? "-top-[2px]" : "-bottom-[2px]"}`}
                />
              )}
              {expanded && (
                <div style={{ paddingLeft: `${String(INDENT_PX)}px` }}>
                  {renderLevel(kids, depth + 1, id, path)}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    );
  };

  return (
    <div
      data-sortable-tree=""
      onPointerDown={e => {
        pressedRow.current = (e.target as Element).closest("[data-sortable-row]");
      }}
      onDragOver={() => {
        // A row that accepts the drop claims the event (stopPropagation),
        // so anything reaching here is no drop target: a row of another
        // level, or a gap between rows. No line there.
        if (over !== null) setOver(null);
      }}
      onDragLeave={e => {
        const next = e.relatedTarget as Node | null;
        if (next === null || !e.currentTarget.contains(next)) setOver(null);
      }}
    >
      <span
        role="status"
        aria-live="polite"
        className="sr-only"
        data-testid={testIds?.announcement ?? "reorder-announcement"}
      >
        {announcement}
      </span>
      {renderLevel(items, 0, null, "")}
    </div>
  );
}

function pathOf(levelKey: string, id: string): string {
  return levelKey === "" ? id : `${levelKey}/${id}`;
}

/** A copy of `rows` with the element at `from` moved to `to`. */
export function moveInArray<T>(rows: readonly T[], from: number, to: number): readonly T[] {
  if (from === to) return rows;
  const next = [...rows];
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return rows;
  next.splice(to, 0, moved);
  return next;
}
