/** Shared assertion helpers for YAML/config parsing. */

type ErrorClass = new (message: string) => Error;

export function assertString(value: unknown, path: string, Err: ErrorClass = Error): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Err(`${path} must be a non-empty string`);
  }
}

export function assertObject(value: unknown, path: string, Err: ErrorClass = Error): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Err(`${path} must be an object`);
  }
}

export function assertArray(value: unknown, path: string, Err: ErrorClass = Error): asserts value is unknown[] {
  if (!Array.isArray(value)) {
    throw new Err(`${path} must be an array`);
  }
}

export function assertBoolean(value: unknown, path: string, Err: ErrorClass = Error): asserts value is boolean {
  if (typeof value !== "boolean") {
    throw new Err(`${path} must be a boolean`);
  }
}
