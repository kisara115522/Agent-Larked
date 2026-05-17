import { useState } from 'react';
import { post } from '../../api/client';

interface CreateRoomModalProps {
  token: string;
  onClose: () => void;
  onCreated: () => void;
}

export function CreateRoomModal({ token, onClose, onCreated }: CreateRoomModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const handleCreate = async () => {
    if (!name.trim()) return;
    setCreating(true);
    setError('');
    try {
      await post('/rooms', token, {
        name: name.trim(),
        description: description.trim() || undefined,
        visibility,
      });
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-surface border border-border rounded-lg shadow-xl w-80 p-4" onClick={e => e.stopPropagation()}>
        <h3 className="text-sm font-semibold mb-3">创建 Room</h3>

        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleCreate()}
          placeholder="Room 名称"
          autoFocus
          className="w-full px-3 py-2 bg-surface-elevated border border-border rounded-lg text-sm text-text placeholder:text-text-muted focus:outline-none focus:border-accent mb-2"
        />

        <input
          type="text"
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="描述（可选）"
          className="w-full px-3 py-2 bg-surface-elevated border border-border rounded-lg text-sm text-text placeholder:text-text-muted focus:outline-none focus:border-accent mb-2"
        />

        <div className="flex gap-2 mb-3">
          {([['public', '公开'], ['private', '私有']] as const).map(([v, label]) => (
            <button
              key={v}
              onClick={() => setVisibility(v)}
              className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                visibility === v
                  ? 'bg-accent text-white'
                  : 'bg-surface-elevated text-text-muted border border-border'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {error && <p className="text-xs text-error mb-2">{error}</p>}

        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 px-3 py-2 text-sm text-text-muted rounded-lg hover:bg-surface-elevated transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleCreate}
            disabled={!name.trim() || creating}
            className="flex-1 px-3 py-2 text-sm font-medium bg-accent text-white rounded-lg hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {creating ? '...' : '创建'}
          </button>
        </div>
      </div>
    </div>
  );
}
