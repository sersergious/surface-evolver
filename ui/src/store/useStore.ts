import { create } from 'zustand'

interface AppState {
  sessionId:   string | null
  activeFile:  string | null
  openFiles:   string[]          // files opened this session (tabs); activeFile is the live one
  fileContent: string | null
  energy:      number | null
  area:        number | null
  totalTime:   number | null
  outputLog:   string[]
  meshVersion: number
}

interface AppActions {
  setSession:      (id: string, file: string) => void
  removeOpenFile:  (file: string) => void
  setFileContent:  (content: string | null) => void
  setStats:        (energy: number | null, area: number | null) => void
  setTotalTime:    (t: number | null) => void
  appendLog:       (line: string) => void
  bumpMeshVersion: () => void
}

export const useStore = create<AppState & AppActions>((set) => ({
  sessionId:   null,
  activeFile:  null,
  openFiles:   [],
  fileContent: null,
  energy:      null,
  area:        null,
  totalTime:   null,
  outputLog:   [],
  meshVersion: 0,

  setSession:      (id, file) => set((s) => ({
    sessionId: id, activeFile: file, totalTime: 0,
    openFiles: s.openFiles.includes(file) ? s.openFiles : [...s.openFiles, file],
  })),
  // Close a tab. If it's the live one, also tear down the active session.
  removeOpenFile:  (file)     => set((s) => {
    const openFiles = s.openFiles.filter(f => f !== file)
    return file === s.activeFile
      ? { openFiles, sessionId: null, activeFile: null, energy: null, area: null, totalTime: null, fileContent: null }
      : { openFiles }
  }),
  setFileContent:  (content)  => set({ fileContent: content }),
  setStats:        (energy, area) => set({ energy, area }),
  setTotalTime:    (t) => set({ totalTime: t }),
  appendLog: (line) =>
    set((s) => {
      const next = [...s.outputLog, line]
      return { outputLog: next.length > 1000 ? next.slice(-1000) : next }
    }),
  bumpMeshVersion: () => set((s) => ({ meshVersion: s.meshVersion + 1 })),
}))
