// The shared-plan banner messages are in common.ts.

export const share = {
  'share.button': '共有',
  'share.copyText': 'テキストでコピー',
  'share.sheetTitle': '共有',
  'share.copyLink': 'リンクをコピー',
  'share.includes': 'リンクには、エディション、計算の条件、入力が入ります。言語とテーマは入りません。',
  'share.copyManual': '選択した文字をコピーしてください',
  'share.title': '{item}のエンチャントの順番',
  'share.text': '合計{t}レベル、1回の最大{m}レベル、{k}手順（{edition}）',
  'text.header': '{item}（{edition} {version}、{mode}、{objective}）',
  'text.totals': '合計{t}レベル、1回の最大{m}レベル、{k}手順',
  'text.stepMake': '{n}. 左 {left} ＋ 右 {right} → {result}（{c}レベル）',
  'text.stepApply': '{n}. 左 {left} ＋ 右 {right}（{c}レベル）',
  'text.stepRename': '{n}. 左 {left} に名前を付ける（{c}レベル）',
  'text.final': '完成',
  'text.renameHere': '名前を入力',
  'text.unused': '使わない手持ち: {list}',
  'text.open': 'この手順を開く: {url}',
  'confirm.replaceWithShared':
    '今の入力を、共有された手順の入力に置き換えます。置き換える前の入力は、設定の「ひとつ前の入力に戻す」で戻せます。',

  // Accessible names of the share actions group and its fields
  'share.actionsLabel': '共有',
  'share.linkLabel': 'この手順のリンク',
  'share.textLabel': 'コピーする文字',
  // Pieces of the copied text
  'text.count': '{label} x{n}',
  'text.withNotes': '{line}{notes}',
  'text.overCap': '40レベル以上',
  'text.getBooks': '用意する本: {list}',
  'text.fromOwned': '手持ちから使うもの: {list}',
} as const
