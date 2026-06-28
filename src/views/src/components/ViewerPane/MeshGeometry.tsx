import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { Edges } from '@react-three/drei'
import type { MeshData } from '../../api/simulation'
import type { ColorScalars } from '../../hooks/useMesh'

export type RenderMode = 'solid' | 'wireframe' | 'xray'

interface Props {
  mesh:         MeshData
  mode:         RenderMode
  colorScalars: ColorScalars | null
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

function buildGeometry(mesh: MeshData, colorScalars: ColorScalars | null): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(mesh.vertices.flat()), 3))
  geo.setIndex(new THREE.BufferAttribute(new Uint32Array(mesh.facets.flat()), 1))

  if (colorScalars) {
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

  geo.computeVertexNormals()
  return geo
}

export default function MeshGeometry({ mesh, mode, colorScalars }: Props) {
  const geometry = useMemo(
    () => buildGeometry(mesh, colorScalars),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mesh, colorScalars],
  )

  useEffect(() => () => { geometry.dispose() }, [geometry])

  const showEdges  = mesh.facets.length <= 200_000
  const useVColors = colorScalars !== null

  if (mode === 'wireframe') {
    return (
      <mesh geometry={geometry}>
        <meshBasicMaterial color="#94d4b0" wireframe side={THREE.DoubleSide} />
      </mesh>
    )
  }

  if (mode === 'xray') {
    return (
      <mesh geometry={geometry}>
        <meshPhongMaterial
          color="#2d9a5e"
          specular="#80e0aa"
          shininess={40}
          side={THREE.DoubleSide}
          transparent opacity={0.22}
          depthWrite={false}
          polygonOffset polygonOffsetFactor={1} polygonOffsetUnits={1}
        />
        {showEdges && <Edges threshold={1} color="#94d4b0" lineWidth={0.8} />}
      </mesh>
    )
  }

  // solid (with optional vertex colors)
  return (
    <mesh geometry={geometry}>
      <meshPhongMaterial
        color={useVColors ? '#ffffff' : '#2d9a5e'}
        specular={useVColors ? '#555555' : '#80e0aa'}
        shininess={useVColors ? 25 : 40}
        vertexColors={useVColors}
        side={THREE.DoubleSide}
        polygonOffset polygonOffsetFactor={1} polygonOffsetUnits={1}
      />
      {showEdges && <Edges threshold={1} color={useVColors ? '#aaaaaa' : '#94d4b0'} lineWidth={0.6} />}
    </mesh>
  )
}
