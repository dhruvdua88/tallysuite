/**
 * App store (zustand). Holds loaded Dataset Slots and module navigation. All
 * business logic lives in core/; the store only orchestrates IO + selection.
 */
import { create } from 'zustand'
import type { NormalizedDataset } from '../core/model/dataset'
import type { IngestionReport } from '../core/ingest/report'
import { ingestFile } from '../io/files'

export type ModuleId = 'dashboard' | 'versiondiff' | 'consolidation' | 'yoy' | 'confirmations' | 'reviewer'

export type Theme = 'light' | 'dark'

function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem('tallysuite_theme')
    if (saved === 'light' || saved === 'dark') return saved
  } catch {
    /* ignore */
  }
  return 'light'
}

function applyTheme(theme: Theme) {
  const root = document.documentElement
  root.classList.toggle('dark', theme === 'dark')
  try {
    localStorage.setItem('tallysuite_theme', theme)
  } catch {
    /* ignore */
  }
}

export interface Slot {
  id: string
  name: string
  dataset: NormalizedDataset
  report: IngestionReport
  loadedAt: number
}

interface AppState {
  slots: Slot[]
  activeModule: ModuleId
  activeSlotId: string | null
  diffV1: string | null
  diffV2: string | null
  busy: boolean
  error: string | null
  theme: Theme

  ingest: (files: FileList | File[]) => Promise<void>
  removeSlot: (id: string) => void
  setModule: (m: ModuleId) => void
  setActiveSlot: (id: string) => void
  setDiff: (which: 'v1' | 'v2', id: string) => void
  clearError: () => void
  toggleTheme: () => void
}

let counter = 0
const nextId = () => `slot_${++counter}`

export const useStore = create<AppState>((set) => ({
  slots: [],
  activeModule: 'dashboard',
  activeSlotId: null,
  diffV1: null,
  diffV2: null,
  busy: false,
  error: null,
  theme: initialTheme(),

  ingest: async (files) => {
    set({ busy: true, error: null })
    try {
      const list = Array.from(files)
      for (const file of list) {
        const { dataset, report } = await ingestFile(file)
        const slot: Slot = {
          id: nextId(),
          name: dataset.meta.company || file.name,
          dataset,
          report,
          loadedAt: Date.now(),
        }
        set((s) => {
          const slots = [...s.slots, slot]
          return {
            slots,
            activeSlotId: s.activeSlotId ?? slot.id,
            // auto-fill diff slots in load order
            diffV1: s.diffV1 ?? slot.id,
            diffV2: s.diffV1 && !s.diffV2 ? slot.id : s.diffV2,
          }
        })
      }
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) })
    } finally {
      set({ busy: false })
    }
  },

  removeSlot: (id) =>
    set((s) => {
      const slots = s.slots.filter((x) => x.id !== id)
      return {
        slots,
        activeSlotId: s.activeSlotId === id ? (slots[0]?.id ?? null) : s.activeSlotId,
        diffV1: s.diffV1 === id ? null : s.diffV1,
        diffV2: s.diffV2 === id ? null : s.diffV2,
      }
    }),

  setModule: (m) => set({ activeModule: m }),
  setActiveSlot: (id) => set({ activeSlotId: id }),
  setDiff: (which, id) => set(which === 'v1' ? { diffV1: id } : { diffV2: id }),
  clearError: () => set({ error: null }),
  toggleTheme: () =>
    set((s) => {
      const theme: Theme = s.theme === 'light' ? 'dark' : 'light'
      applyTheme(theme)
      return { theme }
    }),
}))

// Apply persisted theme on first load.
applyTheme(initialTheme())

export function useActiveSlot(): Slot | null {
  const { slots, activeSlotId } = useStore()
  return slots.find((s) => s.id === activeSlotId) ?? null
}

// Dev-only: expose the store for preview/e2e harnesses to inject fixtures.
if (import.meta.env.DEV) {
  ;(window as unknown as { __store: typeof useStore }).__store = useStore
}
