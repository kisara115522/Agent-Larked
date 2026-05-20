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
  sm: 'w-7 h-7 text-[10px]',
  md: 'w-9 h-9 text-[11px]',
  lg: 'w-11 h-11 text-[13px]',
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
        background: `linear-gradient(135deg, hsl(${hue1}, 55%, 52%), hsl(${hue2}, 55%, 38%))`,
      }}
    >
      {initials}
    </div>
  );
}
