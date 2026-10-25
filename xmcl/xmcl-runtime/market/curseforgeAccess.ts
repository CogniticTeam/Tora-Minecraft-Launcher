/** Never send an unauthenticated request to CurseForge, including background lookups. */
export function createCurseforgeFetch(apiKey: string | undefined, fetcher: typeof fetch): typeof fetch {
  const key = apiKey?.trim()
  return async (input, init) => {
    if (!key) {
      throw new Error('CurseForge is unavailable: TORA has not configured a CurseForge API key. Please use Modrinth.')
    }
    const headers = new Headers(init?.headers)
    headers.set('x-api-key', key)
    return fetcher(input, { ...init, headers })
  }
}
