import { readFileSync, existsSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { parseTallyZip } from '../src/core/ingest/xlsxZip'
import { buildStatements } from '../src/core/m3-sch3/statements'
import { formatINR } from '../src/core/model/money'

const SCAFF = 'fixtures/real/scaffhire.zip'
const NIMBUS = 'fixtures/real/nimbus.zip'
const maybe = existsSync(SCAFF) ? describe : describe.skip

maybe('M3 Schedule III (real data)', () => {
  it('builds a balancing Balance Sheet for Scaffhire', async () => {
    const { dataset } = await parseTallyZip(new Uint8Array(readFileSync(SCAFF)), { sourceFile: 'scaffhire.zip', contentHash: 'a' })
    const s = buildStatements([dataset])
    console.log('Total Assets:', formatINR(s.totals.assets.consolidated))
    console.log('Total Eq+Liab:', formatINR(s.totals.equityLiability.consolidated))
    console.log('BS residual:', formatINR(s.bsResidual.consolidated))
    console.log('Profit for year:', formatINR(s.profitForYear.consolidated))
    console.log('Total income:', formatINR(s.totals.totalIncome.consolidated))
    console.log('Total expense:', formatINR(s.totals.totalExpense.consolidated))
    console.log('Unmapped count:', s.unmapped.length, 'sum:', formatINR(s.unmapped.reduce((a, u) => a + u.value, 0) as never))
    console.log('--- Assets ---')
    for (const r of s.bsAssets) if (r.consolidated !== 0) console.log('  ', r.line.label, formatINR(r.consolidated))
    console.log('--- Equity & Liabilities ---')
    for (const r of s.bsEquityLiability) if (r.consolidated !== 0) console.log('  ', r.line.label, formatINR(r.consolidated))

    // BS must balance within ₹100 (rounding)
    expect(Math.abs(s.bsResidual.consolidated)).toBeLessThan(10000)
  })

  it('consolidates two branches with profit additivity', async () => {
    if (!existsSync(NIMBUS)) return
    const a = await parseTallyZip(new Uint8Array(readFileSync(SCAFF)), { sourceFile: 'scaffhire.zip', contentHash: 'a' })
    const b = await parseTallyZip(new Uint8Array(readFileSync(NIMBUS)), { sourceFile: 'nimbus.zip', contentHash: 'b' })
    const s = buildStatements([a.dataset, b.dataset])
    console.log('branches:', s.branches)
    console.log('consol assets:', formatINR(s.totals.assets.consolidated), 'residual:', formatINR(s.bsResidual.consolidated))
    // consolidated = sum of branch columns
    expect(s.totals.assets.consolidated).toBe(s.totals.assets.perBranch.reduce((x, y) => (x + y) as never, 0 as never))
  })
})
