import { extractOgImage } from '../shared/cafeImage.js'
import type { Clock } from '../shared/ports.js'
import { TIMEOUTS } from '../shared/protocol.js'
import type { SettingsRepo } from './db/settingsRepo.js'
import type { ExtensionTransport } from './ws/server.js'

const IMAGE_URL_KEY = 'cafeImageUrl'
const IMAGE_FETCHED_AT_KEY = 'cafeImageFetchedAt'
/** The cafe's image rarely changes; a day between probes keeps this well clear of bot detection. */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000

export interface CafeImageDeps {
  readonly transport: ExtensionTransport
  readonly settings: SettingsRepo
  readonly clock: Clock
  readonly newId: () => string
}

/**
 * Cached read of the cafe's preview image, fetched through the extension's
 * logged-in session (the same path as every other cafe request) rather than a
 * bare main-process HTTP call. A stale cache is preferred over no image
 * whenever the bridge is disconnected or the probe fails.
 */
export async function getCafeImage(deps: CafeImageDeps, cafeUrlName: string): Promise<string | null> {
  const fetchedAt = Number(deps.settings.get(IMAGE_FETCHED_AT_KEY) ?? 0)
  const cached = deps.settings.get(IMAGE_URL_KEY) ?? null
  if (deps.clock.now() - fetchedAt < CACHE_TTL_MS) return cached
  if (!deps.transport.isConnected()) return cached

  const reply = await deps.transport.request(
    { type: 'PROBE', requestId: deps.newId(), url: `https://cafe.naver.com/${cafeUrlName}` },
    TIMEOUTS.probeMs,
  )
  // Stamped even on failure, so a persistently unreachable cafe is retried once
  // a day rather than on every call.
  deps.settings.set(IMAGE_FETCHED_AT_KEY, String(deps.clock.now()))
  if (reply.type !== 'PROBE_RESULT' || reply.error !== null) return cached

  const imageUrl = extractOgImage(reply.text)
  if (imageUrl !== null) deps.settings.set(IMAGE_URL_KEY, imageUrl)
  return imageUrl ?? cached
}
