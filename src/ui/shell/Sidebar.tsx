import {
  LayoutDashboard,
  GitCompareArrows,
  Layers,
  CalendarRange,
  FileSignature,
  ShieldCheck,
} from 'lucide-react'
import { useStore, type ModuleId } from '../../state/store'
import { cn } from '../lib/cn'

const NAV: { id: ModuleId; label: string; icon: typeof LayoutDashboard; ready: boolean }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, ready: true },
  { id: 'versiondiff', label: 'Version Diff', icon: GitCompareArrows, ready: true },
  { id: 'consolidation', label: 'Consolidation', icon: Layers, ready: false },
  { id: 'yoy', label: 'Year-on-Year', icon: CalendarRange, ready: false },
  { id: 'confirmations', label: 'Confirmations', icon: FileSignature, ready: false },
]

export function Sidebar() {
  const { activeModule, setModule, slots } = useStore()
  return (
    <aside className="w-60 shrink-0 border-r border-line bg-bg-panel/60 backdrop-blur-sm flex flex-col">
      <div className="px-5 py-5">
        <div className="text-lg font-bold tracking-tight">
          Tally<span className="text-accent">Suite</span>
        </div>
        <div className="text-[11px] text-ink-faint">audit workbench · offline</div>
      </div>

      <nav className="px-3 flex flex-col gap-1">
        {NAV.map((n) => (
          <div
            key={n.id}
            className={cn(
              'nav-item',
              activeModule === n.id && 'nav-item-active',
              !n.ready && 'opacity-50',
            )}
            onClick={() => n.ready && setModule(n.id)}
          >
            <n.icon size={17} />
            <span className="flex-1">{n.label}</span>
            {!n.ready && <span className="text-[10px] text-ink-faint">soon</span>}
          </div>
        ))}
      </nav>

      <div className="mt-auto p-3">
        <div className="panel-raised p-3 text-xs text-ink-muted flex items-start gap-2">
          <ShieldCheck size={15} className="text-good mt-0.5 shrink-0" />
          <span>
            {slots.length} dataset{slots.length === 1 ? '' : 's'} in memory. Nothing uploaded.
          </span>
        </div>
      </div>
    </aside>
  )
}
