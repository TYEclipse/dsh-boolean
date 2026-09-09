/**
 * dsh-boolean — boolean algebra engine.
 *
 * Parses propositional-logic expressions over single-letter variables a-z,
 * desugars XOR / IMPLIES / IFF into NOT / AND / OR, and provides:
 *   - truth-table enumeration with minterm / maxterm indices
 *   - evaluation under a full assignment
 *   - canonical DNF / CNF strings (from the table)
 *   - NNF rewriting
 *   - NAND-only / NOR-only gate networks (structural rewrite)
 *
 * Pure local computation: no network, no processes, no eval.
 *
 * Operator syntax (precedence high -> low):
 *   NOT   !  not  ¬        (prefix, tightest)
 *   AND   &  and  ∧
 *   XOR   ^  xor  ⊕        (desugars to (a&!b)|(!a&b))
 *   OR    |  or   ∨
 *   IMPLIES -> => →        (desugars to !a|b)
 *   IFF   <-> <=> ↔        (desugars to (a&b)|(!a&!b), lowest)
 * Binary operators are left-associative; parentheses () group.
 * Variables are single letters a-z (upper case is normalized to lower).
 *
 * @module dsh-boolean/boolean
 */
export type Node = {
    type: 'var';
    name: string;
} | {
    type: 'not';
    operand: Node;
} | {
    type: 'and';
    left: Node;
    right: Node;
} | {
    type: 'or';
    left: Node;
    right: Node;
};
export declare const MAX_TABLE_VARS = 8;
export declare const MAX_EXPR_LENGTH = 512;
export declare class BooleanParseError extends Error {
    readonly position: number;
    constructor(message: string, position: number);
}
/** Parse a boolean expression into a desugared AST (only var/not/and/or). */
export declare function parseExpression(input: string): Node;
/** All distinct variables of an expression, sorted alphabetically. */
export declare function expressionVars(node: Node): string[];
/** Evaluate under a complete assignment. Missing variables throw. */
export declare function evaluate(node: Node, env: ReadonlyMap<string, boolean>): boolean;
export interface TruthRow {
    index: number;
    assignment: Record<string, boolean>;
    result: boolean;
}
export interface TruthTable {
    rows: TruthRow[];
    minterms: number[];
    maxterms: number[];
}
/**
 * Enumerate all 2^n rows over the given (sorted) variables.
 * Row index is the binary number with vars[0] as the most significant bit,
 * matching the conventional minterm numbering (m0 = all false ... m(2^n-1) = all true).
 */
export declare function truthTable(node: Node, vars: readonly string[]): TruthTable;
/** Canonical DNF string from minterm indices over the given vars; '' when there are none. */
export declare function dnfFromMinterms(minterms: readonly number[], vars: readonly string[]): string;
/** Canonical CNF string from maxterm indices over the given vars; '' when there are none. */
export declare function cnfFromMaxterms(maxterms: readonly number[], vars: readonly string[]): string;
/** Negation normal form: push every NOT down to the variables. */
export declare function toNnf(node: Node): Node;
/** Infix rendering with minimal parentheses (only & | ! remain after desugaring). */
export declare function render(node: Node): string;
/** NAND-only network: NOT(x)=NAND(x,x), AND(a,b)=NAND(NAND(a,b),NAND(a,b)), OR(a,b)=NAND(NAND(a,a),NAND(b,b)). */
export declare function nandForm(node: Node): string;
/** NOR-only network: NOT(x)=NOR(x,x), OR(a,b)=NOR(NOR(a,b),NOR(a,b)), AND(a,b)=NOR(NOR(a,a),NOR(b,b)). */
export declare function norForm(node: Node): string;
//# sourceMappingURL=boolean.d.ts.map