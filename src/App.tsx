import { useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { toast } from 'sonner'
import { useStore } from './state/store'
import { Sidebar } from './ui/shell/Sidebar'
import { SlotBar } from './ui/shell/SlotBar'
import { Dropzone } from './ui/shell/Dropzone'
import { Dashboard } from './ui/modules/Dashboard'
import { VersionDiff } from './ui/modules/VersionDiff'

export function App() {
  const { slots, activeModule, error, clearError } = useStore()

  useEffect(() => {
    if (error) {
      toast.error(error)
      clearError()
    }
  }, [error, clearError])

  if (slots.length === 0) {
    return (
      <div className="min-h-screen">
        <Dropzone />
      </div>
    )
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <SlotBar />
        <main className="flex-1 overflow-y-auto">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeModule}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
              className="px-6 py-6"
            >
              {activeModule === 'dashboard' && <Dashboard />}
              {activeModule === 'versiondiff' && <VersionDiff />}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  )
}
