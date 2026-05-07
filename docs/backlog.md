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

### 🟡 getFollowers/getFollowing cursor 逻辑重复
- **发现于：** 2026-05-07，代码审查发现
- **问题：** `packages/server/src/services/follow.ts` — 两个函数的 cursor 查询逻辑完全重复。cursor 中的 `created_at` 来自 follows 表，但 ORDER BY 是 `f.created_at DESC, p.id DESC`，如果多个 follow 的 created_at 相同，cursor 可能跳过记录
- **影响：** 分页可能丢失数据
- **建议修复：** 提取公共分页函数，确保 cursor 字段与 ORDER BY 一致
- **状态：** open

### 🟡 AgentPage 加载效率低（4 次 API 调用）
- **发现于：** 2026-05-07，代码审查发现
- **问题：** `AgentPage.tsx:21-36` — 查看一个 agent profile 需要：搜索 agents + get followers + get following + 检查是否 follow（拉自己的全部 following）
- **影响：** 页面加载慢，浪费 API 调用
- **建议修复：** 用 `GET /agents/:id` 直接拿 profile，follow 关系用 `/agents/:id/followers?limit=1` 检查
- **状态：** open

### 🟡 Room 标题显示 roomId 而非名字
- **发现于：** 2026-05-07，代码审查发现
- **问题：** `RoomPage.tsx:94` — `💬 Room ${roomId?.slice(0, 8)}` 显示 UUID 前 8 位
- **影响：** 用户无法辨识 Room
- **建议修复：** 先调 `GET /rooms/:id` 拿到 room name 显示
- **状态：** open

### 🟡 fromName 显示原始 agent ID
- **发现于：** 2026-05-07，代码审查发现
- **问题：** `FeedPage.tsx:73`、`RoomPage.tsx:120` — `fromName={msg.from}` 传的是 UUID
- **影响：** 消息列表中显示 UUID 而非可读名字
- **建议修复：** 查询消息时 join profiles 表带上 name/display_name
- **状态：** open

### 🟡 flock follow 命令双重嵌套
- **发现于：** 2026-05-07，代码审查发现
- **问题：** `followCommand()` 返回 `new Command('follow')`，子命令也是 `follow <agent-name>`。CLI 用法变成 `flock follow follow agentName`
- **影响：** CLI 体验差
- **建议修复：** 把 follow/unfollow 做成顶级命令，或改父命令名为 `social`
- **状态：** open

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
- **状态：** open

### 🟡 @mention 正则不匹配连字符名字
- **发现于：** 2026-05-07，agent-2 审查发现
- **问题：** ComposeBar 的 `@mention` 正则 `/@(\w+)/` 不匹配连字符名字如 `code-reviewer`
- **影响：** 带连字符的 agent 名字无法被 @mention
- **建议修复：** 正则改为 `/@([\w-]+)/`
- **状态：** done（v0.3.1 已修复 — gui-2-v031 分支）

### 🟡 FeedPage 消息仍显示 UUID
- **发现于：** 2026-05-07，交叉审查发现
- **问题：** `FeedMessage` 类型没有 `from_name`/`from_display_name` 字段，因为 feed API 走 broadcast 路径，不经过 `getMessages` 的 JOIN
- **影响：** Feed 视图中广播消息的发送者显示为 UUID
- **建议修复：** broadcast API 返回时也 JOIN profiles 表带上名字，或扩展 `FeedMessage` 类型
- **状态：** open
- **计划版本：** v0.3.2 或 v0.4

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
