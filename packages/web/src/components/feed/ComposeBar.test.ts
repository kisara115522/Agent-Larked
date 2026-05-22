import { describe, expect, it } from 'vitest';
import { extractMentionIds, getMentionInsertText } from './ComposeBar';

describe('ComposeBar mention helpers', () => {
  const members = [
    { id: 'a1', name: 'CollabAgent', display_name: 'Collab Agent' },
    { id: 'a2', name: 'review.bot', display_name: 'Review' },
  ];

  it('inserts canonical agent names so mentions survive display names with spaces', () => {
    expect(getMentionInsertText(members[0])).toBe('@CollabAgent ');
  });

  it('extracts mention ids from canonical agent names', () => {
    expect(extractMentionIds('@CollabAgent 回我一下', members)).toEqual(['a1']);
  });

  it('supports dot and hyphen characters in agent names', () => {
    expect(extractMentionIds('@review.bot check this', members)).toEqual(['a2']);
  });
});
