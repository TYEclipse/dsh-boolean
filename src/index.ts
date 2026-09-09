/**
 * dsh-boolean — boolean algebra toolbox for DeepSeek Harness.
 *
 * Four pure-logic tools, zero runtime dependencies:
 *   truth_table   — full truth table + minterm/maxterm summary + canonical DNF/CNF
 *   logic_eval    — evaluate an expression under one complete assignment
 *   logic_equiv   — equivalence check of two expressions over all rows
 *   logic_convert — canonical conversion: nnf / dnf / cnf / nand / nor
 *
 * All computation is local and deterministic; no network, no processes, no eval.
 *
 * @module dsh-boolean
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import z from '@deepseek-ai/schemastery'
import { buildBooleanTools, type ToolSet } from './tools.ts'

/** Stable Cordis plugin name (also the config key under `plugins:`). */
export const name = 'dsh-boolean'

/** Services required before tool registration can start. */
export const inject = ['agents', 'tools']

/** Plugin configuration (no options today; reserved for future limits). */
export interface Config {
  maxTableVars?: number
}

export const Config: z<Config> = z.object({
  maxTableVars: z.number().step(1).min(4).max(10).default(8),
})

/** Config with every default resolved (all fields guaranteed). */
export interface ResolvedConfig {
  maxTableVars: number
}

/** Resolve loader config into the effective runtime config. */
export function resolveConfig(config: Config): ResolvedConfig {
  return {
    maxTableVars: config.maxTableVars ?? 8,
  }
}

/** Register every boolean tool on one agent; returns the disposer. */
function decorate(agent: Agent, tools: ToolSet): () => void {
  const disposers = Object.values(tools).map((definition) => agent.ctx.tools.register(definition))
  return () => {
    for (const dispose of disposers) {
      try {
        dispose()
      } catch {
        // already disposed
      }
    }
  }
}

/** Mount the boolean tools on every live agent and every future one. */
export function apply(ctx: Context, config: Config): void {
  void config
  const tools = buildBooleanTools()
  const disposers = new Set<() => void>()

  const decorateAgent = (agent: Agent): void => {
    try {
      disposers.add(decorate(agent, tools))
    } catch (error) {
      ctx.logger('boolean').warn(`tool registration for agent ${agent.id} failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  for (const agent of ctx.agents.list()) decorateAgent(agent)
  const off = ctx.on('agent/created', ({ agent }) => decorateAgent(agent))

  ctx.effect(() => () => {
    off()
    for (const dispose of disposers) {
      try {
        dispose()
      } catch {
        // already disposed
      }
    }
    disposers.clear()
  })
}
