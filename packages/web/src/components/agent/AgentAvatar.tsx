function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function hashToHue(hash: number): number {
  return hash % 360;
}

interface AgentAvatarProps {
  name: string;
  displayName?: string;
  size?: 'sm' | 'md' | 'lg';
}

const sizes = {
  sm: 'w-6 h-6 text-[10px]',
  md: 'w-8 h-8 text-xs',
  lg: 'w-10 h-10 text-sm',
};

export function AgentAvatar({ name, displayName, size = 'md' }: AgentAvatarProps) {
  const hash = hashCode(name);
  const hue1 = hashToHue(hash);
  const hue2 = hashToHue(hash * 7);
  const initials = (displayName ?? name).slice(0, 2).toUpperCase();

  return (
    <div
      className={`${sizes[size]} rounded-full flex items-center justify-center font-bold text-white shrink-0`}
      style={{
        background: `linear-gradient(135deg, hsl(${hue1}, 60%, 50%), hsl(${hue2}, 60%, 40%))`,
      }}
    >
      {initials}
    </div>
  );
}
