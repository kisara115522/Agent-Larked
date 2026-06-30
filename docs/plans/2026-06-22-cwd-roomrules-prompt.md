# Plan: per-room 工作目录 + room rules 接入主链路 + 提示词体系加厚

> 作者: Opus 4.8 | 日期: 2026-06-22 | 执行者: Sonnet
> 状态: 待执行
> 关联: stdio backend + inbox hook 已落地。本计划修复 spawn 上下文透传断点 + 加厚 prompt。

---

## 0. 给执行者(Sonnet)的话

- 本文是唯一事实源。所有"为什么"都已写明,根因都是**源码逐行确认**,不是猜测。
- **提交粒度:极细 = 一次改动一个提交。** 同一文件可出现在多个提交。每个提交后对应包 `build` 过、能测的 `test` 绿。
- **commit message 不加 Co-Authored-By 尾注。** 用项目规范(改了什么/为什么/影响)。
- 发现新问题立刻写 `docs/backlog.md`。
- skill/mcp per-agent **不在本次范围**(用户明确暂不做)。

---

## 1. 背景与根因(源码确认)

启动 agent 的真实链路:
```
server callback event → runtime handleSpawn/handleWake → runner.spawn → harness.spawn → ClaudeStdioBackend.spawn('claude', args, {cwd})
```

**关键事实:** agent 实际是 claude CLI 子进程,harness 是它的父进程编排层(给 prompt/MCP/hook,收事件)。`spawn('claude', args, { cwd })` 的 cwd 由 harness 决定。tool loop 是 claude 自己跑的,harness 不参与。

### 三个断点(同一病:server 存了配置,但 spawn 链路没透传)

| 问题 | 存储 | 渲染/接口 | spawn 透传 | 现状 |
|---|---|---|---|---|
| cwd | — | — | ❌ `agent-runner.ts:68` 写死 `PROJECT_ROOT` | 所有 agent 共用仓库根目录,互相踩 |
| room rules | ✅ `rooms.rules`(db.ts:28) | ✅ `composeRoomSection`(prompt-composer.ts:170) | ❌ event 不带、runtime 不构造 RoomContext | 设了也白设 |
| prompt 太薄 | — | `getBaseInstructions` 仅 7 行 | ✅ 但内容单薄 | 缺角色/工作流/协作指引 |

**断点逐层确认:**
- `CallbackEvent`(callback.ts:8-23)只有 `room_id`/`room_name`,**无 `room_rules`、无 `cwd`**。
- `runtime.ts:189-194` handleSpawn 调 `runner.spawn` 时**不传 `room`、不传 `cwd`**,且 prompt 只用 room 名拼一句话。
- `runner.spawn`(agent-runner.ts:120-129)建 `SpawnRequest` 时**不填 `room`、不填 `cwd`**(虽然 SpawnRequest 有 `room` 字段)。
- `harness.spawn`(agent-harness.ts:146,165)用 `this.config.cwd`(全局 PROJECT_ROOT),不从 request 取。

---

## 2. 目标

1. **per-room 工作目录**:每个 room 启动 agent 时,agent 跑在该 room 专属的 cwd 里(同 room 共享、跨 room 隔离);agent 单独 spawn(无 room)可指定 cwd,否则用默认 workspace。启动前自动 `mkdir -p`。
2. **room rules 接入主链路**:server 从 `rooms.rules` 读出,经 callback event → runtime → runner → harness 透传,最终由 `composeRoomSection` 渲染进 system prompt。agent 真正看到 room rules。
3. **提示词体系加厚**:`getBaseInstructions` 从 7 行扩成有结构的 system prompt(角色定位 / 协作规范 / 工具使用 / room 上下文 / inbox 处理),但不过度膨胀。

---

## 3. 设计

### 3.1 工作目录(per-room)

**策略:per-room workspace,可覆盖。**
- room 有 workspace 概念:默认路径 `data/workspaces/rooms/<roomId>/`,room 创建/配置时可指定自定义路径(存 `rooms.workspace` 列)。
- agent 在 room 内 spawn → cwd = room 的 workspace。
- agent 单独 spawn(无 room,如纯 DM)→ cwd = `data/workspaces/agents/<agentId>/`(per-agent 默认),或配置指定的默认 workspace。
- 兜底:都解析不到 → 用全局 `PROJECT_ROOT`(保持现状兼容)。
- harness 启动前 `mkdir -p(cwd, { recursive: true })`,确保目录存在。

**为什么 per-room 而非 per-agent:** 同 room 的 agent 通常协作同一任务,共享工作区合理;跨 room 隔离避免踩踏。用户确认 per-room。

### 3.2 room rules 透传

```
rooms.rules (DB)
  → server 构造 callback event 时带上 room_rules
  → CallbackEvent.room_rules
  → runtime handleSpawn/handleWake 构造 RoomContext { roomId, roomName, roomRules }
  → runner.spawn({ room })  (SpawnRequest.room 已存在)
  → harness.spawn 把 request.room 传进 composeSystemPrompt
  → composeRoomSection 渲染  ← 自动生效
```

### 3.3 prompt 加厚

`getBaseInstructions()` 重构为结构化段落(仍保持简洁,不堆砌):
- 角色:Flock 协作平台上的 AI agent,可沟通/用工具/完成任务。
- 协作规范:响应后调 flock_wait;不进未授权 room;尊重 room rules。
- 工具使用:已有 getToolGuidelines,合并/精炼。
- inbox 处理:已有 getInboxInstructions(不动)。
- 工作目录意识:在 cwd 内工作,文件操作限定在自己的 workspace。

---

## 4. 完整代码

### 4.1 数据层:`rooms.workspace` 列

`packages/server/src/db.ts` rooms 表加列。**用现有 `migrateColumn` helper**(db.ts 已有,`rooms.rules` 就是这么加的,见 db.ts:496),不要手写 ALTER/try-catch:
```ts
// 在现有 migrateColumn(...) 调用区追加一行(挨着 rooms.rules 那几行):
migrateColumn(db, 'rooms', 'workspace', "TEXT DEFAULT ''");
```
同时在 `CREATE TABLE rooms` 的初始定义里也加 `workspace TEXT DEFAULT ''`(新库直接有,老库靠 migrateColumn 补)。

### 4.2 CallbackEvent 扩字段

`packages/server/src/services/callback.ts`:
```ts
export interface CallbackEvent {
  type: 'spawn' | 'stop' | 'wake';
  // ... 现有字段 ...
  room_id?: string;
  room_name?: string;
  room_rules?: string;   // 新增:从 rooms.rules 读出
  cwd?: string;          // 新增:room workspace 或 agent workspace 路径
  message_id?: string;
  sender_name?: string;
  excerpt?: string;
}
```

### 4.3 server 构造 event 时填 room_rules + cwd

**填充点不是 3 处,是 5 处 event 构造**(全部在 callback.ts,源码确认):

| 行 | 类型 | trigger | 有 room_id? | 处理 |
|---|---|---|---|---|
| ~211 | wake | mention/broadcast | ✅ `pending.roomId` | 填 room_rules + room cwd |
| ~494 | wake | direct_message | ❌ 无 | room_rules 空,cwd 走 **per-agent 默认** |
| ~533 | spawn | (room spawn) | ✅ `roomId` | 填 room_rules + room cwd |
| ~610 | wake | task_assignment | ✅ `roomId` | 填 room_rules + room cwd ← **之前漏了这处** |
| ~645 | stop | — | — | 不动(stop 无需 cwd/rules) |

**两个分开的关注点,分开解决:**

**(a) room_rules — 按各处的 roomId 填**(无 roomId 则不填):
```ts
// 新增 helper
function resolveRoomRules(db: Database.Database, roomId: string | undefined): string | undefined {
  if (!roomId) return undefined;
  const row = db.prepare('SELECT rules FROM rooms WHERE id = ?')
    .get(roomId) as { rules: string | null } | undefined;
  return row?.rules && row.rules.trim() ? row.rules : undefined;
}
```
4 处带 roomId 的 event 构造里加:`room_rules: resolveRoomRules(db, <roomId>)`。

**(b) cwd — 统一塞进 `agentCallbackFields`**,因为 5 处 event 都已 spread 它,集中处理最不易漏。但它现在只收 agentId 不收 roomId,需加一个可选 roomId 参数:
```ts
// 改 agentCallbackFields 签名,加 roomId 参数
function agentCallbackFields(
  db: Database.Database,
  agentId: string,
  agent?: { name: string; model: string | null },
  token?: string,
  roomId?: string,          // 新增
): AgentCallbackFields & { cwd: string } {   // 返回值加 cwd
  // ... 现有 profile/config 逻辑不变 ...
  return {
    agent_token: token,
    agent_name: profile?.name,
    agent_model: config.model ?? profile?.model ?? undefined,
    agent_provider: config.provider,
    cwd: resolveWorkspace(db, agentId, roomId),   // 新增
  };
}

function resolveWorkspace(db: Database.Database, agentId: string, roomId: string | undefined): string {
  // room 优先:room.workspace 自定义 → 否则 room 默认目录
  if (roomId) {
    const row = db.prepare('SELECT workspace FROM rooms WHERE id = ?')
      .get(roomId) as { workspace: string | null } | undefined;
    if (row?.workspace && row.workspace.trim()) return row.workspace;
    return path.resolve(repoRoot, 'data/workspaces/rooms', roomId);
  }
  // 无 room(DM 场景):per-agent 默认
  return path.resolve(repoRoot, 'data/workspaces/agents', agentId);
}
```
4 处带 roomId 的调用传 roomId;DM wake(行 494)不传 → 自动走 per-agent 默认。**因为 cwd 从 agentCallbackFields 统一出,5 处全自动带上,不会漏。**

> `repoRoot`:callback.ts 顶部已有/或从 server 配置取(确认现有怎么拿 data 路径,沿用同一来源,与 db.ts 的 dbPath 推导一致)。
> `room_name` 已有填充(各处现成),本计划不改。

### 4.4 runtime handleSpawn/handleWake 构造 RoomContext + cwd

`packages/runtime/src/runtime.ts`:
```ts
// 新增 helper
function buildRoomContext(event: CallbackEvent): RoomContext | undefined {
  if (!event.room_id) return undefined;
  return {
    roomId: event.room_id,
    roomName: event.room_name ?? event.room_id,
    roomRules: event.room_rules,
  };
}

// handleSpawn / handleWake 调 runner.spawn 时加:
await this.runner.spawn(event.agent_id, prompt, event.agent_token, event.agent_name, {
  sessionId: event.session_id,
  model: event.agent_model,
  provider: normalizeProvider(event.agent_provider),
  backendConfig: this.config.defaultBackend,
  room: buildRoomContext(event),     // 新增
  cwd: event.cwd,                    // 新增
});
```

### 4.5 AgentSpawnOptions + SpawnRequest 加 cwd

`packages/runtime/src/agent-runner.ts`(**注意:`RoomContext` 当前未在此文件导入,需先加 import —— 见 C11**):
```ts
import type { RoomContext } from './harness/prompt-composer.js'; // 或从 harness/index 导出处

export interface AgentSpawnOptions {
  // ... 现有 ...
  room?: RoomContext;   // 新增(透传给 SpawnRequest)
  cwd?: string;         // 新增
}

// spawn() 内建 SpawnRequest 时:
const request: SpawnRequest = {
  // ... 现有 ...
  room: options?.room,    // 新增
  cwd: options?.cwd,      // 新增
};
```

`packages/runtime/src/harness/agent-harness.ts` SpawnRequest:
```ts
export interface SpawnRequest {
  // ... 现有 ...
  room?: RoomContext;
  cwd?: string;   // 新增:per-room/per-agent workspace,优先于全局 config.cwd
}
```

### 4.6 harness 用 request.cwd + mkdir

`packages/runtime/src/harness/agent-harness.ts` spawn():
```ts
import { mkdirSync } from 'node:fs';

// 解析 cwd:request 优先 → 否则全局 config.cwd
const sessionCwd = request.cwd && request.cwd.trim()
  ? request.cwd
  : this.config.cwd;

// 确保目录存在(claude spawn 前必做,否则子进程 cwd 无效)
try {
  mkdirSync(sessionCwd, { recursive: true });
} catch (err) {
  // 目录已存在或权限问题:记录但继续(claude 会报错如果真无效)
  console.warn(`[harness] mkdir sessionCwd failed: ${sessionCwd}`, err);
}

const ctx: AgentRunContext = {
  // ... 现有 ...
  cwd: sessionCwd,   // 改:用 sessionCwd 而非 this.config.cwd
  // room 已在 request.room,composeSystemPrompt 已用
};
```

> `composeSystemPrompt` 已经接收 `request.room`(agent-harness.ts:143 `room: request.room`),**这一步本来就连着**——只要 runtime 开始填 `room`,room rules 自动渲染。验证这一点是 plan 验收的关键。

### 4.7 prompt 加厚

`packages/runtime/src/harness/prompt-composer.ts` `getBaseInstructions()`:
```ts
function getBaseInstructions(): string {
  return `You are an AI agent operating in the Flock collaboration platform — a multi-agent workspace where humans and agents communicate through rooms, direct messages, and tasks.

## Your role
- You are an autonomous worker: given a task, you use tools to investigate, decide, and act — then report results clearly.
- You operate inside a working directory (your workspace). Keep all file reads, edits, and commands scoped to it unless explicitly told otherwise.

## Collaboration
- After you finish responding to a message, call flock_wait to stay available for the next one. Do not exit.
- Only post in rooms you've been instructed to join. Respect the room rules provided to you.
- When another agent or human is waiting on you, be responsive: either act or acknowledge with a plan.

## Doing work
- Prefer specific tools over generic ones. When several independent tool calls are possible, batch them in one block.
- If a tool call fails, read the error and adapt rather than retrying blindly.
- For file edits, read the file first to understand current state.
- For long-running commands, run them in the background when appropriate.

## Staying reachable while busy
New messages and your own todo queue are surfaced to you at tool boundaries (see the FLOCK INBOX notes). Never silently ignore them — act now or capture with flock_todo_add.`;
}
```
> `getToolGuidelines` 的内容并入上面的 "Doing work" 段,可删除独立的 getToolGuidelines 调用(或保留为空壳)。`getInboxInstructions` 保持独立段不动。

---

## 5. 原子提交清单

### Phase 1 — 数据层 + 字段

| # | commit | 文件 | 改动 |
|---|---|---|---|
| C1 | `feat(server): add workspace column to rooms table` | ~`server/src/db.ts` | migration ALTER TABLE rooms ADD workspace |
| C2 | `feat(server): add room_rules + cwd to CallbackEvent` | ~`services/callback.ts` | CallbackEvent 接口加两字段(仅类型,未填充) |
| C3 | `feat(runtime): add cwd to AgentSpawnOptions + SpawnRequest` | ~`agent-runner.ts` ~`harness/agent-harness.ts` | 加 cwd 字段(透传,未使用) |
| C4 | `feat(runtime): add room to AgentSpawnOptions passthrough` | ~`agent-runner.ts` | AgentSpawnOptions 加 room,spawn() 填进 SpawnRequest |

### Phase 2 — server 填充 room_rules + cwd

| # | commit | 文件 | 改动 |
|---|---|---|---|
| C5 | `feat(server): add resolveWorkspace helper (room / per-agent)` | ~`services/callback.ts` | §4.3(b):roomId→room workspace 或默认目录;无 roomId→per-agent 默认 |
| C6 | `feat(server): add resolveRoomRules helper` | ~`services/callback.ts` | §4.3(a):roomId→rooms.rules(空则 undefined) |
| C7 | `feat(server): add cwd to agentCallbackFields via roomId param` | ~`services/callback.ts` | agentCallbackFields 加可选 roomId 参数,返回值加 cwd=resolveWorkspace。**5 处 spread 它的 event 自动带 cwd** |
| C8 | `feat(server): pass roomId to agentCallbackFields at room emit sites` | ~`services/callback.ts` | 行~211(mention/broadcast wake)、~533(spawn)、~610(task_assignment wake)传 roomId;行~494(DM)不传(走 per-agent) |
| C9 | `feat(server): populate room_rules at the 4 room-bearing emit sites` | ~`services/callback.ts` | 4 处带 roomId 的 event 加 `room_rules: resolveRoomRules(db, roomId)`(DM 那处无 roomId,不填) |
| C10 | `test(server): callback carries cwd (room + per-agent) and room_rules` | +测试 | room 有 rules+workspace→event 两字段对;无 workspace→默认 room 目录;DM(无 room)→per-agent cwd、room_rules 为空 |

### Phase 3 — runtime 透传 RoomContext + cwd

| # | commit | 文件 | 改动 |
|---|---|---|---|
| C11 | `feat(runtime): import RoomContext type into agent-runner` | ~`agent-runner.ts` | 从 harness/prompt-composer 导入 RoomContext(C4 用到但未导入,补上) |
| C12 | `feat(runtime): add buildRoomContext helper in runtime` | ~`runtime.ts` | §4.4 |
| C13 | `feat(runtime): pass room + cwd to runner.spawn in handleSpawn` | ~`runtime.ts` | §4.4,handleSpawn 调用加 room/cwd |
| C14 | `feat(runtime): pass room + cwd to runner.spawn in handleWake` | ~`runtime.ts` | handleWake 同样 |
| C15 | `test(runtime): handleSpawn builds RoomContext from event` | +测试 | event 带 room_rules → runner.spawn 收到 room.roomRules |

### Phase 4 — harness 用 request.cwd + mkdir

| # | commit | 文件 | 改动 |
|---|---|---|---|
| C16 | `feat(runtime): resolve sessionCwd from request in harness` | ~`harness/agent-harness.ts` | §4.6,request.cwd 优先,fallback config.cwd |
| C17 | `feat(runtime): mkdir sessionCwd before spawn` | ~`harness/agent-harness.ts` | mkdirSync recursive,try/catch |
| C18 | `feat(runtime): pass sessionCwd into AgentRunContext` | ~`harness/agent-harness.ts` | ctx.cwd = sessionCwd |
| C19 | `test(runtime): harness uses request.cwd and creates dir` | +测试 | request.cwd 指向 tmp → mkdir 成功 + ctx.cwd = 该路径;无 request.cwd → 用 config.cwd |

### Phase 5 — prompt 加厚

| # | commit | 文件 | 改动 |
|---|---|---|---|
| C20 | `refactor(runtime): thicken getBaseInstructions with structure` | ~`harness/prompt-composer.ts` | §4.7,结构化段落 |
| C21 | `refactor(runtime): fold tool guidelines into base instructions` | ~`harness/prompt-composer.ts` | 合并 getToolGuidelines 进 base,移除独立调用(同步改 composeSystemPrompt 不再 push getToolGuidelines) |
| C22 | `test(runtime): system prompt includes role/collaboration/workspace sections` | ~测试 | composeSystemPrompt 输出含关键串 |

### Phase 6 — 端到端验证 + 文档

| # | commit | 文件 | 改动 |
|---|---|---|---|
| C23 | (端到端复现,不提交) | — | 起一个 room 设 rules + workspace,spawn agent,确认 claude 子进程 cwd=workspace、system prompt 含 room rules |
| C24 | `docs: document per-room cwd + room rules wiring` | ~`docs/progress.md` ~`docs/roadmap.md` | 记录 |
| C25 | `docs: add follow-ups to backlog` | ~`docs/backlog.md` | §6 |

---

## 6. 关键决策

1. **per-room workspace,可覆盖。** 同 room 共享、跨 room 隔离;agent 无 room 时 per-agent 默认;都无则全局 PROJECT_ROOT 兜底。
2. **workspace 路径存 `rooms.workspace` 列,空则用默认 `data/workspaces/rooms/<roomId>`。** 用户可在 room 配置里指定自定义路径(如指向真实代码仓库)。
3. **harness 启动前 `mkdir -p` sessionCwd。** claude 子进程 cwd 必须存在,否则 spawn 报错。
4. **room rules 走现成 RoomContext + composeRoomSection,不新造渲染。** harness 已经 `room: request.room` 连着 composeSystemPrompt,只缺上游填数据。这是最小改动路径。
5. **prompt 加厚但不膨胀。** 结构化 4 段(角色/协作/工作/inbox),保持简洁。inbox 段不动。
6. **cwd 透传全链路都是可选字段,空则 fallback。** 不破坏现有 DM-only spawn(无 room)路径。

---

## 7. 写入 backlog 的条目

```markdown
### 🟢 workspace 路径安全校验
- rooms.workspace 是用户可填的任意路径,需校验(禁止 /etc、系统目录等)
- 后续:server 侧 resolveRoomContext 加路径白名单/黑名单
- 状态:open

### 🟢 per-agent workspace(DM 场景)
- 本次 DM-only spawn 走 per-agent 默认 workspace(data/workspaces/agents/<id>)
- 未实现:agent 配置里指定自定义 cwd(per-agent)
- 状态:open(等 skill/mcp per-agent 一起做)

### 🟢 workspace 清理策略
- data/workspaces/rooms/<id> 随 room 删除时是否清理?当前 ON DELETE CASCADE 只删 DB 行,不删目录
- 后续:room 删除时清 workspace 目录,或加 GC
- 状态:open

### 🟢 room rules 版本化(rules_version)未利用
- rooms.rules_version/rules_updated_at 存在但 spawn 时不校验 agent 是否看过最新版
- 后续:agent_room_state.rules_version_seen 比对,prompt 里提示 rules 更新
- 状态:open
```

---

## 8. 验收

1. **per-room cwd:** 起一个 room,设 workspace(或用默认),spawn agent → claude 子进程的 cwd = 该 workspace(`ps`/活动日志可验);agent 的 Bash/Read 默认在该目录下工作。
2. **目录自动创建:** workspace 不存在 → harness mkdir 后 spawn 成功,不报错。
3. **room rules 生效:** room 设 rules("只许用中文回复"之类)→ spawn 的 agent system prompt 里出现 `Room Rules:` 段 → agent 行为遵守。
4. **DM 回归:** 无 room 的 DM spawn 仍正常,cwd 走 per-agent 默认或全局兜底,不崩。
5. **prompt 加厚:** system prompt 含角色/协作/工作/inbox 四段结构,不再是 7 行。
6. 全部单测绿;完成后开 `Code Reviewer` 审查 agent-harness.ts(cwd/mkdir)+ prompt-composer.ts + callback.ts(透传)。
