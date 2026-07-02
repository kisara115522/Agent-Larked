# Plan: Turn 边界消息注入(agent 忙时也能收到"有人找你")

> 作者: Opus 4.8 | 日期: 2026-06-17 | 执行者: Sonnet
> 状态: 待执行
> 关联: stdio backend 已落地、DM/activity 可见性已修复。这是 stdio 当初设计的核心价值兑现。

---

## 0. 给执行者(Sonnet)的话

- 本文是唯一事实源。所有 claude CLI 行为都是 Opus **本机实测**(claude 2.1.178),不是猜测,见 §2。
- **提交粒度:极细 = 一次改动一个提交。** 同一文件可出现在多个提交。每个提交后对应包 `build` 过、能测的 `test` 绿。
- **commit message 不加 Co-Authored-By 尾注。** 用项目规范(改了什么/为什么/影响)。
- 发现新问题立刻写 `docs/backlog.md`。
- 这是**重构性改动**(改变 claude-stdio 的进程生命周期范式),务必先读 §3 理解范式冲突,再动手。

---

## 1. 目标(用户原话翻译)

> "agent 正在执行的时候能注入一段消息让 claude 知道有人找他,但是他可以决定是先做完手头的还是直接先做这个任务。"

拆成精确需求:

1. agent 正在干活(claude 进程运行中、还没出 result)时,有人给它发消息(DM / @mention)。
2. 系统把这条消息**注入到正在运行的 claude 进程**,让 agent **知道**有人找。
3. **是否中断手头工作由 agent 自己决定** —— 系统不替它决策,只负责送达。普通消息排队到 turn 边界,标记为紧急/打断的消息立即注入(用户决策:"都支持,按消息标记")。

**反例(现在的行为,要改掉):** `callback.ts:103` `if (agent.status === 'active') return null` —— agent 忙时 DM 直接被丢弃,消息进了 DB 但活着的 agent 永远不知道,只能等它自然结束后靠 `--resume` 重起才看到。

---

## 2. claude CLI 行为(本机实测,claude 2.1.178)—— 方案可行性基石

### 实测 1:同进程多轮(stdin 不关,result 后继续喂 user 帧)

```bash
( printf '{...content:"reply ONE"}\n'; sleep 12; printf '{...content:"reply TWO"}\n'; sleep 12 ) \
  | claude -p --output-format stream-json --input-format stream-json --verbose --permission-mode bypassPermissions
```
结果:`result:"ONE"` → `result:"TWO"`,**同一进程、同一 session_id、两个 result 帧**,无需 `--resume`。
→ **结论:只要 stdin 不关,claude 进程可长驻、连续多轮。**

### 实测 2:运行中注入,agent 自主决定是否中断

agent 跑 sleep 8 + echo DONE 期间(3s 时)注入 `URGENT: stop and say PINEAPPLE`:
- **只有 1 个 result 帧** —— 注入帧被纳入**同一个 turn**,没触发新 turn。
- agent 做完 DONE,**全程没说 PINEAPPLE** —— 它看到了注入消息(stdout 出现 `"type":"user"` 帧),但**自主决定先完成手头工作**。

→ **结论:claude 原生支持运行中注入 user 帧,且 agent 在工具调用间隙看到、自己决定是否切换。这正是用户要的"由 agent 决定"——不需要我们做 interrupt 机制。**

### 实测 3:multica 不做注入

multica 的 stdin 保持打开**仅为应答 control_request**(claude.go:354),无任何 inject/SendMessage 通道。result 后 closeStdin。
→ **结论:无现成参考,纯新设计。**

---

## 3. 范式冲突(必须先懂)

### 当前实现:一次性 turn

`claude-stdio.ts` 现状:`exec()` = 一个 claude 进程 = 一次执行。
- 收到 result 帧 → `child.stdin.end()`(141 行)→ claude 退出 → `exec` 的 generator 结束。
- 后续"唤醒"靠 `agent-runner` 用 `--resume` **重新 spawn 新进程**。
- agent 忙时(status=active),`callback.ts:103` 直接 `return null` 丢弃 DM。

### 目标实现:长驻 turn-loop 进程

- claude 进程 result 后**不退出**,stdin 保持打开,进入"空闲等待"。
- 有新消息 → 往同一进程 stdin 喂 user 帧 → 同 session 续下一 turn。
- 进程在"空闲超时"或显式 stop 时才 `stdin.end()` 退出。

**这是生命周期范式的改变。** 核心难点:
1. `exec` 的 generator 现在在 result 后就 drain 完了;要让它在 result 后继续等待(不 end queue),直到空闲超时/stop。
2. 需要一个"向运行中 backend 注入消息"的 API,穿透 backend → harness → runner → callback。
3. 进程长驻 → 必须有空闲超时 + 资源回收,否则进程泄漏。

---

## 4. 架构设计

### 4.1 注入路径(从消息到 stdin)

```
人类/agent 发 DM 给忙碌 agent A
  → POST /direct-chats/A/messages (direct-chats.ts)
  → 写 direct_messages 表 + emitDirectMessage(已有)
  → wakeDirectMessageAgent(callback.ts)
       现状: agent.status==='active' → return null (丢弃) ❌
       改为: agent 正在本 runtime 运行 → 发 'inject' 回调而非 spawn ✅
  → runtime 收到 inject 回调 (callback-server.ts + runtime.ts)
  → runner.inject(agentId, message)
  → harness.inject(agentId, message)
  → backend.inject(sessionId, message)  ← 新 backend 方法
  → ClaudeStdioBackend 找到活进程,child.stdin.write(buildUserInput(标记后的消息))
  → claude 在 turn 边界/工具间隙看到,自主决定
```

### 4.2 消息标记(用户决策:普通排队 / 紧急打断都支持)

注入帧的文本前缀区分意图,让 **agent 自己**按提示决策(系统不强制 interrupt):

- 普通: `[New message from {sender}] {content}\n\n(You may finish your current task first, then address this.)`
- 紧急: `[URGENT — please address now] {sender}: {content}\n\n(Consider pausing your current work to handle this.)`

> 两种都只是注入一条 user 帧,差别只在措辞引导。claude 都是"在工具间隙看到、自主决定"(实测 2 证实)。**不实现真正的 SIGINT/interrupt 打断**——那会破坏 agent 自主性,且有竞态(注入帧丢失风险)。"紧急"靠措辞 + 可选地在 prompt 里要求 agent 优先,而非进程级中断。

> 标记来源:DM 默认普通;将来可在发消息 API 加 `priority` 字段。本次先全部走"普通"措辞,标记机制留接口(§6 决策 3)。

### 4.3 backend 接口扩展

`AgentBackend` 加可选方法:
```ts
/** Inject a message into a running session's input stream (turn-boundary delivery).
 *  Returns true if the session was live and the message was written. */
inject?(sessionId: string, message: string): boolean;
```

`ClaudeStdioBackend.inject`:从 `active` map 找 child(按真实 sessionId),`child.stdin.write(buildUserInput(message))`,返回是否成功。

### 4.4 进程长驻 + 空闲回收

`exec()` 改造:
- result 帧不再 `stdin.end()`,改为重置一个**空闲超时定时器**(如 5 分钟,可配)。
- 空闲超时触发 → `stdin.end()` → 进程优雅退出 → generator 结束。
- 收到注入(stdin 又写入)→ 清除空闲定时器,等下一个 result 再重置。
- stop/abort → 立即 killChild(已有)。

> 空闲超时值:默认 5min。太短退化回"一次性 turn",太长进程泄漏。设为可配 `STDIO_IDLE_TIMEOUT_MS`,默认 300000。

---

## 5. 提交清单

> 顺序:backend 能力 → harness/runner 接线 → server 回调 → 集成。每步独立可编译可测。

### Phase 1 — backend 注入能力 + 长驻(claude-stdio)

| # | commit | 文件 | 改动 |
|---|---|---|---|
| C1 | `feat(runtime): add optional inject() to AgentBackend interface` | ~`backends/types.ts` | 接口加 `inject?(sessionId, message): boolean` + 文档注释 |
| C2 | `feat(runtime): track child by session for injection in stdio backend` | ~`backends/claude-stdio.ts` | active map 已按 sessionId 键(现成);确认 inject 能用它定位 child。无行为改动,只加注释/小重构便于 C3 |
| C3 | `feat(runtime): implement ClaudeStdioBackend.inject writing to stdin` | ~`backends/claude-stdio.ts` | `inject(sessionId,message)`:查 active,`child.stdin.write(buildUserInput(message))`,返回 bool |
| C4 | `test(runtime): cover inject writes user frame to live child stdin` | ~`__tests__/claude-stdio.test.ts` | mock child,inject 后断言 stdin 收到正确 user 帧;未知 sessionId 返回 false |
| C5 | `feat(runtime): add idle-timeout state to stdio exec lifecycle [WIP]` | ~`backends/claude-stdio.ts` | 引入 idleTimer + IDLE_TIMEOUT_MS 常量(env 可配);先只声明,不改 result 行为。tsc 绿 |
| C6 | `feat(runtime): keep process alive after result, arm idle timer` | ~`backends/claude-stdio.ts` | result 帧不再立即 `stdin.end()`;改为 arm idleTimer。idleTimer 触发 → stdin.end() → 进程退出 |
| C7 | `feat(runtime): reset idle timer when a message is injected` | ~`backends/claude-stdio.ts` | inject 时 clear+不重置(等下个 result);result 时重置 idleTimer。确保注入后不被空闲超时误杀 |
| C8 | `test(runtime): cover process stays alive across result then idle-exits` | ~`__tests__/claude-stdio.test.ts` | 推 result 后进程不退;推第二条注入→第二个 result;idleTimer 到点→stdin.end |
| C9 | `fix(runtime): ensure idle timer cleared on abort/exit/error` | ~`backends/claude-stdio.ts` | killChild/finish/error 都 clearTimeout(idleTimer),防泄漏 |

### Phase 2 — harness + runner 注入接线

| # | commit | 文件 | 改动 |
|---|---|---|---|
| C10 | `feat(runtime): add AgentHarness.inject delegating to backend` | ~`harness/agent-harness.ts` | `inject(agentId,message)`:查 session,调 `session.backend.inject?.(session.sessionId, message)`,返回 bool |
| C11 | `test(runtime): cover harness.inject routes to live session` | ~`__tests__/` | 断言路由到正确 backend.inject;无 session 返回 false |
| C12 | `feat(runtime): add AgentRunner.inject passthrough` | ~`agent-runner.ts` | `inject(agentId,message)` → `harness.inject`;agent 不在运行返回 false |
| C13 | `feat(runtime): report injected message as activity` | ~`agent-runner.ts` 或 harness | 注入时 reportActivity(agentId,'system','injected message',...) 便于可见性/调试 |

### Phase 3 — server 回调:忙碌 agent 走 inject 而非丢弃

| # | commit | 文件 | 改动 |
|---|---|---|---|
| C14 | `feat(server): add 'inject' callback event type` | ~`services/callback.ts` ~`runtime/callback-server.ts` | CallbackEvent.type 加 `'inject'`;payload 带 agent_id/message/sender/priority |
| C15 | `feat(runtime): handle inject callback in runtime` | ~`runtime/runtime.ts` | handleCallback 加 `case 'inject'` → `runner.inject(...)` |
| C16 | `feat(server): detect running agent and send inject instead of drop` | ~`services/callback.ts` | `wakeDirectMessageAgent`:agent.status==='active' 且在某 online runtime 上运行 → 发 inject 回调(替代现在的 `return null` 丢弃) |
| C17 | `feat(server): build injected message text with sender + priority marker` | ~`services/callback.ts` | 按 §4.2 措辞构造注入文本(普通/紧急) |
| C18 | `test(server): cover busy agent receives inject not spawn` | ~`__tests__/` | active agent + online runtime → 发 inject 回调;agent dormant → 仍走 spawn/wake(回归) |
| C19 | `feat(server): route @mention to inject for busy room agents` | ~`services/callback.ts` | `dispatchPendingRoomWake` 同样:忙碌 agent 走 inject |

### Phase 4 — 边界与健壮性

| # | commit | 文件 | 改动 |
|---|---|---|---|
| C20 | `fix(server): fall back to wake if inject callback fails` | ~`services/callback.ts` / runtime | inject 回调失败(runtime 没这个活进程了)→ 降级为 wake+resume(进程可能刚好结束) |
| C21 | `fix(runtime): inject returns false when child stdin not writable` | ~`backends/claude-stdio.ts` | stdin 已关/进程已退 → inject 返回 false,触发上游降级 |
| C22 | `docs: document turn-boundary injection in progress + backlog` | ~`docs/` | 记录新能力、空闲超时配置、已知边界 |

### Phase 5(可选,前端可见性)— 注入消息在 DM 时间线显示

| # | commit | 文件 | 改动 |
|---|---|---|---|
| C23 | `feat(web): show injected/delivered marker in DM timeline` | ~`DMModal.tsx` | 人类发的 DM 在对方忙碌时,UI 显示"已送达(对方正在忙,会在合适时机查看)"状态 |

---

## 6. 关键决策

1. **长驻进程范式,不是 resume 重起。** 实测证明同进程多轮可行(实测1),这是真正的"运行中注入";resume 范式做不到运行中送达。代价:进程长驻 + 空闲超时管理(C5-C9 处理)。
2. **不实现进程级 interrupt(SIGINT)。** 用户要的是"agent 自己决定",claude 原生的"注入帧在工具间隙可见、自主决定"(实测2)正好满足。SIGINT 会破坏自主性 + 有注入帧丢失竞态。"紧急"靠措辞引导(§4.2),不靠强制打断。
3. **priority 标记先留接口,本次全走普通措辞。** 发消息 API 加 `priority` 字段是后续(backlog),本次注入文本支持两种措辞但默认普通。
4. **inject 失败必降级。** 活进程可能恰好在注入前结束 → inject 返回 false → 上游降级为传统 wake+resume(C20/C21),保证消息不丢。
5. **空闲超时默认 5min,env 可配** `STDIO_IDLE_TIMEOUT_MS`。

---

## 7. 写入 backlog 的条目

```markdown
### 🟢 注入消息的 priority 字段(发消息 API)
- 本次注入支持普通/紧急两种措辞,但发消息 API 还没有 priority 字段,默认全普通
- 后续:DM/mention API 加 priority,前端可选"紧急"
- 状态:open

### 🟢 长驻 claude 进程的资源上限
- turn-loop 进程常驻直到空闲超时(默认5min)。大量并发 agent 可能进程数膨胀
- 后续:进程池上限 / LRU 回收
- 状态:open

### 🟢 注入帧丢失边界
- agent 进程恰在注入前出 result 并空闲超时退出 → inject 降级 wake(C20)
- 极端竞态(stdin 写入瞬间进程退出)需 QA 观察
- 状态:open
```

---

## 8. 验收

1. **核心:** agent 正在跑一个多步任务(status=active)时,人类 DM 它 → DB 显示发了 `inject` 回调(非丢弃)→ runtime 日志显示注入到活进程 → agent 在当前 turn 工具间隙"看到"该消息(后续回复体现它知道了)。
2. **自主决定:** agent 可能先做完手头任务再回应,也可能切过去 —— 两种都正常,系统不强制。
3. **空闲退出:** agent 出 result 后进程保持,5min 无消息 → 进程优雅退出,状态转 dormant。
4. **降级:** 进程刚好结束后再 DM → inject 返回 false → 降级 wake+resume,消息不丢。
5. **回归:** dormant agent 收 DM 仍走原 spawn/wake;@mention 同样支持 inject。
6. 全部单测绿;完成后开 `Code Reviewer` 审查 claude-stdio.ts(生命周期改动)+ callback.ts。
```
