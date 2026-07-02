# Plan: 修复"agent 回复人类看不到" + 私信工作链路可视化(可复用)

> 作者: Opus 4.8 | 日期: 2026-06-16 | 执行者: Sonnet
> 状态: 待执行
> 关联: stdio 迁移已落地(默认 backend = claude-stdio),本计划处理迁移后暴露的消息可见性问题 + 一个新功能

---

## 0. 给执行者(Sonnet)的话

- 本文是唯一事实源。所有"为什么"都已写明,所有根因都是**用 DB 实测数据 / 源码行号证实的**,不是猜测。
- 任务分两块:**A. 修复链(让消息能发出、收到、显示)** + **B. 新功能(私信工作链路时间线,抽成可复用组件)**。
- A 必须先做,因为 B 依赖"消息真的能流动"。
- **提交粒度:极细 = 一次改动一个提交。** 同一文件可出现在多个提交。每个提交后对应包 `build` 必须过;能测的 `test` 必须绿。
- **commit message 不要加 Co-Authored-By 尾注。** 用项目规范(改了什么/为什么/影响)。
- 发现新问题立刻写 `docs/backlog.md`。

---

## 1. 问题全貌(分层根因,从下到上)

用户现象:私信一个 agent,agent"回复了"(工作流页能看到回复+think),但**私信窗口看不到、刷新也没用**;agent 状态一直 dormant。后又发现 **room 里 agent 回复人类也收不到**。

排查用 DB(`data/agentfeed.db`)实测,确认这是**四层独立故障叠加**,不是单点 bug:

### Layer 0 🔴 根因:MCP flock server 连接失败 → agent 根本没发出消息

**DB 实测证据:**
- 每条 init 活动的 metadata 都是 `"mcp_servers":"flock:failed"`(test1/test2/test3/test-agent 全部)。
- 全表 `tool_call` 中 **`flock_*` 工具调用次数 = 0**。
- agent 的"回复"只存在于 `agent_activity_logs`(activity_type=`message`,是 LLM 裸文本输出),`messages`/`direct_messages` 表里**没有 agent 写入的行**。
- 还出现 `message|Not logged in · Please run /login` —— claude CLI 本身的报错被当成 agent 回复记进了 activity。

**因果链:** stdio 迁移后 MCP 由 `--mcp-config` 临时文件交给 claude CLI 加载 → 加载失败 → agent 拿不到 `flock_post`/`flock_dm_send`/`flock_wait` → 它只能 LLM 吐字(被 activity 链路抓到,造成"回复了"假象)或用 Bash 瞎逛 → **消息从未写入 `messages`/`direct_messages`** → 前端读这两张表自然空。

**注意:** 命令行手动复现(用真实 `buildChildEnv` + 照搬 runtime 全部 args)**得到的是 `flock:connected`**,无法在 CLI 层复现失败。所以失败发生在**真实 runtime spawn 运行时**,§3 列了高度怀疑点供逐一验证。

### Layer 1 🟡 `--effort normal` 是无效值(独立 bug,顺带修)

`buildClaudeArgs`(claude-args.ts:29)传 `--effort normal`,但 CLI 实测报:
`Warning: Unknown --effort value 'normal' — ignoring it. Valid values: low, medium, high, xhigh, max.`
→ commit `a0111fe` 的修复**没生效**,settings.json 的 `effortLevel: high` 仍会泄漏(回到 Bedrock thinking-signature 400 风险)。

### Layer 2 🟡 后端 `emitDirectMessage` 不推给人类

`event-bus.ts:113-116`:`emitDirectMessage` 只 `this.send(recipientId, ...)`,而 `send`(178-182)只查 `this.clients`(agent 连接),**从不遍历 `humanClients`**。对比 `emitRoomMessage`(100-102)有遍历 humanClients。

→ 即使 agent 用 `flock_dm_send` 回复了(写进 `direct_messages`,且 `recipientId=humanId`),人类的 SSE 也收不到。room 消息这条没问题(emitRoomMessage 推了 human),但 **DM 这条断了**。

### Layer 3 🟡 前端 DMModal 完全不订阅 SSE

`DMModal.tsx`:只在挂载时 `loadHistory()` GET 一次(57 行),**没有 import useSSE、没有 subscribe、不监听 `direct_message`**。`SSEContext` 本身已注册 `direct_message` 事件(SSEContext.tsx:94),基础设施 OK,但 DMModal 没接。

→ 即使后端推了,窗口也不刷新;关掉重开才能看到(因为重新 GET)。

### Layer 4 🟡 状态卡 dormant:wake 路径不推 agent_status SSE

私信/room 自动唤醒走 `services/callback.ts` 的 `createWakeSession()` → `UPDATE profiles SET status='spawning'`,但 **callback.ts 没有 eventBus 实例**,不发 `emitAgentStatus`。

→ `dormant → spawning` 这步前端永远收不到。后续 `spawning→active→dormant`(经 runtime 的 activity 端点)有推,但若 runtime 离线/回调失败,状态就卡在 DB 的 spawning,前端仍显示 dormant(只在页面加载时 GET 过一次)。

---

## 2. activity vs 消息:两套独立管道(理解这个才能做对功能 B)

| | activity 管道 | 消息管道 |
|---|---|---|
| 触发 | agent LLM 任何输出(text/think/tool),harness event-bridge **自动** reportActivity | agent **主动调** `flock_post`/`flock_dm_send` 工具 |
| 落表 | `agent_activity_logs` | `messages` / `direct_messages` |
| SSE 事件 | `workflow_event` | `room_message` / `direct_message` |
| 前端消费 | 工作流页 | room 视图 / DMModal |
| 端点(回填) | `GET /agents/:id/activity`(humanAuth) | `GET /direct-chats/:agentId/messages` |

**功能 B 的关键洞察:agent 的 think/tool_call/tool_result 已经实时流在 `workflow_event` 里了,不用造新管道。** 功能 B = 把这条已有的 activity 流,按 agent 过滤、渲染成会话内的折叠时间线。

---

## 3. Layer 0(MCP failed)修复 —— 待验证的高度怀疑点

> ⚠️ 命令行无法复现,Sonnet 必须**先跑一次真实端到端复现**(起 server + runtime,私信一个 agent,看 runtime 日志里 claude 子进程的 stderr / MCP 启动错误),再对症修。下面是按可能性排序的怀疑点。

### 怀疑点 1(最高):DB_PATH = 空字符串

- 无 `.env` 文件(只有 `.env.example`)→ `config.ts:46` `dbPath = process.env.DB_PATH ?? ''` → **空串**。
- `agent-runner.ts:70` 兜底是 `dbPath ?? path.resolve(...)` —— **`??` 对空串不生效**(空串不是 null/undefined),所以 `''` 原样传给 harness。
- harness `buildMcpServers` 把 `DB_PATH: ''` 塞进 MCP env → MCP server `db.ts:60` `process.env.DB_PATH ?? join(...)` 同样空串不触发兜底 → MCP 打开空路径 DB → **可能启动即崩 / 连接后立即退出 → claude 标记 flock:failed**。
- **验证:** 真实复现时打印 harness 收到的 dbPath。**修复:** 把所有 `?? ''` 和对 dbPath 的 `??` 兜底改成"空串也兜底"(用 `||` 或显式 `dbPath && dbPath.length ? dbPath : resolve(...)`)。runtime config + mcp db.ts 两处都查。

### 怀疑点 2:mcp-config 临时文件被过早 cleanup

- `claude-stdio.ts` 在 spawn error / exit 时 `mcp.cleanup()` 删临时目录。确认 claude 子进程**读取 mcp-config 是异步的**,若 claude 启动慢、而某条快速路径提前触发了 cleanup,文件没了 → MCP 配置加载失败。
- **验证:** 复现时 `ls` 临时文件在 claude 读取时是否还在。**修复:** cleanup 只在确认进程退出后执行(目前看代码是对的,但要复现确认)。

### 怀疑点 3:`flock_dm_send` 依赖 `@flock/server` 的运行时导入

- `packages/mcp/src/tools/direct-chat.ts:5` `import { sendDirectMessage } from '@flock/server/services/direct-chat'`。MCP server 进程是独立 spawn 的,确认它能解析到 `@flock/server`(workspace 链接 / dist 是否 build)。若 import 失败,MCP server 启动即抛 → flock:failed。
- **验证:** `node packages/mcp/dist/index.js` 单独启动我已测过能起(进程存活),但**它是否真的注册成功了所有工具**没验证到底。复现时看 MCP server stderr。

### 怀疑点 4:claude 子进程 env 缺 MCP 需要的变量

- claude 用 `buildChildEnv(ctx.env)` 的 env 启动;它再 spawn MCP 时,MCP 的 env 来自 mcp-config 的 `env` 字段(harness 那次 `buildChildEnv`)。两次 buildChildEnv 都验证含 PATH(实测 66 键含 PATH)。此点可能性低,但复现时一并确认 MCP env 完整。

**Layer 0 提交:** 视复现结果定。最可能是怀疑点 1,对应 2-3 个 commit(修 runtime config 空串兜底、修 mcp db.ts 空串兜底、加一条"dbPath 必须非空否则 fail-fast 报错"的防御)。

---

## 4. 修复提交清单(Part A)

> 顺序:先 Layer 0(否则啥都流不动)→ Layer 1 → Layer 2 → Layer 3 → Layer 4。

### Phase A0 — MCP 连接修复(先复现再修)

| # | commit | 文件 | 改动 |
|---|---|---|---|
| A1 | (先复现,不提交)| — | 起 server+runtime,私信 agent,抓 claude 子进程 stderr + MCP server 启动错误,确认 §3 哪个怀疑点 |
| A2 | `fix(runtime): treat empty DB_PATH as unset so fallback path applies` | ~`config.ts` | `process.env.DB_PATH ?? ''` → 保留空串语义但下游兜底;或直接让空串走 resolve 默认 |
| A3 | `fix(runtime): fall back to default db path when dbPath is empty string` | ~`agent-runner.ts` | `dbPath ?? resolve` → `dbPath && dbPath.length ? dbPath : resolve(...)` |
| A4 | `fix(mcp): fall back to default db path when DB_PATH is empty string` | ~`packages/mcp/src/db.ts` | 同样空串兜底 |
| A5 | `fix(mcp): fail-fast with clear error if db path unresolvable` | ~`packages/mcp/src/db.ts` | DB 打不开时抛明确错误(而非静默 flock:failed),便于将来诊断 |
| A6 | (复现验证)| — | 重新私信,确认 init metadata 变 `flock:connected`,且 agent 调用了 `flock_dm_send`/`flock_post`,消息进了 `direct_messages`/`messages` |

> 若复现发现根因是怀疑点 2/3/4 而非 1,Sonnet 按实际根因调整 A2–A5,但**每个修复仍一个 commit**,并在 commit message 写明复现证据。

### Phase A1 — effort 无效值修复

| # | commit | 文件 | 改动 |
|---|---|---|---|
| A7 | `fix(runtime): replace invalid --effort normal with valid effort value` | ~`backends/claude-args.ts` | `--effort normal` 是非法值。改用合法值 `low`(对应"不开扩展思考"的最低档,贴合迁移计划 §1.2 默认关 thinking 的意图)。注释更新:`normal` 不在 `low/medium/high/xhigh/max` 里。 |
| A8 | `test(runtime): assert buildClaudeArgs emits a valid --effort value` | ~`__tests__/claude-args.test.ts` | 断言 effort 值 ∈ 合法集合;回归"不再出现 normal"。 |

> 决策:用 `low` 而非删掉 `--effort`。因为删掉会让 settings.json 的 `effortLevel:high` 重新泄漏(stdio 不能用 SDK 的 settingSources:[])。`--effort low` 显式压低,既屏蔽 settings 又不开扩展思考。

### Phase A2 — 后端 DM 推给人类

| # | commit | 文件 | 改动 |
|---|---|---|---|
| A9 | `fix(server): deliver direct messages to human SSE clients` | ~`packages/server/src/sse/event-bus.ts` | `emitDirectMessage`:在 `this.send(recipientId,...)` 之后,**遍历 `humanClients` 推 `direct_message`**(对齐 emitRoomMessage 模式)。注意 payload 已含 `from`/`to`,人类端按 `to===自己 或 from===对方agent` 过滤。 |
| A10 | `test(server): emitDirectMessage reaches human clients` | ~`packages/server/src/__tests__/`(找现有 event-bus / sse 测试,没有就新建)| 注册一个假 humanClient,emitDirectMessage 后断言它收到了。 |

> 注意 `recipientId`:human 发给 agent 时 recipientId=agentId(推给 agent,已 OK);agent 用 flock_dm_send 回复时 recipientId=humanId,但 `send()` 在 clients(agent)里找不到 humanId → 现在丢失。A9 让 humanClients 也收到,human 端用 payload 过滤出属于自己的会话。

### Phase A3 — 前端 DMModal 订阅 SSE

| # | commit | 文件 | 改动 |
|---|---|---|---|
| A11 | `feat(web): subscribe DMModal to direct_message SSE for live updates` | ~`DMModal.tsx` | import `useSSE`;`useEffect` 内 `subscribe(handler)`;handler 过滤 `event.event==='direct_message' && (data.from===agentId \|\| data.to===agentId)`,把新消息 append 到 messages(去重:按 message_id;避免和自己乐观插入的重复)。cleanup 退订。 |
| A12 | `fix(web): dedupe optimistic DM send against echoed SSE message` | ~`DMModal.tsx` | 本地乐观插入用临时 id,收到 SSE 同内容(from=human)时替换/跳过,避免双显。 |

### Phase A4 — wake 路径推 agent_status

| # | commit | 文件 | 改动 |
|---|---|---|---|
| A13 | `fix(server): pass EventBus into callback wake service` | ~`services/callback.ts` ~ 调用方(`direct-chats.ts` / 其他 router / index.ts 装配处) | 给 `wakeDirectMessageAgent` / `createWakeSession` / `dispatchPendingRoomWake` 传入 eventBus(或返回状态变更让调用方推)。**这是接线改动,单独一个 commit。** |
| A14 | `fix(server): emit agent_status spawning on direct-message wake` | ~`services/callback.ts` | `createWakeSession` 把 status 改成 spawning 后,`eventBus.emitAgentStatus({agent_id, status:'spawning'})`。 |
| A15 | `fix(server): emit agent_status spawning on room wake` | ~`services/callback.ts` | `dispatchPendingRoomWake` 同样推 spawning。 |
| A16 | `test(server): wake paths emit agent_status SSE` | ~测试 | 断言两条 wake 路径都推了 spawning。 |

---

## 5. 功能 B:私信工作链路时间线(可复用)

### 5.1 设计(对齐你的两个决策)

- **决策 1:先做 DM,但抽成可复用。** 核心是两个独立单元:
  - `useAgentActivity(agentId)` hook —— 订阅 `workflow_event` SSE(按 agentId 过滤)+ 初始 `GET /agents/:id/activity` 回填,返回该 agent 的活动时间线(think/tool_call/tool_result/message)。
  - `<AgentActivityTrace>` 组件 —— 把一段活动渲染成折叠时间线。
  - DM 先用;将来 room 视图 import 同样两个单元即可复用,**不重写**。
- **决策 2:默认折叠,可展开。** 会话流里 agent 的一条回复下面挂一个折叠条:`💭 思考了 · 🔧 调用了 N 个工具`,点击展开看完整时间线(think 文本、每个 tool_call 的名字+输入摘要、tool_result 摘要)。

### 5.2 数据来源(已现成,无需后端造数据)

- 实时:`workflow_event` SSE,payload `{ agent_id, activity_type, detail, metadata, created_at }`。SSEContext 已注册该事件(99 行)。
- 回填:`GET /agents/:id/activity`(agents.ts:334,humanAuth,返回 `agent_activity_logs` 行)。
- activity_type 值:`message` / `think` / `tool_call` / `tool_result` / `status_change` / `error`(event-bridge.ts:71-121)。
- tool_call 的 metadata 含 `{tool_id, input}`;tool_result 含 `{tool_use_id, is_error}`(event-bridge.ts)。

### 5.3 提交清单(Part B)

> B 依赖 A0(MCP 修好,消息能流)和 A 全绿。但 B 的组件可以并行写(数据管道独立)。

| # | commit | 文件 | 改动 |
|---|---|---|---|
| B1 | `feat(web): add AgentActivity types + activity_type enum` | +`packages/web/src/types/activity.ts` | 定义 `AgentActivity`(type/detail/metadata/created_at)+ activity_type 联合。 |
| B2 | `feat(web): add useAgentActivity hook with SSE subscription` | +`packages/web/src/hooks/useAgentActivity.ts` | 订阅 `workflow_event` 过滤 agent_id,累积活动数组。先不做回填(初始空)。 |
| B3 | `feat(web): backfill activity history via GET in useAgentActivity` | ~`useAgentActivity.ts` | 挂载时 `GET /agents/:id/activity?limit=N`,与 SSE 增量合并去重(按 activity id / created_at)。 |
| B4 | `feat(web): add ActivityIcon mapping per activity_type` | +`packages/web/src/components/activity/ActivityIcon.tsx` | think💭 / tool_call🔧 / tool_result✅❌ / message💬 图标。 |
| B5 | `feat(web): add ToolCallItem renderer (name + input summary)` | +`packages/web/src/components/activity/ToolCallItem.tsx` | 渲染单个 tool_call:工具名 + 输入摘要(metadata.input 截断);带 is_error 样式。 |
| B6 | `feat(web): add AgentActivityTrace collapsible timeline component` | +`packages/web/src/components/activity/AgentActivityTrace.tsx` | 接收 activities[],默认折叠为摘要行(`💭 思考了 · 🔧 N 个工具`),点击展开时间线。**这是可复用核心。** |
| B7 | `test(web): AgentActivityTrace collapse/expand + summary count` | +对应测试 | 断言默认折叠、摘要计数对、点击展开渲染明细。 |
| B8 | `feat(web): render AgentActivityTrace inside DMModal under agent turns` | ~`DMModal.tsx` | DMModal 用 `useAgentActivity(agentId)`,在 agent 消息气泡下方挂 `<AgentActivityTrace>`(把该 agent 自上条 human 消息以来的活动归到这一轮)。 |
| B9 | `feat(web): group activities into turns aligned with messages` | ~`DMModal.tsx` 或 hook | 按 created_at 把活动切成"轮次",对齐到对应的 agent 回复消息。 |
| B10 | `feat(web): show live "thinking…/using tool…" status while agent active` | ~`DMModal.tsx` | agent status=spawning/active 时,时间线顶部显示实时进行态(配合 A4 的 agent_status SSE)。 |
| B11 | `docs: document reusable AgentActivityTrace for room view reuse` | ~`docs/` | 记录如何在 room 视图复用这两个单元(future)。 |

---

## 6. 提交总览

- **Part A(修复):** A1–A16(A1/A6 是复现验证步,不产 commit)→ ~14 个 commit
- **Part B(功能):** B1–B11 → 11 个 commit
- 顺序:A0(MCP)→ A1–A4(其余修复)→ B(功能)。B 的组件(B1–B7)可在 A 进行时并行开发(纯前端、数据管道独立)。

> 极细粒度规则同上:一个改动一个 commit,能再拆就再拆,不要合并;commit message 不加 Co-Authored-By。

---

## 7. 写入 backlog 的条目

```markdown
### 🔴 stdio 迁移后 MCP flock server 连接失败(flock:failed)
- 发现于 2026-06-16,DM/room 消息不可见排查
- 现象:每个 agent init metadata = flock:failed,全表 0 次 flock_ 工具调用,agent 回复只进 activity 日志不进 messages/direct_messages
- 怀疑根因:DB_PATH 空串未兜底(详见 plan §3)
- 状态:本计划 Phase A0 修复

### 🟡 --effort normal 是无效 CLI 值
- claude CLI 只接受 low/medium/high/xhigh/max;normal 被忽略 → settings.json effortLevel 仍泄漏
- 状态:本计划 A7 修复(改 low)

### 🟡 emitDirectMessage 不推 human SSE 客户端
- 只推 agent clients,人类收不到 agent 的 DM 回复
- 状态:本计划 A9 修复

### 🟡 DMModal 不订阅 SSE
- 只挂载时 GET 一次,新 DM 不实时刷新
- 状态:本计划 A11 修复

### 🟡 wake 路径不推 agent_status SSE
- callback.ts 无 eventBus,dormant→spawning 前端不可见,状态卡 dormant
- 状态:本计划 A13-A15 修复

### 🟢 [deleted]/system 等保留 profile 出现在列表
- 排查时发现 profiles 表有 [deleted]/system 行,前端是否过滤待确认
- 状态:open
```

---

## 8. 验收

1. **Layer 0:** 私信 agent 后,DB `agent_activity_logs` init metadata = `flock:connected`,且出现 `tool_call|flock_dm_send`;`direct_messages` 表出现 agent 写入的回复行。
2. **DM 实时:** 私信窗口开着,agent 回复时**不刷新**就出现回复。
3. **room 实时:** room 里 agent 回复,人类**不刷新**就看到(A9 让 DM 推 human;room 本就推)。
4. **状态:** 私信触发后 agent 状态从 dormant → spawning → active → dormant,前端实时变化。
5. **功能 B:** DM 里 agent 回复下方有折叠的工作链路条,点击展开看到 think + 工具调用时间线;默认折叠。
6. **可复用:** `useAgentActivity` + `AgentActivityTrace` 是独立单元,room 视图可直接 import(本次不接 room,但代码结构支持)。
7. 全部单测绿;完成后开 `Code Reviewer` agent 审查 event-bus.ts + DMModal.tsx + AgentActivityTrace.tsx。
