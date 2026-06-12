/**
 * NormalizedDataset — the single shape every module consumes (SPEC §3.2).
 *
 * Branded primitive types (Guid, LedgerKey) prevent mixing a raw string where a
 * normalized key is expected. All amounts are Paise. This module declares types
 * only — construction lives in ingest/.
 */
import type { Paise } from './money'

declare const GuidBrand: unique symbol
/** A Tally voucher GUID, e.g. "23a0a0e3-…-00009023". */
export type Guid = string & { readonly [GuidBrand]: true }

declare const LedgerKeyBrand: unique symbol
/** Case-folded, whitespace-collapsed ledger name used as a join key. */
export type LedgerKey = string & { readonly [LedgerKeyBrand]: true }

export type ISODate = string // 'YYYY-MM-DD'

/** Tally exports amounts with a sign; we record which polarity = Debit. */
export type SignConvention = 'negative-is-debit' | 'positive-is-debit'

export interface DatasetMeta {
  company: string
  periodFrom: ISODate | null
  periodTo: ISODate | null
  generatedAt: string | null
  lastAlterIdMaster: number | null
  lastAlterIdTransaction: number | null
  sourceFile: string
  contentHash: string // sha-256 hex of source bytes
  signConvention: SignConvention
  /** GUID prefix shared by all vouchers (company identity). */
  companyGuidPrefix: string | null
}

export interface LedgerMaster {
  key: LedgerKey
  name: string
  parent: string // group name (raw, as in mst_ledger.parent)
  parentKey: LedgerKey
  alias: string | null
  opening: Paise
  closing: Paise
  isRevenue: boolean | null
  isDeemedPositive: boolean | null
  pan: string | null
  gstin: string | null
  gstRegistrationType: string | null
  mailingName: string | null
  mailingAddress: string | null
  mailingState: string | null
  email: string | null
  mobile: string | null
  bankAccountNumber: string | null
  bankIfsc: string | null
  billCreditPeriod: string | null
}

export interface GroupMaster {
  key: LedgerKey
  name: string
  parent: string | null
  parentKey: LedgerKey | null
  primaryGroup: string | null
  isRevenue: boolean | null
  isDeemedPositive: boolean | null
  affectsGrossProfit: boolean | null
  sortPosition: number | null
}

export interface VoucherHeader {
  guid: Guid
  date: ISODate | null
  voucherType: string
  voucherNumber: string | null
  referenceNumber: string | null
  referenceDate: ISODate | null
  narration: string | null
  partyName: string | null
  placeOfSupply: string | null
  isInvoice: boolean
  isInventory: boolean
  /** Stable content hash of (header fields + canonical lines) for fast diff. */
  contentHash: string
}

export interface AccountingLine {
  guid: Guid // FK → VoucherHeader.guid
  ledger: string
  ledgerKey: LedgerKey
  /** Amount in paise, sign exactly as exported by Tally. */
  amount: Paise
  currency: string | null
}

export interface BillAllocation {
  guid: Guid
  ledger: string
  ledgerKey: LedgerKey
  billName: string | null
  amount: Paise
  billType: string | null
  creditPeriod: string | null
}

export interface BankLine {
  guid: Guid
  ledger: string
  transactionType: string | null
  instrumentDate: ISODate | null
  instrumentNumber: string | null
  bankName: string | null
  amount: Paise
  bankersDate: ISODate | null
}

export interface NormalizedDataset {
  meta: DatasetMeta
  ledgers: LedgerMaster[]
  ledgerByKey: Map<LedgerKey, LedgerMaster>
  groups: GroupMaster[]
  groupByKey: Map<LedgerKey, GroupMaster>
  vouchers: VoucherHeader[]
  voucherByGuid: Map<Guid, VoucherHeader>
  lines: AccountingLine[]
  /** Accounting lines indexed by voucher guid (preserves input order). */
  linesByGuid: Map<Guid, AccountingLine[]>
  bills: BillAllocation[]
  openingBills: BillAllocation[]
  bank: BankLine[]
}

/** Normalize a ledger/group name into its join key. */
export function ledgerKey(name: string): LedgerKey {
  return name.trim().replace(/\s+/g, ' ').toLowerCase() as LedgerKey
}

export function asGuid(s: string): Guid {
  return s as Guid
}
