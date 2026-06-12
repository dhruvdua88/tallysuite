import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import {
  Layers,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  FileSpreadsheet,
  FileWarning,
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
  type Sch3Statements,
} from '../../core/m3-sch3'
import { type Paise } from '../../core/model/money'
import type { SheetSpec } from '../../io/excel'
import { Money } from '../components/atoms'
import { formatDate, fyLabel } from '../lib/format'
import { cn } from '../lib/cn'

type ObservationRow = {
  severity: 'Error' | 'Warning' | 'Info'
  area: string
  observation: string
  detail: string
  action: string
}

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

  const [observationsBusy, setObservationsBusy] = useState(false)
  async function onExportObservations() {
    if (!result) return
    setObservationsBusy(true)
    try {
      const { exportTables } = await import('../../io/excel')
      await exportTables(buildObservationSheets(result.statements, result.checks), 'Schedule-III-Observations.xlsx')
      toast.success('Schedule III observations exported')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Export failed')
    } finally {
      setObservationsBusy(false)
    }
  }

  const multi = chosen.length > 1
  const s = result?.statements
  const summary = result ? checkSummary(result.checks) : null
  const observations = result ? buildObservationRows(result.statements, result.checks) : []

  return (
    <div className="mx-auto max-w-[1100px] space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Layers size={20} className="text-accent" />
          <h2 className="serif text-2xl font-semibold tracking-tight">Financial Statements</h2>
        </div>
        {result && summary && (
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn-soft" onClick={onExportObservations} disabled={observationsBusy}>
              <FileWarning size={16} /> {observationsBusy ? 'Exporting…' : 'Export observations'}
            </button>
            <button className="btn-primary" onClick={onExport} disabled={busy}>
              <FileSpreadsheet size={16} /> {busy ? 'Exporting…' : 'Export workbook'}
            </button>
          </div>
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

          <ReviewSummary checks={result.checks} observations={observations} />

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

function severityFor(status: CheckResult['status']): ObservationRow['severity'] {
  return status === 'fail' ? 'Error' : status === 'warn' ? 'Warning' : 'Info'
}

function actionFor(check: CheckResult): string {
  if (check.id === 'bs-balances') return 'Review opening balances, profit routing, and unmapped/reclassified ledgers.'
  if (check.id === 'consol-additivity') return 'Check selected entities and branch columns before using consolidated totals.'
  if (check.id === 'profit-tieout') return 'Review P&L mapping and nominal ledger movement for the selected period.'
  if (check.id === 'liab-debit') return 'Review whether debit balances under liability heads need reclassification.'
  if (check.id === 'asset-credit') return 'Review whether credit balances under asset heads need reclassification.'
  if (check.id === 'neg-cash') return 'Review bank overdraft, cash book sign, or current-liability classification.'
  if (check.id === 'period-match') return 'Use entities with matching period-from and period-to dates.'
  if (check.id === 'unmapped') return 'Map every unmapped ledger to the correct Schedule III head.'
  return check.status === 'pass' ? 'No action required.' : 'Review and resolve before finalization.'
}

function buildObservationRows(s: Sch3Statements, checks: CheckResult[]): ObservationRow[] {
  const rows: ObservationRow[] = checks
    .filter((check) => check.status !== 'pass')
    .map((check) => ({
      severity: severityFor(check.status),
      area: check.category,
      observation: check.label,
      detail: check.detail,
      action: actionFor(check),
    }))

  if (s.unmapped.length > 0) {
    rows.push(
      ...s.unmapped.map((item) => ({
        severity: 'Warning' as const,
        area: 'Ledger mapping',
        observation: 'Unmapped ledger',
        detail: `${item.ledger} · ${item.branch} · ${formatObservationAmount(item.value)}`,
        action: 'Assign this ledger to the correct Schedule III head.',
      })),
    )
  }

  if (rows.length === 0) {
    rows.push({
      severity: 'Info',
      area: 'Review status',
      observation: 'No open Schedule III observations',
      detail: `${s.branches.join(' + ')} · ${formatDate(s.period.from)} to ${formatDate(s.period.to)}`,
      action: 'Review statement presentation and notes before final issue.',
    })
  }
  return rows
}

function buildObservationSheets(s: Sch3Statements, checks: CheckResult[]): SheetSpec[] {
  const observations = buildObservationRows(s, checks)
  const summary = checkSummary(checks)
  return [
    {
      name: 'Observations',
      columns: [
        { header: 'Severity', key: 'severity', width: 12 },
        { header: 'Area', key: 'area', width: 20 },
        { header: 'Observation', key: 'observation', width: 42 },
        { header: 'Detail', key: 'detail', width: 70 },
        { header: 'Suggested Action', key: 'action', width: 58 },
      ],
      rows: observations,
    },
    {
      name: 'Summary',
      columns: [
        { header: 'Field', key: 'field', width: 28 },
        { header: 'Value', key: 'value', width: 72 },
      ],
      rows: [
        { field: 'Entity / consolidation', value: s.branches.join(' + ') },
        { field: 'Period', value: `${formatDate(s.period.from)} to ${formatDate(s.period.to)}` },
        { field: 'Periods match', value: s.periodsMatch ? 'Yes' : 'No' },
        { field: 'Checks passed', value: summary.pass },
        { field: 'Warnings', value: summary.warn },
        { field: 'Errors', value: summary.fail },
        { field: 'Unmapped ledgers', value: s.unmapped.length },
        { field: 'Balance sheet residual', value: formatObservationAmount(s.bsResidual.consolidated) },
      ],
    },
  ]
}

function formatObservationAmount(value: Paise): string {
  return `₹${(value / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
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

function ReviewSummary({ checks, observations }: { checks: CheckResult[]; observations: ObservationRow[] }) {
  const [open, setOpen] = useState(false)
  const sum = checkSummary(checks)
  const priority = observations.filter((o) => o.severity !== 'Info').slice(0, 4)
  const status =
    sum.fail > 0
      ? { label: 'Needs correction', tone: 'bad' as const, icon: XCircle }
      : sum.warn > 0
        ? { label: 'Review required', tone: 'warn' as const, icon: AlertTriangle }
        : { label: 'Ready for review', tone: 'good' as const, icon: CheckCircle2 }
  const StatusIcon = status.icon

  return (
    <section className="panel overflow-hidden">
      <div className="border-b border-line px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <StatusIcon size={18} className={cn(status.tone === 'bad' ? 'text-bad' : status.tone === 'warn' ? 'text-warn' : 'text-good')} />
              <h3 className="serif text-lg font-semibold">Schedule III review</h3>
            </div>
            <div className="mt-1 text-sm text-ink-muted">{status.label} · {observations.length} observation{observations.length === 1 ? '' : 's'} available for export</div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <ReviewCount label="Pass" value={sum.pass} tone="good" />
            <ReviewCount label="Warn" value={sum.warn} tone="warn" />
            <ReviewCount label="Fail" value={sum.fail} tone="bad" />
          </div>
        </div>
      </div>

      <div className="grid gap-3 px-5 py-4 lg:grid-cols-[1fr_0.8fr]">
        <div className="space-y-2">
          <div className="text-[11px] uppercase tracking-wide text-ink-faint">Priority observations</div>
          {priority.length > 0 ? (
            priority.map((o, i) => <ObservationItem key={`${o.observation}-${i}`} item={o} />)
          ) : (
            <div className="rounded-lg border border-good/30 bg-good/5 px-3 py-2 text-sm text-good">
              No blocking Schedule III observations from automated checks.
            </div>
          )}
        </div>

        <div className="rounded-lg border border-line bg-bg-raised p-3">
          <div className="text-[11px] uppercase tracking-wide text-ink-faint">Review focus</div>
          <div className="mt-2 space-y-2 text-sm text-ink-muted">
            <div>Review negative balances under asset/liability heads before finalization.</div>
            <div>Resolve unmapped ledgers so notes and face statements stay clean.</div>
            <div>Keep observation follow-up separate from face statement finalization.</div>
          </div>
        </div>
      </div>

      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 border-t border-line px-5 py-2.5 text-sm text-ink-muted hover:bg-bg-hover">
        <ChevronDown size={16} className={cn('transition-transform', open && 'rotate-180')} />
        {open ? 'Hide validation details' : 'Show validation details'}
      </button>
      {open && <ValidationDetails checks={checks} />}
    </section>
  )
}

function ReviewCount({ label, value, tone }: { label: string; value: number; tone: 'good' | 'warn' | 'bad' }) {
  const color = tone === 'good' ? 'text-good' : tone === 'warn' ? 'text-warn' : 'text-bad'
  return (
    <div className="min-w-[70px] rounded-lg border border-line bg-bg-raised px-3 py-2 text-center">
      <div className={cn('nums text-lg font-semibold', color)}>{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-ink-faint">{label}</div>
    </div>
  )
}

function ObservationItem({ item }: { item: ObservationRow }) {
  const tone = item.severity === 'Error' ? 'bad' : item.severity === 'Warning' ? 'warn' : 'good'
  return (
    <div className={cn('rounded-lg border px-3 py-2', tone === 'bad' ? 'border-bad/35 bg-bad/5' : tone === 'warn' ? 'border-warn/35 bg-warn/5' : 'border-good/35 bg-good/5')}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn('chip', tone === 'bad' ? 'border-bad/40 bg-bad/10 text-bad' : tone === 'warn' ? 'border-warn/40 bg-warn/10 text-warn' : 'border-good/40 bg-good/10 text-good')}>{item.severity}</span>
        <span className="text-sm font-medium text-ink">{item.observation}</span>
        <span className="text-[11px] uppercase tracking-wide text-ink-faint">{item.area}</span>
      </div>
      <div className="mt-1 text-xs text-ink-muted">{item.detail}</div>
      <div className="mt-1 text-xs text-ink-faint">{item.action}</div>
    </div>
  )
}

function ValidationDetails({ checks }: { checks: CheckResult[] }) {
  return (
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
  )
}
