import { parse, type HTMLElement } from 'node-html-parser'
import { KST_OFFSET_MS } from '../../kst.js'
import type { RawCandidate } from '../../protocol.js'

/**
 * The 가입인사 board is a memo board: a legacy server-rendered page, not a JSON
 * API. Items are flat siblings rather than nested in a per-item wrapper, so the
 * parser walks the section in document order and closes an item when its reply
 * box appears.
 *
 * Nothing keys off the auto-generated wording ("...님이 우리 카페에
 * 가입하였습니다"). The board is dedicated, and members who write their own
 * greeting are just as much a target.
 */
const SECTION = '.memo_lst_section'
const POST_ID = /^post_(\d+)$/
const TIMESTAMP = /(\d{4})\.(\d{2})\.(\d{2})\.\s*(\d{2}):(\d{2})/
const COMMENT_COUNT = /(\d+)/

/**
 * The memo editor stores spaces as `&nbsp;`, which decodes to U+00A0. That is a
 * markup artefact, not content: left alone it would travel into the database and
 * into any comment built from this text.
 */
function textOf(element: HTMLElement | null): string | null {
  const text = element?.text.replace(/\u00a0/g, ' ').trim()
  return text === undefined || text === '' ? null : text
}

/** `<br>` is the only line break the memo editor produces. */
function bodyText(memo: HTMLElement): string | null {
  return textOf(parse(memo.innerHTML.replace(/<br\s*\/?>/gi, '\n')))
}

function memberId(titBox: HTMLElement): string | null {
  const href = titBox.querySelector('a[href*="/members/"]')?.getAttribute('href')
  return href?.split('/members/')[1]?.split(/[?#]/)[0] ?? null
}

function postedAt(titBox: HTMLElement): number | null {
  const match = TIMESTAMP.exec(titBox.querySelector('.user_time')?.text ?? '')
  if (match === null) return null
  const [, year, month, day, hour, minute] = match
  return Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute)) - KST_OFFSET_MS
}

/**
 * How many comments the list says a post has. The list never names who wrote
 * them — the comment block it renders is empty until the page asks for it — so
 * a count above zero means "somebody, unknown" and has to be resolved against
 * the post itself. `null` is the count being unreadable, which is the list
 * changing shape under us rather than anything about the post.
 */
function commentCount(replyBox: HTMLElement): number | null {
  const label = replyBox.querySelector('._totalCnt')?.text ?? ''
  const match = COMMENT_COUNT.exec(label)
  return match === null ? null : Number(match[1])
}

export function parseMemoList(html: string): RawCandidate[] {
  const section = parse(html).querySelector(SECTION)
  if (section === null) return []

  const candidates: RawCandidate[] = []
  let titBox: HTMLElement | null = null
  let memo: HTMLElement | null = null

  for (const node of section.querySelectorAll('.tit-box, .memo-box, .reply-box')) {
    if (node.classList.contains('tit-box')) {
      titBox = node
      memo = null
      continue
    }
    if (node.classList.contains('memo-box')) {
      memo = node
      continue
    }
    if (titBox === null || memo === null) continue

    const id = POST_ID.exec(memo.getAttribute('id') ?? '')
    const when = postedAt(titBox)
    if (id !== null && when !== null) {
      candidates.push({
        postId: id[1] as string,
        title: null,
        bodyText: bodyText(memo),
        authorNickname: textOf(titBox.querySelector('.p-nick a')),
        authorId: memberId(titBox),
        postedAt: when,
        commentCount: commentCount(node),
      })
    }
    titBox = null
    memo = null
  }

  return candidates
}
