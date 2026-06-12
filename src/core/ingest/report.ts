/**
 * IngestionReport — the loud-failure surface (P6). Ingestion never throws on bad
 * data; it records precise problems here so the UI can show exactly which row of
 * which table failed, while still surfacing a usable dataset where possible.
 */
import type { SignConvention } from '../model/dataset'

export type IssueLevel = 'error' | 'warn' | 'info'

export interface IngestIssue {
  level: IssueLevel
  table: string
  /** 1-based row number in the source sheet, when applicable. */
  row?: number
  message: string
}

export interface TableStat {
  table: string
  rows: number
  errors: number
  present: boolean
}

export interface SignSelfTest {
  convention: SignConvention
  sampled: number
  matched: number
  /** True when the chosen convention reproduces mst_ledger closing balances. */
  confident: boolean
}

export interface IngestionReport {
  sourceFile: string
  issues: IngestIssue[]
  tables: TableStat[]
  signSelfTest: SignSelfTest | null
  /** Voucher Σ=0 invariant: vouchers whose accounting lines don't net to zero. */
  unbalancedVouchers: { guid: string; residualPaise: number }[]
  orphanLines: number // accounting lines whose guid has no voucher header
  unknownLedgerRefs: number // lines/bills referencing a ledger not in mst_ledger
  durationMs: number
}

export function emptyReport(sourceFile: string): IngestionReport {
  return {
    sourceFile,
    issues: [],
    tables: [],
    signSelfTest: null,
    unbalancedVouchers: [],
    orphanLines: 0,
    unknownLedgerRefs: 0,
    durationMs: 0,
  }
}

export function hasBlockingErrors(r: IngestionReport): boolean {
  return r.issues.some((i) => i.level === 'error')
}
