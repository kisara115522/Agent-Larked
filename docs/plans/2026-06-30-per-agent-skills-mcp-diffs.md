# Plan (diff 版): per-agent Skills + MCP 配置

> 审查人: Opus 4.7 | 日期: 2026-07-02 | 基于: `2026-06-30-per-agent-skills-mcp.md`
> 状态: 扩充完成,待执行
> 关联: 原计划的 30 个原子 commit,逐一核实源码 + 补 diff

---

## 0. 审查结论摘要

原计划事实核对完毕。核心断言(**C1/C2/C3/W1/W4/管道 slot 已存在**)均属实,但存在两处**关键错误必须修正**:

| 编号 | 原计划断言 | 事实 | 修正 |
|---|---|---|---|
| **⚠️ E1** | M0 "补 `PATCH /configs/global` (admin-only)"、"复用现有 admin 校验(v0.3.5 RBAC)" | **项目根本没有 admin 概念**。`profiles` 表无 `is_admin` 列 (`db.ts:8-22`),`flex-auth.ts` 只区分 agent/human,任何 human 注册即可通过认证。原计划引用的 v0.3.5 RBAC **不存在于当前代码**(仅在 `db.ts:531` 有注释"admin privileges on agent profiles",但没有对应字段) | M0 改为"human-only"(禁 agent 写),同时在 backlog 里补 admin 字段。或加 env `FLOCK_GLOBAL_CONFIG_ALLOWLIST` 白名单(简单粗暴) |
| **⚠️ E2** | 3.3b 说 "**M2 改:config_value 存整块 `{"mcpServers":{...}}` JSON,而非 MCPServerConfig[]**" | 事实上 `SpawnRequest.extraMcpServers: MCPServerConfig[]`(`agent-harness.ts:91`),`buildMcpServers` 直接 push (`agent-harness.ts:391-393`),再由 `mcp-config.ts:18` `writeMcpConfigToTemp(MCPServerConfig[])` 转换成 `{"mcpServers":{...}}` 写盘。要用整块 JSON 就得在 server 侧解析后转 `MCPServerConfig[]`,或改 harness 接口收 raw JSON。**两条路都可以,但计划里没写清楚在哪层转换** | 明确:server 侧 `getAgentRuntimeConfig` 读取整块 JSON、解析为 `MCPServerConfig[]`(**在 server 侧转,不改 harness 接口**);transport 类型判别在这里做 |

其他核实:

| 断言 | 结论 |
|---|---|
| `SpawnRequest.extraMcpServers` slot 存在 | ✅ `agent-harness.ts:91`,类型 `MCPServerConfig[]` |
| `buildMcpServers` = `[flock, ...extra]` | ✅ `agent-harness.ts:374-396` |
| `spawn()` 里 `mkdirSync(sessionCwd)` | ✅ `agent-harness.ts:161-165` |
| `callback-server.ts` 逐字段拷贝 body | ✅ `callback-server.ts:63-80`,15 个字段全部显式列出 |
| `getAgentRuntimeConfig` 只读 model/provider | ✅ `services/callback.ts:578-596`,SQL `WHERE config_type IN ('model','provider')` |
| `agentCallbackFields` 4 处 event 都 spread | ✅ 出现在 `dispatchPendingRoomWake:223`, `wakeDirectMessageAgent:527`, `notifyRuntimeSpawn:565`, `notifyTaskAssignment:644` |
| `configs.ts` 无 global 写入路由 | ✅ 全文只有 GET(第 79-81 读 global_configs)、PATCH(第 100-121 硬编码 `is_global=0`) |
| PATCH 硬编码 `is_global=0` | ✅ `configs.ts:113` `VALUES (?, ?, ?, 0, ?, ?)` |
| `resolveConfigAgentId` 存在 | ✅ `configs.ts:126-142`,human 可给任意 agent 写(越权面) |
| `db.ts` `agent_configs` / `global_configs` schema | ✅ `db.ts:274-291` |
| `shared/types.ts:435` `AgentConfigType` union 缺 model/provider | ✅ `types.ts:435` `'soul' \| 'agent_md' \| 'skills' \| 'mcp'` |
| `GlobalConfigType` 已含 skills/mcp | ✅ `types.ts:446` |
| `AgentSpawnOptions` / `SpawnRequest` 位置 | ✅ `agent-runner.ts:33-45` / `agent-harness.ts:60-92` |
| `handleSpawn` / `handleWake` 传参 | ✅ `runtime.ts:177-197` / `runtime.ts:199-224`,均调用 `runner.spawn(id, prompt, token, name, options)` |
| `MCPServerConfig` 结构 | ✅ `backends/types.ts:317-345`,含 stdio/sse |
| `settingSources: []` 位置 | ✅ `backends/claude-sdk.ts:77` |
| stdio 不传 `--setting-sources` | ✅ `claude-args.ts:16-34`,无该 flag |
| `AgentPage.tsx` 4 个 ConfigCard 占位 | ✅ `AgentPage.tsx:326-333`,Soul/Agent.md/Skills/MCP Tools |
| sessionCwd per-room | ✅ `agent-runner.ts:209-223` `resolveWorkspace`,有 room 时 `data/workspaces/rooms/<roomId>`(W4 属实) |
| W1 保留名 flock 无现有保护 | ✅ `buildMcpServers` 只是 push,无 name 去重/过滤 |

> 💡 **新发现 N1:** `configs.ts` 的 PATCH `is_global` 列语义是"该 agent config 是否从 global 继承",不是"global config",所以复用 `PATCH /configs` 加 `is_global=true` 入参**语义错**——原计划已识别但未强调。方案 A(独立 `PATCH /configs/global`)才对。
>
> 💡 **新发现 N2:** `configs.ts:71-97` GET `/configs` 已经**同时返回** `agent_configs` 和 `global_configs`,前端不需要新接口。UI 侧只需新增编辑,读逻辑复用。
>
> 💡 **新发现 N3:** 若走 3.3b "整块 JSON" 存储,`config_value` 是 JSON 字符串对象(不是 stringified obj-in-obj);M2 的读侧要:`JSON.parse(rawText)` → `{ mcpServers: {...} }` → 遍历 keys 转 `MCPServerConfig[]`。**多层 JSON 反序列化容易踩** —— 明确一步:PATCH 侧存的时候 `JSON.stringify(config_value)`(configs.ts:115 已经这么做),GET 侧 `JSON.parse` 得回 `{mcpServers:{...}}` 对象。
>
> 💡 **新发现 N4:** `runtime.ts:189-196` handleSpawn 和 `runtime.ts:216-223` handleWake **代码几乎一模一样**,可提炼公共 buildSpawnOptions,但本次不做。M6/S4 直接改两处。
>
> 💡 **新发现 N5:** `runtime/callback-server.ts:5-22` 的 `CallbackEvent` interface 比 `server/src/services/callback.ts:10-29` 的 interface **少字段**:server 侧无 `agent_id`(URL 参数)。两边 interface 独立,M4/S2 必须**同步改两边 + 加 body 拷贝**,共 3 处。

---

## 1. 修订后的原子提交清单

新增/调整的 commit:
- **M0 改为 human-only(而非 admin-only)**,理由见 E1
- **M0 拆两半:M0a(补 admin 字段) + M0b(补路由,用新字段鉴权)**,若不做 admin 则合并回单个 human-only PATCH。**本文按简化方案 M0(单提交,human-only)推进,admin 字段进 backlog。**
- **M2 存整块 mcpServers JSON,但在 server 侧转 `MCPServerConfig[]` 后透传**(修正 E2)
- 其余 commit 保留

顺序:M0 → M1 → M2 → M2b → M3 → M4 → M5 → M6 → M7 → M8 → M9 → M9b → S0 → S1..S8 → D1

---

## Phase A — Per-agent MCP

### M0 `feat(server): add human-only PATCH /configs/global for global defaults`

**目的:** 补齐 C1 缺口,让 `global_configs` 表能被写入。

**鉴权决策:** 项目无 admin,退而求次:限制 **只能 human token 写**,任何 agent token 禁写(agent 不该配置全局)。生产环境应加 admin 字段,进 backlog。

> ⚠️ **修正原计划:** 原计划 M0 写"admin-only,复用现有 admin 校验(v0.3.5 RBAC)"——**RBAC 不存在**。改为 `req.humanId && !req.agentId` 判定(有 humanId 且非 agent token 认证)。

**文件:** `packages/server/src/routes/configs.ts`(在 PATCH /configs 之后新增)

```diff
--- a/packages/server/src/routes/configs.ts
+++ b/packages/server/src/routes/configs.ts
@@ -1,6 +1,6 @@
 import { Router } from 'express';
 import type Database from 'better-sqlite3';
 import { flexAuthMiddleware, type FlexAuthenticatedRequest } from '../middleware/flex-auth.js';
-import { ErrorCode } from '@flock/shared';
+import { ErrorCode, type GlobalConfigType } from '@flock/shared';
 import { ServerError } from '../middleware/error.js';
 
@@ -119,10 +119,55 @@ export function configsRouter(db: Database.Database): Router {
     }
   });
 
+  // PATCH /configs/global — update global config (human-only)
+  //
+  // Global configs (skills, mcp) affect ALL agents. Only human sessions may
+  // write. Agents cannot self-elevate to overwrite global defaults.
+  //
+  // TODO(security): once profiles.is_admin lands, restrict to admins.
+  router.patch('/configs/global', flexAuth, (req: FlexAuthenticatedRequest, res, next) => {
+    try {
+      // Reject agent tokens outright: only humans may edit global defaults.
+      // (flexAuth sets both humanId and agentId for humans; agent-only requests
+      //  have humanId === undefined.)
+      if (!req.humanId) {
+        res.status(403).json({
+          error: { code: ErrorCode.FORBIDDEN, message: 'Only humans may edit global configs' },
+        });
+        return;
+      }
+
+      const { config_type, config_value } = req.body as {
+        config_type?: GlobalConfigType;
+        config_value?: unknown;
+      };
+
+      if (!config_type) {
+        res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'config_type is required' } });
+        return;
+      }
+      if (config_type !== 'skills' && config_type !== 'mcp') {
+        res.status(400).json({
+          error: { code: 'VALIDATION_ERROR', message: `config_type must be 'skills' or 'mcp', got '${config_type}'` },
+        });
+        return;
+      }
+
+      const now = new Date().toISOString();
+      db.prepare(`
+        INSERT INTO global_configs (config_type, config_value, created_at, updated_at)
+        VALUES (?, ?, ?, ?)
+        ON CONFLICT(config_type) DO UPDATE SET config_value = ?, updated_at = ?
+      `).run(config_type, JSON.stringify(config_value), now, now, JSON.stringify(config_value), now);
+
+      res.json({ ok: true });
+    } catch (err) {
+      next(err);
+    }
+  });
+
   return router;
 }
```

**验收:**
- humanToken 写全局 mcp → 200,再 GET /configs 能读到
- agentToken 写全局 → 403
- 非法 config_type → 400

**依赖:** 无

---

### M0b `test(server): PATCH /configs/global writes + reject agent tokens`

**文件:** `packages/server/src/__tests__/configs.test.ts`

```diff
--- a/packages/server/src/__tests__/configs.test.ts
+++ b/packages/server/src/__tests__/configs.test.ts
@@ -112,4 +112,55 @@ describe('Configs & Token Budgets API', () => {
       .expect(403);
   });
+
+  it('lets a human write global mcp config', async () => {
+    const mcp = {
+      mcpServers: {
+        echo: { type: 'stdio', command: 'echo', args: ['hi'] },
+      },
+    };
+
+    await request(app)
+      .patch('/configs/global')
+      .set('Authorization', `Bearer ${humanToken}`)
+      .send({ config_type: 'mcp', config_value: mcp })
+      .expect(200);
+
+    const res = await request(app)
+      .get('/configs')
+      .set('Authorization', `Bearer ${agentToken}`)
+      .expect(200);
+
+    expect(res.body.global_configs).toContainEqual({
+      config_type: 'mcp',
+      config_value: mcp,
+    });
+  });
+
+  it('rejects agent tokens writing global config', async () => {
+    await request(app)
+      .patch('/configs/global')
+      .set('Authorization', `Bearer ${agentToken}`)
+      .send({ config_type: 'mcp', config_value: { mcpServers: {} } })
+      .expect(403);
+  });
+
+  it('rejects invalid config_type on global patch', async () => {
+    await request(app)
+      .patch('/configs/global')
+      .set('Authorization', `Bearer ${humanToken}`)
+      .send({ config_type: 'model', config_value: 'x' })
+      .expect(400);
+  });
+
+  it('upserts global config (last write wins per type)', async () => {
+    await request(app)
+      .patch('/configs/global')
+      .set('Authorization', `Bearer ${humanToken}`)
+      .send({ config_type: 'skills', config_value: [{ name: 'a', description: '', body: '' }] })
+      .expect(200);
+    await request(app)
+      .patch('/configs/global')
+      .set('Authorization', `Bearer ${humanToken}`)
+      .send({ config_type: 'skills', config_value: [{ name: 'b', description: '', body: '' }] })
+      .expect(200);
+    const res = await request(app).get('/configs').set('Authorization', `Bearer ${humanToken}`).expect(200);
+    const skills = res.body.global_configs.find((c: { config_type: string }) => c.config_type === 'skills');
+    expect(skills.config_value).toEqual([{ name: 'b', description: '', body: '' }]);
+  });
 });
```

---

### M1 `feat(shared): add 'model'|'provider' to AgentConfigType union`

**目的:** 补 union drift。当前代码用字符串写 `'model'` / `'provider'` 但 union 不含,类型系统未拦截。

**文件:** `packages/shared/src/types.ts:435`

```diff
--- a/packages/shared/src/types.ts
+++ b/packages/shared/src/types.ts
@@ -432,7 +432,7 @@ export interface UpdateTokenBudgetRequest {
 
 // --- Agent Config ---
 
-export type AgentConfigType = 'soul' | 'agent_md' | 'skills' | 'mcp';
+export type AgentConfigType = 'soul' | 'agent_md' | 'skills' | 'mcp' | 'model' | 'provider';
 
 export interface AgentConfig {
   config_type: AgentConfigType;
```

**依赖:** 无

---

### M2 `feat(server): read 'mcp' config + merge global in getAgentRuntimeConfig`

**目的:** 让 server 在构造 CallbackEvent 前读取 mcp 配置,并合并 global。

> 💡 **修正原计划的存储格式:** 原计划 3.3b 说"config_value 存整块 `{"mcpServers":{...}}` JSON",但没说清透传给 runtime 的是 raw JSON 还是转好的 `MCPServerConfig[]`。**本文明确:server 侧读整块 JSON → 解析为 `MCPServerConfig[]`(这是 harness 期望的类型) → 塞进 event.agent_mcp_servers**。runtime 侧收到已解析的数组,直接透传。

**文件:** `packages/server/src/services/callback.ts:41-596`

```diff
--- a/packages/server/src/services/callback.ts
+++ b/packages/server/src/services/callback.ts
@@ -38,10 +38,32 @@ interface RuntimeRow {
   status: string;
 }
 
+/** Shape written by runtime harness (mirror of runtime MCPServerConfig).
+ *  Kept locally to avoid a shared-package cross-import from server; the wire
+ *  contract is validated by the runtime side. */
+export interface McpServerWire {
+  name: string;
+  transport:
+    | { type: 'stdio'; command: string; args?: string[]; env?: Record<string, string> }
+    | { type: 'sse'; url: string; headers?: Record<string, string> };
+}
+
 interface AgentRuntimeConfig {
   model?: string;
   provider?: unknown;
+  mcpServers?: McpServerWire[];
 }
 
 interface AgentCallbackFields {
   agent_token?: string;
   agent_name?: string;
   agent_model?: string;
   agent_provider?: unknown;
+  agent_mcp_servers?: McpServerWire[];
 }
```

`getAgentRuntimeConfig` 扩展:

```diff
 function getAgentRuntimeConfig(db: Database.Database, agentId: string): AgentRuntimeConfig {
+  // Only read per-agent mcp/skills when the feature flag is on (W3 gate).
+  // Model/provider are always read (existing behavior).
+  const perAgentMcpEnabled = process.env.FLOCK_PER_AGENT_MCP === '1';
+
   const rows = db.prepare(`
     SELECT config_type, config_value
     FROM agent_configs
-    WHERE agent_id = ? AND config_type IN ('model', 'provider')
+    WHERE agent_id = ? AND config_type IN ('model', 'provider', 'mcp')
   `).all(agentId) as Array<{ config_type: string; config_value: string }>;
 
+  const globalRows = perAgentMcpEnabled
+    ? db.prepare(`SELECT config_type, config_value FROM global_configs WHERE config_type = 'mcp'`)
+        .all() as Array<{ config_type: string; config_value: string }>
+    : [];
+
   const config: AgentRuntimeConfig = {};
   for (const row of rows) {
     const value = parseConfigValue(row.config_value);
     if (row.config_type === 'model' && typeof value === 'string' && value.trim()) {
       config.model = value.trim();
     }
     if (row.config_type === 'provider' && value !== null && value !== undefined && value !== '') {
       config.provider = value;
     }
   }
+
+  if (perAgentMcpEnabled) {
+    // Merge: global base ← agent override. Both stored as {"mcpServers":{name:{...}}}.
+    // Agent's same-name entry overrides global. Key is server name.
+    const merged: Record<string, McpServerWire['transport']> = {};
+    for (const row of globalRows) {
+      collectMcpServers(row.config_value, merged);
+    }
+    for (const row of rows) {
+      if (row.config_type === 'mcp') collectMcpServers(row.config_value, merged);
+    }
+    const list = Object.entries(merged).map(([name, transport]) => ({ name, transport }));
+    if (list.length > 0) config.mcpServers = list;
+  }
+
   return config;
 }
+
+/** Parse a stored mcp config (JSON `{mcpServers:{name:{...}}}`), validate
+ *  transport, and merge into `out` (last write wins per name). Silently drops
+ *  invalid entries — server must never crash a spawn on a malformed config. */
+function collectMcpServers(raw: string, out: Record<string, McpServerWire['transport']>): void {
+  const parsed = parseConfigValue(raw);
+  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
+  const servers = (parsed as { mcpServers?: unknown }).mcpServers;
+  if (!servers || typeof servers !== 'object' || Array.isArray(servers)) return;
+  for (const [name, entry] of Object.entries(servers as Record<string, unknown>)) {
+    if (!entry || typeof entry !== 'object') continue;
+    const e = entry as Record<string, unknown>;
+    if (e.type === 'stdio' && typeof e.command === 'string' && e.command.trim()) {
+      out[name] = {
+        type: 'stdio',
+        command: e.command,
+        ...(Array.isArray(e.args) ? { args: e.args.filter((a): a is string => typeof a === 'string') } : {}),
+        ...(e.env && typeof e.env === 'object' && !Array.isArray(e.env)
+          ? { env: Object.fromEntries(Object.entries(e.env as Record<string, unknown>)
+              .filter((kv): kv is [string, string] => typeof kv[1] === 'string')) }
+          : {}),
+      };
+    } else if (e.type === 'sse' && typeof e.url === 'string' && e.url.trim()) {
+      out[name] = {
+        type: 'sse',
+        url: e.url,
+        ...(e.headers && typeof e.headers === 'object' && !Array.isArray(e.headers)
+          ? { headers: Object.fromEntries(Object.entries(e.headers as Record<string, unknown>)
+              .filter((kv): kv is [string, string] => typeof kv[1] === 'string')) }
+          : {}),
+      };
+    }
+    // Unknown transport → dropped silently.
+  }
+}
```

**依赖:** M0(为了让 global_configs 有数据可读)

---

### M2b `feat(server): filter reserved name 'flock' from merged mcp servers`

**目的:** W1,防用户在 mcp config 里塞 `"flock"` 覆盖内置 server。

**文件:** `packages/server/src/services/callback.ts` `collectMcpServers` 后追加

```diff
--- a/packages/server/src/services/callback.ts
+++ b/packages/server/src/services/callback.ts
@@ -XXX,6 +XXX,7 @@ function collectMcpServers(raw: string, out: Record<string, McpServerWire['trans
   for (const [name, entry] of Object.entries(servers as Record<string, unknown>)) {
+    if (name === 'flock') continue; // reserved: built-in flock server name (W1)
     if (!entry || typeof entry !== 'object') continue;
     const e = entry as Record<string, unknown>;
```

**验收:** 单测:agent 配 `mcpServers.flock` → 合并结果不含 flock 名(留给 harness 自动加内置 flock)

**依赖:** M2

---

### M3 `feat(server): expose mcp_servers via agentCallbackFields`

**目的:** 让 4 处 CallbackEvent 构造点自动带上 `agent_mcp_servers`。

**文件:** `packages/server/src/services/callback.ts:301-315`

```diff
--- a/packages/server/src/services/callback.ts
+++ b/packages/server/src/services/callback.ts
@@ -301,15 +301,16 @@ function resolveRoomMeta(
 function agentCallbackFields(
   db: Database.Database,
   agentId: string,
   agent?: { name: string; model: string | null },
   token?: string,
 ): AgentCallbackFields {
   const profile = agent ?? db.prepare('SELECT name, model FROM profiles WHERE id = ?').get(agentId) as { name: string; model: string | null } | undefined;
   const config = getAgentRuntimeConfig(db, agentId);
   return {
     agent_token: token,
     agent_name: profile?.name,
     agent_model: config.model ?? profile?.model ?? undefined,
     agent_provider: config.provider,
+    agent_mcp_servers: config.mcpServers,
   };
 }
```

**依赖:** M2

---

### M4 `feat(callback): thread agent_mcp_servers through CallbackEvent + body copy`

**目的:** 修正 C2。**注意有 3 处 interface / 拷贝要同步改**。

**文件 1:** `packages/server/src/services/callback.ts:10-29`

```diff
--- a/packages/server/src/services/callback.ts
+++ b/packages/server/src/services/callback.ts
@@ -14,6 +14,7 @@ export interface CallbackEvent {
   session_id?: string;
   agent_model?: string;
   agent_provider?: unknown;
+  agent_mcp_servers?: McpServerWire[];
   prompt?: string;
   trigger_type?: string;
```

**文件 2:** `packages/runtime/src/callback-server.ts:5-22`

```diff
--- a/packages/runtime/src/callback-server.ts
+++ b/packages/runtime/src/callback-server.ts
@@ -1,7 +1,20 @@
 import express from 'express';
 import { createHmac, timingSafeEqual } from 'node:crypto';
 import type { RuntimeConfig } from './config.js';
+import type { MCPServerConfig } from './backends/types.js';
 
 export interface CallbackEvent {
@@ -12,6 +25,7 @@ export interface CallbackEvent {
   session_id?: string;
   agent_model?: string;
   agent_provider?: unknown;
+  agent_mcp_servers?: MCPServerConfig[];
   prompt?: string;
   trigger_type?: string;
```

**文件 3(易漏!):** `packages/runtime/src/callback-server.ts:63-80` body 拷贝

```diff
--- a/packages/runtime/src/callback-server.ts
+++ b/packages/runtime/src/callback-server.ts
@@ -66,6 +66,7 @@ export function createCallbackServer(
       session_id: req.body.session_id,
       agent_model: req.body.agent_model,
       agent_provider: req.body.agent_provider,
+      agent_mcp_servers: req.body.agent_mcp_servers,
       prompt: req.body.prompt,
       trigger_type: req.body.trigger_type,
       room_id: req.body.room_id,
```

**验收:** 单测:构造 req.body.agent_mcp_servers → handler 收到的 event.agent_mcp_servers 非空

**依赖:** M3

---

### M5 `feat(runtime): add extraMcpServers to AgentSpawnOptions`

**文件:** `packages/runtime/src/agent-runner.ts:33-45`

```diff
--- a/packages/runtime/src/agent-runner.ts
+++ b/packages/runtime/src/agent-runner.ts
@@ -1,7 +1,7 @@
 import { randomUUID } from 'node:crypto';
 import path from 'node:path';
 import { fileURLToPath } from 'node:url';
 import { AgentHarness, type SpawnRequest, type RoomContext } from './harness/index.js';
-import type { BackendConfig } from './backends/types.js';
+import type { BackendConfig, MCPServerConfig } from './backends/types.js';
 import { defaultBackendRegistry } from './harness/backend-registry.js';
@@ -42,6 +42,8 @@ export interface AgentSpawnOptions {
   /** Raw rooms.workspace value from the server (may be empty/undefined).
    *  Resolved to an absolute path on THIS runtime via resolveWorkspace(). */
   roomWorkspace?: string;
+  /** Extra MCP servers (beyond built-in flock). Already flock-filtered by server. */
+  extraMcpServers?: MCPServerConfig[];
 }
```

同时在 `spawn()` 构造 `SpawnRequest` 时透传:

```diff
--- a/packages/runtime/src/agent-runner.ts
+++ b/packages/runtime/src/agent-runner.ts
@@ -134,6 +136,7 @@ export class AgentRunner {
       env: mergedEnv,
       room: options?.room,
       cwd: resolveWorkspace(agentId, options?.room?.roomId, options?.roomWorkspace),
+      extraMcpServers: options?.extraMcpServers,
     };
```

**依赖:** M4(runtime CallbackEvent 已有字段)

---

### M6 `feat(runtime): populate extraMcpServers from callback event in handleSpawn/handleWake`

**文件:** `packages/runtime/src/runtime.ts:177-224`

```diff
--- a/packages/runtime/src/runtime.ts
+++ b/packages/runtime/src/runtime.ts
@@ -186,10 +186,11 @@ export class FlockAgentRuntime {
     prompt += '\n\nIMPORTANT: After responding, call flock_wait to wait for the next message. Do NOT exit. Stay available.';
 
     await this.runner.spawn(event.agent_id, prompt, event.agent_token, event.agent_name, {
       sessionId: event.session_id,
       model: event.agent_model,
       provider: normalizeProvider(event.agent_provider),
       backendConfig: this.config.defaultBackend,
       room: buildRoomContext(event),
       roomWorkspace: event.room_workspace,
+      extraMcpServers: event.agent_mcp_servers,
     });
   }
 
@@ -215,10 +216,11 @@ export class FlockAgentRuntime {
     prompt += '\n\nIMPORTANT: After responding, call flock_wait to wait for the next message. Do NOT exit. Stay available.';
 
     await this.runner.spawn(event.agent_id, prompt, event.agent_token, event.agent_name, {
       sessionId: event.session_id,
       model: event.agent_model,
       provider: normalizeProvider(event.agent_provider),
       backendConfig: this.config.defaultBackend,
       room: buildRoomContext(event),
       roomWorkspace: event.room_workspace,
+      extraMcpServers: event.agent_mcp_servers,
     });
   }
```

**依赖:** M5

---

### M7 `test(server): getAgentRuntimeConfig merges mcp + filters flock`

**文件:** 新建 `packages/server/src/__tests__/mcp-config-merge.test.ts`

```diff
--- /dev/null
+++ b/packages/server/src/__tests__/mcp-config-merge.test.ts
@@ -0,0 +1,89 @@
+import { describe, it, expect, beforeEach, afterEach } from 'vitest';
+import request from 'supertest';
+import type { Express } from 'express';
+import type Database from 'better-sqlite3';
+import { createApp } from '../index.js';
+import { bootstrapDefaultAgent } from '../db.js';
+import { hashToken } from '../middleware/auth.js';
+
+describe('per-agent MCP config merge', () => {
+  let app: Express;
+  let db: Database.Database;
+  let humanToken: string;
+  let agentToken: string;
+  let agentId: string;
+  const savedEnv = process.env.FLOCK_PER_AGENT_MCP;
+
+  beforeEach(async () => {
+    process.env.FLOCK_PER_AGENT_MCP = '1';
+    ({ app, db } = createApp());
+    bootstrapDefaultAgent(db, hashToken);
+
+    const reg = await request(app).post('/agents').send({ name: 'McpBot' }).expect(201);
+    agentToken = reg.body.token; agentId = reg.body.id;
+
+    const human = await request(app).post('/human/register')
+      .send({ username: 'mcp-admin', password: 'test-pass-123' }).expect(201);
+    humanToken = human.body.token;
+  });
+
+  afterEach(() => {
+    if (savedEnv === undefined) delete process.env.FLOCK_PER_AGENT_MCP;
+    else process.env.FLOCK_PER_AGENT_MCP = savedEnv;
+  });
+
+  it('agent same-name overrides global; unique names union', async () => {
+    await request(app).patch('/configs/global').set('Authorization', `Bearer ${humanToken}`)
+      .send({ config_type: 'mcp', config_value: { mcpServers: {
+        shared: { type: 'stdio', command: 'globalCmd' },
+        globalOnly: { type: 'stdio', command: 'g' },
+      } } }).expect(200);
+
+    await request(app).patch('/configs').set('Authorization', `Bearer ${agentToken}`)
+      .send({ config_type: 'mcp', config_value: { mcpServers: {
+        shared: { type: 'stdio', command: 'agentCmd' },
+        agentOnly: { type: 'stdio', command: 'a' },
+      } } }).expect(200);
+
+    const { getAgentRuntimeConfigForTests } = await import('../services/callback.js');
+    const config = getAgentRuntimeConfigForTests(db, agentId);
+    const names = Object.fromEntries((config.mcpServers ?? []).map(s => [s.name, s.transport]));
+    expect(names.shared).toMatchObject({ type: 'stdio', command: 'agentCmd' });
+    expect(names.globalOnly).toMatchObject({ command: 'g' });
+    expect(names.agentOnly).toMatchObject({ command: 'a' });
+  });
+
+  it("drops reserved name 'flock'", async () => {
+    await request(app).patch('/configs').set('Authorization', `Bearer ${agentToken}`)
+      .send({ config_type: 'mcp', config_value: { mcpServers: {
+        flock: { type: 'stdio', command: 'evil' },
+        other: { type: 'stdio', command: 'ok' },
+      } } }).expect(200);
+
+    const { getAgentRuntimeConfigForTests } = await import('../services/callback.js');
+    const config = getAgentRuntimeConfigForTests(db, agentId);
+    const names = (config.mcpServers ?? []).map(s => s.name);
+    expect(names).not.toContain('flock');
+    expect(names).toContain('other');
+  });
+
+  it('returns undefined mcpServers when flag off', async () => {
+    delete process.env.FLOCK_PER_AGENT_MCP;
+    await request(app).patch('/configs').set('Authorization', `Bearer ${agentToken}`)
+      .send({ config_type: 'mcp', config_value: { mcpServers: { x: { type: 'stdio', command: 'c' } } } }).expect(200);
+
+    const { getAgentRuntimeConfigForTests } = await import('../services/callback.js');
+    const config = getAgentRuntimeConfigForTests(db, agentId);
+    expect(config.mcpServers).toBeUndefined();
+  });
+
+  it('drops invalid transports silently', async () => {
+    await request(app).patch('/configs').set('Authorization', `Bearer ${agentToken}`)
+      .send({ config_type: 'mcp', config_value: { mcpServers: {
+        good: { type: 'stdio', command: 'ok' },
+        badNoCommand: { type: 'stdio' },
+        badUnknown: { type: 'weird' },
+      } } }).expect(200);
+    const { getAgentRuntimeConfigForTests } = await import('../services/callback.js');
+    const config = getAgentRuntimeConfigForTests(db, agentId);
+    const names = (config.mcpServers ?? []).map(s => s.name);
+    expect(names).toEqual(['good']);
+  });
+});
```

> ⚠️ 需要在 `callback.ts` **export 一个测试专用别名**(避免暴露私有):
> ```ts
> export const getAgentRuntimeConfigForTests = getAgentRuntimeConfig;
> ```

**依赖:** M2b + M0

---

### M8 `test(runtime): callback-server preserves agent_mcp_servers; spawn forwards it`

**文件:** `packages/runtime/src/__tests__/callback-server.test.ts` (若不存在则新建);另加 harness spawn 测试到 `agent-harness.test.ts`

```diff
--- /dev/null
+++ b/packages/runtime/src/__tests__/callback-mcp.test.ts
@@ -0,0 +1,58 @@
+import { describe, it, expect } from 'vitest';
+import request from 'supertest';
+import type { CallbackEvent } from '../callback-server.js';
+import { createCallbackServer } from '../callback-server.js';
+
+describe('callback-server body copy: agent_mcp_servers', () => {
+  it('threads agent_mcp_servers from body into event', async () => {
+    let received: CallbackEvent | undefined;
+    const app = createCallbackServer(
+      { callbackSecret: null } as unknown as Parameters<typeof createCallbackServer>[0],
+      async (ev) => { received = ev; },
+    );
+
+    const mcpServers = [
+      { name: 'echo', transport: { type: 'stdio' as const, command: 'echo' } },
+    ];
+
+    await request(app)
+      .post('/agents/abc/callback')
+      .send({ type: 'spawn', agent_mcp_servers: mcpServers })
+      .expect(200);
+
+    expect(received?.agent_mcp_servers).toEqual(mcpServers);
+  });
+});
```

Harness 侧新增测试(如果 harness 已有测试文件,追加即可):

```diff
--- /dev/null
+++ b/packages/runtime/src/__tests__/harness-mcp.test.ts
@@ -0,0 +1,45 @@
+import { describe, it, expect } from 'vitest';
+import { AgentHarness } from '../harness/agent-harness.js';
+import type { MCPServerConfig } from '../backends/types.js';
+
+describe('AgentHarness buildMcpServers', () => {
+  it('prepends built-in flock, appends extraMcpServers', () => {
+    const harness = new AgentHarness({
+      flockServerUrl: 'http://x', cwd: '/tmp', mcpServerPath: '/tmp/mcp.js',
+      dbPath: '/tmp/db', reportActivity: async () => {},
+    });
+
+    const extra: MCPServerConfig[] = [
+      { name: 'echo', transport: { type: 'stdio', command: 'echo' } },
+    ];
+    // buildMcpServers is private; use bracket-access for test.
+    const servers = (harness as unknown as {
+      buildMcpServers: (req: { agentName: string; agentToken?: string; extraMcpServers?: MCPServerConfig[] }) => MCPServerConfig[];
+    }).buildMcpServers({ agentName: 'x', extraMcpServers: extra });
+
+    expect(servers[0].name).toBe('flock');
+    expect(servers[1].name).toBe('echo');
+  });
+});
```

**依赖:** M6 + M4

---

### M9 `feat(server+runtime): gate per-agent MCP behind FLOCK_PER_AGENT_MCP flag`

**目的:** W3 安全门控。默认关闭,`FLOCK_PER_AGENT_MCP=1` 才启用。

> 💡 **合并说明:** M2 已经做了 `perAgentMcpEnabled` 判定(避免拆两次改同一函数),所以这里主要是**补文档和 CLI 校验**。若严格按原计划拆分:M2 只加读取,M9 加 flag——但那样 M2 无 flag 保护先落地不安全。**扩充版建议合并:M2 直接带 flag,M9 简化为"补 UI 门控 + 环境变量文档"**。

**文件 1:** `packages/server/src/services/callback.ts` — 已在 M2 中包含 `process.env.FLOCK_PER_AGENT_MCP === '1'` 判定,此提交无代码变更(空提交或合并到 M2)。

**文件 2:** `packages/server/src/config.ts` (如果存在类似 env 集中管理),否则跳过。

**文件 3(实际改动):** README + `.env.example`

```diff
--- a/.env.example
+++ b/.env.example
@@ -X,0 +X,3 @@
+# Enable per-agent MCP server configuration (default off, security-sensitive).
+# When enabled, agent_configs('mcp') is read + merged with global_configs('mcp')
+# and forwarded to the runtime. per-agent MCP command = runtime host RCE surface.
+FLOCK_PER_AGENT_MCP=0
```

**建议:** M9 与 M2 合并,提交信息标注"gated by env from the start"。

**依赖:** M2

---

### M9b `feat(web): wire MCP config card to PATCH /configs`

**目的:** 前端接入 MCP 编辑。

**文件:** `packages/web/src/pages/AgentPage.tsx`

改动分两部分:
1. 加 state / 加载已有 mcp config
2. `ConfigCard` "M" MCP Tools 改为可点开的 JSON 编辑器 modal

```diff
--- a/packages/web/src/pages/AgentPage.tsx
+++ b/packages/web/src/pages/AgentPage.tsx
@@ -56,6 +56,9 @@ export function AgentPage() {
   const [modelValue, setModelValue] = useState('');
   const [providerValue, setProviderValue] = useState('');
   const [providerEnvValue, setProviderEnvValue] = useState('');
+  const [mcpValue, setMcpValue] = useState('');
+  const [mcpEditorOpen, setMcpEditorOpen] = useState(false);
+  const [savingMcp, setSavingMcp] = useState(false);
   const [savingConfig, setSavingConfig] = useState(false);
   const [loading, setLoading] = useState(true);
 
@@ -85,6 +88,8 @@ export function AgentPage() {
       } else {
         setProviderValue('');
         setProviderEnvValue('');
       }
+      const mcpConfig = configRes.agent_configs.find(c => c.config_type === 'mcp')?.config_value;
+      setMcpValue(mcpConfig ? JSON.stringify(mcpConfig, null, 2) : '');
       // Convert activity logs to workflow events
```

Save MCP handler:

```diff
--- a/packages/web/src/pages/AgentPage.tsx
+++ b/packages/web/src/pages/AgentPage.tsx
@@ -193,6 +196,25 @@ export function AgentPage() {
   };
 
+  const handleSaveMcp = async () => {
+    if (!token || !id) return;
+    setSavingMcp(true);
+    try {
+      const parsed = mcpValue.trim() ? JSON.parse(mcpValue) : { mcpServers: {} };
+      if (!parsed.mcpServers || typeof parsed.mcpServers !== 'object') {
+        throw new Error('JSON must be {"mcpServers": {...}}');
+      }
+      await patch('/configs', token, { agent_id: id, config_type: 'mcp', config_value: parsed });
+      toast('MCP 配置已保存', 'success');
+      setMcpEditorOpen(false);
+      loadAgent();
+    } catch (e) {
+      toast(`保存失败: ${e instanceof Error ? e.message : '未知错误'}`);
+    } finally {
+      setSavingMcp(false);
+    }
+  };
+
   if (loading) {
```

替换 `ConfigCard` "M":

```diff
--- a/packages/web/src/pages/AgentPage.tsx
+++ b/packages/web/src/pages/AgentPage.tsx
@@ -327,10 +349,32 @@ export function AgentPage() {
             <Panel title="配置文件">
               <div className="p-3 grid grid-cols-2 gap-2.5">
               <ConfigCard marker="S" title="Soul" desc="人格描述、行为准则" badge="—" badgeClass="bg-surface-elevated text-text-muted border border-border" />
               <ConfigCard marker="A" title="Agent.md" desc="能力定义、工作方式" badge="—" badgeClass="bg-surface-elevated text-text-muted border border-border" />
               <ConfigCard marker="K" title="Skills" desc="继承全局配置" badge="—" badgeClass="bg-surface-elevated text-text-muted border border-border" />
-              <ConfigCard marker="M" title="MCP Tools" desc="工具接入配置" badge="—" badgeClass="bg-surface-elevated text-text-muted border border-border" />
+              <button type="button" onClick={() => setMcpEditorOpen(true)} className="text-left">
+                <ConfigCard
+                  marker="M"
+                  title="MCP Tools"
+                  desc="工具接入配置"
+                  badge={mcpValue.trim() ? '已配置' : '未配置'}
+                  badgeClass={mcpValue.trim() ? 'bg-accent-muted text-accent' : 'bg-surface-elevated text-text-muted border border-border'}
+                />
+              </button>
             </div>
             </Panel>
+
+            {mcpEditorOpen && (
+              <Panel title="MCP JSON 编辑">
+                <div className="p-4 space-y-3">
+                  <textarea
+                    value={mcpValue}
+                    onChange={e => setMcpValue(e.target.value)}
+                    placeholder='{"mcpServers":{"echo":{"type":"stdio","command":"echo","args":["hi"]}}}'
+                    className="input min-h-[220px] font-mono text-[11px] resize-y w-full"
+                  />
+                  <div className="flex gap-2 justify-end">
+                    <button onClick={() => setMcpEditorOpen(false)} className="px-3 py-1.5 rounded-full text-xs bg-surface-elevated">取消</button>
+                    <button onClick={handleSaveMcp} disabled={savingMcp} className="px-3 py-1.5 rounded-full text-xs bg-accent text-white disabled:opacity-40">
+                      {savingMcp ? '保存中...' : '保存'}
+                    </button>
+                  </div>
+                </div>
+              </Panel>
+            )}
           </aside>
```

> 💡 UI 侧目前无法读取 server 的 flag 状态。**可选补一个 `GET /configs/features` 返回 `{per_agent_mcp: true}`**,前端根据此禁用/隐藏 MCP 卡片。本 commit 简化:不做门控,编辑始终可用(只是 flag 关时后端不透传)。加 badge 或提示"需 server 启用 FLOCK_PER_AGENT_MCP"。

**依赖:** M0

---

### M10 (端到端验证,不提交)

- 启动 server + runtime 时导出 `FLOCK_PER_AGENT_MCP=1`
- UI 给某 agent 配 `{"mcpServers":{"echo":{"type":"stdio","command":"npx","args":["-y","@modelcontextprotocol/server-everything"]}}}`
- 触发 spawn → 观察 `/tmp/flock-mcp-*/mcp-config.json` 含 flock + echo
- claude 子进程 `/mcp` 命令可见 echo server 的工具

---

## Phase B — Per-agent Skills

### S0 (双 backend 实测,不提交)

**stdio backend:**
```bash
mkdir -p /tmp/skill-test/.claude/skills/test-skill
cat > /tmp/skill-test/.claude/skills/test-skill/SKILL.md <<'EOF'
---
name: test-skill
description: A test skill for discovery verification
---
Write "SKILL_LOADED" if user asks about test-skill.
EOF
cd /tmp/skill-test
claude -p "Do you have test-skill available?" --output-format stream-json --input-format stream-json --verbose
```

**SDK backend:** 用小脚本调用 `@anthropic-ai/claude-agent-sdk` `query()` with `settingSources: []` + 同 cwd,看是否发现。

**W4 子目录测试:** 把 SKILL.md 放到 `.claude/skills/<agentId>/test-skill/SKILL.md`,看是否发现。

**决策矩阵:**
- stdio ✅ + SDK ✅ + 子目录 ✅ → Phase B 直接走 per-agent 子目录
- stdio ✅ + SDK ❌ + 子目录 ❌ → Phase B 仅 stdio 支持,SDK 走 Phase C
- stdio ❌ → 全走 Phase C

---

### S1 `feat(server): read 'skills' config + merge global`

**文件:** `packages/server/src/services/callback.ts`

```diff
--- a/packages/server/src/services/callback.ts
+++ b/packages/server/src/services/callback.ts
@@ -X,0 +X,7 @@
+export interface SkillDefinition {
+  name: string;
+  description: string;
+  body: string;
+}
+
 interface AgentRuntimeConfig {
   model?: string;
   provider?: unknown;
   mcpServers?: McpServerWire[];
+  skills?: SkillDefinition[];
 }
```

`getAgentRuntimeConfig` 追加:

```diff
--- a/packages/server/src/services/callback.ts
+++ b/packages/server/src/services/callback.ts
@@ -X,6 +X,7 @@ function getAgentRuntimeConfig(db, agentId): AgentRuntimeConfig {
   const perAgentMcpEnabled = process.env.FLOCK_PER_AGENT_MCP === '1';
+  const perAgentSkillsEnabled = process.env.FLOCK_PER_AGENT_SKILLS === '1';
 
   const rows = db.prepare(`
     SELECT config_type, config_value
     FROM agent_configs
-    WHERE agent_id = ? AND config_type IN ('model', 'provider', 'mcp')
+    WHERE agent_id = ? AND config_type IN ('model', 'provider', 'mcp', 'skills')
   `).all(agentId) as ...;
 
-  const globalRows = perAgentMcpEnabled
-    ? db.prepare(`SELECT config_type, config_value FROM global_configs WHERE config_type = 'mcp'`).all()
+  const globalRows = (perAgentMcpEnabled || perAgentSkillsEnabled)
+    ? db.prepare(`
+        SELECT config_type, config_value FROM global_configs
+        WHERE config_type IN ('mcp', 'skills')
+      `).all() as ...
     : [];
 
   ... existing mcp merge ...
 
+  if (perAgentSkillsEnabled) {
+    // Skills merged by name: agent overrides global.
+    const merged = new Map<string, SkillDefinition>();
+    for (const row of globalRows) {
+      if (row.config_type === 'skills') collectSkills(row.config_value, merged);
+    }
+    for (const row of rows) {
+      if (row.config_type === 'skills') collectSkills(row.config_value, merged);
+    }
+    if (merged.size > 0) config.skills = Array.from(merged.values());
+  }
+
   return config;
 }
+
+function collectSkills(raw: string, out: Map<string, SkillDefinition>): void {
+  const parsed = parseConfigValue(raw);
+  if (!Array.isArray(parsed)) return;
+  for (const entry of parsed) {
+    if (!entry || typeof entry !== 'object') continue;
+    const e = entry as Record<string, unknown>;
+    if (typeof e.name !== 'string' || !e.name.trim()) continue;
+    // Sanitize name (used as filesystem path): [a-zA-Z0-9_-] only.
+    if (!/^[a-zA-Z0-9_-]+$/.test(e.name)) continue;
+    out.set(e.name, {
+      name: e.name,
+      description: typeof e.description === 'string' ? e.description : '',
+      body: typeof e.body === 'string' ? e.body : '',
+    });
+  }
+}
```

**依赖:** M2

---

### S2 `feat(callback): thread agent_skills through CallbackEvent + body copy`

**3 处同步改**(和 M4 同款,C2)

**文件 1:** `packages/server/src/services/callback.ts`

```diff
 interface AgentCallbackFields {
   agent_token?: string;
   agent_name?: string;
   agent_model?: string;
   agent_provider?: unknown;
   agent_mcp_servers?: McpServerWire[];
+  agent_skills?: SkillDefinition[];
 }
 export interface CallbackEvent {
   ... existing ...
+  agent_skills?: SkillDefinition[];
 }
 
 function agentCallbackFields(...): AgentCallbackFields {
   ...
   return {
     ...
     agent_mcp_servers: config.mcpServers,
+    agent_skills: config.skills,
   };
 }
```

**文件 2:** `packages/runtime/src/callback-server.ts:5-22 + 63-80`

```diff
--- a/packages/runtime/src/callback-server.ts
+++ b/packages/runtime/src/callback-server.ts
@@ -1,3 +1,4 @@
 import express from 'express';
 import { createHmac, timingSafeEqual } from 'node:crypto';
 import type { RuntimeConfig } from './config.js';
 import type { MCPServerConfig } from './backends/types.js';
+
+export interface SkillDefinition { name: string; description: string; body: string; }
 
 export interface CallbackEvent {
   ...
   agent_mcp_servers?: MCPServerConfig[];
+  agent_skills?: SkillDefinition[];
   ...
 }
```

body 拷贝(易漏):

```diff
     const event: CallbackEvent = {
       ...
       agent_mcp_servers: req.body.agent_mcp_servers,
+      agent_skills: req.body.agent_skills,
       ...
     };
```

**依赖:** S1

---

### S3 `feat(runtime): add skills to AgentSpawnOptions + SpawnRequest`

**文件 1:** `packages/runtime/src/agent-runner.ts`

```diff
+import type { SkillDefinition } from './callback-server.js';
 
 export interface AgentSpawnOptions {
   ...
   extraMcpServers?: MCPServerConfig[];
+  skills?: SkillDefinition[];
 }
```

在 `spawn()` 里透传:

```diff
     const request: SpawnRequest = {
       ...
       extraMcpServers: options?.extraMcpServers,
+      skills: options?.skills,
     };
```

**文件 2:** `packages/runtime/src/harness/agent-harness.ts`

```diff
+import type { SkillDefinition } from '../callback-server.js';
 
 export interface SpawnRequest {
   ...
   extraMcpServers?: MCPServerConfig[];
+  /** Skills to materialize into sessionCwd/.claude/skills/ before spawn. */
+  skills?: SkillDefinition[];
 }
```

> ⚠️ **潜在依赖循环:** `harness/agent-harness.ts` 目前不 import `callback-server`。**改为在 harness 里定义 `SkillDefinition`**,callback-server 反过来 import harness——或者放到 `packages/runtime/src/types.ts` 共享。**推荐新建 `packages/runtime/src/types.ts`**:

```diff
--- /dev/null
+++ b/packages/runtime/src/types.ts
@@ -0,0 +1,5 @@
+export interface SkillDefinition {
+  name: string;
+  description: string;
+  body: string;
+}
```

两边都从此 import。

**依赖:** S2

---

### S4 `feat(runtime): pass skills through handleSpawn/handleWake`

**文件:** `packages/runtime/src/runtime.ts`(和 M6 同样两处)

```diff
     await this.runner.spawn(event.agent_id, prompt, event.agent_token, event.agent_name, {
       ...
       extraMcpServers: event.agent_mcp_servers,
+      skills: event.agent_skills,
     });
```

两处(handleSpawn / handleWake)都改。

**依赖:** S3

---

### S5 `feat(runtime): materialize skills to sessionCwd/.claude/skills/ (clear + write)`

**目的:** 物化 + 清理旧文件(借鉴 multica execenv:311)。

**文件:** `packages/runtime/src/harness/agent-harness.ts` `spawn()` 内

```diff
--- a/packages/runtime/src/harness/agent-harness.ts
+++ b/packages/runtime/src/harness/agent-harness.ts
@@ -19,7 +19,8 @@
 import { randomUUID } from 'node:crypto';
-import { mkdirSync } from 'node:fs';
+import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
+import { join } from 'node:path';
+import type { SkillDefinition } from '../types.js';
```

`spawn()` 里 mkdir 后追加:

```diff
     try {
       mkdirSync(sessionCwd, { recursive: true });
     } catch (err) {
       console.warn(`[harness] Failed to create session cwd ${sessionCwd}:`, err);
     }
 
+    // Materialize per-agent skills into sessionCwd/.claude/skills/
+    // Clear the directory first (borrowed from multica execenv:311) to prevent
+    // stale skills from prior sessions leaking into this one. per-room cwd is
+    // shared, so same-room siblings' skills would otherwise pile up.
+    materializeSkills(sessionCwd, request.skills);
+
     // Build run context
```

新增函数(文件末尾):

```diff
+/**
+ * Write skills into <sessionCwd>/.claude/skills/<name>/SKILL.md. Clears the
+ * entire .claude/skills/ directory first so that stale skills from previous
+ * sessions do not linger. No-op when `skills` is empty/undefined — leaves
+ * existing .claude/skills/ untouched (avoids clobbering unrelated content).
+ *
+ * KNOWN LIMITATION (W4): sessionCwd is per-room, so two agents in the same
+ * room will overwrite each other's skills. Once S0 verification confirms
+ * per-agent subdirectories are discoverable, migrate to
+ * <sessionCwd>/.claude/skills/<agentId>/<name>/SKILL.md.
+ */
+function materializeSkills(sessionCwd: string, skills: SkillDefinition[] | undefined): void {
+  if (!skills || skills.length === 0) return;
+
+  const skillsDir = join(sessionCwd, '.claude', 'skills');
+  try {
+    rmSync(skillsDir, { recursive: true, force: true });
+  } catch (err) {
+    console.warn(`[harness] Failed to clear ${skillsDir}:`, err);
+  }
+
+  for (const skill of skills) {
+    // Name sanitization already done server-side; belt-and-braces check.
+    if (!/^[a-zA-Z0-9_-]+$/.test(skill.name)) continue;
+    const dir = join(skillsDir, skill.name);
+    try {
+      mkdirSync(dir, { recursive: true });
+      const frontmatter = `---\nname: ${skill.name}\ndescription: ${skill.description}\n---\n\n`;
+      writeFileSync(join(dir, 'SKILL.md'), frontmatter + skill.body);
+    } catch (err) {
+      console.warn(`[harness] Failed to write skill ${skill.name} to ${dir}:`, err);
+    }
+  }
+}
```

**依赖:** S4

---

### S6 `test(runtime): harness materializes skills files`

**文件:** 新建 `packages/runtime/src/__tests__/harness-skills.test.ts`

```diff
--- /dev/null
+++ b/packages/runtime/src/__tests__/harness-skills.test.ts
@@ -0,0 +1,72 @@
+import { describe, it, expect, beforeEach, afterEach } from 'vitest';
+import { mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
+import { join } from 'node:path';
+import { tmpdir } from 'node:os';
+import { AgentHarness } from '../harness/agent-harness.js';
+import { BackendRegistry } from '../harness/backend-registry.js';
+
+describe('AgentHarness skills materialization', () => {
+  let cwd: string;
+  let harness: AgentHarness;
+
+  beforeEach(() => {
+    cwd = mkdtempSync(join(tmpdir(), 'flock-skill-test-'));
+    // Register a no-op backend so spawn doesn't actually run claude.
+    const registry = new BackendRegistry();
+    registry.register('claude-stdio', () => ({
+      name: 'claude-stdio',
+      run: async function* () { yield { type: 'result', subtype: 'completed', durationMs: 0, sessionId: 's' }; },
+      abort: () => {},
+    }) as any);
+    harness = new AgentHarness({
+      flockServerUrl: 'http://x', cwd, mcpServerPath: '/tmp/mcp.js', dbPath: '/tmp/db.sqlite',
+      backendRegistry: registry, reportActivity: async () => {},
+    });
+  });
+
+  afterEach(() => rmSync(cwd, { recursive: true, force: true }));
+
+  it('writes SKILL.md with frontmatter', async () => {
+    const session = await harness.spawn({
+      agentId: 'a1', agentName: 'A', prompt: 'x', cwd,
+      skills: [{ name: 'code-review', description: 'Review code', body: 'Do X.' }],
+    });
+    await session.promise.catch(() => {});
+    const p = join(cwd, '.claude', 'skills', 'code-review', 'SKILL.md');
+    expect(existsSync(p)).toBe(true);
+    const text = readFileSync(p, 'utf8');
+    expect(text).toContain('name: code-review');
+    expect(text).toContain('description: Review code');
+    expect(text).toContain('Do X.');
+  });
+
+  it('clears stale skills before writing (multica-style)', async () => {
+    const staleDir = join(cwd, '.claude', 'skills', 'stale');
+    mkdirSync(staleDir, { recursive: true });
+    writeFileSync(join(staleDir, 'SKILL.md'), 'STALE');
+
+    const session = await harness.spawn({
+      agentId: 'a2', agentName: 'A', prompt: 'x', cwd,
+      skills: [{ name: 'fresh', description: '', body: '' }],
+    });
+    await session.promise.catch(() => {});
+    expect(existsSync(join(cwd, '.claude', 'skills', 'stale'))).toBe(false);
+    expect(existsSync(join(cwd, '.claude', 'skills', 'fresh'))).toBe(true);
+  });
+
+  it('leaves .claude/skills/ untouched when skills is empty', async () => {
+    const existingDir = join(cwd, '.claude', 'skills', 'preexisting');
+    mkdirSync(existingDir, { recursive: true });
+    writeFileSync(join(existingDir, 'SKILL.md'), 'KEEP');
+
+    const session = await harness.spawn({ agentId: 'a3', agentName: 'A', prompt: 'x', cwd });
+    await session.promise.catch(() => {});
+    expect(readFileSync(join(existingDir, 'SKILL.md'), 'utf8')).toBe('KEEP');
+  });
+
+  it('rejects skill names with path traversal chars', async () => {
+    const session = await harness.spawn({
+      agentId: 'a4', agentName: 'A', prompt: 'x', cwd,
+      skills: [{ name: '../evil', description: '', body: '' }],
+    });
+    await session.promise.catch(() => {});
+    expect(existsSync(join(cwd, '.claude', 'skills', '..', 'evil'))).toBe(false);
+  });
+});
```

**依赖:** S5

---

### S7 `feat(web): wire Skills config card to PATCH /configs`

**文件:** `packages/web/src/pages/AgentPage.tsx`

和 M9b MCP 卡片对称,加 skills JSON 编辑器:

```diff
+  const [skillsValue, setSkillsValue] = useState('');
+  const [skillsEditorOpen, setSkillsEditorOpen] = useState(false);
+  const [savingSkills, setSavingSkills] = useState(false);
```

loadAgent:

```diff
+      const skillsConfig = configRes.agent_configs.find(c => c.config_type === 'skills')?.config_value;
+      setSkillsValue(skillsConfig ? JSON.stringify(skillsConfig, null, 2) : '');
```

handler:

```diff
+  const handleSaveSkills = async () => {
+    if (!token || !id) return;
+    setSavingSkills(true);
+    try {
+      const parsed = skillsValue.trim() ? JSON.parse(skillsValue) : [];
+      if (!Array.isArray(parsed)) throw new Error('Skills must be a JSON array');
+      await patch('/configs', token, { agent_id: id, config_type: 'skills', config_value: parsed });
+      toast('Skills 已保存', 'success');
+      setSkillsEditorOpen(false);
+      loadAgent();
+    } catch (e) {
+      toast(`保存失败: ${e instanceof Error ? e.message : '未知错误'}`);
+    } finally {
+      setSavingSkills(false);
+    }
+  };
```

改 ConfigCard "K":

```diff
-              <ConfigCard marker="K" title="Skills" desc="继承全局配置" badge="—" ... />
+              <button type="button" onClick={() => setSkillsEditorOpen(true)} className="text-left">
+                <ConfigCard marker="K" title="Skills" desc="继承全局配置"
+                  badge={skillsValue.trim() ? '已配置' : '未配置'}
+                  badgeClass={skillsValue.trim() ? 'bg-accent-muted text-accent' : 'bg-surface-elevated text-text-muted border border-border'}
+                />
+              </button>
```

编辑器 Panel(和 MCP 那个对称)。

**依赖:** S5

---

### S8 (端到端验证,不提交)

依赖 S0 决策矩阵。

---

## Phase C — 退路(prompt 注入)

若 S0 不通过或 SDK 必须支持 skills,`composeSystemPrompt` 加 skills 段:

**文件:** `packages/runtime/src/harness/prompt-composer.ts`

```diff
--- a/packages/runtime/src/harness/prompt-composer.ts
+++ b/packages/runtime/src/harness/prompt-composer.ts
@@ -X,0 +X,15 @@
+function getSkillsSection(skills?: SkillDefinition[]): string {
+  if (!skills || skills.length === 0) return '';
+  const lines = ['## Available skills (invoke by referencing the name):'];
+  for (const s of skills) {
+    lines.push(`### ${s.name}`);
+    if (s.description) lines.push(`_${s.description}_`);
+    if (s.body) lines.push(s.body);
+    lines.push('');
+  }
+  return lines.join('\n');
+}
```

在 `composeSystemPrompt` 拼接。ComposeOptions 加 `skills?: SkillDefinition[]` 字段;`spawn()` 传入。

**依赖:** S3

---

## Phase D — 文档

### D1 `docs: per-agent skills + mcp progress + backlog`

**文件:** `docs/progress.md` + `docs/backlog.md`

```diff
--- a/docs/progress.md
+++ b/docs/progress.md
@@ -X,0 +X,20 @@
+## 2026-07-XX — Per-agent MCP + Skills (Phase A + B)
+
+### Phase A: Per-agent MCP
+- 新增 `PATCH /configs/global`(human-only,C1 补齐)
+- `getAgentRuntimeConfig` 读 `agent_configs('mcp')` + `global_configs('mcp')`,同名 agent 覆盖 global
+- 保留名 `flock` 过滤(W1)
+- `agentCallbackFields` 输出 `agent_mcp_servers`(4 处 event 自动带)
+- `callback-server.ts` 显式拷贝 `agent_mcp_servers`(C2)
+- Runtime 透传 `extraMcpServers` 到 `SpawnRequest`(已有 slot)
+- 门控:`FLOCK_PER_AGENT_MCP=1` 才启用(W3)
+- UI:MCP 卡片接入 JSON 编辑器
+
+### Phase B: Per-agent Skills
+- `S0 实测结果:...`(填 stdio/sdk/子目录三个 case 结论)
+- `getAgentRuntimeConfig` 读 skills + 合并 global
+- Harness `spawn()` 物化到 `sessionCwd/.claude/skills/`(先清空)
+- 门控:`FLOCK_PER_AGENT_SKILLS=1`
+- UI:Skills 卡片接入编辑器
```

```diff
--- a/docs/backlog.md
+++ b/docs/backlog.md
@@ -X,0 +X,32 @@
+### 🟡 MCP server 配置深度安全(RCE 门控已加,越权面独立)
+- per-agent MCP command = runtime 主机 RCE。门控 `FLOCK_PER_AGENT_MCP` 默认关闭
+- **待补:** command/args 白名单校验、env secrets 加密存储
+- **越权面独立存在:** 现有 `configs.ts` PATCH(`resolveConfigAgentId`)允许任意 human 给任意 agent 写 config,已识别未修
+- 状态: open
+
+### 🔴 无 admin 概念,全局配置无强鉴权
+- **本次 M0 用 human-only 判定**,任何 human 都能改全局
+- **待补:** `profiles` 表加 `is_admin` 列(v0.5+ 迁移),PATCH /configs/global 改为 admin-only
+- 或改为 env `FLOCK_GLOBAL_CONFIG_ALLOWED_USERNAMES` 白名单
+- 状态: open
+
+### 🟢 skills 物化文件清理 + per-room 串味(W4)
+- `sessionCwd` 是 per-room 共享,同 room 多 agent 同名 skill 覆盖
+- S0 实测未通过时,当前是"最后 spawn 者的 skills 生效"
+- **待补:** 若 S0 证实 per-agent 子目录可用 → migrate 到 `<sessionCwd>/.claude/skills/<agentId>/<name>/`
+- 状态: open
+
+### 🟢 per-agent soul / agent_md
+- 本次只做 mcp + skills,soul/agent_md union 已声明未接
+- 后续:composeSystemPrompt 注入
+- 状态: open
+
+### 🟢 MCP 工具允许/禁止列表
+- 当前所有 extra MCP server 的工具都暴露
+- 后续:per-agent allowedTools/deniedTools + claude-args 动态 `--disallowedTools`
+- 状态: open
+
+### 🟢 features flag endpoint
+- UI 无法感知 server 是否开启 FLOCK_PER_AGENT_MCP/SKILLS
+- 后续:`GET /configs/features` 返回 flag 状态,前端条件隐藏卡片
+- 状态: open
```

**依赖:** 无

---

## 2. 关键决策 (修订)

沿用原计划 12 条 + 3 条修正:

13. **无 admin,M0 用 human-only。** admin 字段进 backlog。
14. **mcp 存整块 JSON `{"mcpServers":{...}}`,server 侧解析为 `MCPServerConfig[]` 后透传。** harness 收到已经是 `MCPServerConfig[]`。
15. **skills 名称做正则白名单 `[a-zA-Z0-9_-]+`(server + harness 两层)。** 防路径穿越。

---

## 3. 验收 (对照 §7 修订)

### Phase A
- ✅ 1-4 保留
- ✅ 5(保留名 flock 过滤)保留
- ✅ 6(flag 关闭时不透传)保留
- ⚠️ **7 修正:non-human 写全局 → 403**(不是 non-admin)
- ✅ 8-9 保留

### Phase B / Phase C / 回归 — 全部保留

---

## 4. 关键文件重列(核实后精确位置)

| 文件 | 关键锚点 |
|---|---|
| `packages/server/src/routes/configs.ts:100-121` | 现有 PATCH /configs;M0 新增 `PATCH /configs/global` 追加在末尾 |
| `packages/server/src/services/callback.ts:41-44` | `AgentRuntimeConfig` interface(M2 扩) |
| `packages/server/src/services/callback.ts:46-51` | `AgentCallbackFields` interface(M2/S1 扩) |
| `packages/server/src/services/callback.ts:10-29` | server 侧 `CallbackEvent` interface(M4/S2 扩) |
| `packages/server/src/services/callback.ts:301-315` | `agentCallbackFields`(M3 输出 mcp,S2 输出 skills) |
| `packages/server/src/services/callback.ts:578-596` | `getAgentRuntimeConfig`(M2/S1 扩) |
| `packages/runtime/src/callback-server.ts:5-22` | runtime 侧 `CallbackEvent`(M4/S2 扩) |
| `packages/runtime/src/callback-server.ts:63-80` | body 逐字段拷贝(C2,M4/S2 必改) |
| `packages/runtime/src/runtime.ts:189-196` | handleSpawn 传参 |
| `packages/runtime/src/runtime.ts:216-223` | handleWake 传参(与 handleSpawn 对称) |
| `packages/runtime/src/agent-runner.ts:33-45` | `AgentSpawnOptions`(M5/S3 扩) |
| `packages/runtime/src/agent-runner.ts:127-138` | `SpawnRequest` 构造(M5/S3 加透传) |
| `packages/runtime/src/harness/agent-harness.ts:60-92` | `SpawnRequest` interface(已有 extraMcpServers,S3 加 skills) |
| `packages/runtime/src/harness/agent-harness.ts:125-213` | `spawn()` 方法(S5 加物化调用) |
| `packages/runtime/src/harness/agent-harness.ts:161-165` | `mkdirSync(sessionCwd)`(S5 物化点) |
| `packages/runtime/src/harness/agent-harness.ts:374-396` | `buildMcpServers`(已就绪,无需改) |
| `packages/runtime/src/backends/mcp-config.ts:18` | `writeMcpConfigToTemp`(已就绪) |
| `packages/runtime/src/backends/types.ts:317-345` | `MCPServerConfig` |
| `packages/runtime/src/backends/claude-sdk.ts:77` | `settingSources: []`(C3 sdk 路径) |
| `packages/runtime/src/backends/claude-args.ts:16-34` | 不传 `--setting-sources`(C3 stdio 路径) |
| `packages/shared/src/types.ts:435` | `AgentConfigType`(M1 补 model/provider) |
| `packages/shared/src/types.ts:446` | `GlobalConfigType`(已含 skills/mcp) |
| `packages/server/src/db.ts:274-291` | `agent_configs` / `global_configs` schema |
| `packages/web/src/pages/AgentPage.tsx:326-333` | 4 个 ConfigCard 占位(M9b/S7 接入) |
| `packages/server/src/middleware/flex-auth.ts:52-59` | `req.humanId` / `req.agentId` 设置逻辑(M0 用) |

---

## 5. 最高风险 commit

**M2**(读 mcp + 合并 global) 与 **S5**(物化 skills + 清理目录)并列。

- **M2 风险:** 引入了两层 JSON 反序列化(config_value 字符串 → JSON → mcpServers 对象 → 遍历 keys),失败静默(N3);同时首次让 `getAgentRuntimeConfig` 从**只读 2 个 config_type** 扩到 4 个,4 处 CallbackEvent 全部受影响 —— 一处解析错误 = 全 spawn 链路崩。测试必须覆盖:合法 stdio、合法 sse、非法 transport、mcpServers 非对象、mcpServers 缺字段、flock 保留名过滤、flag 关闭。
- **S5 风险:** `rmSync(skillsDir, { recursive: true })` 在**per-room cwd** 里跑(W4)。若用户把 rooms.workspace 配成 `/`(极端例),等于 `rm -rf /.claude/skills`。skill 名的正则校验是防止 `../evil` 逃逸的**唯一防线**。多加一层:harness 里正则 + 拼 `join()` 后 `path.relative(skillsDir, resolvedDir).startsWith('..')` 拒绝。

**S5 若不做子目录隔离(W4),会导致同 room 多 agent 的 skills 互相覆盖 —— 生产要么加子目录,要么明确文档"per-room 共享"。**

---

*(End of diff plan)*
