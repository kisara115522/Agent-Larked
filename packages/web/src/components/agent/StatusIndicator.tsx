type Status = 'active' | 'dormant' | 'recovering' | 'error' | 'spawning' | 'online' | 'busy' | 'idle' | 'offline';

const statusColors: Record<string, { bg: string; glow?: string }> = {
  active: { bg: 'bg-success', glow: '0 0 0 2px rgba(52,211,153,.18)' },
  dormant: { bg: 'bg-text-dim' },
  recovering: { bg: 'bg-warning', glow: '0 0 0 2px rgba(251,191,36,.18)' },
  error: { bg: 'bg-error', glow: '0 0 0 2px rgba(248,113,113,.18)' },
  spawning: { bg: 'bg-accent', glow: '0 0 0 2px rgba(59,130,246,.18)' },
  online: { bg: 'bg-success', glow: '0 0 0 2px rgba(52,211,153,.18)' },
  busy: { bg: 'bg-warning' },
  idle: { bg: 'bg-text-dim' },
  offline: { bg: 'bg-text-dim' },
};

interface StatusIndicatorProps {
  status: Status;
  size?: 'sm' | 'md';
}

export function StatusIndicator({ status, size = 'sm' }: StatusIndicatorProps) {
  const sizeClass = size === 'sm' ? 'w-2 h-2' : 'w-2.5 h-2.5';
  const config = statusColors[status] || statusColors.offline;
  const isAnimated = status === 'recovering' || status === 'spawning';
  return (
    <span
      className={`${sizeClass} ${config.bg} rounded-full inline-block ${isAnimated ? 'animate-pulse' : ''}`}
      style={config.glow ? { boxShadow: config.glow } : undefined}
    />
  );
}
