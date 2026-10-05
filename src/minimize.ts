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
  value: number
  mask: number
}

/** One prime implicant with its rendering, cost and covered minterms. */
export interface Implicant {
  /** Product term, e.g. `a & !b` (`1` for the all-free cube). */
  term: string
  /** Stable pattern signature: `1` fixed true, `0` fixed false, `-` free. */
  signature: string
  /** Number of literals (free variables are not literals). */
  literals: number
  /** On-set minterms covered by this implicant, ascending. */
  covers: number[]
  /** Don't-care minterms covered by this implicant, ascending. */
  coversDontCare: number[]
}

export interface MinimizeOutcome {
  /** Every prime implicant, ordered by (literals, signature). */
  implicants: Implicant[]
  /** Terms of the essential prime implicants, in implicant order. */
  essentials: string[]
  /** Minimal cover as a sum-of-products string; `''` for a contradiction, `1` for a constant true cover. */
  minimal: string
  /** Number of product terms in `minimal`. */
  termCount: number
  /** Number of literals in `minimal`. */
  literalCount: number
  /** True when the search completed, so the cover is proven minimum. */
  exact: boolean
  /** True when exactly one minimum cover exists (meaningful only when `exact`). */
  unique: boolean
  /** Set when the result needs an explanation (contradiction / tautology / budget). */
  note?: string
}

export interface MinimizeOptions {
  /** Search node budget; exceeding it degrades to essentials + greedy (default 300000). */
  nodeBudget?: number
}

export const DEFAULT_NODE_BUDGET = 300000

function bitFor(nVars: number, index: number): number {
  return 1 << (nVars - 1 - index)
}

/** Signature of a cube: `1`/`0`/`-` per variable in order. */
export function signatureOf(cube: Cube, nVars: number): string {
  let out = ''
  for (let i = 0; i < nVars; i += 1) {
    const bit = bitFor(nVars, i)
    if ((cube.mask & bit) !== 0) out += '-'
    else if ((cube.value & bit) !== 0) out += '1'
    else out += '0'
  }
  return out
}

/** Product-term rendering; the all-free cube renders as `1`. */
export function termOf(cube: Cube, vars: readonly string[]): string {
  const parts: string[] = []
  for (let i = 0; i < vars.length; i += 1) {
    const bit = bitFor(vars.length, i)
    if ((cube.mask & bit) !== 0) continue
    const name = vars[i] as string
    parts.push((cube.value & bit) !== 0 ? name : `!${name}`)
  }
  return parts.length === 0 ? '1' : parts.join(' & ')
}

/** Every minterm index the cube covers, ascending. */
function mintermsOf(cube: Cube, nVars: number): number[] {
  const out: number[] = []
  const total = 2 ** nVars
  for (let m = 0; m < total; m += 1) {
    if ((m & ~cube.mask) === (cube.value & ~cube.mask)) out.push(m)
  }
  return out
}

/** Keep the value/mask invariant: a free variable is never marked fixed. */
function normalizeCube(value: number, mask: number): Cube {
  return { value: value & ~mask, mask }
}

interface RawImplicant {
  term: string
  signature: string
  literals: number
  /** On-set minterms this implicant covers (index-aligned booleans). */
  onMask: boolean[]
  covers: number[]
  coversDontCare: number[]
}

function compareImplicants(a: RawImplicant, b: RawImplicant): number {
  if (a.literals !== b.literals) return a.literals - b.literals
  return compareKeys(sortKeyOf(a.signature), sortKeyOf(b.signature))
}

/**
 * Ordering key for a signature: free positions sort after fixed ones, so terms
 * read in variable order (`a & b` before `a & c` before `b & c`).
 */
function sortKeyOf(signature: string): string {
  return signature.replace(/-/g, '2')
}

function compareKeys(a: string, b: string): number {
  if (a < b) return -1
  if (a > b) return 1
  return 0
}

/**
 * Reduce a boolean function to a minimum sum of products.
 *
 * @param vars variable names, ordered as in the rest of the plugin (vars[0] = MSB)
 * @param on on-set minterms (must be 1); duplicates and out-of-range values are ignored
 * @param dc don't-care minterms (may be 0 or 1); overlap with `on` is harmless
 */
export function minimizeFunction(
  vars: readonly string[],
  on: readonly number[],
  dc: readonly number[],
  options: MinimizeOptions = {},
): MinimizeOutcome {
  const nVars = vars.length
  const total = 2 ** nVars
  const onMask: boolean[] = new Array(total).fill(false)
  const dcMask: boolean[] = new Array(total).fill(false)
  for (const m of on) if (m >= 0 && m < total) onMask[m] = true
  for (const m of dc) if (m >= 0 && m < total) dcMask[m] = true
  const onCount = onMask.filter(Boolean).length
  const careMask = onMask.map((v, i) => v || (dcMask[i] as boolean))
  const budget = options.nodeBudget === undefined ? DEFAULT_NODE_BUDGET : options.nodeBudget

  /** 1) every valid cube, keyed by `mask * total + value`. */
  const valid = new Set<number>()
  const packKey = (mask: number, value: number): number => mask * total + value
  for (let mask = 0; mask < total; mask += 1) {
    const free = ~mask & (total - 1)
    for (let sub = free; ; sub = (sub - 1) & free) {
      const cube = normalizeCube(sub, mask)
      let ok = true
      for (const m of mintermsOf(cube, nVars)) {
        if (!(careMask[m] as boolean)) {
          ok = false
          break
        }
      }
      if (ok) valid.add(packKey(cube.mask, cube.value))
      if (sub === 0) break
    }
  }

  /** 2) prime implicants: valid cubes with no valid one-bit enlargement. */
  const raw: RawImplicant[] = []
  for (const packed of valid) {
    const mask = Math.floor(packed / total)
    const value = packed % total
    let prime = true
    for (let i = 0; i < nVars; i += 1) {
      const bit = bitFor(nVars, i)
      if ((mask & bit) !== 0) continue
      const bigger = normalizeCube(value, mask | bit)
      if (valid.has(packKey(bigger.mask, bigger.value))) {
        prime = false
        break
      }
    }
    if (!prime) continue
    const cube: Cube = { value, mask }
    const covered = mintermsOf(cube, nVars)
    const inCube: boolean[] = new Array(total).fill(false)
    for (const m of covered) inCube[m] = true
    raw.push({
      term: termOf(cube, vars),
      signature: signatureOf(cube, nVars),
      literals: nVars - popcount(mask, nVars),
      onMask: inCube.map((v, i) => v && (onMask[i] as boolean)),
      covers: covered.filter((m) => onMask[m] as boolean),
      coversDontCare: covered.filter((m) => dcMask[m] as boolean),
    })
  }
  raw.sort(compareImplicants)
  const toInfo = (item: RawImplicant): Implicant => ({
    term: item.term,
    signature: item.signature,
    literals: item.literals,
    covers: item.covers,
    coversDontCare: item.coversDontCare,
  })

  /** 3) essential prime implicants: the only prime implicant covering some on-minterm. */
  const essentialIdx: number[] = []
  for (let m = 0; m < total; m += 1) {
    if (!(onMask[m] as boolean)) continue
    const covering = raw.map((item, i) => ((item.onMask[m] as boolean) ? i : -1)).filter((i) => i >= 0)
    if (covering.length === 1) {
      const only = covering[0] as number
      if (!essentialIdx.includes(only)) essentialIdx.push(only)
    }
  }
  essentialIdx.sort((a, b) => a - b)
  const essentialSigs = essentialIdx.map((i) => (raw[i] as RawImplicant).signature)

  const candidates = raw.map((_, i) => i).filter((i) => !essentialIdx.includes(i))
  const coveredByEssentials: boolean[] = new Array(total).fill(false)
  for (const i of essentialIdx) {
    const item = raw[i] as RawImplicant
    for (let m = 0; m < total; m += 1) if (item.onMask[m] as boolean) coveredByEssentials[m] = true
  }
  const candidatesFor: number[][] = []
  for (let m = 0; m < total; m += 1) {
    candidatesFor.push(candidates.filter((i) => (raw[i] as RawImplicant).onMask[m] as boolean))
  }

  let nodes = 0
  let hitBudget = false
  let bestTerms = Number.POSITIVE_INFINITY
  let bestLiterals = Number.POSITIVE_INFINITY
  let bestSigs: string[] = []
  const minimumKeys = new Set<string>()

  const record = (sigs: string[], literals: number): void => {
    const sorted = [...essentialSigs, ...sigs].sort((a, b) => compareKeys(sortKeyOf(a), sortKeyOf(b)))
    const terms = sorted.length
    const sigKey = sorted.map(sortKeyOf).join('|')
    if (terms < bestTerms || (terms === bestTerms && literals < bestLiterals)) {
      bestTerms = terms
      bestLiterals = literals
      bestSigs = sorted
      minimumKeys.clear()
      minimumKeys.add(sigKey)
      return
    }
    if (terms === bestTerms && literals === bestLiterals) minimumKeys.add(sigKey)
  }

  const uncovered: boolean[] = new Array(total).fill(false)
  let remainingCount = 0
  for (let m = 0; m < total; m += 1) {
    if ((onMask[m] as boolean) && !(coveredByEssentials[m] as boolean)) {
      uncovered[m] = true
      remainingCount += 1
    }
  }

  const chosen: number[] = []
  let chosenLiterals = essentialIdx.reduce((sum, i) => sum + (raw[i] as RawImplicant).literals, 0)
  const dfs = (state: boolean[], remaining: number): void => {
    if (hitBudget) return
    nodes += 1
    if (nodes > budget) {
      hitBudget = true
      return
    }
    if (remaining === 0) {
      record(chosen.map((i) => (raw[i] as RawImplicant).signature), chosenLiterals)
      return
    }
    if (chosen.length >= bestTerms) return
    let pick = -1
    let pickCount = Number.POSITIVE_INFINITY
    for (let m = 0; m < total; m += 1) {
      if (!(state[m] as boolean)) continue
      const count = (candidatesFor[m] as number[]).length
      if (count < pickCount) {
        pickCount = count
        pick = m
        if (count === 1) break
      }
    }
    for (const i of candidatesFor[pick] as number[]) {
      const item = raw[i] as RawImplicant
      const next = [...state]
      let removed = 0
      for (let m = 0; m < total; m += 1) {
        if ((next[m] as boolean) && (item.onMask[m] as boolean)) {
          next[m] = false
          removed += 1
        }
      }
      chosen.push(i)
      chosenLiterals += item.literals
      dfs(next, remaining - removed)
      chosenLiterals -= item.literals
      chosen.pop()
      if (hitBudget) return
    }
  }
  dfs(uncovered, remainingCount)

  const notes: string[] = []
  let sigsOut = bestSigs
  let literalsOut = bestLiterals
  if (onCount === 0) {
    notes.push('the function is false on every row, so its minimal DNF is empty')
  } else if (bestTerms === 1 && (bestSigs[0] ?? '') === '-'.repeat(nVars)) {
    notes.push('the minimal cover is the constant 1: every on-minterm is covered by the all-free term')
  }
  if (hitBudget) {
    const greedy = greedyCover(raw, candidates, uncovered)
    sigsOut = [...essentialSigs, ...greedy.sigs].sort((a, b) => compareKeys(sortKeyOf(a), sortKeyOf(b)))
    literalsOut = greedy.literals + essentialIdx.reduce((sum, i) => sum + (raw[i] as RawImplicant).literals, 0)
    notes.push(
      `search budget reached (${budget} nodes): the returned cover is the best found (essentials + greedy), not proven minimal`,
    )
  }
  const termBySig = new Map(raw.map((item) => [item.signature, item.term]))
  const minimal = sigsOut.map((sig) => termBySig.get(sig) ?? sig).join(' | ')
  const out: MinimizeOutcome = {
    implicants: raw.map(toInfo),
    essentials: essentialIdx.map((i) => (raw[i] as RawImplicant).term),
    minimal,
    termCount: sigsOut.length,
    literalCount: literalsOut,
    exact: !hitBudget,
    unique: !hitBudget && minimumKeys.size === 1,
  }
  if (notes.length > 0) out.note = notes.join('; ')
  return out
}

/** Essentials-plus-greedy fallback, used only when the exact search hits its node budget. */
function greedyCover(
  raw: readonly RawImplicant[],
  candidates: readonly number[],
  uncovered: readonly boolean[],
): { sigs: string[]; literals: number } {
  const state = [...uncovered]
  const sigs: string[] = []
  let literals = 0
  for (;;) {
    if (!state.some(Boolean)) break
    let best = -1
    let bestGain = -1
    for (const i of candidates) {
      const item = raw[i] as RawImplicant
      let gain = 0
      for (let m = 0; m < state.length; m += 1) {
        if ((state[m] as boolean) && (item.onMask[m] as boolean)) gain += 1
      }
      if (gain === 0) continue
      if (
        gain > bestGain
        || (gain === bestGain && best >= 0 && item.literals < (raw[best] as RawImplicant).literals)
      ) {
        best = i
        bestGain = gain
      }
    }
    if (best < 0) break
    const item = raw[best] as RawImplicant
    sigs.push(item.signature)
    literals += item.literals
    for (let m = 0; m < state.length; m += 1) {
      if ((state[m] as boolean) && (item.onMask[m] as boolean)) state[m] = false
    }
  }
  return { sigs, literals }
}

function popcount(value: number, nVars: number): number {
  let count = 0
  for (let i = 0; i < nVars; i += 1) if ((value & bitFor(nVars, i)) !== 0) count += 1
  return count
}
