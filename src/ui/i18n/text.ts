import type { Edition, EnchantmentId, ItemTypeId } from '../../data/types.ts'
import type { MessageKey, ParamName } from './messages/index.ts'

/** Strings are inserted as is; numbers get the language's digit grouping. */
export type TextArg = string | number | Text

/** 'and' and 'or' join items in prose, 'sentence' joins whole statements, 'dot' is a compact separator for short labels. */
export type ListSeparator = 'and' | 'or' | 'sentence' | 'dot'

/**
 * Language-independent UI text. Plans, notifications and history entries keep Text and render it when shown, so
 * switching the language does not rebuild them.
 */
export type Text =
  | { readonly t: 'msg'; readonly key: MessageKey; readonly params?: Readonly<Record<string, TextArg>> }
  | { readonly t: 'item'; readonly id: ItemTypeId }
  | { readonly t: 'ench'; readonly id: EnchantmentId; readonly level?: number }
  | { readonly t: 'roman'; readonly n: number }
  | { readonly t: 'list'; readonly items: readonly TextArg[]; readonly sep?: ListSeparator }
  | { readonly t: 'edition'; readonly edition: Edition }

export type LabelText = Text

export type MessageParams<K extends MessageKey> = { readonly [P in ParamName<K>]: TextArg }
export type ParamArgs<K extends MessageKey> = [ParamName<K>] extends [never] ? [params?: undefined] : [params: MessageParams<K>]

export function msg<K extends MessageKey>(key: K, ...args: ParamArgs<K>): Text {
  const params = args[0]
  return params === undefined ? { t: 'msg', key } : { t: 'msg', key, params: params as Readonly<Record<string, TextArg>> }
}

/** For a key chosen at run time. Its parameters are not type-checked. */
export function dynamicMsg(key: MessageKey, params?: Readonly<Record<string, TextArg>>): Text {
  return params === undefined ? { t: 'msg', key } : { t: 'msg', key, params }
}

export const itemText = (id: ItemTypeId): Text => ({ t: 'item', id })

export const enchText = (id: EnchantmentId, level?: number): Text =>
  level === undefined ? { t: 'ench', id } : { t: 'ench', id, level }

export const romanText = (n: number): Text => ({ t: 'roman', n })

export const listText = (items: readonly TextArg[], sep: ListSeparator = 'and'): Text => ({ t: 'list', items, sep })

export const editionText = (edition: Edition): Text => ({ t: 'edition', edition })
