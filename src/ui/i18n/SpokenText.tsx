import { Fragment, type ReactNode } from 'react'
import { enchantmentName, formatEnchantment } from '../../data/format.ts'
import { interpolate, messageTemplate, renderArg, renderArgMeta, tooExpensiveQuote, type RenderedArg, type TextContext } from './render.ts'
import type { Text, TextArg } from './text.ts'
import { useT } from './useT.ts'

// Private Use Area characters, distinct from SLOT_MARK in fillSlots.tsx
const OPEN = ''
const CLOSE = ''
const MARKED = new RegExp(`${OPEN}(\\d+)${CLOSE}`, 'g')

function hasLeveled(arg: TextArg, ctx: TextContext): boolean {
  if (typeof arg !== 'object') return false
  switch (arg.t) {
    case 'ench':
      return arg.level !== undefined && formatEnchantment(arg.id, arg.level, ctx.edition, ctx.lang) !== enchantmentName(arg.id, ctx.edition, ctx.lang)
    case 'list':
      return arg.items.some((item) => hasLeveled(item, ctx))
    case 'msg':
      return arg.params !== undefined && Object.values(arg.params).some((param) => hasLeveled(param, ctx))
    default:
      return false
  }
}

function renderNodes(arg: TextArg, ctx: TextContext): ReactNode {
  if (!hasLeveled(arg, ctx)) return renderArg(arg, ctx)
  const text = arg as Text
  switch (text.t) {
    case 'ench':
      return (
        <>
          <span aria-hidden="true">{renderArg(text, ctx)}</span>
          <span className="visually-hidden">{renderArg(text, { ...ctx, spoken: true })}</span>
        </>
      )
    case 'list': {
      const separator = renderArg({ t: 'list', items: ['', ''], sep: text.sep }, ctx)
      return text.items.map((item, index) => (
        <Fragment key={index}>
          {index > 0 && separator}
          {renderNodes(item, ctx)}
        </Fragment>
      ))
    }
    case 'msg': {
      const template = messageTemplate(text.key, ctx.lang)
      if (template === undefined) return renderArg(text, ctx)
      const nodes: ReactNode[] = []
      const values: Record<string, RenderedArg> = { tooExpensive: { text: tooExpensiveQuote(ctx), numeralEnd: false } }
      for (const [name, param] of Object.entries(text.params ?? {})) {
        const meta = renderArgMeta(param, ctx)
        if (!hasLeveled(param, ctx)) {
          values[name] = meta
          continue
        }
        nodes.push(renderNodes(param, ctx))
        values[name] = { ...meta, text: `${OPEN}${nodes.length - 1}${CLOSE}` }
      }
      const filled = interpolate(template, values, ctx.lang).text
      return filled.split(MARKED).map((part, index) => (
        // Odd parts of the split are the indexes inside the markers
        <Fragment key={index}>{index % 2 === 1 ? nodes[Number(part)] : part}</Fragment>
      ))
    }
    default:
      return renderArg(text, ctx)
  }
}

/**
 * Speech synthesizers tend to read Roman numerals as letters ("I I I"), so the visible "Soul Speed III" is aria-hidden
 * and a visually hidden "Soul Speed level 3" is read instead. Not for buttons or links: their accessible name must
 * contain the visible text (WCAG 2.5.3 Label in Name).
 */
export function SpokenText({ value }: { readonly value: TextArg }) {
  const { lang, edition } = useT()
  return <>{renderNodes(value, { lang, edition })}</>
}
