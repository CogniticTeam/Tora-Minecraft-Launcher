import { generateKeyPair, createPublicKey } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'

const generate = promisify(generateKeyPair)
const pending = new Map<string, Promise<{ publicKey: string; privateKey: string }>>()

/** Local texture signatures use a per-install identity, never a shared key in source. */
export function localSigningIdentity(appData: string) {
  const path = join(appData, 'identities', 'texture-signing.pem')
  let identity = pending.get(path)
  if (!identity) {
    identity = load(path)
    pending.set(path, identity)
    identity.catch(() => pending.delete(path))
  }
  return identity
}

async function load(path: string) {
  let privateKey: string
  try { privateKey = await readFile(path, 'utf8') } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    await mkdir(dirname(path), { recursive: true, mode: 0o700 })
    const pair = await generate('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    })
    try { await writeFile(path, pair.privateKey, { flag: 'wx', mode: 0o600 }); privateKey = pair.privateKey } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      privateKey = await readFile(path, 'utf8')
    }
  }
  const publicKey = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString()
  return { publicKey, privateKey }
}
