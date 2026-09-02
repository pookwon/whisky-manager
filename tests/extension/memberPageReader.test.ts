import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createMemberPageReader } from '../../src/extension/memberPageReader.js'
import { cafeMemberListUrl } from '../../src/shared/cafeMemberFixture.js'
import type { CollectMemberPageRequest } from '../../src/shared/protocol.js'

const sample = readFileSync(fileURLToPath(new URL('../fixtures/cafe-member-list-sample.json', import.meta.url)), 'utf8')

const request: CollectMemberPageRequest = {
  type: 'COLLECT_MEMBER_PAGE',
  requestId: 'm-1',
  cafeId: '14538121',
  page: 1,
  perPage: 100,
}

describe('MemberPageReader', () => {
  it('fetches and parses exactly one member list page', async () => {
    const seen: string[] = []
    const reader = createMemberPageReader({
      http: async ({ url }) => {
        seen.push(url)
        return { status: 200, contentType: 'application/json', text: sample }
      },
    })
    await expect(reader.read(request)).resolves.toMatchObject({ ok: true, page: 1 })
    expect(seen).toEqual([cafeMemberListUrl(1)])
  })

  it('maps invalid request, HTTP failure, network error, bad JSON, forbidden, and parse errors', async () => {
    const bad = createMemberPageReader({ http: async () => ({ status: 200, contentType: null, text: sample }) })
    await expect(bad.read({ ...request, page: 0 } as CollectMemberPageRequest)).resolves.toEqual({ ok: false, code: 'MEMBER_PAGE_BAD_REQUEST' })

    const http = createMemberPageReader({ http: async () => ({ status: 500, contentType: 'text/html', text: 'x' }) })
    await expect(http.read(request)).resolves.toEqual({ ok: false, code: 'MEMBER_PAGE_HTTP_ERROR' })

    const forbidden = createMemberPageReader({ http: async () => ({ status: 200, contentType: 'application/json', text: '{"isSuccess":false,"result":{"members":[]}}' }) })
    await expect(forbidden.read(request)).resolves.toEqual({ ok: false, code: 'MEMBER_PAGE_FORBIDDEN' })

    const network = createMemberPageReader({ http: async () => { throw new Error('reset') } })
    await expect(network.read(request)).resolves.toEqual({ ok: false, code: 'MEMBER_PAGE_NETWORK_ERROR' })

    const invalidJson = createMemberPageReader({ http: async () => ({ status: 200, contentType: 'text/html', text: '<html>login</html>' }) })
    await expect(invalidJson.read(request)).resolves.toEqual({ ok: false, code: 'MEMBER_PAGE_INVALID_JSON' })

    const malformed = createMemberPageReader({ http: async () => ({ status: 200, contentType: 'application/json', text: '{"isSuccess":true,"result":{"members":[{"memberKey":42}]}}' }) })
    await expect(malformed.read(request)).resolves.toEqual({ ok: false, code: 'MEMBER_PAGE_PARSE_ERROR' })
  })
})
