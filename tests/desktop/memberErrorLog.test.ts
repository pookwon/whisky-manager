import { describe, expect, it } from 'vitest'
import { safeMemberErrorFields } from '../../src/desktop/memberErrorLog.js'

const MEMBER_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const NICKNAME = '위스키러버'

/** What drizzle actually throws: message built from the SQL and the bound values. */
class DrizzleQueryError extends Error {
  readonly params: unknown[]
  constructor(query: string, params: unknown[]) {
    super(`Failed query: ${query}\nparams: ${params.join(',')}`)
    this.name = 'DrizzleQueryError'
    this.params = params
    this.query = query
  }
  readonly query: string
}

/** The same class after a minifier has renamed it. */
class RenamedQueryError extends Error {
  readonly params: unknown[]
  constructor(query: string, params: unknown[]) {
    super(`Failed query: ${query}\nparams: ${params.join(',')}`)
    this.name = 'e'
    this.params = params
  }
}

function serialized(error: Error): string {
  return JSON.stringify(safeMemberErrorFields(error))
}

describe('safeMemberErrorFields', () => {
  it('drops the message of a query error, which carries the bound member rows', () => {
    const error = new DrizzleQueryError('insert into "members" values ($1, $2)', [MEMBER_KEY, NICKNAME])

    const safe = safeMemberErrorFields(error)

    expect(safe.message).toBeUndefined()
    expect(safe.query).toBe('insert into "members" values ($1, $2)')
    expect(serialized(error)).not.toContain(MEMBER_KEY)
    expect(serialized(error)).not.toContain(NICKNAME)
  })

  it('drops the message even when the query error class has been renamed', () => {
    const error = new RenamedQueryError('insert into "members" values ($1, $2)', [MEMBER_KEY, NICKNAME])

    expect(safeMemberErrorFields(error).message).toBeUndefined()
    expect(serialized(error)).not.toContain(MEMBER_KEY)
    expect(serialized(error)).not.toContain(NICKNAME)
  })

  it('keeps the fixed message of the repository’s own guards, which is the whole diagnosis', () => {
    const safe = safeMemberErrorFields(new Error('member run does not exist'))

    expect(safe.message).toBe('member run does not exist')
    expect(safe.name).toBe('Error')
  })

  it('never reads the pg fields that quote the failing row', () => {
    const error = Object.assign(new Error('duplicate key value violates unique constraint'), {
      name: 'error',
      code: '23505',
      constraint: 'members_pkey',
      detail: `Key (member_key)=(${MEMBER_KEY}) already exists.`,
      where: `row containing ${NICKNAME}`,
    })

    const safe = safeMemberErrorFields(error)

    expect(safe.code).toBe('23505')
    expect(safe.constraint).toBe('members_pkey')
    expect(serialized(error)).not.toContain(MEMBER_KEY)
    expect(serialized(error)).not.toContain(NICKNAME)
  })

  it('carries the code of the walk’s own page errors', () => {
    const error = Object.assign(new Error('MEMBER_PAGE_FORBIDDEN'), { code: 'MEMBER_PAGE_FORBIDDEN' })

    const safe = safeMemberErrorFields(error)

    expect(safe.code).toBe('MEMBER_PAGE_FORBIDDEN')
    expect(safe.message).toBe('MEMBER_PAGE_FORBIDDEN')
  })
})
