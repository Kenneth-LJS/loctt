export {
  splitTaskFile,
  parseFrontmatter,
  serializeFrontmatter,
  assembleTaskFile,
  TaskParseError,
} from "./frontmatter.js";

export {
  readTask,
  writeTask,
  readTaskBody,
  writeTaskBody,
} from "./io.js";

export {
  listTaskIds,
  loadAllTasks,
  lookupById,
  lookupByKey,
  lookupTask,
  TaskNotFoundError,
} from "./lookup.js";

export { createTask } from "./create.js";
export type { CreateTaskOptions } from "./create.js";

export { discoverAttachments, buildShowModel } from "./show.js";
export type { AttachmentInfo, TaskShowModel } from "./show.js";

export { setField, unsetField, TaskUpdateError } from "./update.js";

export { archiveTask, unarchiveTask, deleteTask, TaskLifecycleError } from "./lifecycle.js";
