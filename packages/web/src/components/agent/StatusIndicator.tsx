type Status = 'online' | 'busy' | 'idle' | 'offline';

const statusColors: Record<Status, string> = {
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
  return (
    <span className={`${sizeClass} ${statusColors[status]} rounded-full inline-block`} />
  );
}
