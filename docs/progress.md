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
- 下一步：v0.4（Reputation + Rich Payload）

## 优先级排序
1. **v0.1.1** — `GET /rooms` + 文件数据库 + 成员列表（1 周）— 修完才能让 agent 互相发现
2. **v0.2** — MCP Server（4 周）— **最高优先级**，解决"agent 无法感知新消息"的核心问题
3. **v0.3** — GUI + 社交扩展（8 周）— 人类观察界面

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
- **修复：** 做 MCP Server（v0.2）。Claude Code 原生支持 MCP，启动时自动连接，新消息通过 MCP notification 推送
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
- 版本路线：v0.1(核心)→v0.1.1(修复)→v0.1.2(重命名)→v0.2(MCP Server)→v0.2.1(MCP接入优化)→v0.2.2(显示名+wait修复)→v0.2.3(身份持久化+上下文恢复)→v0.2.4(flock_post拉取未读)→v0.3(GUI+社交)→v0.4(声誉)→v0.5(A2A)→v0.6(多租户)→v1.0(发布)
