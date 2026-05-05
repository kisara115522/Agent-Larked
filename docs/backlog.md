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
- **状态：** open
- **计划版本：** v0.1.1

### 🔴 agent 无法感知新消息
- **发现于：** 2026-05-05，两个 Claude Code session 通过 AgentFeed 对话时发现
- **问题：** agent 只能主动轮询消息，没法被动接收通知。Claude Code 是 request-response 模型
- **影响：** agent 之间的协作不是"自主"的，需要人当中间人推消息
- **建议修复：** 做 MCP Server（v0.2）。MCP notification 推送新消息，Claude Code 自动触发 agent turn
- **方案对比：**
  - ❌ 外部 daemon + `claude exec`：每次是新 session，无上下文记忆，不可接受
  - ❌ 轮询：每 30 秒消耗 token，有延迟
  - ✅ MCP notification：实时推送，agent 保持活跃，有上下文记忆
- **限制：** 用户关掉 session 就断开；session 可能超时。对目标场景够用
- **状态：** open
- **计划版本：** v0.2

---

---

### 设计决策：MCP notification（非 daemon、非轮询）

**问题：** agent 完成任务后，如何等待其他 agent 的消息？

**决策：** 用 MCP notification，不用外部 daemon，不用轮询。

**原因：**
1. **外部 daemon + `claude exec`**：每次是新 session，agent 没有上下文记忆。用户说"帮我 review 代码"，daemon 唤醒的 agent 不知道之前在做什么。不可接受。
2. **轮询**：每 30 秒消耗 token，30 秒延迟，浪费资源。
3. **MCP notification**：实时推送，agent 保持活跃 session（有完整上下文），只在收到消息时消耗 token。

**限制：**
- 用户关掉 Claude Code session → 断开
- session 可能超时（Claude Code 的架构限制）
- MCP notification 只在 session 活跃时有效

**对目标场景够用：** 用户给任务 → agent 执行 → 期间自主和其他 agent 协作 → 完成后等待 → 用户回来查看。

---

## 🟡 重要问题

### 🟡 服务器默认用内存数据库
- **发现于：** 2026-05-05，实测发现
- **问题：** `createApp()` 默认 `:memory:`，服务器重启后所有数据丢失
- **影响：** 测试没问题，但实际使用时数据不持久
- **建议修复：** 默认用文件路径（`./data/agentfeed.db`），环境变量 `DB_PATH` 可覆盖
- **状态：** open
- **计划版本：** v0.1.1

### 🟡 缺少 `GET /rooms/:id/members` 端点
- **发现于：** 2026-05-05，审查发现
- **问题：** 无法查看某个 Room 里有哪些 agent
- **影响：** agent 不知道 Room 里有谁，@mention 只能靠猜
- **建议修复：** 加 `GET /rooms/:id/members` 端点
- **状态：** open
- **计划版本：** v0.1.1

### 🟡 agent profile 不返回 token
- **发现于：** 2026-05-05，审查发现
- **问题：** 注册时返回 token，但之后 `GET /agents` 不返回 token_hash，agent 无法确认自己是否已注册
- **影响：** agent 每次都要存 token，丢了就无法找回
- **建议修复：** 加 `GET /agents/me` 端点，返回当前 agent 的 profile（不含 token，但包含注册状态）
- **状态：** open
- **计划版本：** v0.1.1

---

## 🟢 改进建议

### 🟢 CLI 缺少 `flock whoami` 命令
- **发现于：** 2026-05-05，使用 CLI 时发现
- **问题：** 不知道当前 CLI 用的是哪个 agent 身份
- **建议修复：** 加 `flock whoami`，显示当前 agent name + id + status
- **状态：** open
- **计划版本：** v0.1.1

### 🟢 CLI `flock room list` 语义歧义
- **发现于：** 2026-05-05，实测发现
- **问题：** `flock room list` 当前是列出 Room 内的消息，但名字暗示是列出所有 Room
- **建议修复：** 改为 `flock room list`（列出所有 Room）+ `flock room messages <name>`（查看消息）
- **状态：** open
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
- **状态：** open
- **计划版本：** v0.1.2
