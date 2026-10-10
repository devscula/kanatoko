// createSolverClient() starts the Worker right away so it has loaded by the first request.

import { createSolverClient } from '../../engine/client.ts'
import { estimateComplexity } from '../../engine/index.ts'
import type { SolverBackend } from './types.ts'

export function createEngineBackend(): SolverBackend {
  return {
    client: createSolverClient(),
    estimateComplexity: (problem, settings) => estimateComplexity(problem, settings),
  }
}
