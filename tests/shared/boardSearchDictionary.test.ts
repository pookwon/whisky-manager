import { describe, expect, it } from 'vitest'
import { buildBoardSearchDictionary, titleWords } from '../../src/shared/boardSearchDictionary.js'

describe('titleWords', () => {
  it('splits on anything that is not a Hangul syllable, Latin letter or digit, lower-cased', () => {
    expect(titleWords('GS25 발베니12년 [득템]!! ㅎㅎ 🥃')).toEqual(['gs25', '발베니12년', '득템'])
  })

  it('keeps nothing from a title with no words', () => {
    expect(titleWords('!!! ㅋㅋ')).toEqual([])
  })
})

describe('buildBoardSearchDictionary', () => {
  it('picks the word that covers the most uncovered titles first, counting a title once', () => {
    const titles = ['이마트 구매', '이마트 구매했습니다', '이마트 글렌', '글렌알라키 구입', '구입 완료']
    expect(buildBoardSearchDictionary(titles, { minGain: 1 })).toEqual([
      { query: '이마트', expectedGain: 3 },
      { query: '구입', expectedGain: 2 },
    ])
  })

  it('counts a title as caught when one of its words starts with the query', () => {
    // '글렌' catches '글렌알라키' (measured against the cafe on 2026-09-25).
    const titles = ['글렌 12년', '글렌알라키 15', '글렌드로낙']
    expect(buildBoardSearchDictionary(titles, { minGain: 1 })).toEqual([{ query: '글렌', expectedGain: 3 }])
  })

  it('never offers a fragment that was not a whole word somewhere', () => {
    // '이마' is a prefix of every title but was never written on its own.
    const titles = ['이마트', '이마트24', '이마트몰']
    const picked = buildBoardSearchDictionary(titles, { minGain: 1 }).map((entry) => entry.query)
    expect(picked).not.toContain('이마')
    expect(picked[0]).toBe('이마트')
  })

  it('drops one-letter words, which the search does not match', () => {
    expect(buildBoardSearchDictionary(['a b c', 'a d'], { minGain: 1 })).toEqual([])
  })

  it('stops at the limit and below the minimum gain', () => {
    const titles = ['가가 나나', '가가 다다', '라라', '라라', '마마']
    expect(buildBoardSearchDictionary(titles, { limit: 1, minGain: 1 })).toEqual([{ query: '가가', expectedGain: 2 }])
    expect(buildBoardSearchDictionary(titles, { minGain: 2 })).toEqual([
      { query: '가가', expectedGain: 2 },
      { query: '라라', expectedGain: 2 },
    ])
  })

  it('counts only titles no earlier pick caught', () => {
    // '나나' was used only by a title '가가' already caught, so it adds 0.
    const titles = ['가가 나나', '가가', '다다']
    expect(buildBoardSearchDictionary(titles, { minGain: 1 })).toEqual([
      { query: '가가', expectedGain: 2 },
      { query: '다다', expectedGain: 1 },
    ])
  })

  it('breaks an equal gain by how many titles use the word, then by code-unit order', () => {
    // Both add 2: '가가' by catching '가가나' too (used once itself), '라라' by
    // being written twice. The word more titles use goes first.
    expect(buildBoardSearchDictionary(['가가', '가가나', '라라', '라라'], { minGain: 1 })).toEqual([
      { query: '라라', expectedGain: 2 },
      { query: '가가', expectedGain: 2 },
    ])
    // Equal gain, equal use: code-unit order decides.
    expect(buildBoardSearchDictionary(['다다', '나나'], { minGain: 1 })).toEqual([
      { query: '나나', expectedGain: 1 },
      { query: '다다', expectedGain: 1 },
    ])
  })

  it('gives the same answer for the same titles in any order', () => {
    const titles = ['이마트 구매', '트레이더스 구매', '코스트코', '이마트 조니', '조니워커']
    const once = buildBoardSearchDictionary(titles, { minGain: 1 })
    expect(buildBoardSearchDictionary([...titles].reverse(), { minGain: 1 })).toEqual(once)
  })
})
