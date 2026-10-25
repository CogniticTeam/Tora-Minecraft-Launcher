import { Arch, Platform, build } from 'electron-builder'
import { spawnSync } from 'child_process'
import { resolve } from 'path'
import { version } from '../../package.json'
import { config } from './build/electron-builder.config'

/** Local macOS build only: no publisher, Developer ID discovery, or notarization. */
async function main() {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') {
    throw new Error('此本地打包入口仅支持 macOS Apple Silicon。')
  }
  process.env.CSC_IDENTITY_AUTO_DISCOVERY = 'false'
  const compile = spawnSync('pnpm', ['run', 'compile'], {
    cwd: __dirname,
    env: { ...process.env, NODE_ENV: 'production', CSC_IDENTITY_AUTO_DISCOVERY: 'false' },
    stdio: 'inherit',
  })
  if (compile.status !== 0) throw new Error('主进程编译失败')
  await build({
    targets: Platform.MAC.createTarget('dir', Arch.arm64),
    publish: 'never',
    config: {
      ...config,
      extraMetadata: { version },
      forceCodeSigning: false,
      npmRebuild: false,
      publish: [],
      directories: { ...config.directories, output: resolve(__dirname, '../../release'), app: __dirname },
      extraResources: [
        ...config.extraResources,
        { from: resolve(__dirname, '../LICENSE'), to: 'LICENSE-XMCL.txt' },
        { from: resolve(__dirname, '../../LICENSE'), to: 'LICENSE-TORA.txt' },
        { from: resolve(__dirname, '../../NOTICE'), to: 'NOTICE-TORA.txt' },
        { from: resolve(__dirname, '../../THIRD_PARTY_NOTICES.md'), to: 'THIRD_PARTY_NOTICES.md' },
      ],
      mac: { ...config.mac, identity: null, notarize: false, target: [{ target: 'dir', arch: ['arm64'] }] },
    },
  } as Parameters<typeof build>[0])
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
