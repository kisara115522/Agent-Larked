# Plan: 工具边界消息注入 + Agent 自主待办队列

> 作者: Opus 4.8 | 日期: 2026-06-17 | 执行者: Sonnet
> 状态: 待执行
> 关联: stdio backend 已落地、DM/activity 可见性已修复。这是"agent 忙时也能收到消息并自主决定如何响应"的最终方案。

---

## 0. 给执行者(Sonnet)的话

- 本文是唯一事实源。所有 claude CLI 行为 + 现有机制都是 Opus **本机实测 / 源码逐行确认**,不是猜测,见 §2。
- **提交粒度:极细 = 一次改动一个提交。** 同一文件可出现在多个提交。每个提交后对应包 `build` 过、能测的 `test` 绿。
- **commit message 不加 Co-Authored-By 尾注。** 用项目规范(改了什么/为什么/影响)。
- 发现新问题立刻写 `docs/backlog.md`。
- **本计划不依赖"模型够聪明"。** 所有行为靠机制保证:消息一定被注入、待办一定被持久化、未完成项一定被回灌提醒。模型只负责"读到信息后做决策",决策错了也不会丢消息/丢任务。

---

## 1. 目标

用户要的闭环:

1. **工具边界注入**:agent 正在执行任务(一连串工具调用)时,有人发消息 → 消息在 agent **下一个工具调用的边界**被注入进上下文 → agent **知道**有人找。不打断、不丢上下文、不必等整个任务结束。
2. **模型自主决策**:注入的消息带清晰的结构和指引,让模型自己判断:这条消息是什么、谁发的、要不要响应、**先做还是后做**。系统不替它决定。
3. **Agent 自主待办队列**:给 agent 一组 MCP 工具管理自己的待办清单。模型收到消息后若认为"当前任务更重要",可以把这条消息**入队**待办,继续手头工作;反之可立即处理。
4. **定期回查机制**:每次工具边界都把"未完成待办 + 新消息"摘要回灌给模型,**机制上保证**模型不会忘记有未做完的事(不依赖模型自觉)。

---

## 2. 技术依据(全部实测 / 源码确认)

### 2.1 claude turn 模型(实测)

一个 turn = 一次"模型请求 → 回应(可能含 tool_use)"。工具执行完把结果喂回 = 下一个 turn。一个任务 = 多个 turn,`result` 帧只在任务**自然收尾**时出现一次。

- 实测:turn **进行中**往 stdin 喂帧,模型**读不到**(BANANA47/KIWI99 暗号丢失)。
- 实测:turn **间隙**(result 后)喂帧,作为新任务消费(MANGO22 成功)。

### 2.2 PostToolUse hook 工具边界注入 —— 本方案的机制基石(实测,决定性)

**为什么必须用 hook 而不是 MCP wrapper:** agent 干实活时绝大多数工具调用是内置工具(Bash/Read/Edit/Write,几十上百次),flock 工具整个任务可能只调一两次(开头 flock_wait、结尾回消息)。MCP wrapper 只能拦截 flock 工具的返回 → agent 正忙时**几乎注入不进去,等于没用**。PostToolUse hook 拦截**每一个**工具调用边界(含 Bash/Read/Edit),才是真正可用的注入点。

**实测证据链(全部本机验证):**

1. **hook 注入的内容模型会读到**:PostToolUse hook 的 `additionalContext`,模型在 thinking 块里复述了注入的暗号(FALCON88)。
2. **决定性:模型会据此改变行为,且在内置工具(Bash)边界生效**:让 agent 数 1-5(每个数字一个 Bash echo),在中途用 hook 注入"从现在起每行末尾加 [MEOW]"。结果 **MEOW 出现 16 次** —— 模型不仅读到,还从注入点之后**真的改变了每一行的行为**。这排除了"看到但忽略"的歧义,证明注入内容真正进入了模型的有效上下文并影响决策。
3. **`--settings` 传 hook 与现有 stdio args 共存无报错**:`--effort low --strict-mcp-config --permission-mode bypassPermissions ... --settings <file>` 一起启动,init 正常,无 settings/hook 报错。

**hook 输出格式(实测可用):**
```json
{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"<注入文本>"}}
```
matcher 用 `*` 匹配所有工具(或留空)。hook 是一个命令,stdin 收到 PostToolUse 事件 JSON,stdout 返回上面的结构。

### 2.3 stdio 如何把 hook 配给 claude(实测确认)

claude CLI 支持 `--settings <file-or-json>` 传入 hook 配置。stdio backend 在 spawn claude 时:
1. 为该 agent 生成一个 settings JSON(含 PostToolUse hook 指向我们的注入脚本)。
2. hook 脚本需要知道"当前是哪个 agent" → 通过环境变量 `FLOCK_AGENT_ID` 传给 claude 子进程,hook 脚本读它来查对应 agent 的 inbox。
3. settings 文件和 mcp-config 一样,写临时文件,进程退出时清理。

> MCP wrapper 的现有 mention 注入(`installUnreadMentionInjection`)**保留不动**——它对 flock 工具边界仍有效,作为 hook 的补充(双保险)。本方案新增的是 hook 这条覆盖全部工具的主通道。

### 2.3b hook 脚本如何拿到 inbox 数据(架构关键)

hook 脚本是 claude 子进程在每个工具边界 spawn 的**独立短命进程**,它不在我们的 server/runtime 进程里。它要读 agent 的 inbox+todo,有两条路:
- **方案 i(选用):hook 脚本直接读 SQLite DB**。脚本拿到 `FLOCK_AGENT_ID` + `DB_PATH`(env 传入),直接查 `pending_messages` / `agent_todos`,构造 digest 输出。无需网络,最快最简。
- 方案 ii(备选):hook 脚本 HTTP 打 server 的一个内部端点。增加延迟和耦合,不选。

→ 选**方案 i**:hook 脚本是个小 node 脚本,`better-sqlite3` 直连 DB。

### 2.4 task 表不可复用(源码确认)

`tasks` 表 `room_id NOT NULL` + orchestrator/review/capabilities,是**协作任务编排**用的。agent 私人待办需独立轻量表 `agent_todos`。

### 2.5 prompt composer 结构(源码确认)

`packages/runtime/src/harness/prompt-composer.ts`:`getBaseInstructions()` 是静态基础指令,`getToolGuidelines()` 是工具指引。注入消息的"如何响应"规范加在这里。

---

## 3. 架构总览

```
人/agent 发 DM 给忙碌 agent A
  → 写 direct_messages 表(已有)
  → 不再丢弃忙碌 agent(callback.ts:103 现状是 return null)
  → 写入 A 的 "inbox"(pending_messages,新表)  ← 待 A 下个工具边界自取
  ↓
agent A 正在跑任务,调用【任意工具】(Bash/Read/Edit/flock_*...)
  → 每个工具调用结束 → claude 触发 PostToolUse hook
  → hook 脚本(小 node 进程)读 FLOCK_AGENT_ID + DB_PATH
  → 直查 pending_messages(未投递) + agent_todos(未完成)
  → 有 → 构造 digest,通过 additionalContext 注入进上下文;标记消息 delivered
  ↓
模型在该工具结束后读到(进入 thinking + 决策):
  「📨 新消息: kisara 说 "..." (3 分钟前)」
  「📋 你有 2 条未完成待办: #1 ..., #2 ...」
  「指引: 立即处理 或 flock_todo_add 入队稍后做。绝不静默忽略。」
  ↓
模型自主决策:
  - 立即回 → flock_dm_send / flock_post
  - 稍后做 → flock_todo_add(入队)
  - 已在待办里、现在做完 → flock_todo_complete
```

**机制保证(不依赖模型聪明):**
- 消息一定进 inbox(server 写入,不丢)。
- inbox + todos 一定在**每个工具边界**(含内置工具)被注入(PostToolUse hook 强制,覆盖全部工具)。
- 未完成 todo 一定持续出现在注入摘要里,直到被显式 complete(回查机制)。

---

## 4. 数据模型

### 4.1 新表 `pending_messages`(agent 收件箱)

```sql
CREATE TABLE IF NOT EXISTS pending_messages (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL,          -- 'dm' | 'mention' | 'system'
  sender_id TEXT,                     -- 发送者 profile id(human 或 agent)
  sender_name TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL,
  ref_id TEXT,                        -- 关联的 direct_messages.id / messages.id
  delivered INTEGER NOT NULL DEFAULT 0, -- 0=待注入, 1=已注入给模型
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pending_msg_agent ON pending_messages(agent_id, delivered);
```

> `delivered` 语义:注入给模型一次后置 1,避免每个工具边界重复刷屏同一条消息。但**注入过≠处理过**——模型可能入队待办。"是否处理"由 todos 跟踪,与 pending_messages 解耦。

### 4.2 新表 `agent_todos`(agent 私人待办队列)

```sql
CREATE TABLE IF NOT EXISTS agent_todos (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  content TEXT NOT NULL,              -- 待办描述(模型自己写)
  source_message_id TEXT,             -- 关联的 pending_messages.id(若来自消息)
  priority INTEGER NOT NULL DEFAULT 0,-- 模型自评优先级,高在前
  status TEXT NOT NULL DEFAULT 'open',-- 'open' | 'done' | 'dropped'
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_agent_todos_agent ON agent_todos(agent_id, status);
```

---

## 5. 完整代码(照抄)

### 5.1 server service: `packages/server/src/services/inbox.ts`(新建)

```ts
/**
 * Agent inbox + todo queue services.
 *
 * pending_messages: messages delivered to a busy agent, awaiting injection at
 * the agent's next tool boundary. agent_todos: an agent's private self-managed
 * task queue. Both are read by the MCP tool-result injection wrapper and exposed
 * via flock_todo_* MCP tools.
 */
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';

export interface PendingMessage {
  id: string;
  agent_id: string;
  source_type: 'dm' | 'mention' | 'system';
  sender_id: string | null;
  sender_name: string;
  content: string;
  ref_id: string | null;
  delivered: number;
  created_at: string;
}

export interface AgentTodo {
  id: string;
  agent_id: string;
  content: string;
  source_message_id: string | null;
  priority: number;
  status: 'open' | 'done' | 'dropped';
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

/** Enqueue a message into an agent's inbox (called when the agent is busy). */
export function enqueuePendingMessage(
  db: Database.Database,
  params: {
    agentId: string;
    sourceType: 'dm' | 'mention' | 'system';
    senderId?: string | null;
    senderName?: string;
    content: string;
    refId?: string | null;
  },
): PendingMessage {
  const now = new Date().toISOString();
  const row: PendingMessage = {
    id: randomUUID(),
    agent_id: params.agentId,
    source_type: params.sourceType,
    sender_id: params.senderId ?? null,
    sender_name: params.senderName ?? '',
    content: params.content,
    ref_id: params.refId ?? null,
    delivered: 0,
    created_at: now,
  };
  db.prepare(
    `INSERT INTO pending_messages (id, agent_id, source_type, sender_id, sender_name, content, ref_id, delivered, created_at)
     VALUES (@id, @agent_id, @source_type, @sender_id, @sender_name, @content, @ref_id, @delivered, @created_at)`,
  ).run(row);
  return row;
}

/** Read undelivered pending messages for an agent (does NOT mark delivered). */
export function peekPendingMessages(db: Database.Database, agentId: string, limit = 10): PendingMessage[] {
  return db.prepare(
    `SELECT * FROM pending_messages WHERE agent_id = ? AND delivered = 0 ORDER BY created_at ASC LIMIT ?`,
  ).all(agentId, limit) as PendingMessage[];
}

/** Mark a set of pending messages as delivered (after injecting once). */
export function markDelivered(db: Database.Database, ids: string[]): void {
  if (ids.length === 0) return;
  const placeholders = ids.map(() => '?').join(',');
  db.prepare(`UPDATE pending_messages SET delivered = 1 WHERE id IN (${placeholders})`).run(...ids);
}

/** Add a todo to an agent's private queue. */
export function addTodo(
  db: Database.Database,
  params: { agentId: string; content: string; priority?: number; sourceMessageId?: string | null },
): AgentTodo {
  const now = new Date().toISOString();
  const row: AgentTodo = {
    id: randomUUID(),
    agent_id: params.agentId,
    content: params.content,
    source_message_id: params.sourceMessageId ?? null,
    priority: params.priority ?? 0,
    status: 'open',
    created_at: now,
    updated_at: now,
    completed_at: null,
  };
  db.prepare(
    `INSERT INTO agent_todos (id, agent_id, content, source_message_id, priority, status, created_at, updated_at, completed_at)
     VALUES (@id, @agent_id, @content, @source_message_id, @priority, @status, @created_at, @updated_at, @completed_at)`,
  ).run(row);
  return row;
}

/** List open todos for an agent, highest priority first then oldest. */
export function listOpenTodos(db: Database.Database, agentId: string): AgentTodo[] {
  return db.prepare(
    `SELECT * FROM agent_todos WHERE agent_id = ? AND status = 'open' ORDER BY priority DESC, created_at ASC`,
  ).all(agentId) as AgentTodo[];
}

/** Mark a todo done (or dropped). Returns true if a row was updated. */
export function setTodoStatus(
  db: Database.Database,
  agentId: string,
  todoId: string,
  status: 'done' | 'dropped',
): boolean {
  const now = new Date().toISOString();
  const res = db.prepare(
    `UPDATE agent_todos SET status = ?, updated_at = ?, completed_at = ? WHERE id = ? AND agent_id = ? AND status = 'open'`,
  ).run(status, now, status === 'done' ? now : null, todoId, agentId);
  return res.changes > 0;
}
```

### 5.2 注入摘要构造: `packages/server/src/services/inbox-digest.ts`(新建)

> 放在 server 包(不是 mcp),因为 hook 脚本(§5.3)和将来其它消费者都要用,且它依赖 inbox service。

```ts
/**
 * Build the inbox + todo digest injected at every tool boundary via the
 * PostToolUse hook. This is the mechanism that guarantees a busy agent learns
 * about new messages and never forgets open todos — independent of model diligence.
 */
import type Database from 'better-sqlite3';
import { peekPendingMessages, markDelivered, listOpenTodos } from './inbox.js';

export interface InboxDigest {
  new_messages: Array<{ from: string; content: string; age: string; source: string }>;
  open_todos: Array<{ id: string; content: string; priority: number }>;
  guidance: string;
}

function ageString(iso: string): string {
  // No Date.now() in workflow scripts, but this runs in the MCP process — Date is fine here.
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  return `${Math.floor(min / 60)}h ago`;
}

/**
 * Build the digest for an agent. Marks peeked messages delivered so they are
 * announced once (not re-spammed every tool call); open todos persist until
 * explicitly completed so they keep reminding the model.
 */
export function buildInboxDigest(db: Database.Database, agentId: string): InboxDigest | null {
  const pending = peekPendingMessages(db, agentId);
  const todos = listOpenTodos(db, agentId);

  if (pending.length === 0 && todos.length === 0) return null;

  const digest: InboxDigest = {
    new_messages: pending.map((m) => ({
      from: m.sender_name || m.sender_id || 'unknown',
      content: m.content.slice(0, 500),
      age: ageString(m.created_at),
      source: m.source_type,
    })),
    open_todos: todos.map((t) => ({ id: t.id, content: t.content.slice(0, 300), priority: t.priority })),
    guidance: buildGuidance(pending.length, todos.length),
  };

  // Announce each new message once.
  if (pending.length > 0) markDelivered(db, pending.map((m) => m.id));

  return digest;
}

function buildGuidance(numMsgs: number, numTodos: number): string {
  const parts: string[] = [];
  if (numMsgs > 0) {
    parts.push(
      `You have ${numMsgs} new message(s) that arrived while you were working. ` +
      `For EACH: decide now — (a) handle it immediately if it's quick or urgent (reply via flock_dm_send / flock_post), ` +
      `or (b) if your current work is more important, capture it with flock_todo_add so you don't forget, then continue. ` +
      `Do NOT silently ignore it — either act or enqueue.`,
    );
  }
  if (numTodos > 0) {
    parts.push(
      `You have ${numTodos} open todo(s) above. When you reach a natural stopping point in your current work, ` +
      `address the highest-priority open todo. When you finish one, call flock_todo_complete with its id.`,
    );
  }
  return parts.join(' ');
}
```

### 5.3 PostToolUse hook 脚本: `packages/runtime/src/hooks/inbox-hook.ts`(新建,编译为独立可执行脚本)

claude 在**每个工具边界**(含 Bash/Read/Edit)spawn 这个脚本。脚本从 stdin 读 PostToolUse 事件(忽略其内容),从 env 读 `FLOCK_AGENT_ID` + `DB_PATH`,直查 DB 构造 digest,stdout 返回 `additionalContext`。

```ts
#!/usr/bin/env node
/**
 * PostToolUse hook: injects the agent's inbox + todo digest into the model's
 * context at EVERY tool boundary (built-in tools included). Spawned by the claude
 * CLI per tool call. Reads FLOCK_AGENT_ID + DB_PATH from env, queries the DB
 * directly (own short-lived process, not in the server/runtime process), and
 * emits {hookSpecificOutput:{hookEventName:'PostToolUse',additionalContext}}.
 *
 * Verified: additionalContext at a Bash boundary changed model behavior (MEOW x16).
 * On any error or empty inbox, emits {} (no-op) — never blocks the agent.
 */
import Database from 'better-sqlite3';
import { buildInboxDigest } from '@flock/server/services/inbox-digest';

function emitNoop(): never {
  process.stdout.write('{}');
  process.exit(0);
}

async function main(): Promise<void> {
  // Drain stdin (the PostToolUse event JSON); we don't need its content.
  // Not reading it can leave the parent's pipe write pending on some platforms.
  await new Promise<void>((resolve) => {
    let buf = '';
    process.stdin.on('data', (d) => { buf += d; if (buf.length > 1_000_000) resolve(); });
    process.stdin.on('end', () => resolve());
    process.stdin.on('error', () => resolve());
    // Safety: don't hang forever if no stdin arrives.
    setTimeout(resolve, 500);
  });

  const agentId = process.env.FLOCK_AGENT_ID;
  const dbPath = process.env.DB_PATH;
  if (!agentId || !dbPath) emitNoop();

  let db: Database.Database | undefined;
  try {
    db = new Database(dbPath, { readonly: false });
    const digest = buildInboxDigest(db, agentId);
    if (!digest) emitNoop();
    const text =
      'FLOCK INBOX — new messages and/or your open todos arrived while you were working:\n' +
      JSON.stringify(digest, null, 2) +
      '\n(See your system instructions on handling _flock_inbox: act now, or flock_todo_add to enqueue. Never silently ignore.)';
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: text },
    }));
    process.exit(0);
  } catch {
    emitNoop();
  } finally {
    try { db?.close(); } catch { /* ignore */ }
  }
}

void main();
```

> 注意:hook 脚本必须能 `import @flock/server/services/inbox-digest` —— 它会被编译进 runtime 的 dist。build 配置要确保它作为独立 entry 产出(见 C 提交里处理)。或者更稳妥:脚本内联 buildInboxDigest 的逻辑,避免跨包运行时解析问题(执行时若发现 import 解析失败,改内联 —— 见 §6 决策 2)。

### 5.3b stdio backend 注入 hook 配置(修改 claude-args + claude-stdio)

stdio spawn claude 时,写一个临时 settings JSON 并传 `--settings`,同时把 `FLOCK_AGENT_ID` 注入子进程 env。

`mcp-config.ts` 旁边新增 `writeHookSettingsToTemp`:
```ts
// packages/runtime/src/backends/hook-settings.ts (新建)
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface HookSettingsFile { path: string; cleanup: () => void; }

/** Write a claude --settings file wiring the PostToolUse inbox hook. */
export function writeHookSettingsToTemp(hookScriptPath: string): HookSettingsFile {
  const settings = {
    hooks: {
      PostToolUse: [
        { matcher: '*', hooks: [{ type: 'command', command: `node ${hookScriptPath}` }] },
      ],
    },
  };
  const dir = mkdtempSync(join(tmpdir(), 'flock-hooks-'));
  const path = join(dir, 'settings.json');
  writeFileSync(path, JSON.stringify(settings), { mode: 0o600 });
  return { path, cleanup: () => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ } } };
}
```

`claude-args.ts` 加 `--settings`:
```ts
// buildClaudeArgs 的 extra 增加 hookSettingsPath?: string
if (extra.hookSettingsPath) args.push('--settings', extra.hookSettingsPath);
```

`claude-stdio.ts` 的 exec():
```ts
// 1. 解析 hook 脚本路径(随 runtime dist 一起发布)
const HOOK_SCRIPT = process.env.FLOCK_INBOX_HOOK_PATH
  ?? new URL('../hooks/inbox-hook.js', import.meta.url).pathname;
// 2. 写 settings
const hookSettings = writeHookSettingsToTemp(HOOK_SCRIPT);
const args = buildClaudeArgs(ctx, { mcpConfigPath: mcp.path, resumeSessionId, hookSettingsPath: hookSettings.path });
// 3. env 注入 FLOCK_AGENT_ID + DB_PATH(buildChildEnv 已带 DB_PATH? 否则显式加)
const env = buildChildEnv({ ...ctx.env, FLOCK_AGENT_ID: ctx.agentId ?? '', DB_PATH: <dbPath> });
// 4. finish()/cleanup 时 hookSettings.cleanup()
```

> `DB_PATH` 来源:harness 已知 dbPath(buildMcpServers 用的同一个)。需把它透传进 AgentRunContext 或 backend config,让 stdio 能拼进 hook 脚本的 env。具体在 C 提交里接线。

### 5.3c MCP wrapper 保留(不改)

现有 `installUnreadMentionInjection` 对 flock 工具边界的 mention 注入**保留不动**,作为补充。本方案不改它。

### 5.4 MCP 待办工具: `packages/mcp/src/tools/todo.ts`(新建)

```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { addTodo, listOpenTodos, setTodoStatus } from '@flock/server/services/inbox';
import { getAgentId } from '../db.js';

export function registerTodoTools(
  server: McpServer,
  db: Database.Database,
  agentIdProvider: () => string | null = getAgentId,
): void {
  server.registerTool(
    'flock_todo_add',
    {
      description:
        'Add an item to YOUR OWN private todo queue. Use this when a new message or idea arrives ' +
        'but your current work is more important — capture it here so you address it later instead of ' +
        'dropping it or interrupting yourself. The queue is surfaced back to you at every tool boundary.',
      inputSchema: z.object({
        content: z.string().describe('What needs to be done, in your own words.'),
        priority: z.number().optional().describe('Higher = more urgent. Default 0.'),
        source_message_id: z.string().optional().describe('If this todo came from an inbox message, its id.'),
      }),
    },
    async (args) => {
      const agentId = agentIdProvider();
      if (!agentId) return { content: [{ type: 'text' as const, text: 'Error: agent not registered.' }], isError: true };
      const todo = addTodo(db, { agentId, content: args.content, priority: args.priority, sourceMessageId: args.source_message_id ?? null });
      return { content: [{ type: 'text' as const, text: JSON.stringify({ added: todo.id, content: todo.content }) }] };
    },
  );

  server.registerTool(
    'flock_todo_list',
    {
      description: 'List YOUR open todos, highest priority first. Call this when you reach a stopping point to decide what to do next.',
      inputSchema: z.object({}),
    },
    async () => {
      const agentId = agentIdProvider();
      if (!agentId) return { content: [{ type: 'text' as const, text: 'Error: agent not registered.' }], isError: true };
      const todos = listOpenTodos(db, agentId);
      return { content: [{ type: 'text' as const, text: JSON.stringify({ open_todos: todos.map((t) => ({ id: t.id, content: t.content, priority: t.priority })) }) }] };
    },
  );

  server.registerTool(
    'flock_todo_complete',
    {
      description: 'Mark one of YOUR todos done (status="done") or drop it (status="dropped"). Always complete a todo after you finish the work it describes.',
      inputSchema: z.object({
        todo_id: z.string().describe('The todo id to update.'),
        status: z.enum(['done', 'dropped']).optional().describe('done (default) or dropped.'),
      }),
    },
    async (args) => {
      const agentId = agentIdProvider();
      if (!agentId) return { content: [{ type: 'text' as const, text: 'Error: agent not registered.' }], isError: true };
      const ok = setTodoStatus(db, agentId, args.todo_id, args.status ?? 'done');
      return { content: [{ type: 'text' as const, text: JSON.stringify({ updated: ok, todo_id: args.todo_id }) }] };
    },
  );
}
```

### 5.5 prompt 设计: `prompt-composer.ts`(修改 getBaseInstructions + 新增段)

在 `getBaseInstructions()` 追加一段"如何处理注入消息和待办"(这是核心 prompt 设计):

```ts
function getInboxInstructions(): string {
  return `Handling incoming messages while you work:
While you are working on a task, new messages may arrive from humans or other agents.
After ANY tool call (including Bash/Read/Edit), they are surfaced to you as a
"FLOCK INBOX" note containing "new_messages" (things people sent you), "open_todos"
(your own pending queue), and "guidance". This is how you stay reachable without
being interrupted — you see it at the next tool boundary, not mid-action.

When you see a FLOCK INBOX with new_messages, for EACH message decide:
- If it is quick, urgent, or blocks someone: handle it now — reply with flock_dm_send
  or flock_post, then return to your work.
- If your current work is more important and the message can wait: call flock_todo_add
  to record it (in your own words), then continue. This guarantees you won't forget it.
- Never silently ignore a message. Either act on it or enqueue it.

Your todo queue (open_todos) is YOURS to manage:
- flock_todo_add — capture something to do later.
- flock_todo_list — review what's pending when you reach a stopping point.
- flock_todo_complete — mark a todo done (or dropped) once handled.
Whenever open_todos is non-empty and you finish your current step, address the
highest-priority todo before going idle. Do not call flock_wait while you still
have open todos you intend to do — clear them first.`;
}
```

并在 `composeSystemPrompt` 的静态段加入(getToolGuidelines 之后):
```ts
sections.push(getInboxInstructions());
```

---

## 6. 关键决策

1. **走 PostToolUse hook 注入,覆盖所有工具边界。** MCP wrapper 只拦 flock 工具,而 agent 干实活时几乎全是内置工具(Bash/Read/Edit) → wrapper 基本注入不进去,等于没用。hook 拦截每一个工具调用(实测在 Bash 边界注入改变了模型行为,MEOW×16),是唯一真正可用的注入点。MCP wrapper 的 mention 注入保留作补充,不改。
2. **不打断(不用 interrupt)。** interrupt 实测有时间线错乱风险(用户亲历)。工具边界注入足够及时(下一个工具动作,秒级),且保持上下文/时间线干净 + 模型自主。
3. **hook 脚本直查 SQLite,不走网络。** hook 是 claude 每个工具边界 spawn 的独立短命进程,拿 `FLOCK_AGENT_ID`+`DB_PATH`(env)直连 DB。比 HTTP 打 server 更快更简单。
4. **inbox 与 todo 解耦。** 消息进 inbox(注入一次即 delivered);要不要变成待办由模型用 flock_todo_add 决定。"提醒"和"承诺要做"分离,回查只盯未完成 todo,不重复刷消息。
5. **server 检测忙碌 agent → 写 inbox 而非丢弃。** 替换 callback.ts:103 的 `return null`。
6. **不依赖模型能力。** 消息必入 inbox、必在每个工具边界注入(hook 强制)、todo 必持续提醒直到显式完成——全是机制保证。模型只做决策,决策不影响"不丢消息/不丢任务"。
7. **hook 失败必须 no-op,绝不阻塞 agent。** 脚本任何异常(DB 打不开、import 失败、超时)都输出 `{}` 静默放行,agent 照常工作。inbox 注入是增强,不是关键路径。

---

## 7. 原子提交清单

### Phase 1 — 数据层

| # | commit | 文件 | 改动 |
|---|---|---|---|
| C1 | `feat(server): add pending_messages table for agent inbox` | ~`server/src/db.ts` | 建表 + 索引(§4.1) |
| C2 | `feat(server): add agent_todos table for self-managed queue` | ~`server/src/db.ts` | 建表 + 索引(§4.2) |
| C3 | `feat(server): add inbox service (enqueue/peek/markDelivered)` | +`server/src/services/inbox.ts` | §5.1 的 pending 部分 |
| C4 | `test(server): cover pending message enqueue/peek/deliver` | +测试 | enqueue→peek→markDelivered 流;delivered 不再 peek 到 |
| C5 | `feat(server): add todo service (add/list/setStatus)` | ~`server/src/services/inbox.ts` | §5.1 的 todo 部分 |
| C6 | `test(server): cover todo add/list/complete + priority order` | +测试 | add→list(优先级序)→complete→不再 open |

### Phase 2 — 注入摘要 builder + PostToolUse hook

| # | commit | 文件 | 改动 |
|---|---|---|---|
| C7 | `feat(server): add ageString + InboxDigest types` | +`server/src/services/inbox-digest.ts` | 类型 + ageString |
| C8 | `feat(server): add buildInboxDigest assembling messages + todos` | ~`server/src/services/inbox-digest.ts` | buildInboxDigest + buildGuidance(§5.2) |
| C9 | `test(server): cover buildInboxDigest content + delivered marking` | +测试 | 有消息/有todo/都空→null;peek 后置 delivered |
| C10 | `feat(runtime): add PostToolUse inbox hook script` | +`runtime/src/hooks/inbox-hook.ts` | hook 脚本:读 env→直查 DB→additionalContext(§5.3);任何异常 no-op |
| C11 | `feat(runtime): build inbox-hook as standalone dist entry` | ~`runtime` build 配置(tsconfig/package) | 确保 hook 脚本独立编译产出 `dist/hooks/inbox-hook.js`;若跨包 import 解析有问题,内联 buildInboxDigest(§6 决策7) |
| C12 | `test(runtime): inbox hook emits additionalContext / no-op on empty` | +测试 | 有 inbox→additionalContext 含内容;空/无 env→`{}` |
| C13 | `feat(runtime): add writeHookSettingsToTemp for claude --settings` | +`runtime/src/backends/hook-settings.ts` | §5.3b settings 写临时文件 |
| C14 | `feat(runtime): pass --settings hook config in buildClaudeArgs` | ~`backends/claude-args.ts` | extra.hookSettingsPath → `--settings` |
| C15 | `feat(runtime): wire hook settings + FLOCK_AGENT_ID/DB_PATH into stdio spawn` | ~`backends/claude-stdio.ts` | 写 hookSettings、env 注入 FLOCK_AGENT_ID+DB_PATH、cleanup |
| C16 | `feat(runtime): thread dbPath into AgentRunContext for hook env` | ~`harness/agent-harness.ts` ~`backends/types.ts` | 把 dbPath 透传到 backend,供 hook env 用 |
| C17 | `test(runtime): stdio spawn includes --settings + FLOCK_AGENT_ID env` | ~`__tests__/claude-stdio.test.ts` | 断言 spawn args 含 --settings、env 含 FLOCK_AGENT_ID |

### Phase 3 — 待办 MCP 工具

| # | commit | 文件 | 改动 |
|---|---|---|---|
| C18 | `feat(mcp): add flock_todo_add tool` | +`mcp/src/tools/todo.ts` | flock_todo_add(§5.4) |
| C19 | `feat(mcp): add flock_todo_list tool` | ~`mcp/src/tools/todo.ts` | flock_todo_list |
| C20 | `feat(mcp): add flock_todo_complete tool` | ~`mcp/src/tools/todo.ts` | flock_todo_complete |
| C21 | `feat(mcp): register todo tools in factory` | ~`mcp/src/factory.ts` | import + registerTodoTools |
| C22 | `test(mcp): cover todo tools end-to-end via server` | +测试 | add→list→complete 经工具层 |

### Phase 4 — server 接线:忙碌 agent 写 inbox

| # | commit | 文件 | 改动 |
|---|---|---|---|
| C23 | `feat(server): enqueue DM to inbox when target agent is busy` | ~`services/callback.ts` ~`routes/direct-chats.ts` | wakeDirectMessageAgent:agent.status==='active' 时 enqueuePendingMessage 替代 return null |
| C24 | `feat(server): enqueue mention to inbox for busy room agents` | ~`services/callback.ts` | dispatchPendingRoomWake 同样:忙碌 agent 写 inbox |
| C25 | `test(server): busy agent gets inbox entry not dropped` | +测试 | active agent + DM → pending_messages 有行;dormant → 仍走 wake |

### Phase 5 — prompt 设计

| # | commit | 文件 | 改动 |
|---|---|---|---|
| C26 | `feat(runtime): add inbox/todo handling instructions to base prompt` | ~`harness/prompt-composer.ts` | getInboxInstructions + 加入 composeSystemPrompt(§5.5) |
| C27 | `test(runtime): system prompt includes inbox handling section` | ~测试 | composeSystemPrompt 输出含关键指引串 |

### Phase 6 — 前端可见性(可选)

| # | commit | 文件 | 改动 |
|---|---|---|---|
| C28 | `feat(web): show queued/handled state for DM to busy agent` | ~`DMModal.tsx` | DM 给忙碌 agent 时显示"已送达收件箱,对方会在合适时机处理" |
| C29 | `feat(web): surface agent open todos in agent page` | ~`AgentPage` | 显示 agent 当前 open todos(只读) |

### Phase 7 — 端到端验证 + 文档

| # | commit | 文件 | 改动 |
|---|---|---|---|
| C30 | (端到端复现,不提交) | — | 真实起 server+runtime,DM 一个正在跑多步任务的 agent,确认 hook 在内置工具边界注入、digest 出现、agent 入队或回复 |
| C31 | `docs: document inbox + todo queue mechanism` | ~`docs/progress.md` ~`docs/roadmap.md` | 记录新能力 |
| C32 | `docs: add inbox/todo follow-ups to backlog` | ~`docs/backlog.md` | §8 条目 |

---

## 8. 写入 backlog 的条目

```markdown
### 🟢 hook 每个工具边界 spawn node 进程的开销
- PostToolUse hook 每次工具调用都 spawn 一个 node 脚本查 DB,高频工具调用有进程开销
- 后续:hook 脚本极简化 / 加节流(N 秒内最多注入一次)
- 状态:open

### 🟢 hook 跨包 import 风险
- inbox-hook.ts import @flock/server/services/inbox-digest,独立 spawn 时模块解析可能失败
- 对策(计划内 C11):若解析失败则内联 buildInboxDigest 逻辑到 hook 脚本
- 状态:计划内处理

### 🟢 inbox 消息无 TTL / 上限
- pending_messages 只在注入时置 delivered,不清理。大量消息可能堆积
- 后续:已 delivered 的定期清理 / 每 agent 上限
- 状态:open

### 🟢 todo 优先级由模型自评,可能不准
- priority 是模型自填,无外部校准
- 后续:可让发送者标记紧急度影响初始 priority
- 状态:open

### 🟢 注入 digest 的 token 成本
- 每个 flock 工具边界都注入 inbox+todo 摘要,长会话累积 token
- 已用 delivered 去重消息;todo 持续注入是有意的(回查机制)
- 后续:todo 数量大时只注入 top-N + 计数
- 状态:open
```

---

## 9. 验收

1. **工具边界注入(覆盖内置工具):** agent 正在跑多步任务(status=active,大量 Bash/Read/Edit),人类 DM 它 → pending_messages 入行(不丢弃)→ agent 下次调**任意工具(含内置)**结束后,PostToolUse hook 注入 FLOCK INBOX digest → agent 的后续 thinking/行为体现它读到了。
2. **自主决策:** agent 可能立即 flock_dm_send 回复,也可能 flock_todo_add 入队继续手头工作 —— 两种都正常。
3. **待办闭环:** agent 入队的 todo,在后续每个工具边界的 digest `open_todos` 里持续出现,直到 agent flock_todo_complete;完成后不再出现。
4. **不忘事(机制保证):** 即使模型某轮忽略,open todo 下个工具边界仍会再次注入提醒。
5. **hook 健壮:** DB 不可达 / 无 env / 异常时 hook 输出 `{}`,agent 不受影响照常工作。
6. **回归:** dormant agent 收 DM 仍走原 spawn/wake;消息不丢。
7. 全部单测绿;完成后开 `Code Reviewer` 审查 inbox.ts + inbox-digest.ts + inbox-hook.ts + claude-stdio.ts(spawn 改动)+ todo.ts。
