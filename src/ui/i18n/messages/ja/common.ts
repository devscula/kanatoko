export const common = {
  // App, header and footer
  'app.name': 'Kanatoko',
  'app.description': '金床でエンチャントの本を合成するとき、必要なレベルが最も少なくなる順番を計算します。',
  'header.settings': '設定',
  'header.undo': '元に戻す',
  'header.redo': 'やり直す',
  'header.edition': 'エディション',
  'edition.java': 'Java版',
  'edition.bedrock': '統合版',
  'edition.javaShort': 'Java版',
  'edition.bedrockShort': '統合版',
  'edition.javaVersion': 'Java版 26.3',
  'edition.bedrockVersion': '統合版 26.52',
  'lang.ja': '日本語',
  'lang.en': 'English',
  'skip.toSteps': '手順へ移動',
  'footer.about': 'このツールについて',

  // Shared confirmation dialog buttons
  'confirm.replace': '置き換える',
  'confirm.cancel': 'やめる',

  'sheet.close': '閉じる',

  // Banners
  'banner.shared': '共有された手順（{edition}・{item}）を表示しています。自分の入力はそのまま残っています。',
  'banner.shared.edit': 'この手順を編集する',
  'banner.shared.back': '自分の入力に戻る',
  'banner.shared.locked': '共有された手順を表示している間は変えられません。',
  'banner.linkUnreadable': '共有リンクを開けませんでした。古い形式のリンクか、途中で切れている可能性があります。前回の入力を表示しています。',
  'banner.dataDropped': 'このバージョンにないエンチャントを外しました: {list}',
  'banner.storageUnavailable': 'この端末では入力を保存できません。共有リンクで控えてください。',
  'banner.storageCorrupt': '保存されていた入力を読み込めなかったので、空の状態から始めます。',
  'banner.close': '閉じる',
  'storage.unavailable': 'この端末では入力を保存できません。共有リンクで控えてください。',
  // Banner names (aria-label)
  'banner.region.shared': '共有された手順',
  'banner.region.link': '開けなかったリンク',
  'banner.region.data': '外したエンチャント',
  'banner.region.storage': '入力の保存',

  // Notifications and history action names
  'toast.undo': '元に戻す',
  'toast.change': '変える',
  'toast.close': '通知を閉じる',
  'toast.conflictReplaced': '{list}を外しました',
  'toast.maxAllPicked': '競合するものからは{list}を選びました',
  'toast.editionRemoved': '{edition}にない{list}を外しました',
  'toast.itemChangedRemoved': '{item}に付かない{list}を外しました',
  'toast.cleared': '入力をすべて消しました',
  'toast.restored': 'ひとつ前の入力に戻しました',
  'toast.deleted': '{label}を削除しました',
  'toast.objectiveChanged': '「{name}」に切り替えました',
  'toast.creativeOn': 'クリエイティブ（上限なし）に切り替えました',
  'toast.survivalOn': 'サバイバルに切り替えました',
  'toast.example': '例を入れました',
  'toast.copied': 'コピーしました',
  'toast.linkCopied': 'リンクをコピーしました',
  'history.select': '{name}を選ぶ',
  'history.deselect': '{name}を外す',
  'history.level': '{name}を {level} にする',
  'history.item': 'アイテムを{item}にする',
  'history.maxAll': 'すべて最大で選ぶ',
  'history.rename': '「名前を付ける」を切り替える',
  'history.edition': 'エディションを{edition}にする',
  'history.gameMode': 'ゲームモードを変える',
  'history.objective': '優先するものを変える',
  'history.example': '例を入れる',
  'history.replace': '共有された手順で置き換える',
  'history.clear': '入力を消す',
  'history.suggestion': '作れる案を使う',
  // "Restore previous input" in the settings
  'history.restore': 'ひとつ前の入力に戻す',

  // Render failures: the error screen for the whole page
  'error.renderFailed': '表示に失敗しました',
  'error.renderFailedNote':
    '入力を消して開き直すと、直ることがあります。消した入力は、設定の「ひとつ前の入力に戻す」で戻せます。',
  'error.resetAndReload': '入力を消して開き直す',

  // Screen reader only text
  'a11y.resultAnnounce': '合計{t}レベル、1回の最大{m}レベル、{k}手順',
  'a11y.enchantLevel': '{name} レベル{n}',
  'a11y.external': '（新しいタブで開きます）',
  'a11y.skipResult': '結果の要約へ移動',
  // Accessible name of the level chip radiogroup
  'a11y.enchantLevels': '{name}のレベル',
  'layout.inputHeading': '入力',
  'header.keyboard': 'キーボード操作',
} as const
