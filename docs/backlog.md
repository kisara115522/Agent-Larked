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

### 🟢 v0.4 原 Reputation + Rich Payload 计划缺少数据闭环
- **发现于：** 2026-05-12，4版本开发小组规划讨论
- **问题：** 原 v0.4 计划要求基于 reaction、回复速度、任务完成率计算 reputation，并扩展 embedding/状态快照/结构化数据/文件消息。但当前系统没有一等 task/completion/outcome 模型，任务完成率无数据来源；embedding/富消息也缺少明确消费流程。
- **影响：** 直接实现会得到弱相关或不可解释的声誉分，并把消息模型变复杂；后续真正做任务或 A2A adapter 时可能返工。
- **建议修复：** v0.4 改为 Task + Artifact Foundation：先建立 Room 内任务生命周期、append-only task_events、text/json/code/uri artifacts；Reputation 推迟为基于 task_events/reactions 的派生读模型，Rich Payload 收敛为任务产物。
- **状态：** in-progress（v0.4 已重新定版，契约文档已写入 `docs/superpowers/specs/2026-05-12-v0.4-task-artifact-design.md`）
- **计划版本：** v0.4

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

## v0.2.3 — Agent 身份持久化 + 上下文恢复

### 🟡 新 session 的 agent 没有上下文记忆
- **发现于：** 2026-05-06，讨论 session 连续性时发现
- **问题：** Claude Code session 结束后，agent 的所有上下文丢失。新 session 虽然可以复用同一身份（AGENT_NAME），但不知道自己之前在哪些 Room、聊了什么、做了什么决策
- **影响：** agent 之间的协作无法跨 session 延续——每次都是"失忆的同一个人"
- **建议修复：** 两层方案：
  1. **Flock 层**：通过 MCP Prompt 引导 agent 养成"发状态更新"的习惯，在 Room 中定期记录工作进度、决策、阻塞点
  2. **Claude Code 层**：agent 把关键决策写到 CLAUDE.md / memory 系统，新 session 自然能读到
- **不做：** 不新增 Agent State 原语，Flock 保持社交协议定位，不做工作流引擎
- **状态：** open
- **计划版本：** v0.2.3

### 🟡 每次新 session 都创建新 agent 身份
- **发现于：** 2026-05-06，测试多 session 时发现
- **问题：** MCP server 启动时自动生成新 agent 名字，无法复用已有身份
- **影响：** 用户每次开新 session 都是"新人"，之前的 Room 成员关系、消息历史全部断开
- **建议修复：** MCP server 启动时检查 `~/.flock/identity.json`：
  - 文件存在 → 读取 agent ID + name + token，复用已有身份
  - 文件不存在 → 自动注册新 agent，写入 identity 文件
- **状态：** open
- **计划版本：** v0.2.3

### 🟡 agent 发消息前不知道有没有新消息
- **发现于：** 2026-05-06，两个 agent 协作时发现
- **问题：** Agent 1 在干活时，Agent 2 发了消息。Agent 1 干完活后直接发消息（不知道 Agent 2 已经说了），然后再 flock_wait 才拿到 Agent 2 的消息。导致 Agent 2 需要重复回复
- **影响：** 协作效率低，消息重复，agent 不知道对方已经说过什么
- **根因：** MCP 协议是 request-response 模型，server 无法在 agent 忙碌时推送消息
- **建议修复：** `flock_post` 执行时自动先拉取该 Room 的未读消息，和发送结果一起返回给 agent。这样 agent 发消息时自然能看到别人刚说了什么
- **不做：** 不依赖 MCP notification（Claude Code 不支持自定义 notification 触发 turn）
- **状态：** open
- **计划版本：** v0.2.4

---

## v0.3 代码审查发现（2026-05-07）

> 已修复：P1-P3（🔴）、P4-P5、P11（🟡）在 commit 031bcb6 中修复。剩余 P6-P10 为技术债。

### 🔴 私密 Room 消息无权限校验
- **发现于：** 2026-05-07，agent-2 审查发现
- **问题：** `getMessages` 不检查 Room 成员身份。任何已认证 agent 都能读私密 Room 消息。`sendMessage` 正确调了 `isRoomMember`，但 `getMessages` 没有。`GET /rooms/:id` 和 `GET /rooms/:id/members` 同样缺少检查
- **影响：** 安全漏洞——私密 Room 的消息对所有 agent 可见
- **建议修复：** `getMessages`、`getRoom`、`getRoomMembers` 加 `isRoomMember` 检查
- **状态：** done（031bcb6）

### 🔴 invitesRouter 重复挂载
- **发现于：** 2026-05-07，代码审查发现
- **问题：** `packages/server/src/index.ts` 第 24-25 行，同一个 router 挂在 `/agents` 和 `/invites` 下。`GET /me/invites` 匹配到两个路径，`POST /:id/accept` 和 `/:id/reject` 同理
- **影响：** 冗余路由，`/invites/me/invites` 路径语义奇怪
- **建议修复：** 只保留 `/agents` 下挂载，删除 `/invites` 挂载
- **状态：** done（031bcb6）

### 🔴 ThreadView reply_to 挂在错误消息
- **发现于：** 2026-05-07，agent-2 审查发现
- **问题：** `ThreadView.tsx:36-43` — reply_to 用了 thread 最后一条消息的 ID，而不是根消息的 prop messageId。用户回复 thread 时，新消息会挂在最后一条回复上而不是根消息上
- **影响：** Thread 结构混乱，回复挂在错误位置
- **建议修复：** reply_to 应使用根消息的 messageId prop
- **状态：** done（031bcb6）

### 🟡 broadcast/follow/invite 不发 SSE 事件
- **发现于：** 2026-05-07，代码审查发现
- **问题：** `broadcastRouter` 接收了 `eventBus` 参数但未使用（`_eventBus`）。Follow/Invite 也没有 SSE 事件。广播消息不会推送给在线 agent
- **影响：** GUI FeedPage 无法实时更新，关注者收不到广播通知
- **建议修复：** 接入 EventBus，广播/follow/invite 时发 SSE 事件
- **状态：** done（031bcb6 — broadcast SSE 已接入，follow/invite 待后续）

### 🟡 FeedPage 没有 SSE 订阅
- **发现于：** 2026-05-07，agent-2 审查发现
- **问题：** `FeedPage.tsx` 没调用 `useSSE()`。关注者的广播消息不会实时出现，只能手动刷新
- **影响：** 用户必须手动刷新才能看到新广播
- **建议修复：** 添加 SSE 订阅，收到 broadcast 事件时刷新 feed
- **状态：** done（031bcb6）

### ~~🟡 getFollowers/getFollowing cursor 逻辑重复~~
- **发现于：** 2026-05-07，代码审查发现
- **问题：** `packages/server/src/services/follow.ts` — 两个函数的 cursor 查询逻辑完全重复
- **状态：** done（v0.5 环 1 删除了 follow 系统，不再适用）

### 🟡 AgentPage 加载效率低（4 次 API 调用）
- **发现于：** 2026-05-07，代码审查发现
- **问题：** `AgentPage.tsx:21-36` — 查看一个 agent profile 需要：搜索 agents + get followers + get following + 检查是否 follow（拉自己的全部 following）
- **影响：** 页面加载慢，浪费 API 调用
- **建议修复：** 用 `GET /agents/:id` 直接拿 profile，follow 关系用 `/agents/:id/followers?limit=1` 检查
- **状态：** done（v0.5 已改为 `GET /agents/:id` + `/tasks` + `/agents/:id/activity` 三次调用）

### ~~🟡 Room 标题显示 roomId 而非名字~~
- **发现于：** 2026-05-07，代码审查发现
- **问题：** `RoomPage.tsx:94` — `💬 Room ${roomId?.slice(0, 8)}` 显示 UUID 前 8 位
- **影响：** 用户无法辨识 Room
- **建议修复：** 先调 `GET /rooms/:id` 拿到 room name 显示
- **状态：** done（v0.5 环 3 — RoomPage fetches room name via GET /rooms/:id）

### ~~🟡 fromName 显示原始 agent ID~~
- **发现于：** 2026-05-07，代码审查发现
- **问题：** `FeedPage.tsx:73`、`RoomPage.tsx:120` — `fromName={msg.from}` 传的是 UUID
- **影响：** 消息列表中显示 UUID 而非可读名字
- **建议修复：** 查询消息时 join profiles 表带上 name/display_name
- **状态：** done（v0.5 — messages 有 from_name/from_display_name 字段）

### ~~🟡 flock follow 命令双重嵌套~~
- **发现于：** 2026-05-07，代码审查发现
- **问题：** `followCommand()` 返回 `new Command('follow')`，子命令也是 `follow <agent-name>`。CLI 用法变成 `flock follow follow agentName`
- **状态：** done（30e3346 — v0.5 删除了 follow/invite/broadcast CLI 命令）

### 🟡 虚拟 broadcast room 污染 room 列表
- **发现于：** 2026-05-07，agent-2 审查发现
- **问题：** `GET /rooms` 会返回 `broadcast-${agentId}` 虚拟 room 条目
- **影响：** Room 列表中出现无意义的 broadcast room
- **建议修复：** `listRooms` 过滤掉 `broadcast-` 前缀的 room，或用独立表存 broadcast
- **状态：** done（031bcb6）

### 🟡 所有 catch 块静默吞错误
- **发现于：** 2026-05-07，agent-2 审查发现
- **问题：** web 包 6 个文件的 catch 块全部为空或 `// ignore`。API 失败时用户看不到任何反馈
- **影响：** 用户体验差——操作失败无提示
- **建议修复：** 添加 toast/notification 组件，catch 块中显示错误信息
- **状态：** done（dea5561 — ToastProvider + 所有 action 页面已接入 toast）

### 🟡 @mention 正则不匹配连字符名字
- **发现于：** 2026-05-07，agent-2 审查发现
- **问题：** ComposeBar 的 `@mention` 正则 `/@(\w+)/` 不匹配连字符名字如 `code-reviewer`
- **影响：** 带连字符的 agent 名字无法被 @mention
- **建议修复：** 正则改为 `/@([\w-]+)/`
- **状态：** done（v0.3.1 已修复 — gui-2-v031 分支）

### ~~🟡 FeedPage 消息仍显示 UUID~~
- **发现于：** 2026-05-07，交叉审查发现
- **问题：** `FeedMessage` 类型没有 `from_name`/`from_display_name` 字段
- **影响：** Feed 视图中消息的发送者显示为 UUID
- **建议修复：** messages 有 from_name/from_display_name 字段
- **状态：** done（v0.5 — FeedPage 使用 Message 类型，有 from_name/from_display_name）

---

## v0.3.3 — GUI 交互增强 + Direct Mention Boundary Notification（2026-05-07/08 规划）

### ~~🟡 RoomPage/FeedPage `.reverse()` 逻辑重复~~
- **发现于：** 2026-05-07，v0.3.2 审查发现
- **问题：** `reset` 和 `!reset` 分支做了完全相同的 `[...res.messages].reverse()`
- **影响：** 代码冗余，可读性差
- **建议修复：** 合并为一行 `const ordered = [...res.messages].reverse()`
- **状态：** done（已简化）

### ~~🟡 Room 标题显示 UUID 前 8 位~~
- **发现于：** 2026-05-07，v0.3.2 审查发现
- **问题：** `RoomPage.tsx:139` — `💬 Room ${roomId?.slice(0, 8)}` 显示 UUID
- **影响：** 用户无法辨识 Room
- **建议修复：** 先调 `GET /rooms/:id` 拿到 room name 显示
- **状态：** done（v0.5 — RoomPage fetches room name）

### ~~🟡 Sidebar agent 列表缺少状态指示器~~
- **发现于：** 2026-05-07，v0.3.3 规划发现
- **问题：** Sidebar 已订阅 `agent_status` SSE 事件，已有 `StatusIndicator` 组件，但 agent 列表只显示头像+名字，没有状态圆点
- **影响：** 用户无法直观看到 agent 是否在线
- **建议修复：** agent 列表项加 `<StatusIndicator status={a.status} />`，排序 online 优先
- **状态：** done（v0.3.3 已实现）

### ~~🟢 GUI 缺少创建/加入/离开 Room 功能~~
- **发现于：** 2026-05-07，用户使用发现
- **问题：** GUI 没有创建 Room、加入 Room、离开 Room 的入口
- **影响：** 人类用户无法从 GUI 管理房间
- **建议修复：** CreateRoomModal + JoinRoomModal + RoomPage leave 按钮
- **状态：** done（v0.3.3 已实现，v0.5 FeedPage 新建 Room 按钮已接入）

### 🟡 Agent 没有自动下线机制
- **发现于：** 2026-05-07，v0.3.3 规划讨论
- **问题：** 注册时默认 `online`，但进程退出后数据库里 status 仍为 `online`。其他 agent 看到 online 以为能 @mention 触达，实际已经死了
- **影响：** agent 状态不准确，误导其他 agent 和人类用户
- **建议修复：** 超时自动 offline 机制（定义 C）：
  - MCP 启动 → online
  - flock_wait 调用 → 重置 5 分钟 timer
  - timer 超时 → 自动 offline
  - 进程退出（SIGINT/SIGTERM）→ 立即 offline
- **状态：** open
- **计划版本：** v0.3.3

### 🔴 `online` 语义误把 MCP 进程存活当成 agent 可触达
- **发现于：** 2026-05-09，用户查看网页发现 7 个历史 agent 显示 online
- **问题：** v0.3.3 的 online/offline 设计仍偏向进程生命周期或 wait idle timer。MCP server 进程存活并不等于模型当前处在 active turn；如果 host 已 Stop、正在等待用户下一次输入，即使 MCP 进程还活着，也不会自动接收并处理新消息
- **影响：** GUI 显示 online 会误导人类和其他 agent，以为 direct mention / 消息能被当前 agent 处理；实际 agent turn 已结束，消息不会进入模型上下文
- **目标语义：** `online` = 当前 agent turn 正在运行，消息能在本轮继续被模型处理；`offline` = 当前 turn 已结束或进程不可用
- **建议修复：** v0.3.4 做 Turn Liveness Online Semantics：
  - `PostToolUse` hook 标记 `online`，表示 agent 仍在当前 turn 的工具边界
  - `Stop` hook 标记 `offline`，表示本轮生成结束
  - `flock_wait` pending 期间保持 `online`，因为消息能唤醒等待并返回给模型
  - MCP 启动不再直接 online；MCP 退出仍可作为 offline 兜底
  - 移除 `flock_wait` 返回后 5 分钟 idle-offline timer，最终 offline 由 Stop hook 决定
  - server 查询 agents 前做 stale online cleanup，处理崩溃或 hook 未执行的异常残留
- **不做：** 不把 MCP process liveness 当 online；不承诺真正 interrupt；不把 `busy/idle` 用作是否可触达的判断
- **状态：** done（v0.3.4 — kisara-claude 实现）
- **计划版本：** v0.3.4

### 🔴 Web GUI 缺少人类可操作的 Agent CRUD / 登录入口
- **发现于：** 2026-05-09，v0.3.4 需求梳理
- **问题：** 当前 GUI/API 只有注册和 Bearer token 鉴权，没有独立登录入口；人类也缺少新增 agent、改名、删除、批量删除、查看/重生成 token 的完整操作面板
- **影响：** 人类无法可靠管理本地 agent 账号；token 丢失后只能重新注册，历史 agent 容易堆积，GUI 上的账号状态和真实可用账号逐渐脱节
- **建议修复：** v0.3.4 做 Agent Login + Admin GUI：
  - 新增登录入口：`username` 支持 agent id 或唯一 `display_name`，同时校验对应 token
  - Agent 列表提供新建、编辑 `name`/`display_name`、单删、批量删除
  - GUI 在新建或重新生成 token 时展示明文 token，并明确历史 token 不可从 `token_hash` 反查
  - 新增 token regenerate，旧 token 立即失效
  - 管理 API 仍要求 Bearer token；完整多租户 RBAC 暂不在本阶段做，留到 v0.6
- **不做：** 不把 `token_hash` 暴露给前端；不承诺恢复历史明文 token；不在 v0.3.4 引入完整权限/角色系统
- **状态：** done（v0.3.4 — gui-2 实现）
- **计划版本：** v0.3.4

### 🟡 需要可选 Stop hook wait 模式保持 agent turn
- **发现于：** 2026-05-09，v0.3.4 需求梳理
- **问题：** 即使 online 语义改成 turn liveness，agent 一旦进入 Stop 并结束本轮，就不会继续处理房间消息；人类需要一个显式开关让 agent 在准备停止前改为 `flock_wait`
- **影响：** 长时间协作时 agent 容易“进程还在但 turn 已结束”，必须等用户下一次输入才能继续收消息
- **建议修复：** 新增 opt-in 命令/开关：
  - 例如 `flock hook claude-code wait-on-stop enable|disable`，或 `flock setup claude-code --wait-on-stop`
  - 开启后 Stop hook 在本轮结束前提示 agent 不要停止，改为调用 `flock_wait`
  - 成功进入 `flock_wait` 时保持 `online`；如果 host 仍结束生成，则最终标记 `offline`
  - 默认关闭，并提供最大提示次数、冷却或环境变量逃生口，避免无限拦截用户停止意图
- **不做：** 不承诺跨 host 的强制 keepalive；如果 host Stop hook 只能通知不能阻止，则降级为提示能力
- **状态：** done（v0.3.4 — codex-v034-direct 实现）
- **计划版本：** v0.3.4

### 🔴 Command Center 与 Room 发消息重复，缺少持久 1:1 私聊
- **发现于：** 2026-05-09，v0.3.4 需求梳理
- **问题：** 当前 Command Center 的原理是选择一个 room，再向该 room 发带 @mention 的消息。这和 Room 页面输入框能力重复，用户没有理由专门进入 Command Center
- **影响：** GUI 缺少真正的私聊协作入口；两个 agent 只想一对一沟通时必须污染群聊 room，也会影响不相关 agent 的上下文
- **建议修复：** v0.3.4 将 Command Center 重构为 Direct Chat：
  - 选择一个 agent 后直接发送私聊消息，不需要选择 room 或手写 @mention
  - 私聊消息持久化为当前账号与目标 agent 的 1:1 conversation，Room 继续表示群聊
  - GUI 支持 Direct Chat 列表、未读数、历史消息、Agent 详情页 Message 入口
  - MCP/SDK/CLI 支持 agent-to-agent 私聊发送和读取历史
  - Direct Chat 可用于口头邀请对方加入某个 room；真正 room invite 仍复用现有邀请 API
- **不做：** 不把 Direct Chat 简单伪装成 private room；不让第三方通过 room/feed API 读到私聊；不在本阶段做多人 DM
- **状态：** done（v0.3.4 — codex-v034-direct 实现）
- **计划版本：** v0.3.4

### 🟡 忙碌 agent 被 direct @mention 后无法及时感知
- **发现于：** 2026-05-08，research 房间多 agent 讨论
- **问题：** MCP 是 request-response 模型，server 不能在 agent 正在执行工具或推理时主动推送模型输入。`flock_wait` 解决的是 agent 主动等待回复；但如果 agent 正在写代码、跑测试或执行长工具调用，被 direct @mention 时不会立刻知道
- **影响：** agent 协作仍需要等到下一次显式 `flock_wait` / `flock_read`，或者等当前任务结束后人工提醒；在线状态也容易被误解为"可立即进入模型上下文"
- **建议修复：** v0.3.3 做 Direct Mention Boundary Notification：
  - MCP server 启动 background listener，监听 direct mention，写入 `~/.flock/unread.jsonl`
  - 新增 `flock_mentions_list`（只读）和 `flock_mentions_drain`（读取并清空）
  - Tier 1：Flock MCP 工具响应附带 `_unread_mentions` digest，零配置
  - Tier 3：`flock setup claude-code` 显式安装 PostToolUse/Stop hook，hook 检查本地队列，有未读才注入短 digest
  - hook 只注入短 digest，不注入完整消息正文；完整消息由 agent 主动 `flock_mentions_list` / `flock_read`
  - 明确 SLA：Detection 30 秒内持久化；Delivery 是下一个 host/tool boundary，不承诺真正 async wake-up
- **不做：** Role mention、`@everyone` fan-out、snooze、完整 disposition ack、MCP proxy、真正 interrupt；不允许 npm `postinstall` 静默改 `~/.claude/settings.json`
- **状态：** done（v0.3.5 — codex foreground fallback + 原子写 + doctor 增强）
- **计划版本：** v0.3.5

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

### 🟢 自动生成的 agent 名字不可读
- **发现于：** 2026-05-06，实测多 agent 协作时发现
- **问题：** 不配 `AGENT_NAME` 时自动生成 `agent-{hostname}-{hex}`（如 `agent-XXXdeMacBook-Pro-7992`），在 Room 消息和 discovery 结果中不可读
- **影响：** 多个 agent 协作时，人类无法从名字区分谁是谁
- **建议修复：** 加 `display_name` 字段（可选，用户可读别名）：
  - schema 加 `display_name TEXT` 列
  - `flock_update` 支持修改 `display_name`
  - 消息/discovery 结果优先显示 `display_name`，fallback 到 `name`
  - agent 首次启动时通过 MCP Prompt 引导用户设置名字
- **临时方案：** 配置里写 `AGENT_NAME`，或用 `flock_update` 设置 bio
- **状态：** done（v0.2.2 已修复 — display_name 字段 + flock_update 支持 + MCP Prompts 引导）
- **计划版本：** v0.2.2

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

---

## v0.3.1 — GUI 体验修复（2026-05-07 实测发现）

> 人类用户首次使用 GUI 时发现的阻断性问题和体验缺陷。

### 🔴 Agent 页面点击报 "Agent not found"
- **发现于：** 2026-05-07，用户实测发现
- **问题：** AgentPage 用 `GET /agents?q=<uuid>` 搜索 agent profile，但 `searchAgents` 的 LIKE 查询只匹配 `name`、`display_name`、`bio`，不匹配 `id`（UUID）。搜索 UUID 永远返回空
- **影响：** 点击侧边栏任何 agent 都显示 "Agent not found"，agent 详情页完全不可用
- **建议修复：** 加 `GET /agents/:id` 端点（直接按 ID 查 profile），AgentPage 改用这个端点
- **状态：** done（v0.3.1 — gui-1 后端 + gui-2 前端对接）

### 🔴 GUI 无法发送消息
- **发现于：** 2026-05-07，用户实测发现
- **问题：** ComposeBar 的 onSend 回调调用 `POST /messages`，但服务端 `sendMessage` 需要 `idempotency_key` 字段。GUI 确实传了 `crypto.randomUUID()`，但需要排查是否有 CORS、token 传递、或 Room 成员校验等问题
- **影响：** 人类用户无法从 GUI 发消息，GUI 只能看不能用
- **建议修复：** 排查具体失败原因（CORS / auth / 成员校验 / 请求格式），确保 GUI 能正常发消息
- **状态：** done（v0.3.1 — gui-2 排查为 proxy 配置 + token 持久化问题）

### 🟡 Agent 注册默认 status 为 offline
- **发现于：** 2026-05-07，用户实测发现
- **问题：** `registerAgent()` 硬编码 `status = 'offline'`（identity.ts:19）。MCP server 注册 agent 后不会自动更新 status 为 online。GUI 侧边栏显示当前 agent 为 offline
- **影响：** 所有新注册 agent 默认 offline，需要额外调用 `flock_update` 才能变 online
- **建议修复：** 方案 A：MCP server 注册后自动调用 `flock_update(status: 'online')`。方案 B：注册时 status 默认改为 'online'
- **状态：** done（v0.3.1 — gui-1 改为默认 online）

### 🟡 Agent 上线无 SSE 通知
- **发现于：** 2026-05-07，用户实测发现
- **问题：** agent 状态变更（online/offline/busy/idle）没有 SSE 事件。GUI 无法实时感知其他 agent 上线/下线
- **影响：** GUI 中 agent 列表的状态不会实时更新，需要手动刷新
- **建议修复：** `PATCH /agents/:id` 更新 status 时，通过 EventBus 广播 `agent_status` SSE 事件给所有在线 agent
- **状态：** done（v0.3.1 — gui-1 后端 SSE + gui-2 前端 Sidebar 订阅）

### 🟡 消息顺序反直觉（最新在最上面）
- **发现于：** 2026-05-07，用户实测发现
- **问题：** API `getMessages` 返回 `ORDER BY sequence DESC`（最新在前）。RoomPage 直接用 API 返回顺序渲染，不 reverse。导致最新消息在页面顶部
- **影响：** 聊天体验反直觉——标准 IM 是最新消息在底部
- **建议修复：** 前端 `loadMessages` 时 reverse 数组（`res.messages.reverse()`），或 API 改为 `ORDER BY sequence ASC`
- **状态：** done（v0.3.1 — gui-2 前端 reverse）

### 🟡 @mention 无自动补全
- **发现于：** 2026-05-07，用户实测发现
- **问题：** ComposeBar 的 @mention 只是正则提取 `@word`，没有下拉列表。用户必须精确知道 agent 的 `name` 才能 mention，无法发现 Room 里有哪些 agent
- **影响：** @mention 功能基本不可用——用户不知道 agent 的精确名字
- **建议修复：** 输入 `@` 后弹出当前 Room 成员列表（调 `GET /rooms/:id/members`），支持键盘选择，选中后插入 agent name
- **状态：** done（v0.3.1 — gui-2 自动补全 + 正则连字符支持）

### 🟡 消息中不显示 agent display_name
- **发现于：** 2026-05-07，用户实测发现
- **问题：** Message 类型只有 `from`（agent UUID），没有 `display_name`。RoomPage/FeedPage/ThreadView 全部传 `fromName={msg.from}`，导致消息发送者显示为原始 UUID 而非可读名字
- **影响：** 消息列表中全是 UUID，人类无法辨识谁发的
- **建议修复：** 两步：
  1. **API 层**：`getMessages`/`getFeed` join profiles 表，返回 `from_name` 和 `from_display_name` 字段
  2. **前端**：MessageCard 优先用 `from_display_name`，fallback 到 `from_name`
- **状态：** done（v0.3.1 — gui-1 后端 rowToMessage + gui-2 前端对接，FeedPage 待后续）

---

## v0.3.2 — GUI 实时性 + 交互修复（2026-05-07 实测发现）

### 🔴 @mention 发送报错 "One or more mentioned agents not found"
- **发现于：** 2026-05-07，用户实测发现
- **问题：** ComposeBar 的 `extractMentions` 提取 agent 名字（如 `gui-2`），但 API 的 `mentions` 字段要求 UUID。服务端校验 UUID 不存在，返回 1001
- **影响：** @mention 功能完全不可用，发送带 @ 的消息必报错
- **建议修复：** ComposeBar 的 `handleSend` 中，将 mention 名字通过 members 列表解析为 ID 后再传给 API
- **状态：** done（v0.3.2 — ComposeBar handleSend 加名字→ID 解析）

### 🔴 Agent 回复消息不会实时出现
- **发现于：** 2026-05-07，用户实测发现
- **问题：** RoomPage 监听 SSE `room_message` 事件，但没有调用 `POST /rooms/:id/subscribe`。EventBus 的 `emitRoomMessage` 只推送给已订阅的 agent，未订阅的 agent 收不到事件
- **影响：** 必须手动刷新才能看到其他 agent 的回复，实时协作不可用
- **建议修复：** RoomPage mount 时调用 `POST /rooms/:id/subscribe`，unmount 时调用 `POST /rooms/:id/unsubscribe`
- **状态：** done（v0.3.2 — RoomPage 加 subscribe/unsubscribe 生命周期）

### 🟡 进入房间后消息从顶部滚到底部
- **发现于：** 2026-05-07，用户实测发现
- **问题：** 进入房间或刷新页面时，消息先渲染在顶部，然后 `scrollIntoView({ behavior: 'smooth' })` 触发平滑滚动到底部。用户体验是"消息从顶部落下来"，而不是"直接看到最新消息"
- **影响：** 视觉闪烁，每次进入房间都有滚动动画，体验差
- **建议修复：** 初始加载时用 `scrollIntoView()` 无 smooth（直接跳到底部），只有新消息到达时才用 smooth 滚动
- **状态：** done（v0.3.2 — scrollRestoration=manual + container.scrollTop=scrollHeight）

---

## v0.3.4 — 实时推送回归（2026-05-09 实测发现）

### ~~🟡 GUI 发消息后前端不实时推送~~
- **发现于：** 2026-05-09，gui-1 在 v0.3.4 协作时实测发现
- **问题：** gui-1 在 GUI 发消息后，其他 agent 的消息不会实时出现在页面上，必须手动刷新或自己发一条消息才能看到
- **影响：** 人类用户在 GUI 上无法实时看到 agent 之间的对话，需要频繁刷新
- **根因：** GUI 用 human session token 认证，但 SSE /events、room subscribe 端点只接受 agent token（profiles.token_hash），human token 返回 401。FeedPage 也从未调用 subscribe
- **修复：** 新增 flexAuthMiddleware（agent+human 双认证），更新所有 GUI 端点，FeedPage 加 room 订阅
- **状态：** done（232af8b — 2026-05-18）
- **计划版本：** v0.5

---

## v0.3.5 — Agent Admin RBAC + 管理 CRUD + Mention Boundary Fix

### 🔴 Agent/Room 管理权限仍绑定任意普通 agent token
- **发现于：** 2026-05-10，v0.3.5 需求梳理
- **问题：** v0.3.4 虽然补了 Agent 管理 UI/Auth，但管理权限仍由任意 agent Bearer token 承担。Room 的新增/编辑/删除也缺少统一 admin 权限边界。这样任意持有 agent token 的运行时身份可能执行高权限管理动作。
- **影响：** 普通 agent runtime 身份和管理身份缺少权限边界。删除 agent、批量删除、token regenerate、room 删除等危险操作没有明确 admin-only 约束。
- **建议修复：** v0.3.5 做 Agent Admin RBAC：
  - 在 `profiles` 增加 `is_admin` 标记，默认初始化 admin agent `kisara`
  - Room 的新增、管理详情、编辑、删除、成员管理收敛为 admin-only
  - Agent 的新增、管理详情、编辑、删除、批量删除、token 管理收敛为 admin-only
  - 普通 agent token 只保留协作运行时能力：读可见 room、发消息、私聊、接受邀请、离开 room、更新自身运行状态
  - GUI 只在当前 agent `is_admin = true` 时展示 Admin 入口
- **不做：** v0.3.5 不做完整多租户/组织/细粒度角色；只做单机 admin agent 与 admin-only 管理边界，完整 RBAC 留到 v0.6
- **状态：** done（v0.3.5 — kisara-claude 后端 + gui-2 前端）
- **计划版本：** v0.3.5

### 🔴 缺少默认 admin agent
- **发现于：** 2026-05-10，v0.3.5 需求梳理
- **问题：** 系统没有默认 admin agent。用户需要一个默认 `kisara` agent 来登录 GUI 并执行 Room/Agent 管理操作。
- **影响：** 新环境启动后没有明确的管理主体。
- **建议修复：** 首次启动/迁移时幂等创建或标记 `name/display_name = kisara`、`is_admin = 1` 的 agent。首次新建时生成普通 agent token，写入本地 `./data/kisara-token.txt`；服务端只存 hash。
- **状态：** done（v0.3.5 — bootstrap 默认 admin agent，token 写入 ./data/kisara-token.txt；旧 `human_users` / `admin_audit_log` 表会在启动迁移时清理）

### 🔴 工作中的 agent 收不到 direct @mention 边界提醒
- **发现于：** 2026-05-10，gui-1 等待协作时实测反馈
- **问题：** v0.3.3 已设计 Direct Mention Boundary Notification，但 agent 正在工作时被 @mention 仍可能无法在下一次边界看到提醒。需要确认后台 listener、`~/.flock/unread.jsonl`、MCP tool response `_unread_mentions`、Claude Code hook 注入是否在当前身份和当前宿主下可靠串起来。
- **影响：** 人类或其他 agent 以为 @mention 能在 agent 工作中被感知，但实际 agent 可能继续执行旧任务，错过协作指令或调度消息。
- **建议修复：** v0.3.5 增加 Mention Boundary Fix：
  - 写复现测试覆盖“工作中收到 direct @mention → 下一次 Flock tool response/hook boundary 注入 digest”
  - 强化 `flock doctor`，报告 listener heartbeat、队列路径、当前 identity、未读数量和 hook 安装状态
  - 确保所有 Flock MCP tool response 都统一附带 `_unread_mentions` digest，而不是散落在个别工具
  - 确保 hook 无未读时静默、有未读时返回明确短 digest，并且不注入完整消息正文；PostToolUse/Stop hook 需要先按当前 identity 主动扫 DB，作为后台 listener 未及时运行时的 foreground fallback
  - 文档明确不能真正打断模型推理或长工具调用，只承诺下一安全边界提醒
- **状态：** done（v0.3.5 — codex foreground fallback + 原子写 + doctor 增强）
- **计划版本：** v0.3.5

### 🔴 Direct Mention Boundary 在多 agent 同机时身份和 hook 安装状态不可见
- **发现于：** 2026-05-12，v0.4 协作时 kisara 实测 @Claude-01/@Claude-02
- **问题：** 后台 listener 已将 direct mention 写入 `~/.flock/unread.jsonl`，但 Claude Code `~/.claude/settings.json` 未安装 Flock PostToolUse/Stop hooks 时，agent 使用非 Flock 工具不会在边界收到 digest。同时 hook 进程读取全局 `~/.flock/identity.json`，多 agent 同机时可能读到另一个 agent 身份，导致队列里有未读但当前 identity 的 `unread_count = 0`。
- **影响：** 用户会看到 agent 只有主动 `flock_wait` 才响应，误以为 Direct Mention Boundary 完全无效；多 agent 协作时尤其容易丢调度消息。
- **建议修复：** 强化 `flock doctor` 输出 `hooks_ready`、`unread_total`、`unread_recipient_ids`、`listener_identity_matches_current` 和 warnings；文档明确先用 doctor 判断 hook 未安装或 identity mismatch。后续需要把 identity/queue 进一步按 session 或 worktree 隔离。
- **状态：** in-progress（诊断增强已实现；身份隔离仍待设计）
- **计划版本：** v0.4 修复支线

### 🔴 GUI SSE 重连后 Room 订阅丢失
- **发现于：** 2026-05-12，v0.4 协作时 kisara 实测 GUI 必须刷新才能看到新消息
- **问题：** EventSource 重连或同 agent 新连接会触发旧连接 `close`，`EventBus.addClient` 的 close handler 会从所有 room subscriptions 删除该 agent。RoomPage 只在 mount 时调用 `/rooms/:id/subscribe`，重连后不会重新订阅，导致 SSE connected 但 `room_message` 不再推送。
- **影响：** GUI 实时协作退化为手动刷新。
- **建议修复：** EventBus 连接生命周期和 room subscription 生命周期分离；旧连接 close 只能删除对应 SSE client，不能清理显式 room subscriptions。补回归测试覆盖重连和旧连接 close。
- **状态：** done（EventBus 修复 + `event-bus.test.ts` 回归）
- **计划版本：** v0.4 修复支线

---

## v0.5 — Agent Runtime + 自主协作（2026-05-15 提案）

> 设计文档：`docs/proposals/v0.5-refactor.md`（1028 行）

### 🟡 v0.5 提案待 kisara 最终确认
- **发现于：** 2026-05-15，3 agent 协作讨论
- **问题：** v0.5 提案已提交，覆盖 6 个议题（Agent 团队架构、GUI 可观测性、不引入主 agent、Harness 基础设施、超越 prompt、Token 成本控制），实施计划从 4 Phase 调整为 6 环迭代，已推送到 GitHub
- **影响：** 需要 kisara 确认后才能开始实施
- **建议修复：** 等 kisara 确认，如有调整更新文档
- **状态：** open
- **计划版本：** v0.5

### 🟡 Agent SDK session resume + MCP 状态待验证
- **发现于：** 2026-05-15，v0.5 提案讨论
- **问题：** `query({ resume })` 是否正确重载 MCP 工具状态？需要 PoC 验证
- **影响：** 如果 resume 不重载 MCP 状态，agent 唤醒后可能丢失工具能力
- **建议修复：** 环 2 开始前做 Agent SDK PoC 验证
- **状态：** open
- **计划版本：** v0.5 环 2

### 🟡 API key 管理方案待定
- **发现于：** 2026-05-15，v0.5 提案讨论
- **问题：** MVP 阶段每个 runtime 设置 `ANTHROPIC_API_KEY` 环境变量，集中管理延后
- **影响：** 多 runtime 部署时每个机器需要手动配置 API key
- **建议修复：** MVP 用环境变量，后续考虑集中管理
- **状态：** open
- **计划版本：** v0.5 之后

### 🟡 Session 本地性限制
- **发现于：** 2026-05-15，v0.5 提案讨论
- **问题：** Session 存在 runtime 机器上，跨 runtime 迁移需要共享文件系统
- **影响：** agent 不能在 runtime 之间无缝迁移
- **建议修复：** 延后，需要共享文件系统或 session 存储层
- **状态：** open
- **计划版本：** v0.5 之后

### ~~🔴 FeedPage 依赖已删除的 broadcast 系统~~
- **发现于：** 2026-05-17，v0.5 环 3 准备
- **问题：** FeedPage 导入 `FeedMessage` 和 `GetFeedResponse` 类型，但这两个类型在 v0.5 中随 broadcast 系统一起被删除。`GET /feed` 端点也不存在了
- **影响：** FeedPage 无法编译
- **修复：** 重写 FeedPage，聚合所有 Room 的最新消息，用 `Message` 类型替代 `FeedMessage`
- **状态：** done（2026-05-17，commit 2cc686c）
- **计划版本：** v0.5 环 3

### 🟡 Ring 2 Review: callback 错误被静默吞掉
- **发现于：** 2026-05-17，claude002 review claude001 的 Ring 2 commit (a4c68c0)
- **问题：** `callback.ts:108` — `sendCallbackWithRetry(runtime, agentId, event).catch(() => {})` 吞掉所有错误，callback 失败时完全没有日志
- **影响：** @mention wake 失败时无法排查原因
- **建议修复：** `.catch((err) => console.error('Callback failed:', agentId, err))` 或写入错误日志表
- **状态：** done（87c7b1d — 加了 console.error 日志）

### 🟡 Ring 2 Review: human 消息 idempotency_key 用 Date.now() 生成
- **发现于：** 2026-05-17，claude002 review claude001 的 Ring 2 commit (a4c68c0)
- **问题：** `rooms.ts:141` — human 消息的 idempotency_key 用 `Date.now()` 生成，同一毫秒内多次调用可能重复
- **影响：** 极端情况下 human 消息可能因 key 重复被拒绝
- **建议修复：** 用 `randomUUID()` 或接受客户端传入的 key
- **状态：** done（87c7b1d — 改用 randomUUID()）

### 🟡 Ring 2 Review: callback URL 拼接未处理 trailing slash
- **发现于：** 2026-05-17，claude002 review claude001 的 Ring 2 commit (a4c68c0)
- **问题：** `callback.ts:34` — `${runtime.callback_url}/agents/${agentId}/callback` 未处理 trailing slash，可能变成 `http://host:9000//agents/...`
- **影响：** 如果 runtime 注册时 callback_url 带尾部 `/`，callback 请求可能 404
- **建议修复：** 用 `new URL()` 构建或 `callback_url.replace(/\/+$/, '')`
- **状态：** done（87c7b1d — 加了 replace(/\/+$/, '')）

### 🟡 Ring 2 Review: broadcast wake 语义未区分 @mention 和普通消息
- **发现于：** 2026-05-17，claude002 review claude001 的 Ring 2 commit (a4c68c0)
- **问题：** `rooms.ts:133` — human 发消息触发 `wakeRoomAgents` 唤醒所有 dormant agents，但未检查是否包含 @mention。普通消息也应该唤醒全部还是只唤醒被 @mention 的？
- **影响：** 广播唤醒可能过度（普通消息也唤醒所有 agent），或设计意图不明确
- **建议修复：** 明确设计意图：human 消息 = 广播唤醒全部 dormant agent（当前行为），agent 消息 = 只唤醒 @mention 的。当前实现符合设计，记录为已知行为
- **状态：** open（待设计确认）
- **计划版本：** v0.5

### 🟢 Ring 2 Review: Runtime 注册权限未限制
- **发现于：** 2026-05-17，claude002 review claude001 的 Ring 2 commit (a4c68c0)
- **问题：** `runtime.ts:28` — Runtime 注册用 agent auth，任何 agent 都能注册 runtime
- **影响：** 当前阶段影响不大，后续可能需要 owner 级别权限控制
- **建议修复：** MVP 可以接受，后续考虑 owner 校验
- **状态：** open
- **计划版本：** v0.5 之后

### ~~🟡 Ring 4 Review: HTTP transport session 无 TTL 清理~~
- **发现于：** 2026-05-17，claude002 self-review Ring 4 (commits fd6e7b9..3c586df)
- **问题：** `http.ts` 的 `transports` Map 没有 TTL 清理机制，如果客户端断开但没触发 close 事件，session 会一直占内存
- **影响：** 长时间运行可能导致内存泄漏
- **修复：** 添加了 30 分钟 idle timeout + 每 60 秒清理 + unref() 不阻塞进程退出
- **状态：** done（2026-05-17，commit 25bd32e）
- **计划版本：** v0.5

### 🟢 Ring 4 Review: CORS 设为 * 在生产环境不安全
- **发现于：** 2026-05-17，claude002 self-review Ring 4 (commits fd6e7b9..3c586df)
- **问题：** `server.ts` CORS 设为 `Access-Control-Allow-Origin: *`，开发阶段没问题但生产环境需要收紧
- **影响：** 生产环境可能被任意来源访问
- **建议修复：** 通过环境变量配置允许的 origins
- **状态：** open
- **计划版本：** v0.5 之后

### ~~🟡 GET /agents 返回人类 profile（GUI 混淆）~~
- **发现于：** 2026-05-18，claude003 审查发现
- **问题：** `searchAgents` 查询 `profiles` 表，人类注册时也在 profiles 表创建了条目（`token_hash='human-no-login'`）。`GET /agents` 会返回人类 profile，AgentListPage 会把人类显示为"agent"，显示 spawn/stop/wake 控件
- **影响：** GUI Agent 列表中出现人类用户，操作按钮无意义
- **修复：** `searchAgents` 加 `WHERE token_hash != 'human-no-login'` 过滤
- **状态：** done（50b01f5 — 2026-05-18）
- **计划版本：** v0.5

### 🔴 v0.5 缺列 migration 导致 Server 启动崩溃
- **发现于：** 2026-05-17，kisara 实测时发现，claude003 在测试前已发现
- **问题：** v0.4 创建的 `task_events` 和 `tasks` 表在 v0.5 Ring 5 新增了多列（`event_type`, `assigned_to`, `required_capabilities`, `retry_count`, `max_retries`, `message_id`, `created_by`, `completed_at`），但 schema 用 `CREATE TABLE IF NOT EXISTS` 不会修改已有表，且没有加 migration。导致 `pollTaskEvents` 查询崩溃 `SQLITE_ERROR: no such column: te.event_type`
- **影响：** Server 启动后立即崩溃，所有功能不可用
- **建议修复：** `db.ts` 加对应 `migrateColumn` 调用
- **状态：** done（2026-05-17，commit 22c772e + 1ee946a）

### 🟡 Vite proxy 缺少 v0.5 新增路由
- **发现于：** 2026-05-17，claude003 发现，kisara 实测确认
- **问题：** `vite.config.ts` 的 `API_PREFIXES` 没有 `/human`、`/runtimes`、`/token-budgets` 等 v0.5 新增路由，GUI 请求被 vite 吃掉返回 HTML
- **影响：** GUI 登录、agent 管理等功能全部 404
- **建议修复：** 在 `API_PREFIXES` 数组中添加缺失的路由前缀
- **状态：** done（2026-05-17，commit 46ef811，claude002 修复）

### 🔴 v0.5 Runtime stale online 导致 spawn/wake 假成功
- **发现于：** 2026-05-18，codex 验收发现
- **问题：** `GET /runtimes` 仍返回 `localhost:4000` status=`online`，但 `lsof -nP -iTCP:4000 -sTCP:LISTEN` 无监听进程。此时 `POST /agents/:id/spawn` 仍返回 201，并把 agent 标记为 `active`、`session_id=null`。
- **影响：** GUI 和调度器会相信 agent 已启动，实际 Runtime daemon 不存在，agent 不会工作也不会响应。
- **建议修复：** Server 选择 runtime 前清理/过滤 stale heartbeat；spawn/wake 在无可达 runtime 或 callback 失败时不能写入 active 假状态；必要时引入 `spawning/pending/error` 状态并回写失败。
- **状态：** done（2026-05-18，codex 复验补强：`GET /runtimes` 列表前清理 stale runtime；显式传 stale `runtime_id` 的 spawn 返回 400，不写假 active/spawning）
- **计划版本：** v0.5 验收阻断

### 🔴 @mention / broadcast wake callback 类型和 Runtime 不匹配
- **发现于：** 2026-05-18，codex 验收发现
- **问题：** `wakeMentionedAgents()` 发送 callback `type: "mention"`，`wakeRoomAgents()` 发送 `type: "room_activity"`；但 Runtime `handleCallback()` 只处理 `spawn | wake | stop`，其他类型只打印 Unknown callback type。
- **影响：** v0.5 要求的 @mention 唤醒和 broadcast wake 不会真正唤醒 agent。
- **建议修复：** 统一 callback contract；建议 server 对 mention/broadcast 都发送 `type: "wake"` 并附带 trigger payload，或让 Runtime 显式处理 `mention/room_activity`。加测试覆盖两条路径。
- **状态：** done（2026-05-18，cc001 修复：mention/broadcast/task assignment 统一发送 `type: "wake"` + `trigger_type` payload）
- **计划版本：** v0.5 验收阻断

### 🔴 Dormant wake 查询要求 `profile dormant + spawn active`，状态模型矛盾
- **发现于：** 2026-05-18，codex 验收发现
- **问题：** `wakeMentionedAgents()` 只查 `agent_spawns.status='active'`；`wakeRoomAgents()` JOIN active spawn 又要求 `profiles.status='dormant'`。但 stop 会把 active spawn 改成 stopped，真正 dormant agent 很可能没有 active spawn。
- **影响：** dormant agent 被 @mention 或 broadcast 时找不到可唤醒的 runtime/session，唤醒链路静默跳过。
- **建议修复：** 明确 dormant/resume 模型：保留 last runtime/session、引入 dormant spawn 状态，或单独存 last_spawn/last_runtime；不要依赖矛盾状态组合。
- **状态：** done（2026-05-18，cc001 修复为查询 last spawn/runtime，不依赖 active+dormant 矛盾组合）
- **计划版本：** v0.5 验收阻断

### ~~🔴 Runtime runner 未实现 proposal 要求的 Agent SDK query/resume~~
- **发现于：** 2026-05-18，codex 验收发现
- **问题：** `packages/runtime/src/agent-runner.ts` 使用 `spawn('claude', ['-p', prompt, '--output-format', 'text'])`，没有依赖或调用 Claude Agent SDK `query()`，也没有持久化/resume session、context compression recovering 状态、tool boundary unread 注入。
- **影响：** `docs/proposals/v0.5-refactor.md` 和 `docs/roadmap.md` 中的 Runtime/session resume/边界注入验收标准并未兑现。
- **修复：** 2026-06-01，agent-runner.ts 重写为使用 `@anthropic-ai/claude-agent-sdk` 的 `query()` async generator。Session resume 通过 SDK `resume` 选项。MCP server 内联配置。AbortController 替代 process.kill()。
- **状态：** done（2d18e1d）
- **计划版本：** v0.5

### 🔴 Runtime 身份/状态回写不可靠且 activity 端点无鉴权
- **发现于：** 2026-05-18，codex 验收发现
- **问题：** Runtime `fetchAgentName()` 调 `GET /agents/:id` 不带 Bearer token，会被 flex auth 拒绝并 fallback 到 `agent-${id.slice(0,8)}`；子进程退出后只写 `/agents/:id/activity`，不更新 `profiles.status` / `agent_spawns.status`；`POST /agents/:id/activity` 当前无鉴权。
- **影响：** Runtime 启动的 MCP identity 可能错误，agent 退出后 GUI 仍可能显示 active，任何调用方都能伪造 workflow activity。
- **建议修复：** callback payload 带 agent name/token 或使用受保护 profile lookup；Runtime 退出/失败必须回写 server 状态；activity 上报加 runtime/HMAC 或内部 token 鉴权。
- **状态：** done（2026-05-18，cc001/codex 修复：callback payload 带 agent token/name；activity 要求 agent Bearer token；runtime `Agent active` 回写 `profiles.status`、`agent_spawns.status` 和 `agent_spawns.session_id`）
- **计划版本：** v0.5 验收阻断

### 🔴 WakePage Broadcast 唤醒调用不存在的 endpoint
- **发现于：** 2026-05-18，codex 验收发现
- **问题：** `packages/web/src/pages/WakePage.tsx` 调用 `POST /rooms/:id/broadcast-wake`，但 server 没有该路由；实测请求返回 404 HTML。
- **影响：** GUI “全部唤醒”按钮必失败，v0.5 broadcast wake 无法通过 GUI 验收。
- **建议修复：** 与 Server 对齐真实接口；若新增 `/rooms/:id/broadcast-wake`，前端使用该响应；若采用 human message 触发 broadcast wake，前端不要调用死路由。
- **状态：** done（2026-05-18，cc001/cc003 修复并由 codex 手动复验 `POST /rooms/:id/broadcast-wake` 返回 200）
- **计划版本：** v0.5 验收阻断

### 🟡 Wake history 前端渲染不存在的 `status` 字段
- **发现于：** 2026-05-18，codex 验收发现
- **问题：** `WakePage` 的 `WakeEvent` interface 要求 `status`，渲染成功/失败 badge；但 `/activity/wake-history` 返回 `wake_events`，schema 没有 `status` 列。
- **影响：** 唤醒历史可能显示 `undefined` 并走错误态样式，无法判断 callback 是否成功。
- **建议修复：** 后端记录真实 wake status（pending/succeeded/failed）并返回；或前端移除不存在字段，等 cc001 的 callback 成功/失败模型落地后再显示。
- **状态：** done（2026-05-18，cc001/cc003 修复：wake_events/status 显示与后端字段对齐）
- **计划版本：** v0.5

### 🟡 SpawnModal 目标 Room 和 Agent SDK 流程预览是误导性 UI
- **发现于：** 2026-05-18，codex 验收发现
- **问题：** `SpawnModal` 向 `/agents/:id/spawn` 发送 `room_id`，但 server spawn route 忽略该字段；流程预览写 “Agent SDK query()”，而 Runtime 当前是 CLI child process。
- **影响：** 用户以为 agent 会进入指定 room、使用 SDK session，实际两者都不成立。
- **建议修复：** 与 Server 定义 spawn `room_id` 合约，或移除/禁用目标 Room；流程预览必须反映真实实现。
- **状态：** done（2026-05-18，cc001/cc003/codex 修复：spawn/wake 支持 `room_id` 并把 `room_id`/`room_name` 透传给 Runtime callback；流程预览不再声称 SDK query）
- **计划版本：** v0.5

### 🟡 Runtime/Workflow 页面静默吞 API 错误且指标语义不准
- **发现于：** 2026-05-18，codex 验收发现
- **问题：** `RuntimesPage` 硬编码 `localhost:9400`；`RuntimesPage.load()` / `WorkflowPage.load()` 把 API 失败 catch 成空数组；Workflow “活跃 Runtime”按 `agent_count > 0` 统计而不是 runtime online/stale 状态。
- **影响：** GUI 会把 API/auth/server 错误伪装成“暂无数据/等待 Runtime”，且 Runtime 状态显示和后端语义冲突。
- **建议修复：** Runtime 图改为动态或去掉假端口；load 失败显示 toast/inline error；Workflow 分开显示 online/stale runtime 和 running agents。
- **状态：** done（2026-05-18，cc003 修复主要 UI；codex 补强后 `GET /runtimes` 会先清理 stale runtime，避免 GUI 显示假 online）
- **计划版本：** v0.5

### 🔴 Root `npm run typecheck` 因 tsconfig rootDir 错误失败
- **发现于：** 2026-05-18，codex 验收发现
- **问题：** repo root 执行 `npm run typecheck` 报大量 TS6059，提示 packages 文件不在 rootDir `/src` 下。各 workspace typecheck 可通过，但根脚本不可用。
- **影响：** 新人和 CI 会被根命令误导，无法用单一命令确认 monorepo 类型正确性。
- **建议修复：** 调整 root tsconfig 或 root package scripts，让根 typecheck 聚合 workspaces typecheck，而不是用错误 rootDir 编译整个 monorepo。
- **状态：** done（2026-05-18，cc002 修复 root typecheck 聚合 workspace typecheck）
- **计划版本：** v0.5 验收阻断

### 🟡 README/API/Schema/MCP 文档仍混有旧系统和未实现端点
- **发现于：** 2026-05-18，codex 验收发现
- **问题：** README 仍写 follows/broadcasts、3000/5173、`profiles.is_admin`、旧 CLI/MCP 工具；`packages/mcp/README.md` 和 prompts 仍提 `flock_register`/`flock_update`；`docs/api.md` 写 `GET /projects/:room_id/status`、`POST /tasks/:id/artifacts` 等未确认实现；`docs/schema.md` status/created_by 注释和 v0.5 实现不一致；server package exports 仍含不存在的 follow/broadcast service。
- **影响：** 后续 agent 会按错误文档实现或验收，用户也会照旧命令启动到 v1 端口。
- **建议修复：** 按真实 v0.5 实现同步 README、MCP README/prompts、api/schema；未实现端点标为 planned/open 或补实现；清理 dead package exports。
- **状态：** done（2026-05-18，cc002 batch 4 对齐 README/MCP README/api.md/schema.md/package exports）
- **计划版本：** v0.5

### 🟡 v2 root 缺少 DESIGN.md
- **发现于：** 2026-05-18，codex 验收发现
- **问题：** 项目规则要求视觉/UI 决策前阅读 DESIGN.md，但 v2 root 未找到 DESIGN.md，只在旧 `.claude/worktrees/...` 中存在相关文件。
- **影响：** GUI 修复时无法可靠遵循当前设计源，容易扩大视觉漂移。
- **建议修复：** 将当前设计系统文档同步到 v2 root，或在 docs 中明确 v2 的设计规范位置。GUI 验收前避免无依据的大范围视觉重构。
- **状态：** done（已从 v1 复制 DESIGN.md 到 v2 root）
- **计划版本：** v0.5

### 🟡 spawn room_id 未实现
- **发现于：** 2026-05-18，codex 验收发现
- **问题：** SpawnModal 发送 `room_id` 到 `POST /agents/:id/spawn`，但 server 完全忽略该字段。GUI 已移除 Room 选择控件。
- **影响：** 无法在 spawn 时指定目标 Room，agent 启动后不知道要加入/查看哪个 Room
- **建议修复：** server spawn 端点支持 room_id，callback payload 带 room_id/room_name，初始 prompt 让 agent join/read/post 到该 room
- **状态：** done（2026-05-18，server spawn/wake 支持 `room_id`，callback payload 带 `room_id`/`room_name`，runtime fallback prompt 限定目标 room）
- **计划版本：** v0.5

### 🔴 v0.5 GUI 私聊缺 idempotency key 导致 Internal Error
- **发现于：** 2026-05-18，kisara 实测，codex 复现
- **问题：** GUI 发送 direct message 时可能不传 `idempotency_key`，`sendDirectMessage()` 直接把 `undefined` 写入 `direct_idempotency_keys.key`，触发 `SQLITE_CONSTRAINT_NOTNULL` 并返回 500。
- **影响：** 人类/GUI 私聊失败，用户只能看到 Internal Error。
- **建议修复：** 服务端在缺省 `idempotency_key` 时生成 UUID，并用独立测试覆盖 GUI 无 key 路径。
- **状态：** done（2026-05-18，codex 修复；`direct-chat.test.ts` 覆盖无 key 发送）
- **计划版本：** v0.5 验收阻断

### 🔴 v0.5 人类无法把 agent 拉进 Room
- **发现于：** 2026-05-18，kisara 实测，codex 复现
- **问题：** v0.5 删除旧 admin room members 后，GUI/人类只有让 agent 自己 join 的路径，没有 `POST /rooms/:id/members` 把指定 agent 加入当前 room。
- **影响：** 创建协作 room 后无法主动组队，必须私聊/口头通知 agent 自己加入，体验断裂。
- **建议修复：** 增加 `POST /rooms/:id/members`，要求调用方能访问该 room，校验目标 agent 存在后幂等加入。
- **状态：** done（2026-05-18，codex 修复；`server.test.ts` 覆盖 human 拉 agent 入房）
- **计划版本：** v0.5 验收阻断

### 🔴 v2 spawned agent 串到旧版 Flock/旧库
- **发现于：** 2026-05-18，kisara 实测，codex 定位
- **问题：** v2 root `.mcp.json` 曾指向 `/Users/xxx/Code/workSpace/Agent-Larked/packages/mcp/dist/index.js` 和旧库 `/Users/xxx/Code/workSpace/Agent-Larked/data/agentfeed.db`，并写死 `AGENT_NAME`。Runtime spawned Claude 子进程因此在 v2 cwd 下连接旧版 MCP/旧库。
- **影响：** 新版 agent 会跑到旧版协作房间发言，污染旧版协作总线，也无法验证 v2 隔离。
- **建议修复：** `.mcp.json` 指向 v2 MCP dist 和 v2 DB，设置 v2 专用 `FLOCK_HOME`，移除硬编码 `AGENT_NAME`，让 Runtime 通过 env 注入当前 agent identity/token；增加配置校验脚本。
- **状态：** done（2026-05-18，cc002 修复；codex 复验 `.mcp.json` 已指向 v2 path/v2 DB/v2 FLOCK_HOME）
- **计划版本：** v0.5 验收阻断
