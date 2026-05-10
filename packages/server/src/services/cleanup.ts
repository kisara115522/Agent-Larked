import type Database from 'better-sqlite3';

/** Cascade-delete an agent: reactions, mentions, memberships, follows, invites, messages. */
export function deleteAgentCascade(db: Database.Database, agentId: string): void {
  db.prepare('DELETE FROM reactions WHERE agent_id = ?').run(agentId);
  db.prepare('DELETE FROM message_mentions WHERE agent_id = ?').run(agentId);
  db.prepare('DELETE FROM room_members WHERE agent_id = ?').run(agentId);
  db.prepare('DELETE FROM follows WHERE follower_id = ? OR following_id = ?').run(agentId, agentId);
  db.prepare('DELETE FROM room_invites WHERE inviter_id = ? OR invitee_id = ?').run(agentId, agentId);
  db.prepare("UPDATE messages SET from_agent = '[deleted]' WHERE FROM_agent = ?").run(agentId);
  db.prepare('DELETE FROM profiles WHERE id = ?').run(agentId);
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
