/**
 * M3 — Schedule III statement builder with multi-branch consolidation.
 *
 * Each dataset = one branch/company. Period must match across branches (hard
 * gate). Produces per-branch columns + a Consolidated total for the Balance
 * Sheet and Statement of P&L, plus note schedules (contributing ledgers) and an
 * Unmapped bucket that blocks a clean export.
 */
import type { ISODate, LedgerKey, NormalizedDataset } from '../model/dataset'
import { ZERO, type Paise } from '../model/money'
import { buildTrialBalance, type TrialBalance } from '../tb/trialBalance'
import { classifyLedger, SCH3_LINES, SCH3_BY_ID, UNMAPPED, type Sch3Line } from './mapping'

export interface NoteLedger {
  name: string
  perBranch: Paise[]
  consolidated: Paise
}

export interface Sch3LineResult {
  line: Sch3Line
  perBranch: Paise[] // presentation values (oriented positive), one per branch
  consolidated: Paise
  ledgers: NoteLedger[]
}

export interface UnmappedItem {
  ledger: string
  branch: string
  value: Paise // presentation magnitude
}

export interface Sch3Statements {
  branches: string[]
  period: { from: ISODate | null; to: ISODate | null }
  periodsMatch: boolean
  bsEquityLiability: Sch3LineResult[]
  bsAssets: Sch3LineResult[]
  plIncome: Sch3LineResult[]
  plExpense: Sch3LineResult[]
  profitForYear: { perBranch: Paise[]; consolidated: Paise }
  totals: {
    equityLiability: { perBranch: Paise[]; consolidated: Paise }
    assets: { perBranch: Paise[]; consolidated: Paise }
    totalIncome: { perBranch: Paise[]; consolidated: Paise }
    totalExpense: { perBranch: Paise[]; consolidated: Paise }
  }
  unmapped: UnmappedItem[]
  /** Difference Assets − (Equity+Liab) per branch; should be ~0. */
  bsResidual: { perBranch: Paise[]; consolidated: Paise }
}

const PROFIT_LINE: Sch3Line = {
  id: 'profit_year',
  label: 'Surplus/(Deficit) for the year',
  section: 'BS',
  side: 'equityLiability',
  note: 4,
  order: 102,
}

export function buildStatements(datasets: NormalizedDataset[]): Sch3Statements {
  const branches = datasets.map((d) => d.meta.company)
  const n = datasets.length
  const period = { from: datasets[0]?.meta.periodFrom ?? null, to: datasets[0]?.meta.periodTo ?? null }
  const periodsMatch = datasets.every(
    (d) => d.meta.periodFrom === period.from && d.meta.periodTo === period.to,
  )

  const tbs = datasets.map(buildTrialBalance)

  // orientation per branch so assets/expenses present positive
  const assetOri = tbs.map((tb, i) => orientation(tb, datasets[i]!, 'asset'))
  const incomeOri = tbs.map((tb, i) => orientation(tb, datasets[i]!, 'income'))

  // accumulate signed value per (lineId, branch) and per ledger
  const lineAgg = new Map<string, { perBranch: Paise[]; ledgers: Map<LedgerKey, { name: string; perBranch: Paise[] }> }>()
  const ensure = (id: string) => {
    let e = lineAgg.get(id)
    if (!e) {
      e = { perBranch: Array<Paise>(n).fill(ZERO), ledgers: new Map() }
      lineAgg.set(id, e)
    }
    return e
  }

  const unmapped: UnmappedItem[] = []

  datasets.forEach((ds, bi) => {
    const tb = tbs[bi]!
    for (const row of tb.rows) {
      const id = classifyLedger(row.key, ds)
      const line = SCH3_BY_ID.get(id)
      // BS heads use closing; PL heads use movement (nominal year activity)
      const isPL = line?.section === 'PL'
      const signed = isPL ? row.movement : row.closing
      if (signed === 0) continue

      if (id === UNMAPPED) {
        unmapped.push({ ledger: row.name, branch: branches[bi]!, value: Math.abs(signed) as Paise })
        continue
      }
      const ori = line!.side === 'asset'
        ? assetOri[bi]!
        : line!.side === 'equityLiability'
          ? (-assetOri[bi]! as 1 | -1)
          : line!.side === 'income'
            ? incomeOri[bi]!
            : (-incomeOri[bi]! as 1 | -1)
      const present = (signed * ori) as Paise

      const e = ensure(id)
      e.perBranch[bi] = (e.perBranch[bi]! + present) as Paise
      let led = e.ledgers.get(row.key)
      if (!led) {
        led = { name: row.name, perBranch: Array<Paise>(n).fill(ZERO) }
        e.ledgers.set(row.key, led)
      }
      led.perBranch[bi] = (led.perBranch[bi]! + present) as Paise
    }
  })

  const toResult = (line: Sch3Line): Sch3LineResult => {
    const e = lineAgg.get(line.id)
    const perBranch = e?.perBranch ?? Array<Paise>(n).fill(ZERO)
    const ledgers: NoteLedger[] = e
      ? [...e.ledgers.values()]
          .map((l) => ({ name: l.name, perBranch: l.perBranch, consolidated: sumArr(l.perBranch) }))
          .filter((l) => l.consolidated !== 0)
          .sort((a, b) => Math.abs(b.consolidated) - Math.abs(a.consolidated))
      : []
    return { line, perBranch, consolidated: sumArr(perBranch), ledgers }
  }

  const bsAssets = SCH3_LINES.filter((l) => l.section === 'BS' && l.side === 'asset').map(toResult)
  const eqLiabBase = SCH3_LINES.filter((l) => l.section === 'BS' && l.side === 'equityLiability')
  const plIncome = SCH3_LINES.filter((l) => l.section === 'PL' && l.side === 'income').map(toResult)
  const plExpense = SCH3_LINES.filter((l) => l.section === 'PL' && l.side === 'expense').map(toResult)

  // profit for the year = total income − total expense (presentation space)
  const totalIncome = sumResults(plIncome, n)
  const totalExpense = sumResults(plExpense, n)
  const profitPerBranch = totalIncome.perBranch.map((v, i) => (v - totalExpense.perBranch[i]!) as Paise)
  const profitForYear = { perBranch: profitPerBranch, consolidated: sumArr(profitPerBranch) }

  // inject profit into reserves so the BS balances
  const bsEquityLiability = eqLiabBase.map(toResult)
  const profitResult: Sch3LineResult = {
    line: PROFIT_LINE,
    perBranch: profitPerBranch,
    consolidated: profitForYear.consolidated,
    ledgers: [],
  }
  // place profit right after Reserves & Surplus
  const reservesIdx = bsEquityLiability.findIndex((r) => r.line.id === 'reserves_surplus')
  if (reservesIdx >= 0) bsEquityLiability.splice(reservesIdx + 1, 0, profitResult)
  else bsEquityLiability.push(profitResult)

  const equityLiability = sumResults(bsEquityLiability, n)
  const assets = sumResults(bsAssets, n)
  const bsResidualPer = assets.perBranch.map((v, i) => (v - equityLiability.perBranch[i]!) as Paise)

  return {
    branches,
    period,
    periodsMatch,
    bsEquityLiability,
    bsAssets,
    plIncome,
    plExpense,
    profitForYear,
    totals: {
      equityLiability,
      assets,
      totalIncome,
      totalExpense,
    },
    unmapped,
    bsResidual: { perBranch: bsResidualPer, consolidated: sumArr(bsResidualPer) },
  }
}

// --- helpers ---

function orientation(
  tb: TrialBalance,
  ds: NormalizedDataset,
  side: 'asset' | 'income',
): 1 | -1 {
  let signed = 0
  for (const row of tb.rows) {
    const id = classifyLedger(row.key, ds)
    const line = SCH3_BY_ID.get(id)
    if (!line) continue
    if (side === 'asset' && line.side === 'asset') signed += row.closing
    if (side === 'income' && line.side === 'income') signed += row.movement
  }
  return signed >= 0 ? 1 : -1
}

function sumArr(xs: readonly Paise[]): Paise {
  let a = 0
  for (const x of xs) a += x
  return a as Paise
}

function sumResults(results: Sch3LineResult[], n: number): { perBranch: Paise[]; consolidated: Paise } {
  const perBranch = Array<Paise>(n).fill(ZERO)
  for (const r of results) {
    for (let i = 0; i < n; i++) perBranch[i] = (perBranch[i]! + r.perBranch[i]!) as Paise
  }
  return { perBranch, consolidated: sumArr(perBranch) }
}
