import { useState, useRef, useCallback, useEffect } from 'react';
import { get } from '../../api/client';

interface Member { id: string; name: string; display_name: string; }

interface ComposeBarProps {
  placeholder?: string;
  onSend: (content: string, mentions: string[]) => Promise<void>;
  roomId?: string;
  token?: string;
  refreshKey?: unknown;
}

const MENTION_PATTERN = /@([\w.-]+)/g;

export function getMentionInsertText(member: Member): string {
  return `@${member.name} `;
}

export function extractMentionIds(content: string, members: Member[]): string[] {
  const ids = new Set<string>();
  for (const match of content.matchAll(MENTION_PATTERN)) {
    const name = match[1];
    const member = members.find(m => m.name === name);
    if (member) ids.add(member.id);
  }
  return [...ids];
}

export function ComposeBar({ placeholder = '输入消息...', onSend, roomId, token, refreshKey }: ComposeBarProps) {
  const [content, setContent] = useState('');
  const [sending, setSending] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const [members, setMembers] = useState<Member[]>([]);
  const [showMentions, setShowMentions] = useState(false);
  const [mentionFilter, setMentionFilter] = useState('');
  const [mentionIndex, setMentionIndex] = useState(0);
  const mentionStartRef = useRef<number | null>(null);

  useEffect(() => {
    if (!roomId || !token) return;
    get<{ members: Member[] }>(`/rooms/${roomId}/members`, token)
      .then(res => setMembers(res.members))
      .catch(() => {});
  }, [roomId, token, refreshKey]);

  const filteredMembers = members.filter(m =>
    (m.display_name || m.name).toLowerCase().includes(mentionFilter.toLowerCase())
  );

  const handleMentionSelect = useCallback((member: Member) => {
    const start = mentionStartRef.current ?? 0;
    const after = content.slice(inputRef.current?.selectionStart ?? content.length);
    setContent(content.slice(0, start) + getMentionInsertText(member) + after);
    setShowMentions(false);
    setMentionFilter('');
    mentionStartRef.current = null;
    inputRef.current?.focus();
  }, [content]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setContent(val);
    const cursor = e.target.selectionStart ?? val.length;
    const atMatch = val.slice(0, cursor).match(/@([\w.-]*)$/);
    if (atMatch) {
      mentionStartRef.current = cursor - atMatch[0].length;
      setMentionFilter(atMatch[1]);
      setShowMentions(true);
      setMentionIndex(0);
    } else {
      setShowMentions(false);
      mentionStartRef.current = null;
    }
    // Auto-resize
    const el = e.currentTarget;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showMentions && filteredMembers.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIndex(i => (i + 1) % filteredMembers.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setMentionIndex(i => (i - 1 + filteredMembers.length) % filteredMembers.length); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); handleMentionSelect(filteredMembers[mentionIndex]); return; }
      if (e.key === 'Escape') { e.preventDefault(); setShowMentions(false); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const handleSend = async () => {
    const trimmed = content.trim();
    if (!trimmed || sending) return;
    setSending(true);
    try {
      const mentionIds = extractMentionIds(trimmed, members);
      await onSend(trimmed, mentionIds);
      setContent('');
      if (inputRef.current) { inputRef.current.style.height = 'auto'; }
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const canSend = content.trim().length > 0 && !sending;

  return (
    <div className="relative border-t border-border/50 px-6 pt-4 pb-4">
      {/* @mention dropdown */}
      {showMentions && filteredMembers.length > 0 && (
        <div
          role="listbox"
          className="absolute bottom-full left-6 right-6 mb-2 bg-surface-elevated border border-border rounded-[10px] shadow-lg max-h-44 overflow-y-auto z-20"
        >
          {filteredMembers.map((member, i) => {
            const name = member.display_name || member.name;
            return (
              <button
                key={member.id}
                role="option"
                aria-selected={i === mentionIndex}
                onMouseDown={e => { e.preventDefault(); handleMentionSelect(member); }}
                className={`w-full text-left px-4 py-2.5 text-[13px] flex items-center gap-2.5 transition-colors first:rounded-t-[12px] last:rounded-b-[12px] ${
                  i === mentionIndex ? 'bg-accent-muted text-accent' : 'text-text hover:bg-surface-elevated/50'
                }`}
              >
                <span className="font-semibold">{name}</span>
                {member.display_name && (
                  <span className="text-text-dim text-[11px] font-mono">{member.name}</span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Input area */}
      <div className="flex items-end gap-3 bg-surface border border-border rounded-[14px] px-4 py-3 focus-within:border-accent/60 transition-colors duration-150">
        <textarea
          ref={inputRef}
          value={content}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={1}
          aria-haspopup="listbox"
          aria-expanded={showMentions && filteredMembers.length > 0}
          className="flex-1 bg-transparent text-[14px] text-text resize-none outline-none placeholder:text-text-dim min-h-[22px] max-h-[120px] leading-[1.55]"
        />
        <button
          onClick={handleSend}
          disabled={!canSend}
          className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center bg-accent text-white transition-all duration-200 disabled:opacity-20 hover:enabled:bg-accent-hover active:enabled:scale-90"
          aria-label="发送"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="22" y1="2" x2="11" y2="13"/>
            <polygon points="22 2 15 22 11 13 2 9 22 2"/>
          </svg>
        </button>
      </div>

      <p className="text-[10px] text-text-dim mt-2 px-1 select-none">
        <Kbd>Enter</Kbd> 发送 · <Kbd>Shift+Enter</Kbd> 换行{members.length > 0 && <> · <Kbd>@</Kbd> 提及</>}
      </p>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="px-1 py-px bg-surface rounded text-[10px] border border-border font-mono not-italic">
      {children}
    </kbd>
  );
}
