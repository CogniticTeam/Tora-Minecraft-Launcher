import { COMMUNITY_API_ORIGIN } from './community'
import { reactive } from 'vue'

const initialCommunityGroups = [
  {
    "title": "官方事务",
    "items": [
      {
        "value": "notice",
        "title": "站务公告"
      },
      {
        "value": "tutorial",
        "title": "教程中心"
      }
    ]
  },
  {
    "title": "综合交流",
    "items": [
      {
        "value": "talk",
        "title": "闲聊讨论"
      },
      {
        "value": "news",
        "title": "游戏资讯"
      },
      {
        "value": "help",
        "title": "悬赏问答"
      }
    ]
  },
  {
    "title": "资源分享",
    "items": [
      {
        "value": "be-addon",
        "title": "BE 附加包"
      },
      {
        "value": "je-mod",
        "title": "JE 模组"
      },
      {
        "value": "texture",
        "title": "材质光影"
      },
      {
        "value": "map",
        "title": "地图存档"
      },
      {
        "value": "tool",
        "title": "软件工具"
      }
    ]
  },
  {
    "title": "联机广场",
    "items": [
      {
        "value": "server",
        "title": "服务器大厅"
      },
      {
        "value": "team",
        "title": "组队开黑"
      }
    ]
  },
  {
    "title": "创作交流",
    "items": [
      {
        "value": "video",
        "title": "视频专区"
      },
      {
        "value": "creation",
        "title": "周边创作"
      },
      {
        "value": "coding",
        "title": "编程分享"
      }
    ]
  },
  {
    "title": "反馈站务",
    "items": [
      {
        "value": "feedback",
        "title": "使用反馈"
      },
      {
        "value": "bug",
        "title": "Bug 报告"
      },
      {
        "value": "suggestion",
        "title": "意见建议"
      }
    ]
  }
] as const
export type CommunityKind = string
export const communityGroups = reactive<Array<{ title: string; items: Array<{ value: string; title: string }> }>>(initialCommunityGroups.map(group => ({ title: group.title, items: group.items.map(item => ({ ...item })) })))
export const communityKinds = reactive(Object.fromEntries([...communityGroups.flatMap(g => g.items.map(i => [i.value, i.title])), ['pack', '整合包']]) as Record<string, string>)
export const communityResourceKinds = reactive<CommunityKind[]>(['be-addon', 'je-mod', 'texture', 'map', 'tool', 'pack'])
export const communityStaffKinds = reactive<CommunityKind[]>(['notice'])
export interface CommunityBoard { id: string; name: string; group_name: string; enabled: number; resource: number; staff_only: number }
export function applyCommunityBoards(value: unknown) {
  if (!Array.isArray(value) || value.length > 100 || !value.every(b => b && typeof b === 'object' && typeof b.id === 'string' && /^[a-z][a-z0-9-]{0,31}$/.test(b.id) && typeof b.name === 'string' && b.name.length <= 24 && typeof b.group_name === 'string' && b.group_name.length <= 24 && [0, 1].includes(b.enabled) && [0, 1].includes(b.resource) && [0, 1].includes(b.staff_only))) return false
  const groups: typeof communityGroups = []
  for (const b of value as CommunityBoard[]) {
    communityKinds[b.id] = b.name
    if (!b.enabled) continue
    let group = groups.find(g => g.title === b.group_name)
    if (!group) { group = { title: b.group_name, items: [] }; groups.push(group) }
    group.items.push({ value: b.id, title: b.name })
  }
  communityGroups.splice(0, communityGroups.length, ...groups)
  communityResourceKinds.splice(0, communityResourceKinds.length, ...(value as CommunityBoard[]).filter(b => b.resource).map(b => b.id))
  communityStaffKinds.splice(0, communityStaffKinds.length, ...(value as CommunityBoard[]).filter(b => b.staff_only).map(b => b.id))
  return true
}

export interface CommunityProfile { id: string; nickname: string; role: 'member' | 'moderator' | 'admin'; muted: number; created_at: number }
export interface CommunityPost {
  id: string; author_id: string; author: { id: string; nickname: string; role: string }; mine: boolean
  type: CommunityKind; title: string; body?: string; summary: string; version: string; loader: string
  source_url: string; original_author: string; status: 'published' | 'pending' | 'hidden'; locked: number
  revision: number; created_at: number; updated_at: number; likes: number; comments: number; liked: boolean; bookmarked: boolean; accepted_comment_id: string | null
}
export interface CommunityComment { id: string; post_id: string; author_id: string; author_name: string; author_role: string; mine: boolean; parent_id: string | null; body: string; status: string; revision: number; created_at: number }
export interface CommunityNotice { id: string; kind: string; title: string; body?: string; actor_name: string; post_id: string; comment_id: string | null; created_at: number; read_at: number | null }
export interface CommunityReport { id: string; target_type: 'post' | 'comment'; target_id: string; reason: string; reporter_name: string; created_at: number; target: Record<string, unknown> | null }
export interface CommunityPage<T> { data: T[]; next_cursor?: string | null; category_counts?: Record<string, number> }
export type CommunityAccess = { accessToken: string; expiresAt: string; subject: string }

export class CommunityError extends Error {
  constructor(readonly code: string, message: string, readonly status = 0, readonly retryAfter = 0) { super(message) }
}

export function createCommunityClient(getAccess: (force?: boolean) => Promise<CommunityAccess>, fetcher: typeof fetch = fetch) {
  return {
    async request<T>(path: string, options: { method?: string; body?: unknown; auth?: boolean; key?: string; signal?: AbortSignal } = {}): Promise<T> {
      if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\') || path.includes('#')) throw new CommunityError('invalid_path', '社区请求地址无效。')
      const url = new URL(`/v1/community${path}`, COMMUNITY_API_ORIGIN)
      if (url.origin !== COMMUNITY_API_ORIGIN || !url.pathname.startsWith('/v1/community/')) throw new CommunityError('invalid_path', '社区请求地址无效。')
      for (let attempt = 0; attempt < 2; attempt++) {
        const headers = new Headers({ Accept: 'application/json' })
        if (options.auth) {
          let access: CommunityAccess
          try { access = await getAccess(attempt > 0) } catch (error) {
            const code = String((error as { code?: string; message?: string })?.code || (error as Error)?.message || '')
            if (code.includes('minecraft_verification_unavailable')) throw new CommunityError('minecraft_verification_unavailable', '正版校验服务暂时无法连接，请稍后重试。你仍可浏览帖子。', 503)
            if (code.includes('minecraft_login_required')) throw new CommunityError('minecraft_login_required', '当前游戏登录已失效，请在个人中心重新登录微软正版账号。', 401)
            throw new CommunityError('session_missing', '社区身份暂时未能验证，请重试；你仍可浏览帖子。', 401)
          }
          headers.set('Authorization', `Bearer ${access.accessToken}`)
        }
        if (options.body !== undefined) headers.set('Content-Type', 'application/json')
        if (options.key) headers.set('Idempotency-Key', options.key)
        let response: Response
        try {
          response = await fetcher(url, { method: options.method ?? 'GET', headers, body: options.body === undefined ? undefined : JSON.stringify(options.body),
            credentials: 'omit', cache: 'no-store', redirect: 'error', signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000) })
        } catch (error) {
          if (options.signal?.aborted) throw error
          throw new CommunityError('network_error', '暂时无法连接社区，请稍后重试。')
        }
        if (response.status === 401 && options.auth && attempt === 0) continue
        let result: unknown
        try { result = await response.json() } catch { throw new CommunityError('invalid_response', '社区返回了无法读取的内容，请稍后重试。') }
        if (!response.ok) {
          const body = result as { error?: { code?: string; message?: string } }
          throw new CommunityError(body?.error?.code ?? 'request_failed', body?.error?.message?.slice(0, 200) ?? '操作暂时未完成，请重试。', response.status, Number(response.headers.get('Retry-After')) || 0)
        }
        if (!result || typeof result !== 'object' || !('data' in result)) throw new CommunityError('invalid_response', '社区返回内容不完整，请稍后重试。')
        return result as T
      }
      throw new CommunityError('session_missing', '请重新连接社区身份。', 401)
    },
  }
}

export function parseCommunityExternalLink(value: string) {
  const url = new URL(value)
  const host = url.hostname.toLowerCase()
  // These names can be privileged launcher windows in Electron, especially during development.
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || host === 'app' || host === 'xmcl.runtime' || host.endsWith('.xmcl.runtime') || host.startsWith('localhost') || host.endsWith('.localhost') || host === '127.0.0.1' || host === '[::1]') {
    throw new CommunityError('invalid_external_link', '不能从社区打开启动器内部地址或包含凭据的链接。')
  }
  return url.href
}
export function communityTime(time: number) {
  const seconds = Math.max(0, Math.floor((Date.now() - time) / 1000))
  if (seconds < 60) return '刚刚'
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`
  return new Date(time).toLocaleDateString('zh-CN')
}
