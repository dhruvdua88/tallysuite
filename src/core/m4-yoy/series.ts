/**
 * M4 — multi-period series. Generalises the two-year YoY diff to N periods so the
 * UI can render a heatmap (statement heads × years and ledger × years) plus a
 * ratio trend. Periods are sorted by period end; every head/ledger is aligned to
 * the same period axis. Pure TS — colour mapping lives in the UI; this module only
 * emits signed variance buckets.
 */
import type { NormalizedDataset } from '../model/dataset'
import { ZERO, type Paise } from '../model/money'
import { buildTrialBalance } from '../tb/trialBalance'
import { buildStatements, type Sch3LineResult, type Sch3Statements } from '../m3-sch3'

export interface SeriesPeriod {
  slotId: string
  company: string
  periodFrom: string | null
  periodTo: string | null
  sourceFile: string
}

export interface SeriesRow {
  key: string
  label: string
  group: string
  /** One value per period (aligned to `periods`); null = absent that period. */
  values: (Paise | null)[]
}

export interface SeriesBlock {
  title: string
  sections: { heading: string; rows: SeriesRow[] }[]
}

export interface RatioSeries {
  name: string
  unit: '×' | '%' | 'days'
  favourable: 'higher' | 'lower'
  values: (number | null)[]
}

export interface YoYSeries {
  periods: SeriesPeriod[]
  sameCompany: boolean
  warning: string | null
  pl: SeriesBlock
  bs: SeriesBlock
  ledgers: SeriesRow[]
  ratios: RatioSeries[]
}

/** Signed variance bucket for heatmap tinting: −3..+3, 0 = immaterial / flat. */
export function heatBucket(pct: number | null): number {
  if (pct == null || !Number.isFinite(pct)) return 0
  const a = Math.abs(pct)
  const mag = a >= 30 ? 3 : a >= 12 ? 2 : a >= 4 ? 1 : 0
  return pct >= 0 ? mag : -mag
}

/** Percentage change prior→current, null when prior is absent or zero. */
export function pctDelta(prev: Paise | null, cur: Paise | null): number | null {
  if (prev == null || cur == null || prev === 0) return null
  return ((cur - prev) / Math.abs(prev)) * 100
}

/** Largest absolute consecutive movement across the series (for materiality filter). */
export function maxAbsDelta(values: (Paise | null)[]): Paise {
  let m = 0
  for (let i = 1; i < values.length; i++) {
    const a = values[i - 1]
    const b = values[i]
    if (a == null || b == null) continue
    m = Math.max(m, Math.abs(b - a))
  }
  return m as Paise
}

export function buildSeries(datasets: { slotId: string; dataset: NormalizedDataset }[]): YoYSeries {
  const ordered = [...datasets].sort((a, b) =>
    String(a.dataset.meta.periodTo ?? '').localeCompare(String(b.dataset.meta.periodTo ?? '')),
  )
  const periods: SeriesPeriod[] = ordered.map((d) => ({
    slotId: d.slotId,
    company: d.dataset.meta.company,
    periodFrom: d.dataset.meta.periodFrom,
    periodTo: d.dataset.meta.periodTo,
    sourceFile: d.dataset.meta.sourceFile,
  }))

  const guidPrefixes = new Set(
    ordered.map((d) => d.dataset.meta.companyGuidPrefix).filter((x): x is string => !!x),
  )
  const sameCompany = guidPrefixes.size <= 1
  const warning = !sameCompany ? 'Periods span different companies — comparison may be meaningless.' : null

  const statements = ordered.map((d) => buildStatements([d.dataset]))

  const headRows = (pick: (s: Sch3Statements) => Sch3LineResult[]): SeriesRow[] => {
    const ids: string[] = []
    const seen = new Set<string>()
    const label = new Map<string, string>()
    for (const s of statements) {
      for (const r of pick(s)) {
        if (!seen.has(r.line.id)) {
          seen.add(r.line.id)
          ids.push(r.line.id)
          label.set(r.line.id, r.line.label)
        }
      }
    }
    return ids
      .map((id) => {
        const values = statements.map((s) => {
          const r = pick(s).find((x) => x.line.id === id)
          return (r?.consolidated ?? ZERO) as Paise
        })
        return { key: id, label: label.get(id)!, group: '', values }
      })
      .filter((row) => row.values.some((v) => v !== 0))
  }

  const profitRow: SeriesRow = {
    key: 'profit',
    label: 'Profit/(Loss) for the year',
    group: '',
    values: statements.map((s) => s.profitForYear.consolidated),
  }

  const pl: SeriesBlock = {
    title: 'Profit & Loss',
    sections: [
      { heading: 'Income', rows: headRows((s) => s.plIncome) },
      { heading: 'Expenses', rows: headRows((s) => s.plExpense) },
      { heading: 'Profit', rows: [profitRow] },
    ],
  }
  const bs: SeriesBlock = {
    title: 'Balance Sheet',
    sections: [
      { heading: 'Equity & Liabilities', rows: headRows((s) => s.bsEquityLiability) },
      { heading: 'Assets', rows: headRows((s) => s.bsAssets) },
    ],
  }

  const ledgers = ledgerSeries(ordered)
  const ratios = ratioSeries(statements)

  return { periods, sameCompany, warning, pl, bs, ledgers, ratios }
}

function ledgerSeries(ordered: { slotId: string; dataset: NormalizedDataset }[]): SeriesRow[] {
  const tbs = ordered.map((d) => buildTrialBalance(d.dataset))
  const keys: string[] = []
  const seen = new Set<string>()
  const meta = new Map<string, { name: string; group: string }>()
  for (const tb of tbs) {
    for (const r of tb.rows) {
      if (!seen.has(r.key)) {
        seen.add(r.key)
        keys.push(r.key)
      }
      if (!meta.has(r.key)) meta.set(r.key, { name: r.name, group: r.group })
    }
  }
  const rows = keys.map((key) => {
    const m = meta.get(key)!
    const values = tbs.map((tb) => {
      const r = tb.rowByKey.get(key as never)
      return r ? r.closing : null
    })
    return { key, label: m.name, group: m.group, values }
  })
  // Drop rows that never move and are flat/zero throughout.
  return rows
    .filter((r) => r.values.some((v) => v != null && v !== 0))
    .sort((a, b) => maxAbsDelta(b.values) - maxAbsDelta(a.values))
}

// --- ratio trend ---
function head(s: Sch3Statements, ...ids: string[]): number {
  const all = [...s.bsAssets, ...s.bsEquityLiability, ...s.plIncome, ...s.plExpense]
  let sum = 0
  for (const id of ids) {
    const r = all.find((x) => x.line.id === id)
    if (r) sum += r.consolidated
  }
  return sum
}

function ratioSeries(statements: Sch3Statements[]): RatioSeries[] {
  const curAssets = (s: Sch3Statements) => head(s, 'cur_investments', 'inventories', 'trade_receivables', 'cash_bank', 'st_loans_adv', 'other_cur_assets')
  const curLiab = (s: Sch3Statements) => head(s, 'st_borrowings', 'trade_payables', 'other_cur_liab', 'st_provisions')
  const equity = (s: Sch3Statements) => head(s, 'share_capital', 'reserves_surplus') + s.profitForYear.consolidated
  const debt = (s: Sch3Statements) => head(s, 'lt_borrowings', 'st_borrowings')
  const revenue = (s: Sch3Statements) => head(s, 'revenue_ops')
  const recv = (s: Sch3Statements) => head(s, 'trade_receivables')

  const mk = (
    name: string,
    unit: RatioSeries['unit'],
    favourable: RatioSeries['favourable'],
    f: (s: Sch3Statements) => number | null,
  ): RatioSeries => ({ name, unit, favourable, values: statements.map(f) })

  const div = (n: number, d: number, scale = 1) => (d === 0 ? null : (n / d) * scale)

  return [
    mk('Current Ratio', '×', 'higher', (s) => div(curAssets(s), curLiab(s))),
    mk('Debt-Equity', '×', 'lower', (s) => div(debt(s), equity(s))),
    mk('Net Profit Margin', '%', 'higher', (s) => div(s.profitForYear.consolidated, revenue(s), 100)),
    mk('Return on Equity', '%', 'higher', (s) => div(s.profitForYear.consolidated, equity(s), 100)),
    mk('Trade Receivable Days', 'days', 'lower', (s) => div(recv(s), revenue(s), 365)),
  ]
}
