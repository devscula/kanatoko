// Durations that JS timers wait on. CSS gets them through MOTION_VARS on the animated element.

import type { CSSProperties } from 'react'

/** Highlight on a step card reached from the tree */
export const REVEAL_MS = 2000

export const MOTION_VARS = {
  '--reveal-duration': `${REVEAL_MS}ms`,
} as CSSProperties
