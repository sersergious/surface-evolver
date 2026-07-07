import { useState, useEffect } from 'react'
import * as THREE from 'three'

export interface ThemeColors {
  surface:  THREE.Color   // default surface fill (daisyUI primary)
  specular: THREE.Color   // phong highlight
  line:     THREE.Color   // edges / wireframe
}

// Normalise any computed CSS colour (rgb, oklch, color() …) to a THREE.Color
// via a canvas — its fillStyle setter parses every CSS colour form and the
// getter returns a hex string THREE can read. Avoids hand-parsing oklch.
const ctx = typeof document !== 'undefined'
  ? document.createElement('canvas').getContext('2d')
  : null

// Read a daisyUI colour CSS variable (e.g. --p, --bc) straight off :root, where
// it is always defined for the active [data-theme]. The value is bare oklch
// components ("65% 0.2 275"); wrap in oklch() and normalise via canvas (its
// parser handles oklch even where THREE.Color does not).
function varColor(name: string, fallback: string): THREE.Color {
  if (!ctx) return new THREE.Color(fallback)
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  ctx.fillStyle = fallback
  if (raw) ctx.fillStyle = `oklch(${raw})`
  return new THREE.Color(ctx.fillStyle as string)
}

function read(): ThemeColors {
  // base-content is the neutral content colour — light on dark themes, dark on
  // light — so the surface always contrasts the background and reads cleanly.
  const surface = varColor('--bc', '#2d9a5e')
  return {
    surface,
    specular: surface.clone().lerp(new THREE.Color('#ffffff'), 0.6),
    line:     varColor('--p', '#94d4b0'),   // primary accent for edges
  }
}

// Mesh material colours derived from the active daisyUI theme. Recomputes when
// the theme changes (the app follows the OS appearance via data-theme).
export function useThemeColors(): ThemeColors {
  const [colors, setColors] = useState<ThemeColors>(read)
  useEffect(() => {
    const obs = new MutationObserver(() => setColors(read()))
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => obs.disconnect()
  }, [])
  return colors
}
