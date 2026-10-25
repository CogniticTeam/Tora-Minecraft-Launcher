import { LauncherAppPlugin } from '~/app'
import { kFlights } from '../flights'

const BUILTIN_FLIGHTS = {
  builtinAgent: true,
  toraDeviceSessions: true,
}

export const DEVELOPMENT_XMCL_BILLING_API_BASE_URL = 'https://154.8.230.216'

export function applyDevelopmentApiFlight(
  flights: Record<string, any>,
  environment = process.env.NODE_ENV,
) {
  if (environment === 'development') {
    flights.xmclBillingApiBaseUrl = DEVELOPMENT_XMCL_BILLING_API_BASE_URL
  }
  return flights
}

export function applyRemoteFlights(
  flights: Record<string, any>,
  remote: Record<string, any>,
  environment = process.env.NODE_ENV,
) {
  Object.assign(flights, remote)
  const persisted = { ...flights }
  if (
    environment === 'development' &&
    !Object.hasOwn(remote, 'xmclBillingApiBaseUrl') &&
    persisted.xmclBillingApiBaseUrl === DEVELOPMENT_XMCL_BILLING_API_BASE_URL
  ) {
    delete persisted.xmclBillingApiBaseUrl
  }
  applyDevelopmentApiFlight(flights, environment)
  return persisted
}

/** TORA uses local flags and never sends its client token to XMCL's flight service. */
export const pluginFlights: LauncherAppPlugin = async (app) => {
  const flights = {
    ...BUILTIN_FLIGHTS,
    // Expose capability only; the provider credential stays in the main process.
    curseforgeAvailable: !!process.env.CURSEFORGE_API_KEY?.trim(),
  }
  app.protocol.registerHandler('http', async ({ request, response }) => {
    if (request.url.host === 'launcher' && request.url.pathname === '/flights') {
      response.status = 200
      response.headers = { 'content-type': 'application/javascript' }
      response.body = `window.flights = ${JSON.stringify(flights)}`
    }
  })
  app.registry.register(kFlights, flights)
}
