// Shared by the condition chips, copied text, the printout and the objective-change notice so they all use the same
// wording.

import type { Edition } from '../../data/types.ts'
import type { Objective } from '../../engine/index.ts'
import type { MessageKey } from './messages/index.ts'
import { msg, type Text } from './text.ts'

const OBJECTIVE_NAME_KEYS = {
  levels: 'chip.objective.levels',
  xp: 'chip.objective.xp',
  finalPwp: 'chip.objective.finalPwp',
} as const satisfies Record<Objective, MessageKey>

export const objectiveName = (objective: Objective): Text => msg(OBJECTIVE_NAME_KEYS[objective])

/** levelCap is 39 in Survival and null in Creative */
export const gameModeName = (levelCap: 39 | null): Text => msg(levelCap === null ? 'chip.creative' : 'chip.survival')

export const editionVersionName = (edition: Edition): Text => msg(edition === 'java' ? 'edition.javaVersion' : 'edition.bedrockVersion')
