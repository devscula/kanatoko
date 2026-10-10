import type { Problem, Suggestion } from '../../../engine/index.ts'
import { enchText, msg, romanText, type Text } from '../../i18n/text.ts'

export const MAX_SUGGESTIONS = 3

// The UI always makes the goal the wanted enchantments, sets useOnlyNeeded and gets missing books as books to get, so
// add-book, remove-input and enable-use-only-needed cannot arise; any that do are dropped
export type ShownSuggestion = Extract<Suggestion, { readonly code: 'drop-goal-enchantment' | 'lower-goal-level' }>

export function isShownSuggestion(suggestion: Suggestion): suggestion is ShownSuggestion {
  return suggestion.code === 'drop-goal-enchantment' || suggestion.code === 'lower-goal-level'
}

export function sortSuggestions(suggestions: readonly Suggestion[]): ShownSuggestion[] {
  return suggestions
    .filter(isShownSuggestion)
    .sort((a, b) => a.totalLevels - b.totalLevels || a.maxStepLevels - b.maxStepLevels)
    .slice(0, MAX_SUGGESTIONS)
}

function wantedLevel(problem: Problem, id: ShownSuggestion['enchantment']): number | undefined {
  if (problem.mode === 'simple') return problem.enchantments.find((e) => e.id === id)?.level
  return problem.goal?.[id]
}

export function suggestionTitle(suggestion: ShownSuggestion, problem: Problem): Text {
  if (suggestion.code === 'drop-goal-enchantment') {
    return msg('sug.dropGoal', { name: enchText(suggestion.enchantment, wantedLevel(problem, suggestion.enchantment)) })
  }
  return msg('sug.lowerLevel', { name: enchText(suggestion.enchantment), level: romanText(suggestion.level) })
}

export function suggestionToast(suggestion: ShownSuggestion, problem: Problem): Text {
  if (suggestion.code === 'drop-goal-enchantment') {
    return msg('toast.sug.dropGoal', { name: enchText(suggestion.enchantment, wantedLevel(problem, suggestion.enchantment)) })
  }
  return msg('toast.sug.lowerLevel', { name: enchText(suggestion.enchantment), level: romanText(suggestion.level) })
}

export function suggestionButton(suggestion: ShownSuggestion): Text {
  return suggestion.code === 'drop-goal-enchantment' ? msg('sug.dropGoal.button') : msg('sug.lowerLevel.button', { level: romanText(suggestion.level) })
}
