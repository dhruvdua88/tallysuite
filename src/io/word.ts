/**
 * io/word — confirmation letters as a Word document (docx). Dynamically imported
 * so the docx dependency is code-split out of the initial bundle. One document,
 * one party per page, firm letterhead + balance + optional bill annexure.
 */
import { formatINR } from '../core/model/money'
import { confirmAmount, type ConfirmationParty } from '../core/m1-confirmations/confirmations'

export interface LetterOptions {
  firmName: string
  firmLine2: string
  companyName: string
  periodTo: string
  place: string
  partnerName: string
  membershipNo: string
}

export async function exportConfirmationLetters(
  parties: ConfirmationParty[],
  opts: LetterOptions,
  filename = 'Balance-Confirmations.docx',
): Promise<void> {
  const docx = await import('docx')
  const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, AlignmentType, WidthType, BorderStyle, PageBreak } = docx

  const included = parties.filter((p) => p.source !== 'exclude')
  const children: unknown[] = []

  included.forEach((p, idx) => {
    const amount = confirmAmount(p)
    const para = (text: string, o: { bold?: boolean; size?: number; align?: keyof typeof AlignmentType; after?: number } = {}) =>
      new Paragraph({
        alignment: o.align ? AlignmentType[o.align] : undefined,
        spacing: { after: o.after ?? 120 },
        children: [new TextRun({ text, bold: o.bold, size: o.size ?? 22 })],
      })

    children.push(para(opts.firmName, { bold: true, size: 30, align: 'CENTER', after: 0 }))
    children.push(para(opts.firmLine2, { align: 'CENTER', size: 18, after: 240 }))
    children.push(para(`Date: ${opts.periodTo}`, { align: 'RIGHT' }))
    children.push(para('To,', { after: 0 }))
    children.push(para(p.name, { bold: true, after: 0 }))
    if (p.address) children.push(para(p.address, { size: 20, after: 0 }))
    if (p.gstin) children.push(para(`GSTIN: ${p.gstin}`, { size: 18, after: 200 }))
    else children.push(para('', { after: 120 }))

    children.push(para(`Subject: Confirmation of balance as on ${opts.periodTo}`, { bold: true }))
    children.push(para('Dear Sir/Madam,'))
    children.push(
      para(
        `As a part of the audit of ${opts.companyName} for the year ended ${opts.periodTo}, we request you to kindly confirm the balance outstanding in your account in our books, as detailed below. Please confirm directly to us at the address above.`,
      ),
    )
    children.push(
      para(`Balance as per our books as on ${opts.periodTo}: ${formatINR(amount)} (${p.drCr}).`, { bold: true, after: 200 }),
    )

    if (p.source === 'billwise' && p.bills.length > 0) {
      children.push(para('Bill-wise details:', { bold: true, size: 20 }))
      const rows = [
        new TableRow({
          children: ['Bill Reference', 'Type', 'Amount'].map(
            (h) =>
              new TableCell({
                width: { size: h === 'Amount' ? 25 : h === 'Type' ? 25 : 50, type: WidthType.PERCENTAGE },
                children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, size: 18 })] })],
              }),
          ),
        }),
        ...p.bills.slice(0, 30).map(
          (b) =>
            new TableRow({
              children: [b.name, b.billType ?? '', formatINR(Math.abs(b.amount) as never)].map(
                (c, ci) =>
                  new TableCell({
                    children: [
                      new Paragraph({
                        alignment: ci === 2 ? AlignmentType.RIGHT : undefined,
                        children: [new TextRun({ text: String(c), size: 18 })],
                      }),
                    ],
                  }),
              ),
            }),
        ),
      ]
      children.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          borders: {
            top: { style: BorderStyle.SINGLE, size: 1, color: 'BBBBBB' },
            bottom: { style: BorderStyle.SINGLE, size: 1, color: 'BBBBBB' },
            left: { style: BorderStyle.SINGLE, size: 1, color: 'BBBBBB' },
            right: { style: BorderStyle.SINGLE, size: 1, color: 'BBBBBB' },
            insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: 'DDDDDD' },
            insideVertical: { style: BorderStyle.SINGLE, size: 1, color: 'DDDDDD' },
          },
          rows,
        }),
      )
      children.push(para('', { after: 120 }))
    }

    children.push(para('We confirm that the above balance is correct / not correct (strike out whichever is not applicable).', { size: 20, after: 240 }))
    children.push(para('_______________________________', { after: 0 }))
    children.push(para('Signature & Seal (Party)', { size: 18, after: 300 }))
    children.push(para('For ' + opts.firmName, { after: 0 }))
    children.push(para(`${opts.partnerName}, Partner (M. No. ${opts.membershipNo})`, { size: 18, after: 0 }))
    children.push(para(`Place: ${opts.place}`, { size: 18, after: 0 }))

    if (idx < included.length - 1) {
      children.push(new Paragraph({ children: [new PageBreak()] }))
    }
  })

  const doc = new Document({ sections: [{ children: children as never }] })
  const blob = await Packer.toBlob(doc)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
