/**
 * M2 — Differential Trial Balance (SPEC §4).
 *
 * Two snapshots of the same company. Because every voucher nets to zero, any
 * add/delete/edit moves ≥2 ledgers by equal-and-opposite amounts. So the most
 * readable "what changed" is a Trial Balance of Differences:
 *     Δ(L) = Σ V2.movement[L] − Σ V1.movement[L]      (transaction movement)
 *     invariant:  Σ over all ledgers Δ(L) = 0
 * plus a per-voucher add/delete/modify classification with field-level diffs.
 */
import type {
  AccountingLine,
  Guid,
  LedgerKey,
  NormalizedDataset,
  VoucherHeader,
} from '../model/dataset'
import { formatINR, ZERO, type Paise } from '../model/money'
import { movementByLedger, resolvePrimaryGroup, signedMovement } from '../tb/trialBalance'

export type ChangeKind = 'added' | 'deleted' | 'modified'

export interface FieldDiff {
  field: string
  before: string | null
  after: string | null
}

export interface LineDiff {
  ledger: string
  ledgerKey: LedgerKey
  before: Paise | null // signed movement in V1
  after: Paise | null // signed movement in V2
}

export type RiskTag =
  | 'cash-bank-delta'
  | 'date-moved-period-end'
  | 'deleted-sales-purchase'
  | 'amount-reduced'
  | 'round-figure'
  | 'post-period-insert'

export interface VoucherChange {
  guid: Guid
  kind: ChangeKind
  v1: VoucherHeader | null
  v2: VoucherHeader | null
  fieldDiffs: FieldDiff[]
  lineDiffs: LineDiff[]
  risks: RiskTag[]
}

export interface DiffTBRow {
  key: LedgerKey
  name: string
  group: string
  primaryGroup: string | null
  v1Movement: Paise
  v2Movement: Paise
  delta: Paise
  contributingGuids: Guid[]
}

export interface DiffGuard {
  sameCompany: boolean
  v1Prefix: string | null
  v2Prefix: string | null
  v1Period: string
  v2Period: string
  periodsMatch: boolean
  alterIdMasterMoved: boolean
  alterIdTxnMoved: boolean
  v1AlterIdTxn: number | null
  v2AlterIdTxn: number | null
}

export interface DiffCounts {
  added: number
  deleted: number
  modified: number
  unchanged: number
}

export interface VersionDiff {
  guard: DiffGuard
  counts: DiffCounts
  tbRows: DiffTBRow[] // all ledgers; UI filters Δ≠0
  changedRows: DiffTBRow[] // only Δ≠0, sorted by |Δ| desc
  voucherChanges: VoucherChange[]
  sumDelta: Paise // must be 0
  balanced: boolean
}

export function diffVersions(v1: NormalizedDataset, v2: NormalizedDataset): VersionDiff {
  const guard = buildGuard(v1, v2)

  // --- voucher classification ---
  const changes: VoucherChange[] = []
  const counts: DiffCounts = { added: 0, deleted: 0, modified: 0, unchanged: 0 }

  const keys = new Set<Guid>()
  for (const g of v1.voucherByGuid.keys()) keys.add(g)
  for (const g of v2.voucherByGuid.keys()) keys.add(g)

  for (const guid of keys) {
    const a = v1.voucherByGuid.get(guid) ?? null
    const b = v2.voucherByGuid.get(guid) ?? null
    if (a && b) {
      if (a.contentHash === b.contentHash) {
        counts.unchanged++
        continue
      }
      counts.modified++
      changes.push(
        annotate({
          guid,
          kind: 'modified',
          v1: a,
          v2: b,
          fieldDiffs: headerDiffs(a, b),
          lineDiffs: lineDiffs(v1, v2, guid),
          risks: [],
        }, v1, v2),
      )
    } else if (b && !a) {
      counts.added++
      changes.push(
        annotate({
          guid,
          kind: 'added',
          v1: null,
          v2: b,
          fieldDiffs: [],
          lineDiffs: lineDiffs(v1, v2, guid),
          risks: [],
        }, v1, v2),
      )
    } else if (a && !b) {
      counts.deleted++
      changes.push(
        annotate({
          guid,
          kind: 'deleted',
          v1: a,
          v2: null,
          fieldDiffs: [],
          lineDiffs: lineDiffs(v1, v2, guid),
          risks: [],
        }, v1, v2),
      )
    }
  }

  // --- differential trial balance ---
  const mv1 = movementByLedger(v1.lines, v1.meta.signConvention)
  const mv2 = movementByLedger(v2.lines, v2.meta.signConvention)
  const allKeys = new Set<LedgerKey>()
  for (const k of mv1.keys()) allKeys.add(k)
  for (const k of mv2.keys()) allKeys.add(k)

  // ledger → contributing changed-voucher guids
  const contrib = new Map<LedgerKey, Set<Guid>>()
  for (const c of changes) {
    for (const ld of c.lineDiffs) {
      const set = contrib.get(ld.ledgerKey) ?? new Set<Guid>()
      set.add(c.guid)
      contrib.set(ld.ledgerKey, set)
    }
  }

  const tbRows: DiffTBRow[] = []
  for (const key of allKeys) {
    const a = mv1.get(key) ?? ZERO
    const b = mv2.get(key) ?? ZERO
    const delta = (b - a) as Paise
    const meta = v2.ledgerByKey.get(key) ?? v1.ledgerByKey.get(key)
    const groupKey = meta?.parentKey ?? null
    tbRows.push({
      key,
      name: meta?.name ?? key,
      group: meta?.parent ?? '(unknown)',
      primaryGroup: groupKey
        ? (resolvePrimaryGroup(groupKey, v2.groupByKey.has(groupKey) ? v2 : v1) ?? null)
        : null,
      v1Movement: a,
      v2Movement: b,
      delta,
      contributingGuids: [...(contrib.get(key) ?? [])].sort(),
    })
  }
  tbRows.sort((x, y) => x.name.localeCompare(y.name))

  const changedRows = tbRows
    .filter((r) => r.delta !== 0)
    .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta))

  let sumDelta = 0
  for (const r of tbRows) sumDelta += r.delta

  changes.sort(changeSort)

  return {
    guard,
    counts,
    tbRows,
    changedRows,
    voucherChanges: changes,
    sumDelta: sumDelta as Paise,
    balanced: Math.abs(sumDelta) <= 100,
  }
}

// ----------------------------------------------------------------------------

function buildGuard(v1: NormalizedDataset, v2: NormalizedDataset): DiffGuard {
  const p1 = v1.meta.companyGuidPrefix
  const p2 = v2.meta.companyGuidPrefix
  return {
    sameCompany: p1 !== null && p1 === p2,
    v1Prefix: p1,
    v2Prefix: p2,
    v1Period: periodLabel(v1),
    v2Period: periodLabel(v2),
    periodsMatch:
      v1.meta.periodFrom === v2.meta.periodFrom && v1.meta.periodTo === v2.meta.periodTo,
    alterIdMasterMoved: v1.meta.lastAlterIdMaster !== v2.meta.lastAlterIdMaster,
    alterIdTxnMoved: v1.meta.lastAlterIdTransaction !== v2.meta.lastAlterIdTransaction,
    v1AlterIdTxn: v1.meta.lastAlterIdTransaction,
    v2AlterIdTxn: v2.meta.lastAlterIdTransaction,
  }
}

function periodLabel(ds: NormalizedDataset): string {
  return `${ds.meta.periodFrom ?? '?'} → ${ds.meta.periodTo ?? '?'}`
}

const HEADER_FIELDS: { key: keyof VoucherHeader; label: string }[] = [
  { key: 'date', label: 'Date' },
  { key: 'voucherType', label: 'Voucher Type' },
  { key: 'voucherNumber', label: 'Voucher No.' },
  { key: 'referenceNumber', label: 'Reference No.' },
  { key: 'narration', label: 'Narration' },
  { key: 'partyName', label: 'Party' },
  { key: 'placeOfSupply', label: 'Place of Supply' },
]

function headerDiffs(a: VoucherHeader, b: VoucherHeader): FieldDiff[] {
  const out: FieldDiff[] = []
  for (const f of HEADER_FIELDS) {
    const av = a[f.key]
    const bv = b[f.key]
    if (av !== bv) {
      out.push({ field: f.label, before: av == null ? null : String(av), after: bv == null ? null : String(bv) })
    }
  }
  return out
}

function lineDiffs(v1: NormalizedDataset, v2: NormalizedDataset, guid: Guid): LineDiff[] {
  const a = v1.linesByGuid.get(guid) ?? []
  const b = v2.linesByGuid.get(guid) ?? []
  const aMv = aggregateLines(a, v1.meta.signConvention)
  const bMv = aggregateLines(b, v2.meta.signConvention)
  const keys = new Set<LedgerKey>()
  for (const k of aMv.keys()) keys.add(k)
  for (const k of bMv.keys()) keys.add(k)
  const out: LineDiff[] = []
  for (const k of keys) {
    const before = aMv.get(k)
    const after = bMv.get(k)
    if (before === after) continue
    const name =
      v2.ledgerByKey.get(k)?.name ?? v1.ledgerByKey.get(k)?.name ?? a.concat(b).find((l) => l.ledgerKey === k)?.ledger ?? k
    out.push({ ledger: name, ledgerKey: k, before: before ?? null, after: after ?? null })
  }
  out.sort((x, y) => x.ledger.localeCompare(y.ledger))
  return out
}

function aggregateLines(
  lines: readonly AccountingLine[],
  conv: NormalizedDataset['meta']['signConvention'],
): Map<LedgerKey, Paise> {
  const m = new Map<LedgerKey, Paise>()
  for (const l of lines) {
    const mv = signedMovement(l.amount, conv)
    m.set(l.ledgerKey, ((m.get(l.ledgerKey) ?? 0) + mv) as Paise)
  }
  return m
}

// --- risk rules (deterministic, no AI) ---
function annotate(c: VoucherChange, v1: NormalizedDataset, v2: NormalizedDataset): VoucherChange {
  const risks = new Set<RiskTag>()
  const vch = c.v2 ?? c.v1!

  // cash/bank touched
  if (c.lineDiffs.some((l) => isCashBank(l.ledger))) risks.add('cash-bank-delta')

  // deleted sales/purchase
  if (c.kind === 'deleted' && /sales|purchase/i.test(vch.voucherType)) {
    risks.add('deleted-sales-purchase')
  }

  // date changed across a period/month boundary
  if (c.kind === 'modified') {
    const df = c.fieldDiffs.find((f) => f.field === 'Date')
    if (df && df.before && df.after && monthKey(df.before) !== monthKey(df.after)) {
      risks.add('date-moved-period-end')
    }
    // amount reduced in magnitude on any cash/bank line
    for (const l of c.lineDiffs) {
      if (l.before != null && l.after != null && Math.abs(l.after) < Math.abs(l.before) && isCashBank(l.ledger)) {
        risks.add('amount-reduced')
      }
    }
  }

  // inserted with date after the export's period end (back/forward-dated)
  if (c.kind === 'added' && vch.date) {
    const end = v2.meta.periodTo ?? v1.meta.periodTo
    if (end && vch.date > end) risks.add('post-period-insert')
  }

  // round-figure net effect (≥ ₹1,000 and divisible by ₹1,000)
  for (const l of c.lineDiffs) {
    const d = (l.after ?? 0) - (l.before ?? 0)
    if (d !== 0 && Math.abs(d) >= 100000 && Math.abs(d) % 100000 === 0) risks.add('round-figure')
  }

  c.risks = [...risks]
  return c
}

function isCashBank(name: string): boolean {
  return /\b(cash|bank|icici|hdfc|sbi|axis|kotak|yes bank)\b/i.test(name)
}

function monthKey(iso: string): string {
  return iso.slice(0, 7)
}

function changeSort(a: VoucherChange, b: VoucherChange): number {
  const order: Record<ChangeKind, number> = { deleted: 0, modified: 1, added: 2 }
  if (order[a.kind] !== order[b.kind]) return order[a.kind] - order[b.kind]
  const da = (a.v1 ?? a.v2)?.date ?? ''
  const db = (b.v1 ?? b.v2)?.date ?? ''
  return da.localeCompare(db)
}

export const RISK_LABELS: Record<RiskTag, string> = {
  'cash-bank-delta': 'Cash / bank affected',
  'date-moved-period-end': 'Date moved across month',
  'deleted-sales-purchase': 'Deleted sales/purchase',
  'amount-reduced': 'Amount reduced',
  'round-figure': 'Round-figure change',
  'post-period-insert': 'Dated after period end',
}

/** Human one-liner for a single change (offline; AI narration is separate). */
export function describeChange(c: VoucherChange): string {
  const v = c.v2 ?? c.v1!
  const amt = c.lineDiffs.reduce((s, l) => s + Math.abs((l.after ?? 0) - (l.before ?? 0)), 0) / 2
  const head = `${cap(c.kind)} ${v.voucherType}${v.voucherNumber ? ` #${v.voucherNumber}` : ''}`
  return `${head} — net ${formatINR(amt as Paise)}${v.partyName ? ` · ${v.partyName}` : ''}`
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
