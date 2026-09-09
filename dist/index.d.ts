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
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
/** Stable Cordis plugin name (also the config key under `plugins:`). */
export declare const name = "dsh-boolean";
/** Services required before tool registration can start. */
export declare const inject: string[];
/** Plugin configuration (no options today; reserved for future limits). */
export interface Config {
    maxTableVars?: number;
}
export declare const Config: z<Config>;
/** Config with every default resolved (all fields guaranteed). */
export interface ResolvedConfig {
    maxTableVars: number;
}
/** Resolve loader config into the effective runtime config. */
export declare function resolveConfig(config: Config): ResolvedConfig;
/** Mount the boolean tools on every live agent and every future one. */
export declare function apply(ctx: Context, config: Config): void;
//# sourceMappingURL=index.d.ts.map