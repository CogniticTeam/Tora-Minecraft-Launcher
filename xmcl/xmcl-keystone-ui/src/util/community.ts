export const COMMUNITY_API_ORIGIN = 'https://154.8.230.216'

export interface CommunityInfo {
  service: 'tora-community'
  status: 'coming_soon' | 'ready'
  features: { posts: boolean; comments: boolean; likes: boolean }
  automatic_review?: boolean
}

export function isCommunityInfo(value: unknown): value is CommunityInfo {
  if (!value || typeof value !== 'object') return false
  const data = value as Partial<CommunityInfo>
  return data.service === 'tora-community' &&
    (data.status === 'coming_soon' || data.status === 'ready') &&
    !!data.features && ['posts', 'comments', 'likes'].every(key =>
      typeof data.features?.[key as keyof CommunityInfo['features']] === 'boolean')
}

export async function getCommunityInfo(signal?: AbortSignal, fetcher: typeof fetch = fetch): Promise<CommunityInfo> {
  const response = await fetcher(`${COMMUNITY_API_ORIGIN}/v1/community`, {
    signal, cache: 'no-store', credentials: 'omit', headers: { Accept: 'application/json' },
  })
  if (!response.ok) throw new Error('community_unavailable')
  const body: unknown = await response.json()
  if (!isCommunityInfo(body)) throw new Error('invalid_community_response')
  return body
}
