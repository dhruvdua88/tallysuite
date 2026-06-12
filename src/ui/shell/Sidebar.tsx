import {
  LayoutDashboard,
  GitCompareArrows,
  Layers,
  CalendarRange,
  FileSignature,
  ScrollText,
  ShieldCheck,
  Sun,
  Moon,
} from 'lucide-react'
import { useStore, type ModuleId } from '../../state/store'
import { cn } from '../lib/cn'

interface NavItem {
  id: ModuleId
  label: string
  icon: typeof LayoutDashboard
  ready: boolean
}

const GROUPS: { heading: string; items: NavItem[] }[] = [
  {
    heading: 'Overview',
    items: [{ id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, ready: true }],
  },
  {
    heading: 'Analysis',
    items: [
      { id: 'versiondiff', label: 'Version Diff', icon: GitCompareArrows, ready: true },
      { id: 'yoy', label: 'Year-on-Year', icon: CalendarRange, ready: true },
    ],
  },
  {
    heading: 'Statements & Audit',
    items: [
      { id: 'consolidation', label: 'Consolidation', icon: Layers, ready: true },
      { id: 'confirmations', label: 'Confirmations', icon: FileSignature, ready: true },
      { id: 'reviewer', label: 'Schedule III Review', icon: ScrollText, ready: true },
    ],
  },
]

export function Sidebar() {
  const { activeModule, setModule, slots, theme, toggleTheme } = useStore()
  return (
    <aside className="w-[232px] shrink-0 border-r border-line bg-bg-panel flex flex-col">
      <div className="flex items-center gap-2.5 px-4 py-4 border-b border-line">
        <div className="grid h-8 w-8 place-items-center rounded-lg bg-accent text-[rgb(var(--accent-ink))] text-sm font-bold shadow-card">
          TS
        </div>
        <div className="leading-tight">
          <div className="text-[15px] font-semibold tracking-tight">TallySuite</div>
          <div className="text-[10.5px] text-ink-faint uppercase tracking-wide">Audit Workbench</div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-2.5 py-3 space-y-4">
        {GROUPS.map((g) => (
          <div key={g.heading}>
            <div className="px-2.5 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
              {g.heading}
            </div>
            <div className="space-y-0.5">
              {g.items.map((n) => (
                <div
                  key={n.id}
                  className={cn('nav-item', activeModule === n.id && 'nav-item-active')}
                  onClick={() => setModule(n.id)}
                >
                  <n.icon size={16} strokeWidth={2} />
                  <span className="flex-1">{n.label}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-line p-2.5 space-y-2">
        <button onClick={toggleTheme} className="nav-item w-full">
          {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
          <span className="flex-1 text-left">{theme === 'light' ? 'Dark mode' : 'Light mode'}</span>
        </button>
        <div className="flex items-start gap-2 rounded-lg bg-bg-raised border border-line px-2.5 py-2 text-[11px] text-ink-muted">
          <ShieldCheck size={14} className="text-good mt-0.5 shrink-0" />
          <span>
            {slots.length} dataset{slots.length === 1 ? '' : 's'} in memory · nothing leaves this device
          </span>
        </div>
      </div>
    </aside>
  )
}
