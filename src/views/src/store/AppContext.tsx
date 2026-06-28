// AppContext is kept as a re-export shim so all child component imports remain unchanged.
// State is now managed by Zustand (useStore.ts); no Provider is needed.
import type { ReactNode } from 'react'
export { useStore as useAppState } from './useStore'

export function AppProvider({ children }: { children: ReactNode }) {
  return <>{children}</>
}
