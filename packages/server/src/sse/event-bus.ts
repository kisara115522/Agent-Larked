import type { Response } from 'express';
import type Database from 'better-sqlite3';
import type { SSEMentionEvent, SSEReactionEvent, SSERoomMessageEvent, SSEAgentStatusEvent, SSEDirectMessageEvent, SSETaskCreatedEvent, SSETaskStatusEvent, SSETaskArtifactEvent } from '@flock/shared';

interface SSEClient {
  agentId: string;
  res: Response;
}

interface PollerRow {
  id: string;
  from_agent: string;
  room_id: string;
  content: string;
  sequence: number;
  created_at: string;
  created_order: number;
  sender_type: 'agent' | 'human';
}

export class EventBus {
  private clients = new Map<string, SSEClient>(); // agentId → client
  private subscriptions = new Map<string, Set<string>>(); // roomId → Set<agentId>
  private lastMessageOrder = 0;
  private lastTaskEventTime = '';
  private poller: ReturnType<typeof setInterval> | null = null;

  addClient(agentId: string, res: Response): void {
    // Close existing connection for same agent
    const existing = this.clients.get(agentId);
    if (existing) {
      existing.res.end();
    }

    this.clients.set(agentId, { agentId, res });

    res.on('close', () => {
      const current = this.clients.get(agentId);
      if (current?.res === res) {
        this.clients.delete(agentId);
      }
    });
  }

  subscribe(agentId: string, roomId: string): void {
    let subs = this.subscriptions.get(roomId);
    if (!subs) {
      subs = new Set();
      this.subscriptions.set(roomId, subs);
    }
    subs.add(agentId);
  }

  unsubscribe(agentId: string, roomId: string): void {
    this.subscriptions.get(roomId)?.delete(agentId);
  }

  emitMention(event: SSEMentionEvent, mentionedAgentIds: string[], senderId: string): void {
    for (const agentId of mentionedAgentIds) {
      if (agentId === senderId) continue; // Don't notify sender
      this.send(agentId, 'mention', event);
    }
  }

  emitReaction(event: SSEReactionEvent, targetAgentId: string, senderId: string): void {
    if (targetAgentId === senderId) return;
    this.send(targetAgentId, 'reaction', event);
  }

  emitRoomMessage(event: SSERoomMessageEvent, roomId: string, senderId: string): void {
    const subs = this.subscriptions.get(roomId);
    if (!subs) return;

    for (const agentId of subs) {
      if (agentId === senderId) continue;
      this.send(agentId, 'room_message', event);
    }
  }

  /** Send a broadcast event to specific agents (e.g. followers) */
  emitBroadcast(event: Omit<SSERoomMessageEvent, 'content' | 'sequence'>, recipientIds: string[], senderId: string): void {
    for (const agentId of recipientIds) {
      if (agentId === senderId) continue;
      this.send(agentId, 'room_message', event);
    }
  }

  emitDirectMessage(event: SSEDirectMessageEvent, recipientId: string, senderId: string): void {
    if (recipientId === senderId) return;
    this.send(recipientId, 'direct_message', event);
  }

  /** Broadcast agent status change to all connected agents */
  emitAgentStatus(event: SSEAgentStatusEvent): void {
    for (const [agentId] of this.clients) {
      if (agentId === event.agent_id) continue;
      this.send(agentId, 'agent_status', event);
    }
  }

  emitTaskCreated(event: SSETaskCreatedEvent, roomId: string, senderId: string): void {
    const subs = this.subscriptions.get(roomId);
    if (!subs) return;
    for (const agentId of subs) {
      if (agentId === senderId) continue;
      this.send(agentId, 'task_created', event);
    }
  }

  emitTaskStatus(event: SSETaskStatusEvent, roomId: string, senderId: string): void {
    const subs = this.subscriptions.get(roomId);
    if (!subs) return;
    for (const agentId of subs) {
      if (agentId === senderId) continue;
      this.send(agentId, 'task_status', event);
    }
  }

  emitTaskArtifact(event: SSETaskArtifactEvent, roomId: string, senderId: string): void {
    const subs = this.subscriptions.get(roomId);
    if (!subs) return;
    for (const agentId of subs) {
      if (agentId === senderId) continue;
      this.send(agentId, 'task_artifact', event);
    }
  }

  emitWorkflowEvent(event: { agent_id: string; activity_type: string; detail: string; metadata: unknown; created_at: string }): void {
    for (const [agentId, _client] of this.clients) {
      this.send(agentId, 'workflow_event', event);
    }
  }

  private send(agentId: string, eventType: string, data: unknown): void {
    const client = this.clients.get(agentId);
    if (!client) return; // Agent offline, skip (best-effort)

    client.res.write(`event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  /** Initialize lastMessageOrder from DB so we don't replay old messages */
  initPoller(db: Database.Database): void {
    const row = db.prepare(
      'SELECT COALESCE(MAX(created_order), 0) AS max_order FROM messages',
    ).get() as { max_order: number };
    this.lastMessageOrder = row.max_order;

    const taskRow = db.prepare(
      "SELECT COALESCE(MAX(created_at), '') AS max_time FROM task_events",
    ).get() as { max_time: string };
    this.lastTaskEventTime = taskRow.max_time;
  }

  /** Start polling DB for new messages and task events (2s interval) */
  startPolling(db: Database.Database, intervalMs = 2000): void {
    if (this.poller) return;
    this.initPoller(db);

    this.poller = setInterval(() => {
      this.pollMessages(db);
      this.pollTaskEvents(db);
    }, intervalMs);
  }

  stopPolling(): void {
    if (this.poller) {
      clearInterval(this.poller);
      this.poller = null;
    }
  }

  private pollMessages(db: Database.Database): void {
    const rows = db.prepare(
      `SELECT m.id, m.from_agent, m.room_id, m.content, m.sequence, m.created_at, m.created_order, m.sender_type
       FROM messages m
       WHERE m.created_order > ?
       ORDER BY m.created_order ASC
       LIMIT 100`,
    ).all(this.lastMessageOrder) as PollerRow[];

    for (const row of rows) {
      this.lastMessageOrder = row.created_order;
      const event: SSERoomMessageEvent = {
        message_id: row.id,
        from: row.from_agent,
        sender_type: row.sender_type,
        content: row.content,
        room_id: row.room_id,
        sequence: row.sequence,
      };
      // Emit to all subscribed agents except sender
      const subs = this.subscriptions.get(row.room_id);
      if (!subs) continue;
      for (const agentId of subs) {
        if (agentId === row.from_agent) continue;
        this.send(agentId, 'room_message', event);
      }
    }
  }

  private pollTaskEvents(db: Database.Database): void {
    const rows = db.prepare(
      `SELECT te.id, te.task_id, te.actor_id, te.event_type, te.payload, te.created_at,
              t.room_id
       FROM task_events te
       JOIN tasks t ON t.id = te.task_id
       WHERE te.created_at > ?
       ORDER BY te.created_at ASC
       LIMIT 100`,
    ).all(this.lastTaskEventTime) as {
      id: string; task_id: string; actor_id: string; event_type: string;
      payload: string | null; created_at: string; room_id: string;
    }[];

    for (const row of rows) {
      this.lastTaskEventTime = row.created_at;

      if (row.event_type === 'status_changed' && row.payload) {
        try {
          const { from_status, to_status } = JSON.parse(row.payload) as { from_status?: string; to_status?: string };
          if (to_status) {
            const event: SSETaskStatusEvent = {
              task_id: row.task_id,
              room_id: row.room_id,
              from_status: (from_status ?? null) as SSETaskStatusEvent['from_status'],
              to_status: to_status as SSETaskStatusEvent['to_status'],
              actor_id: row.actor_id,
            };
            const subs = this.subscriptions.get(row.room_id);
            if (!subs) continue;
            for (const agentId of subs) {
              if (agentId === row.actor_id) continue;
              this.send(agentId, 'task_status', event);
            }
          }
        } catch {
          // Skip malformed payload
        }
      }
    }
  }
}
