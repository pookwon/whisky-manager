/**
 * The join answers of the AI sign-ups, as the operators found them.
 *
 * Both conditions must hold. The second alone also catches people who politely
 * answer `네 알겠습니다`, and the first alone catches people who simply type
 * neatly, so either one by itself names real members.
 */
const AGE_ANSWER = /^[남여] \/ \d{2}세$/

const TEMPLATE_CONSENTS: ReadonlySet<string> = new Set([
  '네, 확인했습니다',
  '네 확인했습니다',
  '네, 알겠습니다',
  '네 알겠습니다',
  '네, 잘 알겠습니다',
  '예, 알겠습니다',
  '네, 숙지했습니다',
  '네, 확인했어요',
])

/** Answers in question order: age and sex, rules, then mail consent. */
export function matchesJoinPattern(answers: readonly string[]): boolean {
  if (answers.length !== 3) return false
  const [age, rules, mail] = answers.map((answer) => answer.trim())
  return age !== undefined && rules !== undefined && AGE_ANSWER.test(age) && rules === mail && TEMPLATE_CONSENTS.has(rules)
}
