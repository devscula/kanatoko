import type { EngineInput, Problem } from '../../engine/index.ts'

/**
 * Lists the inputs in the order and with the origins the engine normalizes them to, so the input indices in engine
 * results can be mapped back. The UI may only import engine/index.ts and engine/client.ts, so this mirrors
 * normalize.ts instead of importing it.
 */
export function listProblemInputs(problem: Problem): EngineInput[] {
  const inputs: EngineInput[] = []
  if (problem.mode === 'simple') {
    if (problem.item !== 'enchanted_book') {
      inputs.push({
        kind: 'item',
        itemType: problem.item,
        enchantments: {},
        anvilUses: 0,
        origin: { source: 'simple-item', itemType: problem.item },
      })
    }
    // copy counts from 0 per enchantment and level and continues across stacks of the same level, as in the engine
    for (const request of problem.enchantments) {
      const stacks = request.sources ?? [{ level: request.level, count: 1 }]
      const copies = new Map<number, number>()
      for (const stack of stacks) {
        for (let i = 0; i < stack.count; i++) {
          const copy = copies.get(stack.level) ?? 0
          copies.set(stack.level, copy + 1)
          inputs.push({
            kind: 'book',
            itemType: null,
            enchantments: { [request.id]: stack.level },
            anvilUses: 0,
            origin: { source: 'simple-book', enchantment: request.id, level: stack.level, copy },
          })
        }
      }
    }
    return inputs
  }
  if (problem.target !== null) {
    inputs.push({
      kind: 'item',
      itemType: problem.target.itemType,
      enchantments: problem.target.enchantments,
      anvilUses: problem.target.anvilUses,
      origin: { source: 'target' },
    })
  }
  problem.extraItems.forEach((extra, index) => {
    inputs.push({
      kind: 'item',
      itemType: problem.target?.itemType ?? null,
      enchantments: extra.enchantments,
      anvilUses: extra.anvilUses,
      origin: { source: 'extra-item', index },
    })
  })
  problem.books.forEach((book, index) => {
    for (let copy = 0; copy < (book.count ?? 1); copy++) {
      inputs.push({
        kind: 'book',
        itemType: null,
        enchantments: book.enchantments,
        anvilUses: book.anvilUses,
        origin: { source: 'book', index, copy },
      })
    }
  })
  return inputs
}
