/**
 * Zod schemas for the RAW Tally export tables (as produced by the TSF exporter:
 * mst_*.xlsx / trn_*.xlsx / config.xlsx). These validate the shape of each
 * parsed row at the ingestion boundary (P6). They are intentionally lenient on
 * types (cells arrive as string | number | undefined from SheetJS); normalization
 * into branded domain types happens in ingest/xlsxZip.ts.
 *
 * Only the columns the suite actually consumes are declared; unknown columns are
 * passed through (`.passthrough()`) so exporter additions never break ingestion.
 */
import { z } from 'zod'

/** A cell may be a string, number, boolean, or empty. */
const cell = z.union([z.string(), z.number(), z.boolean()]).nullish()

export const RawVoucher = z
  .object({
    guid: z.union([z.string(), z.number()]),
    date: cell,
    voucher_type: cell,
    voucher_number: cell,
    reference_number: cell,
    reference_date: cell,
    narration: cell,
    party_name: cell,
    place_of_supply: cell,
    is_invoice: cell,
    is_accounting_voucher: cell,
    is_inventory_voucher: cell,
    is_order_voucher: cell,
  })
  .passthrough()
export type RawVoucher = z.infer<typeof RawVoucher>

export const RawAccounting = z
  .object({
    guid: z.union([z.string(), z.number()]),
    ledger: cell,
    amount: cell,
    amount_forex: cell,
    currency: cell,
  })
  .passthrough()
export type RawAccounting = z.infer<typeof RawAccounting>

export const RawLedger = z
  .object({
    guid: cell,
    name: z.union([z.string(), z.number()]),
    parent: cell,
    alias: cell,
    opening_balance: cell,
    closing_balance: cell,
    is_revenue: cell,
    is_deemedpositive: cell,
    mailing_name: cell,
    mailing_address: cell,
    mailing_state: cell,
    mailing_country: cell,
    mailing_pincode: cell,
    email: cell,
    mobile: cell,
    it_pan: cell,
    gstn: cell,
    gst_registration_type: cell,
    bank_account_holder: cell,
    bank_account_number: cell,
    bank_ifsc: cell,
    bank_name: cell,
    bank_branch: cell,
    bill_credit_period: cell,
  })
  .passthrough()
export type RawLedger = z.infer<typeof RawLedger>

export const RawGroup = z
  .object({
    guid: cell,
    name: z.union([z.string(), z.number()]),
    parent: cell,
    primary_group: cell,
    is_revenue: cell,
    is_deemedpositive: cell,
    is_reserved: cell,
    affects_gross_profit: cell,
    sort_position: cell,
  })
  .passthrough()
export type RawGroup = z.infer<typeof RawGroup>

export const RawBill = z
  .object({
    // opening-bill-allocation rows are keyed by ledger, not a voucher guid
    guid: z.union([z.string(), z.number()]).nullish(),
    ledger: cell,
    name: cell,
    amount: cell,
    billtype: cell,
    bill_credit_period: cell,
  })
  .passthrough()
export type RawBill = z.infer<typeof RawBill>

export const RawBank = z
  .object({
    guid: z.union([z.string(), z.number()]),
    ledger: cell,
    transaction_type: cell,
    instrument_date: cell,
    instrument_number: cell,
    bank_name: cell,
    amount: cell,
    bankers_date: cell,
  })
  .passthrough()
export type RawBank = z.infer<typeof RawBank>

export const RawConfig = z
  .object({
    name: z.union([z.string(), z.number()]).nullish(),
    value: cell,
  })
  .passthrough()
export type RawConfig = z.infer<typeof RawConfig>

/** Map of table base-name → the zod row schema used to validate it. */
export const TABLE_SCHEMAS = {
  trn_voucher: RawVoucher,
  trn_accounting: RawAccounting,
  mst_ledger: RawLedger,
  mst_group: RawGroup,
  trn_bill: RawBill,
  mst_opening_bill_allocation: RawBill,
  trn_bank: RawBank,
  config: RawConfig,
} as const
