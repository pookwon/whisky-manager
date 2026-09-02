import { describe, expect, it } from 'vitest'
import { locateMemberResumePosition, MEMBER_RESUME_SCAN_PAGE_LIMIT, type MemberScheduledReader } from '../../src/desktop/memberCollectionResume.js'
import type { CollectedMember, CollectedMemberPage } from '../../src/shared/cafeMemberList.js'

function member(key: string, joinDate: string): CollectedMember {
  return { memberKey: key, nickname: null, joinDate, levelName: '', isManager: false, isStaff: false }
}
function page(items: CollectedMember[]): CollectedMemberPage {
  return { items, pageIdentity: `id:${items.map((m) => m.memberKey).join(',')}`, totalMemberCount: null }
}
function reader(pages: Record<number, CollectedMemberPage>): MemberScheduledReader {
  const fetch = async (n: number) => pages[n] ?? page([])
  return { collect: fetch, probe: fetch, observedAt: () => new Date(0), reads: 0 }
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

  it('after a seceded anchor, resumes from the first member of the same join date', async () => {
    const pages = { 5: page([member('a', '2026-08-23'), member('c', '2026-08-23'), member('d', '2026-08-22')]) }
    // anchor 'b' is gone but its join date 2026-08-23 still appears on the page.
    // Resume must start at the first 08-23 entry (index 0), not skip to after 'c'.
    const found = await locateMemberResumePosition(reader(pages), { anchorMemberKey: 'b', anchorJoinDate: '2026-08-23', referencePage: 5 })
    expect(found).toMatchObject({ kind: 'found', page: 5, offset: 0 })
  })

  it('does not skip a same-date member that sits between the anchor and later members when the anchor secedes', async () => {
    // 'b' (08-23) was the anchor; 'c' (08-23) was on the next page and not yet
    // collected. After 'b' secedes, the page now reads [a, c, d]. Resuming
    // after the last 08-23 entry ('c') would permanently lose 'c'. The walk must
    // start from the first 08-23 entry ('a') so 'c' is not skipped.
    const pages = { 5: page([member('a', '2026-08-23'), member('c', '2026-08-23'), member('d', '2026-08-22')]) }
    const found = await locateMemberResumePosition(reader(pages), { anchorMemberKey: 'b', anchorJoinDate: '2026-08-23', referencePage: 5 })
    if (found.kind !== 'found') throw new Error('expected found')
    // 'c' must appear in the slice starting at the returned offset
    const resumedKeys = found.candidate.items.slice(found.offset).map((m) => m.memberKey)
    expect(resumedKeys).toContain('c')
  })

  it('returns found with offset 0 when the scan overshoots in the forward direction', async () => {
    // The anchor (08-22) seceded and fell between pages 6 and 7. The scan
    // steps forward from page 5 (all newer), reaches page 6 (still newer),
    // then page 7 (entirely older) — overshoots in direction +1. The flip
    // branch returns page 7 with offset 0 so no member from that date block
    // is skipped.
    const pages = {
      5: page([member('n1', '2026-08-25'), member('n2', '2026-08-24')]),
      6: page([member('n3', '2026-08-24'), member('n4', '2026-08-23')]),
      7: page([member('o1', '2026-08-20'), member('o2', '2026-08-19')]),
    }
    const found = await locateMemberResumePosition(reader(pages), { anchorMemberKey: 'x', anchorJoinDate: '2026-08-22', referencePage: 5 })
    expect(found).toMatchObject({ kind: 'found', page: 7, offset: 0 })
  })

  it('returns unusable when the scan exhausts the page limit without finding the anchor', async () => {
    // All pages are newer than the anchor; stepping forward never reaches it.
    const pages: Record<number, CollectedMemberPage> = {}
    for (let p = 1; p <= MEMBER_RESUME_SCAN_PAGE_LIMIT + 2; p++) {
      pages[p] = page([member(`n-${p}`, '2026-08-30')])
    }
    const result = await locateMemberResumePosition(reader(pages), { anchorMemberKey: 'x', anchorJoinDate: '2026-08-23', referencePage: 1 })
    expect(result.kind).toBe('unusable')
  })

  it('returns unusable before crossing below page 1', async () => {
    // Anchor is newer than the reference page, so the walk tries to go backward.
    // Reference page is 1, so the next step (page 0) is rejected immediately.
    const pages = { 1: page([member('o', '2026-08-20')]) }
    const result = await locateMemberResumePosition(reader(pages), { anchorMemberKey: 'x', anchorJoinDate: '2026-08-25', referencePage: 1 })
    expect(result.kind).toBe('unusable')
  })
})
