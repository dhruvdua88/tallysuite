import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import {
  CalendarRange,
  ArrowRight,
  TrendingUp,
  TrendingDown,
  TriangleAlert,
  ShieldCheck,
  FileSpreadsheet,
  Plus,
  Minus,
} from 'lucide-react'
import { useStore } from '../../state/store'
import { compareYears, type YoYLine, type Ratio, type LedgerMove } from '../../core/m4-yoy/yoy'
import { formatINR } from '../../core/model/money'
import { Money } from '../components/atoms'
import { formatDate, fyLabel } from '../lib/format'
import { cn } from '../lib/cn'

export function Yoy() {
  const { slots } = useStore()
  const [priorId, setPriorId] = useState<string | null>(slots[0]?.id ?? null)
  const [currentId, setCurrentId] = useState<string | null>(slots[1]?.id ?? slots[0]?.id ?? null)
  const prior = slots.find((s) => s.id === priorId)
  const current = slots.find((s) => s.id === currentId)
  const sameSlot = prior && current && prior.id === current.id

  const result = useMemo(() => {
    if (!prior || !current || prior.id === current.id) return null
    return compareYears(prior.dataset, current.dataset)
  }, [prior, current])

  const [busy, setBusy] = useState(false)
  async function onExport() {
    if (!result) return
    setBusy(true)
    try {
      const { exportTables } = await import('../../io/excel')
      const lineRows = (ls: YoYLine[]) =>
        ls.map((l) => ({ particulars: l.label, prior: l.prior / 100, current: l.current / 100, delta: l.delta / 100, deltaPct: l.deltaPct == null ? '' : Math.round(l.deltaPct * 10) / 10 }))
      const cols = [
        { header: 'Particulars', key: 'particulars', width: 38 },
        { header: 'Prior', key: 'prior', width: 18, money: true },
        { header: 'Current', key: 'current', width: 18, money: true },
        { header: 'Change', key: 'delta', width: 18, money: true },
        { header: 'Change %', key: 'deltaPct', width: 10 },
      ]
      await exportTables(
        [
          { name: 'Balance Sheet YoY', columns: cols, rows: [...lineRows(result.bsEquityLiability), ...lineRows(result.bsAssets)] },
          { name: 'P&L YoY', columns: cols, rows: [...lineRows(result.plIncome), ...lineRows(result.plExpense)] },
          { name: 'Top Movers', columns: cols, rows: result.topMovers.map((m) => ({ particulars: m.name, prior: m.prior / 100, current: m.current / 100, delta: m.delta / 100, deltaPct: m.deltaPct == null ? '' : Math.round(m.deltaPct * 10) / 10 })) },
        ],
        'YoY-Comparison.xlsx',
      )
      toast.success('YoY workbook exported')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Export failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-[1100px] space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <CalendarRange size={20} className="text-accent" />
          <h2 className="serif text-2xl font-semibold tracking-tight">Year-on-Year</h2>
        </div>
        {result && (
          <button className="btn-primary" onClick={onExport} disabled={busy}>
            <FileSpreadsheet size={16} /> {busy ? 'Exporting…' : 'Export workbook'}
          </button>
        )}
      </div>

      <div className="panel p-4 flex flex-wrap items-center gap-3">
        <Picker label="Prior year" value={priorId} onChange={setPriorId} />
        <ArrowRight className="text-ink-faint mt-5" />
        <Picker label="Current year" value={currentId} onChange={setCurrentId} />
      </div>

      {/* guidance / guard */}
      {sameSlot && <Hint>Pick two <b>different</b> periods — prior year and current year — of the same company.</Hint>}
      {!prior || !current ? <Hint>Select a prior-year and current-year export above to compare.</Hint> : null}
      {result && !result.guard.sameCompany && (
        <div className="panel border-bad/40 bg-bad/5 px-4 py-3 text-sm">
          <div className="flex items-center gap-2 text-bad font-medium"><TriangleAlert size={16} /> These are two different companies.</div>
          <div className="text-ink-muted mt-1">
            Year-on-Year compares the <b>same</b> entity across two periods. Load last year's and this year's export of one company.
            (Showing the comparison anyway, but movers and ratios will not be meaningful.)
          </div>
        </div>
      )}

      {result && (
        <>
          {result.guard.sameCompany && (
            <div className="panel px-5 py-3.5 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm">
              <span className="flex items-center gap-2 text-good font-medium"><ShieldCheck size={16} /> {result.company}</span>
              <span className="text-ink-muted">
                Comparing <b>{fyLabel(prior!.dataset.meta.periodFrom, prior!.dataset.meta.periodTo)}</b> ({formatDate(prior!.dataset.meta.periodTo)})
                {' → '}
                <b>{fyLabel(current!.dataset.meta.periodFrom, current!.dataset.meta.periodTo)}</b> ({formatDate(current!.dataset.meta.periodTo)})
              </span>
              {!result.guard.sequential && <span className="chip border-warn/40 bg-warn/10 text-warn"><TriangleAlert size={12} /> not consecutive years</span>}
            </div>
          )}

          {/* ratios */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            {result.ratios.map((r) => <RatioCard key={r.name} r={r} />)}
          </div>

          {/* headline totals */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <HeadStat line={result.totals.income} label="Total Income" />
            <HeadStat line={result.totals.expense} label="Total Expense" invertColor />
            <HeadStat line={result.profit} label="Profit" />
            <HeadStat line={result.totals.assets} label="Total Assets" />
          </div>

          {/* full-width statements */}
          <YoYTable title="Balance Sheet" priorLabel={fyLabel(prior!.dataset.meta.periodFrom, prior!.dataset.meta.periodTo) || 'Prior'} currentLabel={fyLabel(current!.dataset.meta.periodFrom, current!.dataset.meta.periodTo) || 'Current'} sections={[['Equity & Liabilities', result.bsEquityLiability], ['Assets', result.bsAssets]]} />
          <YoYTable title="Profit & Loss" priorLabel={fyLabel(prior!.dataset.meta.periodFrom, prior!.dataset.meta.periodTo) || 'Prior'} currentLabel={fyLabel(current!.dataset.meta.periodFrom, current!.dataset.meta.periodTo) || 'Current'} sections={[['Income', result.plIncome], ['Expenses', result.plExpense]]} />

          <div className="grid gap-5 lg:grid-cols-3">
            <MoverList title="Biggest movements" icon={TrendingUp} moves={result.topMovers} showDelta />
            <MoverList title="New ledgers" icon={Plus} moves={result.newLedgers} />
            <MoverList title="Closed ledgers" icon={Minus} moves={result.goneLedgers} usePrior />
          </div>
        </>
      )}
    </div>
  )
}

function Hint({ children }: { children: React.ReactNode }) {
  return <div className="panel px-4 py-3 text-sm text-ink-muted">{children}</div>
}

function RatioCard({ r }: { r: Ratio }) {
  const fmt = (v: number | null) => (v == null ? '—' : r.unit === 'days' ? `${Math.round(v)}` : r.unit === '%' ? `${v.toFixed(1)}` : v.toFixed(2))
  const improved = r.prior != null && r.current != null ? (r.favourable === 'higher' ? r.current >= r.prior : r.current <= r.prior) : null
  return (
    <div className="stat-card">
      <div className="text-[11px] uppercase tracking-wide text-ink-faint">{r.name}</div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-ink-faint text-sm nums">{fmt(r.prior)}</span>
        <ArrowRight size={11} className="text-ink-faint" />
        <span className={cn('serif text-xl font-semibold nums', improved == null ? '' : improved ? 'text-good' : 'text-bad')}>{fmt(r.current)}</span>
        <span className="text-xs text-ink-faint">{r.unit}</span>
      </div>
    </div>
  )
}

function HeadStat({ line, label, invertColor }: { line: YoYLine; label: string; invertColor?: boolean }) {
  const up = line.delta > 0
  const good = invertColor ? !up : up
  return (
    <div className="stat-card">
      <div className="text-[11px] uppercase tracking-wide text-ink-faint">{label}</div>
      <div className="serif text-lg font-semibold nums"><Money value={line.current} /></div>
      <div className={cn('text-xs flex items-center gap-1 nums', good ? 'text-good' : 'text-bad')}>
        {up ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
        {line.deltaPct == null ? formatINR(line.delta, { sign: true }) : `${line.deltaPct > 0 ? '+' : ''}${line.deltaPct.toFixed(1)}%`}
      </div>
    </div>
  )
}

function YoYTable({ title, priorLabel, currentLabel, sections }: { title: string; priorLabel: string; currentLabel: string; sections: [string, YoYLine[]][] }) {
  return (
    <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="panel overflow-hidden">
      <div className="px-5 py-3.5 border-b border-line"><h3 className="serif text-lg font-semibold">{title}</h3></div>
      <div className="overflow-x-auto">
        <table className="fin">
          <thead>
            <tr>
              <th>Particulars</th>
              <th className="num">{priorLabel}</th>
              <th className="num">{currentLabel}</th>
              <th className="num">Change</th>
              <th className="num">%</th>
            </tr>
          </thead>
          {sections.map(([heading, lines]) => (
            <tbody key={heading}>
              <tr className="section"><td colSpan={5}>{heading}</td></tr>
              {lines.map((l) => (
                <tr key={l.id}>
                  <td>{l.label}</td>
                  <td className="num"><Money value={l.prior} /></td>
                  <td className="num"><Money value={l.current} /></td>
                  <td className="num"><Money value={l.delta} colorByDirection signed /></td>
                  <td className={cn('num text-xs', l.deltaPct == null ? 'text-ink-faint' : l.deltaPct >= 0 ? 'text-credit' : 'text-debit')}>
                    {l.deltaPct == null ? '—' : `${l.deltaPct > 0 ? '+' : ''}${l.deltaPct.toFixed(0)}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
    </motion.section>
  )
}

function MoverList({ title, icon: Icon, moves, showDelta, usePrior }: { title: string; icon: typeof TrendingUp; moves: LedgerMove[]; showDelta?: boolean; usePrior?: boolean }) {
  return (
    <section className="panel p-4">
      <div className="flex items-center gap-2 mb-2"><Icon size={15} className="text-accent" /><h3 className="text-sm font-semibold">{title}</h3><span className="text-xs text-ink-faint">{moves.length}</span></div>
      <div className="space-y-1 max-h-[40vh] overflow-y-auto pr-1">
        {moves.map((m, i) => (
          <div key={i} className="flex items-center justify-between text-xs py-0.5 gap-2">
            <span className="truncate flex-1">{m.name}</span>
            <Money value={showDelta ? m.delta : usePrior ? m.prior : m.current} colorByDirection={showDelta} signed={showDelta} />
          </div>
        ))}
        {moves.length === 0 && <div className="text-xs text-ink-faint">none</div>}
      </div>
    </section>
  )
}

function Picker({ label, value, onChange }: { label: string; value: string | null; onChange: (id: string) => void }) {
  const slots = useStore((s) => s.slots)
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] uppercase tracking-wide text-ink-faint">{label}</span>
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-line bg-bg-raised px-3 py-2 text-sm text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 min-w-[220px]"
      >
        <option value="" disabled>select…</option>
        {slots.map((s) => <option key={s.id} value={s.id}>{s.dataset.meta.company} ({fyLabel(s.dataset.meta.periodFrom, s.dataset.meta.periodTo)})</option>)}
      </select>
    </label>
  )
}
