/**
 * Tool definitions for dsh-boolean: four boolean-algebra tools via defineTool.
 *   truth_table   — full truth table + minterm/maxterm summary + canonical DNF/CNF
 *   logic_eval    — evaluate an expression under one complete assignment
 *   logic_equiv   — equivalence check of two expressions over all rows
 *   logic_convert — canonical conversion: nnf / dnf / cnf / nand / nor
 *
 * @module dsh-boolean/tools
 */
import { type ToolDefinition } from '@deepseek-ai/dsh-tools';
export interface ToolSet {
    truth_table: ToolDefinition;
    logic_eval: ToolDefinition;
    logic_equiv: ToolDefinition;
    logic_convert: ToolDefinition;
}
export type ConvertOp = 'nnf' | 'dnf' | 'cnf' | 'nand' | 'nor';
/** Build all four boolean tool definitions. */
export declare function buildBooleanTools(): ToolSet;
//# sourceMappingURL=tools.d.ts.map