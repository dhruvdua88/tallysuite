import { readFileSync, existsSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { parseTallyZip } from '../src/core/ingest/xlsxZip'
import { buildTrialBalance } from '../src/core/tb/trialBalance'
import { formatINR } from '../src/core/model/money'

const SCAFF = 'fixtures/real/scaffhire.zip'
const NIMBUS = 'fixtures/real/nimbus.zip'

const hasReal = existsSync(SCAFF)
const maybe = hasReal ? describe : describe.skip

maybe('ingestion (real Scaffhire export)', () => {
  it('parses, runs sign self-test, builds a (near-)balanced TB', async () => {
    const bytes = new Uint8Array(readFileSync(SCAFF))
    const { dataset, report } = await parseTallyZip(bytes, {
      sourceFile: 'scaffhire.zip',
      contentHash: 'test',
    })
    console.log('company:', dataset.meta.company)
    console.log('period:', dataset.meta.periodFrom, '→', dataset.meta.periodTo)
    console.log('sign:', JSON.stringify(report.signSelfTest))
    console.log('vouchers:', dataset.vouchers.length, 'lines:', dataset.lines.length, 'ledgers:', dataset.ledgers.length)
    console.log('unbalanced vouchers:', report.unbalancedVouchers.length, 'orphan lines:', report.orphanLines)
    console.log('alterId txn:', dataset.meta.lastAlterIdTransaction, 'master:', dataset.meta.lastAlterIdMaster)
    console.log('company prefix:', dataset.meta.companyGuidPrefix)

    const tb = buildTrialBalance(dataset)
    console.log('TB rows:', tb.rows.length)
    console.log('TB total closing:', formatINR(tb.totalClosing), 'balanced:', tb.balanced)

    expect(dataset.vouchers.length).toBeGreaterThan(1000)
    expect(dataset.lines.length).toBeGreaterThan(5000)
    expect(report.signSelfTest).not.toBeNull()
  })

  it('diffs scaffhire vs nimbus (different companies → guard catches it)', async () => {
    if (!existsSync(NIMBUS)) return
    const { diffVersions } = await import('../src/core/m2-versiondiff/diff')
    const a = await parseTallyZip(new Uint8Array(readFileSync(SCAFF)), { sourceFile: 'scaffhire.zip', contentHash: 'a' })
    const b = await parseTallyZip(new Uint8Array(readFileSync(NIMBUS)), { sourceFile: 'nimbus.zip', contentHash: 'b' })
    const d = diffVersions(a.dataset, b.dataset)
    console.log('guard.sameCompany:', d.guard.sameCompany, '(expect false)')
    console.log('sumDelta:', d.sumDelta, 'balanced:', d.balanced)
    expect(d.guard.sameCompany).toBe(false)
  })
})
