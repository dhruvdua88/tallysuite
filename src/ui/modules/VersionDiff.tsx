import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import {
  GitCompareArrows,
  TriangleAlert,
  ShieldCheck,
  Plus,
  Minus,
  PencilLine,
  ChevronRight,
  X,
  Eye,
  EyeOff,
  FileSpreadsheet,
  Search,
  Flag,
} from 'lucide-react'
import { useStore, type Slot } from '../../state/store'
import {
  diffVersions,
  describeChange,
  RISK_LABELS,
  type VersionDiff as VDiff,
  type DiffTBRow,
  type VoucherChange,
  type ChangeKind,
} from '../../core/m2-versiondiff/diff'
import { formatINR, type Paise } from '../../core/model/money'
import { Money } from '../components/atoms'
import { formatDate, fyLabel } from '../lib/format'
import { heatStyle, magnitudeBucket } from '../lib/heat'
import { cn } from '../lib/cn'

export function VersionDiff() {
  const { slots, diffV1, diffV2, setDiff } = useStore()
  const v1 = slots.find((s) => s.id === diffV1)
  const v2 = slots.find((s) => s.id === diffV2)

  const diff = useMemo<VDiff | null>(() => {
    if (!v1 || !v2 || v1.id === v2.id) return null
    return diffVersions(v1.dataset, v2.dataset)
  }, [v1, v2])

  return (
    <div className="mx-auto max-w-[1100px] space-y-5">
      <div className="flex items-center gap-2.5">
        <GitCompareArrows size={20} className="text-accent" />
        <h2 className="serif text-2xl font-semibold tracking-tight">Version Diff</h2>
        <span className="text-sm text-ink-faint">— compare two ZIP files for the same period</span>
      </div>

      <div className="panel p-4 flex flex-wrap items-end gap-3">
        <SlotPicker label="Before (V1)" value={diffV1} onChange={(id) => setDiff('v1', id)} />
        <ChevronRight className="text-ink-faint mb-2" />
        <SlotPicker label="After (V2)" value={diffV2} onChange={(id) => setDiff('v2', id)} />
        {slots.length < 2 && (
          <span className="text-xs text-ink-faint ml-2 mb-2">Load two exports of the same company to diff.</span>
        )}
      </div>

      {!diff && v1 && v2 && v1.id === v2.id && <Empty msg="Pick two different datasets." />}
      {!diff && (!v1 || !v2) && <Empty msg="Select a Before and After dataset above." />}

      {diff && v1 && v2 && <DiffBody diff={diff} v1={v1} v2={v2} />}
    </div>
  )
}

function DiffBody({ diff, v1, v2 }: { diff: VDiff; v1: Slot; v2: Slot }) {
  const [showUnchanged, setShowUnchanged] = useState(false)
  const [selected, setSelected] = useState<DiffTBRow | null>(null)
  const [kinds, setKinds] = useState<Set<ChangeKind>>(new Set())
  const [riskOnly, setRiskOnly] = useState(false)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)

  const toggleKind = (k: ChangeKind) =>
    setKinds((prev) => {
      const n = new Set(prev)
      n.has(k) ? n.delete(k) : n.add(k)
      return n
    })
  const kindActive = (k: ChangeKind) => kinds.size === 0 || kinds.has(k)

  const q = query.trim().toLowerCase()

  // TB-diff rows filtered by search; optionally only ledgers touched by the
  // active change-kind filter.
  const guidsForActiveKinds = useMemo(() => {
    if (kinds.size === 0) return null
    const set = new Set<string>()
    for (const c of diff.voucherChanges) if (kinds.has(c.kind)) set.add(c.guid)
    return set
  }, [kinds, diff.voucherChanges])

  const tbRows = (showUnchanged ? diff.tbRows : diff.changedRows).filter((r) => {
    if (q && !r.name.toLowerCase().includes(q) && !r.group.toLowerCase().includes(q)) return false
    if (guidsForActiveKinds && !r.contributingGuids.some((g) => guidsForActiveKinds.has(g))) return false
    return true
  })

  // heatmap intensity baseline: largest movement across all changed ledgers,
  // stable regardless of the active search/kind filter.
  const maxAbs = useMemo(() => diff.changedRows.reduce((m, r) => Math.max(m, Math.abs(r.delta)), 0), [diff.changedRows])

  const changes = diff.voucherChanges.filter((c) => {
    if (!kindActive(c.kind)) return false
    if (riskOnly && c.risks.length === 0) return false
    if (q) {
      const v = c.v2 ?? c.v1
      const hay = `${v?.voucherType} ${v?.voucherNumber} ${v?.partyName} ${v?.narration}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })

  async function onExport() {
    setBusy(true)
    try {
      const { exportTables } = await import('../../io/excel')
      const tb = diff.changedRows.map((r) => ({
        ledger: r.name,
        group: r.group,
        v1: r.v1Movement / 100,
        v2: r.v2Movement / 100,
        delta: r.delta / 100,
        vouchers: r.contributingGuids.length,
      }))
      const vch = diff.voucherChanges.map((c) => {
        const v = c.v2 ?? c.v1
        const net = c.lineDiffs.reduce((s, l) => s + Math.abs((l.after ?? 0) - (l.before ?? 0)), 0) / 2 / 100
        return {
          kind: c.kind,
          vtype: v?.voucherType ?? '',
          vno: v?.voucherNumber ?? '',
          date: v?.date ?? '',
          party: v?.partyName ?? '',
          net,
          risks: c.risks.map((r) => RISK_LABELS[r]).join('; '),
        }
      })
      const cols = [
        { header: 'Change', key: 'kind', width: 10 },
        { header: 'Voucher Type', key: 'vtype', width: 16 },
        { header: 'Voucher No', key: 'vno', width: 14 },
        { header: 'Date', key: 'date', width: 12 },
        { header: 'Party', key: 'party', width: 28 },
        { header: 'Net Amount', key: 'net', width: 16, money: true },
        { header: 'Risk Flags', key: 'risks', width: 40 },
      ]
      await exportTables(
        [
          {
            name: 'TB of Differences',
            columns: [
              { header: 'Ledger', key: 'ledger', width: 34 },
              { header: 'Group', key: 'group', width: 24 },
              { header: `V1 Movement - ${v1.dataset.meta.sourceFile}`, key: 'v1', width: 28, money: true },
              { header: `V2 Movement - ${v2.dataset.meta.sourceFile}`, key: 'v2', width: 28, money: true },
              { header: 'Δ', key: 'delta', width: 16, money: true },
              { header: 'Vouchers', key: 'vouchers', width: 10 },
            ],
            rows: tb,
          },
          { name: 'Voucher Changes', columns: cols, rows: vch },
          { name: 'Risk Register', columns: cols, rows: vch.filter((r) => r.risks) },
          {
            name: 'Metadata',
            columns: [
              { header: 'Field', key: 'k', width: 28 },
              { header: 'Value', key: 'v', width: 60 },
            ],
            rows: [
              { k: 'V1 file', v: v1.dataset.meta.sourceFile },
              { k: 'V1 SHA-256', v: v1.dataset.meta.contentHash },
              { k: 'V1 period', v: `${v1.dataset.meta.periodFrom} → ${v1.dataset.meta.periodTo}` },
              { k: 'V1 AlterID (txn)', v: String(diff.guard.v1AlterIdTxn ?? '') },
              { k: 'V2 file', v: v2.dataset.meta.sourceFile },
              { k: 'V2 SHA-256', v: v2.dataset.meta.contentHash },
              { k: 'V2 period', v: `${v2.dataset.meta.periodFrom} → ${v2.dataset.meta.periodTo}` },
              { k: 'V2 AlterID (txn)', v: String(diff.guard.v2AlterIdTxn ?? '') },
              { k: 'Same company', v: diff.guard.sameCompany ? 'Yes' : 'No' },
              { k: 'Added / Deleted / Modified', v: `${diff.counts.added} / ${diff.counts.deleted} / ${diff.counts.modified}` },
              { k: 'Σ Δ (balances?)', v: `${formatINR(diff.sumDelta)} (${diff.balanced ? 'balanced' : 'UNBALANCED'})` },
            ],
          },
        ],
        'Version-Diff-Tamper-Report.xlsx',
      )
      toast.success('Tamper report exported')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Export failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <GuardBanner diff={diff} />
        <button className="btn-primary shrink-0" onClick={onExport} disabled={busy}>
          <FileSpreadsheet size={16} /> {busy ? 'Exporting…' : 'Export'}
        </button>
      </div>

      {/* clickable counters = change-type filter */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Counter icon={Plus} label="Added" n={diff.counts.added} tone="credit" active={kindActive('added')} dim={kinds.size > 0 && !kinds.has('added')} onClick={() => toggleKind('added')} />
        <Counter icon={Minus} label="Deleted" n={diff.counts.deleted} tone="debit" active={kindActive('deleted')} dim={kinds.size > 0 && !kinds.has('deleted')} onClick={() => toggleKind('deleted')} />
        <Counter icon={PencilLine} label="Modified" n={diff.counts.modified} tone="delta" active={kindActive('modified')} dim={kinds.size > 0 && !kinds.has('modified')} onClick={() => toggleKind('modified')} />
        <Counter icon={ShieldCheck} label="Unchanged" n={diff.counts.unchanged} tone="muted" active onClick={() => {}} />
      </div>

      {/* filter bar */}
      <div className="panel px-3 py-2.5 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 flex-1 min-w-[200px]">
          <Search size={15} className="text-ink-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search ledger, party, voucher…"
            className="flex-1 bg-transparent text-sm focus:outline-none"
          />
        </div>
        <button
          onClick={() => setRiskOnly((r) => !r)}
          className={cn('chip cursor-pointer', riskOnly ? 'border-bad/40 bg-bad/10 text-bad' : 'hover:bg-bg-hover')}
        >
          <Flag size={12} /> Flagged only
        </button>
        {(kinds.size > 0 || riskOnly || query) && (
          <button onClick={() => { setKinds(new Set()); setRiskOnly(false); setQuery('') }} className="chip cursor-pointer hover:bg-bg-hover">
            <X size={12} /> Clear
          </button>
        )}
      </div>

      {/* TB of Differences — full width */}
      <section className="panel overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-line">
          <div className="flex items-center gap-4">
            <h3 className="serif text-lg font-semibold">Trial Balance of Differences</h3>
            <span className="hidden sm:flex items-center gap-1.5 text-[11px] text-ink-faint">
              <span className="inline-block h-3 w-3 rounded-[3px]" style={{ background: '#97C459' }} />
              <span className="inline-block h-3 w-3 rounded-[3px]" style={{ background: '#F09595' }} />
              Δ shaded by size
            </span>
          </div>
          <button className="btn-ghost text-xs" onClick={() => setShowUnchanged((s) => !s)}>
            {showUnchanged ? <EyeOff size={14} /> : <Eye size={14} />}
            {showUnchanged ? 'Hide unchanged' : `Show all ${diff.tbRows.length}`}
          </button>
        </div>
        <div className="max-h-[55vh] overflow-y-auto overflow-x-auto">
          <table className="fin">
            <thead>
              <tr>
                <th>Ledger</th>
                <th className="num">V1 Movement</th>
                <th className="num">V2 Movement</th>
                <th className="num">Δ</th>
                <th className="num">Vch</th>
              </tr>
            </thead>
            <tbody>
              {tbRows.map((r) => (
                <tr
                  key={r.key}
                  onClick={() => r.delta !== 0 && setSelected(r)}
                  className={cn(r.delta !== 0 && 'cursor-pointer', r.delta !== 0 && 'bg-delta/[0.05]')}
                >
                  <td>
                    <div className="font-medium">{r.name}</div>
                    <div className="text-[11px] text-ink-faint">{r.group}</div>
                  </td>
                  <td className="num"><Money value={r.v1Movement} /></td>
                  <td className="num"><Money value={r.v2Movement} /></td>
                  {(() => {
                    const st = heatStyle(magnitudeBucket(r.delta, maxAbs))
                    return (
                      <td className="num" style={{ background: st.bg, color: r.delta === 0 ? undefined : st.fg }}>
                        <Money value={r.delta} signed className={r.delta === 0 ? undefined : '!text-inherit'} />
                      </td>
                    )
                  })()}
                  <td className="num text-ink-faint">{r.contributingGuids.length || ''}</td>
                </tr>
              ))}
              {tbRows.length === 0 && (
                <tr><td className="text-ink-muted px-5 py-4" colSpan={5}>No matching differences.</td></tr>
              )}
            </tbody>
            <tfoot className="sticky bottom-0 bg-bg-panel">
              <tr className="total">
                <td>Σ Δ {diff.balanced ? '— differences balance ✓' : '— UNBALANCED'}</td>
                <td className="num" />
                <td className="num" />
                <td className={cn('num', diff.balanced ? 'text-good' : 'text-bad')}>{formatINR(diff.sumDelta)}</td>
                <td className="num" />
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      {/* Changed vouchers — full width, filtered */}
      <section className="panel p-4">
        <h3 className="mb-3 text-sm font-semibold">
          Changed vouchers <span className="text-ink-faint">({changes.length}{changes.length !== diff.voucherChanges.length ? ` of ${diff.voucherChanges.length}` : ''})</span>
        </h3>
        <div className="grid gap-2 sm:grid-cols-2 max-h-[55vh] overflow-y-auto pr-1">
          {changes.map((c) => <ChangeRow key={c.guid} c={c} />)}
          {changes.length === 0 && <div className="text-sm text-ink-muted">No vouchers match the current filters.</div>}
        </div>
      </section>

      {/* ledger drawer */}
      {selected && <LedgerDrawer row={selected} diff={diff} onClose={() => setSelected(null)} />}
    </>
  )
}

function GuardBanner({ diff }: { diff: VDiff }) {
  const g = diff.guard
  const danger = !g.sameCompany || !g.periodsMatch
  return (
    <div className={cn('panel px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm flex-1', danger && 'border-bad/40 bg-bad/5')}>
      {!g.sameCompany ? (
        <span className="flex items-center gap-2 text-bad font-medium"><TriangleAlert size={16} /> Different companies — diff may be meaningless</span>
      ) : !g.periodsMatch ? (
        <span className="flex items-center gap-2 text-bad font-medium"><TriangleAlert size={16} /> Periods differ — use Year-on-Year for period comparison</span>
      ) : (
        <span className="flex items-center gap-2 text-good font-medium"><ShieldCheck size={16} /> Same company and same period</span>
      )}
      <span className="text-ink-muted">Period: {g.v1Period}</span>
      {g.alterIdTxnMoved && (
        <span className="chip border-warn/40 bg-warn/10 text-warn">AlterID {g.v1AlterIdTxn?.toLocaleString()} → {g.v2AlterIdTxn?.toLocaleString()}</span>
      )}
    </div>
  )
}

function Counter({
  icon: Icon,
  label,
  n,
  tone,
  active,
  dim,
  onClick,
}: {
  icon: typeof Plus
  label: string
  n: number
  tone: 'credit' | 'debit' | 'delta' | 'muted'
  active: boolean
  dim?: boolean
  onClick: () => void
}) {
  const color = { credit: 'text-credit', debit: 'text-debit', delta: 'text-delta', muted: 'text-ink-muted' }[tone]
  return (
    <button
      onClick={onClick}
      className={cn(
        'panel p-4 flex items-center gap-3 text-left transition-all',
        tone !== 'muted' && 'hover:border-accent/40',
        active && tone !== 'muted' && (dim ? '' : 'ring-1 ring-accent/30'),
        dim && 'opacity-45',
      )}
    >
      <Icon size={18} className={color} />
      <div>
        <div className={cn('text-xl font-bold nums', color)}>{n.toLocaleString()}</div>
        <div className="text-xs text-ink-faint">{label}</div>
      </div>
    </button>
  )
}

function ChangeRow({ c }: { c: VoucherChange }) {
  const [open, setOpen] = useState(false)
  const kindTone = c.kind === 'added' ? 'good' : c.kind === 'deleted' ? 'bad' : 'warn'
  const toneCls = { good: 'border-good/40 text-good bg-good/10', bad: 'border-bad/40 text-bad bg-bad/10', warn: 'border-warn/40 text-warn bg-warn/10' }[kindTone]
  return (
    <div className="panel-raised overflow-hidden h-fit">
      <button onClick={() => setOpen((o) => !o)} className="w-full px-3 py-2 text-left hover:bg-bg-hover">
        <div className="flex items-center gap-2">
          <span className={cn('chip', toneCls)}>{c.kind}</span>
          <span className="text-sm flex-1 truncate">{describeChange(c)}</span>
        </div>
        {c.risks.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {c.risks.map((r) => <span key={r} className="chip border-bad/30 bg-bad/10 text-bad text-[10px]">{RISK_LABELS[r]}</span>)}
          </div>
        )}
      </button>
      {open && (
        <div className="border-t border-line/60 px-3 py-2 text-xs space-y-2 bg-bg-base/40">
          {c.fieldDiffs.length > 0 && (
            <div>
              <div className="text-ink-faint mb-1">Header changes</div>
              {c.fieldDiffs.map((f) => (
                <div key={f.field} className="flex items-center gap-2 py-0.5">
                  <span className="w-24 text-ink-muted shrink-0">{f.field}</span>
                  <span className="text-debit line-through truncate">{f.before ?? '∅'}</span>
                  <ChevronRight size={11} className="text-ink-faint shrink-0" />
                  <span className="text-credit truncate">{f.after ?? '∅'}</span>
                </div>
              ))}
            </div>
          )}
          <div>
            <div className="text-ink-faint mb-1">Line movements</div>
            {c.lineDiffs.map((l) => (
              <div key={l.ledgerKey} className="flex items-center justify-between py-0.5">
                <span className="truncate max-w-[140px]">{l.ledger}</span>
                <span className="flex items-center gap-2 nums">
                  <span className="text-ink-faint">{l.before == null ? '∅' : formatINR(l.before)}</span>
                  <ChevronRight size={11} className="text-ink-faint" />
                  <span>{l.after == null ? '∅' : formatINR(l.after)}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function LedgerDrawer({ row, diff, onClose }: { row: DiffTBRow; diff: VDiff; onClose: () => void }) {
  const contributing = diff.voucherChanges.filter((c) => row.contributingGuids.includes(c.guid))
  return (
    <div className="fixed inset-0 z-40 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30" />
      <motion.div
        initial={{ x: 40, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ duration: 0.2 }}
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-md h-full bg-bg-panel border-l border-line shadow-pop overflow-y-auto p-5"
      >
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="serif text-lg font-semibold">{row.name}</h3>
            <div className="text-xs text-ink-faint">{row.group}</div>
          </div>
          <button className="btn-ghost p-1" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="grid grid-cols-3 gap-2 mb-4 text-center">
          <MiniStat label="V1" value={row.v1Movement} />
          <MiniStat label="V2" value={row.v2Movement} />
          <MiniStat label="Δ" value={row.delta} highlight />
        </div>
        <div className="text-xs text-ink-faint mb-2">{contributing.length} contributing voucher{contributing.length === 1 ? '' : 's'}</div>
        <div className="space-y-2">
          {contributing.map((c) => <ChangeRow key={c.guid} c={c} />)}
        </div>
      </motion.div>
    </div>
  )
}

function MiniStat({ label, value, highlight }: { label: string; value: Paise; highlight?: boolean }) {
  return (
    <div className={cn('panel-raised py-2', highlight && 'border-delta/40 bg-delta/5')}>
      <div className="text-[10px] uppercase text-ink-faint">{label}</div>
      <div className="text-sm font-semibold"><Money value={value} colorByDirection={highlight} signed={highlight} /></div>
    </div>
  )
}

function SlotPicker({ label, value, onChange }: { label: string; value: string | null; onChange: (id: string) => void }) {
  const slots = useStore((s) => s.slots)
  return (
    <label className="flex min-w-[280px] flex-1 flex-col gap-1">
      <span className="text-[11px] uppercase tracking-wide text-ink-faint">{label}</span>
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-line bg-bg-raised px-3 py-2 text-sm text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
      >
        <option value="" disabled>select…</option>
        {slots.map((s) => (
          <option key={s.id} value={s.id}>
            {s.dataset.meta.company} · {fyLabel(s.dataset.meta.periodFrom, s.dataset.meta.periodTo) || formatDate(s.dataset.meta.periodTo)} · {s.dataset.meta.sourceFile}
          </option>
        ))}
      </select>
    </label>
  )
}

function Empty({ msg }: { msg: string }) {
  return <div className="panel grid place-items-center py-16 text-sm text-ink-muted">{msg}</div>
}
