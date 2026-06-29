import { create } from 'zustand'

interface AppState {
  sessionId:   string | null
  activeFile:  string | null
  fileContent: string | null
  energy:      number | null
  area:        number | null
  totalTime:   number | null
  outputLog:   string[]
  meshVersion: number
  jobProgress: { step: number; total: number } | null
}

interface AppActions {
  setSession:      (id: string, file: string) => void
  clearSession:    () => void
  setFileContent:  (content: string | null) => void
  setStats:        (energy: number | null, area: number | null) => void
  setTotalTime:    (t: number | null) => void
  appendLog:       (line: string) => void
  clearLog:        () => void
  bumpMeshVersion: () => void
  setJobProgress:  (step: number, total: number) => void
  clearJob:        () => void
}

export const useStore = create<AppState & AppActions>((set) => ({
  sessionId:   null,
  activeFile:  null,
  fileContent: null,
  energy:      null,
  area:        null,
  totalTime:   null,
  outputLog:   [],
  meshVersion: 0,
  jobProgress: null,

  setSession:      (id, file) => set({ sessionId: id, activeFile: file, totalTime: 0 }),
  clearSession:    ()         => set({ sessionId: null, activeFile: null, energy: null, area: null, totalTime: null, fileContent: null }),
  setFileContent:  (content)  => set({ fileContent: content }),
  setStats:        (energy, area) => set({ energy, area }),
  setTotalTime:    (t) => set({ totalTime: t }),
  appendLog: (line) =>
    set((s) => {
      const next = [...s.outputLog, line]
      return { outputLog: next.length > 1000 ? next.slice(-1000) : next }
    }),
  clearLog:        () => set({ outputLog: [] }),
  bumpMeshVersion: () => set((s) => ({ meshVersion: s.meshVersion + 1 })),
  setJobProgress:  (step, total) => set({ jobProgress: { step, total } }),
  clearJob:        () => set({ jobProgress: null }),
}))

// Compatibility alias — all existing components import useAppState from AppContext,
// which re-exports this. Zustand needs no Provider wrapper.
export const useAppState = useStore
