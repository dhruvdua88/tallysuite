/**
 * M3 offline validation battery (SPEC §5.4). Every check is a pure function over
 * the built statements + source datasets. No AI. Results drive a first-class
 * panel and are embedded in the Excel export.
 */
import type { NormalizedDataset } from '../model/dataset'
import { formatINR, type Paise } from '../model/money'
import type { Sch3Statements } from './statements'

export type CheckStatus = 'pass' | 'warn' | 'fail'

export interface CheckResult {
  id: string
  category: 'Structural' | 'Tie-out' | 'Sign sanity' | 'Master data'
  label: string
  status: CheckStatus
  detail: string
  drill?: string[]
}

export function runChecks(s: Sch3Statements, _datasets: NormalizedDataset[]): CheckResult[] {
  const out: CheckResult[] = []

  // 1. Structural — BS balances
  const residual = s.bsResidual.consolidated
  out.push({
    id: 'bs-balances',
    category: 'Structural',
    label: 'Total Assets = Total Equity & Liabilities',
    status: Math.abs(residual) < 10000 ? 'pass' : 'fail',
    detail: `Assets ${formatINR(s.totals.assets.consolidated)} vs Equity+Liab ${formatINR(
      s.totals.equityLiability.consolidated,
    )} · residual ${formatINR(residual)}`,
  })

  // 1b. Consolidation additivity (multi-branch only)
  if (s.branches.length > 1) {
    const sumBranches = s.totals.assets.perBranch.reduce((a, b) => a + b, 0)
    out.push({
      id: 'consol-additivity',
      category: 'Structural',
      label: 'Consolidated column = Σ branch columns',
      status: Math.abs(sumBranches - s.totals.assets.consolidated) < 100 ? 'pass' : 'fail',
      detail: `Σ branches ${formatINR(sumBranches as Paise)} = consolidated ${formatINR(s.totals.assets.consolidated)}`,
    })
  }

  // 2. Tie-out — profit reconciles to income − expense
  const profitCalc = (s.totals.totalIncome.consolidated - s.totals.totalExpense.consolidated) as Paise
  out.push({
    id: 'profit-tieout',
    category: 'Tie-out',
    label: 'Profit = Total Income − Total Expense',
    status: Math.abs(profitCalc - s.profitForYear.consolidated) < 100 ? 'pass' : 'fail',
    detail: `${formatINR(s.totals.totalIncome.consolidated)} − ${formatINR(
      s.totals.totalExpense.consolidated,
    )} = ${formatINR(profitCalc)}`,
  })

  // 3. Sign sanity — credit-side heads carrying a debit balance (negative presentation)
  const negLiab = s.bsEquityLiability.filter((r) => r.consolidated < 0)
  out.push({
    id: 'liab-debit',
    category: 'Sign sanity',
    label: 'Equity/Liability heads with debit (negative) balance',
    status: negLiab.length === 0 ? 'pass' : 'warn',
    detail: negLiab.length === 0 ? 'none — all credit-side as expected' : `${negLiab.length} head(s) — reclassification candidates`,
    drill: negLiab.map((r) => `${r.line.label}: ${formatINR(r.consolidated)}`),
  })
  const negAsset = s.bsAssets.filter((r) => r.consolidated < 0)
  out.push({
    id: 'asset-credit',
    category: 'Sign sanity',
    label: 'Asset heads with credit (negative) balance',
    status: negAsset.length === 0 ? 'pass' : 'warn',
    detail: negAsset.length === 0 ? 'none' : `${negAsset.length} head(s) — reclassification candidates`,
    drill: negAsset.map((r) => `${r.line.label}: ${formatINR(r.consolidated)}`),
  })

  // 3b. Negative cash
  const cash = s.bsAssets.find((r) => r.line.id === 'cash_bank')
  if (cash) {
    out.push({
      id: 'neg-cash',
      category: 'Sign sanity',
      label: 'Cash and bank balances non-negative',
      status: cash.consolidated >= 0 ? 'pass' : 'warn',
      detail: formatINR(cash.consolidated),
    })
  }

  // 4. Master data — period match
  out.push({
    id: 'period-match',
    category: 'Master data',
    label: 'All branches share the same period',
    status: s.periodsMatch ? 'pass' : 'fail',
    detail: s.periodsMatch ? `${s.period.from} → ${s.period.to}` : 'period mismatch — consolidation invalid',
  })

  // 4b. Unmapped ledgers block a clean statement
  out.push({
    id: 'unmapped',
    category: 'Master data',
    label: 'Every ledger mapped to a Schedule III head',
    status: s.unmapped.length === 0 ? 'pass' : 'warn',
    detail: s.unmapped.length === 0 ? 'all classified' : `${s.unmapped.length} unmapped (in "Unmapped" bucket)`,
    drill: s.unmapped.slice(0, 12).map((u) => `${u.ledger} [${u.branch}]: ${formatINR(u.value)}`),
  })

  return out
}

export function checkSummary(checks: CheckResult[]): { pass: number; warn: number; fail: number } {
  return {
    pass: checks.filter((c) => c.status === 'pass').length,
    warn: checks.filter((c) => c.status === 'warn').length,
    fail: checks.filter((c) => c.status === 'fail').length,
  }
}
