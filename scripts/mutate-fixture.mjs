/**
 * Build a "V2" snapshot from the real Scaffhire export by applying a small set of
 * scripted tampering scenarios. The mutations ARE the test: each one is something
 * M2 claims to catch. Logs exactly what it changed for demo narration.
 *
 *   node scripts/mutate-fixture.mjs
 *   → fixtures/real/scaffhire-v2.zip
 */
import { readFileSync, writeFileSync } from 'node:fs'
import JSZip from 'jszip'
import * as XLSX from 'xlsx'

const SRC = 'fixtures/real/scaffhire.zip'
const OUT = 'fixtures/real/scaffhire-v2.zip'

const zip = await JSZip.loadAsync(readFileSync(SRC))

async function readTable(name) {
  const f = zip.file(name)
  const wb = XLSX.read(await f.async('arraybuffer'), { type: 'array' })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  return { rows: XLSX.utils.sheet_to_json(sheet, { defval: null, raw: true }), sheetName: wb.SheetNames[0] }
}

function writeTable(name, rows, sheetName) {
  const ws = XLSX.utils.json_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheetName || 'Sheet1')
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
  zip.file(name, buf)
}

const v = await readTable('trn_voucher.xlsx')
const a = await readTable('trn_accounting.xlsx')
const cfg = await readTable('config.xlsx')

const log = []

// helper: find a voucher of a type that has exactly 2 accounting lines (clean pair)
function findVoucher(predicate) {
  for (const vch of v.rows) {
    if (!predicate(vch)) continue
    const lines = a.rows.filter((l) => l.guid === vch.guid)
    if (lines.length === 2) return { vch, lines }
  }
  return null
}

// 1) DELETE a payment voucher
const del = findVoucher((x) => /payment/i.test(x.voucher_type ?? ''))
if (del) {
  v.rows = v.rows.filter((x) => x.guid !== del.vch.guid)
  a.rows = a.rows.filter((l) => l.guid !== del.vch.guid)
  log.push(`DELETED Payment #${del.vch.voucher_number ?? del.vch.guid} (${del.vch.party_name ?? ''})`)
}

// 2) EDIT amount on a 2-leg voucher with non-trivial numeric amounts (stays balanced)
const edit = (() => {
  for (const vch of v.rows) {
    if (vch.guid === del?.vch.guid) continue
    const lines = a.rows.filter((l) => l.guid === vch.guid)
    if (lines.length !== 2) continue
    const mag = Math.abs(Number(lines[0].amount))
    if (Number.isFinite(mag) && mag >= 1000) return { vch, lines }
  }
  return null
})()
if (edit) {
  // shrink both legs to 10% (classic understatement), keeping the pair balanced
  const lines = a.rows.filter((l) => l.guid === edit.vch.guid)
  for (const l of lines) {
    const n = Number(l.amount)
    l.amount = Math.round(n * 0.1 * 100) / 100
  }
  log.push(
    `EDITED ${edit.vch.voucher_type} #${edit.vch.voucher_number ?? edit.vch.guid}: ${edit.lines[0].amount} → ${lines[0].amount}`,
  )
}

// 3) MOVE a voucher's date across a month boundary
const mover = v.rows.find(
  (x) => x.guid !== del?.vch.guid && x.guid !== edit?.vch.guid && typeof x.date === 'string' && x.date >= '2026-03-01',
)
if (mover) {
  const oldDate = mover.date
  mover.date = '2026-02-15' // back-dated into prior month
  log.push(`MOVED ${mover.voucher_type} #${mover.voucher_number ?? mover.guid}: ${oldDate} → ${mover.date}`)
}

// 4) INSERT two new back-dated vouchers (post-period)
const prefix = String(v.rows[0].guid).replace(/-[0-9a-f]+$/, '')
function insert(suffix, type, num, date, party, ledgerA, ledgerB, amount, narration) {
  const guid = `${prefix}-ffff${suffix}`
  v.rows.push({
    guid, date, voucher_type: type, voucher_number: num, reference_number: null,
    reference_date: null, narration, party_name: party, place_of_supply: null,
    is_invoice: '0', is_accounting_voucher: '1', is_inventory_voucher: '0', is_order_voucher: '0',
  })
  a.rows.push({ guid, ledger: ledgerA, amount: -amount, amount_forex: null, currency: null })
  a.rows.push({ guid, ledger: ledgerB, amount: amount, amount_forex: null, currency: null })
  log.push(`INSERTED ${type} #${num}: ${ledgerA} → ${ledgerB} ₹${amount}`)
}
// reuse two existing ledger names so they roll into known groups
const someExpense = a.rows.find((l) => /expense|exp\b/i.test(String(l.ledger ?? '')))?.ledger ?? 'Cash'
insert('0001', 'Payment', 'NEW-001', '2026-04-10', 'Backdated Vendor', 'Cash', someExpense, 500000, 'Post year-end cash expense')
insert('0002', 'Journal', 'NEW-002', '2026-03-31', null, someExpense, 'Cash', 1000000, 'Round-figure provision')

// 5) bump the transaction AlterID watermark
for (const r of cfg.rows) {
  if (r.name === 'Last AlterID nTransaction' && r.value != null) {
    r.value = Number(r.value) + 7
  }
}

writeTable('trn_voucher.xlsx', v.rows, v.sheetName)
writeTable('trn_accounting.xlsx', a.rows, a.sheetName)
writeTable('config.xlsx', cfg.rows, cfg.sheetName)

const out = await zip.generateAsync({ type: 'nodebuffer' })
writeFileSync(OUT, out)

console.log('Wrote', OUT)
console.log('Mutations:')
for (const l of log) console.log('  •', l)
