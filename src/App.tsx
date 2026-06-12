import { useEffect } from 'react'
import { toast } from 'sonner'
import { useStore } from './state/store'
import { Sidebar } from './ui/shell/Sidebar'
import { SlotBar } from './ui/shell/SlotBar'
import { Dropzone } from './ui/shell/Dropzone'
import { Dashboard } from './ui/modules/Dashboard'
import { VersionDiff } from './ui/modules/VersionDiff'
import { Consolidation } from './ui/modules/Consolidation'
import { Yoy } from './ui/modules/Yoy'
import { Confirmations } from './ui/modules/Confirmations'
import { Reviewer } from './ui/modules/Reviewer'

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
          <div key={activeModule} className="px-6 py-6 animate-fade-up">
            {activeModule === 'dashboard' && <Dashboard />}
            {activeModule === 'versiondiff' && <VersionDiff />}
            {activeModule === 'consolidation' && <Consolidation />}
            {activeModule === 'yoy' && <Yoy />}
            {activeModule === 'confirmations' && <Confirmations />}
            {activeModule === 'reviewer' && <Reviewer />}
          </div>
        </main>
      </div>
    </div>
  )
}
