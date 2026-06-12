import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import {
  ShieldCheck,
  Sparkles,
  FileText,
  AlertTriangle,
  Info,
  KeyRound,
  ChevronDown,
} from 'lucide-react'
import { useActiveSlot } from '../../state/store'
import { buildStatements } from '../../core/m3-sch3'
import { runReview, caroApplicability, type ReviewFinding } from '../../core/m5-review/rules'
import { formatINR } from '../../core/model/money'
import { hasApiKey, setApiKey } from '../../io/deepseek/client'
import { Pill } from '../components/atoms'
import { cn } from '../lib/cn'

const FIRM = {
  firmName: 'Dhruv Dua & Co.',
  frn: '028145N',
  partnerName: 'Dhruv Dua',
  membershipNo: '531607',
  place: 'New Delhi',
}

export function Reviewer() {
  const slot = useActiveSlot()
  const base = useMemo(() => {
    if (!slot) return null
    const statements = buildStatements([slot.dataset])
    const findings = runReview(statements, [slot.dataset])
    const caro = caroApplicability(statements)
    return { statements, findings, caro }
  }, [slot])

  const [aiFindings, setAiFindings] = useState<ReviewFinding[]>([])
  const [aiBusy, setAiBusy] = useState(false)
  const [keyInput, setKeyInput] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [exporting, setExporting] = useState(false)

  if (!slot || !base) return null
  const all = [...base.findings, ...aiFindings]

  async function runAi() {
    if (!base) return
    if (!hasApiKey()) {
      setShowKey(true)
      return
    }
    setAiBusy(true)
    try {
      const { aiReview } = await import('../../io/deepseek/aiReview')
      const extra = await aiReview(base.statements, base.findings)
      setAiFindings(extra)
      toast.success(`AI added ${extra.length} observations`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'AI review failed')
    } finally {
      setAiBusy(false)
    }
  }

  async function exportReport() {
    if (!base || !slot) return
    setExporting(true)
    try {
      const { exportAuditReport } = await import('../../io/auditReport')
      await exportAuditReport({ ...FIRM, companyName: slot.dataset.meta.company, periodTo: slot.dataset.meta.periodTo ?? '' }, base.caro)
      toast.success("Independent Auditor's Report generated")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed')
    } finally {
      setExporting(false)
    }
  }

  const counts = {
    high: all.filter((f) => f.severity === 'high').length,
    medium: all.filter((f) => f.severity === 'medium').length,
    low: all.filter((f) => f.severity === 'low').length,
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ShieldCheck size={20} className="text-accent" />
          <h2 className="text-xl font-bold tracking-tight">Schedule III Reviewer</h2>
          <span className="text-sm text-ink-faint">— rule review always · AI optional</span>
        </div>
        <div className="flex gap-2">
          <button className="btn-soft" onClick={runAi} disabled={aiBusy}>
            <Sparkles size={16} /> {aiBusy ? 'AI reviewing…' : 'AI review (optional)'}
          </button>
          <button className="btn-primary" onClick={exportReport} disabled={exporting}>
            <FileText size={16} /> {exporting ? 'Generating…' : "Auditor's Report"}
          </button>
        </div>
      </div>

      {showKey && !hasApiKey() && (
        <div className="panel p-4 flex flex-wrap items-center gap-3">
          <KeyRound size={16} className="text-accent" />
          <span className="text-sm text-ink-muted">Paste a DeepSeek API key (stored only in this browser, sent only to api.deepseek.com):</span>
          <input
            type="password"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            placeholder="sk-…"
            className="flex-1 min-w-[200px] rounded-lg border border-line bg-bg-raised px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          />
          <button
            className="btn-primary"
            onClick={() => {
              if (keyInput.trim()) {
                setApiKey(keyInput.trim())
                setShowKey(false)
                runAi()
              }
            }}
          >
            Save & run
          </button>
        </div>
      )}

      {/* CARO card */}
      <CaroCard caro={base.caro} />

      {/* severity summary */}
      <div className="flex flex-wrap gap-2">
        <Pill tone={counts.high ? 'bad' : 'good'}><AlertTriangle size={12} /> {counts.high} high</Pill>
        <Pill tone={counts.medium ? 'warn' : 'good'}>{counts.medium} medium</Pill>
        <Pill tone="neutral">{counts.low} low</Pill>
        {aiFindings.length > 0 && <Pill tone="accent"><Sparkles size={12} /> {aiFindings.length} AI-assisted</Pill>}
      </div>

      {/* findings */}
      <div className="space-y-2.5">
        {all.map((f, i) => <FindingCard key={f.id + i} f={f} index={i} />)}
      </div>
    </div>
  )
}

function CaroCard({ caro }: { caro: ReturnType<typeof caroApplicability> }) {
  return (
    <div className="panel p-4">
      <div className="flex items-center gap-2 mb-3">
        <h3 className="text-sm font-semibold">CARO 2020 applicability</h3>
        <Pill tone={caro.likelyExempt ? 'good' : 'warn'}>{caro.likelyExempt ? 'Likely exempt' : 'Likely applicable'}</Pill>
      </div>
      <div className="grid sm:grid-cols-3 gap-3 text-sm">
        <CaroLine label="Capital + Reserves" value={caro.paidUpPlusReserves} ok={caro.capitalUnderCrore} limit="≤ ₹1 Cr" />
        <CaroLine label="Borrowings" value={caro.borrowings} ok={caro.borrowingsUnderCrore} limit="≤ ₹1 Cr" />
        <CaroLine label="Revenue" value={caro.revenue} ok={caro.revenueUnderTenCrore} limit="≤ ₹10 Cr" />
      </div>
      <p className="text-xs text-ink-faint mt-3">
        Exemption under para 1(2) needs the entity to be a private company meeting all three thresholds. Confirm company class before relying on this.
      </p>
    </div>
  )
}

function CaroLine({ label, value, ok, limit }: { label: string; value: number; ok: boolean; limit: string }) {
  return (
    <div className="panel-raised p-3">
      <div className="text-[11px] uppercase tracking-wider text-ink-faint">{label}</div>
      <div className="text-base font-semibold nums">{formatINR(value as never)}</div>
      <div className={cn('text-xs', ok ? 'text-good' : 'text-warn')}>{ok ? '✓' : '✗'} {limit}</div>
    </div>
  )
}

function FindingCard({ f, index }: { f: ReviewFinding; index: number }) {
  const [open, setOpen] = useState(false)
  const Icon = f.severity === 'info' ? Info : AlertTriangle
  const color = f.severity === 'high' ? 'text-bad' : f.severity === 'medium' ? 'text-warn' : f.severity === 'low' ? 'text-ink-muted' : 'text-accent'
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.02 }} className="panel-raised overflow-hidden">
      <button onClick={() => f.drill.length && setOpen((o) => !o)} className={cn('w-full flex items-start gap-3 px-4 py-3 text-left', f.drill.length && 'hover:bg-bg-hover')}>
        <Icon size={16} className={cn('mt-0.5 shrink-0', color)} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm">{f.title}</span>
            <span className="text-[10px] uppercase text-ink-faint">{f.area}</span>
            {f.aiAssisted && <span className="chip border-accent/30 bg-accent-soft text-accent-hover text-[10px]"><Sparkles size={10} /> AI</span>}
          </div>
          <div className="text-xs text-ink-muted mt-0.5">{f.detail}</div>
        </div>
        {f.drill.length > 0 && <ChevronDown size={15} className={cn('text-ink-faint transition-transform shrink-0', open && 'rotate-180')} />}
      </button>
      {open && f.drill.length > 0 && (
        <div className="border-t border-line/60 px-4 py-2 bg-bg-base/40 text-xs text-ink-muted space-y-0.5">
          {f.drill.map((d, i) => <div key={i}>{d}</div>)}
        </div>
      )}
    </motion.div>
  )
}
