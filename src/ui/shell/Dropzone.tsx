import { useCallback, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { UploadCloud, ShieldCheck, Upload, GitCompareArrows, Layers, ScrollText } from 'lucide-react'
import { useStore } from '../../state/store'
import { cn } from '../lib/cn'

export function Dropzone({ compact = false }: { compact?: boolean }) {
  const ingest = useStore((s) => s.ingest)
  const busy = useStore((s) => s.busy)
  const inputRef = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setOver(false)
      if (e.dataTransfer.files?.length) void ingest(e.dataTransfer.files)
    },
    [ingest],
  )

  if (compact) {
    return (
      <>
        <button className="btn-soft" onClick={() => inputRef.current?.click()} disabled={busy}>
          <Upload size={15} /> Add export
        </button>
        <input ref={inputRef} type="file" accept=".zip" multiple hidden onChange={(e) => e.target.files && ingest(e.target.files)} />
      </>
    )
  }

  return (
    <div className="grid min-h-screen place-items-center px-6">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-xl"
      >
        <div className="flex flex-col items-center text-center mb-8">
          <div className="grid h-12 w-12 place-items-center rounded-xl bg-accent text-[rgb(var(--accent-ink))] text-lg font-bold shadow-raised mb-4">
            TS
          </div>
          <h1 className="text-[28px] font-semibold tracking-tight">TallySuite</h1>
          <p className="mt-1.5 text-ink-muted max-w-md">
            The audit layer for TallyPrime. Import an export and review books, statements and
            year-on-year movements — entirely on this device.
          </p>
        </div>

        <div
          onDragOver={(e) => {
            e.preventDefault()
            setOver(true)
          }}
          onDragLeave={() => setOver(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          className={cn(
            'panel cursor-pointer px-8 py-12 text-center transition-all duration-200 border-dashed',
            over ? 'border-accent shadow-raised bg-accent-soft/40' : 'hover:border-line-strong hover:shadow-raised',
          )}
        >
          <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-xl bg-accent-soft text-accent">
            <UploadCloud size={24} className={busy ? 'animate-pulse' : ''} />
          </div>
          <div className="text-[15px] font-semibold">{busy ? 'Reading your books…' : 'Drop a Tally export ZIP'}</div>
          <div className="mt-1 text-sm text-ink-faint">
            or click to browse · drop two versions to compare · .zip from the TSF exporter
          </div>
          <input ref={inputRef} type="file" accept=".zip" multiple hidden onChange={(e) => e.target.files && ingest(e.target.files)} />
        </div>

        <div className="mt-5 grid grid-cols-3 gap-3">
          <Feature icon={GitCompareArrows} label="Version diff" />
          <Feature icon={Layers} label="Schedule III" />
          <Feature icon={ScrollText} label="CARO review" />
        </div>

        <div className="mt-6 flex items-center justify-center gap-2 text-xs text-ink-faint">
          <ShieldCheck size={14} className="text-good" />
          No upload, no server, no telemetry. Your client data never leaves this device.
        </div>
      </motion.div>
    </div>
  )
}

function Feature({ icon: Icon, label }: { icon: typeof Layers; label: string }) {
  return (
    <div className="panel flex items-center gap-2 px-3 py-2.5 text-xs text-ink-muted">
      <Icon size={15} className="text-accent" />
      {label}
    </div>
  )
}
