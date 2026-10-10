import { describe, expect, it } from 'vitest'
import { normalizeProblem, solveSync } from '../../engine/index.ts'
import type { EnchantLevels } from '../../engine/index.ts'
import { buildProblem, ownedBooksCoveredBySupplements, type BuiltProblem } from './buildProblem.ts'
import { EXAMPLE_INPUT } from './convert.ts'
import { DEFAULT_INPUT, DEFAULT_SESSION, type InputState, type OwnedBook } from './types.ts'

const book = (uid: string, enchantments: EnchantLevels, count = 1): OwnedBook => ({ uid, enchantments, count, anvilUsesOverride: null })

function solve(input: InputState, session = DEFAULT_SESSION) {
  const built = buildProblem(input, session)
  if (built === null) throw new Error('built is null')
  const result = solveSync(built.problem, built.settings)
  if (result.status !== 'ok') throw new Error(`not ok: ${result.status}`)
  return { built, result }
}

function expectSourcesAligned(built: BuiltProblem) {
  expect(built.inputSources).toHaveLength(normalizeProblem(built.problem, built.settings).inputs.length)
}

describe('buildProblem: books to get and excluded owned items', () => {
  it('gets all seven books for new boots with every compatible enchantment at max (66 levels, max 16, 7 steps)', () => {
    const { built, result } = solve(EXAMPLE_INPUT)
    expect(built.problem.mode).toBe('simple')
    expect(built.supplements).toHaveLength(7)
    expect(built.excluded).toEqual([])
    expect(result.summary.totalLevels).toBe(66)
    expect(result.summary.maxStepLevels).toBe(16)
    expect(result.summary.anvilOperations).toBe(7)
    expectSourcesAligned(built)
  })

  it('gets only Mending for a pickaxe with Efficiency IV and Unbreaking III at 2 automatic anvil uses (26 levels, max 12, 3 steps)', () => {
    const input: InputState = {
      ...DEFAULT_INPUT,
      item: 'pickaxe',
      existing: { efficiency: 4, unbreaking: 3 },
      wanted: { efficiency: 5, mending: 1, fortune: 3 },
      ownedBooks: [book('a', { efficiency: 4 }), book('b', { fortune: 3 }), book('c', { silk_touch: 1 }), book('d', { unbreaking: 2 })],
    }
    const { built, result } = solve(input)
    expect(built.effectiveUses.item).toBe(2)
    expect(built.supplements).toEqual([{ id: 'mending', level: 1 }])
    expect(built.coverage.efficiency).toEqual({ kind: 'owned', reachable: 5 })
    expect(built.coverage.unbreaking).toEqual({ kind: 'existing', level: 3 })
    expect(result.summary.totalLevels).toBe(26)
    expect(result.summary.maxStepLevels).toBe(12)
    expect(result.summary.anvilOperations).toBe(3)
    expectSourcesAligned(built)
    // Silk Touch and Unbreaking II stay unused
    const unused = new Set(result.plan.unusedInputs.map((i) => built.inputSources[i]))
    const unusedOwned = [...unused].filter((s) => s.kind === 'owned').map((s) => (s.kind === 'owned' ? s.index : -1))
    expect(unusedOwned.sort()).toEqual([2, 3])
  })

  it('uses four Wind Burst I books on a new mace (42 levels, max 12, 7 steps, 570 XP points)', () => {
    const input: InputState = {
      ...DEFAULT_INPUT,
      item: 'mace',
      wanted: { density: 5, unbreaking: 3, mending: 1, wind_burst: 3 },
      ownedBooks: [book('w', { wind_burst: 1 }, 4)],
    }
    const { built, result } = solve(input)
    expect(built.supplements.map((s) => s.id).sort()).toEqual(['density', 'mending', 'unbreaking'])
    expect(result.summary.totalLevels).toBe(42)
    expect(result.summary.maxStepLevels).toBe(12)
    expect(result.summary.anvilOperations).toBe(7)
    expect(result.summary.xpPoints).toBe(570)
    expectSourcesAligned(built)
  })

  it('gets Wind Burst III and excludes three Wind Burst I books that cannot reach it (23 levels, max 8, 4 steps)', () => {
    const input: InputState = {
      ...DEFAULT_INPUT,
      item: 'mace',
      wanted: { density: 5, unbreaking: 3, mending: 1, wind_burst: 3 },
      ownedBooks: [book('w', { wind_burst: 1 }, 3)],
    }
    const { built, result } = solve(input)
    expect(built.supplements).toHaveLength(4)
    expect(built.coverage.wind_burst).toEqual({ kind: 'supplement', reachable: 2, cursedOnly: false })
    expect(built.excluded).toEqual([0, 1, 2].map((copy) => ({ source: { kind: 'owned', index: 0, copy }, reason: 'below-wanted' })))
    expect(result.summary.totalLevels).toBe(23)
    expect(result.summary.maxStepLevels).toBe(8)
    expect(result.summary.anvilOperations).toBe(4)
    expectSourcesAligned(built)
  })

  it('keeps owned books covered by books to get in Bedrock Edition', () => {
    const input: InputState = {
      ...DEFAULT_INPUT,
      item: 'mace',
      wanted: { density: 5, unbreaking: 3, mending: 1, wind_burst: 3 },
      ownedBooks: [book('w', { wind_burst: 1 }, 3)],
    }
    const built = buildProblem(input, { ...DEFAULT_SESSION, edition: 'bedrock' })
    expect(built?.excluded).toEqual([])
    expect(built?.inputSources.filter((s) => s.kind === 'owned')).toHaveLength(3)
  })

  it('finds the same covered owned books that Java Edition excludes, skipping cursed books and books with anything not being bought', () => {
    const input: InputState = {
      ...DEFAULT_INPUT,
      item: 'mace',
      wanted: { density: 5, unbreaking: 3, mending: 1, wind_burst: 3 },
      ownedBooks: [
        book('w', { wind_burst: 1 }, 3),
        book('m', { mending: 1, vanishing_curse: 1 }),
        book('u', { unbreaking: 3 }),
        book('d', { density: 4, breach: 1 }),
        book('x', { unbreaking: 1, mending: 1 }),
      ],
    }
    const java = buildProblem(input, DEFAULT_SESSION)!
    const bedrock = buildProblem(input, { ...DEFAULT_SESSION, edition: 'bedrock' })!
    const javaRows = [...new Set(java.excluded.flatMap((e) => (e.reason === 'below-wanted' && e.source.kind === 'owned' ? [e.source.index] : [])))]
    // Three Wind Burst I books cannot reach III, so they are covered. The Mending book is cursed, and the books with Breach
    // or with Unbreaking (reachable from owned books) are not covered.
    expect(ownedBooksCoveredBySupplements(input, bedrock)).toEqual([0])
    expect(ownedBooksCoveredBySupplements(input, java)).toEqual(javaRows)
  })

  it('excludes a book with an unwanted curse and gets Mending instead (8 levels, max 5, 2 steps)', () => {
    const input: InputState = {
      ...DEFAULT_INPUT,
      item: 'pickaxe',
      wanted: { efficiency: 5, mending: 1 },
      ownedBooks: [book('e', { efficiency: 5 }), book('m', { mending: 1, vanishing_curse: 1 })],
    }
    const { built, result } = solve(input)
    expect(built.supplements).toEqual([{ id: 'mending', level: 1 }])
    expect(built.coverage.mending).toEqual({ kind: 'supplement', reachable: 0, cursedOnly: true })
    expect(built.excluded).toEqual([{ source: { kind: 'owned', index: 1, copy: 0 }, reason: 'curse' }])
    expect(result.summary.totalLevels).toBe(8)
    expect(result.summary.maxStepLevels).toBe(5)
    expect(result.summary.anvilOperations).toBe(2)
    expectSourcesAligned(built)
  })

  it('keeps a cursed book when the curse is wanted', () => {
    const input: InputState = {
      ...DEFAULT_INPUT,
      item: 'pickaxe',
      wanted: { efficiency: 5, mending: 1, vanishing_curse: 1 },
      ownedBooks: [book('e', { efficiency: 5 }), book('m', { mending: 1, vanishing_curse: 1 })],
    }
    const built = buildProblem(input, DEFAULT_SESSION)
    expect(built?.excluded).toEqual([])
    expect(built?.supplements).toEqual([])
  })
})

describe('buildProblem: problem shape, order and plan ID', () => {
  it('returns null without an item or wanted enchantments', () => {
    expect(buildProblem(DEFAULT_INPUT, DEFAULT_SESSION)).toBeNull()
    expect(buildProblem({ ...DEFAULT_INPUT, item: 'boots' }, DEFAULT_SESSION)).toBeNull()
    expect(buildProblem({ ...DEFAULT_INPUT, item: 'boots', rename: true }, DEFAULT_SESSION)).toBeNull()
  })

  it('keeps the plan ID and steps when books to get move to owned books (SimpleProblem to AdvancedProblem)', () => {
    const simple = buildProblem(EXAMPLE_INPUT, DEFAULT_SESSION)
    const owned: InputState = {
      ...EXAMPLE_INPUT,
      ownedBooks: [book('x', { mending: 1 }), book('y', { thorns: 3 })],
    }
    const advanced = buildProblem(owned, DEFAULT_SESSION)
    expect(simple?.problem.mode).toBe('simple')
    expect(advanced?.problem.mode).toBe('advanced')
    expect(advanced?.planId).toBe(simple?.planId)
    const a = solveSync(simple!.problem, simple!.settings)
    const b = solveSync(advanced!.problem, advanced!.settings)
    if (a.status !== 'ok' || b.status !== 'ok') throw new Error('not ok')
    expect(b.plan.steps.map((s) => [s.left, s.right, s.cost.total])).toEqual(a.plan.steps.map((s) => [s.left, s.right, s.cost.total]))
  })

  it('keeps the plan ID independent of entry order', () => {
    const base: InputState = { ...DEFAULT_INPUT, item: 'boots', wanted: { protection: 4, mending: 1 } }
    const x = buildProblem({ ...base, ownedBooks: [book('1', { protection: 3 }), book('2', { unbreaking: 1 })] }, DEFAULT_SESSION)
    const y = buildProblem({ ...base, ownedBooks: [book('2', { unbreaking: 1 }), book('1', { protection: 3 })] }, DEFAULT_SESSION)
    expect(x?.planId).toBe(y?.planId)
  })

  it('adds books to get for reachable enchantments in the fallback retry', () => {
    const input: InputState = {
      ...DEFAULT_INPUT,
      item: 'pickaxe',
      existing: { unbreaking: 3 },
      wanted: { efficiency: 5, fortune: 3, mending: 1 },
      ownedBooks: [
        { uid: 'e', enchantments: { efficiency: 5 }, count: 1, anvilUsesOverride: 5 },
        { uid: 'f', enchantments: { fortune: 3 }, count: 1, anvilUsesOverride: 5 },
        { uid: 'm', enchantments: { mending: 1 }, count: 1, anvilUsesOverride: 5 },
      ],
    }
    const first = buildProblem(input, DEFAULT_SESSION)!
    expect(first.supplements).toEqual([])
    expect(solveSync(first.problem, first.settings).status).toBe('infeasible')
    const retry = buildProblem(input, DEFAULT_SESSION, { fallback: true })!
    expect([...retry.fallback].sort()).toEqual(['efficiency', 'fortune', 'mending'])
    const result = solveSync(retry.problem, retry.settings)
    if (result.status !== 'ok') throw new Error(result.status)
    expect(result.summary.totalLevels).toBe(20)
    expect(result.summary.maxStepLevels).toBe(9)
    expect(result.summary.anvilOperations).toBe(3)
  })

  it('uses a null target and no existing enchantments or spares when merging books', () => {
    const built = buildProblem(
      { ...DEFAULT_INPUT, item: 'enchanted_book', wanted: { protection: 4, mending: 1 }, ownedBooks: [book('p', { protection: 4 })] },
      DEFAULT_SESSION,
    )!
    expect(built.problem.mode).toBe('advanced')
    if (built.problem.mode === 'advanced') expect(built.problem.target).toBeNull()
    expect(built.inputSources[0]).toEqual({ kind: 'owned', index: 0, copy: 0 })
    expectSourcesAligned(built)
  })
})
