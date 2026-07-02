# Plan: 用 stdio 直驱 claude CLI 替换 ClaudeSdkBackend

> 作者: Opus 4.8 | 日期: 2026-06-16 | 执行者: Sonnet
> 状态: 待执行
> 参考实现: `~/code/other/multica/server/pkg/agent/claude.go`（Go 手写 stdio，795 行，已逐行读过）

---

## 0. 阅读须知（给执行的 Sonnet）

- 本文是**唯一事实源**。每个新模块的完整代码都写在这里，照抄即可，不要重新推导 wire 格式。
- wire 格式不是猜的——是我用本机 `claude` CLI (`2.1.178`) 实测抓出来的，见 §3。
- **提交粒度要求：最细。** §7 列了 ~22 个原子提交，每个提交后 `npm run -w @flock/agent-runtime build` 和 `test` 都必须绿。WIP 提交允许，但必须能编译（`tsc` 通过）。
- 发现任何新问题 → 立刻写 `docs/backlog.md`，不要只在 commit message 里说。

---

## 1. 目标与诚实的动机

### 1.1 这次迁移**真正**解决什么

| 收益 | 说明 |
|---|---|
| **去掉进程内耦合** | SDK 的 `query()` 在本进程内 spawn claude，继承父进程一切（CLAUDE_EFFORT、CLAUDECODE 等内部标记）。这正是之前 `CLAUDE_EFFORT=high` 泄漏 → 第 2 轮 Bedrock 400 的根因。stdio 后我们**完全控制子进程的 argv 和 env**。 |
| **完整的进程控制** | 自己 spawn、自己读 stdout、自己写 stdin、自己 kill。abort 不再依赖 SDK 内部的 AbortController 黑盒。 |
| **stdin 保持打开** | 为未来「运行中注入消息 / 人类中途干预」（backlog v0.6 项）打基础。本次**只保持 stdin 打开 + 处理 control_request**，不接线注入功能（留作独立 phase）。 |
| **可去 SDK 依赖** | 长期可移除 `@anthropic-ai/claude-agent-sdk`。本次**不删**，保留为 fallback（见 §6 决策 1）。 |

### 1.2 这次迁移**不**解决什么（不要夸大）

- **thinking/extended reasoning 不在本次启用。** 之前以为「stdio 能让 thinking 绕过 Bedrock」——机制上存疑：`--resume` 时 claude 仍会把历史（含 thinking blocks）发给 API。真正修好 Bedrock 400 的是**不开 effort**（strip CLAUDE_EFFORT + `--setting-sources ""`），这跟 SDK/stdio 无关。所以：
  - **默认不传 `--effort`**，thinking 保持关闭。
  - 用 `--setting-sources ""` 阻止 `~/.claude/settings.json` 的 `effortLevel: high` 加载（等价于旧 `settingSources: []`）。
  - effort/thinking 作为未来能力，等「resume 时 thinking signature 是否被 Bedrock 代理拒绝」单独验证后再开 → backlog。
- **运行中消息注入**：架构支持（stdin 不关），但 harness/MCP 接线不在本次范围 → backlog。
- **custom_args 过滤**（multica 的 `filterCustomArgs`/`blockedArgs`）：Agent-Larked 当前不开放用户自定义 CLI args，**跳过**，不引入这套复杂度 → backlog 备注。

---

## 2. 现有改动审查结论（commit `566bab1` → `6b92a82`）

逐条看过，结论如下：

| commit | 内容 | 结论 |
|---|---|---|
| `64d7503` | init 后 sync 真实 sessionId 到 HarnessSession | ✅ 正确，abort 必需 |
| `ee19db8` | 上报 text/thinking/tool_use/tool_result 活动 | ✅ 正确。⚠️ 但 SDK 路径下 `tool_result` 事件**从未产生**（`translateMessage` 不处理 `user` 类型），所以这段上报代码在 SDK 模式是**死代码**。stdio 路径会处理 `user` → 让它复活。→ backlog 已记。 |
| `30d38bd` | systemPrompt/maxTurns/maxBudgetUsd 传给 SDK | ✅ 正确 |
| `9ef9b42` | content path 修复 + stripEffortEnv + preset systemPrompt | ✅ 正确（三合一稍粗但内容对） |
| `6b92a82` | 去掉 `effort:'low'` | ✅ 正确 |
| `647f295` | MCP exit handler 用合法状态值 | ✅ 正确 |
| `ff97cde` (gitignore) / MCP env 继承 | MCP 子进程继承全量 process.env | ⚠️ **未过滤内部标记**（CLAUDECODE 等）。本次 C19 修复。 |

**审查发现的新 bug（写入 backlog）：**
1. SDK 路径 `translateMessage` 不处理 `user` 消息 → `tool_result` 活动上报是死代码。
2. `mapResultSubtype` 只看 `subtype`，不看 `is_error`。实测 `subtype:"success"` 可与 `is_error:true` 共存（API 400 时）→ SDK 会把错误当成功上报。stdio 译码器必须查 `is_error`。
3. MCP 子进程 env 未过滤 Claude 内部标记。

---

## 3. Wire 格式参考（本机实测，claude 2.1.178）

抓取命令（成功用例）：
```bash
printf '{"type":"user","message":{"role":"user","content":[{"type":"text","text":"..."}]}}\n' \
  | claude -p --output-format stream-json --input-format stream-json --verbose \
    --strict-mcp-config --mcp-config /tmp/x.json --permission-mode bypassPermissions \
    --disallowedTools AskUserQuestion
```

**输入帧（我们写给 stdin 的）：**
```json
{"type":"user","message":{"role":"user","content":[{"type":"text","text":"<prompt>"}]}}\n
```

**输出 — system/init（首行，带 session_id + tools + mcp_servers）：**
```json
{"type":"system","subtype":"init","cwd":"...","session_id":"cc0a8157-...","tools":["Bash","Read",...],"mcp_servers":[{"name":"probe","status":"pending"}],"model":"ppio/pa/claude-opus-4-8[1M]","permissionMode":"bypassPermissions",...}
```

**输出 — assistant（content 在 `message.content`，不是顶层 content）：**
```json
{"type":"assistant","message":{"model":"pa/claude-opus-4-8","id":"msg_...","type":"message","role":"assistant","content":[{"type":"text","text":"alpha bravo charlie"}],"stop_reason":null,"usage":{"input_tokens":2117,"output_tokens":1,"cache_creation_input_tokens":33926,"cache_read_input_tokens":0}},"session_id":"cc0a8157-...","uuid":"eb64..."}
```
- content block 类型: `text`{text} / `thinking`{thinking} / `tool_use`{id,name,input} 。
- **tool_result 出现在 `type:"user"` 消息里**（工具执行结果回灌为 user turn）——multica `handleUser` 证实，块形如 `{type:"tool_result",tool_use_id,content,is_error?}`。本次必须处理 `user` 类型。

**输出 — result（终止帧）：**
```json
{"type":"result","subtype":"success","is_error":false,"duration_ms":4256,"num_turns":1,"result":"alpha bravo charlie","session_id":"cc0a8157-...","total_cost_usd":0.2246,"usage":{...},"modelUsage":{"ppio/pa/claude-opus-4-8[1M]":{"inputTokens":2117,...}}}
```
- **坑：`subtype:"success"` 但 `is_error:true` 会同时出现**（如 API 400）。译码必须查 `is_error`。
- error 用例实测：`{"type":"result","subtype":"success","is_error":true,"api_error_status":400,"result":"API Error: 400 Param Incorrect",...}`，且前面会有一条 assistant 消息 `content:[{"type":"text","text":"API Error: 400 Param Incorrect"}]`。

**control_request（工具授权，bypassPermissions 下通常不出现，但协议要求能应答）：**
multica 实测形如 `{"type":"control_request","request_id":"...","request":{"subtype":"can_use_tool","tool_name":"...","input":{...}}}`，应答需写回 stdin：
```json
{"type":"control_response","response":{"subtype":"success","request_id":"<id>","response":{"behavior":"allow","updatedInput":<原input>}}}\n
```

**CLI 旗标（`claude --help` 实测存在）：** `--resume`, `--fork-session`, `--append-system-prompt`, `--max-turns`, `--max-budget-usd`, `--effort`, `--model`, `--fallback-model`, `--mcp-config`, `--strict-mcp-config`, `--disallowed-tools`, `--permission-mode`, `--input-format`, `--output-format`, `--setting-sources`, `--verbose`。

- `--setting-sources ""` 实测被接受且能正常跑（用于屏蔽 settings.json） ✅
- `--mcp-config` 实测接受 `{"mcpServers":{"<name>":{"type":"stdio","command":...,"args":[...],"env":{...}}}}` 格式，server 状态变 `pending`→连接 ✅

---

## 4. 架构

```
AgentRunner → AgentHarness → BackendRegistry.get({type:'claude-stdio'}) → ClaudeStdioBackend
                                                                              │
  run(ctx) ──────────────────────────────────────────────────────────────────┤
    1. buildClaudeArgs(ctx)         → argv                                     │
    2. buildChildEnv(ctx.env)       → 过滤后的 env                              │
    3. writeMcpConfigToTemp(...)    → /tmp/flock-mcp-*.json + cleanup           │
    4. spawn('claude', argv, {env, cwd})                                        │
    5. stdin.write(buildUserInput(prompt))   ← stdin 保持打开                    │
    6. readline(stdout) per line → JSON.parse → translateStreamMessage()        │
         ├─ system/init   → InitEvent (注册 child 到 sessionId map)             │
         ├─ assistant     → Text/Thinking/ToolUse events                        │
         ├─ user          → ToolResult events                                   │
         ├─ control_request → 写 control_response 到 stdin（自动 allow）          │
         └─ result        → ResultEvent (查 is_error) + closeStdin              │
    7. process exit → 若无 result 则补发 result/error；cleanup temp；end queue   │
  abort(sessionId) → kill(SIGTERM) + 10s 后 SIGKILL；closeStdin                  │
  resume(sid,ctx)  → run(ctx) with --resume sid                                 │
```

### 4.1 核心难点：push 源 → AsyncIterable

child_process 是回调/事件驱动（push），`AgentBackend.run` 要求 `AsyncIterable<AgentEvent>`（pull）。用一个 promise 背压队列桥接（替代 multica 的 Go channel）。见 §5.2 `EventQueue`。

### 4.2 模块划分（新文件）

| 文件 | 职责 | 纯度 |
|---|---|---|
| `backends/child-env.ts` | 过滤 Claude 内部 env 标记 + CLAUDE_EFFORT | 纯函数 |
| `backends/event-queue.ts` | push→pull 异步队列 | 纯（无 IO） |
| `backends/stream-json.ts` | wire 类型 + `buildUserInput` + `translateStreamMessage` | 纯函数 |
| `backends/mcp-config.ts` | MCPServerConfig[] → 临时 json 文件 | IO（fs） |
| `backends/claude-args.ts` | ctx → claude argv | 纯函数 |
| `backends/claude-stdio.ts` | 组装：spawn + 读写 + 生命周期 | IO（process） |

复用：`child-env.ts` 同时被 `agent-harness.ts` 的 MCP env 复用（C19）。

---

## 5. 各模块完整代码（照抄）

### 5.1 `backends/child-env.ts`

```ts
/**
 * Child-process environment filtering for spawned claude CLI subprocesses.
 *
 * Mirrors multica's isFilteredChildEnvKey: strip internal Claude Code runtime
 * markers (so the child does not mistake itself for a nested/resumed session or
 * inherit the parent's exec path/transport) and strip CLAUDE_EFFORT (so the
 * parent session's effort level never silently enables extended thinking in the
 * child — extended thinking produces signatures the Bedrock proxy rejects on
 * resume). User-facing CLAUDE_CODE_* config (CLAUDE_CODE_USE_BEDROCK,
 * CLAUDE_CODE_MAX_OUTPUT_TOKENS, ...) is deliberately preserved.
 */

/** Internal per-process markers that must NOT leak into the child. */
const INTERNAL_ENV_KEYS = new Set([
  'CLAUDECODE',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_EXECPATH',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_SSE_PORT',
]);

/** Effort marker — stripped to keep extended thinking off in spawned agents. */
const EFFORT_ENV_KEY = 'CLAUDE_EFFORT';

export function isInternalClaudeEnvKey(key: string): boolean {
  if (INTERNAL_ENV_KEYS.has(key)) return true;
  if (key === EFFORT_ENV_KEY) return true;
  // CLAUDECODE_* (no underscore between CLAUDE and CODE) is wholly internal.
  // The user-facing namespace is CLAUDE_CODE_* and is preserved.
  return key.startsWith('CLAUDECODE_');
}

/**
 * Build the environment for a spawned claude subprocess: process.env with
 * internal markers filtered out, then `extra` merged on top. Undefined values
 * are dropped so the result is a clean Record<string,string>.
 */
export function buildChildEnv(extra?: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (isInternalClaudeEnvKey(k)) continue;
    out[k] = v;
  }
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (v !== undefined) out[k] = v;
    }
  }
  return out;
}
```

测试 `__tests__/child-env.test.ts`：断言 `isInternalClaudeEnvKey` 对 5 个内部键 + `CLAUDE_EFFORT` + `CLAUDECODE_X` 返回 true；对 `CLAUDE_CODE_USE_BEDROCK`/`PATH`/`HOME` 返回 false。`buildChildEnv({FOO:'bar'})` 含 FOO、含 PATH、不含被注入的 CLAUDE_EFFORT（测试里临时 set process.env.CLAUDE_EFFORT 再断言被剥离，afterEach 还原）。

### 5.2 `backends/event-queue.ts`

```ts
/**
 * Single-producer/single-consumer async queue that bridges a push-based source
 * (child_process stdout events) to a pull-based AsyncIterable (AgentBackend.run).
 *
 * Replaces multica's Go channel. push() never blocks; drain() yields buffered
 * items, then awaits the next push, until end() is called.
 */
export interface EventQueue<T> {
  push(item: T): void;
  end(): void;
  drain(): AsyncGenerator<T>;
}

export function createEventQueue<T>(): EventQueue<T> {
  const buffer: T[] = [];
  let wake: (() => void) | null = null;
  let ended = false;

  function signal(): void {
    const w = wake;
    wake = null;
    w?.();
  }

  return {
    push(item: T): void {
      if (ended) return;
      buffer.push(item);
      signal();
    },
    end(): void {
      ended = true;
      signal();
    },
    async *drain(): AsyncGenerator<T> {
      // No `await` between the buffer check and the Promise-executor assignment,
      // so a push() landing after the checks cannot be missed (JS is single-
      // threaded; the executor runs synchronously and sets `wake` before the
      // await suspends).
      while (true) {
        if (buffer.length > 0) {
          yield buffer.shift()!;
          continue;
        }
        if (ended) return;
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
    },
  };
}
```

测试 `__tests__/event-queue.test.ts`：
- push 后 drain 拿到值；
- drain 先等待、随后 push 能唤醒（用 `setTimeout` 异步 push，await 第一个 `.next()`）；
- end 后 drain 结束；
- push-after-end 被忽略；
- 顺序保持（push 1,2,3 → drain 1,2,3）。

### 5.3 `backends/stream-json.ts`

```ts
/**
 * Claude CLI stream-json protocol: wire types, input frame builder, and the
 * translator from raw stream-json messages to the unified AgentEvent stream.
 *
 * Wire format empirically verified against claude CLI 2.1.178
 * (docs/plans/2026-06-16-stdio-backend-migration.md §3).
 */
import type { AgentEvent } from './types.js';

// ─── Wire types (only the fields we read) ────────────────────────────────────

export interface StreamJsonContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
}

export interface StreamJsonInnerMessage {
  role?: string;
  model?: string;
  content?: StreamJsonContentBlock[];
}

export interface StreamJsonMessage {
  type: string;                       // system | assistant | user | result | control_request | ...
  subtype?: string;                   // init | success | ...
  session_id?: string;
  model?: string;
  tools?: string[];
  mcp_servers?: Array<{ name: string; status: string }>;
  message?: StreamJsonInnerMessage;   // assistant/user wrap the API message here
  // result fields
  is_error?: boolean;
  result?: string;
  duration_ms?: number;
  num_turns?: number;
  total_cost_usd?: number;
  // control_request fields
  request_id?: string;
  request?: { subtype?: string; tool_name?: string; input?: unknown };
}

// ─── Input frame ──────────────────────────────────────────────────────────────

/** Build a single stream-json user-input line (newline-terminated). */
export function buildUserInput(prompt: string): string {
  const frame = {
    type: 'user',
    message: { role: 'user', content: [{ type: 'text', text: prompt }] },
  };
  return JSON.stringify(frame) + '\n';
}

/** Build a control_response line approving a tool use (newline-terminated). */
export function buildControlAllow(requestId: string, input: unknown): string {
  const frame = {
    type: 'control_response',
    response: {
      subtype: 'success',
      request_id: requestId,
      response: {
        behavior: 'allow',
        updatedInput: (input && typeof input === 'object') ? input : {},
      },
    },
  };
  return JSON.stringify(frame) + '\n';
}

// ─── Translation ────────────────────────────────────────────────────────────

/** Map a result message to a ResultEvent subtype, honoring is_error. */
export function mapResultSubtype(
  msg: StreamJsonMessage,
): 'completed' | 'error_during_execution' | 'error_max_turns' | 'error_max_budget_usd' {
  // CRITICAL: subtype "success" can co-occur with is_error:true (e.g. API 400).
  if (msg.is_error) return 'error_during_execution';
  switch (msg.subtype) {
    case 'success':
      return 'completed';
    case 'error_max_turns':
      return 'error_max_turns';
    case 'error_max_budget_usd':
      return 'error_max_budget_usd';
    default:
      return 'completed';
  }
}

function translateContentBlock(block: StreamJsonContentBlock): AgentEvent | null {
  switch (block.type) {
    case 'text':
      return typeof block.text === 'string' ? { type: 'text', content: block.text } : null;
    case 'thinking':
      return typeof block.thinking === 'string' ? { type: 'thinking', content: block.thinking } : null;
    case 'tool_use':
      if (typeof block.id !== 'string' || typeof block.name !== 'string') return null;
      return {
        type: 'tool_use',
        id: block.id,
        name: block.name,
        input: (block.input && typeof block.input === 'object' ? block.input : {}) as Record<string, unknown>,
      };
    case 'tool_result':
      if (typeof block.tool_use_id !== 'string') return null;
      return {
        type: 'tool_result',
        toolUseId: block.tool_use_id,
        content: typeof block.content === 'string' ? block.content : JSON.stringify(block.content ?? ''),
        isError: typeof block.is_error === 'boolean' ? block.is_error : undefined,
      };
    default:
      return null;
  }
}

/**
 * Translate one parsed stream-json message into zero or more AgentEvents.
 * Returns [] for messages we ignore (e.g. control_request — handled out-of-band
 * by the backend writing to stdin, not surfaced as an event).
 */
export function translateStreamMessage(msg: StreamJsonMessage): AgentEvent[] {
  switch (msg.type) {
    case 'system':
      if (msg.subtype === 'init') {
        return [{
          type: 'init',
          sessionId: msg.session_id ?? '',
          model: msg.model ?? '',
          tools: msg.tools ?? [],
          mcpServers: msg.mcp_servers?.map((s) => ({ name: s.name, status: s.status })),
        }];
      }
      return [];
    case 'assistant':
    case 'user': {
      const blocks = msg.message?.content;
      if (!Array.isArray(blocks)) return [];
      const events: AgentEvent[] = [];
      for (const b of blocks) {
        const ev = translateContentBlock(b);
        if (ev) events.push(ev);
      }
      return events;
    }
    case 'result':
      return [{
        type: 'result',
        subtype: mapResultSubtype(msg),
        durationMs: msg.duration_ms ?? 0,
        costUsd: msg.total_cost_usd,
        numTurns: msg.num_turns,
        sessionId: msg.session_id ?? '',
      }];
    default:
      return [];
  }
}
```

测试 `__tests__/stream-json.test.ts`：用 §3 抓到的**真实行**作 fixture。
- init 行 → InitEvent（sessionId/model/tools/mcpServers）。
- assistant 行 → `[{type:'text',content:'alpha bravo charlie'}]`。
- 构造 user+tool_result 行 → ToolResultEvent。
- result `is_error:false,subtype:success` → `completed`；result `is_error:true,subtype:success` → `error_during_execution`（**回归测试这个坑**）。
- `buildUserInput('hi')` → 解析回来结构正确、以 `\n` 结尾。
- `buildControlAllow('r1',{a:1})` → behavior allow、request_id 对、updatedInput 对。

### 5.4 `backends/mcp-config.ts`

```ts
/**
 * Write a --mcp-config JSON file for the claude CLI from our MCPServerConfig[].
 *
 * The CLI expects {"mcpServers":{"<name>":{...}}}. stdio servers use
 * {type:"stdio",command,args,env}; sse servers use {type:"sse",url,headers}.
 * Verified against claude CLI 2.1.178 (§3).
 */
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MCPServerConfig } from './types.js';

export interface McpConfigFile {
  path: string;
  cleanup: () => void;
}

export function writeMcpConfigToTemp(servers: MCPServerConfig[]): McpConfigFile {
  const mcpServers: Record<string, unknown> = {};
  for (const s of servers) {
    if (s.transport.type === 'stdio') {
      mcpServers[s.name] = {
        type: 'stdio',
        command: s.transport.command,
        ...(s.transport.args ? { args: s.transport.args } : {}),
        ...(s.transport.env ? { env: s.transport.env } : {}),
      };
    } else if (s.transport.type === 'sse') {
      mcpServers[s.name] = {
        type: 'sse',
        url: s.transport.url,
        ...(s.transport.headers ? { headers: s.transport.headers } : {}),
      };
    }
  }

  const dir = mkdtempSync(join(tmpdir(), 'flock-mcp-'));
  const path = join(dir, 'mcp-config.json');
  writeFileSync(path, JSON.stringify({ mcpServers }, null, 2), { mode: 0o600 });

  return {
    path,
    cleanup: () => {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
    },
  };
}
```

测试 `__tests__/mcp-config.test.ts`：写 stdio+sse server，读回文件断言结构含 `type:"stdio"`、命令、env；调 cleanup 后文件不存在。

### 5.5 `backends/claude-args.ts`

```ts
/**
 * Build the claude CLI argv for a stdio-driven agent session.
 *
 * Hardcodes the protocol-critical flags (stream-json in/out, verbose, strict
 * mcp config, bypassPermissions, AskUserQuestion disabled, settings sources
 * cleared). Effort/thinking is intentionally NOT passed — see migration plan §1.2.
 */
import type { AgentRunContext } from './types.js';

export interface ClaudeArgsExtra {
  mcpConfigPath: string;
  resumeSessionId?: string;
}

export function buildClaudeArgs(ctx: AgentRunContext, extra: ClaudeArgsExtra): string[] {
  const args: string[] = [
    '-p',
    '--output-format', 'stream-json',
    '--input-format', 'stream-json',
    '--verbose',
    '--strict-mcp-config',
    '--mcp-config', extra.mcpConfigPath,
    '--permission-mode', 'bypassPermissions',
    // AskUserQuestion has no UI in non-interactive mode; calling it strands the
    // agent. Steer clarifications to room messages instead (mirrors multica).
    '--disallowedTools', 'AskUserQuestion',
    // Block ~/.claude/settings.json (effortLevel:high etc.) from loading.
    '--setting-sources', '',
  ];

  if (ctx.model) args.push('--model', ctx.model);
  if (ctx.maxTurns != null) args.push('--max-turns', String(ctx.maxTurns));
  if (ctx.maxBudgetUsd != null) args.push('--max-budget-usd', String(ctx.maxBudgetUsd));
  if (ctx.systemPrompt) args.push('--append-system-prompt', ctx.systemPrompt);
  if (extra.resumeSessionId) args.push('--resume', extra.resumeSessionId);

  return args;
}
```

> 注意：旧 SDK 代码用 `systemPrompt: {preset:'claude_code', append}` 保留 Claude Code 内置提示。CLI 模式下 `--append-system-prompt` **本身就是追加**到 claude 默认 system prompt（不替换），语义等价于 preset+append。无需额外处理。

测试 `__tests__/claude-args.test.ts`：断言固定旗标都在；model/maxTurns/maxBudgetUsd/systemPrompt/resume 按需出现/省略；**断言不含 `--effort`**。

### 5.6 `backends/claude-stdio.ts`（最终完整实现）

```ts
/**
 * ClaudeStdioBackend — drives the claude CLI directly over stdio with the
 * stream-json protocol, replacing the in-process SDK query().
 *
 * Why stdio (see docs/plans/2026-06-16-stdio-backend-migration.md):
 *  - Full control of child argv + env (no parent-session env leakage).
 *  - stdin stays open so control_request can be answered on the same stream
 *    (and future mid-run message injection becomes possible).
 *  - Lifecycle/abort handled by us, not an SDK black box.
 *
 * Modeled on multica's claudeBackend (server/pkg/agent/claude.go).
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import type {
  AgentBackend,
  AgentRunContext,
  AgentEvent,
  BackendConfig,
} from './types.js';
import { buildChildEnv } from './child-env.js';
import { buildClaudeArgs } from './claude-args.js';
import { writeMcpConfigToTemp } from './mcp-config.js';
import { createEventQueue } from './event-queue.js';
import {
  buildUserInput,
  buildControlAllow,
  translateStreamMessage,
  type StreamJsonMessage,
} from './stream-json.js';

const CLAUDE_BIN = process.env.CLAUDE_CLI_PATH ?? 'claude';
const SIGKILL_GRACE_MS = 10_000; // mirrors multica cmd.WaitDelay

export class ClaudeStdioBackend implements AgentBackend {
  readonly name = 'claude-stdio';

  /** sessionId → child process, for abort(). Keyed by resume id first, then
   *  re-keyed to the real session id once the init event arrives. */
  private active = new Map<string, ChildProcessWithoutNullStreams>();

  run(ctx: AgentRunContext): AsyncIterable<AgentEvent> {
    return this.exec(ctx, undefined);
  }

  resume(sessionId: string, ctx: AgentRunContext): AsyncIterable<AgentEvent> {
    return this.exec(ctx, sessionId);
  }

  abort(sessionId: string): void {
    const child = this.active.get(sessionId);
    if (!child) return;
    this.active.delete(sessionId);
    this.killChild(child);
  }

  private killChild(child: ChildProcessWithoutNullStreams): void {
    try {
      child.stdin.end();
    } catch { /* ignore */ }
    child.kill('SIGTERM');
    const t = setTimeout(() => {
      if (!child.killed) child.kill('SIGKILL');
    }, SIGKILL_GRACE_MS);
    // Don't keep the event loop alive just for the grace timer.
    t.unref?.();
    child.once('exit', () => clearTimeout(t));
  }

  private async *exec(
    ctx: AgentRunContext,
    resumeSessionId: string | undefined,
  ): AsyncGenerator<AgentEvent> {
    const mcp = writeMcpConfigToTemp(ctx.mcpServers);
    const args = buildClaudeArgs(ctx, { mcpConfigPath: mcp.path, resumeSessionId });
    const env = buildChildEnv(ctx.env);

    const child = spawn(CLAUDE_BIN, args, {
      cwd: ctx.cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    }) as ChildProcessWithoutNullStreams;

    const queue = createEventQueue<AgentEvent>();
    let trackingKey = resumeSessionId ?? `pending:${child.pid}`;
    this.active.set(trackingKey, child);

    let sawResult = false;
    let stderrTail = '';
    const STDERR_TAIL_MAX = 8192;

    // ── stderr → bounded tail (for diagnostics on unexpected exit) ──
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderrTail = (stderrTail + chunk).slice(-STDERR_TAIL_MAX);
    });

    // ── stdout → line parse → queue ──
    const rl = createInterface({ input: child.stdout });
    rl.on('line', (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let msg: StreamJsonMessage;
      try {
        msg = JSON.parse(trimmed) as StreamJsonMessage;
      } catch {
        return; // non-JSON noise (banner etc.)
      }

      // control_request is answered out-of-band on stdin (auto-approve).
      if (msg.type === 'control_request' && msg.request_id) {
        try {
          child.stdin.write(buildControlAllow(msg.request_id, msg.request?.input));
        } catch { /* ignore */ }
        return;
      }

      for (const ev of translateStreamMessage(msg)) {
        // Re-key the active map to the real session id so abort() works.
        if (ev.type === 'init' && ev.sessionId) {
          this.active.delete(trackingKey);
          trackingKey = ev.sessionId;
          this.active.set(trackingKey, child);
        }
        if (ev.type === 'result') sawResult = true;
        queue.push(ev);
      }
    });

    // ── lifecycle: write prompt, wire exit/error to close the queue ──
    const finish = (extra?: AgentEvent): void => {
      if (extra) queue.push(extra);
      queue.end();
      this.active.delete(trackingKey);
      mcp.cleanup();
    };

    child.once('error', (err: Error) => {
      finish({ type: 'error', message: `spawn claude: ${err.message}`, subtype: 'unknown' });
    });

    child.once('exit', (code, signal) => {
      rl.close();
      if (sawResult) {
        finish();
        return;
      }
      // Process ended without a result frame.
      if (signal === 'SIGTERM' || signal === 'SIGKILL') {
        finish({ type: 'error', message: 'aborted', subtype: 'abort' });
      } else {
        const tail = stderrTail.trim();
        finish({
          type: 'error',
          message: `claude exited (code=${code ?? 'null'}, signal=${signal ?? 'null'})${tail ? `: ${tail}` : ''}`,
          subtype: 'unknown',
        });
      }
    });

    // ctx.signal abort → kill child (covers harness/shutdown abort).
    if (ctx.signal.aborted) {
      this.killChild(child);
    } else {
      ctx.signal.addEventListener('abort', () => this.killChild(child), { once: true });
    }

    // Write the initial user message. stdin stays OPEN (control_request needs
    // the same stream; closing early strands the child — multica's hard-won note).
    try {
      child.stdin.write(buildUserInput(ctx.prompt));
    } catch {
      // If the pipe is already broken the exit handler will surface the error.
    }

    yield* queue.drain();
  }
}

export function createClaudeStdioBackend(_config?: BackendConfig): ClaudeStdioBackend {
  return new ClaudeStdioBackend();
}
```

> 关于 `result` 后是否 closeStdin：multica 在 result 后 closeStdin。本设计在 result 后**不主动关 stdin**——因为 base prompt 让 agent 每轮调 `flock_wait`，正常情况下 claude 在 flock_wait 阻塞期间不会发 result；真正结束靠 abort/exit。result 真出现时（agent 自然终止），随后的 `exit` 事件会触发 `finish()`。若实测发现 result 后进程不退导致挂起，再加「result → child.stdin.end()」。**先按当前写法，QA 验证。** → 已在 backlog 备注待观察。

---

## 5bis. 修复 SDK fallback 路径的三个已确认 bug（`claude-sdk.ts`）

> **为什么必须现在修，而不是等删 SDK：** 决策 §6.1 保留 `claude-sdk.ts` 作为 `BACKEND_TYPE=claude-sdk` 的回退路径。回退路径必须是**好的**回退——带 bug 的 fallback 在出事时会把人坑得更惨（你切回 SDK 想救火，结果 SDK 把 API 400 当成功上报，你更找不到问题）。所以这三个 bug 在本次一并修掉。
>
> **三个 bug 都已对照 SDK 自带类型定义核实**（`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`），不是猜的：
> - `SDKMessage` 联合类型含 `SDKUserMessage`（`type:'user'`，content 里带 `tool_result` 块），但 `translateMessage` 没有 `user` 分支。
> - `SDKResultSuccess` 同时有 `subtype:'success'`、`is_error: boolean`、`api_error_status?: number`——即 `success` + `is_error:true` 是合法形状（API 400 实测见 §3）。当前 `mapResultSubtype` 只看 `subtype`。
> - `agent-harness.ts` 的 `buildMcpServers` 裸展开 `process.env`，未过滤内部标记（这个 bug **两条路径共享**，因为 MCP 子进程对 stdio/SDK 都一样）。

### 5bis.1 Bug #1 — 处理 `user` 消息，让 tool_result 事件复活

`claude-sdk.ts` 的 `translateMessage` 加 `user` 分支。SDK 的 user 消息结构与 assistant 一致（都是 `{ message: { content: [...] } }`），所以复用同一个 block 翻译逻辑：

```ts
// translateMessage() 的 switch 里，'assistant' case 后面加：
    case 'user':
      return translateUserMessage(message);
```

新增函数（紧挨 `translateAssistantMessage`）：

```ts
/**
 * Translate SDK user messages. The SDK feeds tool execution results back as
 * user-turn messages whose content blocks are tool_result. Without this, the
 * tool_result activity reporting added in commit ee19db8 is dead code — the
 * event is never emitted on the SDK path.
 *
 * SDK shape: { type: 'user', message: MessageParam, ... }
 * Content blocks are in message.message.content (same wrapping as assistant).
 */
function translateUserMessage(message: SDKMessage): AgentEvent[] {
  const msg = message as Record<string, unknown>;
  const inner = msg.message as Record<string, unknown> | undefined;
  const content = inner?.content;
  if (!content || !Array.isArray(content)) {
    return [];
  }

  const events: AgentEvent[] = [];
  for (const block of content) {
    const event = translateContentBlock(block);
    if (event) {
      events.push(event);
    }
  }
  return events;
}
```

> `translateContentBlock` 已经有 `tool_result` 分支（claude-sdk.ts 现有代码 211–226 行），所以无需改它。user 消息里若混有 `text` 块（罕见）也会被正确翻译，无害。

### 5bis.2 Bug #2 — `mapResultSubtype` 必须查 `is_error`

当前签名 `mapResultSubtype(sdkSubtype: string)` 只拿到 subtype 字符串，拿不到 `is_error`。改成接收整条 message：

```ts
// 调用点（translateMessage 的 'result' case）：
//   旧: subtype: mapResultSubtype(message.subtype),
//   新: subtype: mapResultSubtype(message),

/**
 * Map SDK result messages to our unified ResultEvent subtypes.
 *
 * CRITICAL: SDKResultSuccess carries BOTH subtype:'success' AND is_error:boolean
 * (+ api_error_status). An API 400 surfaces as subtype:'success', is_error:true
 * (verified against the CLI wire format, see migration plan §3). Keying only on
 * subtype silently reports these as completed. Check is_error FIRST.
 */
function mapResultSubtype(
  message: SDKMessage,
): 'completed' | 'error_during_execution' | 'error_max_turns' | 'error_max_budget_usd' {
  const msg = message as { subtype?: string; is_error?: boolean };

  if (msg.is_error) {
    // Preserve the specific limit subtypes even when is_error is set.
    if (msg.subtype === 'error_max_turns') return 'error_max_turns';
    if (msg.subtype === 'error_max_budget_usd') return 'error_max_budget_usd';
    return 'error_during_execution';
  }

  switch (msg.subtype) {
    case 'success':
      return 'completed';
    case 'error_during_execution':
    case 'error_max_turns':
    case 'error_max_budget_usd':
      return msg.subtype;
    case 'error_max_structured_output_retries':
      return 'error_during_execution';
    default:
      console.warn(`[claude-sdk] Unknown result subtype: "${msg.subtype}", treating as error`);
      return 'error_during_execution';
  }
}
```

> 注意 `mapResultSubtype` 当前在文件末尾（claude-sdk.ts 305–321 行），改它 + 改调用点（143–151 行的 `result` case）是同一个 bug 的两处,放同一个提交。

### 5bis.3 Bug #3 — MCP 子进程 env 过滤（与 stdio 共用 `buildChildEnv`）

这个 bug 在 `agent-harness.ts` 的 `buildMcpServers`，**stdio 和 SDK 两条路径都走它**，所以它不是「SDK 专属」修复——它就是 §7 的 **C54**。这里不重复，C54 已覆盖：把裸 `process.env` 展开换成 `buildChildEnv({ DB_PATH, AGENT_NAME, AGENT_TOKEN })`。

### 5bis.4 这些修复对应的提交

见 §7 Phase 8bis（C54b–C54e）。Bug #1、#2 是纯 `claude-sdk.ts` + 其测试；Bug #3 即 C54。

---

## 6. 关键决策

1. **保留 `claude-sdk.ts` 作为 fallback（不删 SDK 依赖）。** 默认切到 `claude-stdio`，但 `BACKEND_TYPE=claude-sdk` 仍可回退。stdio 经 QA 验证稳定后，下一个版本再删 SDK 依赖和 claude-sdk.ts。理由：可逆、低风险。
2. **thinking/effort 默认关闭。** 见 §1.2。
3. **不实现 custom_args 过滤。** Agent-Larked 不开放用户自定义 CLI args。→ backlog。
4. **stream-json 译码逻辑不与 claude-sdk.ts 共享。** 共存期允许重复；删 SDK 时再统一。→ backlog。
5. **abort 用 SIGTERM + 10s SIGKILL。** 对齐 multica `WaitDelay`。

---

## 7. 原子提交清单（极细粒度 = 一次改动一个提交）

> **粒度原则：一个独立可验证的改动 = 一个提交。** 同一个文件随功能搭建会出现在多个提交里——这是对的，不是问题。一个函数、一个分支、一个 case、一个测试组，都可以是独立提交。
>
> **每个提交后必须 `tsc` 通过**（`npm run -w @flock/agent-runtime build`）。
> 测试在「该函数/分支首次具备可测行为」的那个提交里同步加入——不攒到最后。能跑测试的提交跑 `npm run -w @flock/agent-runtime test`，必须绿。
> commit message 用项目规范（改了什么/为什么/影响）。**不要加任何 Co-Authored-By 尾注。**
>
> **可编译性策略**：纯函数模块（child-env / event-queue / stream-json / mcp-config / claude-args）天然自包含，逐函数加即可编译。`claude-stdio.ts` 因为是一个 class，拆细时用「先占位再填充」：方法体先写最小可编译实现（`return this.exec(...)` / 空 `Map` / TODO 注释 + 能过 tsc 的桩），后续提交逐个填充真实逻辑。每个提交 tsc 必须绿。

---

### Phase 0 — `child-env.ts`（§5.1）

| # | commit | 改动（一次一件） |
|---|---|---|
| C1 | `feat(runtime): add INTERNAL_ENV_KEYS set + isInternalClaudeEnvKey` | 新建 `backends/child-env.ts`，只写 `INTERNAL_ENV_KEYS` 常量 + `EFFORT_ENV_KEY` + `isInternalClaudeEnvKey()`。导出。 |
| C2 | `test(runtime): cover isInternalClaudeEnvKey classification` | 新建 `__tests__/child-env.test.ts`：5 个内部键 + `CLAUDE_EFFORT` + `CLAUDECODE_X` → true；`CLAUDE_CODE_USE_BEDROCK`/`PATH`/`HOME` → false。 |
| C3 | `feat(runtime): add buildChildEnv filtering process.env` | 在 `child-env.ts` 追加 `buildChildEnv()`。 |
| C4 | `test(runtime): cover buildChildEnv strips markers + merges extra` | 追加测试：含 PATH、含注入的 extra、剥离临时 set 的 `CLAUDE_EFFORT`（afterEach 还原 process.env）。 |

### Phase 1 — `event-queue.ts`（§5.2）

| # | commit | 改动 |
|---|---|---|
| C5 | `feat(runtime): add EventQueue interface + createEventQueue skeleton` | 新建 `backends/event-queue.ts`：接口 + `createEventQueue` 返回 `push`(只 buffer.push)、`end`(只置 ended)、`drain`(只 yield buffer 不等待)。可编译。 |
| C6 | `feat(runtime): add wake/signal backpressure to EventQueue.drain` | 加 `wake`/`signal()`，`drain` 空 buffer 时 await Promise，`push`/`end` 唤醒。 |
| C7 | `test(runtime): cover EventQueue ordering, async wake, end semantics` | 新建 `__tests__/event-queue.test.ts`：push→drain、异步 push 唤醒、end 终止、push-after-end 忽略、顺序保持。 |

### Phase 2 — `stream-json.ts`（§5.3）

| # | commit | 改动 |
|---|---|---|
| C8 | `feat(runtime): add stream-json wire type definitions` | 新建 `backends/stream-json.ts`，只写 `StreamJsonContentBlock`/`StreamJsonInnerMessage`/`StreamJsonMessage` 接口。 |
| C9 | `feat(runtime): add buildUserInput stream-json frame builder` | 追加 `buildUserInput()`。 |
| C10 | `test(runtime): cover buildUserInput frame shape + newline` | 新建 `__tests__/stream-json.test.ts`：解析回来结构正确、`\n` 结尾。 |
| C11 | `feat(runtime): add buildControlAllow control_response builder` | 追加 `buildControlAllow()`。 |
| C12 | `test(runtime): cover buildControlAllow allow shape` | 追加测试：behavior allow、request_id、updatedInput（含非对象 input 降级为 `{}`）。 |
| C13 | `feat(runtime): add mapResultSubtype honoring is_error` | 追加 `mapResultSubtype()`。**核心：先查 `is_error`。** |
| C14 | `test(runtime): regress mapResultSubtype success+is_error→error` | 追加测试：`is_error:false,subtype:success`→completed；`is_error:true,subtype:success`→error_during_execution；max_turns/max_budget 映射。**这是踩过的坑，必须有回归。** |
| C15 | `feat(runtime): add translateContentBlock for text/thinking/tool blocks` | 追加 `translateContentBlock()`（text/thinking/tool_use/tool_result/default）。 |
| C16 | `test(runtime): cover translateContentBlock per block type` | 追加测试：各块类型 → 对应 event；畸形块 → null。 |
| C17 | `feat(runtime): add translateStreamMessage dispatch` | 追加 `translateStreamMessage()`（system/assistant/user/result/default 分发）。 |
| C18 | `test(runtime): cover translateStreamMessage with real wire fixtures` | 追加测试：用 §3 实测行作 fixture（init/assistant/user+tool_result/result）。 |

### Phase 3 — `mcp-config.ts`（§5.4）

| # | commit | 改动 |
|---|---|---|
| C19 | `feat(runtime): add writeMcpConfigToTemp for --mcp-config` | 新建 `backends/mcp-config.ts`：`McpConfigFile` 接口 + `writeMcpConfigToTemp()`（stdio+sse 两分支 + cleanup）。 |
| C20 | `test(runtime): cover mcp-config file shape + cleanup` | 新建 `__tests__/mcp-config.test.ts`：写 stdio+sse、读回断言 `type` 字段、cleanup 后文件消失。 |

### Phase 4 — `claude-args.ts`（§5.5）

| # | commit | 改动 |
|---|---|---|
| C21 | `feat(runtime): add buildClaudeArgs base protocol flags` | 新建 `backends/claude-args.ts`：`ClaudeArgsExtra` 接口 + `buildClaudeArgs()` 只含固定旗标（stream-json/verbose/strict-mcp/mcp-config/bypassPermissions/disallowedTools/setting-sources）。 |
| C22 | `feat(runtime): add optional model/turns/budget/systemPrompt/resume args` | 追加 5 个条件分支。 |
| C23 | `test(runtime): cover buildClaudeArgs flags + asserts no --effort` | 新建 `__tests__/claude-args.test.ts`：固定旗标存在；可选项按需出现/省略；**断言不含 `--effort`**。 |

### Phase 5 — `claude-stdio.ts` 本体（§5.6，先占位再填充，每步 tsc 绿）

| # | commit | 改动 |
|---|---|---|
| C24 | `feat(runtime): scaffold ClaudeStdioBackend class shell [WIP]` | 新建 `backends/claude-stdio.ts`：import、`CLAUDE_BIN`/`SIGKILL_GRACE_MS` 常量、class + `name`、空 `active` Map。`run`/`resume`/`abort` 桩（`run`→空 async generator，`abort`→noop）。`createClaudeStdioBackend` 工厂。tsc 绿。 |
| C25 | `feat(runtime): spawn claude subprocess in exec() [WIP]` | 加 `private async *exec()`：writeMcpConfigToTemp + buildClaudeArgs + buildChildEnv + spawn。`run`/`resume` 改为调 `exec`。先 `mcp.cleanup()` + `return` 不读输出。tsc 绿。 |
| C26 | `feat(runtime): write initial user prompt to stdin [WIP]` | `exec` 末尾加 `child.stdin.write(buildUserInput(ctx.prompt))`（try/catch）。注释说明 stdin 保持打开。 |
| C27 | `feat(runtime): create EventQueue and yield drain in exec [WIP]` | 建 `queue`、`trackingKey`、`active.set`；`yield* queue.drain()`；spawn 后暂时立即 `queue.end()` 占位（保证可结束）。 |
| C28 | `feat(runtime): parse stdout lines into stream-json messages [WIP]` | `createInterface(child.stdout)` + `rl.on('line')`：trim、JSON.parse(try/catch 忽略非 JSON)。先只解析不分发。移除 C27 的占位 `queue.end()`。 |
| C29 | `feat(runtime): translate parsed messages into queued events` | line handler 内 `translateStreamMessage(msg)` → `queue.push(ev)`。 |
| C30 | `feat(runtime): re-key active map to real session id on init` | line handler 内 init 事件 → `active.delete(trackingKey)` + 重键真实 sessionId。 |
| C31 | `feat(runtime): auto-approve control_request over stdin` | line handler 内 `control_request` 分支 → `buildControlAllow` 写 stdin，return（不入队）。 |
| C32 | `feat(runtime): capture bounded stderr tail for diagnostics` | `child.stderr` setEncoding + on('data') 累积到 `STDERR_TAIL_MAX` 上限。 |
| C33 | `feat(runtime): add finish() to end queue and cleanup temp` | 加 `finish(extra?)`：可选补发 event、`queue.end()`、`active.delete`、`mcp.cleanup()`。`sawResult` 标志（result 事件时置位）。 |
| C34 | `feat(runtime): wire child error event to error event + finish` | `child.once('error')` → `finish({type:'error',...})`。 |
| C35 | `feat(runtime): wire child exit to result/abort/error synthesis` | `child.once('exit')`：rl.close；sawResult→finish()；SIGTERM/SIGKILL→abort error；否则 code/signal+stderr tail error。 |
| C36 | `feat(runtime): add killChild with SIGTERM→SIGKILL grace` | 加 `private killChild()`：stdin.end + SIGTERM + 10s unref 定时器 SIGKILL + exit 清定时器。 |
| C37 | `feat(runtime): implement abort() via active map + killChild` | `abort(sessionId)` → 查 `active`、delete、`killChild`。 |
| C38 | `feat(runtime): wire ctx.signal abort to killChild` | `exec` 内 `ctx.signal` aborted 检查 + addEventListener('abort') → killChild。 |

### Phase 6 — `claude-stdio.ts` 测试（每个测试组一个提交）

| # | commit | 改动（新建 `__tests__/claude-stdio.test.ts`，每次追加一个 describe/it 组） |
|---|---|---|
| C39 | `test(runtime): add spawn mock harness for ClaudeStdioBackend` | 建 mock：`vi.mock('node:child_process')` 返回假 child（EventEmitter + 可写 stdin 收集 writes + 可读 stdout 可推行）。一个冒烟测试：run 产出 init→text→result。 |
| C40 | `test(runtime): cover init event re-keys active map` | 推 init 行后 `abort(realSessionId)` 能 kill。 |
| C41 | `test(runtime): cover result is_error maps to error event` | 推 `is_error:true,subtype:success` result → 得到 error/error_during_execution。 |
| C42 | `test(runtime): cover control_request writes allow to stdin` | 推 control_request 行 → 断言 stdin 收到 control_response allow。 |
| C43 | `test(runtime): cover abort kills child + emits abort` | abort → child.kill 调用 + exit(SIGTERM) → 不产 error（abort subtype）。 |
| C44 | `test(runtime): cover resume passes --resume in argv` | `resume('sid',ctx)` → spawn argv 含 `--resume sid`。 |
| C45 | `test(runtime): cover exit-without-result synthesizes error` | child 退出 code=1 无 result → error event 带 stderr tail。 |

### Phase 7 — 注册与默认切换（一次一处）

| # | commit | 文件 | 改动 |
|---|---|---|---|
| C46 | `feat(runtime): add 'claude-stdio' to BackendType union` | ~`backends/types.ts` | union 加 `'claude-stdio'` |
| C47 | `feat(runtime): export ClaudeStdioBackend from backends index` | ~`backends/index.ts` | export class + factory |
| C48 | `feat(runtime): register claude-stdio in default registry` | ~`agent-runner.ts` | import + `register('claude-stdio', createClaudeStdioBackend)` |
| C49 | `feat(runtime): add claude-stdio to AgentSpawnOptions.backend` | ~`agent-runner.ts` | `backend` union 加 `'claude-stdio'` |
| C50 | `feat(runtime): accept claude-stdio in VALID_BACKEND_TYPES` | ~`config.ts` | 数组加 `'claude-stdio'` |
| C51 | `feat(runtime): switch default backend to claude-stdio` | ~`config.ts` | `BACKEND_TYPE ?? 'claude-sdk'` → `?? 'claude-stdio'`；fallback 同步 |
| C52 | `test(runtime): update default-backend expectations to claude-stdio` | ~`__tests__/backends-types.test.ts` | 改 `loadBackendConfig` 默认期望 |
| C53 | `test(runtime): update runtime-registration default backend` | ~`__tests__/runtime-registration.test.ts` | `makeConfig` 默认 `defaultBackend` 期望 |

### Phase 8 — harness env 修复 + SDK 进程测试迁移

| # | commit | 文件 | 改动 |
|---|---|---|---|
| C54 | `fix(runtime): filter internal Claude env keys from MCP server env` | ~`harness/agent-harness.ts` | `buildMcpServers` 用 `buildChildEnv({DB_PATH,AGENT_NAME,AGENT_TOKEN})` 替代裸 `process.env` 展开（import child-env） |
| C55 | `test(runtime): swap SDK query mock for child_process spawn mock` | ~`__tests__/agent-runner-process.test.ts` | 把 `vi.mock('@anthropic-ai/claude-agent-sdk')` 换成 `vi.mock('node:child_process')` 假 child harness（test 文件级，先让现有用例能跑起来） |
| C56 | `test(runtime): port init/active + resume assertions to stdio` | ~同上 | 迁移「init→active」「resume→--resume」两组断言 |
| C57 | `test(runtime): port model/provider env assertions to stdio` | ~同上 | 迁移「model/provider env」断言（查 spawn argv/env） |
| C58 | `test(runtime): port error-path assertions to stdio` | ~同上 | 迁移「spawn 抛错→error」「result error→error」两组 |
| C59 | `test(runtime): port lifecycle assertions to stdio` | ~同上 | 迁移「completed→dormant」「stop→abort」「aborted 不报 error」三组 |

### Phase 8bis — 修复 SDK fallback 路径的 bug（§5bis，保留 SDK 就必须修）

> C54 已经修了 Bug #3（MCP env，两路径共享）。这里修 Bug #1、#2（`claude-sdk.ts` 专属）。

| # | commit | 文件 | 改动 |
|---|---|---|---|
| C54b | `fix(runtime): translate SDK user messages so tool_result events emit` | ~`backends/claude-sdk.ts` | 加 `translateUserMessage()` + `translateMessage` 的 `'user'` case（§5bis.1）。修复 ee19db8 引入的 tool_result 死代码。 |
| C54c | `test(runtime): cover SDK user-message tool_result translation` | ~`__tests__/agent-runner-process.test.ts` 或新建 `__tests__/claude-sdk.test.ts` | 推一条 SDK `user` 消息（含 tool_result 块）→ 断言产出 ToolResultEvent / tool_result 活动上报。 |
| C54d | `fix(runtime): mapResultSubtype checks is_error before subtype` | ~`backends/claude-sdk.ts` | 改 `mapResultSubtype` 签名收整条 message + 先查 `is_error`；同步改 `result` case 调用点（§5bis.2）。 |
| C54e | `test(runtime): regress SDK success+is_error result → error` | ~同 C54c 测试文件 | `subtype:'success',is_error:true`（API 400）→ error_during_execution；`success,is_error:false`→completed；保留 limit 子类型映射。 |

### Phase 9 — 文档（一次一处）

| # | commit | 文件 | 改动 |
|---|---|---|---|
| C60 | `docs: mark stdio backend migration done in progress` | ~`docs/progress.md` | 当前状态 + 已完成 |
| C61 | `docs: tick stdio migration in roadmap` | ~`docs/roadmap.md` | 打勾 |
| C62 | `docs: add stdio migration follow-ups to backlog` | ~`docs/backlog.md` | 见 §8 全部条目 |

> **合计 66 个原子提交**（C1–C62 + C54b/c/d/e）。若执行中发现某提交还能再拆（例如某个 line-handler 分支可独立），就再拆，不要合并。反向不允许：不要把两个独立改动塞进一个提交。

---

## 8. 必须写入 backlog 的条目（C62）

```markdown
### 🟡 stdio 迁移后续：移除 SDK 依赖
- 发现于 2026-06-16，stdio 迁移
- claude-stdio 经 QA 稳定后，删除 @anthropic-ai/claude-agent-sdk 依赖 + claude-sdk.ts + claude-sdk 译码重复代码
- 状态：open

### ✅ SDK 路径 tool_result 活动上报曾是死代码（已修 C54b）
- translateMessage 不处理 'user' 类型，SDK 模式下 tool_result 事件从不产生（ee19db8 引入）
- 两条路径都已修：stdio 处理 user 消息；SDK 加 translateUserMessage（C54b）
- 状态：done

### ✅ mapResultSubtype 不查 is_error（两路径已修）
- subtype:"success" + is_error:true（API 400）会被当成功上报
- stdio 的 stream-json.ts 一开始就查 is_error；claude-sdk.ts 的 mapResultSubtype 已改为先查 is_error（C54d）
- 状态：done

### 🟢 运行中消息注入（mid-run intervention）
- stdio backend 已保持 stdin 打开、能写 control_response
- 未接线：harness/MCP 把人类新消息作为 stream-json user 帧注入 stdin
- 依赖：backlog v0.6「无法中途干预 agent」
- 状态：open

### 🟢 thinking/effort 支持需验证 Bedrock resume
- 当前默认不传 --effort（thinking 关）
- 开启前需验证：--resume 时 claude 重放含 thinking signature 的历史是否被 Bedrock 代理拒绝
- 状态：open

### 🟢 stdio backend 不支持 custom CLI args 过滤
- multica 有 filterCustomArgs/blockedArgs；Agent-Larked 暂不开放用户自定义 args，未实现
- 若将来开放 agent 级 custom_args，需移植
- 状态：open

### 🟢 result 后是否需要主动 close stdin（待 QA 观察）
- 当前 result 后不关 stdin，靠 exit 事件 finish
- 若实测 agent 自然终止后进程不退 → 加 result→stdin.end()
- 状态：open
```

---

## 9. 验收

1. 全部单测绿：`npm run -w @flock/agent-runtime test`。
2. 端到端：spawn 一个 agent，观察 DB activity 出现 `message`/`tool_call`/`tool_result`；多轮（spawn→flock_wait→wake）不再 Bedrock 400。
3. abort：stop 一个运行中 agent，进程被 kill，状态转 dormant，不报 error。
4. `BACKEND_TYPE=claude-sdk` 仍可回退，且回退路径的三个 bug 已修（tool_result 复活、is_error 检查、env 过滤）。
5. 完成后开 `Code Reviewer` agent 审查 `backends/claude-stdio.ts` **和** `backends/claude-sdk.ts`（本次两文件都改了，CLAUDE.md 强制要求审查）。
