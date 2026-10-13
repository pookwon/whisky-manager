import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { downloadUpdate, type HttpPort, type HttpReply } from '../../src/desktop/updateDownload.js'
import type { UpdateCandidate } from '../../src/shared/releaseSelection.js'

const ASSET_URL = 'https://github.com/pookwon/whisky-manager/releases/download/v1.9.18/Whisky-Manager-1.9.18.msi'
const CDN_URL = 'https://release-assets.githubusercontent.com/blob/1'
const BYTES = Buffer.from('installer bytes')

function candidate(overrides: Partial<UpdateCandidate> = {}): UpdateCandidate {
  return {
    version: '1.9.18',
    assetName: 'Whisky-Manager-1.9.18.msi',
    url: ASSET_URL,
    sha256: createHash('sha256').update(BYTES).digest('hex'),
    size: BYTES.byteLength,
    ...overrides,
  }
}

async function* chunks(...parts: Buffer[]): AsyncGenerator<Uint8Array> {
  for (const part of parts) yield part
}

function ok(body: Buffer): HttpReply {
  return { status: 200, location: null, body: chunks(body.subarray(0, 4), body.subarray(4)) }
}

function redirect(to: string): HttpReply {
  return { status: 302, location: to, body: null }
}

function http(routes: Record<string, HttpReply>): HttpPort & { readonly requested: string[] } {
  const requested: string[] = []
  return {
    requested,
    async get(url) {
      requested.push(url)
      const reply = routes[url]
      if (reply === undefined) throw new Error(`unexpected request ${url}`)
      return reply
    },
  }
}

let directory: string

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'wm-update-'))
})

afterEach(() => {
  rmSync(directory, { recursive: true, force: true })
})

describe('downloading an update', () => {
  it('keeps the file under its own name once length and digest match', async () => {
    const result = await downloadUpdate(candidate(), directory, http({ [ASSET_URL]: redirect(CDN_URL), [CDN_URL]: ok(BYTES) }))

    expect(result).toEqual({ kind: 'downloaded', path: join(directory, 'Whisky-Manager-1.9.18.msi') })
    expect(readFileSync(join(directory, 'Whisky-Manager-1.9.18.msi'))).toEqual(BYTES)
    expect(readdirSync(directory)).toEqual(['Whisky-Manager-1.9.18.msi'])
  })

  it('discards a file whose digest differs', async () => {
    const result = await downloadUpdate(candidate({ sha256: '0'.repeat(64) }), directory, http({ [ASSET_URL]: ok(BYTES) }))

    expect(result).toEqual({ kind: 'failed', reason: 'DIGEST_MISMATCH' })
    expect(readdirSync(directory)).toEqual([])
  })

  it('discards a file of the wrong length', async () => {
    const result = await downloadUpdate(candidate({ size: BYTES.byteLength + 1 }), directory, http({ [ASSET_URL]: ok(BYTES) }))

    expect(result).toEqual({ kind: 'failed', reason: 'DOWNLOAD_FAILED' })
    expect(readdirSync(directory)).toEqual([])
  })

  it('does not follow a redirect to a host that is not GitHub’s', async () => {
    const evil = 'https://evil.example/installer.msi'
    const port = http({ [ASSET_URL]: redirect(evil), [evil]: ok(BYTES) })

    expect(await downloadUpdate(candidate(), directory, port)).toEqual({ kind: 'failed', reason: 'DOWNLOAD_FAILED' })
    expect(port.requested).toEqual([ASSET_URL])
  })

  it('gives up on a redirect that never ends', async () => {
    const port = http({ [ASSET_URL]: redirect(CDN_URL), [CDN_URL]: redirect(CDN_URL) })

    expect(await downloadUpdate(candidate(), directory, port)).toEqual({ kind: 'failed', reason: 'DOWNLOAD_FAILED' })
    expect(port.requested.length).toBeLessThanOrEqual(6)
  })

  it('refuses a candidate whose address is not a release asset', async () => {
    const port = http({})
    const result = await downloadUpdate(candidate({ url: 'https://evil.example/a.msi' }), directory, port)

    expect(result).toEqual({ kind: 'failed', reason: 'DOWNLOAD_FAILED' })
    expect(port.requested).toEqual([])
  })

  it('reports a network error as a failed download and leaves nothing behind', async () => {
    const result = await downloadUpdate(candidate(), directory, http({}))

    expect(result).toEqual({ kind: 'failed', reason: 'DOWNLOAD_FAILED' })
    expect(readdirSync(directory)).toEqual([])
  })

  it('clears the files of earlier versions once the new one is kept', async () => {
    writeFileSync(join(directory, 'Whisky-Manager-1.9.16.msi'), 'old')
    writeFileSync(join(directory, 'Whisky-Manager-1.9.18.msi.part'), 'half')

    await downloadUpdate(candidate(), directory, http({ [ASSET_URL]: ok(BYTES) }))

    expect(readdirSync(directory)).toEqual(['Whisky-Manager-1.9.18.msi'])
    expect(existsSync(join(directory, 'Whisky-Manager-1.9.16.msi'))).toBe(false)
  })

  it('keeps the file of a waiting update when the newer one fails to download', async () => {
    writeFileSync(join(directory, 'Whisky-Manager-1.9.17.msi'), 'waiting')

    const result = await downloadUpdate(candidate({ sha256: '0'.repeat(64) }), directory, http({ [ASSET_URL]: ok(BYTES) }))

    expect(result.kind).toBe('failed')
    expect(readdirSync(directory)).toEqual(['Whisky-Manager-1.9.17.msi'])
  })

  it('fails, and leaves no partial file, when the body breaks off mid-stream', async () => {
    async function* broken(): AsyncGenerator<Uint8Array> {
      yield BYTES.subarray(0, 4)
      throw new Error('connection reset')
    }
    const port: HttpPort = { get: async () => ({ status: 200, location: null, body: broken() }) }

    expect(await downloadUpdate(candidate(), directory, port)).toEqual({ kind: 'failed', reason: 'DOWNLOAD_FAILED' })
    expect(readdirSync(directory)).toEqual([])
  })
})
