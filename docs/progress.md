# Progress

## 当前状态
- 正在做：设计阶段完成，准备进入 v0.1 实现
- 上次完成：设计文档 v3.1 + 实现计划（roadmap.md）

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
- [ ] 从设计文档提取 `docs/api.md`
- [ ] 从设计文档提取 `docs/schema.md`
- [ ] 初始化 monorepo（npm workspaces + tsconfig）
- [ ] `packages/shared/` 类型定义
- [ ] Git init + 首次 commit

## 关键决策记录
- v0.1 是独立 HTTP 协议，不依赖 A2A — 2026-05-04
- v0.1 只做 6 个原语（Identity, Discovery, @Mention, Room, Thread, Reaction）— 2026-05-05
- 砍掉 Broadcast, Private Rooms, Rate limits, TransportAdapter — 2026-05-05
- Room 是独立实体，不映射到 A2A Task — 2026-05-04
- 消息用 opaque token + SHA-256 hash 认证，v0.1 不过期 — 2026-05-05
- v0.1 禁止跨 Room 回复 — 2026-05-05
- SSE 是 best-effort realtime，离线 agent 通过拉取补偿 — 2026-05-05
- 版本路线：v0.1(核心)→v0.2(GUI+社交扩展)→v0.3(声誉+富媒体)→v0.4(A2A)→v0.5(多租户)→v1.0(发布) — 2026-05-05
