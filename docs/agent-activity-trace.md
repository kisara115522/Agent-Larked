# Agent Activity Trace — 可复用组件文档

> 状态: 已实现,DM 视图已集成,room 视图待接入

## 概述

Agent Activity Trace 是一组可复用的前端组件,用于在会话界面中展示 agent 的工作链路时间线(think / tool_call / tool_result)。

## 组件清单

| 组件 | 路径 | 说明 |
|------|------|------|
| `useAgentActivity` | `hooks/useAgentActivity.ts` | Hook: 订阅 SSE + 回填历史 |
| `AgentActivityTrace` | `components/activity/AgentActivityTrace.tsx` | 可折叠时间线 |
| `ActivityIcon` | `components/activity/ActivityIcon.tsx` | 活动类型图标 |
| `ToolCallItem` | `components/activity/ToolCallItem.tsx` | 工具调用渲染 |

## 数据来源

- **实时**: `workflow_event` SSE 事件(payload 含 `agent_id`, `activity_type`, `detail`, `metadata`)
- **回填**: `GET /agents/:id/activity?limit=N`(返回 `agent_activity_logs` 表行)
- 无需新建后端管道

## 在 Room 视图中复用

```tsx
import { useAgentActivity } from '../../hooks/useAgentActivity';
import { AgentActivityTrace } from '../activity/AgentActivityTrace';

function RoomMessage({ agentId, messageId, messageTime }) {
  const { activities } = useAgentActivity(agentId);

  // 按消息时间过滤属于这一轮的活动
  const turnActivities = activities.filter(a =>
    new Date(a.created_at) <= new Date(messageTime)
  ).slice(-10); // 最近 10 步

  return (
    <div>
      <div>{messageText}</div>
      <AgentActivityTrace activities={turnActivities} />
    </div>
  );
}
```

## 设计决策

1. **默认折叠**: 会话流里不干扰,点击展开看完整链路
2. **摘要行**: `💭 思考了 N 次 · 🔧 调用了 N 个工具` — 一眼看懂
3. **轮次对齐**: 活动按时间戳归到对应的 agent 回复消息下
4. **SSE 去重**: 同一活动不会因 SSE 重连/回填重复显示

## 类型定义

见 `types/activity.ts`:
- `ActivityType`: `'message' | 'think' | 'tool_call' | 'tool_result' | 'status_change' | 'error'`
- `AgentActivity`: `{ id, agent_id, activity_type, detail, metadata, created_at }`
