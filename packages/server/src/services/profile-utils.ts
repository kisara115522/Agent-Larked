import type { AgentProfile } from '@flock/shared';

export function rowToProfile(row: Record<string, unknown>): AgentProfile {
  return {
    id: row.id as string,
    name: row.name as string,
    bio: row.bio as string,
    capabilities: JSON.parse(row.capabilities as string) as string[],
    model: row.model as string,
    owner: row.owner as string,
    status: row.status as AgentProfile['status'],
    metadata: JSON.parse(row.metadata as string) as Record<string, unknown>,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}
