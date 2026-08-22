import { describe, expect, it } from 'vitest'
import { pickTemplate, renderTemplate } from '../../src/shared/templates.js'
import type { Template } from '../../src/shared/types.js'
import { SequenceRandom } from '../fakes.js'

const one: Template = { id: 't1', body: '{닉네임}님 환영합니다' }
const two: Template = { id: 't2', body: '{닉네임}님 반갑습니다' }
const three: Template = { id: 't3', body: '{닉네임}님 어서오세요' }

describe('pickTemplate', () => {
  it('returns null when nothing is registered', () => {
    expect(pickTemplate([], new SequenceRandom([0]))).toBeNull()
  })

  it('returns the single template without consulting randomness', () => {
    expect(pickTemplate([one], new SequenceRandom([99]))).toEqual(one)
  })

  it('draws uniformly across the index range when several are registered', () => {
    expect(pickTemplate([one, two, three], new SequenceRandom([0]))).toEqual(one)
    expect(pickTemplate([one, two, three], new SequenceRandom([2]))).toEqual(three)
  })
})

describe('renderTemplate', () => {
  it('substitutes a known variable', () => {
    expect(renderTemplate('{닉네임}님 환영합니다', { 닉네임: '신입회원' })).toEqual({
      ok: true,
      text: '신입회원님 환영합니다',
    })
  })

  it('substitutes every occurrence', () => {
    expect(renderTemplate('{닉네임}님, {닉네임}님', { 닉네임: 'A' })).toEqual({ ok: true, text: 'A님, A님' })
  })

  it('reports missing variables instead of leaving the placeholder in the text', () => {
    expect(renderTemplate('{닉네임}님 {등급} 환영', { 닉네임: 'A' })).toEqual({ ok: false, missing: ['등급'] })
  })

  it('reports an empty value as missing', () => {
    // A blank nickname would post "님 환영합니다", which reads as broken.
    expect(renderTemplate('{닉네임}님 환영', { 닉네임: '' })).toEqual({ ok: false, missing: ['닉네임'] })
  })

  it('passes through a body with no placeholders', () => {
    expect(renderTemplate('환영합니다', {})).toEqual({ ok: true, text: '환영합니다' })
  })
})
