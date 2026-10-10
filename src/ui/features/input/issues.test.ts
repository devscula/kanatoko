import { describe, expect, it } from 'vitest'
import { validateProblem } from '../../../engine/index.ts'
import { buildProblem } from '../../state/buildProblem.ts'
import { DEFAULT_INPUT, DEFAULT_SESSION, type InputState } from '../../state/types.ts'
import { sortIssues } from './issues.ts'

describe('sortIssues', () => {
  it('routes issues on owned books and spares to the uid of their row', () => {
    const input: InputState = {
      ...DEFAULT_INPUT,
      item: 'boots',
      wanted: { protection: 4, blast_protection: 4 },
      ownedBooks: [
        { uid: 'ok', enchantments: { mending: 1 }, count: 2, anvilUsesOverride: null },
        { uid: 'bad', enchantments: { protection: 4, fire_protection: 4 }, count: 1, anvilUsesOverride: null },
      ],
      extraItems: [{ uid: 'x', enchantments: {}, anvilUsesOverride: 11 }],
    }
    const built = buildProblem(input, DEFAULT_SESSION)!
    const issues = validateProblem(built.problem, built.settings)
    const sorted = sortIssues(issues, built, input)
    expect(sorted.count).toBe(issues.length)
    expect(sorted.rows.get('bad')?.map((i) => i.code)).toContain('input-self-conflict')
    expect(sorted.rows.get('x')?.map((i) => i.code)).toContain('anvil-uses-out-of-range')
    expect(sorted.rows.has('ok')).toBe(false)
  })
})
