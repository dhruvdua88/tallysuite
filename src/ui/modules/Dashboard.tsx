import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  CalendarDays,
  CheckCircle2,
  AlertTriangle,
  ScanLine,
  Fingerprint,
  ChevronDown,
} from 'lucide-react'
import { useActiveSlot } from '../../state/store'
import { buildTrialBalance } from '../../core/tb/trialBalance'
import { scanSmells, type SmellFinding } from '../../core/dashboard/smell'
import { formatINR } from '../../core/model/money'
import { SeverityDot, Stat, Pill } from '../components/atoms'
import { cn } from '../lib/cn'

export function Dashboard() {
  const slot = useActiveSlot()
  const tb = useMemo(() => (slot ? buildTrialBalance(slot.dataset) : null), [slot])
  const smell = useMemo(() => (slot ? scanSmells(slot.dataset) : null), [slot])
  if (!slot || !tb || !smell) return null
  const { dataset, report } = slot
  const meta = dataset.meta
  const sst = report.signSelfTest

  const maxType = Math.max(...smell.byVoucherType.map((t) => t.count), 1)

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">{meta.company}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-muted">
            <span className="flex items-center gap-1.5">
              <CalendarDays size={14} /> {meta.periodFrom} → {meta.periodTo}
            </span>
            {meta.generatedAt && <span className="text-ink-faint">· exported {meta.generatedAt}</span>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {sst && (
            <Pill tone={sst.confident ? 'good' : 'warn'}>
              <Fingerprint size={13} /> sign: {sst.convention === 'negative-is-debit' ? '−ve Dr' : '+ve Dr'} ·{' '}
              {sst.matched}/{sst.sampled}
            </Pill>
          )}
          <Pill tone={tb.balanced ? 'good' : 'bad'}>
            {tb.balanced ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
            TB {tb.balanced ? 'balances' : 'off by ' + formatINR(tb.totalClosing)}
          </Pill>
          {meta.lastAlterIdTransaction != null && (
            <Pill tone="accent">AlterID txn {meta.lastAlterIdTransaction.toLocaleString()}</Pill>
          )}
        </div>
      </div>

      {/* stats */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Vouchers" value={dataset.vouchers.length.toLocaleString()} />
        <Stat label="Accounting lines" value={dataset.lines.length.toLocaleString()} />
        <Stat label="Ledgers" value={dataset.ledgers.length.toLocaleString()} />
        <Stat
          label="Findings"
          value={smell.findings.length}
          accent
          sub={`${smell.findings.filter((f) => f.severity === 'high').length} high severity`}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_1.3fr]">
        {/* voucher mix + ingestion health */}
        <div className="space-y-6">
          <section className="panel p-5">
            <h3 className="mb-3 text-sm font-semibold text-ink">Voucher mix</h3>
            <div className="space-y-2">
              {smell.byVoucherType.map((t) => (
                <div key={t.type} className="flex items-center gap-3 text-sm">
                  <span className="w-24 shrink-0 text-ink-muted truncate">{t.type}</span>
                  <div className="h-2 flex-1 rounded-full bg-bg-raised overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${(t.count / maxType) * 100}%` }}
                      transition={{ duration: 0.6, ease: 'easeOut' }}
                      className="h-full rounded-full bg-accent/70"
                    />
                  </div>
                  <span className="w-12 text-right nums text-ink-muted">{t.count}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="panel p-5">
            <h3 className="mb-3 text-sm font-semibold text-ink">Ingestion health</h3>
            <div className="space-y-1.5 text-sm">
              <HealthRow ok={report.unbalancedVouchers.length === 0} label="Every voucher nets to zero"
                detail={report.unbalancedVouchers.length ? `${report.unbalancedVouchers.length} off` : 'verified'} />
              <HealthRow ok={report.orphanLines === 0} label="No orphan accounting lines"
                detail={report.orphanLines ? `${report.orphanLines} orphan` : 'verified'} />
              <HealthRow ok={!!sst?.confident} label="Sign convention reconciles"
                detail={sst ? `${sst.matched}/${sst.sampled} ledgers` : '—'} />
              <HealthRow ok={tb.balanced} label="Trial balance closes to zero"
                detail={formatINR(tb.totalClosing)} />
              <HealthRow ok={report.issues.filter((i) => i.level === 'error').length === 0}
                label="No parse errors"
                detail={`${report.issues.length} notice(s)`} />
            </div>
          </section>
        </div>

        {/* smell findings */}
        <section className="panel p-5">
          <div className="mb-3 flex items-center gap-2">
            <ScanLine size={16} className="text-accent" />
            <h3 className="text-sm font-semibold text-ink">Data smell scan</h3>
            <span className="text-xs text-ink-faint">— what an inherited Tally company hides</span>
          </div>
          <div className="space-y-2.5">
            {smell.findings.map((f, i) => (
              <FindingCard key={f.id} finding={f} index={i} />
            ))}
            {smell.findings.length === 0 && (
              <div className="text-sm text-ink-muted">No smells detected. Unusually clean books.</div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

function HealthRow({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="flex items-center gap-2 text-ink-muted">
        {ok ? (
          <CheckCircle2 size={14} className="text-good" />
        ) : (
          <AlertTriangle size={14} className="text-warn" />
        )}
        {label}
      </span>
      <span className={cn('nums text-xs', ok ? 'text-ink-faint' : 'text-warn')}>{detail}</span>
    </div>
  )
}

function FindingCard({ finding, index }: { finding: SmellFinding; index: number }) {
  const [open, setOpen] = useState(false)
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04 }}
      className="panel-raised overflow-hidden"
    >
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-bg-hover transition-colors"
      >
        <SeverityDot level={finding.severity} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm">{finding.title}</span>
            <span className="chip border-line text-ink-muted nums">{finding.count}</span>
            {finding.amount != null && (
              <span className="text-xs text-debit nums">{formatINR(finding.amount)}</span>
            )}
          </div>
          <div className="text-xs text-ink-muted mt-0.5 truncate">{finding.blurb}</div>
        </div>
        <ChevronDown
          size={16}
          className={cn('text-ink-faint transition-transform shrink-0', open && 'rotate-180')}
        />
      </button>
      {open && (
        <div className="border-t border-line/60 px-4 py-2 bg-bg-base/40">
          {finding.samples.map((s, i) => (
            <div key={i} className="flex items-center justify-between py-1 text-xs">
              <span className="text-ink truncate">{s.ref || '—'}</span>
              <span className="text-ink-faint nums ml-3 shrink-0">{s.detail}</span>
            </div>
          ))}
          {finding.count > finding.samples.length && (
            <div className="py-1 text-xs text-ink-faint">
              + {finding.count - finding.samples.length} more
            </div>
          )}
        </div>
      )}
    </motion.div>
  )
}
