import { describe, expect, it } from 'vitest'
import { locateMemberResumePosition, type MemberScheduledReader } from '../../src/desktop/memberCollectionResume.js'
import type { CollectedMember, CollectedMemberPage } from '../../src/shared/cafeMemberList.js'

function member(key: string, joinDate: string): CollectedMember {
  return { memberKey: key, nickname: null, joinDate, levelName: '', isManager: false, isStaff: false }
}
function page(items: CollectedMember[]): CollectedMemberPage {
  return { items, pageIdentity: `id:${items.map((m) => m.memberKey).join(',')}` }
}
function reader(pages: Record<number, CollectedMemberPage>): MemberScheduledReader {
  return { collect: async (n: number) => pages[n] ?? page([]), observedAt: () => new Date(0), reads: 0 }
}

describe('locateMemberResumePosition', () => {
  it('resumes right after the anchor on its reference page', async () => {
    const pages = { 5: page([member('a', '2026-08-23'), member('b', '2026-08-23'), member('c', '2026-08-22')]) }
    const found = await locateMemberResumePosition(reader(pages), { anchorMemberKey: 'b', anchorJoinDate: '2026-08-23', referencePage: 5 })
    expect(found).toMatchObject({ kind: 'found', page: 5, offset: 2 })
  })

  it('steps forward when the reference page is now newer than the anchor', async () => {
    const pages = {
      5: page([member('n1', '2026-08-25'), member('n2', '2026-08-24')]), // all newer than anchor
      6: page([member('a', '2026-08-23'), member('b', '2026-08-23')]),
    }
    const found = await locateMemberResumePosition(reader(pages), { anchorMemberKey: 'b', anchorJoinDate: '2026-08-23', referencePage: 5 })
    expect(found).toMatchObject({ kind: 'found', page: 6, offset: 2 })
  })

  it('steps backward when the reference page is older than the anchor', async () => {
    const pages = {
      5: page([member('o1', '2026-08-20'), member('o2', '2026-08-19')]), // older than anchor
      4: page([member('a', '2026-08-23'), member('b', '2026-08-23'), member('x', '2026-08-22')]),
    }
    const found = await locateMemberResumePosition(reader(pages), { anchorMemberKey: 'b', anchorJoinDate: '2026-08-23', referencePage: 5 })
    expect(found).toMatchObject({ kind: 'found', page: 4, offset: 2 })
  })

  it('after a seceded anchor, resumes after the last member of the same join date', async () => {
    const pages = { 5: page([member('a', '2026-08-23'), member('c', '2026-08-23'), member('d', '2026-08-22')]) }
    // anchor 'b' is gone but its join date 2026-08-23 still on the page.
    const found = await locateMemberResumePosition(reader(pages), { anchorMemberKey: 'b', anchorJoinDate: '2026-08-23', referencePage: 5 })
    expect(found).toMatchObject({ kind: 'found', page: 5, offset: 2 })
  })
})
