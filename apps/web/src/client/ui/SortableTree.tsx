import { type ReactNode, useLayoutEffect, useRef, useState } from "react";

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
 * because that drop would change nothing. The line clears on drag end
 * and when the pointer leaves the list. A nested draggable (a link) does
 * not start a reorder.
 *
 * ## Keyboard: pick up, move, drop (REL-15)
 *
 * Space or Enter on a handle picks the item up; an arrow key also picks
 * it up if nothing is held. Arrows move it within its level, and the
 * rows re-render in the pending order, with the same drop line marking
 * the edge it moved across. Enter or Space drops it, calling `onMove`
 * once; Escape puts it back and calls nothing. Every step is announced
 * through a polite live region.
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
  readonly onMove: (move: SortableMove) => void;
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
  readonly id: string;
  /** Stored index in the level. */
  readonly origin: number;
  /** Pending index in the level (always `origin` while dragging). */
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
  /** The row index (in `dragging`'s level) the pointer is over. */
  const [over, setOver] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState("");
  /** Items whose expanded state differs from `startCollapsed`'s default, by path. */
  const [toggled, setToggled] = useState<ReadonlySet<string>>(new Set());
  const handles = useRef(new Map<string, HTMLButtonElement>());

  // A re-render in the pending order can move the held row's DOM node,
  // which drops focus; put it back so the next arrow key still lands.
  useLayoutEffect(() => {
    if (pickup === null) return;
    const el = handles.current.get(pathOf(pickup.level, pickup.id));
    if (el !== undefined && document.activeElement !== el) el.focus();
  }, [pickup]);

  const isDisabled = (level: SortableLevel): boolean =>
    typeof disabled === "function" ? disabled(level) : disabled;

  const commit = (held: Held, siblings: readonly T[], to: number): void => {
    if (to === held.origin) return;
    const rest = siblings.filter((_, i) => i !== held.origin);
    const anchor = to > held.origin ? rest[to - 1] : rest[to];
    onMove({
      parentId: held.parentId,
      fromIndex: held.origin,
      toIndex: to,
      ...(anchor === undefined
        ? {}
        : to > held.origin
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
    storedIndex: number,
  ): void => {
    const id = getId(item);
    const count = siblings.length;
    const held = pickup !== null && pickup.level === levelKey && pickup.id === id ? pickup : null;
    const name = itemName(item);

    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const active = held ?? { level: levelKey, parentId, id, origin: storedIndex, current: storedIndex };
      const to = active.current + (e.key === "ArrowUp" ? -1 : 1);
      if (to < 0 || to >= count) {
        if (held === null) return;
        setAnnouncement(`${name} is at position ${String(active.current + 1)} of ${String(count)}`);
        return;
      }
      setPickup({ ...active, current: to });
      setAnnouncement(`${name} moved to position ${String(to + 1)} of ${String(count)}`);
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (held === null) {
        setPickup({ level: levelKey, parentId, id, origin: storedIndex, current: storedIndex });
        setAnnouncement(`${name} picked up, position ${String(storedIndex + 1)} of ${String(count)}`);
        return;
      }
      setPickup(null);
      setAnnouncement(`${name} dropped at position ${String(held.current + 1)} of ${String(count)}`);
      commit(held, siblings, held.current);
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

  const renderLevel = (
    levelItems: readonly T[],
    depth: number,
    parentId: string | null,
    levelKey: string,
  ): React.JSX.Element => {
    const level: SortableLevel = { parentId, depth };
    const reorderable = canReorder(level);
    const inert = isDisabled(level);
    const held = pickup !== null && pickup.level === levelKey ? pickup : null;
    const rendered = held === null ? levelItems : moveInArray(levelItems, held.origin, held.current);
    const draggingHere = dragging !== null && dragging.level === levelKey ? dragging : null;

    // Where the line goes in this level, as [rendered index, edge].
    let line: readonly [number, Edge] | null = null;
    if (draggingHere !== null && over !== null && over !== draggingHere.origin) {
      line = [over, draggingHere.origin < over ? "below" : "above"];
    } else if (held !== null && held.current !== held.origin) {
      line = [held.current, held.current < held.origin ? "above" : "below"];
    }

    return (
      <ul className={`m-0 list-none p-0 ${listClassName}`}>
        {rendered.map((item, index) => {
          const id = getId(item);
          const storedIndex = held === null ? index : levelItems.indexOf(item);
          const path = pathOf(levelKey, id);
          const kids = nesting && depth + 1 < maxDepth ? (getChildren?.(item) ?? []) : [];
          const hasChildren = kids.length > 0;
          const expanded = hasChildren && (startCollapsed ? toggled.has(path) : !toggled.has(path));
          const edge = line !== null && line[0] === index ? line[1] : undefined;
          const moving = (held?.id === id) || (draggingHere?.id === id);
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
              onKeyDown={e => { onHandleKeyDown(e, item, levelKey, parentId, levelItems, storedIndex); }}
              onBlur={e => {
                // Focus moving to another control ends the pickup
                // without a write; a re-render dropping focus does not
                // (relatedTarget is null then, and it is restored).
                if (held?.id === id && e.relatedTarget !== null) {
                  setPickup(null);
                  setAnnouncement("Move cancelled");
                }
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
              className="inline-flex min-h-[24px] min-w-[20px] shrink-0 items-center justify-center rounded text-text-tertiary hover:bg-bg-muted"
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
              data-dragging={draggingHere?.id === id ? "true" : undefined}
              data-picked-up={held?.id === id ? "true" : undefined}
              // SET-6: the drop indicator is an attribute a test can read,
              // not only a line a person can see.
              data-drop-indicator={edge}
              draggable={canDrag}
              onDragStart={e => {
                // A nested draggable (a link) or a deeper row starts its own drag.
                if (!canDrag || e.target !== e.currentTarget) return;
                e.stopPropagation();
                // A synthetic event (a test, a dispatched drag) may carry none.
                const dt = e.dataTransfer as DataTransfer | null | undefined;
                if (dt !== null && dt !== undefined) {
                  dt.effectAllowed = "move";
                  dt.setData("text/plain", name);
                }
                setPickup(null);
                setDragging({ level: levelKey, parentId, id, origin: storedIndex, current: storedIndex });
                setOver(null);
              }}
              onDragOver={e => {
                if (draggingHere === null) return;
                e.preventDefault();
                e.stopPropagation();
                const dt = e.dataTransfer as DataTransfer | null | undefined;
                if (dt !== null && dt !== undefined) dt.dropEffect = "move";
                if (over !== index) setOver(index);
              }}
              onDrop={e => {
                if (draggingHere === null) return;
                e.preventDefault();
                e.stopPropagation();
                setDragging(null);
                setOver(null);
                setAnnouncement(
                  `${itemName(levelItems[draggingHere.origin] as T)} moved to position ${String(index + 1)} of ${String(levelItems.length)}`,
                );
                commit(draggingHere, levelItems, index);
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
      onDragOver={e => {
        // Over a row of another level (a row that did not claim the
        // event): that is no drop target, so no line.
        const row = (e.target as Element).closest("[data-sortable-row]");
        if (row !== null && over !== null) setOver(null);
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
