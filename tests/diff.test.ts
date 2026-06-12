import { readFileSync, existsSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { parseTallyZip } from '../src/core/ingest/xlsxZip'
import { diffVersions } from '../src/core/m2-versiondiff/diff'
import { formatINR } from '../src/core/model/money'

const V1 = 'fixtures/real/scaffhire.zip'
const V2 = 'fixtures/real/scaffhire-v2.zip'
const maybe = existsSync(V1) && existsSync(V2) ? describe : describe.skip

maybe('M2 differential trial balance (scaffhire v1 vs v2)', () => {
  it('detects the scripted mutations and balances to zero', async () => {
    const a = await parseTallyZip(new Uint8Array(readFileSync(V1)), { sourceFile: 'v1.zip', contentHash: 'a' })
    const b = await parseTallyZip(new Uint8Array(readFileSync(V2)), { sourceFile: 'v2.zip', contentHash: 'b' })
    const d = diffVersions(a.dataset, b.dataset)

    console.log('counts:', JSON.stringify(d.counts))
    console.log('sumDelta:', formatINR(d.sumDelta), 'balanced:', d.balanced)
    console.log('changed ledgers:', d.changedRows.length)
    console.log('guard.sameCompany:', d.guard.sameCompany, 'alterIdMoved:', d.guard.alterIdTxnMoved)
    for (const c of d.voucherChanges) {
      console.log(`  ${c.kind} ${c.v2?.voucherType ?? c.v1?.voucherType} risks=[${c.risks.join(',')}]`)
    }

    expect(d.guard.sameCompany).toBe(true)
    expect(d.guard.alterIdTxnMoved).toBe(true)
    expect(d.counts.deleted).toBe(1)
    expect(d.counts.added).toBe(2)
    expect(d.counts.modified).toBeGreaterThanOrEqual(2) // edited journal + moved date
    expect(d.balanced).toBe(true) // ΣΔ must be exactly zero
    expect(d.sumDelta).toBe(0)
    // at least one risk flag fired
    expect(d.voucherChanges.some((c) => c.risks.length > 0)).toBe(true)
  })
})
