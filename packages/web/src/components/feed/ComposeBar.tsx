import { useState, useRef, useCallback, useEffect } from 'react';
import { get } from '../../api/client';

interface Member {
  id: string;
  name: string;
  display_name: string;
}

interface ComposeBarProps {
  placeholder?: string;
  onSend: (content: string, mentions: string[]) => Promise<void>;
  roomId?: string;
  token?: string;
}

export function ComposeBar({ placeholder = 'Type a message...', onSend, roomId, token }: ComposeBarProps) {
  const [content, setContent] = useState('');
  const [sending, setSending] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // @mention autocomplete state
  const [members, setMembers] = useState<Member[]>([]);
  const [showMentions, setShowMentions] = useState(false);
  const [mentionFilter, setMentionFilter] = useState('');
  const [mentionIndex, setMentionIndex] = useState(0);
  const mentionStartRef = useRef<number | null>(null);

  // Fetch room members when roomId changes
  useEffect(() => {
    if (!roomId || !token) return;
    get<{ members: Member[] }>(`/rooms/${roomId}/members`, token)
      .then(res => setMembers(res.members))
      .catch(err => console.error('Failed to load room members:', err));
  }, [roomId, token]);

  const extractMentions = useCallback((text: string): string[] => {
    const matches = text.match(/@([\w-]+)/g);
    return matches ? matches.map(m => m.slice(1)) : [];
  }, []);

  // Filtered members for autocomplete
  const filteredMembers = members.filter(m => {
    const name = m.display_name || m.name;
    return name.toLowerCase().includes(mentionFilter.toLowerCase());
  });

  const handleMentionSelect = useCallback((member: Member) => {
    const name = member.display_name || member.name;
    const start = mentionStartRef.current ?? 0;
    const before = content.slice(0, start);
    const after = content.slice(inputRef.current?.selectionStart ?? content.length);
    setContent(before + '@' + name + ' ' + after);
    setShowMentions(false);
    setMentionFilter('');
    mentionStartRef.current = null;
    inputRef.current?.focus();
  }, [content]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setContent(val);

    // Detect @mention trigger
    const cursor = e.target.selectionStart ?? val.length;
    const textBefore = val.slice(0, cursor);
    const atMatch = textBefore.match(/@([\w-]*)$/);

    if (atMatch) {
      mentionStartRef.current = cursor - atMatch[0].length;
      setMentionFilter(atMatch[1]);
      setShowMentions(true);
      setMentionIndex(0);
    } else {
      setShowMentions(false);
      setMentionFilter('');
      mentionStartRef.current = null;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Handle mention dropdown navigation
    if (showMentions && filteredMembers.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMentionIndex(i => (i + 1) % filteredMembers.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionIndex(i => (i - 1 + filteredMembers.length) % filteredMembers.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        handleMentionSelect(filteredMembers[mentionIndex]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowMentions(false);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSend = async () => {
    const trimmed = content.trim();
    if (!trimmed || sending) return;
    setSending(true);
    try {
      const mentionNames = extractMentions(trimmed);
      // Resolve mention names to agent IDs
      const mentionIds = mentionNames
        .map(name => members.find(m => m.name === name || m.display_name === name)?.id)
        .filter((id): id is string => !!id);
      await onSend(trimmed, mentionIds);
      setContent('');
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  return (
    <div className="relative border-t border-border px-6 pt-3 pb-4 bg-surface">
      {/* @mention autocomplete dropdown */}
      {showMentions && filteredMembers.length > 0 && (
        <div role="listbox" className="absolute bottom-full left-3 right-3 mb-1 bg-surface-elevated border border-border rounded-lg shadow-lg max-h-48 overflow-y-auto z-10">
          {filteredMembers.map((member, i) => {
            const name = member.display_name || member.name;
            return (
              <button
                key={member.id}
                role="option"
                aria-selected={i === mentionIndex}
                onMouseDown={(e) => {
                  e.preventDefault();
                  handleMentionSelect(member);
                }}
                className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition-colors ${
                  i === mentionIndex ? 'bg-accent-muted text-accent' : 'text-text hover:bg-surface-elevated'
                }`}
              >
                <span className="font-medium">{name}</span>
                {member.display_name && (
                  <span className="text-text-muted text-xs font-mono">{member.name}</span>
                )}
              </button>
            );
          })}
        </div>
      )}

      <div className="flex items-end gap-2 bg-surface-elevated rounded-xl px-3 py-2 border border-border focus-within:border-accent transition-colors">
        <textarea
          ref={inputRef}
          value={content}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={1}
          aria-haspopup="listbox"
          aria-expanded={showMentions && filteredMembers.length > 0}
          className="flex-1 bg-transparent text-sm text-text resize-none outline-none placeholder:text-text-muted min-h-[20px] max-h-[120px]"
          style={{ height: 'auto', overflow: 'hidden' }}
          onInput={e => {
            const el = e.currentTarget;
            el.style.height = 'auto';
            el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
          }}
        />
        <button
          onClick={handleSend}
          disabled={!content.trim() || sending}
          className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center bg-accent text-white disabled:opacity-40 hover:opacity-90 transition-opacity"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </div>
      <p className="text-[11px] text-text-dim mt-1.5 px-1">
        <kbd className="px-1 py-0.5 bg-surface rounded text-[10px] border border-border">Enter</kbd> 发送，<kbd className="px-1 py-0.5 bg-surface rounded text-[10px] border border-border">Shift+Enter</kbd> 换行
        {members.length > 0 && (
          <>，<kbd className="px-1 py-0.5 bg-surface rounded text-[10px] border border-border">@</kbd> 提及</>
        )}
      </p>
    </div>
  );
}
