/**
 * io/excel — audit-ready workbook export (exceljs). Dynamically imported so the
 * heavy exceljs dependency is code-split out of the initial bundle and only
 * loaded when the user actually exports.
 */
import type { Paise } from '../core/model/money'
import type { Sch3Statements, Sch3LineResult, CheckResult } from '../core/m3-sch3'

const INR_FMT = '##,##,##0.00;(##,##,##0.00)'

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

// ── Schedule III workbook — layout mirrors the tally-fin-statements desktop tool
// (Companies Act 2013, Div I): navy header bands, sectioned face, lettered items,
// Indian number grouping, note hyperlinks → N1..N14 note sheets, Notes Index,
// Validation. ────────────────────────────────────────────────────────────────

type AnyWorksheet = ReturnType<Awaited<ReturnType<typeof newWorkbook>>['addWorksheet']>

const C = {
  HEADER: 'FF1F3864',
  MID: 'FF2F5496',
  LIGHT: 'FFD6E4F0',
  TOTAL: 'FFD9E1F2',
  WHITE: 'FFFFFFFF',
  BLACK: 'FF000000',
  LINK: 'FF1D4ED8',
  DARK: 'FF1F3864',
} as const
// Indian digit grouping (lakh/crore): 1,23,45,678
const INR_IND = '[>=10000000]#\\,##\\,##\\,##0;[>=100000]#\\,##\\,##0;#,##0'
const INR = '#,##0'
const INR_ACC = '#,##0;(#,##0);"–"'
const FONT = 'Calibri'

const NOTE_TITLE: Record<number, string> = {
  1: 'Share Capital',
  2: 'Reserves & Surplus',
  3: 'Long-Term Borrowings',
  4: 'Short-Term Borrowings',
  5: 'Trade Payables',
  6: 'Other Current Liabilities',
  7: 'Short-Term Provisions',
  8: 'Fixed Assets',
  9: 'Non-Current Investments',
  10: 'Long-Term Loans & Advances',
  11: 'Inventories',
  12: 'Trade Receivables',
  13: 'Cash & Bank',
  14: 'Other Current Assets',
}
const NOTE_SHEET: Record<number, string> = {
  1: 'N1 Share Capital', 2: 'N2 Reserves Surplus', 3: 'N3 LT Borrowings', 4: 'N4 ST Borrowings',
  5: 'N5 Trade Payables', 6: 'N6 Other CL', 7: 'N7 Provisions', 8: 'N8 Fixed Assets',
  9: 'N9 NC Investments', 10: 'N10 LT Loans', 11: 'N11 Inventories', 12: 'N12 Trade Receivables',
  13: 'N13 Cash & Bank', 14: 'N14 Other CA',
}
// Schedule-III line id → note number
const ID_NOTE: Record<string, number> = {
  share_capital: 1, reserves_surplus: 2, lt_borrowings: 3, st_borrowings: 4,
  trade_payables: 5, other_cur_liab: 6, st_provisions: 7, fixed_assets: 8,
  nc_investments: 9, lt_loans_adv: 10, inventories: 11, trade_receivables: 12,
  cash_bank: 13, other_cur_assets: 14,
}

export async function exportSch3(
  s: Sch3Statements,
  checks: CheckResult[],
  filename = 'Schedule-III.xlsx',
): Promise<void> {
  const wb = await newWorkbook()
  const n = s.branches.length
  const multi = n > 1
  const valueCols = multi ? Array.from({ length: n }, (_, i) => 3 + i) : [3]
  const totalCol = multi ? 3 + n : 3
  const lastCol = multi ? 3 + n : 4
  const period = `${s.period.to ?? ''}`

  const all = [...s.bsEquityLiability, ...s.bsAssets, ...s.plIncome, ...s.plExpense]
  const find = (id: string): Sch3LineResult | undefined => all.find((l) => l.line.id === id)
  const vals = (id: string) => {
    const l = find(id)
    return {
      pb: l ? l.perBranch : (Array<Paise>(n).fill(0 as Paise)),
      c: l ? l.consolidated : (0 as Paise),
      led: l ? l.ledgers : [],
    }
  }
  // which notes will get a sheet (head present with detail, or note 2 always)
  const noteHasData = new Set<number>()
  for (const [id, num] of Object.entries(ID_NOTE)) {
    const l = find(id)
    if (num === 2 || (l && l.ledgers.length > 0)) noteHasData.add(num)
  }

  buildFace(wb, s, { multi, valueCols, totalCol, lastCol, period, vals, noteHasData })
  buildPnl(wb, s, { multi, valueCols, totalCol, lastCol, period })
  for (let num = 1; num <= 14; num++) {
    if (!noteHasData.has(num)) continue
    buildNote(wb, num, s, vals)
  }
  buildNotesIndex(wb, vals, s, noteHasData)
  buildValidation(wb, s, checks)

  await download(wb, filename)
}

interface FaceCtx {
  multi: boolean
  valueCols: number[]
  totalCol: number
  lastCol: number
  period: string
  vals: (id: string) => { pb: Paise[]; c: Paise; led: { name: string; perBranch: Paise[]; consolidated: Paise }[] }
  noteHasData: Set<number>
}

function setCell(
  ws: AnyWorksheet,
  row: number,
  col: number,
  value: ExcelValue,
  opts: { bold?: boolean; size?: number; color?: string; fill?: string; align?: 'left' | 'right' | 'center'; numFmt?: string; italic?: boolean; wrap?: boolean } = {},
) {
  const cell = ws.getCell(row, col)
  cell.value = value
  cell.font = { name: FONT, size: opts.size ?? 10, bold: opts.bold, italic: opts.italic, color: { argb: opts.color ?? C.BLACK } }
  if (opts.fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: opts.fill } }
  if (opts.align) cell.alignment = { horizontal: opts.align, vertical: 'middle', wrapText: opts.wrap }
  if (opts.numFmt) cell.numFmt = opts.numFmt
  return cell
}

type ExcelValue = string | number | { text: string; hyperlink: string }

function buildFace(wb: Awaited<ReturnType<typeof newWorkbook>>, s: Sch3Statements, ctx: FaceCtx) {
  const { multi, valueCols, totalCol, lastCol, period, vals, noteHasData } = ctx
  const ws = wb.addWorksheet('Balance Sheet', {
    views: [{ showGridLines: false, state: 'frozen', ySplit: 5 }],
  })
  ws.getColumn(1).width = 60
  ws.getColumn(2).width = 7
  if (multi) {
    valueCols.forEach((c) => (ws.getColumn(c).width = 20))
    ws.getColumn(totalCol).width = 22
  } else {
    ws.getColumn(3).width = 22
    ws.getColumn(4).width = 22
  }

  let r = 1
  const header = (text: string, size: number, fill: string, color: string = C.WHITE, bold = true) => {
    ws.mergeCells(r, 1, r, lastCol)
    setCell(ws, r, 1, text, { bold, size, color, fill, align: 'center' })
    r++
  }
  const subheader = (text: string) => {
    ws.mergeCells(r, 1, r, lastCol)
    setCell(ws, r, 1, text, { bold: true, size: 10, color: C.WHITE, fill: C.MID, align: 'left' })
    r++
  }
  const colHeader = () => {
    setCell(ws, r, 1, 'Particulars', { bold: true, size: 9, color: C.WHITE, fill: C.MID, align: 'center', wrap: true })
    setCell(ws, r, 2, 'Note', { bold: true, size: 9, color: C.WHITE, fill: C.MID, align: 'center' })
    if (multi) {
      s.branches.forEach((b, i) => setCell(ws, r, valueCols[i]!, b, { bold: true, size: 9, color: C.WHITE, fill: C.MID, align: 'center', wrap: true }))
      setCell(ws, r, totalCol, `Consolidated (As at ${period})`, { bold: true, size: 9, color: C.WHITE, fill: C.MID, align: 'center', wrap: true })
    } else {
      setCell(ws, r, 3, `As at ${period}`, { bold: true, size: 9, color: C.WHITE, fill: C.MID, align: 'center', wrap: true })
      setCell(ws, r, 4, 'Previous Year', { bold: true, size: 9, color: C.WHITE, fill: C.MID, align: 'center', wrap: true })
    }
    r++
  }
  const dataRow = (
    label: string,
    pack: { pb: Paise[]; c: Paise } | null,
    o: { note?: number; bold?: boolean; total?: boolean; indent?: number; fmt?: string; italic?: boolean } = {},
  ) => {
    const fmt = o.fmt ?? INR_IND
    setCell(ws, r, 1, '  '.repeat(o.indent ?? 0) + label, { bold: o.bold || o.total, italic: o.italic, fill: o.total ? C.TOTAL : undefined })
    if (o.note != null && noteHasData.has(o.note)) {
      const b = ws.getCell(r, 2)
      b.value = { text: String(o.note), hyperlink: `#'${NOTE_SHEET[o.note]}'!A1` }
      b.font = { name: FONT, size: 9, color: { argb: C.LINK }, underline: true }
      b.alignment = { horizontal: 'center' }
    } else if (o.note != null) {
      setCell(ws, r, 2, o.note, { size: 9, align: 'center' })
    }
    if (pack) {
      const writeVal = (col: number, v: Paise) => {
        const cell = setCell(ws, r, col, v / 100, { bold: o.bold || o.total, italic: o.italic, numFmt: fmt, align: 'right' })
        if (o.total) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.TOTAL } }
      }
      if (multi) {
        pack.pb.forEach((v, i) => writeVal(valueCols[i]!, v))
        writeVal(totalCol, pack.c)
      } else {
        writeVal(3, pack.c)
      }
    }
    if (o.total) {
      for (const col of [1, 2, ...valueCols, ...(multi ? [totalCol] : [4])]) {
        ws.getCell(r, col).border = { top: { style: 'thin', color: { argb: C.DARK } }, bottom: { style: 'medium', color: { argb: C.DARK } } }
        if (!ws.getCell(r, col).fill) ws.getCell(r, col).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.TOTAL } }
      }
    }
    r++
  }
  const spacer = () => r++

  // ── headers ──
  header(s.branches.join('  +  ').toUpperCase().slice(0, 120) || 'COMPANY', 14, C.HEADER)
  header('BALANCE SHEET' + (multi ? '  (Branch-wise + Consolidated)' : ''), 12, C.HEADER)
  header(`As at ${period}`, 10, C.MID)
  header('(All amounts in ₹  ·  Indian number format)', 9, C.LIGHT, C.BLACK, false)
  colHeader()

  // sum helper across two ids
  const sumIds = (...ids: string[]) => {
    const pb = Array<Paise>(s.branches.length).fill(0 as Paise)
    let c = 0
    for (const id of ids) {
      const v = vals(id)
      v.pb.forEach((x, i) => (pb[i] = (pb[i]! + x) as Paise))
      c += v.c
    }
    return { pb, c: c as Paise }
  }

  // ── EQUITY & LIABILITIES ──
  subheader("I.  SHAREHOLDERS' FUNDS")
  dataRow('a)  Share Capital', vals('share_capital'), { note: 1 })
  dataRow('b)  Reserves & Surplus', sumIds('reserves_surplus', 'profit_year'), { note: 2 })
  dataRow('Total Shareholders’ Funds', sumIds('share_capital', 'reserves_surplus', 'profit_year'), { bold: true, total: true })
  spacer()

  subheader('II.  NON-CURRENT LIABILITIES')
  dataRow('a)  Long-Term Borrowings', vals('lt_borrowings'), { note: 3 })
  dataRow('b)  Long-Term Provisions', vals('lt_provisions'))
  dataRow('c)  Other Non-Current Liabilities', vals('other_nc_liab'))
  dataRow('Total Non-Current Liabilities', sumIds('lt_borrowings', 'lt_provisions', 'other_nc_liab'), { bold: true, total: true })
  spacer()

  subheader('III.  CURRENT LIABILITIES')
  dataRow('a)  Short-Term Borrowings', vals('st_borrowings'), { note: 4 })
  dataRow('b)  Trade Payables', vals('trade_payables'), { note: 5 })
  dataRow('c)  Other Current Liabilities', vals('other_cur_liab'), { note: 6 })
  dataRow('d)  Short-Term Provisions', vals('st_provisions'), { note: 7 })
  dataRow('Total Current Liabilities', sumIds('st_borrowings', 'trade_payables', 'other_cur_liab', 'st_provisions'), { bold: true, total: true })
  spacer()

  // year-end reconciliation plug so the face balances; exposes opening/round gaps
  const resid = { pb: s.bsResidual.perBranch, c: s.bsResidual.consolidated }
  if (Math.abs(resid.c) >= 1) {
    dataRow('Year-end Reconciliation (auto-balance)', resid, { italic: true, fmt: INR_ACC })
    spacer()
  }
  dataRow('TOTAL EQUITY AND LIABILITIES', { pb: s.totals.assets.perBranch, c: s.totals.assets.consolidated }, { bold: true, total: true })
  spacer()
  spacer()

  // ── ASSETS ──
  subheader('I.  NON-CURRENT ASSETS')
  dataRow('a)  Property, Plant & Equipment', vals('fixed_assets'), { note: 8 })
  dataRow('b)  Non-Current Investments', vals('nc_investments'), { note: 9 })
  dataRow('c)  Long-Term Loans & Advances', vals('lt_loans_adv'), { note: 10 })
  dataRow('d)  Other Non-Current Assets', vals('other_nc_assets'))
  dataRow('Total Non-Current Assets', sumIds('fixed_assets', 'nc_investments', 'lt_loans_adv', 'other_nc_assets'), { bold: true, total: true })
  spacer()

  subheader('II.  CURRENT ASSETS')
  dataRow('a)  Current Investments', vals('cur_investments'))
  dataRow('b)  Inventories', vals('inventories'), { note: 11 })
  dataRow('c)  Trade Receivables', vals('trade_receivables'), { note: 12 })
  dataRow('d)  Cash & Bank Balances', vals('cash_bank'), { note: 13 })
  dataRow('e)  Short-Term Loans & Advances', vals('st_loans_adv'))
  dataRow('f)  Other Current Assets', vals('other_cur_assets'), { note: 14 })
  dataRow('Total Current Assets', sumIds('cur_investments', 'inventories', 'trade_receivables', 'cash_bank', 'st_loans_adv', 'other_cur_assets'), { bold: true, total: true })
  spacer()
  dataRow('TOTAL ASSETS', { pb: s.totals.assets.perBranch, c: s.totals.assets.consolidated }, { bold: true, total: true })
}

function buildPnl(
  wb: Awaited<ReturnType<typeof newWorkbook>>,
  s: Sch3Statements,
  ctx: Omit<FaceCtx, 'vals' | 'noteHasData'>,
) {
  const { multi, valueCols, totalCol, lastCol, period } = ctx
  const ws = wb.addWorksheet('P&L Statement', { views: [{ showGridLines: false, state: 'frozen', ySplit: 5 }] })
  ws.getColumn(1).width = 50
  ws.getColumn(2).width = 8
  if (multi) {
    valueCols.forEach((c) => (ws.getColumn(c).width = 16))
    ws.getColumn(totalCol).width = 18
  } else ws.getColumn(3).width = 18

  let r = 1
  const header = (text: string, size: number, fill: string, color: string = C.WHITE, bold = true) => {
    ws.mergeCells(r, 1, r, lastCol)
    setCell(ws, r, 1, text, { bold, size, color, fill, align: 'center' })
    r++
  }
  const row = (label: string, pack: { pb: Paise[]; c: Paise } | null, o: { bold?: boolean; total?: boolean; indent?: number; italic?: boolean } = {}) => {
    setCell(ws, r, 1, '  '.repeat(o.indent ?? 0) + label, { bold: o.bold || o.total, italic: o.italic, fill: o.total ? C.TOTAL : undefined })
    if (pack) {
      const writeVal = (col: number, v: Paise) => {
        const c = setCell(ws, r, col, v / 100, { bold: o.bold || o.total, numFmt: INR, align: 'right' })
        if (o.total) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.TOTAL } }
      }
      if (multi) {
        pack.pb.forEach((v, i) => writeVal(valueCols[i]!, v))
        writeVal(totalCol, pack.c)
      } else writeVal(3, pack.c)
    }
    r++
  }
  const find = (id: string) => [...s.plIncome, ...s.plExpense].find((l) => l.line.id === id)
  const pack = (id: string) => {
    const l = find(id)
    return l ? { pb: l.perBranch, c: l.consolidated } : { pb: Array<Paise>(s.branches.length).fill(0 as Paise), c: 0 as Paise }
  }

  header(s.branches.join('  +  ').toUpperCase().slice(0, 120) || 'COMPANY', 13, C.HEADER)
  header('STATEMENT OF PROFIT & LOSS' + (multi ? '  (Branch-wise + Consolidated)' : ''), 11, C.HEADER)
  header(`For the year ended ${period}`, 10, C.MID)
  header('(All amounts in ₹)', 9, C.LIGHT, C.BLACK, false)
  // col header
  setCell(ws, r, 1, 'Particulars', { bold: true, size: 9, color: C.WHITE, fill: C.MID, align: 'center' })
  setCell(ws, r, 2, 'Note', { bold: true, size: 9, color: C.WHITE, fill: C.MID, align: 'center' })
  if (multi) {
    s.branches.forEach((b, i) => setCell(ws, r, valueCols[i]!, b, { bold: true, size: 9, color: C.WHITE, fill: C.MID, align: 'center', wrap: true }))
    setCell(ws, r, totalCol, 'Consolidated', { bold: true, size: 9, color: C.WHITE, fill: C.MID, align: 'center' })
  } else setCell(ws, r, 3, 'Current Year', { bold: true, size: 9, color: C.WHITE, fill: C.MID, align: 'center' })
  r++

  row('I.   Revenue from Operations', pack('revenue_ops'), { bold: true })
  row('II.  Other Income', pack('other_income'), { bold: true })
  row('III. Total Revenue (I + II)', { pb: s.totals.totalIncome.perBranch, c: s.totals.totalIncome.consolidated }, { bold: true, total: true })
  r++
  row('IV.  Expenses', null, { bold: true })
  row('a)  Cost of Materials / Purchases', pack('cost_materials'), { indent: 1 })
  row('b)  Changes in Inventories', pack('changes_inventory'), { indent: 1 })
  row('c)  Employee Benefit Expense', pack('employee_benefit'), { indent: 1 })
  row('d)  Finance Costs', pack('finance_costs'), { indent: 1 })
  row('e)  Depreciation & Amortisation', pack('depreciation'), { indent: 1 })
  row('f)  Other Expenses', pack('other_expenses'), { indent: 1 })
  row('g)  Tax Expense', pack('tax_expense'), { indent: 1 })
  row('V.   Total Expenses', { pb: s.totals.totalExpense.perBranch, c: s.totals.totalExpense.consolidated }, { bold: true, total: true })
  r++
  row('VI.  Profit / (Loss) for the year', { pb: s.profitForYear.perBranch, c: s.profitForYear.consolidated }, { bold: true, total: true })
}

function buildNote(
  wb: Awaited<ReturnType<typeof newWorkbook>>,
  num: number,
  s: Sch3Statements,
  vals: FaceCtx['vals'],
) {
  const ws = wb.addWorksheet(NOTE_SHEET[num]!, { views: [{ showGridLines: false }] })
  ws.getColumn(1).width = 48
  ws.getColumn(2).width = 22
  ws.mergeCells(1, 1, 1, 2)
  setCell(ws, 1, 1, `Note ${num}:  ${NOTE_TITLE[num]}`, { bold: true, size: 11, color: C.WHITE, fill: C.HEADER, align: 'center' })
  ws.mergeCells(2, 1, 2, 2)
  const back = ws.getCell(2, 1)
  back.value = { text: '← Back to Balance Sheet', hyperlink: "#'Balance Sheet'!A1" }
  back.font = { name: FONT, size: 9, color: { argb: C.LINK }, underline: true }

  let r = 3
  const idForNote = Object.entries(ID_NOTE).find(([, v]) => v === num)?.[0]
  const led = idForNote ? vals(idForNote).led : []
  let total = 0
  for (const l of led) {
    setCell(ws, r, 1, l.name, { size: 9 })
    setCell(ws, r, 2, l.consolidated / 100, { size: 9, numFmt: INR, align: 'right' })
    total += l.consolidated
    r++
  }
  if (num === 2) {
    // append current-year profit to reserves note
    setCell(ws, r, 1, 'Profit / (Loss) for the year (P&L A/c)', { size: 9 })
    setCell(ws, r, 2, s.profitForYear.consolidated / 100, { size: 9, numFmt: INR, align: 'right' })
    total += s.profitForYear.consolidated
    r++
  }
  setCell(ws, r, 1, `Total — ${NOTE_TITLE[num]}`, { bold: true, size: 9, fill: C.TOTAL })
  setCell(ws, r, 2, total / 100, { bold: true, size: 9, numFmt: INR, align: 'right', fill: C.TOTAL })
}

function buildNotesIndex(
  wb: Awaited<ReturnType<typeof newWorkbook>>,
  vals: FaceCtx['vals'],
  s: Sch3Statements,
  noteHasData: Set<number>,
) {
  const ws = wb.addWorksheet('Notes Index', { views: [{ showGridLines: false, state: 'frozen', ySplit: 2 }] })
  ws.getColumn(1).width = 12
  ws.getColumn(2).width = 36
  ws.getColumn(3).width = 22
  ws.mergeCells(1, 1, 1, 3)
  setCell(ws, 1, 1, 'NOTES TO FINANCIAL STATEMENTS', { bold: true, size: 11, color: C.WHITE, fill: C.HEADER, align: 'center' })
  setCell(ws, 2, 1, 'Note No.', { bold: true, size: 9, color: C.WHITE, fill: C.MID, align: 'center' })
  setCell(ws, 2, 2, 'Description', { bold: true, size: 9, color: C.WHITE, fill: C.MID, align: 'center' })
  setCell(ws, 2, 3, 'Amount (₹)', { bold: true, size: 9, color: C.WHITE, fill: C.MID, align: 'center' })

  let r = 3
  for (let num = 1; num <= 14; num++) {
    if (!noteHasData.has(num)) continue
    const idForNote = Object.entries(ID_NOTE).find(([, v]) => v === num)?.[0]
    let amount = idForNote ? vals(idForNote).c : (0 as Paise)
    if (num === 2) amount = (amount + s.profitForYear.consolidated) as Paise
    const a = ws.getCell(r, 1)
    a.value = { text: `Note ${num}`, hyperlink: `#'${NOTE_SHEET[num]}'!A1` }
    a.font = { name: FONT, size: 9, color: { argb: C.LINK }, underline: true }
    a.alignment = { horizontal: 'center' }
    setCell(ws, r, 2, NOTE_TITLE[num]!, { size: 9 })
    setCell(ws, r, 3, amount / 100, { size: 9, numFmt: INR, align: 'right' })
    if (r % 2 === 0) for (const col of [1, 2, 3]) ws.getCell(r, col).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.LIGHT } }
    r++
  }
}

function buildValidation(wb: Awaited<ReturnType<typeof newWorkbook>>, s: Sch3Statements, checks: CheckResult[]) {
  const ws = wb.addWorksheet('Validation', { views: [{ showGridLines: false, state: 'frozen', ySplit: 3 }] })
  ws.getColumn(1).width = 12
  ws.getColumn(2).width = 20
  ws.getColumn(3).width = 50
  ws.getColumn(4).width = 60
  ws.mergeCells(1, 1, 1, 4)
  setCell(ws, 1, 1, `DATA VALIDATION REPORT — ${s.branches.join(' + ')} — ${s.period.to}`, { bold: true, size: 12, color: C.WHITE, fill: C.HEADER, align: 'center' })
  const fails = checks.filter((c) => c.status === 'fail').length
  const warns = checks.filter((c) => c.status === 'warn').length
  ws.mergeCells(2, 1, 2, 4)
  setCell(ws, 2, 1, fails ? `${fails} error(s), ${warns} warning(s)` : warns ? `${warns} warning(s)` : 'All checks passed', {
    bold: true, size: 11, color: fails ? 'FFCC0000' : 'FF2E7D32', align: 'center',
  })
  ;['Severity', 'Category', 'Check', 'Detail'].forEach((h, i) =>
    setCell(ws, 3, i + 1, h, { bold: true, size: 9, color: C.WHITE, fill: C.MID, align: 'center' }),
  )
  let r = 4
  const BG = { pass: 'FFE8F5E9', warn: 'FFFFF2CC', fail: 'FFFFCCCC' }
  const FG = { pass: 'FF1B5E20', warn: 'FF7B5800', fail: 'FFCC0000' }
  for (const c of checks) {
    const sev = c.status === 'fail' ? 'ERROR' : c.status === 'warn' ? 'WARNING' : 'INFO'
    const cells: [number, string][] = [[1, sev], [2, c.category], [3, c.label], [4, c.detail]]
    for (const [col, v] of cells) {
      const cell = setCell(ws, r, col, v, { size: 9, bold: col === 1, color: col === 1 ? FG[c.status] : C.BLACK, fill: BG[c.status], align: 'left', wrap: true })
      cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } }
    }
    r++
  }
}
