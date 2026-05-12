import type { LocttState } from "@loctt/contracts";

export class KeyAllocationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KeyAllocationError";
  }
}

/**
 * Allocates the next key for a given entity type, updating state in-place.
 * Returns the full key string (e.g. "T-124").
 *
 * Caller is responsible for persisting the updated state afterwards.
 */
export function allocateKey(state: LocttState, entityType: string): string {
  const entry = state.keys[entityType];
  if (!entry) {
    throw new KeyAllocationError(
      `no key allocation state for entity type "${entityType}"`
    );
  }

  const key = `${entry.prefix}${entry.next_number}`;

  // Mutate in place — state is mutable during operations.
  state.keys[entityType] = {
    prefix: entry.prefix,
    next_number: entry.next_number + 1,
  };

  return key;
}

/**
 * Initializes key allocation state for a new entity type.
 * Throws if the entity type already exists.
 */
export function initKeyAllocation(
  state: LocttState,
  entityType: string,
  prefix: string,
  startNumber: number = 1,
): void {
  if (state.keys[entityType]) {
    throw new KeyAllocationError(
      `key allocation state already exists for entity type "${entityType}"`
    );
  }
  state.keys[entityType] = {
    prefix,
    next_number: startNumber,
  };
}

/**
 * Appends an old key to the key_history array, returning the updated array.
 * Deduplicates — does not add if the key is already present.
 */
export function appendKeyHistory(
  existing: readonly string[] | undefined,
  oldKey: string,
): string[] {
  const history = existing ? [...existing] : [];
  if (!history.includes(oldKey)) {
    history.push(oldKey);
  }
  return history;
}
