export interface DiagnosisIssue { id: string; title: string; detail: string; evidence?: string; severity: 'error' | 'warning' | 'info'; action?: 'java' | 'memory' | 'repair' | 'mods' | 'snapshots' }

/** Local rules only. Evidence is a short matching line, never the complete private log. */
export function diagnoseLaunchLog(log: string): DiagnosisIssue[] {
  const rules: { id: string; pattern: RegExp; title: string; detail: string; action: DiagnosisIssue['action'] }[] = [
    { id: 'java-version', pattern: /UnsupportedClassVersionError|class file version \d+\.\d+|requires Java (?:17|21|25)/i, title: 'Java 版本不匹配', detail: '当前 Java 无法运行游戏或某个模组。请选择与游戏版本兼容的 Java，再核对模组要求。', action: 'java' },
    { id: 'java-missing', pattern: /JavaNotFound|no suitable java|没有找到合适的 Java|Cannot run program.*java|java.*ENOENT/i, title: '没有可用的 Java', detail: '检查 Java 路径，或在实例 Java 设置中安装兼容运行时。', action: 'java' },
    { id: 'memory', pattern: /OutOfMemoryError|Could not reserve enough space|Cannot allocate memory|insufficient memory|Native memory allocation.*failed/i, title: '内存不足', detail: 'Java 堆内存不足时可适当提高分配；系统内存不足时应关闭其它应用或降低分配。不要直接拉满系统内存。', action: 'memory' },
    { id: 'mod-dependency', pattern: /Missing mandatory dependencies|requires.*(?:fabric|forge|neoforge|quilt)|Incompatible mod set|ModResolutionException|depends on.*(?:missing|not present)/i, title: '模组依赖或兼容性问题', detail: '检查模组页中的依赖提示，核对游戏版本和加载器。更换模组前可先创建快照。', action: 'mods' },
    { id: 'duplicate-mod', pattern: /DuplicateModsFoundException|Duplicate mod|duplicate.*mod.?id/i, title: '检测到重复模组', detail: '同一个模组可能安装了多个版本。请在模组页核对后停用多余版本。', action: 'mods' },
    { id: 'game-files', pattern: /ClassNotFoundException: net\.minecraft|Invalid or corrupt jarfile|Failed to find Minecraft|Unable to access jarfile|(?:minecraft|client).*jar.*(?:missing|not found)/i, title: '游戏文件可能缺失或损坏', detail: '可检查并重新安装当前游戏版本的运行文件。此操作不会自动删除存档。', action: 'repair' },
    { id: 'graphics', pattern: /GLFW error 6554[234]|OpenGL.*(?:not supported|failed)|failed to create.*GL context|Pixel format not accelerated/i, title: '图形环境不兼容', detail: '检查显卡驱动、游戏与系统支持情况，尝试暂时停用光影。此问题不一定能通过重装游戏解决。', action: 'mods' },
  ]
  const lines = log.slice(-1024 * 1024).split(/\r?\n/)
  return rules.flatMap(rule => { const evidence = lines.find(line => rule.pattern.test(line)); return evidence ? [{ id: rule.id, title: rule.title, detail: rule.detail, action: rule.action, evidence: evidence.replace(/((?:access_token|refresh_token|password)[=: ]+)\S+|((?:authorization)[=: ]+)(?:bearer\s+)?\S+/gi, '[凭据已隐藏]').slice(0, 240), severity: 'error' as const }] : [] })
}
