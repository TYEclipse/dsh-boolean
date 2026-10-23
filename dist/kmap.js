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
/** Which axis each variable goes to: `[rowVars, colVars]` counts by variable count. */
const AXES = {
    1: [0, 1],
    2: [1, 1],
    3: [1, 2],
    4: [2, 2],
};
/** Largest map this module lays out; 5+ variable maps are not readable on a terminal grid. */
export const MAX_KMAP_VARS = 4;
/**
 * The Gray-code sequence used along one axis: successive entries differ in one
 * bit, and so do the first and last (which is why map edges wrap).
 */
export function grayCodes(bits) {
    const out = [];
    const total = 1 << bits;
    for (let i = 0; i < total; i += 1)
        out.push(i ^ (i >> 1));
    return out;
}
/** Zero-padded binary label of a value over `bits` positions. */
export function bitLabel(value, bits) {
    if (bits === 0)
        return '';
    return value.toString(2).padStart(bits, '0');
}
/** Axis assignment for a variable count as `{rowVars, colVars}` counts. */
export function axisSplit(nVars) {
    const axes = AXES[nVars];
    if (axes === undefined)
        throw new RangeError(`no Karnaugh-map axes for ${nVars} variable(s)`);
    return { rowVars: axes[0], colVars: axes[1] };
}
function bitsOf(minterm, nVars) {
    const out = [];
    for (let i = 0; i < nVars; i += 1)
        out.push((minterm >> (nVars - 1 - i)) & 1);
    return out;
}
function isContiguous(values) {
    const distinct = [...new Set(values)].sort((a, b) => a - b);
    if (distinct.length <= 1)
        return true;
    return distinct[distinct.length - 1] - distinct[0] + 1 === distinct.length;
}
/**
 * Lay out a K-map for `vars`, marking each cell from the on-set and don't-care
 * set, and placing the given cover terms on it.
 *
 * @param vars variable names, vars[0] first (most significant), 1–4 entries
 * @param on minterms that are 1
 * @param dc don't-care minterms
 * @param cover implicants forming the minimal cover (empty for a contradiction)
 */
export function kmapLayout(vars, on, dc, cover, essentials = []) {
    const nVars = vars.length;
    const axes = AXES[nVars];
    if (axes === undefined)
        throw new RangeError(`no Karnaugh-map layout for ${nVars} variable(s)`);
    const [nRowVars, nColVars] = axes;
    const rowVars = vars.slice(0, nRowVars);
    const colVars = vars.slice(nRowVars);
    const total = 2 ** nVars;
    const onSet = new Set(on.filter((m) => m >= 0 && m < total));
    const dcSet = new Set(dc.filter((m) => m >= 0 && m < total && !onSet.has(m)));
    const rowCodes = grayCodes(nRowVars);
    const colCodes = grayCodes(nColVars);
    const rowIndex = new Map();
    const colIndex = new Map();
    rowCodes.forEach((code, i) => rowIndex.set(code, i));
    colCodes.forEach((code, i) => colIndex.set(code, i));
    const rows = rowCodes.map((rowCode) => {
        const cells = colCodes.map((colCode) => {
            const minterm = (rowCode << nColVars) | colCode;
            const value = onSet.has(minterm) ? '1' : dcSet.has(minterm) ? 'x' : '0';
            return { minterm, value };
        });
        return { label: bitLabel(rowCode, nRowVars), cells };
    });
    const cellOf = (minterm) => {
        const bits = bitsOf(minterm, nVars);
        const rowBits = bits.slice(0, nRowVars).reduce((acc, bit) => (acc << 1) | bit, 0);
        const colBits = bits.slice(nRowVars).reduce((acc, bit) => (acc << 1) | bit, 0);
        return {
            row: rowIndex.get(rowBits) ?? 0,
            col: colIndex.get(colBits) ?? 0,
            minterm,
        };
    };
    const groups = cover.map((item) => {
        const cells = [];
        for (let m = 0; m < total; m += 1) {
            let inside = true;
            for (let i = 0; i < nVars; i += 1) {
                if (item.signature[i] === '-')
                    continue;
                const bit = (m >> (nVars - 1 - i)) & 1;
                if ((item.signature[i] === '1' ? 1 : 0) !== bit) {
                    inside = false;
                    break;
                }
            }
            if (inside)
                cells.push(cellOf(m));
        }
        const rowSpan = isContiguous(cells.map((c) => c.row));
        const colSpan = isContiguous(cells.map((c) => c.col));
        return {
            term: item.term,
            signature: item.signature,
            literals: item.literals,
            essential: essentials.includes(item.term),
            cells,
            wraps: !rowSpan || !colSpan,
        };
    });
    return { rowVars, colVars, columnLabels: colCodes.map((code) => bitLabel(code, nColVars)), rows, groups };
}
/** Human-readable map plus the cover, for the tool's text rendering. */
export function renderKmapText(layout, expr, minimal) {
    const nVars = layout.rowVars.length + layout.colVars.length;
    const axisText = `rows ${layout.rowVars.length === 0 ? '(none)' : layout.rowVars.join(', ')}`
        + ` | cols ${layout.colVars.length === 0 ? '(none)' : layout.colVars.join(', ')}`;
    const lines = [];
    lines.push(`K-map of ${expr} over ${nVars} variable(s) (${axisText})`);
    const labelWidth = Math.max(layout.rowVars.length, 1);
    const colHeader = layout.columnLabels.length === 0 ? '' : layout.columnLabels.map((l) => l.padStart(2)).join(' ');
    lines.push(`${' '.repeat(labelWidth + 3)}${colHeader}`);
    for (const row of layout.rows) {
        const cells = row.cells.map((cell) => cell.value.padStart(2)).join(' ');
        lines.push(`${row.label.padEnd(labelWidth)} | ${cells}`);
    }
    const coverText = minimal.length === 0 ? '(empty: the function is false on every row)' : minimal;
    lines.push(`minimal cover: ${coverText}`);
    for (const group of layout.groups) {
        const where = group.cells.map((c) => `r${c.row}c${c.col}(m${c.minterm})`).join(' ');
        const flags = [group.essential ? 'essential' : 'chosen', group.wraps ? 'wraps an edge' : 'contiguous'];
        lines.push(`  ${group.term}: ${group.cells.length} cell(s) — ${where} [${flags.join(', ')}]`);
    }
    return lines.join('\n');
}
//# sourceMappingURL=kmap.js.map