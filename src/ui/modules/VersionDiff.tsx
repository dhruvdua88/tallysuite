import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
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
} from 'lucide-react'
import { useStore } from '../../state/store'
import {
  diffVersions,
  describeChange,
  RISK_LABELS,
  type VersionDiff as VDiff,
  type DiffTBRow,
  type VoucherChange,
} from '../../core/m2-versiondiff/diff'
import { formatINR, type Paise } from '../../core/model/money'
import { Money, Pill } from '../components/atoms'
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
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex items-center gap-2">
        <GitCompareArrows size={20} className="text-accent" />
        <h2 className="text-xl font-bold tracking-tight">Version Diff</h2>
        <span className="text-sm text-ink-faint">— Differential Trial Balance</span>
      </div>

      {/* selectors */}
      <div className="panel p-4 flex flex-wrap items-center gap-3">
        <SlotPicker label="Before (V1)" value={diffV1} onChange={(id) => setDiff('v1', id)} />
        <ChevronRight className="text-ink-faint" />
        <SlotPicker label="After (V2)" value={diffV2} onChange={(id) => setDiff('v2', id)} />
        {slots.length < 2 && (
          <span className="text-xs text-ink-faint ml-2">Load two exports of the same company to diff.</span>
        )}
      </div>

      {!diff && v1 && v2 && v1.id === v2.id && (
        <Empty msg="Pick two different datasets." />
      )}
      {!diff && (!v1 || !v2) && <Empty msg="Select a Before and After dataset above." />}

      {diff && <DiffBody diff={diff} />}
    </div>
  )
}

function DiffBody({ diff }: { diff: VDiff }) {
  const [showUnchanged, setShowUnchanged] = useState(false)
  const [selected, setSelected] = useState<DiffTBRow | null>(null)
  const rows = showUnchanged ? diff.tbRows : diff.changedRows

  return (
    <>
      {/* guard banner */}
      <GuardBanner diff={diff} />

      {/* counters */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Counter icon={Plus} label="Added" n={diff.counts.added} tone="credit" />
        <Counter icon={Minus} label="Deleted" n={diff.counts.deleted} tone="debit" />
        <Counter icon={PencilLine} label="Modified" n={diff.counts.modified} tone="delta" />
        <Counter icon={ShieldCheck} label="Unchanged" n={diff.counts.unchanged} tone="muted" />
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        {/* TB-Diff table */}
        <section className="panel overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-line">
            <h3 className="text-sm font-semibold">Trial Balance of Differences</h3>
            <button
              className="btn-ghost text-xs"
              onClick={() => setShowUnchanged((s) => !s)}
            >
              {showUnchanged ? <EyeOff size={14} /> : <Eye size={14} />}
              {showUnchanged ? 'Hide unchanged' : `Show all ${diff.tbRows.length}`}
            </button>
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            <table className="w-full">
              <thead className="sticky top-0 bg-bg-panel z-10">
                <tr>
                  <th className="th">Ledger</th>
                  <th className="th text-right">V1 movement</th>
                  <th className="th text-right">V2 movement</th>
                  <th className="th text-right">Δ</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.key}
                    onClick={() => r.delta !== 0 && setSelected(r)}
                    className={cn(
                      'transition-colors',
                      r.delta !== 0 && 'cursor-pointer hover:bg-bg-hover',
                      r.delta !== 0 && 'bg-delta/[0.04]',
                    )}
                  >
                    <td className="td">
                      <div className="font-medium truncate max-w-[260px]">{r.name}</div>
                      <div className="text-[11px] text-ink-faint truncate max-w-[260px]">{r.group}</div>
                    </td>
                    <td className="td text-right"><Money value={r.v1Movement} /></td>
                    <td className="td text-right"><Money value={r.v2Movement} /></td>
                    <td className="td text-right">
                      <Money value={r.delta} colorByDirection signed />
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td className="td text-ink-muted" colSpan={4}>
                      No differences. The books are identical between these two exports.
                    </td>
                  </tr>
                )}
              </tbody>
              <tfoot className="sticky bottom-0 bg-bg-panel">
                <tr className="border-t-2 border-line-strong">
                  <td className="td font-semibold">
                    Σ Δ {diff.balanced ? '— differences balance ✓' : '— UNBALANCED'}
                  </td>
                  <td className="td" />
                  <td className="td" />
                  <td className={cn('td text-right font-bold nums', diff.balanced ? 'text-good' : 'text-bad')}>
                    {formatINR(diff.sumDelta)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>

        {/* detail / changes list */}
        <section className="panel p-4">
          {selected ? (
            <LedgerDetail row={selected} diff={diff} onClose={() => setSelected(null)} />
          ) : (
            <ChangeList changes={diff.voucherChanges} />
          )}
        </section>
      </div>
    </>
  )
}

function GuardBanner({ diff }: { diff: VDiff }) {
  const g = diff.guard
  const danger = !g.sameCompany
  return (
    <div
      className={cn(
        'panel px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm',
        danger && 'border-bad/40 bg-bad/5',
      )}
    >
      {danger ? (
        <span className="flex items-center gap-2 text-bad font-medium">
          <TriangleAlert size={16} /> Different companies — diff may be meaningless
        </span>
      ) : (
        <span className="flex items-center gap-2 text-good font-medium">
          <ShieldCheck size={16} /> Same company
        </span>
      )}
      <span className="text-ink-muted">
        Periods: {g.periodsMatch ? 'match' : <span className="text-warn">differ ({g.v1Period} vs {g.v2Period})</span>}
      </span>
      {g.alterIdTxnMoved && (
        <Pill tone="warn">
          AlterID moved {g.v1AlterIdTxn?.toLocaleString()} → {g.v2AlterIdTxn?.toLocaleString()}
        </Pill>
      )}
    </div>
  )
}

function Counter({
  icon: Icon,
  label,
  n,
  tone,
}: {
  icon: typeof Plus
  label: string
  n: number
  tone: 'credit' | 'debit' | 'delta' | 'muted'
}) {
  const color = {
    credit: 'text-credit',
    debit: 'text-debit',
    delta: 'text-delta',
    muted: 'text-ink-muted',
  }[tone]
  return (
    <div className="panel p-4 flex items-center gap-3">
      <Icon size={18} className={color} />
      <div>
        <div className={cn('text-xl font-bold nums', color)}>{n.toLocaleString()}</div>
        <div className="text-xs text-ink-faint">{label}</div>
      </div>
    </div>
  )
}

function ChangeList({ changes }: { changes: VoucherChange[] }) {
  return (
    <div>
      <h3 className="mb-3 text-sm font-semibold">Changed vouchers ({changes.length})</h3>
      <div className="space-y-2 max-h-[56vh] overflow-y-auto pr-1">
        {changes.map((c) => (
          <ChangeRow key={c.guid} c={c} />
        ))}
        {changes.length === 0 && (
          <div className="text-sm text-ink-muted">No voucher changes between these versions.</div>
        )}
      </div>
    </div>
  )
}

function ChangeRow({ c }: { c: VoucherChange }) {
  const [open, setOpen] = useState(false)
  const kindTone = c.kind === 'added' ? 'good' : c.kind === 'deleted' ? 'bad' : 'warn'
  return (
    <div className="panel-raised overflow-hidden">
      <button onClick={() => setOpen((o) => !o)} className="w-full px-3 py-2 text-left hover:bg-bg-hover">
        <div className="flex items-center gap-2">
          <Pill tone={kindTone as 'good' | 'bad' | 'warn'}>{c.kind}</Pill>
          <span className="text-sm flex-1 truncate">{describeChange(c)}</span>
        </div>
        {c.risks.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {c.risks.map((r) => (
              <span key={r} className="chip border-bad/30 bg-bad/10 text-bad text-[10px]">
                {RISK_LABELS[r]}
              </span>
            ))}
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

function LedgerDetail({
  row,
  diff,
  onClose,
}: {
  row: DiffTBRow
  diff: VDiff
  onClose: () => void
}) {
  const contributing = diff.voucherChanges.filter((c) => row.contributingGuids.includes(c.guid))
  return (
    <motion.div initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }}>
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold">{row.name}</h3>
          <div className="text-xs text-ink-faint">{row.group}</div>
        </div>
        <button className="btn-ghost p-1" onClick={onClose}>
          <X size={16} />
        </button>
      </div>
      <div className="grid grid-cols-3 gap-2 mb-4 text-center">
        <MiniStat label="V1" value={row.v1Movement} />
        <MiniStat label="V2" value={row.v2Movement} />
        <MiniStat label="Δ" value={row.delta} highlight />
      </div>
      <div className="text-xs text-ink-faint mb-2">
        {contributing.length} contributing voucher{contributing.length === 1 ? '' : 's'}
      </div>
      <div className="space-y-2 max-h-[44vh] overflow-y-auto pr-1">
        {contributing.map((c) => (
          <ChangeRow key={c.guid} c={c} />
        ))}
      </div>
    </motion.div>
  )
}

function MiniStat({ label, value, highlight }: { label: string; value: Paise; highlight?: boolean }) {
  return (
    <div className={cn('panel-raised py-2', highlight && 'border-delta/40 bg-delta/5')}>
      <div className="text-[10px] uppercase text-ink-faint">{label}</div>
      <div className="text-sm font-semibold">
        <Money value={value} colorByDirection={highlight} signed={highlight} />
      </div>
    </div>
  )
}

function SlotPicker({
  label,
  value,
  onChange,
}: {
  label: string
  value: string | null
  onChange: (id: string) => void
}) {
  const slots = useStore((s) => s.slots)
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] uppercase tracking-wider text-ink-faint">{label}</span>
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-line bg-bg-raised px-3 py-2 text-sm text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 min-w-[200px]"
      >
        <option value="" disabled>
          select…
        </option>
        {slots.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name} ({s.dataset.meta.periodTo})
          </option>
        ))}
      </select>
    </label>
  )
}

function Empty({ msg }: { msg: string }) {
  return (
    <div className="panel grid place-items-center py-16 text-sm text-ink-muted">{msg}</div>
  )
}
