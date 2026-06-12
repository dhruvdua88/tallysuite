import { formatINR, type Paise } from '../../core/model/money'
import { cn } from '../lib/cn'

/** Right-aligned monospaced rupee figure; red when negative, dimmed when zero. */
export function Money({
  value,
  className,
  signed = false,
  colorByDirection = false,
}: {
  value: Paise
  className?: string
  signed?: boolean
  colorByDirection?: boolean
}) {
  const zero = value === 0
  return (
    <span
      className={cn(
        'nums tabular-nums',
        zero && 'text-ink-faint',
        colorByDirection && !zero && (value > 0 ? 'text-credit' : 'text-debit'),
        className,
      )}
    >
      {zero ? '—' : formatINR(value, { sign: signed })}
    </span>
  )
}

export function SeverityDot({ level }: { level: 'high' | 'medium' | 'low' }) {
  const color = level === 'high' ? 'bg-bad' : level === 'medium' ? 'bg-warn' : 'bg-ink-faint'
  return <span className={cn('h-2 w-2 rounded-full shrink-0', color)} />
}

export function Pill({
  children,
  tone = 'neutral',
}: {
  children: React.ReactNode
  tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'accent'
}) {
  const tones = {
    neutral: 'border-line text-ink-muted',
    good: 'border-good/40 text-good bg-good/10',
    warn: 'border-warn/40 text-warn bg-warn/10',
    bad: 'border-bad/40 text-bad bg-bad/10',
    accent: 'border-accent/40 text-accent-hover bg-accent-soft',
  }[tone]
  return <span className={cn('chip', tones)}>{children}</span>
}

export function Stat({
  label,
  value,
  sub,
  accent,
}: {
  label: string
  value: React.ReactNode
  sub?: React.ReactNode
  accent?: boolean
}) {
  return (
    <div className="stat-card">
      <div className="text-xs uppercase tracking-wider text-ink-faint">{label}</div>
      <div className={cn('text-2xl font-semibold nums', accent && 'text-accent')}>{value}</div>
      {sub && <div className="text-xs text-ink-muted mt-0.5">{sub}</div>}
    </div>
  )
}
