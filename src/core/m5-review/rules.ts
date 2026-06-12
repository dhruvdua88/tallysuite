/**
 * M5 — Schedule III / CARO review (deterministic rule engine). Runs entirely
 * offline over the M3-generated statements + source datasets. The optional
 * DeepSeek pass (io/deepseek) only ADDS semantic findings on top; this engine is
 * always the floor and never needs a key.
 */
import type { LedgerKey, NormalizedDataset } from '../model/dataset'
import { formatINR, type Paise } from '../model/money'
import { buildTrialBalance } from '../tb/trialBalance'
import { classifyLedger, type Sch3Statements } from '../m3-sch3'

export type Severity = 'high' | 'medium' | 'low' | 'info'

export interface ReviewFinding {
  id: string
  area: string
  severity: Severity
  title: string
  detail: string
  drill: string[]
  aiAssisted: boolean
}

const ONE_CRORE = 10000000 * 100 // ₹1,00,00,000 in paise
const TEN_CRORE = 100000000 * 100 // ₹10,00,00,000 in paise

export interface CaroApplicability {
  paidUpPlusReserves: Paise
  borrowings: Paise
  revenue: Paise
  capitalUnderCrore: boolean
  borrowingsUnderCrore: boolean
  revenueUnderTenCrore: boolean
  /** All three thresholds met ⇒ a small private company exempt from CARO. */
  likelyExempt: boolean
}

export function caroApplicability(s: Sch3Statements): CaroApplicability {
  const head = (id: string) =>
    [...s.bsAssets, ...s.bsEquityLiability, ...s.plIncome, ...s.plExpense].find((r) => r.line.id === id)?.consolidated ?? 0
  const paidUpPlusReserves = (head('share_capital') + head('reserves_surplus') + s.profitForYear.consolidated) as Paise
  const borrowings = (head('lt_borrowings') + head('st_borrowings')) as Paise
  const revenue = (head('revenue_ops') + head('other_income')) as Paise
  const capitalUnderCrore = Math.abs(paidUpPlusReserves) <= ONE_CRORE
  const borrowingsUnderCrore = Math.abs(borrowings) <= ONE_CRORE
  const revenueUnderTenCrore = Math.abs(revenue) <= TEN_CRORE
  return {
    paidUpPlusReserves,
    borrowings,
    revenue,
    capitalUnderCrore,
    borrowingsUnderCrore,
    revenueUnderTenCrore,
    likelyExempt: capitalUnderCrore && borrowingsUnderCrore && revenueUnderTenCrore,
  }
}

export function runReview(s: Sch3Statements, datasets: NormalizedDataset[]): ReviewFinding[] {
  const out: ReviewFinding[] = []
  const add = (f: Omit<ReviewFinding, 'aiAssisted'>) => out.push({ ...f, aiAssisted: false })

  // 1. BS balances
  add({
    id: 'bs-balance',
    area: 'Presentation',
    severity: Math.abs(s.bsResidual.consolidated) < 10000 ? 'info' : 'high',
    title: 'Balance Sheet balancing',
    detail:
      Math.abs(s.bsResidual.consolidated) < 10000
        ? 'Total Assets equal Total Equity & Liabilities.'
        : `Balance Sheet is out by ${formatINR(s.bsResidual.consolidated)} — do not finalise.`,
    drill: [],
  })

  // 2. Sign reclassification
  const negLiab = s.bsEquityLiability.filter((r) => r.consolidated < 0)
  if (negLiab.length) {
    add({
      id: 'reclass-liab',
      area: 'Presentation',
      severity: 'medium',
      title: 'Credit-side heads carrying a debit balance',
      detail: `${negLiab.length} liability/equity head(s) net debit — reclassify (e.g. advances from customers, debit-balance creditors).`,
      drill: negLiab.map((r) => `${r.line.label}: ${formatINR(r.consolidated)}`),
    })
  }
  const negAsset = s.bsAssets.filter((r) => r.consolidated < 0)
  if (negAsset.length) {
    add({
      id: 'reclass-asset',
      area: 'Presentation',
      severity: 'medium',
      title: 'Asset heads carrying a credit balance',
      detail: `${negAsset.length} asset head(s) net credit — reclassify to liabilities.`,
      drill: negAsset.map((r) => `${r.line.label}: ${formatINR(r.consolidated)}`),
    })
  }

  // 3. Negative / large cash
  const cash = s.bsAssets.find((r) => r.line.id === 'cash_bank')?.consolidated ?? 0
  const totalAssets = s.totals.assets.consolidated || 1
  if (cash < 0) {
    add({ id: 'neg-cash', area: 'Internal control', severity: 'high', title: 'Negative cash/bank balance', detail: `Cash & bank shows ${formatINR(cash as Paise)} — investigate overdrawn/unreconciled accounts.`, drill: [] })
  } else if (cash / totalAssets > 0.05) {
    add({ id: 'large-cash', area: 'Internal control', severity: 'low', title: 'Large cash-on-hand balance', detail: `Cash & bank is ${Math.round((cash / totalAssets) * 100)}% of total assets (${formatINR(cash as Paise)}).`, drill: [] })
  }

  // 4. Parties missing PAN (consolidated across branches)
  const noPan: string[] = []
  for (const ds of datasets) {
    for (const l of ds.ledgers) {
      if (/creditor|debtor|payable|receivable/i.test(l.parent) && !l.pan && Math.abs(l.closing) > 0) {
        noPan.push(l.name)
      }
    }
  }
  if (noPan.length) {
    add({ id: 'no-pan', area: 'Tax / 206AA', severity: 'medium', title: 'Party ledgers without PAN', detail: `${noPan.length} party ledger(s) carry a balance but no PAN — 206AA / reporting exposure.`, drill: noPan.slice(0, 12) })
  }

  // 5. Related-party candidates — same PAN across ledgers
  const panMap = new Map<string, string[]>()
  for (const ds of datasets) {
    for (const l of ds.ledgers) {
      if (!l.pan) continue
      const arr = panMap.get(l.pan) ?? []
      arr.push(l.name)
      panMap.set(l.pan, arr)
    }
  }
  const dupPan = [...panMap.entries()].filter(([, names]) => new Set(names).size > 1)
  if (dupPan.length) {
    add({ id: 'rpt-pan', area: 'Related party (SA 550)', severity: 'medium', title: 'Same PAN across multiple ledgers', detail: `${dupPan.length} PAN(s) appear under more than one ledger — possible related parties / duplicate masters.`, drill: dupPan.slice(0, 10).map(([pan, names]) => `${pan}: ${[...new Set(names)].join(', ')}`) })
  }

  // 6. Round-figure journals (per branch)
  let roundCount = 0
  const roundDrill: string[] = []
  for (const ds of datasets) {
    for (const v of ds.vouchers) {
      if (!/journal/i.test(v.voucherType)) continue
      const lines = ds.linesByGuid.get(v.guid) ?? []
      const gross = lines.reduce((a, l) => a + Math.abs(l.amount), 0) / 2
      if (gross >= 10000000 && gross % 10000000 === 0) {
        roundCount++
        if (roundDrill.length < 10) roundDrill.push(`Journal ${v.voucherNumber ?? ''} ${formatINR(gross as Paise)}`)
      }
    }
  }
  if (roundCount) {
    add({ id: 'round-journals', area: 'Provisions / estimates', severity: 'low', title: 'Round-figure journal entries', detail: `${roundCount} journal(s) in exact lakhs — likely provisions; verify basis and Sch III disclosure.`, drill: roundDrill })
  }

  // 7. Schedule III ratios disclosure reminder (info)
  add({ id: 'ratios-disclosure', area: 'Disclosure (2021 amendment)', severity: 'info', title: 'Schedule III ratios disclosure', detail: 'The 2021 MCA amendment requires 11 ratios with explanations for >25% movement. See Year-on-Year for computed ratios.', drill: [] })

  // 8. MSME disclosure reminder
  const creditorCount = totalCreditors(datasets)
  if (creditorCount > 0) {
    add({ id: 'msme', area: 'Disclosure (MSMED)', severity: 'info', title: 'MSME / Trade Payables ageing', detail: `${creditorCount} trade creditor ledger(s). Confirm MSME status and disclose ageing (<1yr / 1-2yr / 2-3yr / >3yr) per Schedule III.`, drill: [] })
  }

  out.sort((a, b) => sevRank(b.severity) - sevRank(a.severity))
  return out
}

function totalCreditors(datasets: NormalizedDataset[]): number {
  const keys = new Set<LedgerKey>()
  for (const ds of datasets) {
    const tb = buildTrialBalance(ds)
    for (const r of tb.rows) {
      if (classifyLedger(r.key, ds) === 'trade_payables' && r.closing !== 0) keys.add(r.key)
    }
  }
  return keys.size
}

function sevRank(s: Severity): number {
  return s === 'high' ? 4 : s === 'medium' ? 3 : s === 'low' ? 2 : 1
}
