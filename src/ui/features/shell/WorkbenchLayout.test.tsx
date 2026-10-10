// @vitest-environment jsdom
import { render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { WorkbenchLayout } from './WorkbenchLayout.tsx'

/** A matchMedia stand-in that understands only min/max width and height, and pointer */
function viewport(width: number, height: number, pointer: 'fine' | 'coarse' = 'fine') {
  const evaluate = (query: string): boolean =>
    query.split(' and ').every((part) => {
      const m = /\((min|max)-(width|height):\s*(\d+)px\)/.exec(part)
      if (m !== null) {
        const value = m[2] === 'width' ? width : height
        return m[1] === 'min' ? value >= Number(m[3]) : value <= Number(m[3])
      }
      const p = /\(pointer:\s*(\w+)\)/.exec(part)
      if (p !== null) return p[1] === pointer
      return false
    })
  window.matchMedia = ((query: string) => ({
    matches: evaluate(query),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

const original = window.matchMedia
afterEach(() => {
  window.matchMedia = original
})

function layout(first = false) {
  const { container } = render(
    <WorkbenchLayout
      first={first}
      left={<p>input</p>}
      center={<h2 id="results">steps</h2>}
      footer={<footer>footer</footer>}
    />,
  )
  const main = container.querySelector('main')
  if (main === null) throw new Error('main element not found')
  return { main, sections: [...main.querySelectorAll(':scope > section')], container }
}

describe('column count', () => {
  it.each([
    [1920, 1080, '2'],
    [1440, 900, '2'],
    [1366, 768, '2'],
    [1360, 900, '2'],
    [1359, 900, '2'],
    [1280, 585, '2'],
    [960, 1080, '2'],
    [880, 900, '2'],
    [879, 900, '1'],
    [390, 844, '1'],
  ])('renders %ipx x %ipx with data-columns=%s and the input and steps sections', (width, height, dataColumns) => {
    viewport(width, height)
    const { main, sections } = layout()
    expect(main).toHaveAttribute('data-columns', dataColumns)
    // With one column the two sections stack
    expect(sections.map((s) => s.getAttribute('aria-labelledby'))).toEqual(['input-heading', 'results'])
  })

  it('keeps two columns from 1360px and gives scrolling columns tabIndex=0 and a heading', () => {
    viewport(1920, 945)
    const { sections } = layout()
    expect(sections.map((s) => s.getAttribute('aria-labelledby'))).toEqual(['input-heading', 'results'])
    expect(sections.every((s) => s.getAttribute('tabindex') === '0')).toBe(true)
  })

  it('puts the footer at the end of the left column, or after the columns in the single-column layout', () => {
    viewport(1440, 900)
    const wide = layout()
    expect(wide.sections[0].lastElementChild?.tagName).toBe('FOOTER')
    viewport(390, 844)
    const narrow = layout()
    expect(narrow.main.lastElementChild?.tagName).toBe('FOOTER')
  })

  it('shows only the left column at full width before an item is chosen', () => {
    viewport(1920, 1080)
    const { main, sections } = layout(true)
    expect(main).toHaveAttribute('data-columns', '1')
    expect(main).toHaveAttribute('data-first')
    expect(sections).toHaveLength(1)
    expect(main).not.toHaveAttribute('data-fixed')
  })
})

describe('height rules', () => {
  it('uses the normal form with per-column scrolling from 720px tall', () => {
    viewport(1920, 945)
    const { main } = layout()
    expect(main).toHaveAttribute('data-fixed')
    expect(main).not.toHaveAttribute('data-compact')
  })

  it('uses the compact form below 720px tall (1366x630 keeps two columns)', () => {
    viewport(1366, 630)
    const { main, sections } = layout()
    expect(main).toHaveAttribute('data-columns', '2')
    expect(sections).toHaveLength(2)
    expect(main).toHaveAttribute('data-compact')
    expect(main).toHaveAttribute('data-fixed')
  })

  it('scrolls the whole page below 560px tall (960x472 keeps two columns)', () => {
    viewport(960, 472)
    const { main, sections } = layout()
    expect(main).toHaveAttribute('data-columns', '2')
    expect(main).not.toHaveAttribute('data-fixed')
    expect(sections.every((s) => !s.hasAttribute('tabindex'))).toBe(true)
  })

  it('does not scroll per column below 880px', () => {
    viewport(390, 844)
    const { main } = layout()
    expect(main).not.toHaveAttribute('data-fixed')
  })
})
