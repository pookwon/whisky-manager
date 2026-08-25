import { describe, expect, it } from 'vitest'
import { collectDay } from '../../src/desktop/collection.js'
import { kstDayStartMs } from '../../src/shared/kst.js'
import type { AppMessage, ExtensionMessage, RawCandidate } from '../../src/shared/protocol.js'

const AUTOMATION = 'welcome-comment'
const SOURCE = { cafeId: '10000000', boardId: '5' }

/** 2026-08-23 12:00 KST, comfortably inside its day on either side. */
const NOON = Date.UTC(2026, 7, 23, 3, 0)
/** 2026-08-24 09:00 KST — the next day, which a floor-only read also returns. */
const NEXT_DAY = Date.UTC(2026, 7, 24, 0, 0)

function raw(postId: string, postedAt: number): RawCandidate {
  return {
    postId,
    title: null,
    bodyText: '안녕하세요',
    authorNickname: `가입자${postId}`,
    authorId: `member-${postId}`,
    postedAt,
    commentCount: 0,
  }
}

interface ReplyOptions {
  readonly interim?: readonly ExtensionMessage[]
}

function transportReplying(
  reply: ExtensionMessage | 'throw',
  options: ReplyOptions = {},
): { readonly asked: AppMessage[]; readonly transport: Parameters<typeof collectDay>[0]['transport'] } {
  const asked: AppMessage[] = []
  return {
    asked,
    transport: {
      isConnected: () => true,
      request: (message, _timeoutMs, onInterim) => {
        asked.push(message)
        for (const message of options.interim ?? []) onInterim?.(message)
        return reply === 'throw'
          ? Promise.reject(new Error('collect failed'))
          : Promise.resolve(reply)
      },
    },
  }
}

function collected(candidates: RawCandidate[]): ExtensionMessage {
  return { type: 'COLLECTED', requestId: 'r', candidates } as ExtensionMessage
}

function run(
  transport: Parameters<typeof collectDay>[0]['transport'],
  extra: Partial<Parameters<typeof collectDay>[0]> = {},
) {
  return collectDay({
    transport,
    automationId: AUTOMATION,
    source: SOURCE,
    newRequestId: () => 'req-1',
    dayStartMs: NOON,
    ...extra,
  })
}

describe('collecting a day', () => {
  it('asks from the day boundary, not from the moment it was handed', async () => {
    const { asked, transport } = transportReplying(collected([]))

    await run(transport)

    expect(asked).toHaveLength(1)
    expect(asked[0]).toMatchObject({
      type: 'COLLECT',
      automationId: AUTOMATION,
      source: SOURCE,
      sincePostedAt: kstDayStartMs(NOON),
    })
  })

  /**
   * The reason this function exists. Collection takes a floor and no ceiling,
   * so an earlier day arrives with everything since attached — and whoever is
   * left in the set decides who counts as an author's first post. A caller that
   * forgot the trim would answer a different person than the run that follows.
   */
  it('drops posts that belong to a later day', async () => {
    const { transport } = transportReplying(
      collected([raw('1001', NOON), raw('2001', NEXT_DAY)]),
    )

    const raws = await run(transport)

    expect(raws?.map((candidate) => candidate.postId)).toEqual(['1001'])
  })

  /**
   * An empty day is a session with nothing to do; a failed read is a session
   * that must not start. Collapsing the two would have a broken bridge look
   * like a quiet morning.
   */
  it('tells an empty day apart from a failed read', async () => {
    const empty = await run(transportReplying(collected([])).transport)
    expect(empty).toEqual([])

    const threw = await run(transportReplying('throw').transport)
    expect(threw).toBeNull()
  })

  it('treats an answer that is not a collection as a failed read', async () => {
    const { transport } = transportReplying({
      type: 'ERROR',
      requestId: 'r',
      code: 'READ_FAILED',
      message: 'nope',
    } as ExtensionMessage)

    expect(await run(transport)).toBeNull()
  })

  it('reports paging as it arrives', async () => {
    const seen: Array<[number, number]> = []
    const { transport } = transportReplying(collected([]), {
      interim: [
        { type: 'COLLECT_PROGRESS', requestId: 'r', pagesRead: 1, collected: 20 } as ExtensionMessage,
        { type: 'COLLECT_PROGRESS', requestId: 'r', pagesRead: 2, collected: 45 } as ExtensionMessage,
      ],
    })

    await run(transport, { onProgress: (pagesRead, count) => seen.push([pagesRead, count]) })

    expect(seen).toEqual([
      [1, 20],
      [2, 45],
    ])
  })

  it('reads the day a mid-day instant falls in', async () => {
    const { asked, transport } = transportReplying(collected([]))

    await run(transport, { dayStartMs: NOON + 5 * 60 * 60 * 1000 })

    expect(asked[0]).toMatchObject({ sincePostedAt: kstDayStartMs(NOON) })
  })
})
