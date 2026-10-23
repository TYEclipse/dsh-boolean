/**
 * Karnaugh-map layout for dsh-boolean (v0.3.0).
 *
 * The map is a *presentation* of the same function `logic_minimize` reasons
 * about: cells sit at the intersection of two Gray-coded axes, so any two
 * neighbouring cells (edges wrap around) differ in exactly one variable —
 * which is what makes a group of adjacent 1s collapse into one product term.
 *
 * Layout by variable count (variables are read in the plugin's usual order,
 * vars[0] first / most significant):
 *
 *   1 variable  → 1 row × 2 columns
 *   2 variables → 1 row × 2 columns on the second variable
 *   3 variables → 1 row of 2 (a) × 4 columns (b,c)
 *   4 variables → 2 rows (a,b) × 4 columns (c,d)
 *
 * Groups are the prime implicants that actually appear in the minimal cover,
 * mapped back to cell coordinates, so the output is literally "what you would
 * circle on paper" — including the ones that wrap around an edge.
 *
 * Pure local computation: no network, no processes, no eval.
 *
 * @module dsh-boolean/kmap
 */
import type { Implicant } from './minimize.ts';
/** Cell content: a mandatory 1, an optional (don't-care) 1, or a 0. */
export type KmapValue = '0' | '1' | 'x';
export interface KmapCell {
    /** Minterm index (same numbering as truth_table: vars[0] is the MSB). */
    minterm: number;
    value: KmapValue;
}
export interface KmapRow {
    /** Gray-code label of the row, e.g. `01`; empty when the map has no row variable. */
    label: string;
    cells: KmapCell[];
}
export interface KmapGroupCell {
    row: number;
    col: number;
    minterm: number;
}
export interface KmapGroup {
    /** Product term, e.g. `a & !b` (`1` for the all-free cube). */
    term: string;
    signature: string;
    literals: number;
    /** True when the term is an essential prime implicant of the function. */
    essential: boolean;
    /** Every cell this term covers, in row-major map order (don't-care cells included). */
    cells: KmapGroupCell[];
    /** True when the group is not a contiguous block — it wraps around an edge. */
    wraps: boolean;
}
export interface KmapLayout {
    rowVars: string[];
    colVars: string[];
    /** Gray-code labels of the columns, left to right. */
    columnLabels: string[];
    rows: KmapRow[];
    groups: KmapGroup[];
}
/** Largest map this module lays out; 5+ variable maps are not readable on a terminal grid. */
export declare const MAX_KMAP_VARS = 4;
/**
 * The Gray-code sequence used along one axis: successive entries differ in one
 * bit, and so do the first and last (which is why map edges wrap).
 */
export declare function grayCodes(bits: number): number[];
/** Zero-padded binary label of a value over `bits` positions. */
export declare function bitLabel(value: number, bits: number): string;
/** Axis assignment for a variable count as `{rowVars, colVars}` counts. */
export declare function axisSplit(nVars: number): {
    rowVars: number;
    colVars: number;
};
/**
 * Lay out a K-map for `vars`, marking each cell from the on-set and don't-care
 * set, and placing the given cover terms on it.
 *
 * @param vars variable names, vars[0] first (most significant), 1–4 entries
 * @param on minterms that are 1
 * @param dc don't-care minterms
 * @param cover implicants forming the minimal cover (empty for a contradiction)
 */
export declare function kmapLayout(vars: readonly string[], on: readonly number[], dc: readonly number[], cover: readonly Implicant[], essentials?: readonly string[]): KmapLayout;
/** Human-readable map plus the cover, for the tool's text rendering. */
export declare function renderKmapText(layout: KmapLayout, expr: string, minimal: string): string;
//# sourceMappingURL=kmap.d.ts.map