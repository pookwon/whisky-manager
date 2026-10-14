import { createHash } from 'node:crypto'
import { createWriteStream, mkdirSync, readdirSync, renameSync, rmSync, type WriteStream } from 'node:fs'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import type { UpdateCandidate } from '../shared/releaseSelection.js'
import { MAX_REDIRECT_HOPS, isAllowedRedirectTarget, isReleaseAssetUrl } from '../shared/updateSource.js'

export interface HttpReply {
  readonly status: number
  /** The redirect target, when the reply is one. */
  readonly location: string | null
  readonly body: AsyncIterable<Uint8Array> | null
  /** Releases a body that will not be read, such as a redirect's. */
  readonly discard?: () => void
}

/**
 * One request, no redirect following. The caller walks redirects itself so
 * that every hop is checked; a client that follows them silently would hide
 * the very addresses that need checking.
 */
export interface HttpPort {
  get(url: string): Promise<HttpReply>
}

export type DownloadResult =
  | { readonly kind: 'downloaded'; readonly path: string }
  | { readonly kind: 'failed'; readonly reason: 'DOWNLOAD_FAILED' | 'DIGEST_MISMATCH' }

const PART_SUFFIX = '.part'

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308
}

async function openBody(http: HttpPort, url: string): Promise<AsyncIterable<Uint8Array> | null> {
  let target = url
  for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop += 1) {
    const allowed = hop === 0 ? isReleaseAssetUrl(target) : isAllowedRedirectTarget(target)
    if (!allowed) return null
    const reply = await http.get(target)
    if (isRedirect(reply.status)) {
      reply.discard?.()
      if (reply.location === null) return null
      target = new URL(reply.location, target).toString()
      continue
    }
    return reply.status === 200 ? reply.body : null
  }
  return null
}

/** Removes everything in `directory` except the file about to be kept. */
function clearOthers(directory: string, keep: string): void {
  for (const name of readdirSync(directory)) {
    if (name !== keep) rmSync(join(directory, name), { recursive: true, force: true })
  }
}

/**
 * A destroyed write stream may still be opening its file. Removing the part
 * file before the stream has closed lets that open recreate it afterwards, so
 * a failed download would leave a partial file behind.
 */
function closed(stream: WriteStream): Promise<void> {
  if (stream.closed) return Promise.resolve()
  return new Promise((resolve) => stream.once('close', () => resolve()))
}

/**
 * Fetches the candidate into `directory` and keeps it only if it is exactly
 * the file the release described. The file appears under its final name only
 * after both its length and its digest match, so anything found there is
 * known good.
 */
export async function downloadUpdate(candidate: UpdateCandidate, directory: string, http: HttpPort): Promise<DownloadResult> {
  mkdirSync(directory, { recursive: true })
  const finalPath = join(directory, candidate.assetName)
  const partName = `${candidate.assetName}${PART_SUFFIX}`
  const partPath = join(directory, partName)
  rmSync(partPath, { force: true })

  let sink: WriteStream | null = null
  try {
    const body = await openBody(http, candidate.url)
    if (body === null) return { kind: 'failed', reason: 'DOWNLOAD_FAILED' }

    sink = createWriteStream(partPath)
    const hash = createHash('sha256')
    let size = 0
    // A pipeline carries a failure from either end — the network or the disk —
    // to this one await, and ends both streams. Hand-rolled backpressure left a
    // write error with nobody listening.
    await pipeline(
      body,
      async function* count(source: AsyncIterable<Uint8Array>) {
        for await (const chunk of source) {
          size += chunk.byteLength
          hash.update(chunk)
          yield chunk
        }
      },
      sink,
    )

    if (size !== candidate.size) {
      rmSync(partPath, { force: true })
      return { kind: 'failed', reason: 'DOWNLOAD_FAILED' }
    }
    if (hash.digest('hex') !== candidate.sha256) {
      rmSync(partPath, { force: true })
      return { kind: 'failed', reason: 'DIGEST_MISMATCH' }
    }
    // Earlier versions go only now: a download that fails must not take the
    // file of an update that is already waiting along with it.
    clearOthers(directory, partName)
    rmSync(finalPath, { force: true })
    renameSync(partPath, finalPath)
    return { kind: 'downloaded', path: finalPath }
  } catch {
    if (sink !== null) await closed(sink)
    rmSync(partPath, { force: true })
    return { kind: 'failed', reason: 'DOWNLOAD_FAILED' }
  }
}
