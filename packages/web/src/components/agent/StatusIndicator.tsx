type Status = 'active' | 'dormant' | 'recovering' | 'error' | 'online' | 'busy' | 'idle' | 'offline';

const statusColors: Record<string, string> = {
  active: 'bg-success shadow-[0_0_6px_var(--color-success)]',
  dormant: 'bg-text-muted',
  recovering: 'bg-warning animate-pulse',
  error: 'bg-error',
  online: 'bg-success shadow-[0_0_6px_var(--color-success)]',
  busy: 'bg-warning',
  idle: 'bg-text-muted',
  offline: 'bg-border',
};

interface StatusIndicatorProps {
  status: Status;
  size?: 'sm' | 'md';
}

export function StatusIndicator({ status, size = 'sm' }: StatusIndicatorProps) {
  const sizeClass = size === 'sm' ? 'w-2 h-2' : 'w-2.5 h-2.5';
  const colorClass = statusColors[status] || 'bg-border';
  return (
    <span className={`${sizeClass} ${colorClass} rounded-full inline-block`} />
  );
}
