/**
 * Run structured AI regression harness (golden JSON → full pipeline → expectations).
 *
 * Usage: npm run test:structured-ai
 */

import {
  formatHarnessDiffs,
  runStructuredAiHarness,
} from '../lib/structuredAiTestHarness'

const origLog = console.log
const quiet =
  process.env.STRUCTURE_HARNESS_QUIET !== '0' && process.env.STRUCTURE_HARNESS_QUIET !== 'false'

if (quiet) {
  console.log = (...args: unknown[]) => {
    const first = args[0]
    if (typeof first === 'string' && first.startsWith('[structure] rank:')) return
    if (typeof first === 'string' && first.startsWith('[structure] primary_calendar')) return
    origLog(...args)
  }
}

const result = runStructuredAiHarness()
const failed = result.failures.length
origLog(`[structured-ai-harness] ${result.cases.length} cases, ${failed} failed`)
origLog(formatHarnessDiffs(result))
process.exit(failed > 0 ? 1 : 0)
