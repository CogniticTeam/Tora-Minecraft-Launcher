export const IS_DEV = process.env.NODE_ENV === 'development'
// TORA fork: keep application data and credentials separate from upstream XMCL.
export const LAUNCHER_NAME = 'tora-minecraft-launcher'
export const GAME_DIRECTORY_NAME = '.tora-minecraft'
export const RESOURCE_FILE_VERSION = 2
export const HAS_DEV_SERVER = !!process.env.HAS_DEV_SERVER

// Public application identity registered for TORA; this is not a client secret.
export const TORA_REGISTERED_MICROSOFT_CLIENT_ID = '1710c023-af88-403a-bcc3-59e0dda23f09'

export function getToraMicrosoftClientId() {
  return process.env.TORA_MICROSOFT_CLIENT_ID?.trim() || TORA_REGISTERED_MICROSOFT_CLIENT_ID
}
