import { enchantmentName, formatEnchantment, itemName, romanNumeral } from '../../data/format.ts'
import type { Edition, Lang } from '../../data/types.ts'
import { MESSAGES, type MessageKey } from './messages/index.ts'
import type { ListSeparator, ParamArgs, Text, TextArg } from './text.ts'

export interface TextContext {
  readonly lang: Lang
  readonly edition: Edition
  /** Renders levels as "Protection level 4" (a11y.enchantLevel) for aria-label and the like; see SpokenText */
  readonly spoken?: boolean
}

const LOCALES: Readonly<Record<Lang, string>> = { ja: 'ja-JP', en: 'en-US' }
const numberFormats = new Map<Lang, Intl.NumberFormat>()

export function formatNumber(n: number, lang: Lang): string {
  let format = numberFormats.get(lang)
  if (format === undefined) {
    format = new Intl.NumberFormat(LOCALES[lang])
    numberFormats.set(lang, format)
  }
  return format.format(n)
}

/**
 * The Japanese game text ends in a full-width ！ in Java Edition and a half-width ! in Bedrock Edition. English uses
 * curly quotes because the body font, BIZ UDPGothic, draws an ASCII " as ” on both sides.
 */
export function tooExpensiveQuote(ctx: TextContext): string {
  if (ctx.lang === 'en') return '\u201cToo Expensive!\u201d'
  return ctx.edition === 'java' ? '「コストが高すぎます！」' : '「コストが高すぎます!」'
}

const LIST_SEPARATORS: Readonly<Record<Lang, Readonly<Record<ListSeparator, string>>>> = {
  ja: { and: '、', or: '・', sentence: '。', dot: '・' },
  en: { and: ', ', or: ' or ', sentence: '. ', dot: ' · ' },
}

/** For markup that renders list items as separate elements and so cannot use listText */
export function listSeparator(lang: Lang, sep: ListSeparator): string {
  return LIST_SEPARATORS[lang][sep]
}

// Hiragana, katakana and kanji
const JAPANESE_LETTER = /^[\u3041-\u3096\u30a1-\u30fa\u30fc\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff66-\uff9f]/u

export interface RenderedArg {
  readonly text: string
  /**
   * Whether the text ends in a level numeral. Decided by the kind of Text, not by the characters: a book labeled "I"
   * does not end in a numeral.
   */
  readonly numeralEnd: boolean
  /** The unformatted number, for picking a plural form */
  readonly count?: number
}

const plain = (text: string): RenderedArg => ({ text, numeralEnd: false })

// Messages take {name} parameters. English plurals use a subset of ICU syntax,
// {name, plural, =0 {none} one {# step} other {# steps}}, where # is the formatted number and branches cannot
// contain parameters. Japanese messages do not use plurals.

type TemplatePart =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'arg'; readonly name: string }
  | { readonly kind: 'plural'; readonly name: string; readonly branches: ReadonlyMap<string, string> }

const templateCache = new Map<string, readonly TemplatePart[]>()

// Malformed parts stay as literal text so they show up during development.
function parseTemplate(template: string): readonly TemplatePart[] {
  const cached = templateCache.get(template)
  if (cached !== undefined) return cached
  const parts: TemplatePart[] = []
  let text = ''
  let i = 0
  while (i < template.length) {
    const open = template.indexOf('{', i)
    if (open < 0) break
    text += template.slice(i, open)
    const simple = /^\{([A-Za-z0-9_]+)\}/.exec(template.slice(open))
    if (simple !== null) {
      if (text !== '') parts.push({ kind: 'text', text })
      text = ''
      parts.push({ kind: 'arg', name: simple[1] })
      i = open + simple[0].length
      continue
    }
    const plural = parsePlural(template, open)
    if (plural !== null) {
      if (text !== '') parts.push({ kind: 'text', text })
      text = ''
      parts.push(plural.part)
      i = plural.end
      continue
    }
    text += '{'
    i = open + 1
  }
  text += template.slice(i)
  if (text !== '') parts.push({ kind: 'text', text })
  templateCache.set(template, parts)
  return parts
}

function parsePlural(template: string, open: number): { readonly part: TemplatePart; readonly end: number } | null {
  const head = /^\{([A-Za-z0-9_]+),\s*plural,/.exec(template.slice(open))
  if (head === null) return null
  const branches = new Map<string, string>()
  let i = open + head[0].length
  for (;;) {
    while (template[i] === ' ') i++
    if (template[i] === '}') return branches.has('other') ? { part: { kind: 'plural', name: head[1], branches }, end: i + 1 } : null
    const selector = /^(=\d+|zero|one|two|few|many|other)\s*\{/.exec(template.slice(i))
    if (selector === null) return null
    const bodyStart = i + selector[0].length
    const bodyEnd = template.indexOf('}', bodyStart)
    if (bodyEnd < 0 || template.slice(bodyStart, bodyEnd).includes('{')) return null
    branches.set(selector[1], template.slice(bodyStart, bodyEnd))
    i = bodyEnd + 1
  }
}

/** For a plural, only the count is a parameter. Tests use this to compare ja and en. */
export function placeholderNames(template: string): Set<string> {
  const names = new Set<string>()
  for (const part of parseTemplate(template)) if (part.kind !== 'text') names.add(part.name)
  return names
}

const pluralRules = new Map<Lang, Intl.PluralRules>()

function pluralBranch(branches: ReadonlyMap<string, string>, count: number | undefined, lang: Lang): string {
  if (count !== undefined) {
    const exact = branches.get(`=${count}`)
    if (exact !== undefined) return exact
    let rules = pluralRules.get(lang)
    if (rules === undefined) {
      rules = new Intl.PluralRules(LOCALES[lang])
      pluralRules.set(lang, rules)
    }
    const form = branches.get(rules.select(count))
    if (form !== undefined) return form
  }
  return branches.get('other') ?? ''
}

/**
 * Keeps the level from wrapping onto a line of its own. Copied text turns it back into a normal space
 * (features/share/formatPlanText.ts).
 */
export const NAME_LEVEL_SPACE = '\u00a0'

/**
 * In Japanese, a value ending in a level numeral gets a half-width space when Japanese text follows it. Parameters
 * without a value stay as they are so they show up during development.
 */
export function interpolate(
  template: string,
  values: Readonly<Record<string, RenderedArg | string>>,
  lang: Lang,
): RenderedArg {
  const parts = parseTemplate(template)
  let out = ''
  let numeralEnd = false
  parts.forEach((part, index) => {
    const next = parts[index + 1]
    const rest = next === undefined ? '' : next.kind === 'text' ? next.text : '{'
    if (part.kind === 'text') {
      out += part.text
      numeralEnd = false
      return
    }
    const raw = values[part.name]
    const value = typeof raw === 'string' ? plain(raw) : raw
    if (part.kind === 'plural') {
      // Without a numeric value, use the other form and leave # as is
      const branch = pluralBranch(part.branches, value?.count, lang)
      out += value === undefined ? branch : branch.replaceAll('#', value.text)
      numeralEnd = false
      return
    }
    if (value === undefined) {
      out += `{${part.name}}`
      numeralEnd = false
      return
    }
    out += value.text
    if (lang === 'ja' && value.numeralEnd && JAPANESE_LETTER.test(rest)) out += ' '
    numeralEnd = value.numeralEnd && rest === ''
  })
  return { text: out, numeralEnd }
}

export function renderArgMeta(arg: TextArg, ctx: TextContext): RenderedArg {
  if (typeof arg === 'string') return plain(arg)
  if (typeof arg === 'number') return { text: formatNumber(arg, ctx.lang), numeralEnd: false, count: arg }
  return renderTextMeta(arg, ctx)
}

function renderTextMeta(text: Text, ctx: TextContext): RenderedArg {
  switch (text.t) {
    case 'msg':
      return renderMessage(text.key, text.params, ctx)
    case 'item':
      return plain(itemName(text.id, ctx.edition, ctx.lang))
    case 'ench': {
      const name = enchantmentName(text.id, ctx.edition, ctx.lang)
      if (text.level === undefined) return plain(name)
      // formatEnchantment drops the level when the max level is 1
      if (formatEnchantment(text.id, text.level, ctx.edition, ctx.lang) === name) return plain(name)
      if (ctx.spoken === true) return renderMessage('a11y.enchantLevel', { name, n: text.level }, ctx)
      return { text: `${name}${NAME_LEVEL_SPACE}${romanNumeral(text.level)}`, numeralEnd: true }
    }
    case 'roman':
      return { text: romanNumeral(text.n), numeralEnd: true }
    case 'list': {
      const items = text.items.map((item) => renderArgMeta(item, ctx))
      return {
        text: items.map((item) => item.text).join(LIST_SEPARATORS[ctx.lang][text.sep ?? 'and']),
        numeralEnd: items.at(-1)?.numeralEnd ?? false,
      }
    }
    case 'edition':
      return renderMessage(text.edition === 'java' ? 'edition.java' : 'edition.bedrock', undefined, ctx)
  }
}

export function renderArg(arg: TextArg, ctx: TextContext): string {
  return renderArgMeta(arg, ctx).text
}

export function renderText(text: Text, ctx: TextContext): string {
  return renderTextMeta(text, ctx).text
}

export function messageTemplate(key: MessageKey, lang: Lang): string | undefined {
  return MESSAGES[lang][key] ?? MESSAGES.ja[key]
}

function renderMessage(key: MessageKey, params: Readonly<Record<string, TextArg>> | undefined, ctx: TextContext): RenderedArg {
  // Types rule this out, but an unknown key from saved data shows the key itself instead of breaking the page
  const template = messageTemplate(key, ctx.lang)
  if (template === undefined) return plain(key)
  const values: Record<string, RenderedArg> = { tooExpensive: plain(tooExpensiveQuote(ctx)) }
  if (params) for (const [name, value] of Object.entries(params)) values[name] = renderArgMeta(value, ctx)
  return interpolate(template, values, ctx.lang)
}

export function translate<K extends MessageKey>(ctx: TextContext, key: K, ...args: ParamArgs<K>): string {
  return renderMessage(key, args[0] as Readonly<Record<string, TextArg>> | undefined, ctx).text
}

export interface Translator {
  readonly lang: Lang
  readonly edition: Edition
  t<K extends MessageKey>(key: K, ...args: ParamArgs<K>): string
  text(arg: TextArg): string
  /** Levels read as "level 4", for aria-label and the like */
  spoken(arg: TextArg): string
  num(n: number): string
}

export function createTranslator(ctx: TextContext): Translator {
  return {
    lang: ctx.lang,
    edition: ctx.edition,
    t: (key, ...args) => translate(ctx, key, ...args),
    text: (arg) => renderArg(arg, ctx),
    spoken: (arg) => renderArg(arg, { ...ctx, spoken: true }),
    num: (n) => formatNumber(n, ctx.lang),
  }
}
