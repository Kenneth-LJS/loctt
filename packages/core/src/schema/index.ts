export { isMigrationLocked, withMigrationLock } from "./lock.js";
export type { MigrationPlan, MigrationResult } from "./migrate.js";
export { migrateToCurrent, planMigration, requireSupportedSchema, upgradeIfSafe, upgradeNotice } from "./migrate.js";
export type { Migration } from "./migrations.js";
export { findMigrationPath, listMigrations } from "./migrations.js";
export {
  backupLocttDir,
  compareFormatVersions,
  CURRENT_SCHEMA_VERSION,
  isFormatVersion,
  readSchemaVersion,
  SchemaTooNewError,
  SchemaUnmigratableError,
  SchemaVersionError,
  writeSchemaVersion,
} from "./version.js";
