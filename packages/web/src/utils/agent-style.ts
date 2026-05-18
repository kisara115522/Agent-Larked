const PALETTE = ['#10B981', '#F59E0B', '#8B5CF6', '#3B82F6', '#EF4444', '#EC4899', '#14B8A6', '#F97316', '#06B6D4', '#A855F7'];

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function getAgentColor(name: string): string {
  return PALETTE[hashCode(name) % PALETTE.length];
}

export function getAgentGradient(name: string): string {
  const base = getAgentColor(name);
  return `${base},${base}CC`;
}

export function getAgentInitials(name: string): string {
  if (!name) return '??';
  const parts = name.split(/[\s._-]+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}
