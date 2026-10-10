export const UI_ICON_KEYS = [
  'anvil', 'combine', 'arrow-right', 'check', 'undo', 'redo', 'share', 'copy', 'print', 'gear',
  'language', 'sun', 'moon', 'theme-auto', 'list', 'tree', 'warning', 'info', 'xp-orb',
  'name-tag', 'close', 'minus', 'plus', 'chevron-right', 'external', 'curse',
  'search', 'edit', 'more',
  'star', 'lock', 'blocked', 'max-all', 'chest', 'keyboard',
  'trash', 'limit', 'infinity', 'edition', 'auto-reset', 'enchanting-table', 'pwp', 'route', 'stack',
  'heart', 'target', 'motion', 'eye', 'save',
] as const

export type IconKey = (typeof UI_ICON_KEYS)[number]
