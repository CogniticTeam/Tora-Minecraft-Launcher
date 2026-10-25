export interface ToolboxLink {
  id: string
  name: string
  href: string
  fallback: string
}
export interface ToolboxCategory {
  id: string
  links: ToolboxLink[]
}

export const toolboxCategories: ToolboxCategory[] = [
  { id: 'reference', links: [
    { id: 'mcmod', name: 'MC百科（MCMOD）', href: 'https://www.mcmod.cn', fallback: 'menu_book' },
    { id: 'minecraft-wiki', name: 'Minecraft Wiki', href: 'https://minecraft.wiki', fallback: 'auto_stories' },
    { id: 'chunkbase', name: 'Chunkbase', href: 'https://www.chunkbase.com', fallback: 'map' },
    { id: 'mcseedmap', name: 'MCSeedMap', href: 'https://mcseedmap.com/zh-cn', fallback: 'travel_explore' },
    { id: 'minecraft-tools', name: 'Minecraft Tools', href: 'https://minecrafttools.wiki', fallback: 'construction' },
    { id: 'seedlander', name: 'SeedLander', href: 'https://www.seedlander.com', fallback: 'landscape' },
    { id: 'chunkseed', name: 'ChunkSeed', href: 'https://chunkseed.com/zh-cn', fallback: 'grid_view' },
    { id: 'ezseed', name: 'Ezseed', href: 'https://ezseed.net', fallback: 'explore' },
  ] },
  { id: 'resources', links: [
    { id: 'curseforge', name: 'CurseForge', href: 'https://www.curseforge.com/minecraft', fallback: 'extension' },
    { id: 'modrinth', name: 'Modrinth', href: 'https://modrinth.com', fallback: 'extension' },
    { id: 'planet-minecraft', name: 'Planet Minecraft', href: 'https://www.planetminecraft.com', fallback: 'public' },
    { id: 'mcpedl', name: 'MCPEDL', href: 'https://mcpedl.org', fallback: 'inventory_2' },
    { id: '9minecraft', name: '9Minecraft', href: 'https://www.9minecraft.net', fallback: 'download' },
    { id: 'shadersmods', name: 'ShadersMods', href: 'https://shadersmods.com/category/shaderpacks', fallback: 'wb_sunny' },
    { id: 'resourcepack', name: 'ResourcePack.net', href: 'https://resourcepack.net', fallback: 'texture' },
  ] },
  { id: 'players', links: [
    { id: 'namemc', name: 'NameMC', href: 'https://namemc.com', fallback: 'person_search' },
    { id: 'mclogs', name: 'mclo.gs', href: 'https://mclo.gs', fallback: 'description' },
    { id: 'aternos', name: 'Aternos', href: 'https://aternos.org', fallback: 'dns' },
    { id: 'minotar', name: 'Minotar', href: 'https://minotar.net', fallback: 'face' },
  ] },
  { id: 'community', links: [
    { id: 'klpbbs', name: '苦力怕论坛', href: 'https://klpbbs.com', fallback: 'forum' },
  ] },
  { id: 'loaders', links: [
    { id: 'fabric', name: 'Fabric', href: 'https://fabricmc.net', fallback: 'layers' },
    { id: 'neoforge', name: 'NeoForge', href: 'https://neoforged.net', fallback: 'build' },
    { id: 'optifine', name: 'OptiFine', href: 'https://optifine.net', fallback: 'visibility' },
  ] },
]
