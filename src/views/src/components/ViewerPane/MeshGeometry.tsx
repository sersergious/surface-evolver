import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { Edges } from '@react-three/drei'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import type { MeshData } from '../../api/simulation'
import type { ColorScalars } from '../../hooks/useMesh'
import type { ThemeColors } from '../../hooks/useThemeColors'

export type RenderMode = 'solid' | 'wireframe' | 'xray'

interface Props {
  mesh:          MeshData
  mode:          RenderMode
  colorScalars:  ColorScalars | null
  elementColors: boolean        // render per-facet SE colour-table colours
  themeColors:   ThemeColors
}

// SE default facet colour (WHITE) and CLEAR — treated as "uncoloured", so they
// take the theme surface colour rather than a literal palette entry.
export const SE_COLOR_WHITE = 15

// Standard 16-colour Surface Evolver / DOS palette, index → [r,g,b] in 0..1.
const SE_PALETTE: [number, number, number][] = [
  [0,0,0],[0,0,1],[0,1,0],[0,1,1],[1,0,0],[1,0,1],[0.55,0.27,0.07],[0.75,0.75,0.75],
  [0.5,0.5,0.5],[0.5,0.5,1],[0.5,1,0.5],[0.5,1,1],[1,0.5,0.5],[1,0.5,1],[1,1,0],[1,1,1],
]
function paletteRGB(idx: number, neutral: [number, number, number]): [number, number, number] {
  if (idx < 0 || idx === SE_COLOR_WHITE) return neutral   // uncoloured → theme surface
  return idx < SE_PALETTE.length ? SE_PALETTE[idx] : neutral
}

// Non-indexed geometry with a flat SE-palette colour per facet (each triangle's
// three vertices carry the facet colour → flat shading respects script colours).
// Uncoloured (white/clear) facets use the theme `neutral` colour.
function buildElementColorGeometry(mesh: MeshData, neutral: THREE.Color): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry()
  const nf  = mesh.facets.length
  const nrgb: [number, number, number] = [neutral.r, neutral.g, neutral.b]
  const pos = new Float32Array(nf * 9)
  const col = new Float32Array(nf * 9)
  for (let f = 0; f < nf; f++) {
    const tri = mesh.facets[f]
    const [r, g, b] = paletteRGB(mesh.facet_colors?.[f] ?? -1, nrgb)
    for (let k = 0; k < 3; k++) {
      const v = mesh.vertices[tri[k]]
      pos[f * 9 + k * 3] = v[0]; pos[f * 9 + k * 3 + 1] = v[1]; pos[f * 9 + k * 3 + 2] = v[2]
      col[f * 9 + k * 3] = r;    col[f * 9 + k * 3 + 1] = g;    col[f * 9 + k * 3 + 2] = b
    }
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
  geo.computeVertexNormals()
  return geo
}

// Coolwarm colormap: blue → near-white → red (matches matplotlib's coolwarm)
function coolwarm(t: number): [number, number, number] {
  const c = Math.max(0, Math.min(1, t))
  if (c <= 0.5) {
    const s = c * 2
    return [0.25 + s * 0.71, 0.41 + s * 0.55, 0.88 - s * 0.14]  // blue → white
  }
  const s = (c - 0.5) * 2
  return [0.96 - s * 0.25, 0.96 - s * 0.94, 0.96 - s * 0.81]    // white → red
}

function applyVertexColors(geo: THREE.BufferGeometry, colorScalars: ColorScalars | null): void {
  if (!colorScalars) return
  const { values, min, max } = colorScalars
  const range = max > min ? max - min : 1
  const colors = new Float32Array(values.length * 3)
  for (let i = 0; i < values.length; i++) {
    const [r, g, b] = coolwarm((values[i] - min) / range)
    colors[i * 3]     = r
    colors[i * 3 + 1] = g
    colors[i * 3 + 2] = b
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
}

function buildGeometry(mesh: MeshData, colorScalars: ColorScalars | null): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(mesh.vertices.flat()), 3))
  geo.setIndex(new THREE.BufferAttribute(new Uint32Array(mesh.facets.flat()), 1))
  applyVertexColors(geo, colorScalars)
  geo.computeVertexNormals()
  return geo
}

/**
 * Line rendering for edge geometry — the only geometry the STRING (1-D) model
 * produces, so curve/filament .fe files render here instead of MeshGeometry.
 */
export function EdgeLines({ mesh, colorScalars, themeColors }: {
  mesh: MeshData; colorScalars: ColorScalars | null; themeColors: ThemeColors
}) {
  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(mesh.vertices.flat()), 3))
    geo.setIndex(new THREE.BufferAttribute(new Uint32Array(mesh.edges.flat()), 1))
    applyVertexColors(geo, colorScalars)
    return geo
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mesh, colorScalars])

  useEffect(() => () => { geometry.dispose() }, [geometry])

  const useVColors = colorScalars !== null
  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial color={useVColors ? '#ffffff' : themeColors.line} vertexColors={useVColors} />
    </lineSegments>
  )
}

// Sets the raycaster's Points threshold so vertex picking scales with the mesh
// (default threshold of 1 world-unit makes every point a hit on small meshes).
export function RaycasterConfig({ threshold }: { threshold: number }) {
  const raycaster = useThree(s => s.raycaster)
  useEffect(() => {
    raycaster.params.Points = { threshold }
  }, [raycaster, threshold])
  return null
}

// Clickable cloud of every vertex; e.index is the vertex's buffer position (vpos).
export function PickPoints({ mesh, onPick }: { mesh: MeshData; onPick: (vpos: number) => void }) {
  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(mesh.vertices.flat()), 3))
    return geo
  }, [mesh])
  useEffect(() => () => { geometry.dispose() }, [geometry])

  return (
    <points
      geometry={geometry}
      onClick={(e: ThreeEvent<MouseEvent>) => {
        if (e.index == null) return
        e.stopPropagation()
        onPick(e.index)
      }}
    >
      <pointsMaterial size={0.01} transparent opacity={0.0} depthWrite={false} />
    </points>
  )
}

// Highlight sphere at a single position (the picked vertex).
export function VertexMarker({ position, radius }: { position: number[]; radius: number }) {
  return (
    <mesh position={position as [number, number, number]}>
      <sphereGeometry args={[radius, 16, 16]} />
      <meshBasicMaterial color="#ffcc33" depthTest={false} transparent opacity={0.9} />
    </mesh>
  )
}

// Body centre-of-mass markers.
export function BodyMarkers({ cms, radius }: { cms: (number[] | null)[]; radius: number }) {
  return (
    <>
      {cms.map((cm, i) => cm && (
        <mesh key={i} position={cm as [number, number, number]}>
          <sphereGeometry args={[radius, 12, 12]} />
          <meshBasicMaterial color="#33ddff" depthTest={false} transparent opacity={0.85} />
        </mesh>
      ))}
    </>
  )
}

export default function MeshGeometry({ mesh, mode, colorScalars, elementColors, themeColors }: Props) {
  const useElementColors = elementColors && (mesh.facet_colors?.length ?? 0) > 0
  const geometry = useMemo(
    () => useElementColors
      ? buildElementColorGeometry(mesh, themeColors.surface)
      : buildGeometry(mesh, colorScalars),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mesh, colorScalars, useElementColors, themeColors],
  )

  useEffect(() => () => { geometry.dispose() }, [geometry])

  const showEdges  = mesh.facets.length <= 200_000
  const useVColors = colorScalars !== null || useElementColors

  if (mode === 'wireframe') {
    return (
      <mesh geometry={geometry}>
        <meshBasicMaterial color={themeColors.line} wireframe side={THREE.DoubleSide} />
      </mesh>
    )
  }

  if (mode === 'xray') {
    return (
      <mesh geometry={geometry}>
        <meshPhongMaterial
          color={themeColors.surface}
          specular={themeColors.specular}
          shininess={40}
          side={THREE.DoubleSide}
          transparent opacity={0.22}
          depthWrite={false}
          polygonOffset polygonOffsetFactor={1} polygonOffsetUnits={1}
        />
        {showEdges && <Edges threshold={1} color={themeColors.line} lineWidth={0.8} />}
      </mesh>
    )
  }

  // solid — per-vertex/element colours when present, else the theme surface.
  return (
    <mesh geometry={geometry}>
      <meshPhongMaterial
        color={useVColors ? '#ffffff' : themeColors.surface}
        specular={useVColors ? '#555555' : themeColors.specular}
        shininess={useVColors ? 25 : 40}
        vertexColors={useVColors}
        side={THREE.DoubleSide}
        polygonOffset polygonOffsetFactor={1} polygonOffsetUnits={1}
      />
      {showEdges && <Edges threshold={1} color={themeColors.line} lineWidth={0.6} />}
    </mesh>
  )
}
