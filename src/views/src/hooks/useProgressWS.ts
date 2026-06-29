import { useEffect } from 'react'
import { useAppState } from '../store/AppContext'

export function useProgressWS(sessionId: string | null) {
  const { setStats, setJobProgress, clearJob, bumpMeshVersion } = useAppState()

  useEffect(() => {
    if (!sessionId) return

    const handleProgress = (event: Event) => {
      const customEvent = event as CustomEvent;
      const msg = customEvent.detail;
      
      if (msg.sessionId !== sessionId) return;

      if (msg.step !== undefined && msg.total !== undefined) {
        setJobProgress(msg.step, msg.total)
        if (msg.energy !== undefined) setStats(msg.energy, null)
        
        if (msg.step === msg.total) { // Simulate 'completed' since we pass total steps
            clearJob()
            bumpMeshVersion()
        }
      }
    }

    window.addEventListener('se-progress', handleProgress)

    return () => {
      window.removeEventListener('se-progress', handleProgress)
    }
  }, [sessionId]) // ponytail: zustand actions are stable refs, listing them is noise
}
