/**
 * Build the inbox + todo digest injected at every tool boundary via the
 * PostToolUse hook. This is the mechanism that guarantees a busy agent learns
 * about new messages and never forgets open todos — independent of model diligence.
 */
import type Database from 'better-sqlite3';
import { peekPendingMessages, markDelivered, listOpenTodos } from './inbox.js';

export interface InboxDigest {
  new_messages: Array<{ from: string; content: string; age: string; source: string }>;
  open_todos: Array<{ id: string; content: string; priority: number }>;
  guidance: string;
}

export function ageString(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  return `${Math.floor(min / 60)}h ago`;
}
