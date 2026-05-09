import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../index.js';

let app: Express;

describe('Direct Chat', () => {
  let aliceToken: string;
  let aliceId: string;
  let bobToken: string;
  let bobId: string;
  let thirdToken: string;

  beforeAll(async () => {
    ({ app } = createApp());

    const alice = await request(app).post('/agents').send({ name: 'DirectAlice' }).expect(201);
    aliceToken = alice.body.token;
    aliceId = alice.body.id;

    const bob = await request(app).post('/agents').send({ name: 'DirectBob' }).expect(201);
    bobToken = bob.body.token;
    bobId = bob.body.id;

    const third = await request(app).post('/agents').send({ name: 'DirectThird' }).expect(201);
    thirdToken = third.body.token;
  });

  it('sends and reads persistent 1:1 messages for both participants', async () => {
    const sent = await request(app)
      .post(`/direct-chats/${bobId}/messages`)
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({ content: 'private hello', idempotency_key: 'dm-alice-bob-1' })
      .expect(201);

    expect(sent.body.id).toBeDefined();
    expect(sent.body.chat_id).toBeDefined();
    expect(sent.body.sequence).toBe(1);

    const aliceView = await request(app)
      .get(`/direct-chats/${bobId}/messages`)
      .set('Authorization', `Bearer ${aliceToken}`)
      .expect(200);

    expect(aliceView.body.messages).toHaveLength(1);
    expect(aliceView.body.messages[0].content).toBe('private hello');
    expect(aliceView.body.messages[0].from).toBe(aliceId);
    expect(aliceView.body.messages[0].to).toBe(bobId);

    const bobView = await request(app)
      .get(`/direct-chats/${aliceId}/messages`)
      .set('Authorization', `Bearer ${bobToken}`)
      .expect(200);

    expect(bobView.body.messages).toHaveLength(1);
    expect(bobView.body.messages[0].chat_id).toBe(sent.body.chat_id);
  });

  it('lists chats with unread counts and last message summaries', async () => {
    await request(app)
      .post(`/direct-chats/${bobId}/messages`)
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({ content: 'second private hello', idempotency_key: 'dm-alice-bob-2' })
      .expect(201);

    const list = await request(app)
      .get('/direct-chats')
      .set('Authorization', `Bearer ${bobToken}`)
      .expect(200);

    const chat = list.body.chats.find((item: { peer_id: string }) => item.peer_id === aliceId);
    expect(chat).toBeDefined();
    expect(chat.peer_name).toBe('DirectAlice');
    expect(chat.unread_count).toBe(1);
    expect(chat.last_message.content).toBe('second private hello');
  });

  it('marks received messages as read when the recipient reads the conversation', async () => {
    await request(app)
      .get(`/direct-chats/${aliceId}/messages`)
      .set('Authorization', `Bearer ${bobToken}`)
      .expect(200);

    const list = await request(app)
      .get('/direct-chats')
      .set('Authorization', `Bearer ${bobToken}`)
      .expect(200);

    const chat = list.body.chats.find((item: { peer_id: string }) => item.peer_id === aliceId);
    expect(chat.unread_count).toBe(0);
  });

  it('does not expose direct chats through room messages', async () => {
    const room = await request(app)
      .post('/rooms')
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({ name: 'direct-chat-not-a-room' })
      .expect(201);

    const messages = await request(app)
      .get(`/rooms/${room.body.id}/messages`)
      .set('Authorization', `Bearer ${aliceToken}`)
      .expect(200);

    expect(messages.body.messages.some((msg: { content: string }) => msg.content === 'private hello')).toBe(false);
  });

  it('rejects direct chat with self or unknown agents', async () => {
    await request(app)
      .post(`/direct-chats/${aliceId}/messages`)
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({ content: 'self', idempotency_key: 'dm-self' })
      .expect(400);

    await request(app)
      .post('/direct-chats/not-an-agent/messages')
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({ content: 'missing', idempotency_key: 'dm-missing' })
      .expect(404);
  });

  it('third parties only see their own direct chats', async () => {
    const list = await request(app)
      .get('/direct-chats')
      .set('Authorization', `Bearer ${thirdToken}`)
      .expect(200);

    expect(list.body.chats).toEqual([]);
  });
});
