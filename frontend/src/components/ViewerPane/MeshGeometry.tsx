import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { Edges } from '@react-three/drei'
import type { MeshData } from '../../api/simulation'

interface Props {
  mesh: MeshData
}

/** SE-style rendering: Phong-shaded faces + hard-edge wireframe overlay */
export default function MeshGeometry({ mesh }: Props) {
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

  return (
    <mesh geometry={geometry}>
      {/* Phong shading — closer to SE's original OpenGL look */}
      <meshPhongMaterial
        color="#2d9a5e"
        specular="#80e0aa"
        shininess={40}
        side={THREE.DoubleSide}
        polygonOffset
        polygonOffsetFactor={1}
        polygonOffsetUnits={1}
      />
      {/* Edge overlay hidden above 200k facets — it dominates render time at that scale */}
      {mesh.facets.length <= 200000 && (
        <Edges threshold={1} color="#94d4b0" lineWidth={0.8} />
      )}
    </mesh>
  )
}
