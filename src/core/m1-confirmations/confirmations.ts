/**
 * M1 — Balance Confirmations. For each party (debtor/creditor) decides whether a
 * bill-wise breakup exists; if so it reconciles Σ bills against the ledger closing
 * and surfaces the difference for user validation (use bills / use ledger /
 * exclude). Drives confirmation-letter + Excel generation.
 */
import type { LedgerKey, NormalizedDataset } from '../model/dataset'
import { ZERO, type Paise } from '../model/money'

export type PartyKind = 'debtor' | 'creditor'
export type ConfirmSource = 'billwise' | 'ledger' | 'exclude'

export interface BillRow {
  name: string
  amount: Paise
  billType: string | null
  creditPeriod: string | null
}

export interface ConfirmationParty {
  key: LedgerKey
  name: string
  kind: PartyKind
  address: string | null
  email: string | null
  pan: string | null
  gstin: string | null
  ledgerClosing: Paise // magnitude
  drCr: 'Dr' | 'Cr'
  billwiseAvailable: boolean
  billCount: number
  billTotal: Paise // magnitude
  diff: Paise // ledgerClosing − billTotal (magnitude)
  reconciles: boolean
  bills: BillRow[]
  /** Recommended source, also the default the UI applies. */
  source: ConfirmSource
}

export interface ConfirmationOptions {
  kinds: PartyKind[]
  /** Minimum absolute closing (paise) to include. */
  materiality: Paise
}

export function buildConfirmations(
  ds: NormalizedDataset,
  opts: ConfirmationOptions,
): ConfirmationParty[] {
  // bills indexed by ledger (current + opening allocations)
  const billsByLedger = new Map<LedgerKey, BillRow[]>()
  for (const b of [...ds.bills, ...ds.openingBills]) {
    const arr = billsByLedger.get(b.ledgerKey) ?? []
    arr.push({ name: b.billName ?? '(unnamed)', amount: b.amount, billType: b.billType, creditPeriod: b.creditPeriod })
    billsByLedger.set(b.ledgerKey, arr)
  }

  const out: ConfirmationParty[] = []
  for (const l of ds.ledgers) {
    const kind = partyKind(l.parent)
    if (!kind || !opts.kinds.includes(kind)) continue
    if (Math.abs(l.closing) < opts.materiality) continue

    const bills = billsByLedger.get(l.key) ?? []
    const billTotalSigned = bills.reduce((s, b) => s + b.amount, 0)
    const ledgerMag = Math.abs(l.closing) as Paise
    const billMag = Math.abs(billTotalSigned) as Paise
    const diff = (ledgerMag - billMag) as Paise
    const billwiseAvailable = bills.length > 0
    // reconciles within ₹1 or 0.5% of the ledger balance
    const tol = Math.max(100, Math.round(ledgerMag * 0.005))
    const reconciles = billwiseAvailable && Math.abs(diff) <= tol

    out.push({
      key: l.key,
      name: l.name,
      kind,
      address: l.mailingAddress ?? l.mailingName ?? null,
      email: l.email,
      pan: l.pan,
      gstin: l.gstin,
      ledgerClosing: ledgerMag,
      drCr: drCrOf(l.closing, ds),
      billwiseAvailable,
      billCount: bills.length,
      billTotal: billMag,
      diff,
      reconciles,
      bills: bills.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount)),
      source: !billwiseAvailable ? 'ledger' : reconciles ? 'billwise' : 'ledger',
    })
  }

  out.sort((a, b) => b.ledgerClosing - a.ledgerClosing)
  return out
}

/** The amount that will be confirmed, honouring the chosen source. */
export function confirmAmount(p: ConfirmationParty): Paise {
  if (p.source === 'exclude') return ZERO
  return p.source === 'billwise' ? p.billTotal : p.ledgerClosing
}

function partyKind(parent: string): PartyKind | null {
  const g = parent.toLowerCase()
  if (/debtor|receivable/.test(g)) return 'debtor'
  if (/creditor|payable/.test(g)) return 'creditor'
  return null
}

function drCrOf(closing: Paise, ds: NormalizedDataset): 'Dr' | 'Cr' {
  // In the reconciling space, a debtor normally carries the asset (debit) sign.
  // Use sign convention: negative-is-debit → closing<0 ⇒ Dr.
  const negDebit = ds.meta.signConvention === 'negative-is-debit'
  const isDebit = negDebit ? closing < 0 : closing > 0
  return isDebit ? 'Dr' : 'Cr'
}

export interface ConfirmationSummary {
  total: number
  included: number
  billwise: number
  ledgerOnly: number
  mismatches: number
  excluded: number
}

export function summarize(parties: ConfirmationParty[]): ConfirmationSummary {
  return {
    total: parties.length,
    included: parties.filter((p) => p.source !== 'exclude').length,
    billwise: parties.filter((p) => p.source === 'billwise').length,
    ledgerOnly: parties.filter((p) => p.source === 'ledger').length,
    mismatches: parties.filter((p) => p.billwiseAvailable && !p.reconciles).length,
    excluded: parties.filter((p) => p.source === 'exclude').length,
  }
}
