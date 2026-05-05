# Progress

## 当前状态
- 正在做：v0.1 Week 9-10 — Demo
- 上次完成：Week 7-8 集成测试（38 tests, 5 test files）

## 文档地图
| 文件 | 路径 | 用途 |
|---|---|---|
| 设计文档 | `~/.gstack/projects/agent-larked/xxx-main-design-20260504.md` | 完整协议规范（按需读取） |
| 实现计划 | `docs/roadmap.md` | v0.1→v1.0 全版本计划 |
| 进度跟踪 | 本文件 | 当前状态 |
| 工作规则 | `CLAUDE.md` | agent 行为规范 |

## 已完成
- [x] 需求讨论（office-hours: research/open-source 模式）— 2026-05-04
- [x] Landscape 调研（A2A/MCP/ACP/AutoGen/Camel-AI）— 2026-05-04
- [x] 产品方向确认：AgentFeed = 社交语义层 + 高带宽协议，基于 A2A — 2026-05-04
- [x] 设计文档 v1（5/10 Claude 审查）— 2026-05-04
- [x] 设计文档 v2（7/10 Claude 审查）— 2026-05-04
- [x] 设计文档 v3（8.2/10 Claude + 6/10 Codex 审查）— 2026-05-05
- [x] 设计文档 v3.1（Codex 第二轮反馈修复）— 2026-05-05
- [x] 实现计划 v0.1→v1.0 — 2026-05-05
- [x] 项目规则 CLAUDE.md — 2026-05-05

## 待做（v0.1 Week 1）
- [x] 从设计文档提取 `docs/api.md` — 2026-05-05
- [x] 从设计文档提取 `docs/schema.md` — 2026-05-05
- [x] 初始化 monorepo（npm workspaces + tsconfig）— 2026-05-05
- [x] `packages/shared/` 类型定义 — 2026-05-05
- [x] Git init + 首次 commit — 2026-05-05

## 已完成（v0.1 Week 2-3）
- [x] SDK: HTTP client（fetch wrapper + auth + 错误处理）— 2026-05-05
- [x] SDK: Identity 方法（register, updateProfile）— 2026-05-05
- [x] SDK: Discovery 方法（discover）— 2026-05-05
- [x] SDK: Room 方法（createRoom, joinRoom, leaveRoom）— 2026-05-05
- [x] SDK: Messaging 方法（sendMessage, getMessages）— 2026-05-05
- [x] SDK: Reaction + Thread 方法（react, getThread）— 2026-05-05
- [x] SDK: SSE client + subscribe/unsubscribe — 2026-05-05
- [x] SDK: 单元测试（14 tests, vitest）— 2026-05-05

## 已完成（v0.1 Week 4-5）
- [x] Server: SQLite 初始化 + Schema（6 表 + 索引 + PRAGMA）— 2026-05-05
- [x] Server: Auth 中间件（SHA-256 token 验证）— 2026-05-05
- [x] Server: Error 中间件（ServerError + 结构化响应）— 2026-05-05
- [x] Server: Identity Service（register, updateProfile, searchAgents）— 2026-05-05
- [x] Server: Room Service（create, join, leave, isMember）— 2026-05-05
- [x] Server: Messaging Service（send, get, thread, reaction, idempotency, cycle detection）— 2026-05-05
- [x] Server: EventBus（SSE 连接管理 + 事件推送）— 2026-05-05
- [x] Server: Agent 路由（POST /agents, PATCH /agents/:id, GET /agents）— 2026-05-05
- [x] Server: Room 路由（POST /rooms, join, leave, GET messages）— 2026-05-05
- [x] Server: Message 路由（POST /messages, GET /messages/:id/thread）— 2026-05-05
- [x] Server: Reaction 路由（POST /messages/:id/reactions）— 2026-05-05
- [x] Server: SSE 路由（GET /events, subscribe, unsubscribe）— 2026-05-05
- [x] Server: Express 入口 + 集成测试（13 tests）— 2026-05-05

## 已完成（v0.1 Week 6）
- [x] CLI: config 模块（token + server URL 持久化 ~/.lark/）— 2026-05-05
- [x] CLI: register 命令（--name --bio --capabilities --model --server）— 2026-05-05
- [x] CLI: discover 命令（--capability --status --q --limit）— 2026-05-05
- [x] CLI: room 命令（create/join/leave/list/subscribe/unsubscribe）— 2026-05-05
- [x] CLI: post 命令（--mention --reply，自动生成 idempotency key）— 2026-05-05
- [x] CLI: react 命令（验证 reaction type）— 2026-05-05
- [x] CLI: thread 命令（缩进显示 reply chain）— 2026-05-05
- [x] CLI: entry 组装（commander 6 个命令 + help + version）— 2026-05-05

## 已完成（v0.1 Week 7-8）
- [x] 端到端测试：注册 → Room → 消息 → mention → reaction → thread — 2026-05-05
- [x] 边界测试：不存在的 agent/room、非成员、重复 reaction、幂等性、跨 Room 回复 — 2026-05-05
- [x] 并发测试：2 个 agent 同时发 20 条消息，验证 sequence 唯一性 — 2026-05-05
- [x] SSE 测试：认证拒绝、有效连接、subscribe/unsubscribe — 2026-05-05
- [x] 修复：IDEMPOTENCY_CONFLICT 返回 409（原来错误返回 400）— 2026-05-05

## 关键决策记录
- v0.1 是独立 HTTP 协议，不依赖 A2A — 2026-05-04
- v0.1 只做 6 个原语（Identity, Discovery, @Mention, Room, Thread, Reaction）— 2026-05-05
- 砍掉 Broadcast, Private Rooms, Rate limits, TransportAdapter — 2026-05-05
- Room 是独立实体，不映射到 A2A Task — 2026-05-04
- 消息用 opaque token + SHA-256 hash 认证，v0.1 不过期 — 2026-05-05
- v0.1 禁止跨 Room 回复 — 2026-05-05
- SSE 是 best-effort realtime，离线 agent 通过拉取补偿 — 2026-05-05
- 版本路线：v0.1(核心)→v0.2(GUI+社交扩展)→v0.3(声誉+富媒体)→v0.4(A2A)→v0.5(多租户)→v1.0(发布) — 2026-05-05
