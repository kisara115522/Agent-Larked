# 计划：Agent SDK 集成 + 编排链路打通

> 目标：把 Runtime 从 CLI child process 切换到 Agent SDK `query()`，打通 编排 → Runtime → 任务 这条链路。
> 日期：2026-06-01
> 审查状态：有条件通过（3 个阻断问题已修正）

---

## 搜索发现（关键事实）

**包名**：`@anthropic-ai/claude-agent-sdk`（已从 `@anthropic-ai/claude-code` 改名）

**TypeScript `query()` API**：
```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

const result = query({
  prompt: "...",
  options: {
    allowedTools: ["Read", "Edit", "Bash", "Grep", "mcp__flock__"],  // mcp__flock__ 通配
    permissionMode: "bypassPermissions",  // daemon 场景：无条件批准
    allowDangerouslySkipPermissions: true, // bypassPermissions 必需
    abortController: abortController,      // 可中断
    resume: sessionId,                     // 恢复已有 session
    continue: true,                        // 恢复当前目录最近的 session
    mcpServers: {                          // 内联 MCP 配置
      "flock": {
        command: "node",
        args: ["packages/mcp/dist/index.js"],
        env: { DB_PATH: "/abs/path/agentfeed.db", AGENT_NAME: "xxx" }
      }
    },
    settingSources: [],  // SDK-only 模式，不读文件系统配置
  }
});

for await (const message of result) {
  // message.type === 'system' && message.subtype === 'init' → 拿 session_id
  // message.type === 'result' → 拿最终结果和 session_id
  // message.type === 'assistant' → agent 输出
}
```

**Session 管理**：
- `SDKSystemMessage`（`subtype === "init"`）有 `session_id` 字段
- `SDKResultMessage` 也有 `session_id` 字段
- `resume: sessionId` 恢复指定 session
- `continue: true` 恢复当前目录最近 session

**MCP 集成**：
- `mcpServers` 字段直接配置，SDK 自动启动 MCP server 进程
- `allowedTools` 用 `"mcp__flock__"` 通配符授权所有 flock 工具
- SDK 也可以读 `.mcp.json`，但 `settingSources: []` 时只用代码内配置

**Permission 模式**（审查修正）：
- `"auto"` — 用 model classifier 判断是否批准，**不是无条件批准**
- `"bypassPermissions"` — 无条件批准所有工具，适合 daemon 场景，需加 `allowDangerouslySkipPermissions: true`
- `"ask"` — 每次工具调用需人工确认

---

## 实施步骤

### Step 1：安装 SDK

```bash
npm install @anthropic-ai/claude-agent-sdk
```

在 `packages/runtime/package.json` 添加依赖。锁定版本号。

### Step 2：重写 `agent-runner.ts`

**核心改动**：把 `spawn('claude', ['-p', prompt])` 替换为 `query()` async generator。

**改造前**（当前）：
```typescript
const child = spawn('claude', ['-p', prompt, '--output-format', 'text'], { ... });
child.stdout?.on('data', (data) => { stdout += data.toString(); });
child.once('close', (code) => { /* 处理退出 */ });
```

**改造后**（审查修正：加了 cwd、bypassPermissions、AbortController、try/catch、model、env）：
```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";
import path from "node:path";

// monorepo 根目录（编译后在 packages/runtime/dist/，上溯 3 级）
const PROJECT_ROOT = path.resolve(__dirname, "../../..");
const MCP_PATH = path.resolve(PROJECT_ROOT, "packages/mcp/dist/index.js");
const DB_PATH = process.env.DB_PATH || path.resolve(PROJECT_ROOT, "data/agentfeed.db");

const abortController = new AbortController();
instance.abortController = abortController;

const result = query({
  prompt,
  options: {
    cwd: PROJECT_ROOT,                           // 确保相对路径解析正确
    allowedTools: ["Read", "Edit", "Bash", "Grep", "Glob", "WebFetch", "mcp__flock__"],
    permissionMode: "bypassPermissions",          // daemon：无条件批准
    allowDangerouslySkipPermissions: true,         // bypassPermissions 必需
    abortController,                              // stop() 时可中断
    model: instance.options?.model,               // 透传 model
    env: provider?.env                            // 透传 provider 环境变量
      ? { ...process.env, ...provider.env }
      : undefined,
    mcpServers: {
      flock: {
        command: "node",
        args: [MCP_PATH],
        env: {
          DB_PATH,                                // 绝对路径
          AGENT_NAME: instance.agentName,
          ...(instance.agentToken ? { AGENT_TOKEN: instance.agentToken } : {}),
          ...(provider?.name ? { AGENT_PROVIDER: provider.name } : {}),
        }
      }
    },
    settingSources: [],                           // 不读文件系统，纯代码控制
    ...(instance.options?.sessionId               // wake 时恢复 session
      ? { resume: instance.options.sessionId }
      : {}),
  }
});

try {
  for await (const message of result) {
    if (message.type === 'system' && message.subtype === 'init') {
      instance.sessionId = message.session_id;
      instance.status = 'active';
      await this.reportActivity(instance.agentId, 'status_change', 'Agent active', {
        session_id: message.session_id,
        session_source: 'agent-sdk',
      }, instance.agentToken);
    }
    if (message.type === 'result') {
      instance.status = 'dormant';
      instance.abortController = undefined;
      await this.reportActivity(instance.agentId, 'status_change', 'Agent dormant', {
        session_id: instance.sessionId,
      }, instance.agentToken);
    }
  }
} catch (err) {
  instance.status = 'error';
  this.agents.delete(instance.agentId);
  await this.reportActivity(instance.agentId, 'error', `Agent error: ${formatError(err)}`, {
    session_id: instance.sessionId,
  }, instance.agentToken);
}
```

**关键改动点**：
1. `runAgent()` 从 `spawn` + 管道 → `query()` + async generator
2. `AgentInstance` 接口更新：`process: ChildProcess | null` → `abortController?: AbortController`
3. `stop()` 从 `process.kill()` → `abortController.abort()`
4. session 管理从 `--resume` CLI 参数 → SDK `resume` 选项
5. MCP 配置从 `.mcp.json` 文件 → 代码内 `mcpServers` 字段
6. 所有路径用绝对路径，`cwd` 显式设置为 PROJECT_ROOT
7. async generator 外包 try/catch，错误时更新状态并上报

### Step 3：Session 恢复链路

```
spawn 时 → instance.options.sessionId 不存在 → query() 新建 session
         → 从 init message 拿到 session_id → 存到 agent_spawns.session_id

wake 时  → instance.options.sessionId 存在 → query({ resume: sessionId })
         → 恢复完整上下文 → agent 继续工作
```

Server 侧 `callback.ts` 已经在 wake 时传递 `session_id`（通过 `latestClaudeSessionId()` 查 DB），Runtime 只需把它传给 `resume`。

### Step 4：Task 同步 prompt 优化

当前 task 状态更新需要 agent 手动调 MCP 工具 `flock_task_update`。SDK 集成后，因为 agent 已经连接了 Flock MCP server，它自然能调用 `flock_task_update`。

**需要做的最小改动**：
1. 在 `notifyTaskAssignment()` 的 callback prompt 中加入明确的指令：
   ```
   你被分配了任务 #{taskId}: {title}
   请调用 flock_task_update 将状态改为 in_progress，然后开始执行。
   完成后调用 flock_task_update 将状态改为 review。
   ```
2. Agent 收到 callback → SDK resume → 看到任务指令 → 调用 MCP 工具更新状态

这不需要额外的同步机制——agent 本身就是通过 MCP 工具来更新 task 状态的。

### Step 5：Artifact API

在 Server 加一个 `POST /tasks/:id/artifacts` 端点：
1. `task.ts` service 加 `createArtifact()` 函数
2. `tasks.ts` route 加 `POST /tasks/:id/artifacts` 端点
3. SDK 的 `addTaskArtifact()` 从占位符改为真实调用

---

## 不做的事

- ❌ 不做 Room 消息 → task 自动解析（`[TASK:done]` 规则）— agent 通过 MCP 工具直接更新更可靠
- ❌ 不做 Orchestrator 自动拆解 — 这是 AI 层面的事，不是 Runtime 基础设施
- ❌ 不做 tool boundary 注入 — MCP 层已有 `_unread_mentions` digest，够用
- ❌ 不做自动验收 — 先让链路跑通，验收后续迭代

---

## 依赖关系

```
Step 1 (安装 SDK)
  ↓
Step 2 (重写 agent-runner)  ← 核心改动，含 MCP 配置 + AbortController + 错误处理
  ↓
Step 3 (Session 恢复)       ← Step 2 的一部分
  ↓
Step 4 (Task 同步 prompt)   ← Server 侧，可与 Step 2 并行开发，但端到端验证依赖 Step 2
  ↓
Step 5 (Artifact API)       ← Server 侧，独立
```

---

## 验收标准

1. Runtime 启动 → 注册 → 等待 callback ✅（已有）
2. Server spawn → callback 到 Runtime → SDK `query()` 启动 agent → agent 出现在 Room
3. agent 被 @mention → Server wake callback → SDK `query({ resume })` → agent 恢复上下文并回复
4. 人类在 GUI 创建 task → 分配给 agent → agent 收到 callback → 调用 `flock_task_update` 更新状态
5. agent 完成任务 → 调用 `flock_task_update` 设为 review → 人类在 GUI 验收

---

## 风险（审查修正）

| 风险 | 缓解 |
|------|------|
| SDK 版本变动快（0.2.x → 0.3.x 有 breaking changes） | 锁定版本号，写集成测试 |
| `query()` 是 async generator，需要处理 abort | AbortController 传入 options，stop 时 abort |
| MCP server 配置方式可能随版本变 | 用内联 `mcpServers`，不用 `.mcp.json` |
| `bypassPermissions` 跳过所有安全检查 | daemon 场景可接受，后续可改为自定义 permission 规则 |
| `flock_wait` 阻塞可能导致 SDK generator 长时间不 yield | MCP server 侧 `flock_wait` 已有超时机制 |
| `env` 字段会 REPLACE 子进程环境 | 必须 spread `process.env`，不能只传自定义变量 |

---

## 审查问题追踪

| # | 严重程度 | 问题 | 状态 |
|---|---------|------|------|
| 🔴-1 | 阻断 | `permissionMode: "auto"` 语义错误 → 改为 `bypassPermissions` | ✅ 已修正 |
| 🔴-2 | 阻断 | 缺 `cwd`，DB 相对路径会解析错 → 加 `cwd: PROJECT_ROOT` + 绝对路径 | ✅ 已修正 |
| 🔴-3 | 阻断 | AbortController 未传给 query() → 加 `abortController` 到 options | ✅ 已修正 |
| 🟡-1 | 重要 | async generator 缺 try/catch → 已加 | ✅ 已修正 |
| 🟡-2 | 重要 | 缺 `model` 参数 → 已加 | ✅ 已修正 |
| 🟡-3 | 重要 | 缺 provider env 透传 → 已加 | ✅ 已修正 |
| 🟡-4 | 重要 | AgentInstance 接口需更新 → 已描述 | ✅ 已修正 |
| 🟡-5 | 重要 | sessionId 来源链路 → 已明确从 `instance.options.sessionId` 取 | ✅ 已修正 |
| 🟢-1 | 建议 | MCP 路径用 __dirname 不够健壮 → 改为 PROJECT_ROOT 固定路径 | ✅ 已修正 |
| 🟢-2 | 建议 | settingSources: [] 禁用 CLAUDE.md → 当前不需要，后续可改 | ⏸️ 接受风险 |
| 🟢-3 | 建议 | Step 5 依赖关系描述有误 → 已修正依赖图 | ✅ 已修正 |
| 🟢-4 | 建议 | flock_wait 与 SDK 交互 → MCP 侧已有超时 | ⏸️ 接受风险 |
| 🟢-5 | 建议 | SDK 版本锁定 → Step 1 已注明 | ✅ 已修正 |
