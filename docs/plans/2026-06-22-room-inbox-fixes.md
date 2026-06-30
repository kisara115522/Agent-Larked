# Plan: room inbox 接入的对称性/去重/可读性修正

> 作者: Opus 4.8 | 日期: 2026-06-22 | 执行者: Sonnet
> 状态: 待执行
> 来源: room inbox 接入完成后,另一 agent 报告的瑕疵 + Opus 逐条源码核实(辩证采纳,非全盘接受)

---

## 0. 给执行者(Sonnet)的话

- 本文是唯一事实源。每条问题都标了**源码核实结论**,有的修法和原报告不同(原报告有误,见 §2)。
- **提交粒度:极细 = 一次改动一个提交。** 每个提交后对应包 `build` 过、能测的 `test` 绿。
- **commit message 不加 Co-Authored-By 尾注。**
- 与 `2026-06-22-cwd-roomrules-prompt.md` 是不同主题,独立做。

---

## 1. 背景

room 消息接入 inbox 后(commit `d7d6bf5` 等),`enqueueRoomMessageForBusyAgents` 在 `messages.ts` 和 `rooms.ts` 两处被调用,给忙碌(active/spawning)的 room 成员注入消息。报告了 5 个问题,Opus 逐条核实如下。

---

## 2. 逐条核实结论(辩证)

### 🔴 问题 1:@ 一人,所有忙碌成员都被注入 —— ✅ 真,必修

**核实:** `messages.ts:24` 和 `rooms.ts:190` 都在 mention 判断**之前**无条件调 `enqueueRoomMessageForBusyAgents`,它给**所有**忙碌成员注入(inbox.ts:99 查 `room_members` 全部 active/spawning)。而 dormant 路径(`wakeMentionedAgents`)只 wake 被 @ 的。

**不对称:**
- 不 @(广播)→ 应所有忙碌成员注入 ✓(现状对)
- @ 某人 → 应只给被 @ 的忙碌成员注入 ✗(现状错:B/C 没被 @ 也注入)

**修:** enqueue 区分 mention/广播,和 dormant wake 的精准/广播对称。

### 🟡 问题 2:digest 里 room 信息不醒目 —— ✅ 真,必修(但 builder 已部分支持)

**核实:** `inbox-digest.ts:10` 的 `new_messages` 已经有可选 `room_id` 字段(:47),`buildGuidance` 也已感知 `source_type === 'room'`(:66)。但 E2E 里模型仍说"不知道 room_id"——因为 room_id 只是 JSON 字段,没在文本里醒目呈现。

**修:** digest 的每条 room 消息,`from` 字段直接带上 room(如 `"kisara in #<roomName>"`),并在文本里显式写 `room_id`。让模型不解析 JSON 也知道哪个 room。需要 digest 带 room 名(目前只有 room_id,要 join rooms 表取名)。

### 🟡 问题 3:inbox 注入 + flock_wait 重复通知 —— ✅ 真,必修,但**原报告修法错误**

**核实:** 忙碌 agent 经 inbox 收到 room 消息后,之后调 `flock_wait` 时**会重复看到同一条**。

**原报告说**"同步更新 `agent_room_state.last_seen_sequence`" —— ❌ **这个修法无效**。核实 `subscribe.ts:34,137,151`:flock_wait 用的是 **MCP 进程内的 module-level 内存 Map `roomSequences`**,**根本不读 `agent_room_state.last_seen_sequence`**。改 DB 那个字段对 flock_wait 毫无影响。

**正确修法(二选一,见 §3 决策):**
- (a) inbox 注入 room 消息时,把该消息的 sequence 一并存进 pending_messages;flock_wait 返回消息后,inbox 注入侧不需要动 —— 真正的去重点在 **digest 注入时跳过"已经会被 flock_wait 返回"的消息**。但 flock_wait 的 baseline 在 MCP 内存,server 侧的 inbox 注入拿不到。
- (b) **更简单且正确:接受"两条路径都可能呈现同一消息",但让它们语义不冲突** —— inbox digest 是"你忙的时候漏的消息提醒",flock_wait 是"主动检查新消息"。给 inbox 注入的 room 消息**明确标注来源**(`via inbox while busy`),模型看到 flock_wait 再返回同一条时知道是同一条(靠 message ref_id / sequence)。即:在 digest 里带上 message 的 sequence/id,flock_wait 也带 id,模型可自行去重。
- (c) 治本:让 inbox 注入和 flock_wait 共享同一个"已读游标"。但 flock_wait 的游标在 MCP 内存、inbox 在 server,跨进程,改造大。

**本计划选 (b)**:digest 里每条 room 消息带 `message_id` + `sequence`,文本提示"this may also appear when you call flock_wait — it's the same message, don't double-handle"。低风险、不碰 flock_wait 内存模型。治本(c)留 backlog。

### 🟢 问题 4:同 room 连续消息无合并 —— ✅ 真,体验问题,backlog

同 room 3 条消息 = 3 条 digest 条目。合并成"#room: 3 条新消息,最新: ..."更清爽。非正确性问题,**backlog**。

### 🟢 问题 5:dispatchPendingRoomWake 的 inbox 兜底是死代码 —— ⚠️ **半真,原报告判断有误,不删**

**核实:** 原报告说"scheduleRoomWake 对 active 直接 return(callback.ts:159),所以 dispatchPendingRoomWake 的兜底(:199)是死代码"。

**Opus 不同意。** `scheduleRoomWake` 进来 dormant 的 agent 会进 **debounce 队列**(setTimeout,`roomWakeDebounceMs`)。等 `dispatchPendingRoomWake` 真正执行时(延迟后),agent **可能已被别的触发 spawn 成 active/spawning** → `createWakeSession` 返回 null → 走 inbox 兜底。这是 **"dormant→延迟窗口内变忙"的竞态兜底,有用,不是死代码**。原报告漏看了 debounce 时间窗。

**修:** **不删。** 加一行注释说明它是竞态兜底,防止下个 agent 再误判删除。

---

## 3. 关键决策

1. **问题 1 对称性:** enqueue room 消息分两类 —— 广播(无 mention)给所有忙碌成员;@ 给被 @ 的忙碌成员。新增 `mentionedAgentIds` 参数。
2. **问题 3 去重:** 选方案 (b) —— digest 带 message_id/sequence + 文本提示同一消息,不动 flock_wait 内存游标。治本跨进程游标统一留 backlog。
3. **问题 2 可读性:** digest 的 room 消息 `from` 带 room 名,文本显式 room_id。digest builder 需 join rooms 取名。
4. **问题 5:** 不删兜底,加注释。
5. **问题 4:** backlog,本次不做。

---

## 4. 实现要点(代码定位)

### 4.1 问题 1 — enqueue 区分 mention/广播

`enqueueRoomMessageForBusyAgents`(inbox.ts:89)加可选参数 `onlyAgentIds?: string[]`:
```ts
export function enqueueRoomMessageForBusyAgents(
  db: Database.Database,
  params: {
    roomId: string;
    senderId: string;
    senderName: string;
    excerpt: string;
    messageId?: string | null;
    sequence?: number | null;        // 新增(问题3)
    onlyAgentIds?: string[];         // 新增(问题1):非空则只注入这些 agent 的忙碌者
  },
): void {
  let busyMembers = db.prepare(`
    SELECT rm.agent_id FROM room_members rm
    JOIN profiles p ON p.id = rm.agent_id
    WHERE rm.room_id = ? AND rm.agent_id != ? AND p.status IN ('active','spawning')
  `).all(params.roomId, params.senderId) as { agent_id: string }[];

  // @ 精准:仅交集;广播:全部忙碌成员
  if (params.onlyAgentIds && params.onlyAgentIds.length > 0) {
    const set = new Set(params.onlyAgentIds);
    busyMembers = busyMembers.filter((m) => set.has(m.agent_id));
  }
  // ... enqueue 不变,但 content/refId 传 sequence ...
}
```

调用点 `messages.ts:24` 和 `rooms.ts:190` 改为:**移到 mention 判断之后**,或传 `onlyAgentIds`:
```ts
const mentions: string[] = Array.isArray(req.body.mentions) ? req.body.mentions : [];
enqueueRoomMessageForBusyAgents(db, {
  roomId, senderId, senderName, excerpt, messageId: result.id, sequence: result.sequence,
  onlyAgentIds: mentions.length > 0 ? mentions : undefined,  // @ → 精准;广播 → 全部
});
```

### 4.2 问题 3 — digest 带 sequence + 去重提示

`pending_messages` 已有 `ref_id`(存 message_id)。加 `sequence` 复用 ref 或新列?**复用 ref_id 即可**(已存 messageId),digest 文本提示模型用 message_id 去重。digest builder(inbox-digest.ts)文本加:
```
(Room messages here may also surface when you call flock_wait — same message_id means same message, handle once.)
```
digest 的 room 消息条目带 `ref_id` 作为 message_id 暴露给模型。

### 4.3 问题 2 — digest room 名

`buildInboxDigest`(inbox-digest.ts)对 `source_type === 'room'` 的消息,用 `room_id` join `rooms` 取 name,`from` 渲染成 `"<sender> in #<roomName>"`,并在条目里保留 `room_id`。

### 4.4 问题 5 — 注释

`callback.ts:198` 兜底处加注释:
```ts
// NOT dead code: scheduleRoomWake gates on dormant, but after the debounce
// window the agent may have been spawned (active/spawning) by another trigger,
// so createWakeSession returns null here and we fall back to inbox injection.
```

---

## 5. 原子提交清单

| # | commit | 文件 | 改动 |
|---|---|---|---|
| C1 | `feat(server): add onlyAgentIds filter to enqueueRoomMessageForBusyAgents` | ~`services/inbox.ts` | §4.1 加参数 + 交集过滤 |
| C2 | `feat(server): add sequence passthrough to room inbox enqueue` | ~`services/inbox.ts` | params.sequence(为问题3铺路) |
| C3 | `fix(server): inject @mention room messages only to mentioned busy members` | ~`routes/messages.ts` | enqueue 传 onlyAgentIds=mentions(有 mention 时) |
| C4 | `fix(server): same mention-scoped inbox injection for human room posts` | ~`routes/rooms.ts` | 同 C3 |
| C5 | `test(server): @mention injects only mentioned busy member, broadcast injects all` | ~`__tests__/inbox.test.ts` | 两个 case:@A 时 B 不收;广播时都收 |
| C6 | `feat(server): join room name into room-source inbox digest entries` | ~`services/inbox-digest.ts` | §4.3,from = "<sender> in #<room>" + 保留 room_id |
| C7 | `feat(runtime): mirror room-name digest formatting in inbox hook script` | ~`runtime/src/hooks/inbox-hook.ts` | hook 内联的 buildInboxDigest 同步改(两处保持一致) |
| C8 | `feat(server): expose message_id + dedup hint for room digest entries` | ~`services/inbox-digest.ts` | §4.2 条目带 ref_id,文本加去重提示 |
| C9 | `feat(runtime): mirror dedup hint in inbox hook script` | ~`runtime/src/hooks/inbox-hook.ts` | hook 内联版同步 |
| C10 | `test(server): room digest shows room name + message_id dedup hint` | ~测试 | digest 文本含 #room 名 + message_id + 去重提示 |
| C11 | `docs(server): annotate dispatchPendingRoomWake inbox fallback as race-guard` | ~`services/callback.ts` | §4.4 注释,不删代码 |
| C12 | `docs: room inbox fixes — progress + backlog (coalesce, cross-proc cursor)` | ~`docs/progress.md` ~`docs/backlog.md` | 记录 + 问题4/治本3 入 backlog |

---

## 6. 写入 backlog 的条目

```markdown
### 🟢 同 room 连续消息合并为单条 digest
- 同 room 多条消息现在每条一个 digest 条目;应合并为 "#room: N 条新消息, 最新: ..."
- 状态:open

### 🟢 inbox 注入与 flock_wait 共享已读游标(治本)
- 当前 flock_wait 用 MCP 进程内存 roomSequences,inbox 在 server,跨进程不共享
- 现用 message_id 去重提示缓解(模型侧去重);治本需统一游标(改造大)
- 状态:open

### 🟢 enqueueRoomMessageForBusyAgents 的 spawning 竞态
- 注入对象含 status='spawning' 的 agent。若该 agent 还没真正起好(claude 进程未就绪),
  注入的 pending_message 要等它起来后第一个工具边界才被 hook 读到——可接受,但需 QA 确认 spawning→active 过渡期消息不丢
- 状态:open
```

---

## 7. 验收

1. **对称性:** room 里 @ agent A(B/C 也忙)→ 只有 A 的 inbox 进新消息,B/C 不进;不 @(广播)→ A/B/C 都进。
2. **可读性:** 忙碌 agent 的 digest 里,room 消息显示为 `"<sender> in #<roomName>"` + room_id,agent 能直接说出在哪个 room。
3. **去重提示:** digest room 条目带 message_id,文本提示与 flock_wait 同一消息按 id 去重;agent 不重复处理同一条。
4. **兜底不删:** callback.ts 竞态兜底保留 + 有注释。
5. **回归:** dormant agent 的 mention/广播 wake 不受影响;DM inbox 不受影响。
6. 全部单测绿;完成后开 `Code Reviewer` 审查 inbox.ts + inbox-digest.ts + inbox-hook.ts(两处 digest 一致性)+ messages.ts/rooms.ts。
```
