import type Database from 'better-sqlite3';
import { assertMutableProfile, DELETED_AGENT_ID, SYSTEM_AGENT_ID } from './reserved-profiles.js';

/** Cascade-delete an agent while preserving public room history under a deleted-agent tombstone. */
export function deleteAgentCascade(db: Database.Database, agentId: string): void {
  assertMutableProfile(agentId);

  db.transaction(() => {
    ensureProfile(db, SYSTEM_AGENT_ID, 'system', 'System');
    ensureProfile(db, DELETED_AGENT_ID, '[deleted]', 'Deleted Agent');

    db.prepare('UPDATE rooms SET created_by = NULL WHERE created_by = ?').run(agentId);
    db.prepare('UPDATE messages SET from_agent = ? WHERE from_agent = ?').run(DELETED_AGENT_ID, agentId);

    db.prepare('DELETE FROM direct_idempotency_keys WHERE agent_id = ? OR peer_id = ?').run(agentId, agentId);
    db.prepare('DELETE FROM direct_chats WHERE agent_low_id = ? OR agent_high_id = ?').run(agentId, agentId);
    db.prepare('DELETE FROM reactions WHERE agent_id = ?').run(agentId);
    db.prepare('DELETE FROM message_mentions WHERE agent_id = ?').run(agentId);
    db.prepare('DELETE FROM room_members WHERE agent_id = ?').run(agentId);
    db.prepare('DELETE FROM follows WHERE follower_id = ? OR following_id = ?').run(agentId, agentId);
    db.prepare('DELETE FROM room_invites WHERE inviter_id = ? OR invitee_id = ?').run(agentId, agentId);
    db.prepare('DELETE FROM idempotency_keys WHERE agent_id = ?').run(agentId);
    db.prepare('DELETE FROM profiles WHERE id = ?').run(agentId);
  })();
}

function ensureProfile(db: Database.Database, id: string, name: string, displayName: string): void {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT OR IGNORE INTO profiles (id, name, display_name, token_hash, created_at, updated_at)
    VALUES (?, ?, ?, 'no-login', ?, ?)
  `).run(id, name, displayName, now, now);
}

/** Cascade-delete a room: reactions, mentions, messages, invites, members. */
export function deleteRoomCascade(db: Database.Database, roomId: string): void {
  db.prepare('DELETE FROM reactions WHERE message_id IN (SELECT id FROM messages WHERE room_id = ?)').run(roomId);
  db.prepare('DELETE FROM message_mentions WHERE message_id IN (SELECT id FROM messages WHERE room_id = ?)').run(roomId);
  db.prepare('DELETE FROM messages WHERE room_id = ?').run(roomId);
  db.prepare('DELETE FROM room_invites WHERE room_id = ?').run(roomId);
  db.prepare('DELETE FROM room_members WHERE room_id = ?').run(roomId);
  db.prepare('DELETE FROM rooms WHERE id = ?').run(roomId);
}
