// Shows the data-tip text of the hovered or keyboard-focused element. Those elements carry the same text in aria-label,
// so the layer is aria-hidden. Esc dismisses it (WCAG 1.4.13).

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import styles from './TooltipLayer.module.css'

const GAP = 6
const MARGIN = 8

interface TipState {
  readonly text: string
  readonly anchor: DOMRect
}

function tipTarget(node: EventTarget | null): HTMLElement | null {
  return node instanceof Element ? node.closest<HTMLElement>('[data-tip]') : null
}

export function TooltipLayer() {
  const [tip, setTip] = useState<TipState | null>(null)
  const [pos, setPos] = useState<{ readonly left: number; readonly top: number } | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let current: HTMLElement | null = null
    const show = (el: HTMLElement) => {
      const text = el.dataset.tip
      if (text === undefined || text === '') return
      current = el
      setPos(null)
      setTip({ text, anchor: el.getBoundingClientRect() })
    }
    const hide = () => {
      current = null
      setTip(null)
    }
    const onOver = (event: PointerEvent) => {
      const el = tipTarget(event.target)
      if (el === current) return
      if (el === null) hide()
      else show(el)
    }
    const onOut = (event: PointerEvent) => {
      if (event.relatedTarget === null) hide()
    }
    const onFocusIn = (event: FocusEvent) => {
      const el = tipTarget(event.target)
      if (el !== null && el.matches(':focus-visible')) show(el)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') hide()
    }
    document.addEventListener('pointerover', onOver)
    document.addEventListener('pointerout', onOut)
    document.addEventListener('pointerdown', hide)
    document.addEventListener('focusin', onFocusIn)
    document.addEventListener('focusout', hide)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', hide, true)
    window.addEventListener('resize', hide)
    return () => {
      document.removeEventListener('pointerover', onOver)
      document.removeEventListener('pointerout', onOut)
      document.removeEventListener('pointerdown', hide)
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('focusout', hide)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('resize', hide)
    }
  }, [])

  useLayoutEffect(() => {
    const el = ref.current
    if (tip === null || el === null) return
    const { width, height } = el.getBoundingClientRect()
    const vw = document.documentElement.clientWidth
    const vh = document.documentElement.clientHeight
    const left = Math.min(Math.max(tip.anchor.left, MARGIN), vw - width - MARGIN)
    const below = tip.anchor.bottom + GAP
    const top = below + height <= vh - MARGIN ? below : Math.max(MARGIN, tip.anchor.top - GAP - height)
    setPos({ left, top })
  }, [tip])

  if (tip === null) return null
  return createPortal(
    <div
      ref={ref}
      className={styles.tip}
      aria-hidden="true"
      style={pos === null ? { left: 0, top: 0, visibility: 'hidden' } : { left: pos.left, top: pos.top }}
    >
      {tip.text}
    </div>,
    document.body,
  )
}
