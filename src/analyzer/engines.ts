import type { Package, AnalysisTarget, ManagerType } from '../types.ts'
import { analyzeTarget } from './intersect.ts'

/**
 * Analyzes engine constraints across all packages for node and the active manager.
 * @param {Package[]} packages The full list of resolved packages.
 * @param {ManagerType} manager The active package manager type.
 * @returns {AnalysisTarget[]} Array of analysis targets with intersection results.
 */
export function analyzeEngines(packages: Package[], manager: ManagerType): AnalysisTarget[] {
  return ['node', manager].flatMap(
    key => analyzeTarget(packages, key, 'engines', declared => declared.engines?.[key]) ?? []
  )
}
