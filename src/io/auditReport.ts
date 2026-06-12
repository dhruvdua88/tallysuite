/**
 * Independent Auditor's Report generator (SA 700 Revised skeleton). Deterministic,
 * offline. CARO 2020 annexure reference is conditional on applicability computed
 * from the statements. Produces an editable Word document.
 */
import type { CaroApplicability } from '../core/m5-review/rules'

export interface AuditReportOptions {
  companyName: string
  periodTo: string
  firmName: string
  frn: string
  partnerName: string
  membershipNo: string
  place: string
}

export async function exportAuditReport(
  opts: AuditReportOptions,
  caro: CaroApplicability,
  filename = 'Independent-Auditors-Report.docx',
): Promise<void> {
  const docx = await import('docx')
  const { Document, Packer, Paragraph, TextRun, AlignmentType, HeadingLevel } = docx

  const caroApplies = !caro.likelyExempt
  const P = (text: string, o: { bold?: boolean; align?: keyof typeof AlignmentType; after?: number; size?: number } = {}) =>
    new Paragraph({
      alignment: o.align ? AlignmentType[o.align] : AlignmentType.JUSTIFIED,
      spacing: { after: o.after ?? 160 },
      children: [new TextRun({ text, bold: o.bold, size: o.size ?? 22 })],
    })
  const H = (text: string) =>
    new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 120 }, children: [new TextRun({ text, bold: true, size: 24 })] })

  const children = [
    P("INDEPENDENT AUDITOR'S REPORT", { bold: true, align: 'CENTER', size: 28 }),
    P(`To the Members of ${opts.companyName}`, { bold: true, after: 200 }),
    P('Report on the Audit of the Financial Statements', { bold: true }),

    H('Opinion'),
    P(
      `We have audited the accompanying financial statements of ${opts.companyName} ("the Company"), which comprise the Balance Sheet as at ${opts.periodTo}, the Statement of Profit and Loss, and the Cash Flow Statement for the year then ended, and notes to the financial statements, including a summary of significant accounting policies and other explanatory information.`,
    ),
    P(
      `In our opinion and to the best of our information and according to the explanations given to us, the aforesaid financial statements give the information required by the Companies Act, 2013 in the manner so required and give a true and fair view in conformity with the accounting principles generally accepted in India, of the state of affairs of the Company as at ${opts.periodTo}, and its profit/(loss) and its cash flows for the year ended on that date.`,
    ),

    H('Basis for Opinion'),
    P(
      'We conducted our audit in accordance with the Standards on Auditing (SAs) specified under Section 143(10) of the Companies Act, 2013. Our responsibilities under those Standards are further described in the Auditor\'s Responsibilities for the Audit of the Financial Statements section of our report. We are independent of the Company in accordance with the Code of Ethics issued by ICAI, and we have fulfilled our other ethical responsibilities in accordance with these requirements. We believe that the audit evidence we have obtained is sufficient and appropriate to provide a basis for our opinion.',
    ),

    H("Management's Responsibility for the Financial Statements"),
    P(
      "The Company's Board of Directors is responsible for the matters stated in Section 134(5) of the Companies Act, 2013 with respect to the preparation of these financial statements that give a true and fair view of the financial position, financial performance and cash flows of the Company in accordance with the accounting principles generally accepted in India, including the Accounting Standards specified under Section 133 of the Act.",
    ),

    H("Auditor's Responsibilities for the Audit of the Financial Statements"),
    P(
      'Our objectives are to obtain reasonable assurance about whether the financial statements as a whole are free from material misstatement, whether due to fraud or error, and to issue an auditor\'s report that includes our opinion. Reasonable assurance is a high level of assurance, but is not a guarantee that an audit conducted in accordance with SAs will always detect a material misstatement when it exists.',
    ),

    H('Report on Other Legal and Regulatory Requirements'),
    P(
      caroApplies
        ? '1. As required by the Companies (Auditor\'s Report) Order, 2020 ("the Order") issued by the Central Government in terms of Section 143(11) of the Act, we give in "Annexure A" a statement on the matters specified in paragraphs 3 and 4 of the Order, to the extent applicable.'
        : '1. The Companies (Auditor\'s Report) Order, 2020 is not applicable to the Company as it satisfies the conditions for exemption under paragraph 1(2) of the Order (paid-up capital plus reserves not exceeding ₹1 crore, borrowings not exceeding ₹1 crore, and revenue not exceeding ₹10 crore).',
    ),
    P('2. As required by Section 143(3) of the Act, we report that we have sought and obtained all the information and explanations which to the best of our knowledge and belief were necessary for the purposes of our audit.'),

    new Paragraph({ spacing: { before: 400 }, children: [new TextRun({ text: `For ${opts.firmName}`, bold: true, size: 22 })] }),
    P(`Chartered Accountants`, { after: 0 }),
    P(`Firm Registration No. ${opts.frn}`, { after: 300 }),
    P(`${opts.partnerName}`, { bold: true, after: 0 }),
    P(`Partner`, { after: 0 }),
    P(`Membership No. ${opts.membershipNo}`, { after: 200 }),
    P(`Place: ${opts.place}`, { after: 0 }),
    P(`Date: ${opts.periodTo}`, { after: 0 }),
  ]

  const doc = new Document({ sections: [{ children }] })
  const blob = await Packer.toBlob(doc)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
