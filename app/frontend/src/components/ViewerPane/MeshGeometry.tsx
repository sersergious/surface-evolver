import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { Edges } from '@react-three/drei'
import type { MeshData } from '../../api/simulation'

export type RenderMode = 'solid' | 'wireframe' | 'xray'

interface Props {
  mesh: MeshData
  mode: RenderMode
}

export default function MeshGeometry({ mesh, mode }: Props) {
  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(mesh.vertices.flat()), 3)
    )
    geo.setIndex(new THREE.BufferAttribute(new Uint32Array(mesh.facets.flat()), 1))
    geo.computeVertexNormals()
    return geo
  }, [mesh])

  useEffect(() => {
    return () => { geometry.dispose() }
  }, [geometry])

  const showEdges = mesh.facets.length <= 200000

  if (mode === 'wireframe') {
    return (
      <mesh geometry={geometry}>
        <meshBasicMaterial
          color="#94d4b0"
          wireframe
          side={THREE.DoubleSide}
        />
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
          transparent
          opacity={0.22}
          depthWrite={false}
          polygonOffset
          polygonOffsetFactor={1}
          polygonOffsetUnits={1}
        />
        {showEdges && <Edges threshold={1} color="#94d4b0" lineWidth={0.8} />}
      </mesh>
    )
  }

  // solid (default)
  return (
    <mesh geometry={geometry}>
      <meshPhongMaterial
        color="#2d9a5e"
        specular="#80e0aa"
        shininess={40}
        side={THREE.DoubleSide}
        polygonOffset
        polygonOffsetFactor={1}
        polygonOffsetUnits={1}
      />
      {showEdges && <Edges threshold={1} color="#94d4b0" lineWidth={0.8} />}
    </mesh>
  )
}
