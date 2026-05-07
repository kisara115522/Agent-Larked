import { describe, it, expect, beforeEach } from 'vitest';
import { createDatabase } from '../db.js';
import { registerAgent } from './identity.js';
import { followAgent, unfollowAgent, isFollowing, getFollowers, getFollowing, getFollowerIds } from './follow.js';
import { ErrorCode } from '@flock/shared';
import { ServerError } from '../middleware/error.js';
import type Database from 'better-sqlite3';

describe('Follow Service', () => {
  let db: Database.Database;
  let agent1Id: string;
  let agent2Id: string;
  let agent3Id: string;

  beforeEach(() => {
    db = createDatabase(':memory:');
    const r1 = registerAgent(db, { name: 'agent-1' });
    const r2 = registerAgent(db, { name: 'agent-2' });
    const r3 = registerAgent(db, { name: 'agent-3' });
    agent1Id = r1.id;
    agent2Id = r2.id;
    agent3Id = r3.id;
  });

  describe('followAgent', () => {
    it('should follow an agent', () => {
      followAgent(db, agent1Id, agent2Id);
      expect(isFollowing(db, agent1Id, agent2Id)).toBe(true);
    });

    it('should throw SELF_FOLLOW when following yourself', () => {
      expect(() => followAgent(db, agent1Id, agent1Id)).toThrow(ServerError);
      try {
        followAgent(db, agent1Id, agent1Id);
      } catch (err) {
        expect((err as ServerError).code).toBe(ErrorCode.SELF_FOLLOW);
      }
    });

    it('should throw ALREADY_FOLLOWING when already following', () => {
      followAgent(db, agent1Id, agent2Id);
      expect(() => followAgent(db, agent1Id, agent2Id)).toThrow(ServerError);
      try {
        followAgent(db, agent1Id, agent2Id);
      } catch (err) {
        expect((err as ServerError).code).toBe(ErrorCode.ALREADY_FOLLOWING);
      }
    });

    it('should throw AGENT_NOT_FOUND for non-existent agent', () => {
      expect(() => followAgent(db, agent1Id, 'non-existent')).toThrow(ServerError);
      try {
        followAgent(db, agent1Id, 'non-existent');
      } catch (err) {
        expect((err as ServerError).code).toBe(ErrorCode.AGENT_NOT_FOUND);
      }
    });
  });

  describe('unfollowAgent', () => {
    it('should unfollow an agent', () => {
      followAgent(db, agent1Id, agent2Id);
      unfollowAgent(db, agent1Id, agent2Id);
      expect(isFollowing(db, agent1Id, agent2Id)).toBe(false);
    });

    it('should throw NOT_FOLLOWING when not following', () => {
      expect(() => unfollowAgent(db, agent1Id, agent2Id)).toThrow(ServerError);
      try {
        unfollowAgent(db, agent1Id, agent2Id);
      } catch (err) {
        expect((err as ServerError).code).toBe(ErrorCode.NOT_FOLLOWING);
      }
    });
  });

  describe('getFollowers', () => {
    it('should list followers', () => {
      followAgent(db, agent1Id, agent3Id);
      followAgent(db, agent2Id, agent3Id);

      const result = getFollowers(db, agent3Id);
      expect(result.agents).toHaveLength(2);
      expect(result.agents.map(a => a.id).sort()).toEqual([agent1Id, agent2Id].sort());
    });

    it('should return empty list when no followers', () => {
      const result = getFollowers(db, agent1Id);
      expect(result.agents).toHaveLength(0);
      expect(result.has_more).toBe(false);
    });

    it('should support cursor pagination', () => {
      followAgent(db, agent1Id, agent3Id);
      followAgent(db, agent2Id, agent3Id);

      const page1 = getFollowers(db, agent3Id, { limit: 1 });
      expect(page1.agents).toHaveLength(1);
      expect(page1.has_more).toBe(true);
      expect(page1.next_cursor).toBeTruthy();

      const page2 = getFollowers(db, agent3Id, { limit: 1, cursor: page1.next_cursor! });
      expect(page2.agents).toHaveLength(1);
      expect(page2.has_more).toBe(false);
    });
  });

  describe('getFollowing', () => {
    it('should list following', () => {
      followAgent(db, agent1Id, agent2Id);
      followAgent(db, agent1Id, agent3Id);

      const result = getFollowing(db, agent1Id);
      expect(result.agents).toHaveLength(2);
      expect(result.agents.map(a => a.id).sort()).toEqual([agent2Id, agent3Id].sort());
    });

    it('should return empty list when not following anyone', () => {
      const result = getFollowing(db, agent1Id);
      expect(result.agents).toHaveLength(0);
      expect(result.has_more).toBe(false);
    });
  });

  describe('getFollowerIds', () => {
    it('should return follower IDs', () => {
      followAgent(db, agent1Id, agent3Id);
      followAgent(db, agent2Id, agent3Id);

      const ids = getFollowerIds(db, agent3Id);
      expect(ids.sort()).toEqual([agent1Id, agent2Id].sort());
    });

    it('should return empty array when no followers', () => {
      const ids = getFollowerIds(db, agent1Id);
      expect(ids).toEqual([]);
    });
  });
});
