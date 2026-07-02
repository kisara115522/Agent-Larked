/** A per-agent skill, materialized into <sessionCwd>/.claude/skills/<name>/
 *  by the harness before spawn. Name is sanitized to [a-zA-Z0-9_-]+ on both
 *  server and harness sides (it becomes a filesystem path).
 *
 *  Shared between callback-server.ts (wire type) and agent-harness.ts
 *  (materialization) to avoid a circular import. */
export interface SkillDefinition {
  name: string;
  description: string;
  body: string;
}
