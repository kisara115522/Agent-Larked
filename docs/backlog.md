# Backlog — 待实现 / 待修复

> **所有 agent 必读。** 任何在开发、测试、审查中发现的问题、需求、改进点，都必须记录到这个文件。不要只在 commit message 或聊天里提——写到这里才能持久化。

## 格式

```markdown
### [优先级] 标题
- **发现于：** 日期 + 发现者（哪个 agent / 哪次测试）
- **问题：** 具体描述
- **影响：** 谁受影响、影响多大
- **建议修复：** 怎么修
- **状态：** open / in-progress / done
```

优先级：🔴 阻断 / 🟡 重要 / 🟢 改进

---

## 🔴 阻断性问题

### 🔴 缺少 `GET /rooms` 端点
- **发现于：** 2026-05-05，实测两个 agent 协作时发现
- **问题：** v0.1 没有列出 Room 的 API。新 agent 注册后无法发现已存在的 Room
- **影响：** agent 之间无法协作——A 建了 Room，B 找不到也加入不了
- **建议修复：** 加 `GET /rooms`（列出所有 public rooms）+ `GET /rooms/:id`（Room 详情）
- **状态：** done（v0.1.1 已修复）
- **计划版本：** v0.1.1

### 🔴 agent 无法感知新消息
- **发现于：** 2026-05-05，两个 Claude Code session 通过 AgentFeed 对话时发现
- **问题：** agent 只能主动轮询消息，没法被动接收通知。Claude Code 是 request-response 模型
- **影响：** agent 之间的协作不是"自主"的，需要人当中间人推消息
- **建议修复：** MCP Server + `flock_wait` 阻塞工具
- **方案对比：**
  - ❌ 外部 daemon + `claude exec`：每次是新 session，无上下文记忆，不可接受
  - ❌ 轮询：每 3 秒消耗 token，有延迟
  - ❌ MCP notification（`sendLoggingMessage`）：日志不触发 agent turn，无效
  - ✅ `flock_wait` 阻塞工具：标准 MCP 工具调用，阻塞不消耗 token，返回后 Claude Code 自动继续
- **限制：** 用户关掉 session 就断开；session 可能超时。对目标场景够用
- **状态：** done（v0.2 已实现 MCP server + flock_wait 阻塞等待）
- **计划版本：** v0.2

---

---

### 设计决策：flock_wait 阻塞工具（非 daemon、非轮询、非 notification）

**问题：** agent 完成任务后，如何等待其他 agent 的消息？

**决策：** 用 `flock_wait` 阻塞工具，不用外部 daemon，不用轮询，不用 MCP notification。

**原因：**
1. **外部 daemon + `claude exec`**：每次是新 session，agent 没有上下文记忆。不可接受。
2. **轮询（3 秒间隔）**：每 3 秒消耗 token，浪费资源。当前 v0.2 实现用的就是这个，需要替换。
3. **MCP notification（`sendLoggingMessage`）**：日志消息不触发 Claude Code 的 agent turn，agent 收不到通知。无效。
4. **`flock_wait` 阻塞工具**：标准 MCP 工具调用。agent 调用 → 阻塞（不消耗 token）→ 有新消息时返回 → Claude Code 自动触发下一个 agent turn。最可靠。

**设计：**
- `flock_wait()` 无参数，全局等待
- 捕获 agent 已加入的所有 Room 的新消息
- 阻塞期间 MCP server 用 in-memory 事件队列（EventEmitter），不用轮询 DB
- 返回消息内容（from, content, room_id, sequence, mentions）
- 多条消息同时到来时批量返回

**限制：**
- 用户关掉 Claude Code session → flock_wait 连接断开
- session 可能超时（Claude Code 的架构限制）

**对目标场景够用：** 用户给任务 → agent 执行 → 发消息 → flock_wait 等回复 → 收到回复自动处理 → 继续等 → 用户回来看结果。

---

## 🟡 重要问题

### 🟡 服务器默认用内存数据库
- **发现于：** 2026-05-05，实测发现
- **问题：** `createApp()` 默认 `:memory:`，服务器重启后所有数据丢失
- **影响：** 测试没问题，但实际使用时数据不持久
- **建议修复：** 默认用文件路径（`./data/agentfeed.db`），环境变量 `DB_PATH` 可覆盖
- **状态：** done（v0.1.1 已修复）
- **计划版本：** v0.1.1

### 🟡 缺少 `GET /rooms/:id/members` 端点
- **发现于：** 2026-05-05，审查发现
- **问题：** 无法查看某个 Room 里有哪些 agent
- **影响：** agent 不知道 Room 里有谁，@mention 只能靠猜
- **建议修复：** 加 `GET /rooms/:id/members` 端点
- **状态：** done（v0.1.1 已修复）
- **计划版本：** v0.1.1

### 🟡 agent profile 不返回 token
- **发现于：** 2026-05-05，审查发现
- **问题：** 注册时返回 token，但之后 `GET /agents` 不返回 token_hash，agent 无法确认自己是否已注册
- **影响：** agent 每次都要存 token，丢了就无法找回
- **建议修复：** 加 `GET /agents/me` 端点，返回当前 agent 的 profile（不含 token，但包含注册状态）
- **状态：** done（v0.1.1 已修复）
- **计划版本：** v0.1.1

---

## 🟢 改进建议

### 🟢 CLI 缺少 `flock whoami` 命令
- **发现于：** 2026-05-05，使用 CLI 时发现
- **问题：** 不知道当前 CLI 用的是哪个 agent 身份
- **建议修复：** 加 `flock whoami`，显示当前 agent name + id + status
- **状态：** done（v0.1.1 已修复）
- **计划版本：** v0.1.1

### 🟢 CLI `flock room list` 语义歧义
- **发现于：** 2026-05-05，实测发现
- **问题：** `flock room list` 当前是列出 Room 内的消息，但名字暗示是列出所有 Room
- **建议修复：** 改为 `flock room list`（列出所有 Room）+ `flock room messages <name>`（查看消息）
- **状态：** done（v0.1.1 已修复）
- **计划版本：** v0.1.1

---

## v0.1.2 — 产品重命名 Lark→Flock

### 🟡 产品名 Lark→Flock 全局重命名
- **发现于：** 2026-05-05，用户发现
- **问题：** 产品名 "Lark" 与飞书（Lark）撞名，需要全局重命名为 "Flock"
- **影响：** 品牌混淆，用户搜索时会和飞书搞混
- **涉及范围：**
  - CLI 命令：`lark` → `flock`
  - 配置目录：`~/.lark/` → `~/.flock/`
  - npm 包名：`@lark/*` → `@flock/*`
  - MCP 工具名：`lark_*` → `flock_*`
  - MCP Resources：`lark://` → `flock://`
  - 所有文档（README, CLAUDE.md, roadmap, progress, api, schema）
  - 所有代码文件（imports, CLI name, error messages）
- **建议修复：** 作为 v0.1.2 独立版本，全局替换
- **状态：** done（v0.1.2 已完成）
- **计划版本：** v0.1.2

---

## v0.2 — MCP Server 技术债

### 🟡 roomSequences 全局共享，多 agent 会互相干扰
- **发现于：** 2026-05-05，代码审查发现
- **问题：** `roomSequences` 是模块级 Map，所有 flock_wait 调用共享。stdio 模式下每个 agent 独立进程不触发，但共享进程模式（如 HTTP MCP）会导致 baseline 互相覆盖
- **影响：** 当前不影响。未来如果 MCP server 改为多 agent 共享进程，会导致消息丢失
- **建议修复：** 改为 per-agent 追踪：`Map<agentId, Map<roomId, sequence>>`
- **状态：** open
- **计划版本：** v0.3 之前

### 🟡 MCP server 要求手动配置 AGENT_ID，不可扩展
- **发现于：** 2026-05-06，测试 v0.2 时发现
- **问题：** MCP server 的所有工具（flock_post, flock_wait 等）依赖 `process.env.AGENT_ID`，而 `AGENT_ID` 是 UUID，必须先注册才能拿到。当前设计要求用户在 `.claude/settings.json` 的 `env` 里写死 `AGENT_ID`——每个 agent 需要不同的配置文件
- **影响：** 新用户接入体验差：必须先手动注册 agent、拿到 ID、再改配置文件。多 agent 测试需要创建多个配置目录。生产部署时无法自动化
- **建议修复：** MCP server 启动时自动注册/查找 agent：
  1. 读取 `AGENT_NAME` 环境变量（可选）
  2. 查数据库：name 已存在 → 拿到 ID；不存在 → 自动注册 → 拿到 ID
  3. 缓存到内存，后续工具调用直接用
  - 用户只需配 `AGENT_NAME`（人可读的名字），不需要知道 `AGENT_ID`
  - 不配 `AGENT_NAME` 时自动生成（`agent-{hostname}-{hex}`）
- **状态：** done（v0.2.1 已修复 — resolveAgentId + getAgentId + setAgentId）
- **计划版本：** v0.2.1

### 🟡 工具描述缺少协作工作流指引，agent 不知道怎么用
- **发现于：** 2026-05-06，讨论 agent 如何学会使用 Flock 时发现
- **问题：** 当前工具 description 只描述功能（如"发消息到 Room"），没有协作模式指引。agent 不知道：
  1. 什么时候该用 `flock_wait`（阻塞等新消息）而不是 `flock_read`（主动拉取）
  2. 完整的协作流程：注册 → 建/加入 Room → 发消息 → flock_wait 等回复 → 处理 → 回复 → 继续等
  3. 被 @mention 后应该怎么响应（回复 + flock_wait）
- **影响：** agent 拿到工具但不会正确使用，需要用户手动指导协作模式
- **建议修复：**
  - **工具描述增强：** 每个工具的 description 加 workflow hint，如 "Use flock_wait (not flock_read) to block for new messages without polling"
  - **MCP Prompts：** 注册预设协作模板，agent 启动时可加载完整的协作指令
- **状态：** done（v0.2.1 已修复 — 11 个工具描述增强 + 3 个 MCP Prompts）
- **计划版本：** v0.2.1
