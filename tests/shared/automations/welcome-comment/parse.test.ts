import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseMemoList } from '../../../../src/shared/automations/welcome-comment/parse.js'

/** A real capture with the members' identities replaced. */
const html = readFileSync(fileURLToPath(new URL('../../../fixtures/memo-list.html', import.meta.url)), 'utf8')

/** 2026-08-22 21:42 KST, the timestamp naver rendered for the newest memo. */
const NEWEST_POSTED_AT = Date.UTC(2026, 7, 22, 12, 42)

describe('parseMemoList', () => {
  it('reads every memo the page rendered, newest first', () => {
    expect(parseMemoList(html).map((c) => c.postId)).toEqual([
      '334381',
      '334380',
      '334379',
      '334378',
      '334377',
    ])
  })

  it('extracts the fields the automation needs from a memo', () => {
    const [newest] = parseMemoList(html)

    expect(newest).toEqual({
      postId: '334381',
      // Memos have no title; the field exists for other boards.
      title: null,
      bodyText: '가입자하나님이 우리 카페에 가입하였습니다.\n댓글로 가입자하나님을 환영해주세요.',
      authorNickname: '가입자하나',
      authorId: 'FIXTUREMEMBER01xxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      postedAt: NEWEST_POSTED_AT,
      commentCount: 0,
    })
  })

  it('reads a member-written greeting the same way as an auto-generated one', () => {
    // The board is dedicated, so nothing keys off the auto-generated wording.
    const manual = parseMemoList(html).find((c) => c.postId === '334378')

    expect(manual?.bodyText).toBe('안녕하세요 잘부탁드립니다')
    expect(manual?.authorNickname).toBe('가입자넷')
  })

  it('reads the comment count from the list', () => {
    const byId = new Map(parseMemoList(html).map((c) => [c.postId, c]))

    // "댓글 0" is proof no comments exist; "댓글 1" says there is one, but
    // the list never names the authors, so a count above zero has to be
    // re-checked against the post to know who wrote them.
    expect(byId.get('334381')?.commentCount).toBe(0)
    expect(byId.get('334377')?.commentCount).toBe(1)
  })

  it('reads a non-zero comment count from built markup', () => {
    // The fixture has only posts with zero comments; test higher counts via markup.
    const html = `
      <div class="memo_lst_section">
        <div class="tit-box">
          <table class="user_info"><tbody><tr>
            <td><table><tr><td class="p-nick"><a href="#">test</a></td></tr></table></td>
            <td><a href="javascript:deleteMemo(1)" class="link_del">삭제</a></td>
          </tr></tbody></table>
          <div class="user_time"><span class="blind">작성일시</span>2026.08.22. 12:00</div>
        </div>
        <p id="post_1" class="memo-box">Test post</p>
        <div class="reply-box">
          <div class="fl">
            <table><tbody><tr><td class="reply">
              <span class="reply b">
                <a href="#" class="m-tcol-p _totalCnt">댓글 3</a>
              </span>
            </td></tr></tbody></table>
          </div>
        </div>
      </div>
    `
    const [result] = parseMemoList(html)
    expect(result?.commentCount).toBe(3)
  })

  it('handles missing comment count as null', () => {
    // The list shape might change; ensure unreadable counts are marked null.
    const html = `
      <div class="memo_lst_section">
        <div class="tit-box">
          <table class="user_info"><tbody><tr>
            <td><table><tr><td class="p-nick"><a href="#">test</a></td></tr></table></td>
            <td><a href="javascript:deleteMemo(1)" class="link_del">삭제</a></td>
          </tr></tbody></table>
          <div class="user_time"><span class="blind">작성일시</span>2026.08.22. 12:00</div>
        </div>
        <p id="post_1" class="memo-box">Test post</p>
        <div class="reply-box">
          <div class="fl">
            <table><tbody><tr><td class="reply">
              <span class="reply b">
                <a href="#" class="m-tcol-p">No count here</a>
              </span>
            </td></tr></tbody></table>
          </div>
        </div>
      </div>
    `
    const [result] = parseMemoList(html)
    expect(result?.commentCount).toBeNull()
  })

  it('returns nothing when the memo section is missing', () => {
    // A login page or an error page must not be mistaken for an empty board;
    // the caller distinguishes them, but the parser must not invent rows.
    expect(parseMemoList('<html><body><h1>로그인</h1></body></html>')).toEqual([])
  })
})
