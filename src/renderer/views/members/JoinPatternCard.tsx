import { useState } from 'react'
import type { JoinPatternSearchResult } from '../../../desktop/ipc.js'
import { TEXT } from '../../../shared/text.js'
import { api } from '../../api.js'

const COPY = TEXT.joinPattern

/** What a finished search says, or null for the one result that needs a table. */
function resultLine(result: JoinPatternSearchResult): string | null {
  if (result.kind === 'EXTENSION_OFFLINE') return COPY.extensionOffline
  if (result.kind === 'IDENTITY_REQUIRED') return COPY.identityRequired
  if (result.kind === 'FAILED') return COPY.failed(result.code)
  return null
}

type Done = Extract<JoinPatternSearchResult, { readonly kind: 'DONE' }>

function CandidateTable({ result }: { readonly result: Done }): React.JSX.Element {
  return (
    <div className="max-h-96 overflow-auto">
      <table className="w-full text-left text-sm tabular-nums">
        <thead>
          <tr style={{ color: 'var(--ink-muted)' }}>
            {COPY.columns.map((column) => (
              <th key={column} className="pb-1 pr-4 font-medium whitespace-nowrap">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.candidates.map((member) => (
            <tr key={member.memberKey}>
              <td className="pr-4 whitespace-nowrap">{member.joinedAt.slice(0, 16).replace('T', ' ')}</td>
              <td className="pr-4">{member.nickname}</td>
              <td className="pr-4">{member.memberTag}</td>
              <td className="pr-4 whitespace-nowrap">{member.answers[0]}</td>
              <td className="pr-4 whitespace-nowrap">{member.answers[1]}</td>
              <td className="pr-4">{`${member.articleCount}/${member.commentCount}`}</td>
              <td className="pr-4">{member.activityStopped ? COPY.stopped : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * Finds the join-answer candidates and hands them over as a file. The identity
 * check comes first because the studio answers nothing about members without it.
 */
export function JoinPatternCard(): React.JSX.Element {
  const [searching, setSearching] = useState(false)
  const [result, setResult] = useState<JoinPatternSearchResult | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const search = async (): Promise<void> => {
    setSearching(true)
    setNotice(null)
    try {
      setResult(await api.searchJoinPattern())
    } finally {
      setSearching(false)
    }
  }

  const openIdentity = async (): Promise<void> => {
    setNotice((await api.openStudioIdentity()) ? COPY.identityOpened : COPY.extensionOffline)
  }

  const save = async (): Promise<void> => {
    const saved = await api.exportJoinPattern()
    if (saved.kind === 'SAVED') setNotice(COPY.saved(saved.path))
  }

  const line = result === null ? null : resultLine(result)
  const done = result?.kind === 'DONE' ? result : null

  return (
    <section className="panel overflow-hidden">
      <div className="flex flex-col gap-3 px-5 py-4">
        <div className="flex items-center justify-between gap-6">
          <div className="min-w-0 flex-1">
            <div className="text-[0.6875rem] font-medium uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>
              {COPY.heading}
            </div>
            <p className="mt-1 text-sm" style={{ color: 'var(--ink-muted)' }}>
              {COPY.why}
            </p>
          </div>
          <button type="button" className="btn shrink-0" disabled={searching} onClick={() => void search()}>
            {searching ? COPY.searching : COPY.search}
          </button>
        </div>
        {line !== null && <div className="tone-warn text-sm">{line}</div>}
        {result?.kind === 'IDENTITY_REQUIRED' && (
          <div>
            <button type="button" className="btn" onClick={() => void openIdentity()}>
              {COPY.openIdentity}
            </button>
          </div>
        )}
        {done !== null && (
          <>
            <div className="flex items-center justify-between gap-6 text-sm tabular-nums">
              <span>
                {done.candidates.length === 0
                  ? `${COPY.summary(done.from, done.to, done.scannedCount, 0)} ${COPY.empty}`
                  : COPY.summary(done.from, done.to, done.scannedCount, done.candidates.length)}
              </span>
              {done.candidates.length > 0 && (
                <button type="button" className="btn shrink-0" onClick={() => void save()}>
                  {COPY.export}
                </button>
              )}
            </div>
            {done.candidates.length > 0 && <CandidateTable result={done} />}
          </>
        )}
        {notice !== null && (
          <div className="text-sm" style={{ color: 'var(--ink-muted)' }}>
            {notice}
          </div>
        )}
      </div>
    </section>
  )
}
