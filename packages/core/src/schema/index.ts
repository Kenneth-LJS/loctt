export { isMigrationLocked, withMigrationLock } from "./lock.js";
export type { MigrationPlan, MigrationResult } from "./migrate.js";
export { migrateToCurrent, planMigration, requireSupportedSchema } from "./migrate.js";
export type { Migration } from "./migrations.js";
export { findMigrationPath, listMigrations } from "./migrations.js";
export {
  backupLocttDir,
  CURRENT_SCHEMA_VERSION,
  readSchemaVersion,
  SchemaTooNewError,
  SchemaVersionError,
  writeSchemaVersion,
} from "./version.js";
