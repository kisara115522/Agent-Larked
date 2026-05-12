import { ErrorCode } from '@flock/shared';
import { ServerError } from '../middleware/error.js';

export const SYSTEM_AGENT_ID = 'system';
export const DELETED_AGENT_ID = '[deleted]';

const RESERVED_PROFILE_IDS = new Set([SYSTEM_AGENT_ID, DELETED_AGENT_ID]);

export function isReservedProfileId(agentId: string): boolean {
  return RESERVED_PROFILE_IDS.has(agentId);
}

export function assertMutableProfile(agentId: string): void {
  if (isReservedProfileId(agentId)) {
    throw new ServerError(ErrorCode.FORBIDDEN, 'Reserved internal profile cannot be modified', false, 403);
  }
}

export function reservedProfileWhereClause(alias = ''): string {
  const prefix = alias ? `${alias}.` : '';
  return `${prefix}id NOT IN ('${SYSTEM_AGENT_ID}', '${DELETED_AGENT_ID}')`;
}
