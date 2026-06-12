import { Database, X, Check } from 'lucide-react'
import { useStore } from '../../state/store'
import { Dropzone } from './Dropzone'
import { cn } from '../lib/cn'

export function SlotBar() {
  const { slots, activeSlotId, setActiveSlot, removeSlot } = useStore()
  return (
    <div className="flex items-center gap-2 border-b border-line bg-bg-panel px-5 py-2.5 overflow-x-auto">
      <span className="text-[11px] uppercase tracking-wide text-ink-faint shrink-0">Datasets</span>
      {slots.map((s) => (
        <button
          key={s.id}
          onClick={() => setActiveSlot(s.id)}
          className={cn(
            'group flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs shrink-0 transition-colors',
            activeSlotId === s.id
              ? 'border-accent/40 bg-accent-soft text-ink'
              : 'border-line text-ink-muted hover:bg-bg-hover',
          )}
        >
          <Database size={13} className={activeSlotId === s.id ? 'text-accent' : ''} />
          <span className="max-w-[180px] truncate font-medium">{s.name}</span>
          <span className="text-ink-faint nums">{s.dataset.meta.periodTo?.slice(0, 4)}</span>
          <span
            role="button"
            onClick={(e) => {
              e.stopPropagation()
              removeSlot(s.id)
            }}
            className="opacity-0 group-hover:opacity-100 hover:text-bad transition-opacity"
          >
            <X size={13} />
          </span>
        </button>
      ))}
      {slots.length > 0 && (
        <span className="ml-1 hidden sm:flex items-center gap-1 text-[11px] text-good shrink-0">
          <Check size={12} /> in-memory
        </span>
      )}
      <div className="ml-auto shrink-0">
        <Dropzone compact />
      </div>
    </div>
  )
}
