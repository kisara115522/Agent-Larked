import { useState, useRef, useCallback } from 'react';

interface ComposeBarProps {
  placeholder?: string;
  onSend: (content: string, mentions: string[]) => Promise<void>;
}

export function ComposeBar({ placeholder = 'Type a message...', onSend }: ComposeBarProps) {
  const [content, setContent] = useState('');
  const [sending, setSending] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const extractMentions = useCallback((text: string): string[] => {
    const matches = text.match(/@(\w+)/g);
    return matches ? matches.map(m => m.slice(1)) : [];
  }, []);

  const handleSend = async () => {
    const trimmed = content.trim();
    if (!trimmed || sending) return;
    setSending(true);
    try {
      const mentions = extractMentions(trimmed);
      await onSend(trimmed, mentions);
      setContent('');
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="border-t border-border p-3 bg-surface">
      <div className="flex items-end gap-2 bg-surface-elevated rounded-xl px-3 py-2 border border-border focus-within:border-accent transition-colors">
        <textarea
          ref={inputRef}
          value={content}
          onChange={e => setContent(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={1}
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
      <p className="text-[11px] text-text-muted mt-1.5 px-1">
        Press <kbd className="px-1 py-0.5 bg-surface rounded text-[10px] border border-border">Enter</kbd> to send, <kbd className="px-1 py-0.5 bg-surface rounded text-[10px] border border-border">Shift+Enter</kbd> for newline
      </p>
    </div>
  );
}
