/**
 * M4 — Year-on-Year comparison. Builds Schedule III statements for each year and
 * diffs them head-by-head, derives key ratios, and surfaces ledger-level movers /
 * new / vanished accounts from the trial balance. Validation gates on same-company
 * and sequential, equal-length periods.
 */
import type { ISODate, NormalizedDataset } from '../model/dataset'
import { ZERO, type Paise } from '../model/money'
import { buildTrialBalance } from '../tb/trialBalance'
import { buildStatements, type Sch3LineResult, type Sch3Statements } from '../m3-sch3'

export interface YoYLine {
  id: string
  label: string
  prior: Paise
  current: Paise
  delta: Paise
  deltaPct: number | null
}

export interface Ratio {
  name: string
  prior: number | null
  current: number | null
  unit: '×' | '%' | 'days'
  /** Direction generally considered favourable. */
  favourable: 'higher' | 'lower'
}

export interface LedgerMove {
  name: string
  group: string
  prior: Paise
  current: Paise
  delta: Paise
  deltaPct: number | null
}

export interface YoYGuard {
  sameCompany: boolean
  priorPeriod: string
  currentPeriod: string
  sequential: boolean // current starts ~ when prior ends
  warning: string | null
}

export interface YoYResult {
  guard: YoYGuard
  company: string
  bsEquityLiability: YoYLine[]
  bsAssets: YoYLine[]
  plIncome: YoYLine[]
  plExpense: YoYLine[]
  profit: YoYLine
  totals: { assets: YoYLine; equityLiability: YoYLine; income: YoYLine; expense: YoYLine }
  ratios: Ratio[]
  newLedgers: LedgerMove[]
  goneLedgers: LedgerMove[]
  topMovers: LedgerMove[]
}

export function compareYears(prior: NormalizedDataset, current: NormalizedDataset): YoYResult {
  const guard = buildGuard(prior, current)
  const sPrior = buildStatements([prior])
  const sCurrent = buildStatements([current])

  const line = (id: string, label: string, p: Paise, c: Paise): YoYLine => {
    const delta = (c - p) as Paise
    return { id, label, prior: p, current: c, delta, deltaPct: p === 0 ? null : (delta / Math.abs(p)) * 100 }
  }
  const fromResults = (pr: Sch3LineResult[], cu: Sch3LineResult[]): YoYLine[] => {
    const ids = new Set([...pr, ...cu].map((r) => r.line.id))
    const pm = new Map(pr.map((r) => [r.line.id, r]))
    const cm = new Map(cu.map((r) => [r.line.id, r]))
    return [...ids]
      .map((id) => {
        const a = pm.get(id)
        const b = cm.get(id)
        const lbl = (a ?? b)!.line.label
        return line(id, lbl, a?.consolidated ?? ZERO, b?.consolidated ?? ZERO)
      })
      .filter((l) => l.prior !== 0 || l.current !== 0)
      .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta))
  }

  const bsEquityLiability = fromResults(sPrior.bsEquityLiability, sCurrent.bsEquityLiability)
  const bsAssets = fromResults(sPrior.bsAssets, sCurrent.bsAssets)
  const plIncome = fromResults(sPrior.plIncome, sCurrent.plIncome)
  const plExpense = fromResults(sPrior.plExpense, sCurrent.plExpense)

  const profit = line('profit', 'Profit/(Loss) for the year', sPrior.profitForYear.consolidated, sCurrent.profitForYear.consolidated)
  const totals = {
    assets: line('t_assets', 'Total Assets', sPrior.totals.assets.consolidated, sCurrent.totals.assets.consolidated),
    equityLiability: line('t_eqliab', 'Total Equity & Liabilities', sPrior.totals.equityLiability.consolidated, sCurrent.totals.equityLiability.consolidated),
    income: line('t_income', 'Total Income', sPrior.totals.totalIncome.consolidated, sCurrent.totals.totalIncome.consolidated),
    expense: line('t_expense', 'Total Expense', sPrior.totals.totalExpense.consolidated, sCurrent.totals.totalExpense.consolidated),
  }

  const ratios = buildRatios(sPrior, sCurrent)
  const { newLedgers, goneLedgers, topMovers } = ledgerMoves(prior, current)

  return {
    guard,
    company: current.meta.company,
    bsEquityLiability,
    bsAssets,
    plIncome,
    plExpense,
    profit,
    totals,
    ratios,
    newLedgers,
    goneLedgers,
    topMovers,
  }
}

// --- ratios from Schedule III heads ---
function head(s: Sch3Statements, ...ids: string[]): number {
  const all = [...s.bsAssets, ...s.bsEquityLiability, ...s.plIncome, ...s.plExpense]
  let sum = 0
  for (const id of ids) {
    const r = all.find((x) => x.line.id === id)
    if (r) sum += r.consolidated
  }
  return sum
}

function buildRatios(p: Sch3Statements, c: Sch3Statements): Ratio[] {
  const curAssets = (s: Sch3Statements) => head(s, 'cur_investments', 'inventories', 'trade_receivables', 'cash_bank', 'st_loans_adv', 'other_cur_assets')
  const curLiab = (s: Sch3Statements) => head(s, 'st_borrowings', 'trade_payables', 'other_cur_liab', 'st_provisions')
  const equity = (s: Sch3Statements) => head(s, 'share_capital', 'reserves_surplus') + s.profitForYear.consolidated
  const debt = (s: Sch3Statements) => head(s, 'lt_borrowings', 'st_borrowings')
  const revenue = (s: Sch3Statements) => head(s, 'revenue_ops')
  const recv = (s: Sch3Statements) => head(s, 'trade_receivables')

  const ratio = (fn: (s: Sch3Statements) => number, denom: (s: Sch3Statements) => number, scale = 1) => (s: Sch3Statements) => {
    const d = denom(s)
    return d === 0 ? null : (fn(s) / d) * scale
  }
  const days = (fn: (s: Sch3Statements) => number, denom: (s: Sch3Statements) => number) => (s: Sch3Statements) => {
    const d = denom(s)
    return d === 0 ? null : (fn(s) / d) * 365
  }

  const mk = (name: string, f: (s: Sch3Statements) => number | null, unit: Ratio['unit'], favourable: Ratio['favourable']): Ratio => ({
    name,
    prior: f(p),
    current: f(c),
    unit,
    favourable,
  })

  return [
    mk('Current Ratio', ratio(curAssets, curLiab), '×', 'higher'),
    mk('Debt-Equity', ratio(debt, equity), '×', 'lower'),
    mk('Net Profit Margin', (s) => (revenue(s) === 0 ? null : (s.profitForYear.consolidated / revenue(s)) * 100), '%', 'higher'),
    mk('Return on Equity', (s) => (equity(s) === 0 ? null : (s.profitForYear.consolidated / equity(s)) * 100), '%', 'higher'),
    mk('Trade Receivable Days', days(recv, revenue), 'days', 'lower'),
  ]
}

function ledgerMoves(prior: NormalizedDataset, current: NormalizedDataset) {
  const tbP = buildTrialBalance(prior)
  const tbC = buildTrialBalance(current)
  const pMap = tbP.rowByKey
  const cMap = tbC.rowByKey
  const newLedgers: LedgerMove[] = []
  const goneLedgers: LedgerMove[] = []
  const movers: LedgerMove[] = []

  for (const [key, c] of cMap) {
    const p = pMap.get(key)
    if (!p || (p.closing === 0 && p.movement === 0)) {
      if (c.closing !== 0) newLedgers.push(toMove(c.name, c.group, ZERO, c.closing))
    }
    const prior = p?.closing ?? ZERO
    const delta = (c.closing - prior) as Paise
    if (delta !== 0) movers.push(toMove(c.name, c.group, prior, c.closing))
  }
  for (const [key, p] of pMap) {
    if (!cMap.has(key) && p.closing !== 0) goneLedgers.push(toMove(p.name, p.group, p.closing, ZERO))
  }

  movers.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
  return {
    newLedgers: newLedgers.sort((a, b) => Math.abs(b.current) - Math.abs(a.current)).slice(0, 25),
    goneLedgers: goneLedgers.sort((a, b) => Math.abs(b.prior) - Math.abs(a.prior)).slice(0, 25),
    topMovers: movers.slice(0, 30),
  }
}

function toMove(name: string, group: string, prior: Paise, current: Paise): LedgerMove {
  const delta = (current - prior) as Paise
  return { name, group, prior, current, delta, deltaPct: prior === 0 ? null : (delta / Math.abs(prior)) * 100 }
}

function buildGuard(prior: NormalizedDataset, current: NormalizedDataset): YoYGuard {
  const sameCompany =
    prior.meta.companyGuidPrefix !== null && prior.meta.companyGuidPrefix === current.meta.companyGuidPrefix
  const seq = isSequential(prior.meta.periodTo, current.meta.periodFrom)
  let warning: string | null = null
  if (!sameCompany) warning = 'Different companies — YoY comparison may be meaningless.'
  else if (!seq) warning = 'Periods are not sequential — check you picked prior vs current year correctly.'
  return {
    sameCompany,
    priorPeriod: periodLabel(prior.meta.periodFrom, prior.meta.periodTo),
    currentPeriod: periodLabel(current.meta.periodFrom, current.meta.periodTo),
    sequential: seq,
    warning,
  }
}

function periodLabel(a: ISODate | null, b: ISODate | null): string {
  return `${a ?? '?'} → ${b ?? '?'}`
}

function isSequential(priorEnd: ISODate | null, currentStart: ISODate | null): boolean {
  if (!priorEnd || !currentStart) return false
  const end = new Date(priorEnd).getTime()
  const start = new Date(currentStart).getTime()
  const gapDays = (start - end) / 86400000
  return gapDays >= -1 && gapDays <= 40 // current begins around prior year-end
}
