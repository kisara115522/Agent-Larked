import { useState, useEffect, useCallback, useRef } from 'react';
import { useSSE } from '../context/SSEContext';
import { useAuth } from '../context/AuthContext';
import { get } from '../api/client';
import type { AgentActivity, WorkflowEventPayload } from '../types/activity';

/**
 * Hook that subscribes to an agent's activity stream via SSE and
 * optionally backfills history via GET /agents/:id/activity.
 *
 * Returns the full activity timeline for the given agent, sorted
 * oldest-first. New activities are appended in real-time.
 *
 * Reusable: works for both DM and room views.
 */
export function useAgentActivity(agentId: string, options?: { backfill?: boolean; limit?: number }) {
  const { backfill = true, limit = 100 } = options ?? {};
  const { subscribe } = useSSE();
  const { token } = useAuth();
  const [activities, setActivities] = useState<AgentActivity[]>([]);
  const [loading, setLoading] = useState(false);
  const seenIds = useRef(new Set<string>());

  // Backfill on mount
  const doBackfill = useCallback(async () => {
    if (!backfill || !token) return;
    setLoading(true);
    try {
      const res = await get<{ activities: AgentActivity[] }>(
        `/agents/${agentId}/activity?limit=${limit}`,
        token,
      ).catch(() => ({ activities: [] }));

      if (res.activities.length > 0) {
        for (const a of res.activities) {
          seenIds.current.add(a.id);
        }
        setActivities(res.activities);
      }
    } finally {
      setLoading(false);
    }
  }, [agentId, token, backfill, limit]);

  useEffect(() => { doBackfill(); }, [doBackfill]);

  // Subscribe to real-time workflow_event SSE
  useEffect(() => {
    return subscribe((sseEvent) => {
      if (sseEvent.event !== 'workflow_event') return;
      const data = sseEvent.data as WorkflowEventPayload;
      if (data.agent_id !== agentId) return;

      const id = data.id ?? `${data.agent_id}-${data.created_at}-${data.activity_type}`;

      // Deduplicate
      if (seenIds.current.has(id)) return;
      seenIds.current.add(id);

      const activity: AgentActivity = {
        id,
        agent_id: data.agent_id,
        activity_type: data.activity_type,
        detail: data.detail,
        metadata: data.metadata ?? {},
        created_at: data.created_at,
      };

      setActivities(prev => [...prev, activity]);
    });
  }, [subscribe, agentId]);

  return { activities, loading, refresh: doBackfill };
}
