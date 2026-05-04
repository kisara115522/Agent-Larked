# Agent-Larked 项目规则

## 文档地图（必读）

开始任何工作前，先读这些文件了解上下文：

| 文件 | 路径 | 何时读 |
|---|---|---|
| **设计文档** | `~/.gstack/projects/agent-larked/xxx-main-design-20260504.md` | 需要查协议/API/Schema 细节时按需读取（500+ 行，不要全量加载） |
| **进度跟踪** | `docs/progress.md` | 每次开始工作前必读，了解当前状态和待做 |
| **实现计划** | `docs/roadmap.md` | 了解当前在哪个版本、做什么、不做什么 |
| **API 规范** | `docs/api.md` | 实现 API 端点时参考（从设计文档提取，随实现更新） |
| **Schema** | `docs/schema.md` | 实现数据库时参考（从设计文档提取，随实现更新） |

## 工作模式

### 随时可中断，无缝交接

- 每完成一个逻辑单元就更新 `docs/progress.md`
- 代码里不留隐式状态——所有决策、原因、上下文写在 commit message 或文档里
- 目标：任何时候中断，换一个 agent 读完 docs/ + 最近 commit 就能继续

### 细粒度提交

- 每个逻辑改动单独一个 commit，不要攒大提交
- Commit message 写清楚：改了什么、为什么改、影响什么
- 示例粒度：
  - 好：`feat: add message_mentions table for @recipient storage`
  - 差：`feat: add database schema`（太大，拆不开）
- 可以 WIP commit，但要标注 `[WIP]` 和剩余工作

### 多 Agent 协作

- 并行开多个 agent 时，每个 agent 独立 worktree，避免文件冲突
- 用 `git worktree add` 创建独立工作目录
- 每个 agent 负责一个明确的模块/任务，不交叉编辑同一文件
- Agent 之间通过 docs/ 和 commit message 同步状态，不依赖聊天上下文

### 不信任单一信息源

- 随时 websearch 确认最新信息，不要只依赖父级 agent 传递的知识
- 技术选型、API 用法、依赖版本——都要自己查证

## 代码规范

- TypeScript strict mode
- 所有函数有返回类型标注
- 错误处理不用 try-catch 包大块代码，精确到具体调用
- 不写无用注释，但关键决策必须注释（WHY，不是 WHAT）

## 项目结构（目标）

```
Agent-Larked/
├── CLAUDE.md                 # 本文件
├── package.json              # monorepo root (npm workspaces)
├── tsconfig.json             # base tsconfig
├── docs/
│   ├── progress.md           # 进度跟踪
│   ├── roadmap.md            # 版本实现计划
│   ├── api.md                # API 规范（从设计文档提取）
│   └── schema.md             # Schema（从设计文档提取）
├── packages/
│   ├── shared/               # 共享类型定义
│   │   └── src/
│   │       ├── types.ts      # AgentProfile, Room, Message 等类型
│   │       ├── errors.ts     # 错误码定义
│   │       └── index.ts
│   ├── server/               # AgentFeed Server
│   │   └── src/
│   │       ├── index.ts      # Express app entry
│   │       ├── db.ts         # SQLite 初始化 + schema
│   │       ├── middleware/    # auth, error handler
│   │       ├── routes/       # agents, rooms, messages, events
│   │       ├── services/     # identity, messaging, room
│   │       └── sse/          # Event Bus
│   ├── sdk/                  # TypeScript SDK
│   │   └── src/
│   │       ├── client.ts     # HTTP client
│   │       ├── types.ts      # re-export shared types
│   │       └── index.ts
│   └── cli/                  # CLI 工具 `lark`
│       └── src/
│           ├── index.ts      # CLI entry (commander/yargs)
│           ├── commands/      # register, post, room, discover, react, thread
│           └── config.ts     # token 存储 (~/.lark/token)
└── examples/
    └── code-review/          # 3 agent 协作 demo
```
