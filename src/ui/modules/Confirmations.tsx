import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { FileSignature, FileSpreadsheet, FileText, AlertTriangle } from 'lucide-react'
import { useActiveSlot } from '../../state/store'
import {
  buildConfirmations,
  confirmAmount,
  summarize,
  type ConfirmationParty,
  type ConfirmSource,
  type PartyKind,
} from '../../core/m1-confirmations/confirmations'
import { paise } from '../../core/model/money'
import { Money } from '../components/atoms'
import { cn } from '../lib/cn'

const FIRM = {
  firmName: 'Dhruv Dua & Co.',
  firmLine2: 'Chartered Accountants · FRN 028145N',
  place: 'New Delhi',
  partnerName: 'Dhruv Dua',
  membershipNo: '531607',
}

export function Confirmations() {
  const slot = useActiveSlot()
  const [kinds, setKinds] = useState<PartyKind[]>(['debtor', 'creditor'])
  const [materialityRs, setMaterialityRs] = useState(0)
  const [parties, setParties] = useState<ConfirmationParty[]>([])

  const computed = useMemo(() => {
    if (!slot) return []
    return buildConfirmations(slot.dataset, { kinds, materiality: paise(materialityRs * 100) })
  }, [slot, kinds, materialityRs])

  useEffect(() => setParties(computed), [computed])

  const summary = summarize(parties)
  const setSource = (key: string, source: ConfirmSource) =>
    setParties((prev) => prev.map((p) => (p.key === key ? { ...p, source } : p)))

  const [busy, setBusy] = useState<string | null>(null)

  async function exportLetters() {
    if (!slot) return
    setBusy('letters')
    try {
      const { exportConfirmationLetters } = await import('../../io/word')
      await exportConfirmationLetters(parties, {
        ...FIRM,
        companyName: slot.dataset.meta.company,
        periodTo: slot.dataset.meta.periodTo ?? '',
      })
      toast.success(`${summary.included} confirmation letters generated`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed')
    } finally {
      setBusy(null)
    }
  }

  async function exportExcel() {
    setBusy('excel')
    try {
      const { exportTables } = await import('../../io/excel')
      await exportTables(
        [
          {
            name: 'Confirmations',
            columns: [
              { header: 'Party', key: 'party', width: 36 },
              { header: 'Type', key: 'kind', width: 10 },
              { header: 'Dr/Cr', key: 'drcr', width: 8 },
              { header: 'Ledger Closing', key: 'ledger', width: 18, money: true },
              { header: 'Bill Total', key: 'bills', width: 18, money: true },
              { header: 'Difference', key: 'diff', width: 16, money: true },
              { header: 'Source', key: 'source', width: 12 },
              { header: 'Confirm Amount', key: 'amount', width: 18, money: true },
              { header: 'Email', key: 'email', width: 26 },
            ],
            rows: parties.map((p) => ({
              party: p.name,
              kind: p.kind,
              drcr: p.drCr,
              ledger: p.ledgerClosing / 100,
              bills: p.billwiseAvailable ? p.billTotal / 100 : null,
              diff: p.billwiseAvailable ? p.diff / 100 : null,
              source: p.source,
              amount: confirmAmount(p) / 100,
              email: p.email ?? '',
            })),
          },
        ],
        'Confirmation-Tracker.xlsx',
      )
      toast.success('Tracker exported')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed')
    } finally {
      setBusy(null)
    }
  }

  if (!slot) return null

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <FileSignature size={20} className="text-accent" />
          <h2 className="text-xl font-bold tracking-tight">Confirmations</h2>
          <span className="text-sm text-ink-faint">— balance confirmation studio</span>
        </div>
        <div className="flex gap-2">
          <button className="btn-soft" onClick={exportExcel} disabled={busy !== null}>
            <FileSpreadsheet size={16} /> Tracker
          </button>
          <button className="btn-primary" onClick={exportLetters} disabled={busy !== null || summary.included === 0}>
            <FileText size={16} /> {busy === 'letters' ? 'Generating…' : `Letters (${summary.included})`}
          </button>
        </div>
      </div>

      {/* controls */}
      <div className="panel p-4 flex flex-wrap items-center gap-4">
        <div className="flex gap-2">
          {(['debtor', 'creditor'] as PartyKind[]).map((k) => {
            const on = kinds.includes(k)
            return (
              <button
                key={k}
                onClick={() => setKinds((prev) => (on ? prev.filter((x) => x !== k) : [...prev, k]))}
                className={cn('btn', on ? 'bg-accent-soft text-accent-hover border border-accent/30' : 'btn-ghost')}
              >
                {k === 'debtor' ? 'Debtors' : 'Creditors'}
              </button>
            )
          })}
        </div>
        <label className="flex items-center gap-2 text-sm text-ink-muted">
          Materiality ≥ ₹
          <input
            type="number"
            value={materialityRs}
            onChange={(e) => setMaterialityRs(Number(e.target.value) || 0)}
            className="w-28 rounded-lg border border-line bg-bg-raised px-2 py-1.5 text-sm nums focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          />
        </label>
      </div>

      {/* summary */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Mini label="Parties" value={summary.total} />
        <Mini label="Bill-wise" value={summary.billwise} tone="good" />
        <Mini label="Ledger-only" value={summary.ledgerOnly} />
        <Mini label="Mismatches" value={summary.mismatches} tone={summary.mismatches ? 'bad' : 'good'} />
        <Mini label="Excluded" value={summary.excluded} />
      </div>

      {/* grid */}
      <section className="panel overflow-hidden">
        <div className="max-h-[60vh] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-bg-panel z-10">
              <tr>
                <th className="th">Party</th>
                <th className="th text-center">Dr/Cr</th>
                <th className="th text-right">Ledger Closing</th>
                <th className="th text-right">Σ Bills</th>
                <th className="th text-right">Difference</th>
                <th className="th text-center">Source</th>
                <th className="th text-right">Confirm</th>
              </tr>
            </thead>
            <tbody>
              {parties.map((p) => {
                const mismatch = p.billwiseAvailable && !p.reconciles
                return (
                  <tr key={p.key} className={cn(mismatch && 'bg-bad/[0.05]', p.source === 'exclude' && 'opacity-40')}>
                    <td className="td">
                      <div className="font-medium truncate max-w-[240px]">{p.name}</div>
                      <div className="text-[11px] text-ink-faint">
                        {p.kind} {p.email ? `· ${p.email}` : '· no email'} {p.pan ? '' : '· no PAN'}
                      </div>
                    </td>
                    <td className="td text-center">
                      <span className={cn('text-xs font-semibold', p.drCr === 'Dr' ? 'text-debit' : 'text-credit')}>{p.drCr}</span>
                    </td>
                    <td className="td text-right"><Money value={p.ledgerClosing} /></td>
                    <td className="td text-right">{p.billwiseAvailable ? <Money value={p.billTotal} /> : <span className="text-ink-faint text-xs">none</span>}</td>
                    <td className="td text-right">
                      {p.billwiseAvailable ? (
                        <span className={cn('inline-flex items-center gap-1', mismatch ? 'text-bad' : 'text-ink-faint')}>
                          {mismatch && <AlertTriangle size={12} />}
                          <Money value={p.diff} signed />
                        </span>
                      ) : (
                        <span className="text-ink-faint">—</span>
                      )}
                    </td>
                    <td className="td text-center">
                      <select
                        value={p.source}
                        onChange={(e) => setSource(p.key, e.target.value as ConfirmSource)}
                        className="rounded-md border border-line bg-bg-raised px-2 py-1 text-xs focus:outline-none"
                      >
                        {p.billwiseAvailable && <option value="billwise">bills</option>}
                        <option value="ledger">ledger</option>
                        <option value="exclude">exclude</option>
                      </select>
                    </td>
                    <td className="td text-right font-medium"><Money value={confirmAmount(p)} /></td>
                  </tr>
                )
              })}
              {parties.length === 0 && (
                <tr><td className="td text-ink-muted" colSpan={7}>No parties match the current filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

function Mini({ label, value, tone }: { label: string; value: number; tone?: 'good' | 'bad' }) {
  return (
    <div className="stat-card">
      <div className="text-[11px] uppercase tracking-wider text-ink-faint">{label}</div>
      <div className={cn('text-2xl font-bold nums', tone === 'good' && 'text-good', tone === 'bad' && 'text-bad')}>{value}</div>
    </div>
  )
}
