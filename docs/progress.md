# Progress

## 当前状态
- **v0.1 已完成** — 2026-05-05
- **v0.1.1 已完成** — 2026-05-05（关键修复：GET /rooms、文件数据库、成员列表、whoami）
- **v0.1.2 已完成** — 2026-05-05（Lark→Flock 全局重命名）
- **v0.2 已完成** — MCP Server（11 个工具 + 3 个资源 + flock_wait 全局阻塞等待）
- **v0.2.1 已完成** — 2026-05-06（MCP 接入体验优化：自动注册 agent、工具描述增强、MCP Prompts、flock_wait 过滤自身消息+无超时默认）
- **v0.2.2 已完成** — 2026-05-06（display_name 字段 + MCP Prompts 引导 + flock_wait 修复）
- **v0.3 全部完成** — 2026-05-07
  - Part 1 社交扩展: Follow + Broadcast + Private Rooms（API + SDK + CLI + MCP）
  - Part 2 GUI: React + Vite + Tailwind 前端（Feed, Room, Agent, Command, Thread）
- 280 个测试全部通过（SDK 28 + Server 174 + MCP 78）
- GUI 编译成功（55 modules, 257KB JS + 16KB CSS）
- **v0.3.1 已完成** — 2026-05-07（GUI 体验修复，2 agent 协作）
  - gui-1（后端）：GET /agents/:id、消息显示名字、注册默认 online、状态变更 SSE 通知
  - gui-2（前端）：proxy bypass 修复刷新 401、消息顺序 reverse、@mention 自动补全、错误提示 toast
  - 交叉审查通过，无阻断性问题
- **v0.3.2 已完成** — 2026-05-07（GUI 实时性 + 交互修复）
  - @mention 名字→ID 解析（修复 1001 报错）
  - Room 页面 SSE 订阅（修复消息不实时）
  - 进入房间即时滚动到底部（修复"消息从顶部落下"）
- **v0.3.3 已完成** — 2026-05-08（GUI 交互增强 + Direct Mention Boundary Notification，3 agent 协作）
  - gui-2（前端）：reverse 简化、FeedPage fromName、Room 标题、Sidebar StatusIndicator+排序、房间管理 UI（创建/加入/离开）
  - gui-1（后端）：Agent 上下线机制（MCP 启动 online、idle timer、退出 offline）
  - codex（MCP/CLI）：mention queue + list/drain + Tier 1 注入 + CLI setup/hook/doctor
  - 298 测试通过（server 174 + sdk 28 + mcp 96）
- **v0.3.4 已完成** — 2026-05-09（Turn Liveness + Agent Login/Admin GUI + Direct Chat，3 agent 协作）
  - kisara-claude（后端/MCP）：模块 1+2+3 — Host Turn Lifecycle Hook（PostToolUse→online, Stop→offline）、MCP 启动不再 auto-online、移除 idle timer、stale online 兜底（last_active_at + 5 分钟阈值）
  - gui-2（前端+后端）：模块 4 — POST /auth/login（id 或 display_name 登录）、POST /agents/:id/token（token 重新生成）、DELETE /agents/:id + POST /agents/batch-delete、PATCH 支持 name 更新、LoginPage 双模式、AdminPage（agent 管理面板）
  - codex-v034-direct（全栈）：模块 5+6 — Direct Chat（persistent 1:1 私聊模型）、MCP flock_dm_send/read/list、CLI flock dm、Command Center 改为 Direct Chat、Stop hook wait-on-stop opt-in
  - 327 测试通过（server 189 + sdk 34 + mcp 104）
  - 交叉审查通过，3 个阻断问题已修复
- **v0.3.5 已完成** — 2026-05-10（Agent Admin RBAC + Room/Agent Admin CRUD + Mention Boundary Fix，3 agent 协作）
  - kisara-claude（后端）：模块 B — `profiles.is_admin` + 默认 `kisara` admin agent、admin-auth middleware、admin routes（12 端点）、agents.ts/rooms.ts 改造为 admin-only、admin room members 端点、ESM 兼容修复
  - gui-2（前端）：模块 C — AdminPage 收敛为 admin-only、RoomManagePage（CRUD + 成员管理）、SSE 重连 + 状态指示、API 错误处理、统一 agent 登录契约修复 + hooks 顺序修复
  - codex（MCP/CLI）：模块 A — mention boundary foreground fallback（hook 边界扫 DB → 写 queue → 输出 digest）、原子写 + try/catch 防护、doctor 诊断增强
  - 352 测试通过（server 213 + sdk 34 + mcp 105）
  - 交叉审查通过，所有阻断问题已修复
  - `kisara` 是普通 agent profile，同时具备 `profiles.is_admin = 1`；从统一 agent 登录页进入，Admin 按钮仅对 admin agent 显示
- **v0.4 已完成** — 2026-05-12（Task + Artifact Foundation，3 agent 协作）
  - Claude-01（后端）：5 张新表（tasks, task_assignees, task_events, task_artifacts, task_idempotency_keys）、task service（5 函数）、5 个 REST 端点、23 个测试
  - Claude-02（SDK/CLI/MCP）：shared types（15 类型 + 3 SSE 事件）、SDK 5 方法、MCP 5 工具、CLI 5 子命令
  - Codex-01（GUI）：TaskPanel 组件（list/create/detail/status/artifact）、RoomPage 集成、SSE task 事件支持
  - 支线修复：mention 多 agent 身份隔离（按 AGENT_NAME 隔离 identity/queue 路径）、SSE 重连自动重新订阅
  - 交叉审查通过，所有 review 问题已修复
  - 原 Reputation + Rich Payload 暂缓：缺少 task outcome 数据闭环
- **v0.5 提案已完成** — 2026-05-15（Agent Runtime + 自主协作，3 agent 协作讨论）
  - 提案文档：`docs/proposals/v0.5-refactor.md`（1028 行，覆盖 6 个议题）
  - 6 个议题：Agent 团队架构、GUI 可观测性、不引入主 agent、Harness 基础设施、超越 prompt、Token 成本控制
  - 实施计划：6 环迭代（~7 周），每环可独立验收
  - 测试策略：后端/CLI/MCP agent 自动化测试，GUI kisara 手动验收
  - 渠道扩展预留：Transport Adapter 层作为架构约束，不实现
  - 已推送到 GitHub（commit e903103）
- 下一步：v0.5 环 1 实施（清理 + 地基，1 周）
- **v0.5 环 1 已完成** — 2026-05-17（3 agent 协作）
  - claude001（Server）：humans + human_sessions 表、POST /human/register + /human/login + GET /human/me、cookie session 中间件、8 张新表、删除旧路由、11 测试通过
  - claude002（MCP+SDK）：shared types 更新（AgentStatus 4 态、sender_type、Human 等）、MCP 删除 task/follow/broadcast/invite 工具、SDK 删除对应模块
  - claude003（GUI）：LoginPage 人类登录、AuthContext human 认证、tokenStorage 重命名、删除 AdminPage/RoomManagePage/TaskPanel、Sidebar human 显示、RoomPage 移除 TaskPanel
  - 7 个细粒度 commit（GUI 部分）
- **v0.5 环 2 已完成** — 2026-05-17（3 agent 协作）
  - claude001（Server）：agent_runtimes/agent_spawns 表 + spawn/stop/wake API + runtime 管理（POST/GET /runtimes, heartbeat）+ @mention wake callback（HMAC-SHA256, 3 次重试指数退避）+ 人类消息路由（POST /rooms/:id/messages human auth）+ broadcast wake（commit a4c68c0）
  - claude002（SDK）：lifecycle.ts（spawn/stop/wake/status）、human.ts（register/login/me）、identity 适配
  - claude003（GUI）：AgentListPage 新建、AgentPage 重写（spawn/stop/wake）、StatusIndicator v0.5 四态、Sidebar Agents 链接、CommandPage auth 修复、FeedPage 文字更新
  - 7 个细粒度 commit（GUI 部分）
- **v0.5 环 2 review 完成** — 2026-05-17（commit 87c7b1d）
  - claude002 review claude001 的 Ring 2 (a4c68c0)：5 个问题，3 个立即修复（错误日志、trailing slash、idempotency key），2 个记 backlog（runtime 注册权限、broadcast wake 语义）
  - claude001 review claude002 的 Ring 4 (fd6e7b9..3c586df)：4 个问题，1 个建议修（transport idle timeout），其他集成时处理
- **v0.5 环 5 Server 已完成** — 2026-05-17（commit 0d5b08d）
  - claude001（Server）：POST/GET /tasks, PATCH /tasks/:id — 任务 CRUD + 状态机验证（6 态转换）+ task_events 写入 + SSE 事件（task_created, task_status）
  - 138 tests pass, 0 TS errors
- **v0.5 环 6 Server 已完成** — 2026-05-17（commit 0d5b08d）
  - claude001（Server）：GET /token-budgets（含默认值）、GET /token-usage、GET /configs、PATCH /configs（upsert）
  - 138 tests pass, 0 TS errors
- **v0.5 环 3 GUI 已完成** — 2026-05-17
  - claude003（GUI）：MessageCard sender_type 支持、FeedPage 重写（聚合 Room 消息）、MentionContext + Sidebar 未读徽章、@mention 消息高亮
  - 14 个细粒度 commit（GUI 总计）
  - 等待 claude001 Server task API 路由完成后联调
- **v0.5 环 5 GUI 已完成** — 2026-05-17
  - claude003（GUI）：TaskBoardPage 看板布局（todo/in_progress/review/done）、任务卡片、优先级标签、状态推进按钮、房间过滤、创建任务弹窗、SSE 实时刷新
  - 1 个 commit（TaskBoard + tasks API client）
  - 等待 claude001 task API 路由（POST/GET /tasks, PATCH /tasks/:id）接上
- **v0.5 环 6 GUI 已完成** — 2026-05-17
  - claude003（GUI）：SettingsPage（token 使用表格、agent 预算、全局配置显示）、Stats 卡片、Sidebar Settings 链接
  - 1 个 commit
  - 等待 claude001 token-budget/config API 路由接上
- **v0.5 环 4 MCP 已完成** — 2026-05-17（6 个 commit）
  - claude002（MCP）：所有 MCP 工具文件重构为接受 `agentIdProvider` 参数（支持 stdio 和 HTTP 两种模式）、`createMcpServer()` 工厂函数、`createHttpMcpHandler()` Streamable HTTP transport handler、独立 MCP HTTP server 入口（端口 3001）
  - 架构决策：MCP HTTP server 作为独立进程运行，避免与 server 包的循环依赖
  - review 修复：transport idle timeout（30 分钟 TTL + 每 60 秒清理）
  - 测试：factory 集成测试（验证所有工具组注册）
- **v0.5 交叉 review 完成** — 2026-05-17
  - claude002 review claude001 Ring 2 (a4c68c0)：5 个问题，3 个已修 (87c7b1d)，2 个记 backlog
  - claude001 review claude002 Ring 4 (fd6e7b9..3c586df)：代码质量高，transport idle timeout 已修 (25bd32e)
  - backlog 已同步更新
- **v0.5 MCP HTTP 测试补全** — 2026-05-17（2 个 commit）
  - `27ec17d` fix(mcp): HTTP transport JSON body 解析错误处理（invalid body → 400）
  - `5ee19cf` test(mcp): HTTP transport 集成测试（6 个用例：auth 401/403、session 创建、session 复用、invalid session、invalid JSON）
  - `cd17377` fix(test): lifecycle 测试适配 v0.5 status model（active 替代 online）
- **v0.5 登录崩溃修复** — 2026-05-17
  - `22c772e` fix(server): task_events.event_type 缺列导致 Server 启动崩溃（v0.4 表 + v0.5 新列 + 缺 migration）
  - `46ef811` fix(web): Vite proxy 缺少 v0.5 新增路由（claude003 修复）
  - `1396f26` fix(server): task_events.payload 缺列同样崩溃（claude003 修复）
  - `7f8b3fc` chore: v2 server 端口改为 3001，GUI 改为 5174（避免旧版冲突，claude003 修复）
  - 190 server tests 全通过
- **v0.5 GUI v3 重设计完成** — 2026-05-18（claude003）
  - 按照 finalized.html 设计稿重做所有页面
  - 新页面：WorkflowPage、OrchestratorPage、RuntimesPage、WakePage、TokensPage
  - 重写：AgentListPage（卡片布局+渐变头像+4列信息网格）、AgentPage（详情页：Runtime/Session/能力标签/当前任务/历史任务/最近活动/配置）、TaskBoardPage（6列看板）、SettingsPage（Skills+MCP+Token预算）、Sidebar（9项导航）
  - 新组件：SpawnModal（agent/runtime/room选择+流程预览）、DMModal（私聊）、TaskDetailModal（状态/优先级/时间线）、WakeSingleModal（prompt+room选择）
  - RightPanel：3标签（活动/成员/任务），成员显示人类用户
  - 3列布局：220px Sidebar | 1fr Main | 360px RightPanel
  - 消息样式匹配 v3 设计：fadeUp 动画、human 名字 accent 色、text-dim 时间戳、14px/1.65 行高
  - 全中文 UI：所有 Loading/No messages/Send/Cancel/Create/Join/Close 等均已翻译
  - CSS tokens：新增 fadeUp keyframe、text-dim (#5A5A66)、accent-hover (#2563EB)
  - 30+ 个 GUI commit，build 72 modules, 336KB JS, 25KB CSS
- **v0.5 Runtime daemon 完成** — 2026-05-18（claude001）
  - `b8b2f50` feat(runtime): Agent Runtime daemon package（6 个源文件）
  - `82d6236` feat(server): spawn/stop/wake callback notifications to runtime
  - `packages/runtime/` — `FlockAgentRuntime` 类：注册、心跳、回调接收、agent 进程管理、活动上报
  - Server 侧：spawn/stop/wake 路由通知 runtime，`notifyRuntimeSpawn()` / `notifyRuntimeStop()`
  - 190 server tests 全通过
- **当前状态：** GUI v3 + Runtime daemon + 后端 API 全部完成，GUI 已接入所有后端 API，toast 通知已覆盖所有 action，SSE 实时推送已修复
- **GUI API 集成 + Toast 通知完成** — 2026-05-18（claude003）
  - WakePage：接入 `GET /activity/wake-history`，显示真实唤醒记录
  - WorkflowPage：接入 `GET /activity` 初始加载 + `GET /token-usage` 今日 Token 统计 + `workflow_event` SSE 订阅
  - AgentPage：接入 `GET /agents/:id/activity` 活动日志
  - ToastProvider：全局 toast 通知系统（4 秒自动消失），所有 action 页面已接入（Wake/Agent/AgentList/TaskBoard/Spawn/DM/WakeSingle）
  - RuntimesPage：注册按钮弹出帮助 modal（Runtime daemon 启动说明）
  - Backlog 清理：标记 toast 通知和 AgentPage 加载效率为 done
  - 73 modules, 343KB JS, 26KB CSS, 0 errors
- **SSE 实时推送修复（Human Auth）** — 2026-05-18（claude003）
  - `232af8b` fix(server): SSE + room/agent/task endpoints accept human session tokens
  - 根因：GUI 用 human session token 认证，但 SSE /events、room subscribe、agent/task/config/runtime 端点只接受 agent token（profiles.token_hash），human token 返回 401
  - 新增 `flexAuthMiddleware`：先尝试 agent token，fallback 到 human_sessions 查询，统一设置 req.agentId
  - 更新 8 个路由文件的 20+ 个端点从 `auth` → `flexAuth`
  - FeedPage 新增 room 订阅逻辑（mount 时 subscribe 所有 room，unmount 时 unsubscribe）
  - 200 server tests 全通过，0 TS errors
  - `c80ca33` fix(server): room create/join/leave + message send/react accept human tokens
  - 更新 POST /rooms, POST /rooms/:id/join, POST /rooms/:id/leave, POST /messages, POST /messages/:id/reactions 为 flexAuth
  - 200 server tests 全通过，0 TS errors
- **v0.5 任务事件 + 任务分配通知 + 超时重试** — 2026-05-18（claude001）
  - `29059c7` feat: GET /tasks/:id/events 端点 + TaskDetailModal 真实事件时间线
  - `79cbe4c` feat(server): task assignment notifications + stale task timeout
  - `notifyTaskAssignment()` — 任务分配时唤醒休眠 agent（通过 runtime callback）
  - `checkStaleTasks()` — 检测 in_progress 超时任务，自动重试（retry_count < max_retries）或标记 error
  - TaskDetailModal 接入真实 task_events API，显示事件时间线
  - SSEContext 添加 workflow_event 类型
  - 195 server tests 全通过
- **v0.5 测试补全 + 周期性任务超时检测** — 2026-05-18（claude001）
  - `07c7ec4` test: add task events and stale detection tests（10 个测试）
  - `e75316b` feat(server): periodic stale task detection（每 5 分钟检测）
  - 修复 datetime 格式不匹配（SQLite `datetime('now')` vs JS `toISOString()`）
  - 211 tests 全通过（200 server + 11 runtime）
- **v0.5 所有 6 环后端完成** — 2026-05-18
  - 环 1: 人类登录 + 删旧代码 ✅
  - 环 2: Runtime 骨架 + spawn/stop/wake + callback 通知 ✅
  - 环 3: @mention 唤醒 + broadcast wake + task 分配唤醒 ✅
  - 环 4: 多 Runtime 注册 + MCP Streamable HTTP ✅
  - 环 5: Task CRUD + 状态机 + SSE + 任务分配通知 + 超时重试 ✅
  - 环 6: Token 预算 + 配置 API ✅
- **当前状态：** v0.5 全部 6 环后端+前端+MCP 完成，可进行端到端验收
- **SDK Task 模块 + CLI 清理** — 2026-05-18（claude003）
  - `cde9746` feat(sdk): task CRUD（createTask/listTasks/getTask/appendTaskEvent/addTaskArtifact）+ getMe() + 移除死代码 CLI 命令（broadcast/feed/follow/invite）+ 修复 discover.ts v0.5 status 类型
  - `7217af3` fix(web): TaskBoardPage 低优先级标签（-1）
  - `146cd6c` fix(web): TaskDetailModal 低优先级标签
  - `ca34ce9` fix(sdk): listAgents 返回类型匹配 server 响应
  - SDK + CLI + Server + Web 全部编译通过，0 TS 错误
  - 200 server tests 全通过

## 2026-05-18 codex 验收记录

> 当前 v0.5 不能按“全部完成”交付，需先关闭以下阻断项。问题已同步到 `docs/backlog.md` 并在 `flock讨论` 分配给对应 agent。

### 初始基线
- v2 旧进程已停止，v1 保持运行：v1 server `:3000`、web `:5173` 未关闭；v2 server/web 重新用于验收运行在 `:3001` / `:5174`。
- 在 cc001/cc003 后续修复开始前，`npm run typecheck -w @flock/server`、`npm run typecheck -w @flock/web`、`npm run typecheck -w @flock/mcp` 均通过。
- 在 cc001/cc003 后续修复开始前，`npm run build --workspaces --if-present` 通过。
- `npm test -w @flock/server`：210 tests passed。
- `npm test -w @flock/agent-runtime`：22 tests passed。
- `npm test -w @flock/sdk`：34 tests passed。
- `npm test -w @flock/mcp` 初次失败后，cc002 修复并由 codex 复跑确认：10 files / 55 tests passed（commit `40cbbce`）。

### 当前回归
- cc001/cc003 修复过程中出现的 typecheck 回归已关闭：`npm run typecheck` 当前全 workspace 通过。
- `npm run build --workspaces --if-present` 当前通过。
- `npm test -w @flock/server` 当前通过：16 files / 112 tests（server Vitest 已排除 dist）。
- `npm test -w @flock/agent-runtime` 当前通过：4 files / 22 tests。
- `npm test -w @flock/mcp` 当前通过：10 files / 55 tests。
- `npm test -w @flock/sdk` 当前通过：2 files / 34 tests。
- 手动 API 复验：stale `localhost:4000` runtime 会被标记 offline；无可用 runtime 时 spawn 返回 400；`/agents/:id/activity` 无 token / bad token 均返回 401；`POST /rooms/:id/broadcast-wake` 返回 200。
- 默认状态语义回归已关闭：`registerAgent()` 现在默认写 `profiles.status='dormant'` 和 `last_active_at=NULL`。codex 手动复验新建 agent 后 spawn 400 仍保持 dormant/runtime_id null。
- 浏览器冒烟：`http://localhost:5174/` 首页正常渲染，Wake 页正常渲染；点击 Broadcast 唤醒按钮不再 404，显示成功 toast。
- 2026-05-18 codex 针对 kisara 原始 4 个实测问题补强：
  - Runtime 同 `callback_url` 重启注册会复用原 runtime id，不再无限叠加；`GET /runtimes` 会先清理 stale heartbeat，显式 stale `runtime_id` spawn 返回 400。
  - GUI/人类私聊未传 `idempotency_key` 时服务端生成 UUID，不再因 `direct_idempotency_keys.key` 为 NULL 返回 500。
  - 人类创建的空 Room 可通过 `GET /rooms` 立即看到；新增 `POST /rooms/:id/members` 支持把指定 agent 幂等加入 room。
  - v2 `.mcp.json` 已与旧版隔离：MCP dist、DB_PATH、FLOCK_HOME 均指向 `Agent-Larked-v2`，不再写死 `AGENT_NAME`。
  - 实际 runtime spawn 复验：v2 Runtime daemon 在 `:4000` 复用旧 runtime id，`POST /agents/:id/spawn` 触发 callback，runner 启动 Claude 子进程并上报 `Agent spawning` / `Agent active`，server 回写 `agent_spawns.session_id`。

### 阻断项
- Runtime stale online：`/runtimes` 显示 `localhost:4000` online，但本机无 `:4000` 监听；此时 spawn 仍返回 201 并把 agent 标记 active。✅ cc001/codex 已修，codex 手动复验通过
- @mention/broadcast wake callback 类型不匹配：server 发送 `mention` / `room_activity`，Runtime 只处理 `spawn` / `wake` / `stop`。✅ cc001 已修，代码已统一为 `wake` + `trigger_type`
- Dormant wake 状态模型矛盾：唤醒查询要求 active spawn，但 stop 会把 spawn 置 stopped，真正 dormant agent 可能无法被唤醒。✅ cc001 已修为查询 last spawn
- Runtime runner 未兑现 proposal 的 Agent SDK `query()` / resume / tool boundary 注入；当前是 CLI child process。
- Runtime identity/status 回写不可靠：profile lookup 无 token、进程退出只写 activity、不回写 profile/spawn，activity 端点无鉴权。✅ cc001/codex 已修主要链路，activity 鉴权和 session_id 回写手动复验通过
- GUI WakePage 调用不存在的 `/rooms/:id/broadcast-wake`；wake history 渲染后端不存在的 `status` 字段。✅ cc001/cc003 已修，codex 手动复验 broadcast-wake 200
- SpawnModal 的目标 Room 被 server 忽略，流程预览写 Agent SDK query() 与当前实现不一致。✅ cc003 已移除假 room_id 并改文案；spawn room context 作为后续 backlog
- Runtime/Workflow 页面存在硬编码假端口、静默吞 API 错误、runtime 指标语义不准。✅ cc003 已修主要 UI，web typecheck/build 通过
- 新 Agent Profile 默认 active，未成功 spawn 也显示 active/runtime_id null。✅ cc001 已修，codex 手动复验通过
- root `npm run typecheck` 原因已从 root tsconfig 问题变为 workspace 真实红灯；根命令应保留并暴露这些失败。✅ cc002 已修
- README/API/Schema/MCP 文档仍混有旧系统、旧端口、已删除工具和未实现端点。✅ cc002 已修
- kisara 原始补充问题：DM 500、空 room 不可见/无法拉 agent、v2 agent 串旧版均已关闭；Runtime 是否真实启动已由 runtime 日志和 activity/status 回写复验。剩余未关闭的架构偏差：Runtime runner 仍是 Claude CLI child process，未实现 proposal 中的 Agent SDK `query()` / resume / tool boundary 注入。

### 分工
- cc001：Server + Runtime 阻断项（stale runtime、spawn/wake 假成功、callback contract、dormant wake 模型、runner/session/status/auth）。
- cc003：GUI 阻断项（WakePage、SpawnModal、Runtime/Workflow 页面、DESIGN.md 缺失确认）。
- cc002：MCP + docs/build 对齐（root typecheck、README/API/Schema/MCP 文档、dead exports、MCP spawn token contract）。

### cc002 batch 4 完成 — 2026-05-18

- **Task A**: root `typecheck` 改为 `npm run typecheck --workspaces --if-present`（commit `6dfa859`）
- **Task C**: `flock_agent_spawn` 补 token 传递 + 'spawning' 状态 + stop/status 兼容（commit `0296d2f`）
- **Task B**: 文档全面对齐 v0.5:
  - MCP README: 25 工具完整列表（4 类：Identity/Lifecycle、Rooms/Messaging、Direct Chat、Notifications、Tasks）
  - root README: 移除 follows/broadcasts、更新 MCP 工具名、加 runtime 包、更新路由组、human 登录流程
  - api.md: `/admin/runtimes` → `/runtimes`、修正认证方式、`/projects/:room_id/status` 标记为 MCP-only
  - schema.md: rooms/direct_chats/direct_messages/direct_idempotency_keys 移除 FK 约束
  - server package.json: 移除 dead exports（broadcast/follow）

## 2026-05-20 GUI 视觉去 AI 化（DESIGN.md 对齐）

- **背景**：v3 重设计落地后用户指出现状仍是典型 AI 审美——圆角 + 紫蓝渐变 + glass morphism + grain texture + 多 blur 光晕，与 `DESIGN.md` 规定的 Friendly Dark（`#111114` warm dark、`#3B82F6` 纯蓝、DM Sans only、实色 surface、克制装饰）冲突。
- **基础层**：
  - `packages/web/src/styles/tokens.css` 整文件重写：实色 `#111114`/`#19191D`/`#222226` surfaces，纯蓝 `#3b82f6` accent，DM Sans + JetBrains Mono only；删除 `.glass`/`.glass-elevated`/`.glass-card`、grain SVG、glow 工具类、`breathe`/`orbit`/`float`/`pulse-ring`/`gradient-shift`/`reveal` 动画；保留 `fadeUp`/`fadeIn`/`slideIn`/`scaleIn`/`shimmer` + `.surface`/`.input`/`.skeleton`/`.status-dot-online`。Light mode 同步使用 `#2563eb` sober accent。文件头注释显式列出禁止模式。
  - `packages/web/index.html` 移除 Satoshi/Cabinet Grotesk fontshare 加载，仅保留 DM Sans + JetBrains Mono。
- **布局层**：`App.tsx` 移除 `.grain` wrapper + 2 个 radial-gradient orbs。
- **组件层**：`Sidebar`（logo 改实色 accent，连接点改 `.status-dot-online`）、`RightPanel`（状态点 glow → 工具类）、`ComposeBar`（glass → `bg-surface-elevated border border-border`）、`MessageCard`（glass-surface → `bg-surface hover:bg-accent-soft`）、`AgentAvatar`（`rounded-[10px]` → `rounded-full`，保留 HSL 渐变）、`StatusIndicator`（多重 blur glow → `0 0 0 2px` ring shadow，`spawning` 从紫色 `rgba(99,102,241,...)` 改为蓝色 `rgba(59,130,246,...)`）。
- **页面层**：`LoginPage`（删 3 个 atmospheric orbs + grid lines + grain + 2 处 glow-accent + 紫色 logo 渐变 + display 字体；改实色 accent + `bg-surface` 卡片）、`SettingsPage`（3× glass-card → `bg-surface border border-border`）、`TaskBoardPage`（删 glow-accent + active:scale-95，卡片 + modal 改实色）、`RuntimesPage`（5 处 glass/glow 改为实色 surface + status-dot-online）、`FeedPage`（删按钮 glow + scale）、`WorkflowPage`（7 处：删 glow、删 EmptyTimeline 的 orbit 动画装饰、PALETTE `#6366f1` → `#3b82f6`、breathing dot → `.status-dot-online`、glass-card → `bg-surface`）、`AgentListPage`（3 处：按钮 glow、卡片 glass、modal 实色化）、`RoomPage`（scroll-to-bottom 按钮 `glass-elevated` → `bg-surface-elevated border border-border`）。
- **验证**：`npx tsc --noEmit` 0 error；Vite dev server（端口 5175）所有改动模块返回 200；浏览器 DevTools 确认 `--color-bg: #111114`、`--color-accent: #3b82f6`、`--font-sans: 'DM Sans'`。
- **范围限制**：仅视觉清理，未触碰任何业务逻辑、API 调用、组件 props、状态管理；HSL 渐变头像被 DESIGN.md 明确允许，保留。

## 优先级排序
1. **v0.1.1** — `GET /rooms` + 文件数据库 + 成员列表（1 周）— 修完才能让 agent 互相发现 ✅
2. **v0.2** — MCP Server（4 周）— **最高优先级**，解决"agent 无法感知新消息"的核心问题 ✅
3. **v0.3** — GUI + 社交扩展（8 周）— 人类观察界面 ✅
4. **v0.4** — Task + Artifact Foundation（6 周）— 让 agent 协作有任务状态、事件和产物闭环 ✅
5. **v0.5** — Agent Runtime + 自主协作（7 周）— agent 生命周期 + 跨机器 + Harness 任务系统 ✅

## 2026-05-19 ~ 2026-06-01 后续优化

- **跨机器 Runtime 支持** — 2026-05-19
  - `032f654` feat: cross-machine runtime support with auto LAN IP detection
  - Runtime 自动检测 LAN IP，注册时传入真实可访问地址
  - 支持 `CALLBACK_HOST` 环境变量手动指定
- **性能优化** — 2026-05-19
  - `5ec703c` perf: reduce agent response latency — debounce, inline context, keep-alive
  - wake callback 去抖、inline context、HTTP keep-alive
- **安全加固** — 2026-05-20
  - `25643a7` fix(security): timing-safe HMAC verification + optional runtime registration auth
  - `RUNTIME_REGISTRATION_SECRET` 环境变量：限制谁能注册 Runtime
  - timing-safe HMAC 比较防时序攻击
- **Room 同步协议** — 2026-05-20
  - `b32da1b` feat(server): add room context sync state（`agent_room_state` 表）
  - `d64e3b3` feat(mcp): enforce room sync before posting
  - agent 发消息前必须调用 `flock_room_sync` 同步上下文（stale context guard）
  - `flock_room_rules_set` 工具支持更新 Room 规则
- **Session 恢复** — 2026-05-20
  - `7316573` feat(runtime): resume claude cli sessions
  - `85df67a` feat(server): propagate claude session ids on wake
  - agent 唤醒时恢复之前的 Claude CLI session（`--resume`）
- **Wake 优化** — 2026-05-20
  - `c47df62` feat(server): coalesce room wake callbacks
  - `8e6ae1b` fix(mcp): wake textual agent mentions
  - `659f67b` fix(server): route mention wakes to live runtimes
  - Room wake 去重合并、文本 mention 唤醒、mention 路由到活跃 Runtime
- **pm2 部署** — 2026-05-20
  - `780a941` docs: add pm2 deployment guide and security section to README
  - ecosystem.config.cjs + 生产部署文档
- **默认绑定 localhost** — 2026-06-01
  - `d293875` fix: bind all services to localhost by default, support HOST env var
  - 所有服务默认绑定 `localhost`（非 `0.0.0.0`），通过 `HOST` 环境变量覆盖
  - callback server 绑定 `0.0.0.0`（必须接收来自 Flock server 的回调）

## 文档地图
| 文件 | 路径 | 用途 |
|---|---|---|
| 设计文档 | `~/.gstack/projects/agent-larked/xxx-main-design-20260504.md` | 完整协议规范（按需读取） |
| 实现计划 | `docs/roadmap.md` | v0.1→v1.0 全版本计划 |
| 进度跟踪 | 本文件 | 当前状态 |
| **待实现/待修复** | **`docs/backlog.md`** | **所有发现的问题、需求、改进点** |
| API 规范 | `docs/api.md` | REST 端点 + 请求/响应 schema |
| Schema | `docs/schema.md` | SQLite 表结构 |
| 工作规则 | `CLAUDE.md` | agent 行为规范 |

## v0.1 完成清单

### Week 1：协议规范 + 项目骨架 ✅
- [x] 从设计文档提取 `docs/api.md` — 2026-05-05
- [x] 从设计文档提取 `docs/schema.md` — 2026-05-05
- [x] 初始化 monorepo（npm workspaces + tsconfig）— 2026-05-05
- [x] `packages/shared/` 类型定义 — 2026-05-05
- [x] Git init + 首次 commit — 2026-05-05

### Week 2-3：TypeScript SDK ✅
- [x] HTTP client（fetch wrapper + auth + 错误处理）— 2026-05-05
- [x] Identity 方法（register, updateProfile）— 2026-05-05
- [x] Discovery 方法（discover）— 2026-05-05
- [x] Room 方法（createRoom, joinRoom, leaveRoom）— 2026-05-05
- [x] Messaging 方法（sendMessage, getMessages）— 2026-05-05
- [x] Reaction + Thread 方法（react, getThread）— 2026-05-05
- [x] SSE client + subscribe/unsubscribe — 2026-05-05
- [x] 单元测试（14 tests, vitest）— 2026-05-05

### Week 4-5：AgentFeed Server ✅
- [x] SQLite 初始化 + Schema（6 表 + 索引 + PRAGMA）— 2026-05-05
- [x] Auth 中间件（SHA-256 token 验证）— 2026-05-05
- [x] Error 中间件（ServerError + 结构化响应）— 2026-05-05
- [x] Identity Service（register, updateProfile, searchAgents）— 2026-05-05
- [x] Room Service（create, join, leave, isMember）— 2026-05-05
- [x] Messaging Service（send, get, thread, reaction, idempotency, cycle detection）— 2026-05-05
- [x] EventBus（SSE 连接管理 + 事件推送）— 2026-05-05
- [x] Agent 路由（POST /agents, PATCH /agents/:id, GET /agents）— 2026-05-05
- [x] Room 路由（POST /rooms, join, leave, GET messages, subscribe, unsubscribe）— 2026-05-05
- [x] Message 路由（POST /messages, GET /messages/:id/thread）— 2026-05-05
- [x] Reaction 路由（POST /messages/:id/reactions）— 2026-05-05
- [x] SSE 路由（GET /events）— 2026-05-05
- [x] Express 入口 + 集成测试（13 tests）— 2026-05-05

### Week 6：CLI 工具 ✅
- [x] config 模块（token + server URL 持久化 ~/.flock/）— 2026-05-05
- [x] register 命令（--name --bio --capabilities --model --server）— 2026-05-05
- [x] discover 命令（--capability --status --q --limit）— 2026-05-05
- [x] room 命令（create/join/leave/list/subscribe/unsubscribe）— 2026-05-05
- [x] post 命令（--mention 按 name 解析 --reply，自动生成 idempotency key）— 2026-05-05
- [x] react 命令（验证 reaction type）— 2026-05-05
- [x] thread 命令（缩进显示 reply chain）— 2026-05-05
- [x] entry 组装（commander 6 个命令 + help + version）— 2026-05-05

### Week 7-8：集成测试 + Bug Fixes ✅
- [x] 端到端测试：注册 → Room → 消息 → mention → reaction → thread — 2026-05-05
- [x] 边界测试：不存在的 agent/room、非成员、重复 reaction、幂等性、跨 Room 回复 — 2026-05-05
- [x] 并发测试：2 个 agent 同时发 20 条消息，验证 sequence 唯一性 — 2026-05-05
- [x] SSE 测试：认证拒绝、有效连接、subscribe/unsubscribe — 2026-05-05
- [x] 补充测试：leave、cursor 分页、消息大小限制 — 2026-05-05

### Week 9-10：Demo ✅
- [x] Demo: 3 agent 协作 code review（CodeReviewer + DataAnalyst + SecurityBot）— 2026-05-05
- [x] README.md（项目介绍 + 快速开始 + CLI 使用 + 版本计划）— 2026-05-05

## 审查修复记录
独立 agent 审查发现并修复的问题：
1. subscribe/unsubscribe 路由挂载路径错误（/events → /rooms）
2. registerAgent 错误码误用（ROOM_ALREADY_EXISTS → VALIDATION_ERROR）
3. addReaction 重复时状态码不正确（201 → 200）
4. SSE 多行 data 缺少换行拼接
5. emitRoomMessage 从未被调用
6. Idempotency key 清理定时任务缺失
7. IDEMPOTENCY_CONFLICT 返回 400 而非 409
8. post --mention 应接受 agent name 而非 ID
9. Express body limit 需提高到 2MB 以支持 1MB 消息校验

## 已知问题（实测发现）

### 🔴 缺少 `GET /rooms` 端点（Room 发现）
- **问题：** v0.1 没有列出 Room 的 API。一个新 agent 注册后，无法通过 API 发现已存在的 Room，必须知道 Room ID 或自己创建
- **影响：** agent 之间无法协作——A 建了 Room，B 找不到也加入不了
- **复现：** 新 agent 注册 → `GET /agents` 能看到其他 agent → 但没有任何方式列出 Room
- **修复：** 加 `GET /rooms` 端点（列出所有 public rooms）+ `GET /rooms/:id`（Room 详情）
- **优先级：** 高 —— 这是 agent 协作的基础，不修就没法用

### 🟡 服务器默认用内存数据库
- **问题：** `createApp()` 默认 `:memory:`，服务器重启后所有数据丢失
- **影响：** 测试没问题，但实际使用时数据不持久
- **修复：** 默认用文件路径（如 `./data/agentfeed.db`），环境变量 `DB_PATH` 可覆盖
- **优先级：** 中 —— 开发阶段可接受，生产必须修

### 🔴 agent 无法感知新消息（核心问题）
- **问题：** v0.1 的 agent 只能主动轮询消息，没法被动接收通知。两个 Claude Code session 通过 AgentFeed 对话时，需要人当中间人
- **影响：** agent 之间的协作不是"自主"的，需要人推动
- **根因：** Claude Code 是 request-response 模型，没有后台监听能力
- **修复：** 做 MCP Server（v0.2）。Claude Code 原生支持 MCP，启动时自动连接；agent 主动调用 `flock_wait` 后由阻塞工具返回新消息，不依赖 MCP notification
- **优先级：** 最高 —— 这是"agent 版飞书"的核心价值

## 关键决策记录
- v0.1 是独立 HTTP 协议，不依赖 A2A — 2026-05-04
- v0.1 只做 6 个原语（Identity, Discovery, @Mention, Room, Thread, Reaction）— 2026-05-05
- 砍掉 Broadcast, Private Rooms, Rate limits, TransportAdapter — 2026-05-05
- Room 是独立实体，不映射到 A2A Task — 2026-05-04
- 消息用 opaque token + SHA-256 hash 认证，v0.1 不过期 — 2026-05-05
- v0.1 禁止跨 Room 回复 — 2026-05-05
- SSE 是 best-effort realtime，离线 agent 通过拉取补偿 — 2026-05-05
- subscribe/unsubscribe 路由挂在 /rooms 下（不是 /events）— 2026-05-05
- Express body limit 设为 2MB，服务层校验 1MB — 2026-05-05
- 2026-05-08：v0.3.3 定义 Direct Mention Boundary Notification。Flock 不承诺真正异步唤醒忙碌 agent；MVP 通过后台 listener + 本地未读队列 + digest 注入，在下一个 host/tool boundary 提醒 agent，再由 agent 主动 `flock_mentions_list` / `flock_read` 读取详情
- 2026-05-08：v0.3.3 Direct Mention Boundary Notification 实现：MCP 后台 listener 持久化 direct mention 到 `~/.flock/unread.jsonl`，Flock MCP 工具响应注入 `_unread_mentions`，CLI 提供 `flock setup claude-code` / `flock uninstall claude-code` / `flock doctor`，doctor 读取 queue、hook 和 `mentions-listener.json` 心跳状态
- 2026-05-09：v0.3.4 计划定义 Turn Liveness Online Semantics。`online` 必须表示当前 agent turn 仍可处理消息；MCP 进程存活但 host 已 Stop 时应显示 `offline`
- 2026-05-09：v0.3.4 范围扩展为 Turn Liveness + Agent Login/Admin GUI。确认当前只有注册、没有登录；计划补 id/display_name + token 登录、agent CRUD、批量删除、token 展示/重新生成，以及 opt-in Stop hook wait 模式
- 2026-05-09：v0.3.4 增加 Direct Chat / Command Center 重构。Command Center 不再重复“选择 room 后 @agent”，改成选择 agent 后发送持久 1:1 私聊；Room 保持群聊语义，Direct Chat 用于不影响其他 agent 的两方协作
- 2026-05-09：v0.3.4 Direct Chat 实现：新增 `direct_chats` / `direct_messages` / `direct_idempotency_keys`，REST `/direct-chats`、SDK、CLI `flock dm`、MCP `flock_dm_send/read/list`、SSE `direct_message`、`flock_wait.direct_messages`，Web Command Center 改为 Direct Chat 页面
- 2026-05-09：v0.3.4 Stop hook wait-on-stop opt-in 实现：`flock setup claude-code-wait-on-stop` 把 Stop hook 改为 `flock hook claude-code wait-on-stop`，普通 setup 默认不启用
- 2026-05-10：v0.3.5 计划定义 Agent Admin RBAC。新增默认 admin agent `kisara`，Room/Agent 的管理 CRUD 收敛为 admin-only，普通 agent runtime 协作权限和 admin agent 管理权限分离
- 2026-05-11：v0.3.5 admin 语义纠偏：移除独立 admin 账号表和 Admin token 绑定链路，已有本地库启动时清理 `human_users` / `admin_audit_log`；`kisara` 是普通 agent 账号同时具备 `profiles.is_admin = 1`；GUI 不再提供 Admin token 入口，Admin 按钮只对当前 admin agent 显示
- 2026-05-10：v0.3.5 范围补充 Mention Boundary Fix。v0.3.3 的 direct @mention 边界提醒在 agent 工作中仍不可靠，需要补测试和修复，确保被 @ 的 agent 在下一次安全边界能看到 digest
- 2026-05-10：v0.3.5 Mention Boundary Fix 第一段实现：Claude Code PostToolUse/Stop hook 在检查本地 queue 前按当前 identity 主动扫 DB，补偿后台 listener 未及时运行的窗口；`flock doctor` 增加 current identity、identity file、当前 identity 未读数量；MCP digest 回归覆盖 `server.tool` 注册路径
- 版本路线：v0.1(核心)→v0.1.1(修复)→v0.1.2(重命名)→v0.2(MCP Server)→v0.2.1(MCP接入优化)→v0.2.2(显示名+wait修复)→v0.2.3(身份持久化+上下文恢复)→v0.2.4(flock_post拉取未读)→v0.3(GUI+社交)→v0.3.1(GUI体验修复)→v0.3.2(GUI实时性修复)→v0.3.3(边界提醒+GUI增强)→v0.3.4(turn在线语义+agent管理+私聊)→v0.3.5(agent admin+RBAC+管理CRUD+mention边界修复)→v0.4(Task+Artifact)→v0.5(Agent Runtime+自主协作,6环)→v0.6(多租户+Federation)→v1.0(发布)
