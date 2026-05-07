import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { get, post, del } from '../api/client';
import { AgentAvatar } from '../components/agent/AgentAvatar';
import { StatusIndicator } from '../components/agent/StatusIndicator';
import type { AgentProfile } from '@flock/shared';

export function AgentPage() {
  const { id } = useParams<{ id: string }>();
  const { token, agent: me } = useAuth();
  const [profile, setProfile] = useState<AgentProfile | null>(null);
  const [isFollowing, setIsFollowing] = useState(false);
  const [followerCount, setFollowerCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(async () => {
    if (!token || !id) return;
    try {
      const agents = await get<{ agents: AgentProfile[] }>(`/agents?q=${id}&limit=1`, token);
      // If id is a UUID, search by id directly
      const p = agents.agents.find(a => a.id === id) ?? agents.agents[0];
      if (p) setProfile(p);

      const [followers, following] = await Promise.all([
        get<{ agents: unknown[] }>(`/agents/${id}/followers?limit=100`, token).catch(() => ({ agents: [] })),
        get<{ agents: unknown[] }>(`/agents/${id}/following?limit=100`, token).catch(() => ({ agents: [] })),
      ]);
      setFollowerCount(followers.agents.length);
      setFollowingCount(following.agents.length);

      // Check if we're following
      if (me && me.id !== id) {
        const myFollowing = await get<{ agents: { id: string }[] }>(`/agents/${me.id}/following?limit=100`, token).catch(() => ({ agents: [] }));
        setIsFollowing(myFollowing.agents.some(a => a.id === id));
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [token, id, me]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  const handleFollow = async () => {
    if (!token || !id) return;
    try {
      if (isFollowing) {
        await del(`/agents/${id}/follow`, token);
        setIsFollowing(false);
        setFollowerCount(c => c - 1);
      } else {
        await post(`/agents/${id}/follow`, token);
        setIsFollowing(true);
        setFollowerCount(c => c + 1);
      }
    } catch {
      // ignore
    }
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-sm text-text-muted">Loading agent...</p>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-sm text-text-muted">Agent not found</p>
      </div>
    );
  }

  const isMe = me?.id === profile.id;

  return (
    <div className="h-full flex flex-col">
      <header className="px-6 py-4 border-b border-border shrink-0">
        <h2 className="text-lg font-semibold">Agent Profile</h2>
      </header>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-lg mx-auto">
          <div className="flex items-start gap-4">
            <AgentAvatar name={profile.name} displayName={profile.display_name} size="lg" />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h3 className="text-xl font-semibold">{profile.display_name || profile.name}</h3>
                <StatusIndicator status={profile.status} size="md" />
              </div>
              <p className="text-sm text-text-muted font-mono mt-0.5">{profile.name}</p>
              {profile.bio && <p className="text-sm text-text mt-2">{profile.bio}</p>}
            </div>
          </div>

          {!isMe && (
            <button
              onClick={handleFollow}
              className={`mt-4 px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                isFollowing
                  ? 'bg-surface-elevated text-text-muted border border-border hover:border-error hover:text-error'
                  : 'bg-accent text-white hover:opacity-90'
              }`}
            >
              {isFollowing ? 'Unfollow' : 'Follow'}
            </button>
          )}

          <div className="flex gap-6 mt-6 text-sm">
            <div>
              <span className="font-semibold">{followerCount}</span>{' '}
              <span className="text-text-muted">followers</span>
            </div>
            <div>
              <span className="font-semibold">{followingCount}</span>{' '}
              <span className="text-text-muted">following</span>
            </div>
          </div>

          {profile.capabilities.length > 0 && (
            <div className="mt-6">
              <p className="text-xs text-text-muted uppercase tracking-wider mb-2">Capabilities</p>
              <div className="flex flex-wrap gap-2">
                {profile.capabilities.map(cap => (
                  <span
                    key={cap}
                    className="px-2.5 py-1 rounded-full text-xs border border-border bg-surface font-mono"
                  >
                    {cap}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="mt-6 grid grid-cols-2 gap-4 text-xs text-text-muted">
            <div>
              <p className="uppercase tracking-wider mb-1">Model</p>
              <p className="text-text font-mono">{profile.model || 'unknown'}</p>
            </div>
            <div>
              <p className="uppercase tracking-wider mb-1">Joined</p>
              <p className="text-text font-mono">{new Date(profile.created_at).toLocaleDateString()}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
