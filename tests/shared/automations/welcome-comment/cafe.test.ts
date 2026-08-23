import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  commentPostBody,
  commentViewUrl,
  memoListUrl,
  parseCommentAuthors,
  parseLoginState,
} from '../../../../src/shared/automations/welcome-comment/cafe.js'

const fixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../../../fixtures/${name}`, import.meta.url)), 'utf8')

const source = { cafeId: '10000000', boardId: '5' }

describe('memoListUrl', () => {
  it('asks for the pc view, which is the server-rendered list', () => {
    expect(memoListUrl(source, 1)).toBe(
      'https://cafe.naver.com/MemoList.nhn?search.clubid=10000000&search.menuid=5&search.page=1&search.perPage=50&viewType=pc',
    )
  })

  it('walks pages, because the board shows only a handful at a time', () => {
    expect(memoListUrl(source, 3)).toContain('search.page=3')
  })

  it('requests 50 posts per page to reduce the number of requests', () => {
    expect(memoListUrl(source, 1)).toContain('search.perPage=50')
  })
})

describe('commentViewUrl', () => {
  it('targets one memo', () => {
    expect(commentViewUrl(source, '334381')).toBe(
      'https://cafe.naver.com/MemoCommentView.nhn?search.clubid=10000000&search.menuid=5' +
        '&search.articleid=334381&search.lastpageview=true&lcs=Y',
    )
  })
})

describe('parseCommentAuthors', () => {
  it('reads both identities of everyone who commented', () => {
    expect(parseCommentAuthors(fixture('memo-comments.json'))).toEqual([
      { nickname: '일반회원하나', memberKey: 'FIXTUREMEMBER06xxxxxxxxxxxxxxxxxxxxxxxxxxxx' },
      { nickname: '카페 운영', memberKey: 'FIXTUREOPERATORxxxxxxxxxxxxxxxxxxxxxxxxxxxx' },
    ])
  })

  it('reports an empty thread as empty, which is proof nobody replied', () => {
    const empty = JSON.stringify({ result: { list: [], commentCount: 0 }, isSuccess: 'true' })
    expect(parseCommentAuthors(empty)).toEqual([])
  })

  it('leaves out deleted comments, which no longer greet anyone', () => {
    const withDeleted = JSON.stringify({
      result: {
        list: [{ writernick: 'gone', writerMemberKey: 'k1', deleted: true }],
      },
      isSuccess: 'true',
    })
    expect(parseCommentAuthors(withDeleted)).toEqual([])
  })

  it('returns null rather than a false empty when the call did not succeed', () => {
    // An empty list and a failed call look alike but mean opposite things: one
    // clears the post for a comment, the other must not.
    expect(parseCommentAuthors(JSON.stringify({ isSuccess: 'false', errorMsg: 'nope' }))).toBeNull()
    expect(parseCommentAuthors('<html>login</html>')).toBeNull()
    expect(parseCommentAuthors('')).toBeNull()
  })
})

describe('parseLoginState', () => {
  it('reads the account out of a page served to a logged-in member', () => {
    const page = 'var g_sUserId = "cafe-operator";\nvar g_sUserMemberKey = "KEY123"'
    expect(parseLoginState(page)).toEqual({ loggedIn: true, account: 'cafe-operator', memberKey: 'KEY123' })
  })

  it('treats a page with an empty account as logged out', () => {
    // Naver serves the cafe shell to anonymous visitors too; the marker is the
    // account being blank, not the page being missing.
    expect(parseLoginState('var g_sUserId = "";')).toEqual({ loggedIn: false, account: null, memberKey: null })
  })

  it('treats a page without the marker as logged out rather than guessing', () => {
    expect(parseLoginState('<html>로그인이 필요합니다</html>')).toEqual({
      loggedIn: false,
      account: null,
      memberKey: null,
    })
  })
})

describe('commentPostBody', () => {
  it('posts every field the cafe form carries, with the text in cp949', () => {
    const body = commentPostBody(source, '334381', '환영합니다')

    expect(body).toContain('content=%C8%AF%BF%B5%C7%D5%B4%CF%B4%D9')
    expect(body).toContain('clubid=10000000')
    expect(body).toContain('menuid=5')
    expect(body).toContain('articleid=334381')
    // `m=write` is what separates a new comment from an edit.
    expect(body).toContain('m=write')
  })

  it('keeps the empty fields, since the cafe page submits every one of them', () => {
    const body = commentPostBody(source, '1', 'hi')
    for (const field of ['commentid', 'refcommentid', 'replyToMemberKey', 'stickerId']) {
      expect(body).toContain(`${field}=`)
    }
  })
})
