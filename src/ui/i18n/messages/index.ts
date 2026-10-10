// Add each message to the ja and en files of the same name under the same key; a key missing from en is a type error.

import { blocks as enBlocks } from './en/blocks.ts'
import { common as enCommon } from './en/common.ts'
import { engineCodes as enEngineCodes } from './en/engineCodes.ts'
import { input as enInput } from './en/input.ts'
import { result as enResult } from './en/result.ts'
import { settings as enSettings } from './en/settings.ts'
import { share as enShare } from './en/share.ts'
import { blocks as jaBlocks } from './ja/blocks.ts'
import { common as jaCommon } from './ja/common.ts'
import { engineCodes as jaEngineCodes } from './ja/engineCodes.ts'
import { input as jaInput } from './ja/input.ts'
import { result as jaResult } from './ja/result.ts'
import { settings as jaSettings } from './ja/settings.ts'
import { share as jaShare } from './ja/share.ts'

// Kept per area so a test can check that no key is in two areas; spreading them would silently keep the last one.
export const MESSAGE_AREAS = {
  ja: {
    common: jaCommon,
    blocks: jaBlocks,
    input: jaInput,
    result: jaResult,
    share: jaShare,
    settings: jaSettings,
    engineCodes: jaEngineCodes,
  },
  en: {
    common: enCommon,
    blocks: enBlocks,
    input: enInput,
    result: enResult,
    share: enShare,
    settings: enSettings,
    engineCodes: enEngineCodes,
  },
} as const

const ja = {
  ...jaCommon,
  ...jaBlocks,
  ...jaInput,
  ...jaResult,
  ...jaShare,
  ...jaSettings,
  ...jaEngineCodes,
} as const

const en = {
  ...enCommon,
  ...enBlocks,
  ...enInput,
  ...enResult,
  ...enShare,
  ...enSettings,
  ...enEngineCodes,
} as const satisfies Record<keyof typeof ja, string>

export type JaMessages = typeof ja
export type EnMessages = typeof en
export type MessageKey = keyof JaMessages

export const MESSAGES: { readonly ja: Readonly<Record<MessageKey, string>>; readonly en: Readonly<Record<MessageKey, string>> } = {
  ja,
  en,
}

/** Filled in for the current edition; callers do not pass it */
export type AutoParam = 'tooExpensive'

// A plural {name, plural, one {...} other {...}} contributes only name, not branch contents such as {# step}, matching
// parseTemplate in render.ts.
type Placeholders<S extends string> = S extends `${string}{${infer P}}${infer Rest}`
  ? P extends `${infer Name}, plural,${string}`
    ? Name | Placeholders<SkipPluralBranches<Rest>>
    : P | Placeholders<Rest>
  : never

// Skips the remaining branches of a plural (" other {# steps}}...") and returns what follows its closing }
type SkipPluralBranches<S extends string> = S extends `}${infer Rest}`
  ? Rest
  : S extends `${string}{${string}}${infer Rest}`
    ? SkipPluralBranches<Rest>
    : S

export type ParamName<K extends MessageKey> = Exclude<Placeholders<JaMessages[K]> | Placeholders<EnMessages[K]>, AutoParam>
