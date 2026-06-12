import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import {
  Layers,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  FileSpreadsheet,
  ChevronDown,
  TriangleAlert,
} from 'lucide-react'
import { useStore } from '../../state/store'
import {
  buildStatements,
  runChecks,
  checkSummary,
  type Sch3LineResult,
  type CheckResult,
} from '../../core/m3-sch3'
import { type Paise } from '../../core/model/money'
import { Money, Pill } from '../components/atoms'
import { cn } from '../lib/cn'

export function Consolidation() {
  const slots = useStore((s) => s.slots)
  const [selected, setSelected] = useState<string[]>(() => slots.map((s) => s.id))

  const chosen = slots.filter((s) => selected.includes(s.id))
  const result = useMemo(() => {
    if (chosen.length === 0) return null
    const datasets = chosen.map((c) => c.dataset)
    const statements = buildStatements(datasets)
    const checks = runChecks(statements, datasets)
    return { statements, checks }
  }, [chosen])

  const [busy, setBusy] = useState(false)
  async function onExport() {
    if (!result) return
    setBusy(true)
    try {
      const { exportSch3 } = await import('../../io/excel')
      await exportSch3(result.statements, result.checks, 'Schedule-III.xlsx')
      toast.success('Schedule III workbook exported')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Export failed')
    } finally {
      setBusy(false)
    }
  }

  const multi = chosen.length > 1
  const s = result?.statements

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Layers size={20} className="text-accent" />
          <h2 className="text-xl font-bold tracking-tight">Consolidation</h2>
          <span className="text-sm text-ink-faint">— Schedule III statements</span>
        </div>
        {result && (
          <button className="btn-primary" onClick={onExport} disabled={busy}>
            <FileSpreadsheet size={16} /> {busy ? 'Exporting…' : 'Export workbook'}
          </button>
        )}
      </div>

      {/* branch picker */}
      <div className="panel p-4">
        <div className="text-[11px] uppercase tracking-wider text-ink-faint mb-2">Branches to consolidate</div>
        <div className="flex flex-wrap gap-2">
          {slots.map((sl) => {
            const on = selected.includes(sl.id)
            return (
              <button
                key={sl.id}
                onClick={() =>
                  setSelected((prev) => (on ? prev.filter((x) => x !== sl.id) : [...prev, sl.id]))
                }
                className={cn(
                  'flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-colors',
                  on ? 'border-accent/40 bg-accent-soft text-ink' : 'border-line text-ink-muted hover:bg-bg-hover',
                )}
              >
                {on ? <CheckCircle2 size={14} className="text-accent" /> : <div className="h-3.5 w-3.5 rounded-full border border-line" />}
                {sl.name} <span className="text-ink-faint">{sl.dataset.meta.periodTo}</span>
              </button>
            )
          })}
        </div>
      </div>

      {!s && <div className="panel grid place-items-center py-16 text-sm text-ink-muted">Select at least one branch.</div>}

      {s && (
        <>
          {!s.periodsMatch && (
            <div className="panel border-bad/40 bg-bad/5 px-4 py-3 flex items-center gap-2 text-sm text-bad">
              <TriangleAlert size={16} /> Period mismatch across branches — consolidation is invalid until periods align.
            </div>
          )}

          {/* checks summary */}
          {result && <ChecksPanel checks={result.checks} />}

          <div className="grid gap-5 lg:grid-cols-2">
            {/* Balance Sheet */}
            <StatementCard title="Balance Sheet" branches={s.branches} multi={multi}>
              <SectionHead label="I. Equity & Liabilities" />
              {s.bsEquityLiability.map((r) => (
                <LineRow key={r.line.id} r={r} multi={multi} />
              ))}
              <TotalRow label="Total Equity & Liabilities" perBranch={s.totals.equityLiability.perBranch} consolidated={s.totals.equityLiability.consolidated} multi={multi} />
              <SectionHead label="II. Assets" />
              {s.bsAssets.map((r) => (
                <LineRow key={r.line.id} r={r} multi={multi} />
              ))}
              <TotalRow label="Total Assets" perBranch={s.totals.assets.perBranch} consolidated={s.totals.assets.consolidated} multi={multi} />
              <ResidualRow value={s.bsResidual.consolidated} />
            </StatementCard>

            {/* P&L */}
            <StatementCard title="Statement of Profit & Loss" branches={s.branches} multi={multi}>
              <SectionHead label="Income" />
              {s.plIncome.map((r) => (
                <LineRow key={r.line.id} r={r} multi={multi} />
              ))}
              <TotalRow label="Total Income" perBranch={s.totals.totalIncome.perBranch} consolidated={s.totals.totalIncome.consolidated} multi={multi} />
              <SectionHead label="Expenses" />
              {s.plExpense.map((r) => (
                <LineRow key={r.line.id} r={r} multi={multi} />
              ))}
              <TotalRow label="Total Expenses" perBranch={s.totals.totalExpense.perBranch} consolidated={s.totals.totalExpense.consolidated} multi={multi} />
              <TotalRow label="Profit/(Loss) for the year" perBranch={s.profitForYear.perBranch} consolidated={s.profitForYear.consolidated} multi={multi} highlight />
            </StatementCard>
          </div>

          {s.unmapped.length > 0 && (
            <div className="panel p-4">
              <div className="flex items-center gap-2 mb-2 text-warn">
                <AlertTriangle size={15} /> <span className="text-sm font-semibold">Unmapped ledgers ({s.unmapped.length})</span>
              </div>
              <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1 text-xs">
                {s.unmapped.slice(0, 20).map((u, i) => (
                  <div key={i} className="flex justify-between">
                    <span className="truncate">{u.ledger}</span>
                    <span className="nums text-ink-faint">{u.branch}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function StatementCard({
  title,
  branches,
  multi,
  children,
}: {
  title: string
  branches: string[]
  multi: boolean
  children: React.ReactNode
}) {
  return (
    <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="panel overflow-hidden">
      <div className="px-4 py-3 border-b border-line">
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wider text-ink-faint">
              <th className="th">Particulars</th>
              {multi && branches.map((b) => <th key={b} className="th text-right max-w-[120px] truncate">{b.split(' ')[0]}</th>)}
              <th className="th text-right">Consolidated</th>
            </tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      </div>
    </motion.section>
  )
}

function SectionHead({ label }: { label: string }) {
  return (
    <tr>
      <td className="td font-semibold text-ink-muted bg-bg-raised/40" colSpan={6}>
        {label}
      </td>
    </tr>
  )
}

function LineRow({ r, multi }: { r: Sch3LineResult; multi: boolean }) {
  const [open, setOpen] = useState(false)
  if (r.consolidated === 0 && r.perBranch.every((v) => v === 0)) return null
  const hasNotes = r.ledgers.length > 0
  return (
    <>
      <tr className={cn(hasNotes && 'cursor-pointer hover:bg-bg-hover')} onClick={() => hasNotes && setOpen((o) => !o)}>
        <td className="td">
          <span className="inline-flex items-center gap-1.5">
            {hasNotes && <ChevronDown size={12} className={cn('text-ink-faint transition-transform', open && 'rotate-180')} />}
            {r.line.label}
          </span>
        </td>
        {multi && r.perBranch.map((v, i) => <td key={i} className="td text-right"><Money value={v} /></td>)}
        <td className="td text-right font-medium"><Money value={r.consolidated} /></td>
      </tr>
      {open &&
        r.ledgers.map((l, i) => (
          <tr key={i} className="bg-bg-base/40 text-xs text-ink-muted">
            <td className="td pl-8">{l.name}</td>
            {multi && l.perBranch.map((v, j) => <td key={j} className="td text-right"><Money value={v} /></td>)}
            <td className="td text-right"><Money value={l.consolidated} /></td>
          </tr>
        ))}
    </>
  )
}

function TotalRow({
  label,
  perBranch,
  consolidated,
  multi,
  highlight,
}: {
  label: string
  perBranch: Paise[]
  consolidated: Paise
  multi: boolean
  highlight?: boolean
}) {
  return (
    <tr className={cn('border-t-2 border-line-strong font-bold', highlight && 'text-accent')}>
      <td className="td">{label}</td>
      {multi && perBranch.map((v, i) => <td key={i} className="td text-right"><Money value={v} /></td>)}
      <td className="td text-right"><Money value={consolidated} /></td>
    </tr>
  )
}

function ResidualRow({ value }: { value: Paise }) {
  const ok = Math.abs(value) < 10000
  return (
    <tr>
      <td className={cn('td text-xs', ok ? 'text-good' : 'text-bad')} colSpan={6}>
        {ok ? '✓ Balance Sheet balances' : `⚠ Out of balance by ${value}`}
      </td>
    </tr>
  )
}

function ChecksPanel({ checks }: { checks: CheckResult[] }) {
  const [open, setOpen] = useState(false)
  const sum = checkSummary(checks)
  return (
    <div className="panel overflow-hidden">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-bg-hover">
        <span className="text-sm font-semibold">Validation</span>
        <Pill tone="good"><CheckCircle2 size={12} /> {sum.pass}</Pill>
        {sum.warn > 0 && <Pill tone="warn"><AlertTriangle size={12} /> {sum.warn}</Pill>}
        {sum.fail > 0 && <Pill tone="bad"><XCircle size={12} /> {sum.fail}</Pill>}
        <ChevronDown size={16} className={cn('ml-auto text-ink-faint transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="border-t border-line/60 divide-y divide-line/40">
          {checks.map((c) => (
            <div key={c.id} className="px-4 py-2 flex items-start gap-3 text-sm">
              {c.status === 'pass' ? (
                <CheckCircle2 size={15} className="text-good mt-0.5 shrink-0" />
              ) : c.status === 'warn' ? (
                <AlertTriangle size={15} className="text-warn mt-0.5 shrink-0" />
              ) : (
                <XCircle size={15} className="text-bad mt-0.5 shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{c.label}</span>
                  <span className="text-[10px] uppercase text-ink-faint">{c.category}</span>
                </div>
                <div className="text-xs text-ink-muted">{c.detail}</div>
                {c.drill && c.drill.length > 0 && (
                  <div className="mt-1 text-[11px] text-ink-faint space-y-0.5">
                    {c.drill.map((d, i) => (
                      <div key={i}>{d}</div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
