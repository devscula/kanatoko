// Same formulas in Java and Bedrock: https://minecraft.wiki/w/Experience

/** Total experience points from level 0 to level L. */
export function xpAtLevel(L: number): number {
  if (L <= 16) return L * L + 6 * L
  if (L <= 31) return (5 * L * L - 81 * L) / 2 + 360      // = 2.5L^2 - 40.5L + 360
  return (9 * L * L - 325 * L) / 2 + 2220                 // = 4.5L^2 - 162.5L + 2220
}

export function xpToNextLevel(L: number): number {
  return L < 15 ? 2 * L + 7 : L < 30 ? 5 * L - 38 : 9 * L - 158
}

/**
 * The fewest experience points a step costing c levels can take: paid at exactly level c with an empty progress bar,
 * ending at level 0. Paying from a higher level loses more points.
 */
export const stepXp = (cost: number): number => xpAtLevel(cost)
