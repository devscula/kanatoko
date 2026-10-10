// A malformed problem is answered with status 'invalid' and no search. A goal that cannot be met is not malformed;
// that is a failure reason (diagnostics.ts). Saved data and URLs come through here too, so unknown ids and non-integer
// levels must be reported, not thrown.

import {
  areCompatible,
  getEnchantment,
  getItem,
  isApplicable,
  isEnchantmentId,
  isEnchantmentInEdition,
  isItemInEdition,
  isItemTypeId,
} from '../data/gameData.ts'
import { GAME_DATA } from '../data/gameData.generated.ts'
import type { Edition, EnchantmentId, ItemTypeId } from '../data/types.ts'
import { LIMITS, type Limits } from './limits.ts'
import type { AdvancedProblem, EnchantLevels, InputPath, Problem, Settings, SimpleProblem, ValidationIssue } from './types.ts'

export type ValidationLimits = Pick<Limits, 'maxAnvilUses' | 'maxStackCount'>

export function validateProblem(
  problem: Problem,
  settings: Pick<Settings, 'edition'>,
  limits: ValidationLimits = LIMITS,
): ValidationIssue[] {
  const checker = new IssueCollector(settings.edition, limits)
  if (problem.mode === 'simple') checker.simple(problem)
  else checker.advanced(problem)
  return checker.issues
}

const DATA_POSITION: ReadonlyMap<string, number> = new Map(GAME_DATA.enchantments.map((e, i) => [e.id, i]))

class IssueCollector {
  readonly issues: ValidationIssue[] = []
  private readonly seen = new Set<string>()
  private readonly edition: Edition
  private readonly limits: ValidationLimits

  constructor(edition: Edition, limits: ValidationLimits) {
    this.edition = edition
    this.limits = limits
  }

  simple(problem: SimpleProblem): void {
    if (!this.itemInEdition(problem.item)) this.add({ code: 'item-not-in-edition', itemType: problem.item })
    const requested = new Set<EnchantmentId>()
    for (const request of problem.enchantments) {
      if (requested.has(request.id)) {
        this.add({ code: 'duplicate-simple-enchantment', enchantment: request.id })
        continue   // the "keep one" fix removes the later duplicates, so their contents are not checked
      }
      requested.add(request.id)
      const where: InputPath = { part: 'simple', enchantment: request.id }
      if (!this.enchantmentInEdition(request.id)) {
        this.add({ code: 'enchantment-not-in-edition', enchantment: request.id, where })
        continue
      }
      this.level(request.id, request.level, where)
      for (const stack of request.sources ?? []) {
        this.level(request.id, stack.level, where)
        this.count(stack.count, where)
      }
    }
  }

  advanced(problem: AdvancedProblem): void {
    const { target } = problem
    // Stays null, skipping the applicability checks, when the target is missing or already reported as invalid
    let targetType: ItemTypeId | null = null
    if (target !== null) {
      const where: InputPath = { part: 'target' }
      if (isItemTypeId(target.itemType) && getItem(target.itemType).isBook) this.add({ code: 'target-is-book' })
      else if (!this.itemInEdition(target.itemType)) this.add({ code: 'item-not-in-edition', itemType: target.itemType })
      else targetType = target.itemType
      this.enchantments(target.enchantments, where, targetType)
      this.anvilUses(target.anvilUses, where)
    }

    if (problem.extraItems.length > 0) {
      if (target === null) this.add({ code: 'extra-items-without-target' })
      else if (targetType !== null && !getItem(targetType).damageable) this.add({ code: 'extra-item-not-combinable', itemType: targetType })
    }
    problem.extraItems.forEach((extra, index) => {
      const where: InputPath = { part: 'extraItem', index }
      this.enchantments(extra.enchantments, where, targetType)
      this.anvilUses(extra.anvilUses, where)
    })

    problem.books.forEach((book, index) => {
      const where: InputPath = { part: 'book', index }
      if (definedEntries(book.enchantments).length === 0) this.add({ code: 'empty-book', where })
      this.enchantments(book.enchantments, where, null)
      this.anvilUses(book.anvilUses, where)
      if (book.count !== undefined) this.count(book.count, where)
    })

    if (problem.goal !== null) {
      for (const [key, level] of definedEntries(problem.goal)) {
        const id = key as EnchantmentId
        const where: InputPath = { part: 'goal', enchantment: id }
        if (!this.enchantmentInEdition(key)) this.add({ code: 'enchantment-not-in-edition', enchantment: id, where })
        else this.level(id, level, where)
      }
    }
  }

  private enchantments(levels: EnchantLevels, where: InputPath, itemType: ItemTypeId | null): void {
    const present: EnchantmentId[] = []
    for (const [key, level] of definedEntries(levels)) {
      const id = key as EnchantmentId
      if (!this.enchantmentInEdition(key)) {
        this.add({ code: 'enchantment-not-in-edition', enchantment: id, where })
        continue
      }
      this.level(id, level, where)
      if (itemType !== null && !isApplicable(this.edition, itemType, id)) this.add({ code: 'not-applicable-on-item-input', enchantment: id, where })
      present.push(id)
    }
    // Such an object cannot exist in survival, and rules.ts relies on a sacrifice never conflicting with itself
    for (let i = 0; i < present.length; i++) {
      for (let j = i + 1; j < present.length; j++) {
        if (!areCompatible(this.edition, present[i], present[j])) this.add({ code: 'input-self-conflict', a: present[i], b: present[j], where })
      }
    }
  }

  private level(id: EnchantmentId, level: number, where: InputPath): void {
    const max = getEnchantment(id).maxLevel
    if (!isIntegerIn(level, 1, max)) this.add({ code: 'level-out-of-range', enchantment: id, level, maxLevel: max, where })
  }

  private anvilUses(value: number, where: InputPath): void {
    if (!isIntegerIn(value, 0, this.limits.maxAnvilUses)) this.add({ code: 'anvil-uses-out-of-range', value, where })
  }

  private count(value: number, where: InputPath): void {
    if (!isIntegerIn(value, 1, this.limits.maxStackCount)) this.add({ code: 'count-out-of-range', value, where })
  }

  private itemInEdition(itemType: string): boolean {
    return isItemTypeId(itemType) && isItemInEdition(this.edition, itemType)
  }

  private enchantmentInEdition(id: string): boolean {
    return isEnchantmentId(id) && isEnchantmentInEdition(this.edition, id)
  }

  private add(issue: ValidationIssue): void {
    const key = JSON.stringify(issue)
    if (this.seen.has(key)) return
    this.seen.add(key)
    this.issues.push(issue)
  }
}

/** Zero and non-integer levels are kept so that they get reported as out of range. */
function definedEntries(levels: EnchantLevels): Array<readonly [string, number]> {
  const entries = Object.entries(levels).filter((entry): entry is [string, number] => entry[1] !== undefined)
  const position = (id: string): number => DATA_POSITION.get(id) ?? Number.MAX_SAFE_INTEGER
  // sort is stable, so unknown ids keep their original order
  return entries.sort((a, b) => position(a[0]) - position(b[0]))
}

function isIntegerIn(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max
}
