import { create } from 'zustand'

interface StoreState {
  sessionId: string | null
  activeFile: string | null
  energy: number | null
  area: number | null
  outputLog: string[]
  meshVersion: number
  jobProgress: { step: number; total: number } | null

  setSession: (id: string, file: string) => void
  clearSession: () => void
  setStats: (energy: number | null, area: number | null) => void
  appendLog: (line: string) => void
  clearLog: () => void
  bumpMeshVersion: () => void
  clearJob: () => void
  setJobProgress: (step: number, total: number) => void
}

const useStore = create<StoreState>((set) => ({
  sessionId: null,
  activeFile: null,
  energy: null,
  area: null,
  outputLog: [],
  meshVersion: 0,
  jobProgress: null,

  setSession: (id, file) => set({ sessionId: id, activeFile: file }),
  clearSession: () => set({ sessionId: null, activeFile: null, energy: null, area: null }),
  setStats: (energy, area) => set({ energy, area }),
  appendLog: (line) =>
    set((s) => {
      const next = [...s.outputLog, line]
      return { outputLog: next.length > 1000 ? next.slice(next.length - 1000) : next }
    }),
  clearLog: () => set({ outputLog: [] }),
  bumpMeshVersion: () => set((s) => ({ meshVersion: s.meshVersion + 1 })),
  clearJob: () => set({ jobProgress: null }),
  setJobProgress: (step, total) => set({ jobProgress: { step, total } }),
}))

export default useStore
