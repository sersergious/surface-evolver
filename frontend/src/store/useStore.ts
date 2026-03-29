import { create } from 'zustand'

interface StoreState {
  sessionId: string | null
  activeFile: string | null
  energy: number | null
  area: number | null
  outputLog: string[]
  meshVersion: number
  jobId: string | null
  jobProgress: { step: number; total: number } | null

  setSession: (id: string, file: string) => void
  clearSession: () => void
  setStats: (energy: number | null, area: number | null) => void
  appendLog: (line: string) => void
  clearLog: () => void
  bumpMeshVersion: () => void
  setJob: (id: string) => void
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
  jobId: null,
  jobProgress: null,

  setSession: (id, file) => set({ sessionId: id, activeFile: file }),
  clearSession: () => set({ sessionId: null, activeFile: null, energy: null, area: null }),
  setStats: (energy, area) => set({ energy, area }),
  appendLog: (line) => set((s) => ({ outputLog: [...s.outputLog, line] })),
  clearLog: () => set({ outputLog: [] }),
  bumpMeshVersion: () => set((s) => ({ meshVersion: s.meshVersion + 1 })),
  setJob: (id) => set({ jobId: id, jobProgress: null }),
  clearJob: () => set({ jobId: null, jobProgress: null }),
  setJobProgress: (step, total) => set({ jobProgress: { step, total } }),
}))

export default useStore
