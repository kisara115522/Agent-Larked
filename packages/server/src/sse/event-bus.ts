import type { Response } from 'express';
import type Database from 'better-sqlite3';
import type { SSEMentionEvent, SSEReactionEvent, SSERoomMessageEvent } from '@flock/shared';

interface SSEClient {
  agentId: string;
  res: Response;
}

export class EventBus {
  private clients = new Map<string, SSEClient>(); // agentId → client
  private subscriptions = new Map<string, Set<string>>(); // roomId → Set<agentId>

  addClient(agentId: string, res: Response): void {
    // Close existing connection for same agent
    const existing = this.clients.get(agentId);
    if (existing) {
      existing.res.end();
    }

    this.clients.set(agentId, { agentId, res });

    res.on('close', () => {
      this.clients.delete(agentId);
      // Remove from all subscriptions
      for (const [, agents] of this.subscriptions) {
        agents.delete(agentId);
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
  emitBroadcast(event: SSERoomMessageEvent, recipientIds: string[], senderId: string): void {
    for (const agentId of recipientIds) {
      if (agentId === senderId) continue;
      this.send(agentId, 'room_message', event);
    }
  }

  private send(agentId: string, eventType: string, data: unknown): void {
    const client = this.clients.get(agentId);
    if (!client) return; // Agent offline, skip (best-effort)

    client.res.write(`event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`);
  }
}
