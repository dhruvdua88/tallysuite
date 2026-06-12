/**
 * Data-smell scan — the 60-second "give me any Tally export" dashboard (pure).
 * Surfaces the day-one hygiene problems every inherited Tally company has:
 * missing PAN/GSTIN, blank narrations, duplicate references, cash 40A(3) breaches,
 * round-sum journals. Each finding carries a count, a severity and sample rows.
 */
import type { Guid, NormalizedDataset } from '../model/dataset'
import { formatINR, type Paise } from '../model/money'

export type Severity = 'high' | 'medium' | 'low'

export interface SmellSample {
  ref: string
  detail: string
  guid?: Guid
}

export interface SmellFinding {
  id: string
  title: string
  severity: Severity
  count: number
  /** Optional rupee exposure where meaningful. */
  amount?: Paise
  blurb: string
  samples: SmellSample[]
}

export interface SmellReport {
  company: string
  voucherCount: number
  ledgerCount: number
  byVoucherType: { type: string; count: number }[]
  findings: SmellFinding[]
}

const CASH_THRESHOLD = 1000000 // ₹10,000 in paise (40A(3))

export function scanSmells(ds: NormalizedDataset): SmellReport {
  const findings: SmellFinding[] = []

  // --- voucher type distribution ---
  const typeCounts = new Map<string, number>()
  for (const v of ds.vouchers) typeCounts.set(v.voucherType, (typeCounts.get(v.voucherType) ?? 0) + 1)
  const byVoucherType = [...typeCounts.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count)

  // --- blank narration ---
  const blank = ds.vouchers.filter((v) => !v.narration)
  if (blank.length) {
    findings.push({
      id: 'blank-narration',
      title: 'Vouchers with no narration',
      severity: pct(blank.length, ds.vouchers.length) > 25 ? 'medium' : 'low',
      count: blank.length,
      blurb: `${pct(blank.length, ds.vouchers.length)}% of vouchers carry no narration — weak audit trail under the MCA edit-log rule.`,
      samples: blank.slice(0, 6).map((v) => ({
        ref: `${v.voucherType} ${v.voucherNumber ?? ''}`.trim(),
        detail: `${v.date ?? ''} ${v.partyName ?? ''}`.trim(),
        guid: v.guid,
      })),
    })
  }

  // --- creditor/debtor masters missing PAN / GSTIN ---
  const parties = ds.ledgers.filter((l) => /creditor|debtor|payable|receivable/i.test(l.parent))
  const noPan = parties.filter((l) => !l.pan)
  const noGstin = parties.filter((l) => !l.gstin)
  if (noPan.length) {
    findings.push({
      id: 'missing-pan',
      title: 'Party ledgers missing PAN',
      severity: 'high',
      count: noPan.length,
      blurb: 'No PAN on file — 206AA risk of 20% TDS and 194Q/206C(1H) tracking gaps.',
      samples: noPan.slice(0, 6).map((l) => ({ ref: l.name, detail: l.parent })),
    })
  }
  if (noGstin.length) {
    findings.push({
      id: 'missing-gstin',
      title: 'Party ledgers missing GSTIN',
      severity: 'medium',
      count: noGstin.length,
      blurb: 'No GSTIN — ITC matching and RCM applicability cannot be confirmed for these parties.',
      samples: noGstin.slice(0, 6).map((l) => ({ ref: l.name, detail: l.parent })),
    })
  }

  // --- duplicate reference numbers on purchases ---
  const refMap = new Map<string, Guid[]>()
  for (const v of ds.vouchers) {
    if (!/purchase/i.test(v.voucherType) || !v.referenceNumber) continue
    const k = v.referenceNumber.trim().toLowerCase()
    const arr = refMap.get(k) ?? []
    arr.push(v.guid)
    refMap.set(k, arr)
  }
  const dupRefs = [...refMap.entries()].filter(([, g]) => g.length > 1)
  if (dupRefs.length) {
    findings.push({
      id: 'dup-purchase-ref',
      title: 'Duplicate purchase reference numbers',
      severity: 'high',
      count: dupRefs.length,
      blurb: 'Same supplier invoice number on multiple vouchers — possible double booking / duplicate ITC.',
      samples: dupRefs.slice(0, 6).map(([ref, g]) => ({ ref, detail: `${g.length} vouchers` })),
    })
  }

  // --- cash payments above ₹10,000 (40A(3)) ---
  const cashKeys = new Set(
    ds.ledgers.filter((l) => /cash/i.test(l.name) || /cash-in-hand/i.test(l.parent)).map((l) => l.key),
  )
  const cashBreaches: { v: Guid; type: string; num: string; amount: Paise; date: string }[] = []
  for (const v of ds.vouchers) {
    if (!/payment/i.test(v.voucherType)) continue
    const lines = ds.linesByGuid.get(v.guid) ?? []
    let cashOut = 0
    for (const l of lines) if (cashKeys.has(l.ledgerKey)) cashOut += Math.abs(l.amount)
    if (cashOut > CASH_THRESHOLD) {
      cashBreaches.push({
        v: v.guid,
        type: v.voucherType,
        num: v.voucherNumber ?? '',
        amount: cashOut as Paise,
        date: v.date ?? '',
      })
    }
  }
  if (cashBreaches.length) {
    cashBreaches.sort((a, b) => b.amount - a.amount)
    findings.push({
      id: 'cash-40a3',
      title: 'Cash payments above ₹10,000',
      severity: 'high',
      count: cashBreaches.length,
      amount: cashBreaches.reduce((s, c) => s + c.amount, 0) as Paise,
      blurb: 'Cash payments exceeding ₹10,000 in a voucher — potential disallowance under Sec 40A(3).',
      samples: cashBreaches.slice(0, 6).map((c) => ({
        ref: `${c.type} ${c.num}`.trim(),
        detail: `${c.date} · ${formatINR(c.amount)}`,
        guid: c.v,
      })),
    })
  }

  // --- round-figure journals (≥ ₹1L, exact lakh) ---
  const roundJournals: { v: Guid; num: string; amount: Paise }[] = []
  for (const v of ds.vouchers) {
    if (!/journal/i.test(v.voucherType)) continue
    const lines = ds.linesByGuid.get(v.guid) ?? []
    const gross = lines.reduce((s, l) => s + Math.abs(l.amount), 0) / 2
    if (gross >= 10000000 && gross % 10000000 === 0) {
      roundJournals.push({ v: v.guid, num: v.voucherNumber ?? '', amount: gross as Paise })
    }
  }
  if (roundJournals.length) {
    findings.push({
      id: 'round-journal',
      title: 'Round-figure journal entries',
      severity: 'low',
      count: roundJournals.length,
      blurb: 'Journals in exact lakhs — often provisions/estimates worth a second look.',
      samples: roundJournals.slice(0, 6).map((c) => ({
        ref: `Journal ${c.num}`.trim(),
        detail: formatINR(c.amount),
        guid: c.v,
      })),
    })
  }

  findings.sort((a, b) => sevRank(b.severity) - sevRank(a.severity) || b.count - a.count)

  return {
    company: ds.meta.company,
    voucherCount: ds.vouchers.length,
    ledgerCount: ds.ledgers.length,
    byVoucherType,
    findings,
  }
}

function pct(n: number, total: number): number {
  return total === 0 ? 0 : Math.round((n / total) * 100)
}

function sevRank(s: Severity): number {
  return s === 'high' ? 3 : s === 'medium' ? 2 : 1
}
