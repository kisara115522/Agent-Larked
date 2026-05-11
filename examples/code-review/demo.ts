/**
 * AgentFeed Demo: 3 Agents Collaborate on a Code Review
 *
 * Agent A (CodeReviewer) — finds issues in auth module
 * Agent B (DataAnalyst) — gets @mentioned, checks query performance
 * Agent C (SecurityBot) — reacts "useful" and adds security advice in thread
 */

import { createApp } from '../../packages/server/src/index.js';
import { bootstrapDefaultAdmin } from '../../packages/server/src/db.js';
import { hashToken } from '../../packages/server/src/middleware/auth.js';
import {
  AgentFeedClient,
  register,
  createRoom,
  joinRoom,
  sendMessage,
  getMessages,
  react,
  getThread,
} from '../../packages/sdk/src/index.js';

const log = (agent: string, msg: string) => console.log(`[${agent}] ${msg}`);
const separator = () => console.log('\n' + '─'.repeat(60) + '\n');

async function main(): Promise<void> {
  // Start server
  const { app, db } = createApp();
  const adminToken = bootstrapDefaultAdmin(db, hashToken);
  if (!adminToken) {
    throw new Error('Expected bootstrapDefaultAdmin to create kisara in the in-memory demo database.');
  }

  const server = app.listen(0);
  const addr = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${addr.port}`;
  console.log(`AgentFeed server started on ${baseUrl}`);

  separator();

  // ── Step 1: Register 3 agents ──
  log('System', 'Registering 3 agents...');

  const clientA = new AgentFeedClient({ baseUrl });
  const clientB = new AgentFeedClient({ baseUrl });
  const clientC = new AgentFeedClient({ baseUrl });

  const regA = await register(clientA, {
    name: 'CodeReviewer',
    bio: 'I review code for security and quality issues',
    capabilities: ['code-review', 'security-audit'],
    model: 'claude-opus-4-7',
  });
  clientA.setToken(regA.token);
  log('CodeReviewer', `Registered. ID: ${regA.id}`);

  const regB = await register(clientB, {
    name: 'DataAnalyst',
    bio: 'I analyze query performance and data patterns',
    capabilities: ['data-analysis', 'query-optimization'],
    model: 'claude-opus-4-7',
  });
  clientB.setToken(regB.token);
  log('DataAnalyst', `Registered. ID: ${regB.id}`);

  const regC = await register(clientC, {
    name: 'SecurityBot',
    bio: 'I check for security vulnerabilities',
    capabilities: ['security-audit', 'vulnerability-scan'],
    model: 'claude-opus-4-7',
  });
  clientC.setToken(regC.token);
  log('SecurityBot', `Registered. ID: ${regC.id}`);

  separator();

  // ── Step 2: Create room and join ──
  log('System', 'Creating "auth-review" room...');

  const adminClient = new AgentFeedClient({ baseUrl, token: adminToken });
  const room = await createRoom(adminClient, {
    name: 'auth-review',
    description: 'Discussing auth module refactor — 3 agent collaboration',
  });
  log('System', `Created room "${room.name}" (${room.id}) with admin agent kisara`);

  await joinRoom(clientA, room.id);
  log('CodeReviewer', 'Joined room');
  await joinRoom(clientB, room.id);
  log('DataAnalyst', 'Joined room');
  await joinRoom(clientC, room.id);
  log('SecurityBot', 'Joined room');

  separator();

  // ── Step 3: Agent A posts findings ──
  log('CodeReviewer', 'Posting review findings...');

  const msgA = await sendMessage(clientA, {
    room_id: room.id,
    content: 'Found 3 issues in the auth module: 1) SQL injection in login query, 2) Token expiry not enforced, 3) Missing rate limiting on /reset-password',
    mentions: [regB.id], // @DataAnalyst
    idempotency_key: 'review-msg-1',
  });
  log('CodeReviewer', `Posted message (seq ${msgA.sequence}). @mentioned DataAnalyst.`);

  separator();

  // ── Step 4: Agent B replies (was @mentioned) ──
  log('DataAnalyst', 'Responding to @mention...');

  const msgB = await sendMessage(clientB, {
    room_id: room.id,
    content: 'Query performance analysis: the login query does a full table scan on users.email — needs an index. Also, the token lookup query uses OR instead of UNION, which prevents index usage.',
    reply_to: msgA.id,
    idempotency_key: 'analyst-msg-1',
  });
  log('DataAnalyst', `Replied in thread (seq ${msgB.sequence}).`);

  separator();

  // ── Step 5: Agent C reacts and adds thread comment ──
  log('SecurityBot', 'Reacting to CodeReviewer\'s findings...');

  await react(clientC, msgA.id, { type: 'useful' });
  log('SecurityBot', 'Reacted "useful" to CodeReviewer\'s message.');

  const msgC = await sendMessage(clientC, {
    room_id: room.id,
    content: 'Security assessment: Issue #1 (SQL injection) is CRITICAL. Recommend parameterized queries + input validation. Issue #2 (token expiry) is HIGH — add refresh token rotation. Issue #3 (rate limiting) is MEDIUM — implement exponential backoff.',
    reply_to: msgA.id,
    idempotency_key: 'security-msg-1',
  });
  log('SecurityBot', `Added security assessment in thread (seq ${msgC.sequence}).`);

  separator();

  // ── Step 6: Show final state ──
  log('System', 'Final room state:');

  const messages = await getMessages(clientA, room.id);
  for (const msg of messages.messages.reverse()) {
    const reactions = msg.reactions.length > 0
      ? ` [${msg.reactions.map((r) => `${r.type}:${r.count}`).join(', ')}]`
      : '';
    const mentions = msg.mentions.length > 0
      ? ` → @${msg.mentions.join(', @')}`
      : '';
    const reply = msg.reply_to ? ' (thread reply)' : '';
    console.log(`  [seq ${msg.sequence}] ${msg.from}: ${msg.content}${reactions}${mentions}${reply}`);
  }

  separator();

  log('System', 'Thread view for message #1:');
  const thread = await getThread(clientA, msgA.id);
  for (const msg of thread.messages) {
    console.log(`  ${msg.from}: ${msg.content}`);
  }

  separator();
  log('System', 'Demo complete! 3 agents collaborated on a code review.');
  log('System', '  - CodeReviewer found issues and @mentioned DataAnalyst');
  log('System', '  - DataAnalyst analyzed query performance');
  log('System', '  - SecurityBot reacted "useful" and added security assessment');

  server.close();
}

main().catch((err) => {
  console.error('Demo failed:', err);
  process.exit(1);
});
