import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import { ArrowRight, Building2, CalendarRange, Check, TriangleAlert, ShieldCheck, FileSpreadsheet, Search } from 'lucide-react'
import { useStore, type Slot } from '../../state/store'
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

  const selectedSlots = useMemo(
    () =>
      chosen
        .map((id) => slots.find((s) => s.id === id))
        .filter((s): s is Slot => !!s),
    [chosen, slots],
  )

  const toggle = (id: string) =>
    setSelected((cur) => {
      const base = cur.length ? cur : defaultIds
      return base.includes(id) ? base.filter((x) => x !== id) : [...base, id]
    })

  const selectCompany = (ids: string[]) => setSelected(ids)

  const duplicatePeriodCount = useMemo(() => countDuplicatePeriods(selectedSlots), [selectedSlots])

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
          <span className="text-sm text-ink-faint">— compare two ZIP exports across periods</span>
        </div>
        {series && (
          <button className="btn-primary" onClick={onExport} disabled={busy}>
            <FileSpreadsheet size={16} /> {busy ? 'Exporting…' : 'Export workbook'}
          </button>
        )}
      </div>

      <TwoExportSelector slots={slots} selectedSlots={selectedSlots} onSelectPair={(ids) => setSelected(ids)} />
      <PeriodSelector slots={slots} selectedIds={chosen} selectedSlots={selectedSlots} onToggle={toggle} onSelectCompany={selectCompany} />

      {datasets.length < 2 && slots.length > 0 && (
        <div className="panel px-4 py-3 text-sm text-ink-muted">Select at least two periods above to build the comparison.</div>
      )}

      {series && (
        <>
          {duplicatePeriodCount > 0 && (
            <div className="panel border-warn/40 bg-warn/5 px-4 py-3 text-sm">
              <div className="flex items-center gap-2 font-medium text-warn">
                <TriangleAlert size={16} /> Same accounting period selected more than once.
              </div>
              <div className="mt-1 text-ink-muted">
                Year-on-Year is for comparing different periods. To compare two ZIP files for the same period, use Version Diff.
              </div>
            </div>
          )}

          {/* guard */}
          {series.sameCompany ? (
            <div className="panel px-5 py-3 flex flex-wrap items-center justify-between gap-x-5 gap-y-2 text-sm">
              <span className="flex min-w-0 items-center gap-2 text-good font-medium">
                <ShieldCheck size={16} className="shrink-0" />
                <span className="truncate">{series.periods[0]?.company}</span>
              </span>
              <span className="text-ink-muted">
                {series.periods.length} periods selected · {formatDate(series.periods[0]?.periodTo ?? null)} to {formatDate(series.periods.at(-1)?.periodTo ?? null)}
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
function companyKey(slot: Slot): string {
  const nameKey = slot.dataset.meta.company.trim().toLowerCase()
  return slot.dataset.meta.companyGuidPrefix || nameKey || slot.id
}

function periodRangeLabel(periodFrom: string | null, periodTo: string | null): string {
  if (periodFrom && periodTo) return `${formatDate(periodFrom)} to ${formatDate(periodTo)}`
  if (periodTo) return `up to ${formatDate(periodTo)}`
  if (periodFrom) return `from ${formatDate(periodFrom)}`
  return 'period not available'
}

function periodShortLabel(periodFrom: string | null, periodTo: string | null): string {
  return fyLabel(periodFrom, periodTo) || formatDate(periodTo)
}

function slotOptionLabel(slot: Slot): string {
  return `${slot.dataset.meta.company} · ${periodShortLabel(slot.dataset.meta.periodFrom, slot.dataset.meta.periodTo)} · ${slot.dataset.meta.sourceFile}`
}

function periodKey(periodFrom: string | null, periodTo: string | null): string {
  return `${periodFrom ?? '?'}|${periodTo ?? '?'}`
}

function countDuplicatePeriods(slots: Slot[]): number {
  const counts = new Map<string, number>()
  for (const slot of slots) {
    const key = periodKey(slot.dataset.meta.periodFrom, slot.dataset.meta.periodTo)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.values()].filter((n) => n > 1).length
}

function TwoExportSelector({
  slots,
  selectedSlots,
  onSelectPair,
}: {
  slots: Slot[]
  selectedSlots: Slot[]
  onSelectPair: (ids: string[]) => void
}) {
  const orderedSlots = useMemo(
    () =>
      [...slots].sort((a, b) => {
        const byCompany = a.dataset.meta.company.localeCompare(b.dataset.meta.company)
        if (byCompany !== 0) return byCompany
        const byPeriod = String(a.dataset.meta.periodTo ?? '').localeCompare(String(b.dataset.meta.periodTo ?? ''))
        if (byPeriod !== 0) return byPeriod
        return a.dataset.meta.sourceFile.localeCompare(b.dataset.meta.sourceFile)
      }),
    [slots],
  )
  const firstId = selectedSlots[0]?.id ?? orderedSlots[0]?.id ?? ''
  const secondId = selectedSlots[1]?.id ?? orderedSlots.find((s) => s.id !== firstId)?.id ?? ''

  const updatePair = (side: 'first' | 'second', id: string) => {
    const otherId = side === 'first' ? secondId : firstId
    if (!id || !otherId || id === otherId) {
      onSelectPair([id].filter(Boolean))
      return
    }
    onSelectPair(side === 'first' ? [id, otherId] : [otherId, id])
  }

  return (
    <section className="panel p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-ink-faint">Two ZIP period comparison</div>
          <div className="mt-0.5 text-sm text-ink-muted">Loaded exports by ZIP file and accounting period.</div>
        </div>
        {selectedSlots.length > 2 && (
          <span className="chip border-warn/40 bg-warn/10 text-warn">showing {selectedSlots.length} periods</span>
        )}
      </div>
      <div className="grid gap-3 lg:grid-cols-[1fr_auto_1fr] lg:items-end">
        <ZipPeriodSelect label="Base ZIP / period" value={firstId} slots={orderedSlots} onChange={(id) => updatePair('first', id)} />
        <ChevronSeparator />
        <ZipPeriodSelect label="Compare ZIP / period" value={secondId} slots={orderedSlots.filter((s) => s.id !== firstId)} onChange={(id) => updatePair('second', id)} />
      </div>
    </section>
  )
}

function ZipPeriodSelect({
  label,
  value,
  slots,
  onChange,
}: {
  label: string
  value: string
  slots: Slot[]
  onChange: (id: string) => void
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-[11px] uppercase tracking-wide text-ink-faint">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-w-0 rounded-lg border border-line bg-bg-raised px-3 py-2 text-sm text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
      >
        <option value="" disabled>select ZIP…</option>
        {slots.map((slot) => (
          <option key={slot.id} value={slot.id}>{slotOptionLabel(slot)}</option>
        ))}
      </select>
    </label>
  )
}

function ChevronSeparator() {
  return (
    <div className="hidden h-10 items-center justify-center text-ink-faint lg:flex">
      <ArrowRight size={18} />
    </div>
  )
}

function PeriodSelector({
  slots,
  selectedIds,
  selectedSlots,
  onToggle,
  onSelectCompany,
}: {
  slots: Slot[]
  selectedIds: string[]
  selectedSlots: Slot[]
  onToggle: (id: string) => void
  onSelectCompany: (ids: string[]) => void
}) {
  const groups = useMemo(() => {
    const map = new Map<string, { key: string; company: string; slots: Slot[] }>()
    for (const slot of slots) {
      const key = companyKey(slot)
      const existing = map.get(key)
      if (existing) {
        existing.slots.push(slot)
      } else {
        map.set(key, { key, company: slot.dataset.meta.company || slot.name, slots: [slot] })
      }
    }
    return [...map.values()]
      .map((group) => ({
        ...group,
        slots: [...group.slots].sort((a, b) =>
          String(a.dataset.meta.periodTo ?? '').localeCompare(String(b.dataset.meta.periodTo ?? '')),
        ),
      }))
      .sort((a, b) => a.company.localeCompare(b.company))
  }, [slots])

  return (
    <section className="panel overflow-hidden">
      <div className="border-b border-line px-5 py-3.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-wide text-ink-faint">Company periods</div>
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2 text-sm text-ink-muted">
              <CalendarRange size={15} className="text-accent" />
              <span>{selectedSlots.length || 0} selected</span>
              {selectedSlots.length > 0 && (
                <span className="truncate">
                  {selectedSlots.map((s) => periodShortLabel(s.dataset.meta.periodFrom, s.dataset.meta.periodTo)).join(' · ')}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {groups.length === 0 ? (
        <div className="px-5 py-4 text-sm text-ink-faint">Load two or more exports to compare.</div>
      ) : (
        <div className="divide-y divide-line">
          {groups.map((group) => {
            const ids = group.slots.map((s) => s.id)
            const selectedInGroup = ids.filter((id) => selectedIds.includes(id)).length
            return (
              <div key={group.key} className="px-5 py-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <Building2 size={16} className="shrink-0 text-accent" />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-ink">{group.company}</div>
                      <div className="text-[11px] text-ink-faint">{selectedInGroup}/{ids.length} periods selected</div>
                    </div>
                  </div>
                  {ids.length >= 2 && (
                    <button
                      type="button"
                      onClick={() => onSelectCompany(ids)}
                      className="btn-ghost px-2.5 py-1.5 text-xs"
                    >
                      Select company
                    </button>
                  )}
                </div>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {group.slots.map((slot) => {
                    const on = selectedIds.includes(slot.id)
                    const from = slot.dataset.meta.periodFrom
                    const to = slot.dataset.meta.periodTo
                    return (
                      <button
                        key={slot.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() => onToggle(slot.id)}
                        className={cn(
                          'min-h-[86px] rounded-lg border px-3 py-2.5 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                          on ? 'border-accent/60 bg-accent-soft text-accent-hover' : 'border-line bg-bg-panel text-ink-muted hover:bg-bg-raised',
                        )}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-base font-semibold text-ink">{periodShortLabel(from, to)}</div>
                            <div className="mt-1 text-xs leading-snug text-ink-muted">{periodRangeLabel(from, to)}</div>
                          </div>
                          <span
                            className={cn(
                              'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border',
                              on ? 'border-accent bg-accent text-[rgb(var(--accent-ink))]' : 'border-line bg-bg-raised',
                            )}
                          >
                            {on && <Check size={13} strokeWidth={3} />}
                          </span>
                        </div>
                        <div className="mt-2 truncate text-[11px] text-ink-faint">{slot.dataset.meta.sourceFile}</div>
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

function PeriodColumnHeader({ period }: { period: YoYSeries['periods'][number] }) {
  return (
    <div className="flex min-w-[142px] flex-col items-end gap-0.5 normal-case tracking-normal leading-tight">
      <span className="max-w-[180px] truncate text-[11px] font-semibold uppercase tracking-wide text-ink-muted">{period.company}</span>
      <span className="text-xs font-semibold text-ink">{periodShortLabel(period.periodFrom, period.periodTo)}</span>
      <span className="text-[10px] font-medium text-ink-faint">{periodRangeLabel(period.periodFrom, period.periodTo)}</span>
      <span className="max-w-[180px] truncate text-[10px] font-medium text-ink-faint">{period.sourceFile}</span>
    </div>
  )
}

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
              {periods.map((p, i) => <th key={i} className="num"><PeriodColumnHeader period={p} /></th>)}
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
              {periods.map((p, i) => <th key={i} className="num"><PeriodColumnHeader period={p} /></th>)}
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
    ...series.periods.map((p, i) => ({
      header: `${p.company || `Company ${i + 1}`} · ${periodShortLabel(p.periodFrom, p.periodTo)} · ${p.sourceFile}`,
      key: `p${i}`,
      width: 38,
      money: true,
    })),
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
