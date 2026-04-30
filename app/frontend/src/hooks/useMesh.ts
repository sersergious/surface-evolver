import { useQuery } from '@tanstack/react-query'
import { getMesh } from '../api/simulation'
import useStore from '../store/useStore'

export function useMesh() {
  const sessionId = useStore((s) => s.sessionId)
  const meshVersion = useStore((s) => s.meshVersion)

  return useQuery({
    queryKey: ['mesh', sessionId, meshVersion],
    queryFn: () => getMesh(sessionId!),
    enabled: !!sessionId,
    staleTime: Infinity,
  })
}
