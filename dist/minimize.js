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
export const DEFAULT_NODE_BUDGET = 300000;
function bitFor(nVars, index) {
    return 1 << (nVars - 1 - index);
}
/** Signature of a cube: `1`/`0`/`-` per variable in order. */
export function signatureOf(cube, nVars) {
    let out = '';
    for (let i = 0; i < nVars; i += 1) {
        const bit = bitFor(nVars, i);
        if ((cube.mask & bit) !== 0)
            out += '-';
        else if ((cube.value & bit) !== 0)
            out += '1';
        else
            out += '0';
    }
    return out;
}
/** Product-term rendering; the all-free cube renders as `1`. */
export function termOf(cube, vars) {
    const parts = [];
    for (let i = 0; i < vars.length; i += 1) {
        const bit = bitFor(vars.length, i);
        if ((cube.mask & bit) !== 0)
            continue;
        const name = vars[i];
        parts.push((cube.value & bit) !== 0 ? name : `!${name}`);
    }
    return parts.length === 0 ? '1' : parts.join(' & ');
}
/** Every minterm index the cube covers, ascending. */
function mintermsOf(cube, nVars) {
    const out = [];
    const total = 2 ** nVars;
    for (let m = 0; m < total; m += 1) {
        if ((m & ~cube.mask) === (cube.value & ~cube.mask))
            out.push(m);
    }
    return out;
}
/** Keep the value/mask invariant: a free variable is never marked fixed. */
function normalizeCube(value, mask) {
    return { value: value & ~mask, mask };
}
function compareImplicants(a, b) {
    if (a.literals !== b.literals)
        return a.literals - b.literals;
    return compareKeys(sortKeyOf(a.signature), sortKeyOf(b.signature));
}
/**
 * Ordering key for a signature: free positions sort after fixed ones, so terms
 * read in variable order (`a & b` before `a & c` before `b & c`).
 */
function sortKeyOf(signature) {
    return signature.replace(/-/g, '2');
}
function compareKeys(a, b) {
    if (a < b)
        return -1;
    if (a > b)
        return 1;
    return 0;
}
/**
 * Reduce a boolean function to a minimum sum of products.
 *
 * @param vars variable names, ordered as in the rest of the plugin (vars[0] = MSB)
 * @param on on-set minterms (must be 1); duplicates and out-of-range values are ignored
 * @param dc don't-care minterms (may be 0 or 1); overlap with `on` is harmless
 */
export function minimizeFunction(vars, on, dc, options = {}) {
    const nVars = vars.length;
    const total = 2 ** nVars;
    const onMask = new Array(total).fill(false);
    const dcMask = new Array(total).fill(false);
    for (const m of on)
        if (m >= 0 && m < total)
            onMask[m] = true;
    for (const m of dc)
        if (m >= 0 && m < total)
            dcMask[m] = true;
    const onCount = onMask.filter(Boolean).length;
    const careMask = onMask.map((v, i) => v || dcMask[i]);
    const budget = options.nodeBudget === undefined ? DEFAULT_NODE_BUDGET : options.nodeBudget;
    /** 1) every valid cube, keyed by `mask * total + value`. */
    const valid = new Set();
    const packKey = (mask, value) => mask * total + value;
    for (let mask = 0; mask < total; mask += 1) {
        const free = ~mask & (total - 1);
        for (let sub = free;; sub = (sub - 1) & free) {
            const cube = normalizeCube(sub, mask);
            let ok = true;
            for (const m of mintermsOf(cube, nVars)) {
                if (!careMask[m]) {
                    ok = false;
                    break;
                }
            }
            if (ok)
                valid.add(packKey(cube.mask, cube.value));
            if (sub === 0)
                break;
        }
    }
    /** 2) prime implicants: valid cubes with no valid one-bit enlargement. */
    const raw = [];
    for (const packed of valid) {
        const mask = Math.floor(packed / total);
        const value = packed % total;
        let prime = true;
        for (let i = 0; i < nVars; i += 1) {
            const bit = bitFor(nVars, i);
            if ((mask & bit) !== 0)
                continue;
            const bigger = normalizeCube(value, mask | bit);
            if (valid.has(packKey(bigger.mask, bigger.value))) {
                prime = false;
                break;
            }
        }
        if (!prime)
            continue;
        const cube = { value, mask };
        const covered = mintermsOf(cube, nVars);
        const inCube = new Array(total).fill(false);
        for (const m of covered)
            inCube[m] = true;
        raw.push({
            term: termOf(cube, vars),
            signature: signatureOf(cube, nVars),
            literals: nVars - popcount(mask, nVars),
            onMask: inCube.map((v, i) => v && onMask[i]),
            covers: covered.filter((m) => onMask[m]),
            coversDontCare: covered.filter((m) => dcMask[m]),
        });
    }
    raw.sort(compareImplicants);
    const toInfo = (item) => ({
        term: item.term,
        signature: item.signature,
        literals: item.literals,
        covers: item.covers,
        coversDontCare: item.coversDontCare,
    });
    /** 3) essential prime implicants: the only prime implicant covering some on-minterm. */
    const essentialIdx = [];
    for (let m = 0; m < total; m += 1) {
        if (!onMask[m])
            continue;
        const covering = raw.map((item, i) => (item.onMask[m] ? i : -1)).filter((i) => i >= 0);
        if (covering.length === 1) {
            const only = covering[0];
            if (!essentialIdx.includes(only))
                essentialIdx.push(only);
        }
    }
    essentialIdx.sort((a, b) => a - b);
    const essentialSigs = essentialIdx.map((i) => raw[i].signature);
    const candidates = raw.map((_, i) => i).filter((i) => !essentialIdx.includes(i));
    const coveredByEssentials = new Array(total).fill(false);
    for (const i of essentialIdx) {
        const item = raw[i];
        for (let m = 0; m < total; m += 1)
            if (item.onMask[m])
                coveredByEssentials[m] = true;
    }
    const candidatesFor = [];
    for (let m = 0; m < total; m += 1) {
        candidatesFor.push(candidates.filter((i) => raw[i].onMask[m]));
    }
    let nodes = 0;
    let hitBudget = false;
    let bestTerms = Number.POSITIVE_INFINITY;
    let bestLiterals = Number.POSITIVE_INFINITY;
    let bestSigs = [];
    const minimumKeys = new Set();
    const record = (sigs, literals) => {
        const sorted = [...essentialSigs, ...sigs].sort((a, b) => compareKeys(sortKeyOf(a), sortKeyOf(b)));
        const terms = sorted.length;
        const sigKey = sorted.map(sortKeyOf).join('|');
        if (terms < bestTerms || (terms === bestTerms && literals < bestLiterals)) {
            bestTerms = terms;
            bestLiterals = literals;
            bestSigs = sorted;
            minimumKeys.clear();
            minimumKeys.add(sigKey);
            return;
        }
        if (terms === bestTerms && literals === bestLiterals)
            minimumKeys.add(sigKey);
    };
    const uncovered = new Array(total).fill(false);
    let remainingCount = 0;
    for (let m = 0; m < total; m += 1) {
        if (onMask[m] && !coveredByEssentials[m]) {
            uncovered[m] = true;
            remainingCount += 1;
        }
    }
    const chosen = [];
    let chosenLiterals = essentialIdx.reduce((sum, i) => sum + raw[i].literals, 0);
    const dfs = (state, remaining) => {
        if (hitBudget)
            return;
        nodes += 1;
        if (nodes > budget) {
            hitBudget = true;
            return;
        }
        if (remaining === 0) {
            record(chosen.map((i) => raw[i].signature), chosenLiterals);
            return;
        }
        if (chosen.length >= bestTerms)
            return;
        let pick = -1;
        let pickCount = Number.POSITIVE_INFINITY;
        for (let m = 0; m < total; m += 1) {
            if (!state[m])
                continue;
            const count = candidatesFor[m].length;
            if (count < pickCount) {
                pickCount = count;
                pick = m;
                if (count === 1)
                    break;
            }
        }
        for (const i of candidatesFor[pick]) {
            const item = raw[i];
            const next = [...state];
            let removed = 0;
            for (let m = 0; m < total; m += 1) {
                if (next[m] && item.onMask[m]) {
                    next[m] = false;
                    removed += 1;
                }
            }
            chosen.push(i);
            chosenLiterals += item.literals;
            dfs(next, remaining - removed);
            chosenLiterals -= item.literals;
            chosen.pop();
            if (hitBudget)
                return;
        }
    };
    dfs(uncovered, remainingCount);
    const notes = [];
    let sigsOut = bestSigs;
    let literalsOut = bestLiterals;
    if (onCount === 0) {
        notes.push('the function is false on every row, so its minimal DNF is empty');
    }
    else if (bestTerms === 1 && (bestSigs[0] ?? '') === '-'.repeat(nVars)) {
        notes.push('the minimal cover is the constant 1: every on-minterm is covered by the all-free term');
    }
    if (hitBudget) {
        const greedy = greedyCover(raw, candidates, uncovered);
        sigsOut = [...essentialSigs, ...greedy.sigs].sort((a, b) => compareKeys(sortKeyOf(a), sortKeyOf(b)));
        literalsOut = greedy.literals + essentialIdx.reduce((sum, i) => sum + raw[i].literals, 0);
        notes.push(`search budget reached (${budget} nodes): the returned cover is the best found (essentials + greedy), not proven minimal`);
    }
    const termBySig = new Map(raw.map((item) => [item.signature, item.term]));
    const minimal = sigsOut.map((sig) => termBySig.get(sig) ?? sig).join(' | ');
    const out = {
        implicants: raw.map(toInfo),
        essentials: essentialIdx.map((i) => raw[i].term),
        minimal,
        termCount: sigsOut.length,
        literalCount: literalsOut,
        exact: !hitBudget,
        unique: !hitBudget && minimumKeys.size === 1,
    };
    if (notes.length > 0)
        out.note = notes.join('; ');
    return out;
}
/** Essentials-plus-greedy fallback, used only when the exact search hits its node budget. */
function greedyCover(raw, candidates, uncovered) {
    const state = [...uncovered];
    const sigs = [];
    let literals = 0;
    for (;;) {
        if (!state.some(Boolean))
            break;
        let best = -1;
        let bestGain = -1;
        for (const i of candidates) {
            const item = raw[i];
            let gain = 0;
            for (let m = 0; m < state.length; m += 1) {
                if (state[m] && item.onMask[m])
                    gain += 1;
            }
            if (gain === 0)
                continue;
            if (gain > bestGain
                || (gain === bestGain && best >= 0 && item.literals < raw[best].literals)) {
                best = i;
                bestGain = gain;
            }
        }
        if (best < 0)
            break;
        const item = raw[best];
        sigs.push(item.signature);
        literals += item.literals;
        for (let m = 0; m < state.length; m += 1) {
            if (state[m] && item.onMask[m])
                state[m] = false;
        }
    }
    return { sigs, literals };
}
function popcount(value, nVars) {
    let count = 0;
    for (let i = 0; i < nVars; i += 1)
        if ((value & bitFor(nVars, i)) !== 0)
            count += 1;
    return count;
}
//# sourceMappingURL=minimize.js.map