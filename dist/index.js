/**
 * dsh-boolean — boolean algebra toolbox for DeepSeek Harness.
 *
 * Five pure-logic tools, zero runtime dependencies:
 *   truth_table    — full truth table + minterm/maxterm summary + canonical DNF/CNF
 *   logic_eval     — evaluate an expression under one complete assignment
 *   logic_equiv    — equivalence check of two expressions over all rows
 *   logic_convert  — canonical conversion: nnf / dnf / cnf / nand / nor
 *   logic_minimize — minimum sum-of-products (Quine–McCluskey, optional don't-cares)
 *
 * All computation is local and deterministic; no network, no processes, no eval.
 *
 * @module dsh-boolean
 */
import z from '@deepseek-ai/schemastery';
import { buildBooleanTools } from "./tools.js";
/** Stable Cordis plugin name (also the config key under `plugins:`). */
export const name = 'dsh-boolean';
/** Services required before tool registration can start. */
export const inject = ['agents', 'tools'];
export const Config = z.object({
    maxTableVars: z.number().step(1).min(4).max(10).default(8),
});
/** Resolve loader config into the effective runtime config. */
export function resolveConfig(config) {
    return {
        maxTableVars: config.maxTableVars ?? 8,
    };
}
/** Register every boolean tool on one agent; returns the disposer. */
function decorate(agent, tools) {
    const disposers = Object.values(tools).map((definition) => agent.ctx.tools.register(definition));
    return () => {
        for (const dispose of disposers) {
            try {
                dispose();
            }
            catch {
                // already disposed
            }
        }
    };
}
/** Mount the boolean tools on every live agent and every future one. */
export function apply(ctx, config) {
    void config;
    const tools = buildBooleanTools();
    const disposers = new Set();
    const decorateAgent = (agent) => {
        try {
            disposers.add(decorate(agent, tools));
        }
        catch (error) {
            ctx.logger('boolean').warn(`tool registration for agent ${agent.id} failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    };
    for (const agent of ctx.agents.list())
        decorateAgent(agent);
    const off = ctx.on('agent/created', ({ agent }) => decorateAgent(agent));
    ctx.effect(() => () => {
        off();
        for (const dispose of disposers) {
            try {
                dispose();
            }
            catch {
                // already disposed
            }
        }
        disposers.clear();
    });
}
//# sourceMappingURL=index.js.map