import { useEffect, useRef } from 'react'

// Native menu clicks arrive as `se-menu` CustomEvents carrying an action string
// (see src/main/src/app-menu.ts). Each consumer receives every action and acts
// on the prefixes it owns, ignoring the rest. Ref-stable so inline handlers
// don't re-bind the listener every render.
export function useMenuAction(handler: (action: string) => void): void {
  const ref = useRef(handler)
  ref.current = handler
  useEffect(() => {
    const onMenu = (e: Event) => {
      const action = (e as CustomEvent<string>).detail
      if (typeof action === 'string') ref.current(action)
    }
    window.addEventListener('se-menu', onMenu)
    return () => window.removeEventListener('se-menu', onMenu)
  }, [])
}
