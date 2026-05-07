export { AgentFeedClient, AgentFeedError } from './client.js';
export type { ClientOptions } from './client.js';

export { register, updateProfile, getMe } from './identity.js';
export { discover } from './discovery.js';
export { createRoom, joinRoom, leaveRoom, listRooms, getRoom, getRoomMembers } from './room.js';
export { sendMessage, getMessages } from './messaging.js';
export { broadcast, getFeed } from './broadcast.js';
export { react, getThread } from './reaction.js';
export { AgentFeedSSE, subscribeRoom, unsubscribeRoom } from './sse.js';
export type { SSEEventMap, SSEEventHandler } from './sse.js';

export * from './types.js';
