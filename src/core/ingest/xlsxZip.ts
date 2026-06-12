/**
 * parseTallyZip — Tally export ZIP bytes → NormalizedDataset + IngestionReport.
 *
 * Pure-ish transform: deterministic given the same bytes. File acquisition
 * (File → ArrayBuffer) and the cryptographic source hash live in io/ and are
 * passed in. This module owns parsing + normalization + integrity checks.
 */
import JSZip from 'jszip'
import * as XLSX from 'xlsx'
import { z } from 'zod'
import {
  TABLE_SCHEMAS,
  type RawBank,
  type RawBill,
  type RawConfig,
  type RawGroup,
  type RawLedger,
  type RawVoucher,
} from '../model/schema'
import {
  asGuid,
  ledgerKey,
  type AccountingLine,
  type BankLine,
  type BillAllocation,
  type DatasetMeta,
  type GroupMaster,
  type Guid,
  type ISODate,
  type LedgerKey,
  type LedgerMaster,
  type NormalizedDataset,
  type SignConvention,
  type VoucherHeader,
} from '../model/dataset'
import { fnv1a } from '../model/hash'
import { paise, rupeesToPaise, sum, ZERO, type Paise } from '../model/money'
import { emptyReport, type IngestionReport } from './report'

type Cell = string | number | boolean | null | undefined
type Row = Record<string, Cell>

export interface ParseOptions {
  sourceFile: string
  contentHash: string
}

export async function parseTallyZip(
  bytes: Uint8Array,
  opts: ParseOptions,
): Promise<{ dataset: NormalizedDataset; report: IngestionReport }> {
  const startedAt = performance.now()
  const report = emptyReport(opts.sourceFile)

  const zip = await JSZip.loadAsync(bytes)
  const rawTables = await readTables(zip)
  return finishParse(rawTables, opts, report, startedAt)
}

/**
 * Read all *.xlsx / *.csv entries into row arrays keyed by table base-name.
 * The TSF exporter emits either format depending on version; both are accepted.
 */
async function readTables(zip: JSZip): Promise<Map<string, Row[]>> {
  const tables = new Map<string, Row[]>()
  const entries = Object.values(zip.files).filter(
    (f) => !f.dir && /\.(xlsx|csv)$/i.test(f.name),
  )
  for (const entry of entries) {
    const isCsv = /\.csv$/i.test(entry.name)
    const base = entry.name
      .split('/')
      .pop()!
      .replace(/\.(xlsx|csv)$/i, '')
    const wb = isCsv
      ? // strip a leading UTF-8 BOM so the first header (guid) isn't mangled
        XLSX.read((await entry.async('string')).replace(/^﻿/, ''), { type: 'string', raw: true })
      : XLSX.read(await entry.async('arraybuffer'), { type: 'array' })
    const sheetName = wb.SheetNames[0]
    if (!sheetName) {
      tables.set(base, [])
      continue
    }
    const sheet = wb.Sheets[sheetName]!
    const rows = XLSX.utils.sheet_to_json<Row>(sheet, { defval: null, raw: true })
    tables.set(base, rows)
  }
  return tables
}

/** Shared tail used by both zip and (future) sqlite ingestion paths. */
export function finishParse(
  rawTables: Map<string, Row[]>,
  opts: ParseOptions,
  report: IngestionReport,
  startedAt: number,
): { dataset: NormalizedDataset; report: IngestionReport } {
  // --- validate + collect each table ---
  const voucherRows = validateTable('trn_voucher', rawTables, TABLE_SCHEMAS.trn_voucher, report)
  const acctRows = validateTable('trn_accounting', rawTables, TABLE_SCHEMAS.trn_accounting, report)
  const ledgerRows = validateTable('mst_ledger', rawTables, TABLE_SCHEMAS.mst_ledger, report)
  const groupRows = validateTable('mst_group', rawTables, TABLE_SCHEMAS.mst_group, report)
  const billRows = validateTable('trn_bill', rawTables, TABLE_SCHEMAS.trn_bill, report)
  const openBillRows = validateTable(
    'mst_opening_bill_allocation',
    rawTables,
    TABLE_SCHEMAS.mst_opening_bill_allocation,
    report,
  )
  const bankRows = validateTable('trn_bank', rawTables, TABLE_SCHEMAS.trn_bank, report)
  const configRows = validateTable('config', rawTables, TABLE_SCHEMAS.config, report)

  // --- masters ---
  const groups = groupRows.map(normalizeGroup)
  const groupByKey = new Map<LedgerKey, GroupMaster>()
  for (const g of groups) groupByKey.set(g.key, g)

  const ledgers = ledgerRows.map((r) => normalizeLedger(r, report))
  const ledgerByKey = new Map<LedgerKey, LedgerMaster>()
  for (const l of ledgers) ledgerByKey.set(l.key, l)

  // --- accounting lines (sign applied later if self-test flips) ---
  const lines: AccountingLine[] = []
  for (let i = 0; i < acctRows.length; i++) {
    const r = acctRows[i]!
    const guid = asGuid(String(r.guid))
    const led = str(r.ledger) ?? ''
    let amt: Paise
    try {
      amt = rupeesToPaise(r.amount) ?? ZERO
    } catch {
      report.issues.push({
        level: 'error',
        table: 'trn_accounting',
        row: i + 2,
        message: `amount unparseable: ${JSON.stringify(r.amount)}`,
      })
      amt = ZERO
    }
    lines.push({
      guid,
      ledger: led,
      ledgerKey: ledgerKey(led),
      amount: amt,
      currency: str(r.currency),
    })
  }

  // --- voucher headers (+ content hash) ---
  const linesByGuid = new Map<Guid, AccountingLine[]>()
  for (const ln of lines) {
    const arr = linesByGuid.get(ln.guid)
    if (arr) arr.push(ln)
    else linesByGuid.set(ln.guid, [ln])
  }

  const vouchers: VoucherHeader[] = voucherRows.map((r) => {
    const guid = asGuid(String(r.guid))
    const header = normalizeVoucher(r, guid)
    header.contentHash = voucherContentHash(header, linesByGuid.get(guid) ?? [])
    return header
  })
  const voucherByGuid = new Map<Guid, VoucherHeader>()
  for (const v of vouchers) voucherByGuid.set(v.guid, v)

  // --- bills ---
  const bills = billRows.map((r) => normalizeBill(r))
  const openingBills = openBillRows.map((r) => normalizeBill(r))
  const bank = bankRows.map((r) => normalizeBank(r))

  // --- meta from config.xlsx ---
  const cfg = configMap(configRows)
  const companyGuidPrefix = deriveCompanyPrefix(vouchers)
  const signConvention = signSelfTest(ledgers, lines, linesByGuid, voucherByGuid, report)

  const meta: DatasetMeta = {
    company: cfg.get('Company Name') ?? opts.sourceFile.replace(/\.zip$/i, ''),
    periodFrom: asDate(cfg.get('Period From')),
    periodTo: asDate(cfg.get('Period To')),
    generatedAt: cfg.get('Update Timestamp') ?? null,
    lastAlterIdMaster: numOrNull(cfg.get('Last AlterID nMaster')),
    lastAlterIdTransaction: numOrNull(cfg.get('Last AlterID nTransaction')),
    sourceFile: opts.sourceFile,
    contentHash: opts.contentHash,
    signConvention,
    companyGuidPrefix,
  }

  // --- integrity checks ---
  runIntegrityChecks(lines, voucherByGuid, linesByGuid, ledgerByKey, report)

  const dataset: NormalizedDataset = {
    meta,
    ledgers,
    ledgerByKey,
    groups,
    groupByKey,
    vouchers,
    voucherByGuid,
    lines,
    linesByGuid,
    bills,
    openingBills,
    bank,
  }
  report.durationMs = Math.round(performance.now() - startedAt)
  return { dataset, report }
}

// ----------------------------------------------------------------------------
// validation + normalization helpers
// ----------------------------------------------------------------------------

function validateTable<T>(
  name: string,
  tables: Map<string, Row[]>,
  schema: z.ZodType<T>,
  report: IngestionReport,
): T[] {
  const rows = tables.get(name)
  const present = rows !== undefined
  const out: T[] = []
  let errors = 0
  if (rows) {
    for (let i = 0; i < rows.length; i++) {
      const parsed = schema.safeParse(rows[i])
      if (parsed.success) out.push(parsed.data)
      else {
        errors++
        if (errors <= 5) {
          report.issues.push({
            level: 'error',
            table: name,
            row: i + 2,
            message: parsed.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join('; '),
          })
        }
      }
    }
    if (errors > 5) {
      report.issues.push({
        level: 'error',
        table: name,
        message: `${errors} rows failed validation (showing first 5)`,
      })
    }
  }
  report.tables.push({ table: name, rows: out.length, errors, present })
  return out
}

function normalizeGroup(r: RawGroup): GroupMaster {
  const name = str(r.name) ?? ''
  const parent = str(r.parent)
  return {
    key: ledgerKey(name),
    name,
    parent,
    parentKey: parent ? ledgerKey(parent) : null,
    primaryGroup: str(r.primary_group),
    isRevenue: bool(r.is_revenue),
    isDeemedPositive: bool(r.is_deemedpositive),
    affectsGrossProfit: bool(r.affects_gross_profit),
    sortPosition: numOrNull(r.sort_position),
  }
}

function normalizeLedger(r: RawLedger, report: IngestionReport): LedgerMaster {
  const name = str(r.name) ?? ''
  const parent = str(r.parent) ?? ''
  return {
    key: ledgerKey(name),
    name,
    parent,
    parentKey: ledgerKey(parent),
    alias: str(r.alias),
    opening: safeMoney(r.opening_balance, 'mst_ledger', name, report),
    closing: safeMoney(r.closing_balance, 'mst_ledger', name, report),
    isRevenue: bool(r.is_revenue),
    isDeemedPositive: bool(r.is_deemedpositive),
    pan: str(r.it_pan),
    gstin: str(r.gstn),
    gstRegistrationType: str(r.gst_registration_type),
    mailingName: str(r.mailing_name),
    mailingAddress: str(r.mailing_address),
    mailingState: str(r.mailing_state),
    email: str(r.email),
    mobile: str(r.mobile),
    bankAccountNumber: str(r.bank_account_number),
    bankIfsc: str(r.bank_ifsc),
    billCreditPeriod: str(r.bill_credit_period),
  }
}

function normalizeVoucher(r: RawVoucher, guid: Guid): VoucherHeader {
  return {
    guid,
    date: asDate(str(r.date)),
    voucherType: str(r.voucher_type) ?? '',
    voucherNumber: str(r.voucher_number),
    referenceNumber: str(r.reference_number),
    referenceDate: asDate(str(r.reference_date)),
    narration: str(r.narration),
    partyName: str(r.party_name),
    placeOfSupply: str(r.place_of_supply),
    isInvoice: bool(r.is_invoice) ?? false,
    isInventory: bool(r.is_inventory_voucher) ?? false,
    contentHash: '',
  }
}

function normalizeBill(r: RawBill): BillAllocation {
  const led = str(r.ledger) ?? ''
  return {
    guid: asGuid(r.guid == null ? '' : String(r.guid)),
    ledger: led,
    ledgerKey: ledgerKey(led),
    billName: str(r.name),
    amount: rupeesToPaise(r.amount) ?? ZERO,
    billType: str(r.billtype),
    creditPeriod: str(r.bill_credit_period),
  }
}

function normalizeBank(r: RawBank): BankLine {
  return {
    guid: asGuid(String(r.guid)),
    ledger: str(r.ledger) ?? '',
    transactionType: str(r.transaction_type),
    instrumentDate: asDate(str(r.instrument_date)),
    instrumentNumber: str(r.instrument_number),
    bankName: str(r.bank_name),
    amount: rupeesToPaise(r.amount) ?? ZERO,
    bankersDate: asDate(str(r.bankers_date)),
  }
}

/** Canonical voucher fingerprint: header fields + sorted line multiset. */
export function voucherContentHash(h: VoucherHeader, lines: AccountingLine[]): string {
  const canonLines = [...lines]
    .map((l) => `${l.ledgerKey}|${l.amount}`)
    .sort()
    .join(';')
  const headerSig = [
    h.date,
    h.voucherType,
    h.voucherNumber,
    h.referenceNumber,
    h.narration,
    h.partyName,
  ].join('|')
  return fnv1a(`${headerSig}#${canonLines}`)
}

/**
 * Sign self-test (SPEC §3.3): assume negative=Debit, reconstruct closing for
 * sampled ledgers (opening + Σ lines) and compare to mst_ledger.closing_balance.
 * If the inverted assumption fits markedly better, flip dataset-wide.
 */
function signSelfTest(
  ledgers: LedgerMaster[],
  _lines: AccountingLine[],
  _linesByGuid: Map<Guid, AccountingLine[]>,
  _voucherByGuid: Map<Guid, VoucherHeader>,
  report: IngestionReport,
): SignConvention {
  // movement per ledger = Σ line amounts (as exported)
  const movement = new Map<LedgerKey, Paise>()
  for (const ln of _lines) {
    movement.set(ln.ledgerKey, ((movement.get(ln.ledgerKey) ?? 0) + ln.amount) as Paise)
  }
  const sample = ledgers
    .filter((l) => l.closing !== 0 || movement.get(l.key))
    .slice(0, 50)
  let direct = 0
  let inverted = 0
  let checked = 0
  for (const l of sample) {
    const mv = movement.get(l.key) ?? ZERO
    checked++
    // direct: closing = opening + movement ; inverted: closing = opening - movement
    if (Math.abs(l.opening + mv - l.closing) <= 1) direct++
    if (Math.abs(l.opening - mv - l.closing) <= 1) inverted++
  }
  const convention: SignConvention = inverted > direct ? 'positive-is-debit' : 'negative-is-debit'
  report.signSelfTest = {
    convention,
    sampled: checked,
    matched: Math.max(direct, inverted),
    confident: checked > 0 && Math.max(direct, inverted) / checked >= 0.6,
  }
  if (report.signSelfTest && !report.signSelfTest.confident) {
    report.issues.push({
      level: 'warn',
      table: 'trn_accounting',
      message: `Sign self-test inconclusive (${report.signSelfTest.matched}/${checked} ledgers reconcile). Defaulting to ${convention}.`,
    })
  }
  return convention
}

function runIntegrityChecks(
  lines: AccountingLine[],
  voucherByGuid: Map<Guid, VoucherHeader>,
  linesByGuid: Map<Guid, AccountingLine[]>,
  ledgerByKey: Map<LedgerKey, LedgerMaster>,
  report: IngestionReport,
): void {
  // orphan lines
  let orphan = 0
  for (const ln of lines) if (!voucherByGuid.has(ln.guid)) orphan++
  report.orphanLines = orphan

  // unknown ledger refs
  let unknown = 0
  for (const ln of lines) if (!ledgerByKey.has(ln.ledgerKey)) unknown++
  report.unknownLedgerRefs = unknown

  // voucher Σ = 0
  for (const [guid, ls] of linesByGuid) {
    const residual = sum(ls.map((l) => l.amount))
    if (residual !== 0) {
      report.unbalancedVouchers.push({ guid, residualPaise: residual })
    }
  }
  if (report.unbalancedVouchers.length > 0) {
    report.issues.push({
      level: 'warn',
      table: 'trn_accounting',
      message: `${report.unbalancedVouchers.length} voucher(s) do not net to zero.`,
    })
  }
}

// ----------------------------------------------------------------------------
// cell coercion
// ----------------------------------------------------------------------------

function str(c: Cell): string | null {
  if (c === null || c === undefined) return null
  const s = String(c).trim()
  return s === '' ? null : s
}

function bool(c: Cell): boolean | null {
  if (c === null || c === undefined || c === '') return null
  if (typeof c === 'boolean') return c
  const s = String(c).trim().toLowerCase()
  if (s === '1' || s === 'true' || s === 'yes') return true
  if (s === '0' || s === 'false' || s === 'no') return false
  return null
}

function numOrNull(c: Cell): number | null {
  if (c === null || c === undefined || c === '') return null
  const n = Number(String(c).replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

function safeMoney(c: Cell, table: string, ctx: string, report: IngestionReport): Paise {
  try {
    return rupeesToPaise(c) ?? ZERO
  } catch {
    report.issues.push({
      level: 'warn',
      table,
      message: `unparseable balance for "${ctx}": ${JSON.stringify(c)}`,
    })
    return ZERO
  }
}

function asDate(c: Cell): ISODate | null {
  const s = str(c)
  if (!s) return null
  // already ISO
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  // Excel serial number
  const n = Number(s)
  if (Number.isFinite(n) && n > 59 && n < 90000) {
    const d = XLSX.SSF ? null : null
    void d
    const ms = Math.round((n - 25569) * 86400 * 1000)
    return new Date(ms).toISOString().slice(0, 10)
  }
  // DD-MMM-YYYY or DD/MM/YYYY best-effort
  const m = s.match(/^(\d{1,2})[-/](\w{3,})[-/](\d{4})$/)
  if (m) {
    const months: Record<string, string> = {
      jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
      jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
    }
    const mm = months[m[2]!.slice(0, 3).toLowerCase()]
    if (mm) return `${m[3]}-${mm}-${m[1]!.padStart(2, '0')}`
  }
  return s
}

function configMap(rows: RawConfig[]): Map<string, string> {
  const m = new Map<string, string>()
  for (const r of rows) {
    const k = str(r.name as Cell)
    const v = str(r.value as Cell)
    if (k) m.set(k, v ?? '')
  }
  return m
}

function deriveCompanyPrefix(vouchers: VoucherHeader[]): string | null {
  const first = vouchers[0]?.guid
  if (!first) return null
  // GUID form: "<32hex with dashes>-<8hex>"; company id = part before final dash group
  const idx = first.lastIndexOf('-')
  return idx > 0 ? first.slice(0, idx) : first
}

void paise // keep import for downstream typed constructors
