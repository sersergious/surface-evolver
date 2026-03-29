import { useMemo } from 'react'
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

  return (
    <mesh geometry={geometry}>
      {/* Phong shading — closer to SE's original OpenGL look */}
      <meshPhongMaterial
        color="#2a6fa8"
        specular="#88ccff"
        shininess={40}
        side={THREE.DoubleSide}
        polygonOffset
        polygonOffsetFactor={1}
        polygonOffsetUnits={1}
      />
      {/* Crisp edge wireframe overlay, like SE's default display */}
      <Edges threshold={1} color="#a8d4f0" lineWidth={0.8} />
    </mesh>
  )
}
