import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  subtitle?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
  eyebrow?: string;
}

export function PageHeader({ title, subtitle, action, compact = false, eyebrow }: PageHeaderProps) {
  return (
    <div
      className={`shrink-0 border-b border-border bg-bg ${compact ? 'px-7 py-4' : 'px-8 py-5'}`}
      style={{ animation: 'fadeUp .25s ease-out' }}
    >
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          {eyebrow && (
            <div className="mb-2 text-[10px] text-text-dim font-semibold uppercase tracking-[0.16em]">
              {eyebrow}
            </div>
          )}
          <h1 className={`${compact ? 'text-[20px]' : 'text-[26px]'} font-bold leading-tight`}>
            {title}
          </h1>
          {subtitle && (
            <div className="mt-2 text-[13px] text-text-dim font-medium leading-relaxed">
              {subtitle}
            </div>
          )}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
    </div>
  );
}

export function PageShell({ children, className = '', scroll = true }: {
  children: ReactNode;
  className?: string;
  scroll?: boolean;
}) {
  return (
    <div className={`flex-1 min-h-0 ${scroll ? 'overflow-y-auto' : 'overflow-hidden'} px-8 py-6 ${className}`}>
      {children}
    </div>
  );
}

export function Panel({ title, meta, action, children, className = '' }: {
  title?: string;
  meta?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`bg-surface border border-border rounded-[10px] overflow-hidden ${className}`}>
      {(title || meta || action) && (
        <div className="min-h-11 px-4 py-3 border-b border-border flex items-center gap-3">
          {title && <h2 className="text-[12px] font-semibold text-text uppercase tracking-[0.12em]">{title}</h2>}
          {meta && <div className="text-[10px] text-text-dim font-mono px-2 py-0.5 rounded-full bg-surface-elevated">{meta}</div>}
          <div className="flex-1" />
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function MetricStrip({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`bg-surface border border-border rounded-[10px] overflow-hidden ${className}`}>
      <div className="grid divide-x divide-border max-[900px]:divide-x-0 max-[900px]:divide-y divide-border [grid-template-columns:repeat(auto-fit,minmax(160px,1fr))]">
        {children}
      </div>
    </div>
  );
}

export function Metric({ label, value, detail, tone = 'muted' }: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  tone?: 'accent' | 'success' | 'warning' | 'error' | 'muted';
}) {
  const toneClass = {
    accent: 'bg-accent',
    success: 'bg-success',
    warning: 'bg-warning',
    error: 'bg-error',
    muted: 'bg-text-dim',
  }[tone];
  return (
    <div className="min-h-[104px] px-5 py-4 flex flex-col justify-between">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] font-semibold text-text-dim uppercase tracking-[0.12em]">{label}</span>
        <span className={`w-1.5 h-1.5 rounded-full ${toneClass}`} />
      </div>
      <div>
        <div className="text-[26px] leading-none font-bold tabular-nums">{value}</div>
        {detail && <p className="mt-2 text-[11px] text-text-muted leading-snug">{detail}</p>}
      </div>
    </div>
  );
}

export function PageLoader({ label = '加载中' }: { label?: string }) {
  return (
    <div className="h-full flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="w-10 h-10 rounded-full border-2 border-accent/30 border-t-accent animate-spin" />
        <p className="text-sm text-text-dim font-medium">{label}</p>
      </div>
    </div>
  );
}

interface EmptyStateProps {
  title: string;
  description: string;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}

export function EmptyState({ title, description, action, icon, className = '' }: EmptyStateProps) {
  return (
    <div className={`flex flex-col items-center justify-center text-center ${className}`}>
      <div className="w-14 h-14 rounded-[14px] border border-border bg-surface flex items-center justify-center mb-4 text-text-dim">
        {icon ?? <DefaultEmptyIcon />}
      </div>
      <p className="text-[14px] text-text font-semibold">{title}</p>
      <p className="text-[12px] text-text-dim mt-1.5 max-w-[280px] leading-relaxed">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="bg-error-muted border border-error/30 text-error rounded-[10px] px-4 py-3 flex items-center gap-3">
      <div className="w-2 h-2 rounded-full bg-error shrink-0" />
      <p className="text-[13px] leading-relaxed flex-1">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="px-3 py-1.5 rounded-full bg-error text-white text-[12px] font-semibold hover:opacity-90 transition-opacity"
        >
          重试
        </button>
      )}
    </div>
  );
}

function DefaultEmptyIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 4h10M3 8h10M3 12h6" />
    </svg>
  );
}
