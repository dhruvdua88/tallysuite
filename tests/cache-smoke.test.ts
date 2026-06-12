import { readFileSync, existsSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { parseTallyZip } from '../src/core/ingest/xlsxZip'
import { buildTrialBalance } from '../src/core/tb/trialBalance'
import { buildStatements, runChecks } from '../src/core/m3-sch3'
import { runReview, caroApplicability } from '../src/core/m5-review/rules'
import { buildConfirmations } from '../src/core/m1-confirmations/confirmations'
import { scanSmells } from '../src/core/dashboard/smell'
import { formatINR, paise } from '../src/core/model/money'

const FILES = [
  ['Cache Digitech', 'fixtures/real/cache-digitech.zip'],
  ['Cache Technologies', 'fixtures/real/cache-tech.zip'],
] as const

const maybe = FILES.every(([, p]) => existsSync(p)) ? describe : describe.skip

maybe('smoke — new Cache exports', () => {
  for (const [name, path] of FILES) {
    it(`${name}: ingests, signs, balances TB + Sch III`, async () => {
      const { dataset, report } = await parseTallyZip(new Uint8Array(readFileSync(path)), { sourceFile: path, contentHash: 't' })
      const tb = buildTrialBalance(dataset)
      const s = buildStatements([dataset])
      const checks = runChecks(s, [dataset])
      const review = runReview(s, [dataset])
      const caro = caroApplicability(s)
      const conf = buildConfirmations(dataset, { kinds: ['debtor', 'creditor'], materiality: paise(0) })
      const smell = scanSmells(dataset)

      console.log(`\n=== ${dataset.meta.company} ===`)
      console.log('period:', dataset.meta.periodFrom, '→', dataset.meta.periodTo)
      console.log('sign:', JSON.stringify(report.signSelfTest))
      console.log('vouchers:', dataset.vouchers.length, 'lines:', dataset.lines.length, 'ledgers:', dataset.ledgers.length)
      console.log('integrity — unbalanced:', report.unbalancedVouchers.length, 'orphan:', report.orphanLines, 'unknownLedger:', report.unknownLedgerRefs)
      console.log('issues:', report.issues.filter((i) => i.level === 'error').length, 'errors,', report.issues.length, 'total')
      console.log('TB total closing:', formatINR(tb.totalClosing), 'balanced:', tb.balanced)
      console.log('Sch III — Assets:', formatINR(s.totals.assets.consolidated), 'Eq+Liab:', formatINR(s.totals.equityLiability.consolidated), 'residual:', formatINR(s.bsResidual.consolidated))
      console.log('Profit:', formatINR(s.profitForYear.consolidated), 'unmapped:', s.unmapped.length)
      console.log('checks pass/warn/fail:', checks.filter((c) => c.status === 'pass').length, '/', checks.filter((c) => c.status === 'warn').length, '/', checks.filter((c) => c.status === 'fail').length)
      console.log('review findings:', review.length)
      console.log('CARO likelyExempt:', caro.likelyExempt)
      console.log('confirmations parties:', conf.length, '| billwise:', conf.filter((p) => p.billwiseAvailable).length, '| mismatches:', conf.filter((p) => p.billwiseAvailable && !p.reconciles).length)
      console.log('smell findings:', smell.findings.map((f) => `${f.id}(${f.count})`).join(', '))

      expect(dataset.vouchers.length).toBeGreaterThan(0)
      expect(report.signSelfTest?.confident).toBe(true)
      // every ledger maps to a Schedule III head
      expect(s.unmapped.length).toBe(0)
      // M3 introduces NO imbalance beyond the books' own TB difference:
      // the BS residual must equal the trial-balance closing difference (which is
      // the opening-balance gap in the client's own books — faithfully reported).
      expect(Math.abs(Math.abs(s.bsResidual.consolidated) - Math.abs(tb.totalClosing))).toBeLessThan(10000)
    })
  }

  it('consolidates the two Cache entities', async () => {
    const a = await parseTallyZip(new Uint8Array(readFileSync(FILES[0][1])), { sourceFile: 'a', contentHash: 'a' })
    const b = await parseTallyZip(new Uint8Array(readFileSync(FILES[1][1])), { sourceFile: 'b', contentHash: 'b' })
    const s = buildStatements([a.dataset, b.dataset])
    console.log('\n=== Consolidated ===')
    console.log('branches:', s.branches)
    console.log('periodsMatch:', s.periodsMatch)
    console.log('consol assets:', formatINR(s.totals.assets.consolidated), 'residual:', formatINR(s.bsResidual.consolidated))
    expect(s.unmapped.length).toBe(0)
    expect(s.branches.length).toBe(2)
  })
})
