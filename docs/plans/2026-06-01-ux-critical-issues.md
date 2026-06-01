# 2026-06-01 UX 关键问题 — 端到端协作测试反馈

> **发现于：** 2026-06-01，kisara 首次完整端到端协作测试（5 agent 同时工作）
> **状态：** open — 待规划修复
> **严重程度：** 整体产品可用性受阻

---

## 问题总览

| # | 问题 | 严重度 | 分类 |
|---|---|---|---|
| 1 | Agent 工作过程完全不可见 | 🔴 阻断 | 可观测性 |
| 2 | Agent 状态显示不准确 | 🔴 阻断 | 可观测性 |
| 3 | Agent 完成后无通知 | 🔴 阻断 | 可观测性 |
| 4 | 任务编排形同虚设 | 🔴 阻断 | 编排 |
| 5 | Agent 配置完全不可用 | 🟡 重要 | 配置 |
| 6 | 工作流页面无实际价值 | 🟡 重要 | 可观测性 |
| 7 | 广播唤醒只叫醒一个人 | 🟡 重要 | 唤醒 |
| 8 | 无法中途干预/对话 agent | 🟡 重要 | 编排 |
| 9 | 上下文压缩状态不可见 | 🟢 改进 | 可观测性 |

---

## 问题详情

### 1. 🔴 Agent 工作过程完全不可见

**现象：** agent 启动后，用户完全不知道它在做什么。不像终端里开一个 Claude Code session 能实时看到思考、工具调用、文件读写。在平台上，agent 就是一个黑盒——启动了，然后要么很久以后发一条消息，要么死了。

**期望：** 用户应该能看到 agent 的实时活动流，类似终端输出：
- 正在读哪个文件
- 正在调什么工具
- 思考中的文字
- API 调用状态

**影响：** 用户无法判断 agent 是在正常工作还是卡死了，无法提前发现问题，无法信任 agent 自主工作。

**建议方案：**
- **短期：** 在 agent 详情页/房间侧边栏显示实时活动流（tool_use 事件 → 人类可读描述）
- **中期：** 类似终端的实时输出面板，显示 SDK stream-json 的 text/tool_use/thinking 事件
- **数据源：** `agent-runner-v2.ts` 的 `for await (const message of result)` 已经在接收所有事件，需要把中间事件（不只是 init 和 result）持久化并通过 SSE 推送给前端

---

### 2. 🔴 Agent 状态显示不准确

**现象：**
- agent 正在工作 → 前端显示"启动中"（spawning）
- agent 已经死了/完成了 → 前端显示"Dormant"
- 用户无法区分"正在干活"、"空闲等待"、"已经死了"

**根因：** 状态模型过于简单，缺少关键状态：
- `spawning` = 正在启动 SDK 进程（很短暂）
- `active` = SDK 已初始化，正在处理（但前端可能没刷新）
- `dormant` = 已完成/已停止（语义模糊——是"可以唤醒的空闲"还是"已经死了"？）

**期望状态模型：**
| 状态 | 含义 | 视觉表现 |
|---|---|---|
| `spawning` | SDK 进程启动中 | 蓝色脉冲 |
| `working` | 正在执行任务（有工具调用） | 绿色旋转 |
| `idle` | 空闲等待（flock_wait 中） | 绿色常亮 |
| `completed` | 任务完成 | 灰色✓ |
| `error` | 出错退出 | 红色✗ |
| `stopped` | 被手动停止 | 灰色■ |

**建议修复：**
- 细化状态：从 SDK 事件流推断 working/idle/completed
- 前端状态指示器实时刷新（SSE `agent_status` 事件）
- Dormant 改为明确的 completed/error/stopped

---

### 3. 🔴 Agent 完成后无通知

**现象：** agent 干完了活，用户完全不知道。没有消息提示、没有红点、没有声音。用户必须手动刷新页面才能看到结果。

**期望：**
- agent 完成任务时，页面内弹出通知（toast/in-app notification）
- 侧边栏 agent 头像显示红点（未读活动）
- 浏览器通知（如果用户授权）
- 房间有新消息时，房间名显示未读数

**建议修复：**
- **P0：** 房间未读数徽章（Sidebar 房间列表）
- **P0：** agent 完成时 in-app toast 通知
- **P1：** agent 头像红点（有新活动）
- **P2：** 浏览器 Notification API

---

### 4. 🔴 任务编排形同虚设

**现象：**
- 创建了任务，但主 agent 不会自动认领
- 必须手动指定分配给谁
- 分配后无法和 agent 对话（无法追问、修改、追加指令）
- 任务完成后没有反馈回路

**期望：**
- 创建任务后，agent 应该能自动看到并认领（或由系统分配）
- 用户应该能随时给 agent 发消息（追加指令、修改需求）
- 任务状态变化应该实时同步给用户
- agent 完成任务后应该自动汇报

**建议方案：**
- **任务 → Room 联动：** 创建任务时自动创建对应 Room，agent 在 Room 内汇报进度
- **自动认领：** 基于 agent capabilities 的匹配 + 抢占式认领
- **持续对话：** 用户可以在任务 Room 内随时发消息给 agent
- **任务生命周期：** created → assigned → in_progress → review → done，每步都有通知

---

### 5. 🟡 Agent 配置完全不可用

**现象：** 无法配置 agent 的：
- 人格（system prompt、角色定义）
- 工具权限（哪些工具可用）
- MCP 工具配置（连接哪些 MCP server）
- 模型选择（用哪个模型）
- 温度、max_tokens 等参数

**期望：** 每个 agent 应该有独立的配置页面，可以设置：
- 名字、头像、Bio
- System prompt / 角色描述
- 可用工具列表
- MCP server 配置
- 模型 + 参数

**建议方案：**
- Agent 配置存储在 `agent_configs` 表（已有）
- GUI AgentPage 增加"配置"标签页
- 配置变更后下次 spawn 生效
- 预设模板（Code Reviewer、PM、Designer 等）

---

### 6. 🟡 工作流页面无实际价值

**现象：** 工作流页面只显示原始元数据——"agent 启动了"、"agent 死了"。对用户毫无帮助。

**期望：** 工作流页面应该显示**概括性信息**：
- 每个 agent 今天做了什么（一句话总结）
- 任务进度（完成了几个任务、当前在做什么）
- Token 消耗统计
- 错误/警告汇总

**建议方案：**
- 从 agent_activity_logs 和 messages 聚合生成摘要
- 用 LLM 自动生成每日/每周 agent 工作摘要
- 卡片式布局：每个 agent 一张卡片，显示最近活动 + 关键指标

---

### 7. 🟡 广播唤醒只叫醒一个人

**现象：** 用户发消息没有 @mention 任何人（意图是唤醒所有人），但只有一个人回复了。

**根因：** 需要排查 broadcast wake 逻辑。当前 human 消息应该触发 `wakeRoomAgents()` 唤醒所有 dormant agent，但可能：
- 部分 agent 已经是 active 状态（被跳过）
- 部分 agent 的 spawn 记录有问题（找不到 runtime）
- API 429 限流导致部分 wake 失败

**建议修复：**
- 排查 wake 逻辑，确保 human 消息确实唤醒所有 dormant agent
- 前端显示 wake 结果（成功唤醒几个、失败几个、原因）
- 考虑增加"@everyone" 显式广播指令

---

### 8. 🟡 无法中途干预/对话 agent

**现象：** agent 启动后，用户无法给它发消息、追加指令、修改需求。只能等它完成或手动停止。

**期望：** 用户应该能随时给正在工作的 agent 发消息：
- 追加指令："顺便也检查一下安全性"
- 修改需求："不要用 TypeScript，用 JavaScript"
- 询问进度："你现在做到哪了？"
- 紧急停止："停下来"

**建议方案：**
- agent 工作时保持 Room 消息通道可用
- 用户发消息 → 通过 SDK 的 stdin 或 abort+restart 注入新上下文
- 或者：agent 定期检查 Room 新消息（在工具调用间隙）
- 停止按钮：已有，但需要确认对话（防止误操作）

---

### 9. 🟢 上下文压缩状态不可见

**现象：** agent 的上下文长度、是否触发了压缩、当前 token 使用量——这些信息完全看不到。

**期望：** 在房间标题栏（agent 头像旁边）实时显示：
- 当前上下文 token 数 / 最大上下文
- 是否已触发压缩
- 本轮对话的 token 消耗

**数据源：** SDK 的 `message.usage` 字段包含 token 使用信息

---

## 修复计划建议

### Phase 1：可观测性（最高优先级）
1. Agent 实时活动流（tool_use → 人类可读描述）
2. 房间未读数徽章
3. Agent 状态细化（working/idle/completed/error）
4. Agent 完成通知（in-app toast）

### Phase 2：编排与控制
5. 任务 → Room 联动
6. 中途对话能力
7. 广播唤醒修复
8. Agent 配置页面

### Phase 3：增强体验
9. 工作流摘要页面
10. 上下文状态显示
11. 浏览器通知
12. Agent 配置模板

---

## 附录：当前状态模型 vs 期望状态模型

### 当前（过于简单）
```
spawning → active → dormant/error
                     ↓
                   stopped
```

### 期望（用户可理解）
```
spawning → working ⇄ idle → completed
              ↓                  ↓
            error             stopped
              ↓
           retrying
```

- `working` = agent 正在执行工具/推理（有 SDK 事件流活动）
- `idle` = agent 调用了 flock_wait，等待新消息
- `completed` = agent 正常完成任务
- `error` = agent 遇到不可恢复错误
- `stopped` = 被用户手动停止
- `retrying` = 自动重试中（如 429 限流）
