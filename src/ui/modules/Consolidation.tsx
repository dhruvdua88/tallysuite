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
  CalendarDays,
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
import { Money } from '../components/atoms'
import { formatDate, fyLabel } from '../lib/format'
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
    <div className="mx-auto max-w-[1100px] space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Layers size={20} className="text-accent" />
          <h2 className="serif text-2xl font-semibold tracking-tight">Financial Statements</h2>
        </div>
        {result && (
          <button className="btn-primary" onClick={onExport} disabled={busy}>
            <FileSpreadsheet size={16} /> {busy ? 'Exporting…' : 'Export workbook'}
          </button>
        )}
      </div>

      {/* PERIOD BANNER — explicit, unmissable */}
      {s && (
        <div className="panel px-5 py-4">
          <div className="flex items-center gap-2 text-ink">
            <CalendarDays size={16} className="text-accent" />
            <span className="text-sm font-medium">
              Schedule III · For the year ended{' '}
              <span className="font-semibold">{formatDate(s.period.to)}</span>
              {s.period.from && <span className="text-ink-muted"> (from {formatDate(s.period.from)})</span>}
            </span>
            {!s.periodsMatch && (
              <span className="chip border-bad/40 bg-bad/10 text-bad ml-1">
                <TriangleAlert size={12} /> periods differ
              </span>
            )}
          </div>
        </div>
      )}

      {/* branch picker — each shows its own period so mismatches are obvious */}
      <div className="panel p-4">
        <div className="text-[11px] uppercase tracking-wide text-ink-faint mb-2.5">
          Entities to consolidate ({chosen.length} selected)
        </div>
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
                  'flex items-center gap-2.5 rounded-lg border px-3.5 py-2 text-sm transition-colors text-left',
                  on ? 'border-accent/40 bg-accent-soft text-ink' : 'border-line text-ink-muted hover:bg-bg-hover',
                )}
              >
                {on ? <CheckCircle2 size={15} className="text-accent shrink-0" /> : <div className="h-3.5 w-3.5 rounded-full border border-line-strong shrink-0" />}
                <span>
                  <span className="font-medium block leading-tight">{sl.dataset.meta.company}</span>
                  <span className="text-[11px] text-ink-faint">
                    {fyLabel(sl.dataset.meta.periodFrom, sl.dataset.meta.periodTo)} · {formatDate(sl.dataset.meta.periodFrom)}–{formatDate(sl.dataset.meta.periodTo)}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {!s && <div className="panel grid place-items-center py-16 text-sm text-ink-muted">Select at least one entity.</div>}

      {s && result && (
        <>
          {!s.periodsMatch && (
            <div className="panel border-bad/40 bg-bad/5 px-4 py-3 flex items-center gap-2 text-sm text-bad">
              <TriangleAlert size={16} /> Periods differ across entities — consolidation is invalid until they align.
            </div>
          )}

          <ChecksPanel checks={result.checks} />

          {/* BALANCE SHEET — full width */}
          <StatementCard
            title="Balance Sheet"
            subtitle={`as at ${formatDate(s.period.to)}`}
            branches={s.branches}
            multi={multi}
          >
            <SectionRow label="I. Equity and Liabilities" cols={colCount(multi, s.branches.length)} />
            {s.bsEquityLiability.map((r) => <LineRow key={r.line.id} r={r} multi={multi} />)}
            <TotalRow label="Total Equity and Liabilities" perBranch={s.totals.equityLiability.perBranch} consolidated={s.totals.equityLiability.consolidated} multi={multi} />
            <SectionRow label="II. Assets" cols={colCount(multi, s.branches.length)} />
            {s.bsAssets.map((r) => <LineRow key={r.line.id} r={r} multi={multi} />)}
            <TotalRow label="Total Assets" perBranch={s.totals.assets.perBranch} consolidated={s.totals.assets.consolidated} multi={multi} />
          </StatementCard>
          <ResidualNote value={s.bsResidual.consolidated} />

          {/* P&L — full width */}
          <StatementCard
            title="Statement of Profit and Loss"
            subtitle={`for the year ended ${formatDate(s.period.to)}`}
            branches={s.branches}
            multi={multi}
          >
            <SectionRow label="Income" cols={colCount(multi, s.branches.length)} />
            {s.plIncome.map((r) => <LineRow key={r.line.id} r={r} multi={multi} />)}
            <TotalRow label="Total Income" perBranch={s.totals.totalIncome.perBranch} consolidated={s.totals.totalIncome.consolidated} multi={multi} />
            <SectionRow label="Expenses" cols={colCount(multi, s.branches.length)} />
            {s.plExpense.map((r) => <LineRow key={r.line.id} r={r} multi={multi} />)}
            <TotalRow label="Total Expenses" perBranch={s.totals.totalExpense.perBranch} consolidated={s.totals.totalExpense.consolidated} multi={multi} />
            <TotalRow label="Profit / (Loss) for the year" perBranch={s.profitForYear.perBranch} consolidated={s.profitForYear.consolidated} multi={multi} highlight />
          </StatementCard>

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

function colCount(multi: boolean, branches: number): number {
  return 2 + (multi ? branches : 0) + 1
}

function StatementCard({
  title,
  subtitle,
  branches,
  multi,
  children,
}: {
  title: string
  subtitle: string
  branches: string[]
  multi: boolean
  children: React.ReactNode
}) {
  return (
    <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="panel overflow-hidden">
      <div className="px-5 py-3.5 border-b border-line">
        <h3 className="serif text-lg font-semibold">{title}</h3>
        <div className="text-xs text-ink-faint">{subtitle} · ₹</div>
      </div>
      <div className="overflow-x-auto">
        <table className="fin">
          <thead>
            <tr>
              <th>Particulars</th>
              <th className="num">Note</th>
              {multi && branches.map((b) => <th key={b} className="num">{b}</th>)}
              <th className="num">{multi ? 'Consolidated' : 'Amount'}</th>
            </tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      </div>
    </motion.section>
  )
}

function SectionRow({ label, cols }: { label: string; cols: number }) {
  return (
    <tr className="section">
      <td colSpan={cols}>{label}</td>
    </tr>
  )
}

function LineRow({ r, multi }: { r: Sch3LineResult; multi: boolean }) {
  const [open, setOpen] = useState(false)
  if (r.consolidated === 0 && r.perBranch.every((v) => v === 0)) return null
  const hasNotes = r.ledgers.length > 0
  return (
    <>
      <tr className={cn(hasNotes && 'cursor-pointer')} onClick={() => hasNotes && setOpen((o) => !o)}>
        <td>
          <span className="inline-flex items-center gap-1.5">
            {hasNotes && <ChevronDown size={12} className={cn('text-ink-faint transition-transform', open && 'rotate-180')} />}
            {r.line.label}
          </span>
        </td>
        <td className="num text-ink-faint">{r.line.note}</td>
        {multi && r.perBranch.map((v, i) => <td key={i} className="num"><Money value={v} /></td>)}
        <td className="num font-medium"><Money value={r.consolidated} /></td>
      </tr>
      {open &&
        r.ledgers.map((l, i) => (
          <tr key={i} className="bg-bg-base/40 text-ink-muted">
            <td className="pl-9 text-[12.5px]">{l.name}</td>
            <td className="num" />
            {multi && l.perBranch.map((v, j) => <td key={j} className="num text-[12.5px]"><Money value={v} /></td>)}
            <td className="num text-[12.5px]"><Money value={l.consolidated} /></td>
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
    <tr className={cn('total', highlight && 'text-accent')}>
      <td>{label}</td>
      <td className="num" />
      {multi && perBranch.map((v, i) => <td key={i} className="num"><Money value={v} /></td>)}
      <td className="num"><Money value={consolidated} /></td>
    </tr>
  )
}

function ResidualNote({ value }: { value: Paise }) {
  const ok = Math.abs(value) < 10000
  return (
    <div className={cn('text-xs px-1 -mt-2', ok ? 'text-good' : 'text-bad')}>
      {ok ? '✓ Balance Sheet balances' : `⚠ Books out of balance by ₹${(Math.abs(value) / 100).toLocaleString('en-IN')} — opening-balance difference in the source data`}
    </div>
  )
}

function ChecksPanel({ checks }: { checks: CheckResult[] }) {
  const [open, setOpen] = useState(false)
  const sum = checkSummary(checks)
  return (
    <div className="panel overflow-hidden">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-3 px-5 py-3 hover:bg-bg-hover">
        <span className="text-sm font-semibold">Validation</span>
        <span className="chip border-good/40 text-good bg-good/10"><CheckCircle2 size={12} /> {sum.pass}</span>
        {sum.warn > 0 && <span className="chip border-warn/40 text-warn bg-warn/10"><AlertTriangle size={12} /> {sum.warn}</span>}
        {sum.fail > 0 && <span className="chip border-bad/40 text-bad bg-bad/10"><XCircle size={12} /> {sum.fail}</span>}
        <ChevronDown size={16} className={cn('ml-auto text-ink-faint transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="border-t border-line/60 divide-y divide-line/40">
          {checks.map((c) => (
            <div key={c.id} className="px-5 py-2.5 flex items-start gap-3 text-sm">
              {c.status === 'pass' ? <CheckCircle2 size={15} className="text-good mt-0.5 shrink-0" /> : c.status === 'warn' ? <AlertTriangle size={15} className="text-warn mt-0.5 shrink-0" /> : <XCircle size={15} className="text-bad mt-0.5 shrink-0" />}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{c.label}</span>
                  <span className="text-[10px] uppercase text-ink-faint">{c.category}</span>
                </div>
                <div className="text-xs text-ink-muted">{c.detail}</div>
                {c.drill && c.drill.length > 0 && (
                  <div className="mt-1 text-[11px] text-ink-faint space-y-0.5">
                    {c.drill.map((d, i) => <div key={i}>{d}</div>)}
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
