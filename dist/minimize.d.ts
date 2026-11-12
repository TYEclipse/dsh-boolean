/**
 * Minimal-cover engine for dsh-boolean (v0.2.0).
 *
 * Given a variable list, an on-set (minterms that must be 1) and a don't-care
 * set (minterms that may be 0 or 1), the engine reduces the function to a
 * minimum sum of products:
 *
 *   1. enumerate every implicant (cube) fully contained in on ∪ dc,
 *   2. keep the prime implicants — valid cubes that no larger valid cube contains,
 *   3. select the essential prime implicants (the only cover of some on-minterm),
 *   4. search the remaining candidates for a minimum cover: primary objective
 *      term count, secondary objective literal count; ties are broken by the
 *      lexicographically smallest term-signature list so the output is stable.
 *
 * Minterm numbering matches the rest of the plugin: vars[0] is the most
 * significant bit, m0 = all false.
 *
 * Pure local computation: no network, no processes, no eval.
 *
 * @module dsh-boolean/minimize
 */
/** A cube: `value` bits are the variables fixed to true, `mask` bits are free. */
export interface Cube {
    value: number;
    mask: number;
}
/** One prime implicant with its rendering, cost and covered minterms. */
export interface Implicant {
    /** Product term, e.g. `a & !b` (`1` for the all-free cube). */
    term: string;
    /** Stable pattern signature: `1` fixed true, `0` fixed false, `-` free. */
    signature: string;
    /** Number of literals (free variables are not literals). */
    literals: number;
    /** On-set minterms covered by this implicant, ascending. */
    covers: number[];
    /** Don't-care minterms covered by this implicant, ascending. */
    coversDontCare: number[];
}
export interface MinimizeOutcome {
    /** Every prime implicant, ordered by (literals, signature). */
    implicants: Implicant[];
    /** The implicants that make up `minimal`, in the order they appear in the answer. */
    selected: Implicant[];
    /** Terms of the essential prime implicants, in implicant order. */
    essentials: string[];
    /** Minimal cover as a sum-of-products string; `''` for a contradiction, `1` for a constant true cover. */
    minimal: string;
    /** Number of product terms in `minimal`. */
    termCount: number;
    /** Number of literals in `minimal`. */
    literalCount: number;
    /** True when the search completed, so the cover is proven minimum. */
    exact: boolean;
    /** True when exactly one minimum cover exists (meaningful only when `exact`). */
    unique: boolean;
    /** Set when the result needs an explanation (contradiction / tautology / budget). */
    note?: string;
}
export interface MinimizeOptions {
    /** Search node budget; exceeding it degrades to essentials + greedy (default 300000). */
    nodeBudget?: number;
}
export declare const DEFAULT_NODE_BUDGET = 300000;
/** Signature of a cube: `1`/`0`/`-` per variable in order. */
export declare function signatureOf(cube: Cube, nVars: number): string;
/** Product-term rendering; the all-free cube renders as `1`. */
export declare function termOf(cube: Cube, vars: readonly string[]): string;
/**
 * Reduce a boolean function to a minimum sum of products.
 *
 * @param vars variable names, ordered as in the rest of the plugin (vars[0] = MSB)
 * @param on on-set minterms (must be 1); duplicates and out-of-range values are ignored
 * @param dc don't-care minterms (may be 0 or 1); overlap with `on` is harmless
 */
export declare function minimizeFunction(vars: readonly string[], on: readonly number[], dc: readonly number[], options?: MinimizeOptions): MinimizeOutcome;
/** One sum term (prime implicate) of a minimum product of sums. */
export interface SumTerm {
    /** Sum of literals, e.g. `a | !b`; `0` for the constant-false term. */
    sum: string;
    /** The cube on which this sum term is false, same `1`/`0`/`-` notation as product terms. */
    signature: string;
    /** Number of literals in the sum. */
    literals: number;
    /** Minterms where the function must be 0, i.e. where this sum term is false. */
    falseOn: number[];
    /** Don't-care minterms this sum term is also false on. */
    falseOnDontCare: number[];
}
export interface PosMinimizeOutcome {
    /** Every prime implicate, ordered by (literals, signature). */
    terms: SumTerm[];
    /** The sum terms that make up `minimal`, in the order they appear in the answer. */
    selected: SumTerm[];
    /** Sum terms of the essential prime implicates, in term order. */
    essentials: string[];
    /** Minimal product of sums; `1` for a tautology, `0` for a contradiction. */
    minimal: string;
    termCount: number;
    literalCount: number;
    exact: boolean;
    unique: boolean;
    note?: string;
}
/** Render the complement of a product cube as a sum of literals (`1` bit → negated). */
export declare function sumTermOf(signature: string, vars: readonly string[]): string;
/** Evaluate a product of sums on one minterm (a sum term is 0 exactly on its cube). */
export declare function evaluatePos(terms: readonly SumTerm[], m: number, nVars: number): boolean;
/**
 * Reduce a boolean function to a minimum product of sums.
 *
 * @param vars variable names, ordered as in the rest of the plugin (vars[0] = MSB)
 * @param zeros minterms where the function must be 0 (the on-set of ¬F)
 * @param dc don't-care minterms (may be 0 or 1); overlap with `zeros` is harmless
 */
export declare function minimizePosFunction(vars: readonly string[], zeros: readonly number[], dc: readonly number[], options?: MinimizeOptions): PosMinimizeOutcome;
//# sourceMappingURL=minimize.d.ts.map