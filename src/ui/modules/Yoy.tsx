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
import { cn } from '../lib/cn'

export function Yoy() {
  const { slots } = useStore()
  const [priorId, setPriorId] = useState<string | null>(slots[0]?.id ?? null)
  const [currentId, setCurrentId] = useState<string | null>(slots[1]?.id ?? slots[0]?.id ?? null)
  const prior = slots.find((s) => s.id === priorId)
  const current = slots.find((s) => s.id === currentId)

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
        { header: 'Δ', key: 'delta', width: 18, money: true },
        { header: 'Δ %', key: 'deltaPct', width: 10 },
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
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <CalendarRange size={20} className="text-accent" />
          <h2 className="text-xl font-bold tracking-tight">Year-on-Year</h2>
        </div>
        {result && (
          <button className="btn-primary" onClick={onExport} disabled={busy}>
            <FileSpreadsheet size={16} /> {busy ? 'Exporting…' : 'Export workbook'}
          </button>
        )}
      </div>

      <div className="panel p-4 flex flex-wrap items-center gap-3">
        <Picker label="Prior year" value={priorId} onChange={setPriorId} />
        <ArrowRight className="text-ink-faint" />
        <Picker label="Current year" value={currentId} onChange={setCurrentId} />
      </div>

      {!result && <div className="panel grid place-items-center py-16 text-sm text-ink-muted">Pick two periods of the same company.</div>}

      {result && (
        <>
          <div className={cn('panel px-4 py-3 flex flex-wrap items-center gap-4 text-sm', result.guard.warning && 'border-warn/40 bg-warn/5')}>
            {result.guard.warning ? (
              <span className="flex items-center gap-2 text-warn font-medium"><TriangleAlert size={16} /> {result.guard.warning}</span>
            ) : (
              <span className="flex items-center gap-2 text-good font-medium"><ShieldCheck size={16} /> {result.company} · sequential periods</span>
            )}
            <span className="text-ink-muted">{result.guard.priorPeriod} → {result.guard.currentPeriod}</span>
          </div>

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

          <div className="grid gap-5 lg:grid-cols-2">
            <YoYTable title="Balance Sheet" sections={[['Equity & Liabilities', result.bsEquityLiability], ['Assets', result.bsAssets]]} />
            <YoYTable title="Profit & Loss" sections={[['Income', result.plIncome], ['Expenses', result.plExpense]]} />
          </div>

          <div className="grid gap-5 lg:grid-cols-3">
            <MoverList title="Top movers" icon={TrendingUp} moves={result.topMovers} showDelta />
            <MoverList title="New ledgers" icon={Plus} moves={result.newLedgers} />
            <MoverList title="Closed ledgers" icon={Minus} moves={result.goneLedgers} usePrior />
          </div>
        </>
      )}
    </div>
  )
}

function RatioCard({ r }: { r: Ratio }) {
  const fmt = (v: number | null) => (v == null ? '—' : r.unit === 'days' ? `${Math.round(v)}` : r.unit === '%' ? `${v.toFixed(1)}` : v.toFixed(2))
  const improved =
    r.prior != null && r.current != null
      ? r.favourable === 'higher'
        ? r.current >= r.prior
        : r.current <= r.prior
      : null
  return (
    <div className="stat-card">
      <div className="text-[11px] uppercase tracking-wider text-ink-faint">{r.name}</div>
      <div className="flex items-baseline gap-2">
        <span className="text-ink-faint text-sm nums">{fmt(r.prior)}</span>
        <ArrowRight size={12} className="text-ink-faint" />
        <span className={cn('text-xl font-bold nums', improved == null ? '' : improved ? 'text-good' : 'text-bad')}>
          {fmt(r.current)}
        </span>
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
      <div className="text-[11px] uppercase tracking-wider text-ink-faint">{label}</div>
      <div className="text-lg font-semibold nums"><Money value={line.current} /></div>
      <div className={cn('text-xs flex items-center gap-1 nums', good ? 'text-good' : 'text-bad')}>
        {up ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
        {line.deltaPct == null ? formatINR(line.delta, { sign: true }) : `${line.deltaPct > 0 ? '+' : ''}${line.deltaPct.toFixed(1)}%`}
      </div>
    </div>
  )
}

function YoYTable({ title, sections }: { title: string; sections: [string, YoYLine[]][] }) {
  return (
    <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="panel overflow-hidden">
      <div className="px-4 py-3 border-b border-line"><h3 className="text-sm font-semibold">{title}</h3></div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wider text-ink-faint">
              <th className="th">Particulars</th>
              <th className="th text-right">Prior</th>
              <th className="th text-right">Current</th>
              <th className="th text-right">Δ</th>
              <th className="th text-right">Δ%</th>
            </tr>
          </thead>
          {sections.map(([heading, lines]) => (
            <tbody key={heading}>
              <tr><td className="td font-semibold text-ink-muted bg-bg-raised" colSpan={5}>{heading}</td></tr>
              {lines.map((l) => (
                <tr key={l.id}>
                  <td className="td">{l.label}</td>
                  <td className="td text-right"><Money value={l.prior} /></td>
                  <td className="td text-right"><Money value={l.current} /></td>
                  <td className="td text-right"><Money value={l.delta} colorByDirection signed /></td>
                  <td className={cn('td text-right nums text-xs', l.deltaPct == null ? 'text-ink-faint' : l.deltaPct >= 0 ? 'text-credit' : 'text-debit')}>
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

function MoverList({
  title,
  icon: Icon,
  moves,
  showDelta,
  usePrior,
}: {
  title: string
  icon: typeof TrendingUp
  moves: LedgerMove[]
  showDelta?: boolean
  usePrior?: boolean
}) {
  return (
    <section className="panel p-4">
      <div className="flex items-center gap-2 mb-2"><Icon size={15} className="text-accent" /><h3 className="text-sm font-semibold">{title}</h3><span className="text-xs text-ink-faint">{moves.length}</span></div>
      <div className="space-y-1 max-h-[40vh] overflow-y-auto pr-1">
        {moves.map((m, i) => (
          <div key={i} className="flex items-center justify-between text-xs py-0.5">
            <span className="truncate max-w-[140px]">{m.name}</span>
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
      <span className="text-[11px] uppercase tracking-wider text-ink-faint">{label}</span>
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-line bg-bg-raised px-3 py-2 text-sm text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 min-w-[200px]"
      >
        <option value="" disabled>select…</option>
        {slots.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.dataset.meta.periodTo})</option>)}
      </select>
    </label>
  )
}
