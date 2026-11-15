import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseAttendanceWinners } from '../../src/shared/attendanceWinners.js'
import { parseCafeArticleBody, parseCafeArticleBodyText } from '../../src/shared/cafeArticleBody.js'

const fixture = (name: string) => readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), 'utf8')

describe('parseCafeArticleBody', () => {
  it('reads the id, subject, time and body of the article asked for', () => {
    const body = parseCafeArticleBodyText('963460', fixture('cafe-article-body-attendance.json'))
    expect(body).toMatchObject({ postId: '963460', title: '[게시글 개근] 11월 1일~11월 10일 카페 게시글 개근상을 잡아라!', postedAt: 1794348202440 })
    expect(parseAttendanceWinners(body.contentHtml)).toMatchObject({ ok: true })
  })

  it('refuses an answer that is not the article asked for, or has no body', () => {
    expect(() => parseCafeArticleBodyText('963461', fixture('cafe-article-body-attendance.json'))).toThrowError(/is not the article asked for/)
    const noBody = JSON.parse(fixture('cafe-article-body-attendance.json')); delete noBody.result.article.contentHtml
    expect(() => parseCafeArticleBody('963460', noBody)).toThrowError(expect.objectContaining({ code: 'INVALID_ARTICLE' }))
    expect(() => parseCafeArticleBodyText('963460', '<html>')).toThrowError(expect.objectContaining({ code: 'INVALID_JSON' }))
  })
})
