/**
 * Optional AI review pass. Sends ONLY the statement summary + the deterministic
 * findings (no raw ledgers, no party PII) to DeepSeek and asks for additional
 * semantic Schedule III / audit observations. Returns findings tagged
 * aiAssisted:true. Never required — the rule engine is always the floor.
 */
import { z } from 'zod'
import { formatINR } from '../../core/model/money'
import type { Sch3Statements } from '../../core/m3-sch3'
import type { ReviewFinding, Severity } from '../../core/m5-review/rules'
import { callJSON, type Message } from './client'

const AiFindings = z.object({
  findings: z
    .array(
      z.object({
        area: z.string(),
        severity: z.enum(['high', 'medium', 'low', 'info']),
        title: z.string(),
        detail: z.string(),
      }),
    )
    .max(20),
})

export async function aiReview(
  s: Sch3Statements,
  ruleFindings: ReviewFinding[],
  signal?: AbortSignal,
): Promise<ReviewFinding[]> {
  const summary = statementSummary(s)
  const existing = ruleFindings.map((f) => `- [${f.severity}] ${f.title}: ${f.detail}`).join('\n')

  const messages: Message[] = [
    {
      role: 'system',
      content:
        'You are a senior Indian Chartered Accountant reviewing Schedule III financial statements (Companies Act 2013, Division I) and CARO 2020 applicability. Identify presentation, classification, disclosure and audit-risk issues a partner would raise. Be specific and rupee-aware. Respond ONLY as JSON: {"findings":[{"area","severity":"high|medium|low|info","title","detail"}]}. Do not repeat issues already listed. No preamble.',
    },
    {
      role: 'user',
      content: `Financial statement summary (₹):\n${summary}\n\nIssues already identified by the rule engine (do not repeat):\n${existing}\n\nReturn up to 12 ADDITIONAL findings.`,
    },
  ]

  const result = await callJSON(messages, AiFindings, { signal })
  return result.findings.map((f, i) => ({
    id: `ai-${i}`,
    area: f.area,
    severity: f.severity as Severity,
    title: f.title,
    detail: f.detail,
    drill: [],
    aiAssisted: true,
  }))
}

function statementSummary(s: Sch3Statements): string {
  const lines: string[] = []
  const push = (label: string, v: number) => lines.push(`${label}: ${formatINR(v as never)}`)
  for (const r of s.bsEquityLiability) if (r.consolidated !== 0) push(r.line.label, r.consolidated)
  for (const r of s.bsAssets) if (r.consolidated !== 0) push(r.line.label, r.consolidated)
  push('Total Assets', s.totals.assets.consolidated)
  push('Total Equity & Liabilities', s.totals.equityLiability.consolidated)
  for (const r of s.plIncome) if (r.consolidated !== 0) push(r.line.label, r.consolidated)
  for (const r of s.plExpense) if (r.consolidated !== 0) push(r.line.label, r.consolidated)
  push('Profit for the year', s.profitForYear.consolidated)
  return lines.join('\n')
}
