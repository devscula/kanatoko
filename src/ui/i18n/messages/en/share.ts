import type { share as ja } from '../ja/share.ts'

export const share = {
  'share.button': 'Share',
  'share.copyText': 'Copy as text',
  'share.sheetTitle': 'Share',
  'share.copyLink': 'Copy link',
  'share.includes': 'The link includes the edition, calculation settings and input, not your language or theme.',
  'share.copyManual': 'Copy the selected text',
  'share.title': 'Enchantment order for {item}',
  'share.text':
    '{t, plural, one {# level} other {# levels}} total, max {m} per step, {k, plural, one {# step} other {# steps}} ({edition})',
  'text.header': '{item} ({edition} {version}, {mode}, {objective})',
  'text.totals': '{t, plural, one {# level} other {# levels}} total, max {m} per step, {k, plural, one {# step} other {# steps}}',
  'text.stepMake': '{n}. Left {left} + right {right} → {result} ({c, plural, one {# level} other {# levels}})',
  'text.stepApply': '{n}. Left {left} + right {right} ({c, plural, one {# level} other {# levels}})',
  'text.stepRename': '{n}. Rename {left} ({c, plural, one {# level} other {# levels}})',
  'text.final': 'done',
  'text.renameHere': 'type the name',
  'text.unused': 'Not used: {list}',
  'text.open': 'Open this plan: {url}',
  'confirm.replaceWithShared':
    'This replaces your current input. You can get it back with Settings > Restore previous input.',

  'share.actionsLabel': 'Share',
  'share.linkLabel': 'Link to this plan',
  'share.textLabel': 'Text to copy',
  'text.count': '{label} x{n}',
  'text.withNotes': '{line} {notes}',
  'text.overCap': '40+ levels',
  'text.getBooks': 'Books to get: {list}',
  'text.fromOwned': 'From what you have: {list}',
} as const satisfies Record<keyof typeof ja, string>
