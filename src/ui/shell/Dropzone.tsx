import { useCallback, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { UploadCloud, ShieldCheck, Cpu, FileArchive } from 'lucide-react'
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
          <UploadCloud size={16} /> Add export
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".zip"
          multiple
          hidden
          onChange={(e) => e.target.files && ingest(e.target.files)}
        />
      </>
    )
  }

  return (
    <div className="grid place-items-center min-h-[70vh] px-6">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-2xl text-center"
      >
        <div className="mb-8">
          <h1 className="text-4xl font-bold tracking-tight">
            Tally<span className="text-accent">Suite</span>
          </h1>
          <p className="mt-3 text-ink-muted">
            The audit layer Tally never shipped. Drop a Tally export — everything runs in this tab.
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
            'panel cursor-pointer px-10 py-16 transition-all duration-200 border-dashed',
            over ? 'border-accent shadow-glow scale-[1.01]' : 'hover:border-line-strong',
          )}
        >
          <motion.div
            animate={busy ? { rotate: [0, 8, -8, 0] } : {}}
            transition={{ repeat: busy ? Infinity : 0, duration: 1.2 }}
            className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-2xl bg-accent-soft text-accent"
          >
            {busy ? <Cpu size={30} /> : <FileArchive size={30} />}
          </motion.div>
          <div className="text-lg font-semibold">
            {busy ? 'Reading your books…' : 'Drop Tally export ZIP here'}
          </div>
          <div className="mt-1 text-sm text-ink-faint">
            or click to browse · drop two versions to diff · .zip from the TSF exporter
          </div>
          <input
            ref={inputRef}
            type="file"
            accept=".zip"
            multiple
            hidden
            onChange={(e) => e.target.files && ingest(e.target.files)}
          />
        </div>

        <div className="mt-6 flex items-center justify-center gap-2 text-xs text-ink-faint">
          <ShieldCheck size={14} className="text-good" />
          Your data never leaves this device. No upload, no server, no telemetry.
        </div>
      </motion.div>
    </div>
  )
}
