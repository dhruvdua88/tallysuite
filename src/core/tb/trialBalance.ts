/**
 * Trial Balance engine — the shared spine of M2 (diff), M3 (statements) and
 * M4 (YoY). Computes opening / movement / closing per ledger in a single signed
 * space that reconciles to mst_ledger closing balances (per the sign self-test),
 * then rolls ledgers up their group tree.
 */
import {
  ledgerKey,
  type AccountingLine,
  type LedgerKey,
  type NormalizedDataset,
  type SignConvention,
} from '../model/dataset'
import { ZERO, type Paise } from '../model/money'

export interface TBRow {
  key: LedgerKey
  name: string
  /** Immediate parent group name from mst_ledger.parent. */
  group: string
  groupKey: LedgerKey
  /** Root primary group (Assets / Liabilities / Income / Expenses …). */
  primaryGroup: string | null
  opening: Paise
  movement: Paise
  closing: Paise
  lineCount: number
}

export interface TrialBalance {
  rows: TBRow[]
  rowByKey: Map<LedgerKey, TBRow>
  totalOpening: Paise
  totalMovement: Paise
  totalClosing: Paise
  /** A balanced TB has Σ closing = 0 in debit-positive signed space. */
  balanced: boolean
}

/**
 * Signed movement of a line in the dataset's reconciling space.
 * negative-is-debit → movement = +raw ; positive-is-debit → movement = −raw.
 * (Chosen so closing = opening + Σ movement matches mst_ledger.closing.)
 */
export function signedMovement(amount: Paise, conv: SignConvention): Paise {
  return (conv === 'negative-is-debit' ? amount : -amount) as Paise
}

/** Σ signed movement per ledger key over a set of accounting lines. */
export function movementByLedger(
  lines: readonly AccountingLine[],
  conv: SignConvention,
): Map<LedgerKey, Paise> {
  const m = new Map<LedgerKey, Paise>()
  for (const ln of lines) {
    const mv = signedMovement(ln.amount, conv)
    m.set(ln.ledgerKey, ((m.get(ln.ledgerKey) ?? 0) + mv) as Paise)
  }
  return m
}

export function buildTrialBalance(ds: NormalizedDataset): TrialBalance {
  const conv = ds.meta.signConvention
  const movement = new Map<LedgerKey, Paise>()
  const lineCount = new Map<LedgerKey, number>()
  for (const ln of ds.lines) {
    const mv = signedMovement(ln.amount, conv)
    movement.set(ln.ledgerKey, ((movement.get(ln.ledgerKey) ?? 0) + mv) as Paise)
    lineCount.set(ln.ledgerKey, (lineCount.get(ln.ledgerKey) ?? 0) + 1)
  }

  const rows: TBRow[] = []
  const seen = new Set<LedgerKey>()
  for (const l of ds.ledgers) {
    const mv = movement.get(l.key) ?? ZERO
    rows.push({
      key: l.key,
      name: l.name,
      group: l.parent,
      groupKey: l.parentKey,
      primaryGroup: resolvePrimaryGroup(l.parentKey, ds),
      opening: l.opening,
      movement: mv,
      closing: (l.opening + mv) as Paise,
      lineCount: lineCount.get(l.key) ?? 0,
    })
    seen.add(l.key)
  }
  // Ledgers referenced only by transactions (not in master) — surface them.
  for (const [key, mv] of movement) {
    if (seen.has(key)) continue
    rows.push({
      key,
      name: key,
      group: '(unknown)',
      groupKey: ledgerKey('(unknown)'),
      primaryGroup: null,
      opening: ZERO,
      movement: mv,
      closing: mv,
      lineCount: lineCount.get(key) ?? 0,
    })
  }

  rows.sort((a, b) => a.name.localeCompare(b.name))
  const rowByKey = new Map(rows.map((r) => [r.key, r]))
  const totalOpening = sumField(rows, 'opening')
  const totalMovement = sumField(rows, 'movement')
  const totalClosing = sumField(rows, 'closing')
  return {
    rows,
    rowByKey,
    totalOpening,
    totalMovement,
    totalClosing,
    balanced: Math.abs(totalClosing) <= 100, // within ₹1 rounding
  }
}

/** Walk mst_group.parent up to the primary (root) group. */
export function resolvePrimaryGroup(
  groupKey: LedgerKey | null,
  ds: NormalizedDataset,
): string | null {
  let cur = groupKey
  let guard = 0
  let last: string | null = null
  while (cur && guard++ < 50) {
    const g = ds.groupByKey.get(cur)
    if (!g) break
    if (g.primaryGroup) return g.primaryGroup
    last = g.name
    cur = g.parentKey
  }
  return last
}

function sumField(rows: readonly TBRow[], field: 'opening' | 'movement' | 'closing'): Paise {
  let acc = 0
  for (const r of rows) acc += r[field]
  return acc as Paise
}
