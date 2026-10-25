import type { LauncherAppPlugin } from '~/app'
import { setRuntimeTelemetryEnabled } from '../telemetry_context'

/**
 * TORA fork: upstream telemetry exporters are deliberately not constructed.
 * Keep renderer IPC available so the original interface remains unchanged.
 * Original XMCL attribution and MIT license are retained in the repository.
 */
export const pluginTelemetry: LauncherAppPlugin = async (app) => {
  setRuntimeTelemetryEnabled(false)
  app.controller.handle('renderer-telemetry-exception', () => {})
  app.controller.handle('renderer-telemetry-flush', async () => {})
  app.controller.handle('renderer-telemetry-action-start', () => undefined)
  app.controller.handle('renderer-telemetry-action-end', () => undefined)
  app.getLogger('Telemetry').log('TORA telemetry is disabled; no upstream exporters are initialized.')
}
