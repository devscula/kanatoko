// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { UI_ICON_KEYS } from './iconKeys.ts'
import { PixelIcon } from './PixelIcon.tsx'
import { PIXEL_ICON_SIZES } from './sizes.ts'

const svgOf = (container: HTMLElement): SVGSVGElement => {
  const svg = container.querySelector('svg')
  if (svg === null) throw new Error('no svg')
  return svg
}

describe('PixelIcon', () => {
  it.each(PIXEL_ICON_SIZES)('scales the 16x16 grid to %ipx without smoothing', (size) => {
    const svg = svgOf(render(<PixelIcon name="anvil" size={size} />).container)
    expect(svg).toHaveAttribute('width', String(size))
    expect(svg).toHaveAttribute('height', String(size))
    expect(svg).toHaveAttribute('viewBox', '0 0 16 16')
    expect(svg).toHaveAttribute('shape-rendering', 'crispEdges')
    expect(svg).toHaveAttribute('data-icon', 'anvil')
  })

  it('draws 24px at 2px per cell, leaving the two outer cells on each side out of the box', () => {
    const svg = svgOf(render(<PixelIcon name="anvil" size={24} />).container)
    expect(svg).toHaveAttribute('width', '24')
    expect(svg).toHaveAttribute('viewBox', '2 2 12 12')
    expect(svg).toHaveAttribute('shape-rendering', 'crispEdges')
  })

  it('renders every icon with at least one path', () => {
    for (const name of UI_ICON_KEYS) {
      const { container, unmount } = render(<PixelIcon name={name} size={32} />)
      expect(container.querySelectorAll('path').length).toBeGreaterThan(0)
      unmount()
    }
  })

  it('is hidden from assistive technology when decorative', () => {
    const svg = svgOf(render(<PixelIcon name="gear" size={16} />).container)
    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(svg).not.toHaveAttribute('role')
    expect(svg).not.toHaveAttribute('aria-label')
  })

  it('treats an empty label as decorative', () => {
    const svg = svgOf(render(<PixelIcon name="gear" size={16} label="" />).container)
    expect(svg).toHaveAttribute('aria-hidden', 'true')
  })

  it('is an image with a name when labeled', () => {
    render(<PixelIcon name="gear" size={32} label="設定" />)
    const img = screen.getByRole('img', { name: '設定' })
    expect(img).not.toHaveAttribute('aria-hidden')
  })

  it('paints with currentColor', () => {
    const ui = render(<PixelIcon name="check" size={16} />).container
    expect([...ui.querySelectorAll('path')].map((p) => p.getAttribute('fill'))).toEqual(['currentColor'])
  })

  it('keeps a given class name', () => {
    expect(svgOf(render(<PixelIcon name="plus" size={16} className="extra" />).container)).toHaveClass('extra')
  })
})
