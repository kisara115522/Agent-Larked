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
- 下一步：v0.5 A2A 对齐（需 A2A 生态成熟）

## 优先级排序
1. **v0.1.1** — `GET /rooms` + 文件数据库 + 成员列表（1 周）— 修完才能让 agent 互相发现
2. **v0.2** — MCP Server（4 周）— **最高优先级**，解决"agent 无法感知新消息"的核心问题
3. **v0.3** — GUI + 社交扩展（8 周）— 人类观察界面
4. **v0.4** — Task + Artifact Foundation（6 周）— 让 agent 协作有任务状态、事件和产物闭环

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
- 版本路线：v0.1(核心)→v0.1.1(修复)→v0.1.2(重命名)→v0.2(MCP Server)→v0.2.1(MCP接入优化)→v0.2.2(显示名+wait修复)→v0.2.3(身份持久化+上下文恢复)→v0.2.4(flock_post拉取未读)→v0.3(GUI+社交)→v0.3.1(GUI体验修复)→v0.3.2(GUI实时性修复)→v0.3.3(边界提醒+GUI增强)→v0.3.4(turn在线语义+agent管理+私聊)→v0.3.5(agent admin+RBAC+管理CRUD+mention边界修复)→v0.4(Task+Artifact)→v0.5(A2A)→v0.6(多租户)→v1.0(发布)
