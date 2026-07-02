# Backlog — 待实现 / 待修复

> **所有 agent 必读。** 任何在开发、测试、审查中发现的问题、需求、改进点，都必须记录到这个文件。

## 格式

```markdown
### [优先级] 标题
- **发现于：** 日期 + 发现者
- **问题：** 具体描述
- **影响：** 谁受影响、影响多大
- **建议修复：** 怎么修
- **状态：** open / in-progress / done
```

优先级：🔴 阻断 / 🟡 重要 / 🟢 改进

---

## 2026-06-30 per-room cwd + room rules + room-inbox 修正

### ✅ mcp lifecycle 测试预存在失败(online/offline vs active/dormant)
- **发现于：** 2026-06-30,全量测试核实
- **问题：** `mcp/lifecycle.test.ts` 的 setAgentOnline/setAgentOffline 断言 status='online'/'offline',实际是 'active'/'dormant'。在 `af7bb53`(本次工作之前)就已失败
- **根因：** `647f295 fix(mcp): use valid agent status values` 把状态值改成 active/dormant 后,该测试未同步更新
- **修复：** 测试断言改为 active/dormant。mcp 65/65 绿
- **状态：** done

### ✅ wake-callback 测试预存在失败(session_id resume)
- **发现于：** 2026-06-30,cwd/room-rules 实现期间核实
- **问题：** `wake-callback.test.ts > wakes a mentioned dormant agent...` 断言 `session_id` = 'previous-claude-session',实际 undefined。在 `af7bb53` 就已失败
- **根因:** 测试 fixture 用 `session_source='claude-cli'`(pre-migration 旧值),但 `latestClaudeSessionId` 只 resume `'agent-harness'` 源的 spawn;且后续断言新 spawn 的 source 也是 'claude-cli',而 createWakeSession 实际写 'agent-harness'
- **修复:** fixture + 断言改为 'agent-harness'(代码实际使用的源)。server 163/163 绿
- **状态：** done

### 🟢 inbox 注入 ↔ flock_wait 去重(治本,跨进程游标)
- **发现于：** 2026-06-30,room-inbox 修正
- **问题：** 忙碌 agent 经 inbox 收到 room 消息后,flock_wait 仍会返回同一条
- **纠正先前建议：** backlog 早先写"更新 agent_room_state.last_seen_sequence"——**经核实无效**:flock_wait 用的是 MCP 进程内存 Map `roomSequences`(subscribe.ts),不读 DB 的 last_seen_sequence。已用 message_id 去重提示缓解(模型侧)。治本需统一跨进程游标,改造大
- **状态：** open

### 🟢 同 room 连续消息合并为单条 digest
- **发现于：** 2026-06-30
- **问题：** 同 room 多条消息每条一个 digest 条目
- **建议修复：** 合并为 "#room: N 条新消息, 最新: ..."
- **状态：** open

### 🟢 rooms.workspace 路径安全校验
- **发现于：** 2026-06-30,per-room cwd 实现
- **问题：** rooms.workspace 是用户可填的任意相对路径(绝对路径直接用)。无校验,可能指向敏感目录
- **影响：** 低(workspace 在 runtime 本机 PROJECT_ROOT 下解析,相对路径受限),但绝对路径无限制
- **建议修复：** server 侧或 runtime 侧加路径白名单/禁止逃逸 PROJECT_ROOT
- **状态：** open

### 🟢 workspace 目录不随 room 删除清理
- **发现于：** 2026-06-30
- **问题：** data/workspaces/rooms/<id> 在 room 删除时不清理(ON DELETE CASCADE 只删 DB)
- **建议修复：** room 删除时清 workspace 目录,或加 GC
- **状态：** open

---

## 2026-06-30 Room 消息注入 + 待办

### 🟢 room 消息注入可能与 flock_wait 重复通知
- 忙碌 agent 收到 room 消息后，inbox 注入一次（delivered=1）。但如果 agent 之后调 flock_wait，flock_wait 也会返回同一条消息（通过 DB 轮询），agent 可能重复处理
- 后续：enqueue 前检查 agent_room_state.last_seen_sequence，或在 flock_wait 里跳过已 delivered 的 pending_messages
- 状态：open

### 🟢 room 消息注入无去重/合并
- 同一个 room 连续多条消息，每条都单独入 inbox，agent 可能收到多个 digest 条目
- 后续：同一 room 的多条消息合并成一条 digest（带计数 + 最新 excerpt）
- 状态：open

---

## 2026-06-17 工具边界注入 + 待办队列

### 🟢 hook 每个工具边界 spawn node 进程的开销
- PostToolUse hook 每次工具调用都 spawn 一个 node 脚本查 DB，高频工具调用有进程开销
- 后续：hook 脚本极简化 / 加节流(N 秒内最多注入一次)
- 状态：open

### 🟢 inbox 消息无 TTL / 上限
- pending_messages 只在注入时置 delivered，不清理。大量消息可能堆积
- 后续：已 delivered 的定期清理 / 每 agent 上限
- 状态：open

### 🟢 todo 优先级由模型自评，可能不准
- priority 是模型自填，无外部校准
- 后续：可让发送者标记紧急度影响初始 priority
- 状态：open

### 🟢 注入 digest 的 token 成本
- 每个工具边界都注入 inbox+todo 摘要，长会话累积 token
- 已用 delivered 去重消息；todo 持续注入是有意的(回查机制)
- 后续：todo 数量大时只注入 top-N + 计数
- 状态：open

---

## 2026-06-16 DM/消息可见性修复发现

### 🟡 MCP lifecycle.test.ts 测试与代码不匹配
- **发现于：** 2026-06-16，A4 修复时
- **问题：** lifecycle.test.ts 断言 status 为 `'online'`/`'offline'`，但 db.ts 代码写 `'active'`/`'dormant'`
- **影响：** 2 个测试永久失败（pre-existing）
- **建议修复：** 更新测试期望值为 `'active'`/`'dormant'`
- **状态：** open

### 🟡 wake-callback.test.ts 3 个测试失败
- **发现于：** 2026-06-16，A13 修复时
- **问题：** session_id 断言、超时、301 redirect — 均为 pre-existing
- **影响：** 测试套件不全绿
- **建议修复：** 逐个排查修复
- **状态：** open

### 🟢 [deleted]/system 等保留 profile 出现在列表
- **发现于：** 2026-06-16，排查时发现
- **问题：** profiles 表有 [deleted]/system 行，前端是否过滤待确认
- **状态：** open

### 🟢 emitDirectMessage 广播给所有 human 客户端
- **发现于：** 2026-06-16，A9 修复时
- **问题：** 当前 emitDirectMessage 给所有 humanClients 推送，前端需按 from/to 过滤自己的会话
- **影响：** 多个 human 在线时会收到不属于自己的 DM 事件（前端已过滤，但浪费带宽）
- **建议修复：** 后端按 recipient 的 humanId 精准推送，而非广播
- **状态：** open

---

## v0.6 — UX 补全（2026-06-01 kisara 端到端测试反馈）

> 详细文档：`docs/plans/2026-06-01-ux-critical-issues.md`

### 🔴 Agent 工作过程完全不可见
- **发现于：** 2026-06-01，kisara 5 agent 协作测试
- **问题：** agent 启动后是黑盒，用户不知道它在读什么文件、调什么工具、思考什么。不像终端能实时看到
- **影响：** 无法判断 agent 是正常工作还是卡死，无法信任 agent 自主工作
- **建议修复：** SDK 事件流（tool_use/text/thinking）实时推送到前端，显示人类可读活动描述
- **状态：** open

### 🔴 Agent 状态显示不准确
- **发现于：** 2026-06-01，kisara 实测
- **问题：** agent 正在工作 → 显示"启动中"；agent 死了 → 显示"Dormant"。无法区分 working/idle/completed/error
- **影响：** 状态指示器完全误导用户
- **建议修复：** 细化为 spawning/working/idle/completed/error/stopped，前端实时刷新
- **状态：** open

### 🔴 Agent 完成后无通知
- **发现于：** 2026-06-01，kisara 实测
- **问题：** agent 干完活没有任何提示。没有 toast、没有红点、没有声音
- **影响：** 用户必须一直盯着页面
- **建议修复：** 房间未读数徽章 + agent 完成 toast + agent 头像红点
- **状态：** open

### 🔴 任务编排形同虚设
- **发现于：** 2026-06-01，kisara 实测
- **问题：** 创建任务后 agent 不自动认领；必须手动分配；分配后无法对话；没有反馈回路
- **影响：** 任务系统和 agent 系统完全割裂
- **建议修复：** 任务→Room 联动、自动认领、持续对话、任务生命周期通知
- **状态：** open

### 🟡 Agent 配置完全不可用
- **发现于：** 2026-06-01，kisara 实测
- **问题：** 无法配置 agent 人格、工具权限、MCP 工具、模型选择、参数
- **影响：** 所有 agent 都是相同配置，无法差异化
- **建议修复：** AgentPage 配置标签页，支持 system prompt、工具列表、MCP 配置、模型参数
- **状态：** open

### 🟡 工作流页面无实际价值
- **发现于：** 2026-06-01，kisara 实测
- **问题：** 只显示原始元数据（agent 启动/死了），不显示概括性信息
- **影响：** 页面占空间但无信息量
- **建议修复：** 聚合生成 agent 工作摘要、任务进度、Token 消耗
- **状态：** open

### 🟡 广播唤醒只叫醒一个人
- **发现于：** 2026-06-01，kisara 实测
- **问题：** 不 @mention 任何人时应该唤醒所有人，但只有一个人回复
- **影响：** 广播功能不可靠
- **建议修复：** 排查 wake 逻辑 + 前端显示 wake 结果
- **状态：** open

### 🟡 无法中途干预/对话 agent
- **发现于：** 2026-06-01，kisara 实测
- **问题：** agent 启动后无法发消息、追加指令、修改需求
- **影响：** 用户对 agent 完全失去控制
- **建议修复：** 保持 Room 消息通道可用，agent 在工具调用间隙检查新消息
- **状态：** open

### 🟢 上下文压缩状态不可见
- **发现于：** 2026-06-01，kisara 实测
- **问题：** agent 上下文长度、是否压缩、token 使用量看不到
- **影响：** 用户不知道 agent 上下文是否够用
- **建议修复：** 房间标题栏显示上下文 token 数 / 压缩状态
- **状态：** open

---

## v0.5 遗留技术问题

### 🟡 Agent SDK session resume + MCP 状态待验证
- **发现于：** 2026-05-15，v0.5 提案讨论
- **问题：** `query({ resume })` 是否正确重载 MCP 工具状态？需要 PoC 验证
- **状态：** open

### 🟡 API key 管理方案待定
- **发现于：** 2026-05-15，v0.5 提案讨论
- **问题：** MVP 每个 runtime 设环境变量，集中管理延后
- **状态：** open

### 🟡 Session 本地性限制
- **发现于：** 2026-05-15，v0.5 提案讨论
- **问题：** Session 存在 runtime 机器上，跨 runtime 迁移需要共享文件系统
- **状态：** open

### 🟡 broadcast wake 语义未确认
- **发现于：** 2026-05-17，ring 2 review
- **问题：** human 消息 = 唤醒全部 dormant agent？还是只唤醒 @mention 的？设计意图不明确
- **状态：** open

### 🟢 Runtime 注册权限未限制
- **发现于：** 2026-05-17，ring 2 review
- **问题：** 任何 agent 都能注册 runtime，后续可能需要 owner 级别权限
- **状态：** open

### 🟢 CORS 设为 * 在生产环境不安全
- **发现于：** 2026-05-17，ring 4 review
- **问题：** `Access-Control-Allow-Origin: *` 生产环境需要收紧
- **状态：** open

### 🟡 Backend Registry cache TTL 敏感
- **发现于：** 2026-06-01，code review
- **问题：** 30 分钟 TTL 意味着 API key 轮换后旧 key 仍可用 30 分钟
- **状态：** open

### 🟡 OpenAICompatBackend tool executor 未实现
- **发现于：** 2026-06-01，code review
- **问题：** `createToolExecutor()` 永远抛 "Tool not implemented"，OpenAI 后端调工具必崩
- **状态：** open（当前只用 ClaudeSdkBackend，不影响运行）

### 🟡 estimateCost 精度太低
- **发现于：** 2026-06-01，code review
- **问题：** 平均 input/output token 价格，误差 2-5x。应分开计算
- **状态：** open

### 🟡 readSSEStream 不支持多行 data
- **发现于：** 2026-06-01，code review
- **问题：** SSE spec 允许多行 data 字段，当前只处理单行
- **状态：** open

---

## 已完成归档

<details>
<summary>v0.1 ~ v0.5 已完成的问题（点击展开）</summary>

### v0.1（2026-05-05）
- ✅ 缺少 GET /rooms 端点
- ✅ 服务器默认内存数据库
- ✅ 缺少 GET /rooms/:id/members
- ✅ agent profile 不返回 token
- ✅ CLI 缺少 flock whoami
- ✅ CLI flock room list 语义歧义

### v0.1.2（2026-05-05）
- ✅ 产品名 Lark→Flock 全局重命名

### v0.2（2026-05-06）
- ✅ agent 无法感知新消息（MCP Server + flock_wait）
- ✅ MCP server 要求手动配置 AGENT_ID
- ✅ 自动生成的 agent 名字不可读
- ✅ 工具描述缺少协作工作流指引

### v0.3（2026-05-07~10）
- ✅ Agent 页面点击报 "Agent not found"
- ✅ GUI 无法发送消息
- ✅ Agent 注册默认 offline
- ✅ Agent 上线无 SSE 通知
- ✅ 消息顺序反直觉
- ✅ @mention 无自动补全
- ✅ 消息中不显示 agent display_name
- ✅ @mention 发送报错 "not found"
- ✅ Agent 回复不实时出现
- ✅ 进入房间消息从顶部落到底部
- ✅ 私密 Room 消息无权限校验
- ✅ invitesRouter 重复挂载
- ✅ ThreadView reply_to 挂在错误消息
- ✅ broadcast/follow/invite 不发 SSE 事件
- ✅ FeedPage 没有 SSE 订阅
- ✅ 虚拟 broadcast room 污染 room 列表
- ✅ 所有 catch 块静默吞错误
- ✅ @mention 正则不匹配连字符名字
- ✅ online 语义误把 MCP 进程存活当 agent 可触达
- ✅ Web GUI 缺少人类可操作的 Agent CRUD / 登录入口
- ✅ Command Center 与 Room 发消息重复
- ✅ Agent Admin RBAC
- ✅ 缺少默认 admin agent
- ✅ 工作中的 agent 收不到 direct @mention 边界提醒
- ✅ GUI SSE 重连后 Room 订阅丢失

### v0.4（2026-05-12）
- ✅ Task + Artifact Foundation

### v0.5（2026-05-17~06-01）
- ✅ v0.5 缺列 migration 导致 Server 启动崩溃
- ✅ Vite proxy 缺少 v0.5 新增路由
- ✅ Runtime stale online 导致 spawn/wake 假成功
- ✅ @mention/broadcast wake callback 类型不匹配
- ✅ Dormant wake 状态模型矛盾
- ✅ Runtime runner 未实现 Agent SDK query()
- ✅ Runtime 身份/状态回写不可靠
- ✅ WakePage 调用不存在的 endpoint
- ✅ SpawnModal 目标 Room 被忽略
- ✅ Runtime/Workflow 页面硬编码假端口
- ✅ Root npm run typecheck 失败
- ✅ README/API/Schema 文档混有旧系统
- ✅ v2 root 缺少 DESIGN.md
- ✅ spawn room_id 未实现
- ✅ v0.5 GUI 私聊缺 idempotency key
- ✅ v0.5 人类无法把 agent 拉进 Room
- ✅ v2 spawned agent 串到旧版
- ✅ FeedPage 依赖已删除的 broadcast 系统
- ✅ callback 错误被静默吞掉
- ✅ human 消息 idempotency_key 用 Date.now()
- ✅ callback URL 拼接未处理 trailing slash
- ✅ HTTP transport session 无 TTL 清理
- ✅ GET /agents 返回人类 profile
- ✅ Runtime 后端抽象层（ClaudeSdkBackend + OpenAICompatBackend）
- ✅ Session 内存泄漏
- ✅ env/provider 丢失
- ✅ SDK 类型不安全断言

### v0.5.1 — stdio backend migration follow-ups（2026-06-16）

### 🟡 ClaudeStdioBackend 集成测试（真实 claude CLI）
- **发现于：** 2026-06-16，stdio migration（计划 §8 验收标准）
- **问题：** 当前测试用 mock child_process.spawn，无真实 CLI 调用；claude 2.1.178 验证的 wire 格式可能在未来版本变化
- **影响：** 回归漏检窗口
- **建议修复：** 加 `__tests__/claude-stdio-integration.test.ts`，设 `CLAUDE_CLI_PATH` 环境变量，跳过条件 `if (!process.env.CLAUDE_CLI_PATH) skip`；验证 init/text/result 帧可正确解析
- **状态：** open

### 🟡 CLAUDE_CLI_PATH 配置文档
- **发现于：** 2026-06-16，stdio migration
- **问题：** ClaudeStdioBackend 默认用 `claude` bin（process.env.CLAUDE_CLI_PATH ?? 'claude'），但无 README 说明如何在非默认路径安装的环境下配置
- **建议修复：** 在 packages/runtime/README.md（或 root README）补 CLAUDE_CLI_PATH 配置说明
- **状态：** open

### 🟢 stream-json 未知 content block 类型告警
- **发现于：** 2026-06-16，stdio migration
- **问题：** translateContentBlock 遇到未知 type（如 image_url）静默返回 null；生产出现新 block 类型时无日志
- **建议修复：** 在 default 分支加 `console.warn('[stream-json] unknown block type:', block.type)` 
- **状态：** open

### 🟢 control_request 非 can_use_tool 类型处理
- **发现于：** 2026-06-16，stdio migration
- **问题：** buildControlAllow 只处理 `can_use_tool` subtype；若 claude CLI 未来新增其他 control_request subtype，当前代码会为其发送 allow，语义可能不正确
- **建议修复：** control_request 处理前检查 subtype，未知类型记录告警而非自动 allow
- **状态：** open

### 🟢 Claude SDK Bug #3（已修）归档说明
- `buildMcpServers` 中 raw `process.env` 展开向 MCP 子进程泄漏了 CLAUDECODE/CLAUDE_CODE_* env key（C54 已修）
- 若未来新增 CLAUDECODE_* 前缀的内部 env key，`isInternalClaudeEnvKey` 会自动过滤

### ✅ claude-sdk.ts stripEffortEnv 不完整（已修）
- **发现于：** 2026-06-16，Code Reviewer 代码审查
- **修复于：** 2026-06-16，commit 6a50d74 — 替换为 stripInternalEnv，复用 isInternalClaudeEnvKey

### ✅ ClaudeStdioBackend child.pid 为 undefined 时 pending:undefined key 冲突（已修）
- **发现于：** 2026-06-16，Code Reviewer 代码审查
- **修复于：** 2026-06-16，commit 6a50d74 — 使用 randomUUID() fallback

### 🟡 ClaudeStdioBackend abort(sessionId) 在 init 事件到达前是 no-op
- **发现于：** 2026-06-16，Code Reviewer 代码审查（两轮独立审查均发现）
- **问题：** exec() 启动到第一个 init 事件之间，map key 为 `pending:${pid}`；此时调用 `abort(realSessionId)` 静默失效（ctx.signal abort 路径仍然有效）
- **影响：** 前 ~100ms 内通过 backend.abort(sessionId) 直接中止会失效
- **建议修复：** 在 abort() 中支持扫描 pending 前缀，或在 exec() 入口就接受 session id 预注册
- **状态：** open

### 🟡 tool_result.content 为数组时被序列化为 JSON 字符串（stdio+sdk 两条路径均有）
- **发现于：** 2026-06-16，Code Reviewer 代码审查
- **问题：** `translateContentBlock`（claude-sdk.ts:244）和 `stream-json.ts`（:157）中，`tool_result` 的 `content` 字段为 `ContentBlock[]` 时被 `JSON.stringify` 序列化为字符串传给消费方，而不是提取文本内容
- **影响：** 多模态 tool_result 下游收到 JSON 字符串而非文本，行为不符合预期
- **建议修复：** 检测 content 为数组时提取第一个 text block 的文本，或将 ToolResultEvent.content 改为 `string | ContentBlock[]`
- **状态：** open

### 🟢 claude-sdk.ts SSE transport command: '' placeholder 可能触发 SDK 校验错误
- **发现于：** 2026-06-16，Code Reviewer 代码审查
- **问题：** `buildMcpServersConfig` 中 SSE transport 写入 `command: ''`，SDK 可能不接受空 command 字段与 url 字段共存
- **建议修复：** 确认 SDK 对 SSE transport 的期望格式，移除不需要的 `command: ''` 字段
- **状态：** open

### 🟢 toAbortController 在正常完成时不移除 abort listener（claude-sdk.ts）
- **发现于：** 2026-06-16，Code Reviewer 代码审查
- **问题：** 父 signal 上的 `{ once: true }` listener 在正常完成时不会移除，长期存活的父 signal 上会积累 listener
- **影响：** 低优先级；只在父 signal 生命周期长（如 room-wide signal）时才有影响
- **建议修复：** 正常完成时主动移除 listener，或改为 scoped AbortController
- **状态：** open

### 🟢 stderr tail 含 ANSI 转义码影响日志可读性（claude-stdio.ts）
- **发现于：** 2026-06-16，Code Reviewer 代码审查
- **问题：** claude CLI stderr 可能包含 ANSI 颜色码，直接拼入错误消息在日志中产生乱码
- **建议修复：** 在 stderrTail 写入错误消息前做简单的 ANSI strip（正则 `/\x1b\[[0-9;]*m/g`）
- **状态：** open

### 🟢 resolvePermissionMode 将 ask 静默降级为 bypassPermissions（claude-sdk.ts）
- **发现于：** 2026-06-16，Code Reviewer 代码审查
- **问题：** `'ask'` 降级到 `'bypassPermissions'` 只打 warn，调用方没有程序性反馈；语义从"限制"降到"最宽"，是安全语义降级
- **建议修复：** 在接口注释中明确文档化此行为；考虑是否应抛出异常让调用方显式处理
- **状态：** open

</details>

---

## 2026-07-02 — Per-agent MCP + Skills 后续

### 🔴 项目无 admin 强制,文档与代码不一致(预存问题,本次确认)
- **发现于：** 2026-07-02,per-agent skills/mcp 计划(计划 E1 核实)
- **问题：** `docs/progress.md` 与 `db.ts:531` 注释声称 v0.3.5 已实现 admin RBAC(`profiles.is_admin = 1`),但实际 `profiles` schema(db.ts:8-22)**无 `is_admin` 列**,`bootstrapDefaultAgent` 不写该列,路由/middleware 无任何 admin 强制。`test-helpers.ts:17` 的 `WHERE is_admin = 1` 查询是死代码(无测试 import),运行即抛 "no such column"。admin 概念仅存于文档叙述。
- **影响：** 任何声称 admin-only 的接口实际无鉴权。本次 M0 `PATCH /configs/global` 退化为 human-only(任何 human 可改全局)。
- **建议修复:** `profiles` 表加 `is_admin INTEGER DEFAULT 0` 列(v0.5+ 迁移),`bootstrapDefaultAgent` 给 kisara 置 1,middleware 加 admin 校验,`PATCH /configs/global` 改 admin-only;或用 env `FLOCK_GLOBAL_CONFIG_ALLOWED_USERNAMES` 白名单。同步修正 test-helpers.ts 死代码。
- **状态:** open

### 🟡 per-agent MCP RCE 面 + 越权面
- **发现于:** 2026-07-02,per-agent mcp 实现(M2)
- **问题:** (1) per-agent MCP command = runtime 主机 RCE,门控 `FLOCK_PER_AGENT_MCP` 默认关闭已加,但未做 command/args 白名单、env secrets 明文存储。(2) **越权面独立存在:** `configs.ts` PATCH `/configs` 的 `resolveConfigAgentId`(configs.ts:126-142)允许任意 human 给任意 agent 写 config(agent_configs),本次未修。
- **建议修复:** command/args 白名单;env secrets 加密存储;`resolveConfigAgentId` 对 human 写他人 agent config 加权限校验。
- **状态:** open

### 🟢 skills 物化 per-room 串味(W4)
- **发现于:** 2026-07-02,S5 物化实现
- **问题:** `sessionCwd` 是 per-room 共享,同 room 多 agent 的 skills 互相覆盖(最后 spawn 者生效)。当前 S5 清空目录后写,缓解了"旧 skill 残留"但没解决"同 room 多 agent 共存"。
- **建议修复:** S0 实测若证实 `<sessionCwd>/.claude/skills/<agentId>/<name>/` 子目录可被 claude 发现,迁移到 per-agent 子目录。否则明确文档"per-room 共享 skills"。
- **状态:** open

### 🟢 per-agent soul / agent_md 未接
- **发现于:** 2026-07-02,Phase B 边界
- **问题:** 本次只做 mcp + skills。`AgentConfigType` union 含 `soul`/`agent_md` 但未接入运行链路。
- **建议修复:** `composeSystemPrompt` 注入 soul/agent_md 段。
- **状态:** open

### 🟢 MCP 工具允许/禁止列表
- **发现于:** 2026-07-02,Phase A 边界
- **问题:** 当前所有 extra MCP server 的工具都暴露给 agent,无 per-agent 粒度裁剪。
- **建议修复:** per-agent allowedTools/deniedTools,claude-args 动态 `--disallowedTools`。
- **状态:** open

### 🟢 features flag endpoint(UI 无法感知 server flag)
- **发现于:** 2026-07-02,M9b/S7
- **问题:** UI 的 MCP/Skills 编辑卡片始终可编辑,但 server 仅在 `FLOCK_PER_AGENT_MCP=1`/`FLOCK_PER_AGENT_SKILLS=1` 时才透传/物化。flag 关闭时用户保存的配置不生效,UI 无提示。
- **建议修复:** `GET /configs/features` 返回 `{per_agent_mcp: bool, per_agent_skills: bool}`,前端据此禁用/隐藏卡片或显示"需 server 启用"badge。
- **状态:** open

### 🟢 Phase C — skills prompt 注入退路(未实现)
- **发现于:** 2026-07-02,计划 Phase C
- **问题:** 若 S0 实测发现 claude 不发现 `<sessionCwd>/.claude/skills/`(stdio 或 SDK 路径),则 S5 文件物化失效,需退路:在 `composeSystemPrompt` 注入 skills 段(Available skills + name + description + body)。
- **当前状态:** 未实现(S0 未跑)。S5 文件物化是主路径;若 S0 证伪再启 Phase C。注意:两者**不可同时启用**,否则 skills 双重注入。
- **状态:** open(条件性)

### 🟡 S0 / M10 / S8 手动端到端验证待跑
- **发现于:** 2026-07-02,计划验收
- **问题:** 计划的 S0(双 backend skills 发现实测)、M10(per-agent mcp 端到端)、S8(skills 端到端)是手动步骤不提交,本次未执行。代码链路完整且单测覆盖,但真实 claude CLI/SDK 行为未验证。
- **建议:** 启 server+runtime 导出 `FLOCK_PER_AGENT_MCP=1`/`FLOCK_PER_AGENT_SKILLS=1`,UI 配一个 echo MCP server + 一个 test-skill,触发 spawn,观察 `/tmp/flock-mcp-*/mcp-config.json` 含 flock+echo、`/mcp` 可见 echo 工具、claude 发现 SKILL.md。
- **状态:** open
