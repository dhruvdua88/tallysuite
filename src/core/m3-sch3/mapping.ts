/**
 * Schedule III mapping (Companies Act 2013, Division I).
 *
 * Classifies each ledger into a Schedule III line by walking its Tally group
 * chain and matching against ordered rules (first match wins). Mapping is DATA,
 * not branching logic buried in the builder (SPEC §5.3). Anything unmatched lands
 * in the visible "Unmapped" bucket which blocks export until assigned.
 */
import type { LedgerKey, NormalizedDataset } from '../model/dataset'

export type Sch3Section = 'BS' | 'PL'
export type Sch3Side = 'asset' | 'equityLiability' | 'income' | 'expense'

export interface Sch3Line {
  id: string
  label: string
  section: Sch3Section
  side: Sch3Side
  /** Note schedule number on the face of the statement. */
  note: number
  /** Sort order within the statement. */
  order: number
}

/** The Schedule III face lines, in presentation order. */
export const SCH3_LINES: Sch3Line[] = [
  // --- Balance Sheet · Equity & Liabilities ---
  { id: 'share_capital', label: 'Share Capital', section: 'BS', side: 'equityLiability', note: 3, order: 100 },
  { id: 'reserves_surplus', label: 'Reserves and Surplus', section: 'BS', side: 'equityLiability', note: 4, order: 101 },
  { id: 'lt_borrowings', label: 'Long-term Borrowings', section: 'BS', side: 'equityLiability', note: 5, order: 110 },
  { id: 'lt_provisions', label: 'Long-term Provisions', section: 'BS', side: 'equityLiability', note: 6, order: 111 },
  { id: 'other_nc_liab', label: 'Other Non-current Liabilities', section: 'BS', side: 'equityLiability', note: 7, order: 112 },
  { id: 'st_borrowings', label: 'Short-term Borrowings', section: 'BS', side: 'equityLiability', note: 8, order: 120 },
  { id: 'trade_payables', label: 'Trade Payables', section: 'BS', side: 'equityLiability', note: 9, order: 121 },
  { id: 'other_cur_liab', label: 'Other Current Liabilities', section: 'BS', side: 'equityLiability', note: 10, order: 122 },
  { id: 'st_provisions', label: 'Short-term Provisions', section: 'BS', side: 'equityLiability', note: 11, order: 123 },
  // --- Balance Sheet · Assets ---
  { id: 'fixed_assets', label: 'Property, Plant & Equipment', section: 'BS', side: 'asset', note: 12, order: 200 },
  { id: 'nc_investments', label: 'Non-current Investments', section: 'BS', side: 'asset', note: 13, order: 210 },
  { id: 'lt_loans_adv', label: 'Long-term Loans and Advances', section: 'BS', side: 'asset', note: 14, order: 211 },
  { id: 'other_nc_assets', label: 'Other Non-current Assets', section: 'BS', side: 'asset', note: 15, order: 212 },
  { id: 'cur_investments', label: 'Current Investments', section: 'BS', side: 'asset', note: 16, order: 220 },
  { id: 'inventories', label: 'Inventories', section: 'BS', side: 'asset', note: 17, order: 221 },
  { id: 'trade_receivables', label: 'Trade Receivables', section: 'BS', side: 'asset', note: 18, order: 222 },
  { id: 'cash_bank', label: 'Cash and Bank Balances', section: 'BS', side: 'asset', note: 19, order: 223 },
  { id: 'st_loans_adv', label: 'Short-term Loans and Advances', section: 'BS', side: 'asset', note: 20, order: 224 },
  { id: 'other_cur_assets', label: 'Other Current Assets', section: 'BS', side: 'asset', note: 21, order: 225 },
  // --- Statement of Profit & Loss ---
  { id: 'revenue_ops', label: 'Revenue from Operations', section: 'PL', side: 'income', note: 22, order: 300 },
  { id: 'other_income', label: 'Other Income', section: 'PL', side: 'income', note: 23, order: 301 },
  { id: 'cost_materials', label: 'Cost of Materials / Purchases', section: 'PL', side: 'expense', note: 24, order: 310 },
  { id: 'changes_inventory', label: 'Changes in Inventories', section: 'PL', side: 'expense', note: 25, order: 311 },
  { id: 'employee_benefit', label: 'Employee Benefit Expense', section: 'PL', side: 'expense', note: 26, order: 312 },
  { id: 'finance_costs', label: 'Finance Costs', section: 'PL', side: 'expense', note: 27, order: 313 },
  { id: 'depreciation', label: 'Depreciation and Amortisation', section: 'PL', side: 'expense', note: 28, order: 314 },
  { id: 'other_expenses', label: 'Other Expenses', section: 'PL', side: 'expense', note: 29, order: 315 },
  { id: 'tax_expense', label: 'Tax Expense', section: 'PL', side: 'expense', note: 30, order: 320 },
]

export const SCH3_BY_ID = new Map(SCH3_LINES.map((l) => [l.id, l]))
export const UNMAPPED = 'unmapped'

/**
 * Ordered classification rules. `match` tests against the ledger name + its full
 * group chain (immediate parent → primary group), all lower-cased. First hit wins.
 */
interface Rule {
  id: string
  test: (ctx: ClassifyContext) => boolean
}

interface ClassifyContext {
  ledgerName: string
  groupChain: string[] // lower-cased, immediate parent first … primary group last
  primaryGroup: string // lower-cased
  isRevenue: boolean | null
}

const any = (chain: string[], ...needles: string[]) =>
  chain.some((g) => needles.some((n) => g.includes(n)))

const RULES: Rule[] = [
  // Special ledgers identified by NAME (may have no/blank group in some exports)
  { id: 'reserves_surplus', test: (c) => /profit\s*(&|and)\s*loss/.test(c.ledgerName) },

  // P&L — match on primary group first (revenue/expense are nominal)
  { id: 'revenue_ops', test: (c) => c.primaryGroup.includes('sales') },
  { id: 'cost_materials', test: (c) => c.primaryGroup.includes('purchase') },
  { id: 'other_income', test: (c) => c.primaryGroup.includes('direct incom') || c.primaryGroup.includes('indirect incom') },
  { id: 'finance_costs', test: (c) => any(c.groupChain, 'interest', 'finance cost', 'bank charge') },
  { id: 'depreciation', test: (c) => any(c.groupChain, 'depreciation', 'amortis', 'amortiz') },
  { id: 'employee_benefit', test: (c) => any(c.groupChain, 'salary', 'wages', 'salaries', 'staff', 'employee', 'payroll', 'pf ', 'provident', 'gratuity', 'bonus') },
  { id: 'cost_materials', test: (c) => c.primaryGroup.includes('direct expens') },
  { id: 'tax_expense', test: (c) => any(c.groupChain, 'income tax', 'tax expense', 'current tax', 'deferred tax') && c.primaryGroup.includes('expens') },
  { id: 'other_expenses', test: (c) => c.primaryGroup.includes('indirect expens') || c.primaryGroup.includes('expens') },

  // BS — Equity & Liabilities
  { id: 'reserves_surplus', test: (c) => any(c.groupChain, 'reserves', 'surplus', 'profit & loss', 'p&l') },
  { id: 'share_capital', test: (c) => c.primaryGroup.includes('capital') },
  { id: 'st_borrowings', test: (c) => any(c.groupChain, 'bank od', 'overdraft', 'cash credit', 'o/d', 'working capital') },
  { id: 'lt_borrowings', test: (c) => c.primaryGroup.includes('loan') && (any(c.groupChain, 'secured', 'unsecured', 'term loan') || true) },
  { id: 'trade_payables', test: (c) => any(c.groupChain, 'sundry creditor', 'trade payable', 'creditors for') && !any(c.groupChain, 'expense') },
  { id: 'st_provisions', test: (c) => any(c.groupChain, 'provision') },
  { id: 'other_cur_liab', test: (c) => any(c.groupChain, 'duties & taxes', 'duties and taxes', 'gst', 'tds', 'tax payable', 'statutory', 'outstanding', 'expenses payable') },

  // BS — Assets
  { id: 'fixed_assets', test: (c) => c.primaryGroup.includes('fixed asset') },
  { id: 'nc_investments', test: (c) => c.primaryGroup.includes('investment') },
  { id: 'inventories', test: (c) => any(c.groupChain, 'stock-in-hand', 'stock in hand', 'inventor', 'closing stock') },
  { id: 'cash_bank', test: (c) => any(c.groupChain, 'cash-in-hand', 'cash in hand', 'bank account') || c.ledgerName.includes('cash') },
  { id: 'trade_receivables', test: (c) => any(c.groupChain, 'sundry debtor', 'trade receivable', 'debtors') },
  { id: 'st_loans_adv', test: (c) => any(c.groupChain, 'loans & advances', 'loans and advances', 'advance', 'deposit') && c.primaryGroup.includes('current asset') },
  { id: 'lt_loans_adv', test: (c) => any(c.groupChain, 'loans & advances', 'deposits') },
  { id: 'other_cur_assets', test: (c) => c.primaryGroup.includes('current asset') },
  { id: 'other_nc_assets', test: (c) => any(c.groupChain, 'misc', 'miscellaneous') },
  { id: 'other_cur_liab', test: (c) => c.primaryGroup.includes('current liab') },
  // Inter-branch / divisions balances — present as a current asset; the sign
  // sanity check flags a credit balance (amount payable to branch) for reclass.
  { id: 'other_cur_assets', test: (c) => any(c.groupChain, 'branch', 'division') },
]

/** Full group chain (names, immediate parent first up to primary group). */
export function groupChainOf(parentKey: LedgerKey | null, ds: NormalizedDataset): string[] {
  const chain: string[] = []
  let cur = parentKey
  let guard = 0
  while (cur && guard++ < 50) {
    const g = ds.groupByKey.get(cur)
    if (!g) break
    chain.push(g.name)
    cur = g.parentKey
  }
  return chain
}

/** Classify a ledger → Schedule III line id (or UNMAPPED). */
export function classifyLedger(
  ledgerKey: LedgerKey,
  ds: NormalizedDataset,
): string {
  const l = ds.ledgerByKey.get(ledgerKey)
  if (!l) return UNMAPPED
  const chain = groupChainOf(l.parentKey, ds).map((g) => g.toLowerCase())
  const primaryGroup = (chain[chain.length - 1] ?? l.parent ?? '').toLowerCase()
  const ctx: ClassifyContext = {
    ledgerName: l.name.toLowerCase(),
    groupChain: [l.parent.toLowerCase(), ...chain],
    primaryGroup,
    isRevenue: l.isRevenue,
  }
  for (const r of RULES) {
    if (r.test(ctx)) return r.id
  }
  return UNMAPPED
}
