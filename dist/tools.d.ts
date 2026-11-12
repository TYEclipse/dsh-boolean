/**
 * Tool definitions for dsh-boolean: seven boolean-algebra tools via defineTool.
 *   truth_table        — full truth table + minterm/maxterm summary + canonical DNF/CNF
 *   logic_eval         — evaluate an expression under one complete assignment
 *   logic_equiv        — equivalence check of two expressions over all rows
 *   logic_convert      — canonical conversion: nnf / dnf / cnf / nand / nor
 *   logic_minimize     — minimum sum-of-products (Quine–McCluskey), with don't-cares
 *   logic_minimize_pos — minimum product-of-sums (the same engine on the complement)
 *   logic_kmap         — Karnaugh-map layout of a function plus the cells each cover term circles
 *
 * @module dsh-boolean/tools
 */
import { type ToolDefinition } from '@deepseek-ai/dsh-tools';
export interface ToolSet {
    truth_table: ToolDefinition;
    logic_eval: ToolDefinition;
    logic_equiv: ToolDefinition;
    logic_convert: ToolDefinition;
    logic_minimize: ToolDefinition;
    logic_minimize_pos: ToolDefinition;
    logic_kmap: ToolDefinition;
}
export type ConvertOp = 'nnf' | 'dnf' | 'cnf' | 'nand' | 'nor';
/** Build all seven boolean tool definitions. */
export declare function buildBooleanTools(): ToolSet;
//# sourceMappingURL=tools.d.ts.map