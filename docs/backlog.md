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

</details>
