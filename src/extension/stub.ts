import type { RawCandidate } from '../shared/protocol.js'

/**
 * Phase 2 placeholder. Phase 3 replaces this with real collection once the cafe
 * response schema has been observed with a logged-in session. Nothing here
 * talks to naver.
 */
export function stubCandidates(sincePostId: string | null): RawCandidate[] {
  const base = sincePostId === null ? 1000 : Number(sincePostId)
  return [
    {
      postId: String(base + 1),
      title: 'stub greeting',
      bodyText: 'stub body',
      authorNickname: 'stub-member',
      authorId: 'stub-1',
      postedAt: 1_700_000_000_000,
      existingCommentAuthors: [],
    },
  ]
}
