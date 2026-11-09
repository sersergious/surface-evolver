import { useState, useEffect } from 'react'
import * as THREE from 'three'

export interface ThemeColors {
  surface:  THREE.Color   // default surface fill (theme --mesh)
  specular: THREE.Color   // phong highlight
  line:     THREE.Color   // edge overlay, drawn on facets (theme --mesh-edge)
  wire:     THREE.Color   // wireframe, drawn on the background (base-content)
}

// Normalise any computed CSS colour (rgb, oklch, color() …) to a THREE.Color
// via a canvas: its fillStyle setter parses every CSS colour form, and a
// painted pixel reads back as plain sRGB bytes. (Don't read fillStyle back —
// current Chromium returns "oklch(…)" from the getter, which THREE parses as
// white.) Avoids hand-parsing oklch.
const ctx = typeof document !== 'undefined'
  ? document.createElement('canvas').getContext('2d')
  : null

// Read a theme colour CSS variable (e.g. --mesh) straight off :root, where it
// is always defined for the active [data-theme]. The value is bare oklch
// components ("65% 0.2 275"); wrap in oklch() and normalise via canvas.
function varColor(name: string, fallback: string): THREE.Color {
  if (!ctx) return new THREE.Color(fallback)
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  ctx.fillStyle = fallback
  if (raw) ctx.fillStyle = `oklch(${raw})`
  ctx.fillRect(0, 0, 1, 1)
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
  return new THREE.Color().setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace)
}

function read(): ThemeColors {
  // --mesh / --mesh-edge are app-specific theme variables (tailwind.config.js):
  // light-grey facets with near-black edges in both modes, as SE draws them.
  const surface = varColor('--mesh', '#d4d4d4')
  return {
    surface,
    specular: surface.clone().lerp(new THREE.Color('#ffffff'), 0.6),
    line:     varColor('--mesh-edge', '#0a0a0a'),
    // Wireframe has no facets behind it, so a near-black edge colour vanished
    // on the dark theme's near-black background. The theme foreground (--bc,
    // daisyUI's base-content) contrasts with the background in both themes.
    wire:     varColor('--bc', '#737373'),
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
