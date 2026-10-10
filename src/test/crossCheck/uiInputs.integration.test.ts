// The UI mirrors the engine's input order instead of importing normalize.ts. Plans refer to inputs by index, so any
// difference in order, contents or origin would make the UI point at the wrong input.

import type { Problem } from '../../engine/types.ts'
import { normalizeProblem } from '../../engine/normalize.ts'
import { levelEntries } from '../../engine/rules.ts'
import type { EngineInput } from '../../engine/types.ts'
import { listProblemInputs } from '../../ui/plan/inputs.ts'
import { sampleOracleCases } from '../oracle/generators.ts'
import { pipelineCaseArb, sample } from './generators.ts'

/** Only present enchantments, in data order, since the UI keeps each input's enchantments as given. */
function comparable(input: EngineInput): unknown {
  return { ...input, enchantments: levelEntries(input.enchantments) }
}

describe('UI input list vs engine normalization', () => {
  it('lists the inputs in the engine order with the same contents and origins', () => {
    const cases = [...sampleOracleCases(1_000, 0x5eed_0404), ...sample(pipelineCaseArb(), 200, 0x5eed_0405)]
    expect(cases.length).toBe(1_200)
    for (const { problem, settings } of cases) {
      expect(listProblemInputs(problem).map(comparable), JSON.stringify(problem)).toEqual(normalizeProblem(problem, settings).inputs.map(comparable))
    }
  })

  // The input form never builds this shape, but a shared link or saved data can. Random cases cover it too; this pins it down
  it('numbers simple-mode books whose sources repeat a level like the engine (copy per enchantment and level)', () => {
    const problem: Problem = {
      mode: 'simple',
      item: 'boots',
      enchantments: [
        { id: 'feather_falling', level: 4, sources: [{ level: 1, count: 2 }, { level: 2, count: 1 }, { level: 1, count: 1 }] },
        { id: 'unbreaking', level: 3, sources: [{ level: 1, count: 1 }, { level: 1, count: 3 }] },
      ],
    }
    const copies = listProblemInputs(problem).flatMap((input) =>
      input.origin.source === 'simple-book' ? [`${input.origin.enchantment}:${input.origin.level}:${input.origin.copy}`] : [],
    )
    expect(copies).toEqual([
      'feather_falling:1:0', 'feather_falling:1:1', 'feather_falling:2:0', 'feather_falling:1:2',
      'unbreaking:1:0', 'unbreaking:1:1', 'unbreaking:1:2', 'unbreaking:1:3',
    ])
    expect(listProblemInputs(problem).map(comparable)).toEqual(normalizeProblem(problem, { edition: 'java' }).inputs.map(comparable))
  })
})
