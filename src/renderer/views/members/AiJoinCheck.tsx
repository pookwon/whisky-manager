import { TEXT } from '../../../shared/text.js'
import { JoinPatternCard } from './JoinPatternCard.js'

/** The screen for telling AI sign-ups from members; it reads and lists, nothing more. */
export function AiJoinCheck(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-lg font-bold tracking-tight">{TEXT.joinPattern.pageHeading}</h1>
      </header>
      <JoinPatternCard />
    </div>
  )
}
