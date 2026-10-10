// The code-to-key table is in src/ui/i18n/engineCodes.ts. too-expensive uses infeasible.tooExpensive from result.ts.

export const engineCodes = {
  // FailureReason: why no plan exists
  'reason.goalNotInEdition': '{name}は{edition}にありません。',
  'reason.goalNotApplicable': '{name}は{item}に付きません。',
  'reason.goalEnchantmentMissing': '手持ちに{name}の本がありません。',
  'reason.goalConflict': '{a}と{b}は同時に付けられません。どちらかを付けたいエンチャントから外してください。',
  'reason.goalConflictsWithTarget': '{item}に付いている{existing}と競合するので、{name}は付けられません。金床ではエンチャントを外せません。',
  'reason.goalLevelUnreachable': '{name}は、手持ちの本では {reachable} までしか上げられず、{required} には届きません。',
  'reason.targetPenaltyTooHigh': '{item}の累積作業費用が{p}あるので、サバイバルではどの合成も40レベル以上かかります。',
  'reason.cannotUseAllInputs':
    '手持ちの本や予備をすべて使う合成はできません。使えないもの: {list}。',
  'reason.noPlan': 'この入力で作れる順番が見つかりませんでした。入力を見直してください。',

  // ValidationIssue: problems with the input
  'issue.itemNotInEdition': '{item}は{edition}にありません。',
  'issue.enchantmentNotInEdition': '{name}は{edition}にありません。',
  'issue.levelOutOfRange': '{name}のレベルは {max} までです。',
  'issue.inputSelfConflict': '同時に付けられない{a}と{b}が両方入っています。',
  'issue.notApplicableOnItemInput': '{name}は{item}に付かないので、{item}のエンチャントとしては入力できません。',
  'issue.emptyBook': 'エンチャントが入っていない本です。',
  'issue.anvilUsesOutOfRange': '金床使用回数は0〜10回で入力してください。',
  'issue.countOutOfRange': '冊数は1〜32冊で入力してください。',
  'issue.targetIsBook': 'エンチャントの本は、「エンチャントの本（本をまとめる）」として選んでください。',
  'issue.extraItemsWithoutTarget': '予備のアイテムは、エンチャントするアイテムを選んだときだけ使えます。',
  'issue.extraItemNotCombinable': '{item}には耐久値がないので、予備と合成できません。',
  'issue.duplicateSimpleEnchantment': '{name}が2つあります。',
  'issue.generic': '入力に直すところがあります。',

  // Fix buttons for validation issues
  'fix.reselectItem': 'アイテムを選び直す',
  'fix.remove': '外す',
  'fix.setLevel': '{max}にする',
  'fix.removeOne': '{b}を外す',
  'fix.delete': '削除',
  'fix.setUses': '10回にする',
  'fix.setCount': '32冊にする',
  'fix.reselect': '選び直す',
  'fix.keepOne': '1つにする',
} as const
