import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import { CalendarRange, TriangleAlert, ShieldCheck, FileSpreadsheet, Search } from 'lucide-react'
import { useStore } from '../../state/store'
import {
  buildSeries,
  heatBucket,
  pctDelta,
  maxAbsDelta,
  type YoYSeries,
  type SeriesRow,
  type SeriesBlock,
  type RatioSeries,
} from '../../core/m4-yoy/series'
import type { Paise } from '../../core/model/money'
import { fyLabel, formatDate } from '../lib/format'
import { heatStyle } from '../lib/heat'
import { cn } from '../lib/cn'

type Basis = 'pct' | 'abs' | 'cs'
const LEDGER_CAP = 60

export function Yoy() {
  const slots = useStore((s) => s.slots)

  // Default selection: all slots that share the most-common company, sorted by period end.
  const defaultIds = useMemo(() => {
    if (slots.length === 0) return []
    const byCo = new Map<string, string[]>()
    for (const s of slots) {
      const k = s.dataset.meta.companyGuidPrefix ?? s.dataset.meta.company
      byCo.set(k, [...(byCo.get(k) ?? []), s.id])
    }
    const biggest = [...byCo.values()].sort((a, b) => b.length - a.length)[0] ?? []
    return biggest.length >= 2 ? biggest : slots.map((s) => s.id)
  }, [slots])

  const [selected, setSelected] = useState<string[]>(defaultIds)
  const [basis, setBasis] = useState<Basis>('pct')
  const [threshold, setThreshold] = useState(50) // ₹ lakh
  const [query, setQuery] = useState('')
  const [showAll, setShowAll] = useState(false)

  const chosen = selected.length ? selected : defaultIds
  const datasets = useMemo(
    () =>
      chosen
        .map((id) => slots.find((s) => s.id === id))
        .filter((s): s is NonNullable<typeof s> => !!s)
        .map((s) => ({ slotId: s.id, dataset: s.dataset })),
    [chosen, slots],
  )

  const series = useMemo(() => (datasets.length >= 2 ? buildSeries(datasets) : null), [datasets])

  const toggle = (id: string) =>
    setSelected((cur) => {
      const base = cur.length ? cur : defaultIds
      return base.includes(id) ? base.filter((x) => x !== id) : [...base, id]
    })

  const [busy, setBusy] = useState(false)
  async function onExport() {
    if (!series) return
    setBusy(true)
    try {
      await exportSeries(series)
      toast.success('YoY workbook exported')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Export failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-[1200px] space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <CalendarRange size={20} className="text-accent" />
          <h2 className="serif text-2xl font-semibold tracking-tight">Year-on-Year</h2>
        </div>
        {series && (
          <button className="btn-primary" onClick={onExport} disabled={busy}>
            <FileSpreadsheet size={16} /> {busy ? 'Exporting…' : 'Export workbook'}
          </button>
        )}
      </div>

      {/* period picker — multi-slot */}
      <div className="panel p-4 space-y-2.5">
        <div className="text-[11px] uppercase tracking-wide text-ink-faint">Periods · pick two or more of the same company</div>
        <div className="flex flex-wrap gap-2">
          {slots.map((s) => {
            const on = chosen.includes(s.id)
            return (
              <button
                key={s.id}
                onClick={() => toggle(s.id)}
                className={cn(
                  'chip border transition-colors',
                  on ? 'border-accent/50 bg-accent-soft text-accent-hover' : 'border-line text-ink-muted hover:bg-bg-raised',
                )}
              >
                {fyLabel(s.dataset.meta.periodFrom, s.dataset.meta.periodTo) || s.dataset.meta.company}
              </button>
            )
          })}
          {slots.length === 0 && <span className="text-sm text-ink-faint">Load two or more exports to compare.</span>}
        </div>
      </div>

      {datasets.length < 2 && slots.length > 0 && (
        <div className="panel px-4 py-3 text-sm text-ink-muted">Select at least two periods above to build the comparison.</div>
      )}

      {series && (
        <>
          {/* guard */}
          {series.sameCompany ? (
            <div className="panel px-5 py-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm">
              <span className="flex items-center gap-2 text-good font-medium"><ShieldCheck size={16} /> {series.periods[0]?.company}</span>
              <span className="text-ink-muted">
                {series.periods.length} periods · {formatDate(series.periods[0]?.periodTo ?? null)} → {formatDate(series.periods.at(-1)?.periodTo ?? null)}
              </span>
            </div>
          ) : (
            <div className="panel border-bad/40 bg-bad/5 px-4 py-3 text-sm">
              <div className="flex items-center gap-2 text-bad font-medium"><TriangleAlert size={16} /> Periods span different companies.</div>
              <div className="text-ink-muted mt-1">Movers and ratios will not be meaningful. Pick periods of one entity.</div>
            </div>
          )}

          {/* ratio trend */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            {series.ratios.map((r) => <RatioTrend key={r.name} r={r} />)}
          </div>

          {/* basis toggle */}
          <div className="flex items-center gap-2 text-sm">
            <span className="text-ink-faint text-xs uppercase tracking-wide">cell shows</span>
            <Seg active={basis === 'pct'} onClick={() => setBasis('pct')}>%Δ</Seg>
            <Seg active={basis === 'abs'} onClick={() => setBasis('abs')}>₹ value</Seg>
            <Seg active={basis === 'cs'} onClick={() => setBasis('cs')}>common-size</Seg>
          </div>

          {/* statement heatmaps */}
          <HeatGrid block={series.bs} periods={series.periods} basis={basis} />
          <HeatGrid block={series.pl} periods={series.periods} basis={basis} />

          {/* ledger drill */}
          <LedgerHeat
            rows={series.ledgers}
            periods={series.periods}
            basis={basis}
            threshold={threshold}
            setThreshold={setThreshold}
            query={query}
            setQuery={setQuery}
            showAll={showAll}
            setShowAll={setShowAll}
          />

          <Legend />
        </>
      )}
    </div>
  )
}

// ---------- cells ----------
function fmtCompact(p: Paise): string {
  const r = p / 100
  const a = Math.abs(r)
  const s = r < 0 ? '-' : ''
  if (a >= 1e7) return `${s}${(a / 1e7).toFixed(2)} Cr`
  if (a >= 1e5) return `${s}${(a / 1e5).toFixed(2)} L`
  return `${s}${Math.round(a).toLocaleString('en-IN')}`
}
const fmtPct = (v: number | null) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(0)}%`)

function HeatCell({ values, i, basis, denom }: { values: (Paise | null)[]; i: number; basis: Basis; denom: number | null }) {
  const cur = values[i] ?? null
  const prev = i > 0 ? values[i - 1] ?? null : null
  const pct = pctDelta(prev, cur)
  const style = i === 0 ? heatStyle(0) : heatStyle(heatBucket(pct))

  let primary: string
  let secondary: string
  if (cur == null) {
    primary = '—'
    secondary = ''
  } else if (basis === 'pct') {
    primary = i === 0 ? fmtCompact(cur) : fmtPct(pct)
    secondary = i === 0 ? '' : fmtCompact(cur)
  } else if (basis === 'abs') {
    primary = fmtCompact(cur)
    secondary = i === 0 || prev == null ? '' : fmtCompact((cur - prev) as Paise)
  } else {
    primary = denom && denom !== 0 ? `${((cur / denom) * 100).toFixed(1)}%` : '—'
    secondary = fmtCompact(cur)
  }

  return (
    <td className="num px-2.5 py-1.5 align-top" style={{ background: style.bg }}>
      <div className="nums tabular-nums text-[12px] font-medium leading-tight" style={{ color: cur == null ? undefined : style.fg }}>{primary}</div>
      {secondary && <div className="nums tabular-nums text-[10px] leading-tight opacity-80" style={{ color: style.fg }}>{secondary}</div>}
    </td>
  )
}

function denomFor(block: SeriesBlock, headingMatch: string, nPeriods: number): (number | null)[] {
  const sec = block.sections.find((s) => s.heading === headingMatch)
  const out: (number | null)[] = Array.from({ length: nPeriods }, () => 0)
  if (!sec) return out.map(() => null)
  for (let i = 0; i < nPeriods; i++) {
    let sum = 0
    for (const row of sec.rows) sum += row.values[i] ?? 0
    out[i] = sum
  }
  return out
}

function HeatGrid({ block, periods, basis }: { block: SeriesBlock; periods: YoYSeries['periods']; basis: Basis }) {
  // Common-size denominator: Income for P&L, Assets for Balance Sheet.
  const denom = useMemo(() => {
    const key = block.title === 'Balance Sheet' ? 'Assets' : 'Income'
    return denomFor(block, key, periods.length)
  }, [block, periods.length])

  return (
    <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="panel overflow-hidden">
      <div className="px-5 py-3.5 border-b border-line"><h3 className="serif text-lg font-semibold">{block.title}</h3></div>
      <div className="overflow-x-auto">
        <table className="fin w-full">
          <thead>
            <tr>
              <th className="text-left">Particulars</th>
              {periods.map((p, i) => <th key={i} className="num">{fyLabel(p.periodFrom, p.periodTo) || formatDate(p.periodTo)}</th>)}
            </tr>
          </thead>
          {block.sections.map((sec) => (
            <tbody key={sec.heading}>
              <tr className="section"><td colSpan={periods.length + 1}>{sec.heading}</td></tr>
              {sec.rows.map((row) => (
                <tr key={row.key}>
                  <td>{row.label}</td>
                  {row.values.map((_, i) => <HeatCell key={i} values={row.values} i={i} basis={basis} denom={denom[i] ?? null} />)}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
    </motion.section>
  )
}

function LedgerHeat({
  rows, periods, basis, threshold, setThreshold, query, setQuery, showAll, setShowAll,
}: {
  rows: SeriesRow[]
  periods: YoYSeries['periods']
  basis: Basis
  threshold: number
  setThreshold: (n: number) => void
  query: string
  setQuery: (s: string) => void
  showAll: boolean
  setShowAll: (b: boolean) => void
}) {
  const thrPaise = threshold * 1e5 * 100 // ₹ lakh → paise
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows.filter((r) => {
      if (maxAbsDelta(r.values) < thrPaise) return false
      if (q && !r.label.toLowerCase().includes(q) && !r.group.toLowerCase().includes(q)) return false
      return true
    })
  }, [rows, thrPaise, query])

  const hiddenCount = rows.length - filtered.length
  const shown = showAll ? filtered : filtered.slice(0, LEDGER_CAP)

  // group rows, preserving the max-delta sort within each group.
  const groups = useMemo(() => {
    const m = new Map<string, SeriesRow[]>()
    for (const r of shown) m.set(r.group || '(ungrouped)', [...(m.get(r.group || '(ungrouped)') ?? []), r])
    return [...m.entries()]
  }, [shown])

  return (
    <section className="panel overflow-hidden">
      <div className="px-5 py-3.5 border-b border-line flex flex-wrap items-center justify-between gap-3">
        <h3 className="serif text-lg font-semibold">Ledger drill</h3>
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-ink-muted">
            <Search size={14} className="text-ink-faint" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ledger or group…"
              className="rounded-lg border border-line bg-bg-raised px-2.5 py-1 text-sm text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 w-[160px]" />
          </label>
          <label className="flex items-center gap-2 text-sm text-ink-muted">
            materiality ≥
            <input type="range" min={0} max={100} step={5} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} className="w-[120px]" />
            <span className="nums text-ink w-[58px]">₹{threshold} L</span>
          </label>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="fin w-full">
          <thead>
            <tr>
              <th className="text-left">Ledger</th>
              {periods.map((p, i) => <th key={i} className="num">{fyLabel(p.periodFrom, p.periodTo) || formatDate(p.periodTo)}</th>)}
            </tr>
          </thead>
          {groups.map(([g, grows]) => (
            <tbody key={g}>
              <tr className="section"><td colSpan={periods.length + 1}>{g}</td></tr>
              {grows.map((row) => (
                <tr key={row.key}>
                  <td className="max-w-[260px] truncate">{row.label}</td>
                  {row.values.map((_, i) => <HeatCell key={i} values={row.values} i={i} basis={basis} denom={null} />)}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
      <div className="px-5 py-2.5 text-xs text-ink-faint flex items-center justify-between gap-3 border-t border-line">
        <span>{hiddenCount > 0 ? `${hiddenCount.toLocaleString('en-IN')} ledgers below ₹${threshold} L threshold hidden` : 'all ledgers above threshold shown'} · {rows.length.toLocaleString('en-IN')} total</span>
        {filtered.length > LEDGER_CAP && (
          <button className="text-accent-hover hover:underline" onClick={() => setShowAll(!showAll)}>
            {showAll ? `show top ${LEDGER_CAP}` : `show all ${filtered.length.toLocaleString('en-IN')}`}
          </button>
        )}
      </div>
    </section>
  )
}

function RatioTrend({ r }: { r: RatioSeries }) {
  const fmt = (v: number | null) => (v == null ? '—' : r.unit === 'days' ? `${Math.round(v)}` : r.unit === '%' ? v.toFixed(1) : v.toFixed(2))
  const first = r.values.find((v) => v != null) ?? null
  const last = [...r.values].reverse().find((v) => v != null) ?? null
  const improved = first != null && last != null ? (r.favourable === 'higher' ? last >= first : last <= first) : null
  return (
    <div className="stat-card">
      <div className="text-[11px] uppercase tracking-wide text-ink-faint">{r.name}</div>
      <div className="flex items-baseline gap-1.5">
        <span className={cn('serif text-xl font-semibold nums', improved == null ? '' : improved ? 'text-good' : 'text-bad')}>{fmt(last)}</span>
        <span className="text-xs text-ink-faint">{r.unit}</span>
      </div>
      <div className="text-[10px] text-ink-faint nums truncate">{r.values.map(fmt).join(' · ')}</div>
    </div>
  )
}

function Seg({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={cn('chip border', active ? 'border-accent/50 bg-accent-soft text-accent-hover' : 'border-line text-ink-muted hover:bg-bg-raised')}>{children}</button>
  )
}

function Legend() {
  const swatch = (bg: string) => <span className="inline-block h-3.5 w-3.5 rounded-[3px]" style={{ background: bg }} />
  return (
    <div className="flex flex-wrap items-center gap-4 text-[11px] text-ink-muted">
      <span>tint = change vs prior column</span>
      <span className="flex items-center gap-1">{swatch('#97C459')}{swatch('#C0DD97')}{swatch('#EAF3DE')} up</span>
      <span className="flex items-center gap-1">{swatch('#FCEBEB')}{swatch('#F7C1C1')}{swatch('#F09595')} down</span>
    </div>
  )
}

async function exportSeries(series: YoYSeries) {
  const { exportTables } = await import('../../io/excel')
  const cols = [
    { header: 'Particulars', key: 'particulars', width: 40 },
    ...series.periods.map((p, i) => ({ header: fyLabel(p.periodFrom, p.periodTo) || `P${i + 1}`, key: `p${i}`, width: 16, money: true })),
  ]
  const blockRows = (block: SeriesBlock) =>
    block.sections.flatMap((sec) => [
      { particulars: `— ${sec.heading} —` },
      ...sec.rows.map((row) => ({ particulars: row.label, ...periodCells(row.values) })),
    ])
  const periodCells = (values: (Paise | null)[]) =>
    Object.fromEntries(values.map((v, i) => [`p${i}`, v == null ? '' : v / 100]))

  await exportTables(
    [
      { name: 'Balance Sheet', columns: cols, rows: blockRows(series.bs) },
      { name: 'Profit & Loss', columns: cols, rows: blockRows(series.pl) },
      { name: 'Ledger matrix', columns: cols, rows: series.ledgers.map((row) => ({ particulars: row.label, ...periodCells(row.values) })) },
    ],
    'YoY-Comparison.xlsx',
  )
}
