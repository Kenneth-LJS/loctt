import { effectiveInverseKey, effectiveInverseLabel, isSymmetricRelationship } from "@loctt/contracts";
import { loadOptionalConfigs, resolveLocttDir } from "@loctt/core";

/**
 * `loctt schema` — print the workflow config: key prefix, statuses
 * (with category), priorities (with optional numeric value), task
 * types, relationships (with inverses), and custom fields (with
 * their preset values).
 *
 * Read-only; no validation or mutation. The boundary the user
 * cares about is "show me what my workflow.yaml actually defines."
 */
export async function run(_args: string[], root: string): Promise<void> {
  const locttDir = resolveLocttDir(root);
  const { workflowConfig } = await loadOptionalConfigs(locttDir);
  if (!workflowConfig) {
    console.log("No workflow config found.");
    return;
  }
  console.log(`Key prefix: ${workflowConfig.key.prefix}`);
  console.log("");
  console.log("Statuses:");
  for (const s of workflowConfig.statuses) {
    console.log(`  ${s.key} (${s.category}): ${s.label}`);
  }
  if (workflowConfig.priorities.length > 0) {
    console.log("");
    console.log("Priorities:");
    for (const p of workflowConfig.priorities) {
      const valuePart = p.value !== undefined ? ` [${p.value}]` : "";
      console.log(`  ${p.key}: ${p.label}${valuePart}`);
    }
  }
  if (workflowConfig.task_types.length > 0) {
    console.log("");
    console.log("Task types:");
    for (const t of workflowConfig.task_types) {
      console.log(`  ${t.key}: ${t.label}`);
    }
  }
  if (workflowConfig.relationships.length > 0) {
    console.log("");
    console.log("Relationships:");
    for (const r of workflowConfig.relationships) {
      const tags: string[] = [];
      if (r.structural) tags.push("structural");
      if (r.ranked) tags.push("ranked");
      const tagStr = tags.length ? ` [${tags.join(", ")}]` : "";
      if (isSymmetricRelationship(r)) {
        console.log(`  ${r.key} (${r.label}) [symmetric]${tagStr}`);
      } else {
        console.log(`  ${r.key} (${r.label}) ↔ ${effectiveInverseKey(r)} (${effectiveInverseLabel(r)})${tagStr}`);
      }
    }
  }
  if (workflowConfig.custom_fields.length > 0) {
    console.log("");
    console.log("Custom fields:");
    for (const f of workflowConfig.custom_fields) {
      const multi = f.multi ? " multi" : "";
      const searchable = f.searchable ? " searchable" : "";
      console.log(`  ${f.key} (${f.type}${multi}${searchable}): ${f.label}`);
      if (f.values && f.values.length > 0) {
        for (const v of f.values) {
          console.log(`    - ${v.key}: ${v.label}`);
        }
      }
    }
  }
}
