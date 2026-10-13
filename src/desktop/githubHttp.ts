import { Readable } from 'node:stream'
import { LATEST_RELEASE_URL } from '../shared/updateSource.js'
import type { HttpPort } from './updateDownload.js'

const USER_AGENT = 'whisky-manager-updater'
const CHECK_TIMEOUT_MS = 15_000
const DOWNLOAD_TIMEOUT_MS = 10 * 60_000

/** The latest release as GitHub describes it; rejects on any non-success answer. */
export async function fetchLatestRelease(): Promise<unknown> {
  const reply = await fetch(LATEST_RELEASE_URL, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
  })
  if (!reply.ok) throw new Error(`release check answered ${reply.status}`)
  return reply.json()
}

/** One GET with redirects left for the caller to walk and vet. */
export const githubHttp: HttpPort = {
  async get(url) {
    const reply = await fetch(url, {
      redirect: 'manual',
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    })
    return {
      status: reply.status,
      location: reply.headers.get('location'),
      body: reply.body === null ? null : Readable.fromWeb(reply.body as never),
      discard: () => void reply.body?.cancel().catch(() => undefined),
    }
  },
}
