/** M3 published interface — consumed by the UI and by M5 (audit review). */
export { buildStatements } from './statements'
export type {
  Sch3Statements,
  Sch3LineResult,
  NoteLedger,
  UnmappedItem,
} from './statements'
export { runChecks, checkSummary } from './checks'
export type { CheckResult, CheckStatus } from './checks'
export { SCH3_LINES, classifyLedger } from './mapping'
export type { Sch3Line, Sch3Section, Sch3Side } from './mapping'
