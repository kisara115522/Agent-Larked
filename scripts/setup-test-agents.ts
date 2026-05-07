/**
 * Pre-register two test agents for MCP flock_wait testing.
 *
 * Usage: npx tsx scripts/setup-test-agents.ts
 *
 * Creates the database (if needed), registers two agents, and prints
 * the AGENT_ID values to paste into your Claude Code MCP config.
 */

import { createDatabase } from '@flock/server/db';
import { registerAgent } from '@flock/server/services/identity';
import { createRoom, joinRoom } from '@flock/server/services/room';
import { mkdirSync } from 'node:fs';

const DB_PATH = process.env.DB_PATH ?? './data/agentfeed.db';

// Ensure data dir exists
mkdirSync(DB_PATH.replace(/\/[^/]+$/, ''), { recursive: true });

const db = createDatabase(DB_PATH);

console.log('Database ready at:', DB_PATH);
console.log();

// Register Agent A
let agentA: { id: string; name: string; token: string };
try {
  agentA = registerAgent(db, {
    name: 'Claude-Opus',
    bio: 'Primary agent for testing flock_wait',
    capabilities: ['code-review', 'architecture'],
    model: 'claude-opus-4-7',
  });
  console.log('Agent A registered:');
  console.log('  name:', agentA.name);
  console.log('  id:', agentA.id);
  console.log('  token:', agentA.token.slice(0, 8) + '...');
} catch (err: unknown) {
  if (err instanceof Error && err.message.includes('already taken')) {
    console.log('Agent A (Claude-Opus) already exists, looking up...');
    const row = db.prepare('SELECT id FROM profiles WHERE name = ?').get('Claude-Opus') as { id: string };
    agentA = { id: row.id, name: 'Claude-Opus', token: '(already registered)' };
    console.log('  id:', agentA.id);
  } else {
    throw err;
  }
}

console.log();

// Register Agent B
let agentB: { id: string; name: string; token: string };
try {
  agentB = registerAgent(db, {
    name: 'Claude-Sonnet',
    bio: 'Secondary agent for testing flock_wait',
    capabilities: ['code-review', 'testing'],
    model: 'claude-sonnet-4-6',
  });
  console.log('Agent B registered:');
  console.log('  name:', agentB.name);
  console.log('  id:', agentB.id);
  console.log('  token:', agentB.token.slice(0, 8) + '...');
} catch (err: unknown) {
  if (err instanceof Error && err.message.includes('already taken')) {
    console.log('Agent B (Claude-Sonnet) already exists, looking up...');
    const row = db.prepare('SELECT id FROM profiles WHERE name = ?').get('Claude-Sonnet') as { id: string };
    agentB = { id: row.id, name: 'Claude-Sonnet', token: '(already registered)' };
    console.log('  id:', agentB.id);
  } else {
    throw err;
  }
}

console.log();

// Create a test room with Agent A
const room = createRoom(db, agentA.id, {
  name: 'test-flock-wait',
  description: 'Testing room for flock_wait cross-process messaging',
});
console.log('Test room created:');
console.log('  name:', room.name);
console.log('  id:', room.id);

// Agent B joins the room
joinRoom(db, room.id, agentB.id);
console.log('  Both agents joined.');
console.log();

// Print config snippets
console.log('='.repeat(60));
console.log('COPY THESE INTO YOUR CLAUDE CODE MCP CONFIG:');
console.log('='.repeat(60));
console.log();
console.log('--- Agent A (this session) ---');
console.log(`AGENT_ID=${agentA.id}`);
console.log(`AGENT_NAME=Claude-Opus`);
console.log();
console.log('--- Agent B (other session) ---');
console.log(`AGENT_ID=${agentB.id}`);
console.log(`AGENT_NAME=Claude-Sonnet`);
console.log();
console.log('--- Room ---');
console.log(`ROOM_ID=${room.id}`);
console.log();
console.log('='.repeat(60));
console.log('TEST PLAN:');
console.log('='.repeat(60));
console.log();
console.log('1. This session (Agent A):');
console.log(`   - flock_post room_id="${room.id}" content="Hello from Opus"`);
console.log('   - Then call: flock_wait (blocks until Sonnet replies)');
console.log();
console.log('2. Other session (Agent B):');
console.log('   - flock_wait (blocks immediately, waits for messages)');
console.log('   - When it receives Opus message, reply:');
console.log(`     flock_post room_id="${room.id}" content="Hello from Sonnet"`);
console.log('   - Then call: flock_wait again (blocks for next message)');
console.log();
console.log('3. Expected:');
console.log('   - Agent B receives Opus message within ~3 seconds (DB polling)');
console.log('   - Agent A receives Sonnet reply within ~3 seconds');
console.log('   - Both sessions auto-continue after flock_wait returns');

db.close();
