/**
 * io/excel — audit-ready workbook export (exceljs). Dynamically imported so the
 * heavy exceljs dependency is code-split out of the initial bundle and only
 * loaded when the user actually exports.
 */
import type { Paise } from '../core/model/money'
import type { Sch3Statements, Sch3LineResult, CheckResult } from '../core/m3-sch3'

const INR_FMT = '##,##,##0.00;(##,##,##0.00)'

function toRupees(p: Paise): number {
  return p / 100
}

async function newWorkbook() {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.creator = 'TallySuite'
  return wb
}

async function download(wb: Awaited<ReturnType<typeof newWorkbook>>, filename: string) {
  const buf = await wb.xlsx.writeBuffer()
  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/** Generic multi-sheet table export (used by M2 diff, M4 YoY, M1, etc.). */
export interface SheetSpec {
  name: string
  columns: { header: string; key: string; width?: number; money?: boolean }[]
  rows: Record<string, string | number | null>[]
}

export async function exportTables(sheets: SheetSpec[], filename: string): Promise<void> {
  const wb = await newWorkbook()
  for (const spec of sheets) {
    const ws = wb.addWorksheet(spec.name.slice(0, 31))
    ws.columns = spec.columns.map((c) => ({ header: c.header, key: c.key, width: c.width ?? 18 }))
    ws.getRow(1).font = { bold: true }
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2433' } }
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
    for (const r of spec.rows) ws.addRow(r)
    for (const c of spec.columns) {
      if (c.money) ws.getColumn(c.key).numFmt = INR_FMT
    }
    ws.views = [{ state: 'frozen', ySplit: 1 }]
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: spec.columns.length } }
  }
  await download(wb, filename)
}

/** Schedule III workbook: Balance Sheet, P&L, Validation, with per-branch cols. */
export async function exportSch3(
  s: Sch3Statements,
  checks: CheckResult[],
  filename = 'Schedule-III.xlsx',
): Promise<void> {
  const wb = await newWorkbook()
  const multi = s.branches.length > 1
  const cols = ['Particulars', 'Note', ...(multi ? s.branches : []), 'Consolidated']

  const sheetFromLines = (
    title: string,
    blocks: { heading: string; lines: Sch3LineResult[]; total?: { label: string; perBranch: Paise[]; consolidated: Paise } }[],
  ) => {
    const ws = wb.addWorksheet(title)
    ws.addRow([s.branches.join(' + ')]).font = { bold: true, size: 13 }
    ws.addRow([`Period: ${s.period.from} to ${s.period.to}`]).font = { italic: true, color: { argb: 'FF888888' } }
    ws.addRow([])
    const header = ws.addRow(cols)
    header.font = { bold: true }
    header.eachCell((c) => {
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2433' } }
      c.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    })
    for (const block of blocks) {
      ws.addRow([block.heading]).font = { bold: true, italic: true }
      for (const r of block.lines) {
        if (r.consolidated === 0 && r.perBranch.every((v) => v === 0)) continue
        const row: (string | number)[] = [r.line.label, r.line.note]
        if (multi) for (const v of r.perBranch) row.push(toRupees(v))
        row.push(toRupees(r.consolidated))
        ws.addRow(row)
      }
      if (block.total) {
        const trow: (string | number)[] = [block.total.label, '']
        if (multi) for (const v of block.total.perBranch) trow.push(toRupees(v))
        trow.push(toRupees(block.total.consolidated))
        const added = ws.addRow(trow)
        added.font = { bold: true }
        added.eachCell((c) => (c.border = { top: { style: 'thin' }, bottom: { style: 'double' } }))
      }
    }
    // money formats on numeric columns
    const firstMoneyCol = 3
    for (let i = firstMoneyCol; i <= cols.length; i++) ws.getColumn(i).numFmt = INR_FMT
    ws.getColumn(1).width = 42
    ws.getColumn(2).width = 6
    for (let i = firstMoneyCol; i <= cols.length; i++) ws.getColumn(i).width = 20
    ws.views = [{ state: 'frozen', ySplit: 4 }]
    return ws
  }

  sheetFromLines('Balance Sheet', [
    {
      heading: 'I. EQUITY AND LIABILITIES',
      lines: s.bsEquityLiability,
      total: { label: 'Total Equity & Liabilities', perBranch: s.totals.equityLiability.perBranch, consolidated: s.totals.equityLiability.consolidated },
    },
    {
      heading: 'II. ASSETS',
      lines: s.bsAssets,
      total: { label: 'Total Assets', perBranch: s.totals.assets.perBranch, consolidated: s.totals.assets.consolidated },
    },
  ])

  sheetFromLines('Profit and Loss', [
    { heading: 'INCOME', lines: s.plIncome, total: { label: 'Total Income', perBranch: s.totals.totalIncome.perBranch, consolidated: s.totals.totalIncome.consolidated } },
    { heading: 'EXPENSES', lines: s.plExpense, total: { label: 'Total Expenses', perBranch: s.totals.totalExpense.perBranch, consolidated: s.totals.totalExpense.consolidated } },
  ])
  // profit line on P&L sheet
  const plWs = wb.getWorksheet('Profit and Loss')!
  const prow: (string | number)[] = ['Profit/(Loss) for the year', '']
  if (multi) for (const v of s.profitForYear.perBranch) prow.push(toRupees(v))
  prow.push(toRupees(s.profitForYear.consolidated))
  const added = plWs.addRow(prow)
  added.font = { bold: true }

  // Validation sheet
  const vs = wb.addWorksheet('Validation')
  vs.columns = [
    { header: 'Category', key: 'cat', width: 16 },
    { header: 'Check', key: 'label', width: 48 },
    { header: 'Status', key: 'status', width: 10 },
    { header: 'Detail', key: 'detail', width: 60 },
  ]
  vs.getRow(1).font = { bold: true }
  for (const c of checks) {
    const row = vs.addRow({ cat: c.category, label: c.label, status: c.status.toUpperCase(), detail: c.detail })
    const color = c.status === 'pass' ? 'FF1E7E45' : c.status === 'warn' ? 'FF8A6D1A' : 'FF8A1E2B'
    row.getCell('status').font = { bold: true, color: { argb: color } }
  }
  vs.views = [{ state: 'frozen', ySplit: 1 }]

  await download(wb, filename)
}
