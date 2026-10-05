/**
 * Tests for the minimal-cover engine and the logic_minimize tool:
 * prime implicants, don't-care handling, the minimum-cover search, its
 * deterministic tie-break, the node-budget degradation path, the tool's
 * validation/render/lossless-JSON discipline, and — for every curated case —
 * a semantic re-check that the returned cover agrees with the input expression
 * on every row outside the don't-care set.
 *
 * ORACLE: test/oracle/anchors.py
 *
 * Every expected value below was produced by that oracle, which is an
 * exhaustive set-cover search over all cubes in {0,1,-}^n written in Python and
 * sharing no code with `src/minimize.ts` (`python3 test/oracle/anchors.py`
 * prints them; `--check` re-verifies textbook identities plus these pins).
 */

import { describe, expect, it } from 'vitest'
import { DEFAULT_NODE_BUDGET, minimizeFunction, signatureOf, termOf } from '../src/minimize.ts'
import { buildBooleanTools } from '../src/tools.ts'
import { evaluate, expressionVars, parseExpression, type Node } from '../src/boolean.ts'

type Exec = (args: unknown) => Promise<unknown>

function assertNoUndefined(node: unknown, path = 'root'): void {
  if (node === null) return
  if (Array.isArray(node)) {
    node.forEach((item, i) => assertNoUndefined(item, `${path}[${i}]`))
    return
  }
  if (typeof node === 'object') {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      expect(value, `${path}.${key} must not be undefined`).not.toBeUndefined()
      assertNoUndefined(value, `${path}.${key}`)
    }
  }
}

function envOf(vars: string[], index: number): Map<string, boolean> {
  const env = new Map<string, boolean>()
  vars.forEach((name, i) => env.set(name, ((index >> (vars.length - 1 - i)) & 1) === 1))
  return env
}

/** Evaluate a minimized SOP string ('' = false everywhere, '1' = true everywhere). */
function evalSop(sop: string, vars: string[], index: number): boolean {
  if (sop === '') return false
  if (sop === '1') return true
  return evaluate(parseExpression(sop), envOf(vars, index))
}

interface Case {
  expr: string
  dc: number[]
  minimal: string
  terms: number
  literals: number
  primes: number
  essential: string[]
  unique: boolean
}

/** Curated cases with oracle-produced anchors (see the ORACLE marker above). */
const CASES: Case[] = [
  { expr: 'a & b | a & !b', dc: [], minimal: 'a', terms: 1, literals: 1, primes: 1, essential: ['a'], unique: true },
  {
    expr: '((a & b) | (a & c)) | (b & c)', dc: [],
    minimal: 'a & b | a & c | b & c', terms: 3, literals: 6, primes: 3,
    essential: ['a & b', 'a & c', 'b & c'], unique: true,
  },
  {
    expr: 'a ^ b ^ c', dc: [],
    minimal: '!a & !b & c | !a & b & !c | a & !b & !c | a & b & c', terms: 4, literals: 12, primes: 4,
    essential: ['!a & !b & c', '!a & b & !c', 'a & !b & !c', 'a & b & c'], unique: true,
  },
  {
    expr: 'a & !b & c | a & !b & !c', dc: [6, 7],
    minimal: 'a', terms: 1, literals: 1, primes: 1, essential: ['a'], unique: true,
  },
  {
    expr: 'a & (b | c)', dc: [1, 2],
    minimal: 'a & b | a & c', terms: 2, literals: 4, primes: 4, essential: [], unique: false,
  },
  { expr: 'a & !a', dc: [], minimal: '', terms: 0, literals: 0, primes: 0, essential: [], unique: true },
  { expr: 'a | !a', dc: [], minimal: '1', terms: 1, literals: 0, primes: 1, essential: ['1'], unique: true },
  { expr: 'a & b', dc: [0, 1, 2], minimal: '1', terms: 1, literals: 0, primes: 1, essential: ['1'], unique: true },
  { expr: '!a & !b', dc: [], minimal: '!a & !b', terms: 1, literals: 2, primes: 1, essential: ['!a & !b'], unique: true },
  {
    expr: '(a & b) | (c & d)', dc: [],
    minimal: 'a & b | c & d', terms: 2, literals: 4, primes: 2, essential: ['a & b', 'c & d'], unique: true,
  },
  { expr: 'a & b & c', dc: [4], minimal: 'a & b & c', terms: 1, literals: 3, primes: 2, essential: ['a & b & c'], unique: true },
]

function minimizeOf(name: string, dc: number[]): ReturnType<typeof minimizeFunction> {
  const node: Node = parseExpression(name)
  const vars = expressionVars(node)
  const rows = 2 ** vars.length
  const on: number[] = []
  for (let index = 0; index < rows; index += 1) {
    if (evaluate(node, envOf(vars, index))) on.push(index)
  }
  return minimizeFunction(vars, on, dc)
}

function varsOf(name: string): string[] {
  return expressionVars(parseExpression(name))
}

describe('minimizeFunction: oracle-anchored cases', () => {
  for (const item of CASES) {
    it(`minimizes ${item.expr} (dontCare ${JSON.stringify(item.dc)})`, () => {
      const out = minimizeOf(item.expr, item.dc)
      expect(out.minimal).toBe(item.minimal)
      expect(out.termCount).toBe(item.terms)
      expect(out.literalCount).toBe(item.literals)
      expect(out.implicants.length).toBe(item.primes)
      expect(out.essentials).toEqual(item.essential)
      expect(out.unique).toBe(item.unique)
      expect(out.exact).toBe(true)
      expect(out.termCount).toBe(out.minimal === '' ? 0 : out.minimal.split(' | ').length)
    })

    it(`keeps ${item.expr} (dontCare ${JSON.stringify(item.dc)}) semantically equal outside the don't-cares`, () => {
      const vars = varsOf(item.expr)
      const out = minimizeOf(item.expr, item.dc)
      const source = parseExpression(item.expr)
      const rows = 2 ** vars.length
      const dcSet = new Set(item.dc)
      for (let index = 0; index < rows; index += 1) {
        if (dcSet.has(index)) continue
        expect(evalSop(out.minimal, vars, index)).toBe(evaluate(source, envOf(vars, index)))
      }
    })
  }

  it('orders prime implicants by literals then reading order, and reports covered minterms', () => {
    const out = minimizeOf('a & (b | c)', [1, 2])
    expect(out.implicants.map((pi) => pi.term)).toEqual(['a & b', 'a & c', '!b & c', 'b & !c'])
    expect(out.implicants.map((pi) => pi.signature)).toEqual(['11-', '1-1', '-01', '-10'])
    expect(out.implicants.map((pi) => pi.literals)).toEqual([2, 2, 2, 2])
    expect(out.implicants[0]?.covers).toEqual([6, 7])
    expect(out.implicants[2]?.covers).toEqual([5])
    expect(out.implicants[2]?.coversDontCare).toEqual([1])
    expect(out.implicants[3]?.covers).toEqual([6])
    expect(out.implicants[3]?.coversDontCare).toEqual([2])
  })

  it('records the don’t-care span of a widened cube', () => {
    const out = minimizeOf('a & !b & c | a & !b & !c', [6, 7])
    expect(out.implicants[0]?.term).toBe('a')
    expect(out.implicants[0]?.covers).toEqual([4, 5])
    expect(out.implicants[0]?.coversDontCare).toEqual([6, 7])
  })

  it('explains contradictions and constant-one covers in the note', () => {
    expect(minimizeOf('a & !a', []).note).toMatch(/false on every row/)
    expect(minimizeOf('a | !a', []).note).toMatch(/constant 1/)
    expect(minimizeOf('a & b', [0, 1, 2]).note).toMatch(/constant 1/)
  })

  it('degrades honestly when the search budget is too small', () => {
    const out = minimizeFunction(['a', 'b', 'c'], [0, 5], [], { nodeBudget: 0 })
    expect(out.exact).toBe(false)
    expect(out.unique).toBe(false)
    expect(out.note).toMatch(/search budget reached \(0 nodes\)/)
    // the fallback still returns a valid cover: both cubes are essential here
    expect(out.minimal).toBe('!a & !b & !c | a & !b & c')
    expect(out.termCount).toBe(2)
    expect(out.literalCount).toBe(6)
  })

  it('greedily covers the leftovers when the budget runs out before the answer', () => {
    const out = minimizeFunction(['a', 'b', 'c'], [5, 6, 7], [1, 2], { nodeBudget: 0 })
    expect(out.exact).toBe(false)
    expect(out.unique).toBe(false)
    expect(out.essentials).toEqual([])
    expect(out.note).toMatch(/essentials \+ greedy/)
    // greedy still returns a real cover of the on-set (and here it ties the optimum)
    expect(out.termCount).toBe(2)
    expect(out.minimal).toBe('a & b | a & c')
    const dc = new Set([1, 2])
    const on = new Set([5, 6, 7])
    for (let m = 0; m < 8; m += 1) {
      if (dc.has(m)) continue
      expect(evalSop(out.minimal, ['a', 'b', 'c'], m)).toBe(on.has(m))
    }
  })

  it('reports the greedy cover as best-found when the search cannot finish', () => {
    const out = minimizeFunction(['a', 'b', 'c'], [5, 6, 7], [1, 2], { nodeBudget: 1 })
    expect(out.exact).toBe(false)
    expect(out.note).toMatch(/not proven minimal/)
    expect(out.termCount).toBeGreaterThan(0)
    const dc = new Set([1, 2])
    const on = new Set([5, 6, 7])
    for (let m = 0; m < 8; m += 1) {
      if (dc.has(m)) continue
      expect(evalSop(out.minimal, ['a', 'b', 'c'], m)).toBe(on.has(m))
    }
  })

  it('ignores duplicate and out-of-range minterm indices', () => {
    const out = minimizeFunction(['a', 'b'], [3, 3, 99], [0, 0, -1, 77])
    expect(out.minimal).toBe('a & b')
    expect(out.termCount).toBe(1)
  })

  it('exposes a documented default node budget', () => {
    expect(DEFAULT_NODE_BUDGET).toBe(300000)
  })
})

describe('signatureOf / termOf', () => {
  it('renders signatures in variable order', () => {
    expect(signatureOf({ value: 0b100, mask: 0b000 }, 3)).toBe('100')
    expect(signatureOf({ value: 0b000, mask: 0b111 }, 3)).toBe('---')
    expect(signatureOf({ value: 0b000, mask: 0b010 }, 3)).toBe('0-0')
  })

  it('renders product terms and the constant 1', () => {
    expect(termOf({ value: 0b100, mask: 0b000 }, ['a', 'b', 'c'])).toBe('a & !b & !c')
    expect(termOf({ value: 0b000, mask: 0b111 }, ['a', 'b', 'c'])).toBe('1')
  })

  it('never emits a literal for a free variable', () => {
    expect(termOf({ value: 0b000, mask: 0b101 }, ['a', 'b', 'c'])).toBe('!b')
  })
})

describe('logic_minimize tool', () => {
  const tools = buildBooleanTools()
  const run = tools.logic_minimize.execute as unknown as Exec

  it('is registered alongside the other four tools', () => {
    expect(Object.keys(tools).sort()).toEqual(
      ['logic_convert', 'logic_equiv', 'logic_eval', 'logic_minimize', 'truth_table'].sort(),
    )
  })

  it('returns the minimal cover plus prime implicants and essentials', async () => {
    const result = (await run({ expr: 'a & b | a & !b' })) as Record<string, unknown>
    assertNoUndefined(result)
    expect(result.valid).toBe(true)
    expect(result.vars).toEqual(['a', 'b'])
    expect(result.nVars).toBe(2)
    expect(result.minterms).toEqual([2, 3])
    expect(result.dontCares).toEqual([])
    expect(result.minimal).toBe('a')
    expect(result.termCount).toBe(1)
    expect(result.literalCount).toBe(1)
    expect(result.exact).toBe(true)
    expect(result.unique).toBe(true)
    expect(result.essentialTerms).toEqual(['a'])
    const implicants = result.primeImplicants as { term: string; covers: number[] }[]
    expect(implicants).toHaveLength(1)
    expect(implicants[0]?.term).toBe('a')
    expect(implicants[0]?.covers).toEqual([2, 3])
  })

  it("applies don't-care minterms passed as minterm indices", async () => {
    const result = (await run({ expr: 'a & !b & c | a & !b & !c', dontCare: [6, 7] })) as Record<string, unknown>
    assertNoUndefined(result)
    expect(result.valid).toBe(true)
    expect(result.dontCares).toEqual([6, 7])
    expect(result.minimal).toBe('a')
    const implicants = result.primeImplicants as { term: string; coversDontCare: number[] }[]
    expect(implicants[0]?.term).toBe('a')
    expect(implicants[0]?.coversDontCare).toEqual([6, 7])
  })

  it('resolves ties deterministically and reports that it did', async () => {
    const result = (await run({ expr: 'a & (b | c)', dontCare: [1, 2] })) as Record<string, unknown>
    expect(result.valid).toBe(true)
    expect(result.minimal).toBe('a & b | a & c')
    expect(result.unique).toBe(false)
    expect(result.essentialTerms).toEqual([])
    expect((result.primeImplicants as unknown[]).length).toBe(4)
  })

  it('reports a contradiction as an empty cover and a tautology as the constant 1', async () => {
    const contra = (await run({ expr: 'a & !a' })) as Record<string, unknown>
    expect(contra.valid).toBe(true)
    expect(contra.minimal).toBe('')
    expect(contra.termCount).toBe(0)
    expect(contra.literalCount).toBe(0)
    expect(contra.note).toMatch(/false on every row/)

    const taut = (await run({ expr: 'a | !a' })) as Record<string, unknown>
    expect(taut.minimal).toBe('1')
    expect(taut.termCount).toBe(1)
    expect(taut.literalCount).toBe(0)
  })

  it("notes don't-care minterms that are already true", async () => {
    const result = (await run({ expr: 'a & b & c', dontCare: [7, 4, 5, 6] })) as Record<string, unknown>
    expect(result.valid).toBe(true)
    expect(result.dontCares).toEqual([4, 5, 6, 7])
    expect(result.minimal).toBe('a')
    expect(result.note).toMatch(/already true/)
  })

  it('rejects out-of-range, negative or fractional dontCare minterms', async () => {
    const high = (await run({ expr: 'a & b', dontCare: [4] })) as Record<string, unknown>
    expect(high.valid).toBe(false)
    expect(high.error).toMatch(/invalid dontCare minterm\(s\) 4: expected integers in 0\.\.3/)
    const low = (await run({ expr: 'a & b', dontCare: [-1] })) as Record<string, unknown>
    expect(low.valid).toBe(false)
    expect(low.error).toMatch(/invalid dontCare/)
    const frac = (await run({ expr: 'a & b', dontCare: [1.5] })) as Record<string, unknown>
    expect(frac.valid).toBe(false)
    expect(frac.error).toMatch(/invalid dontCare/)
  })

  it('rejects parse errors and oversized expressions', async () => {
    const bad = (await run({ expr: 'a & (' })) as Record<string, unknown>
    expect(bad.valid).toBe(false)
    expect(bad.error).toMatch(/unexpected end of expression/)
  })

  it('rejects more than eight variables', async () => {
    const result = (await run({ expr: 'a & b & c & d & e & f & g & h & i' })) as Record<string, unknown>
    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/at most 8/)
  })

  it('renders a readable summary', async () => {
    const value = await run({ expr: '((a & b) | (a & c)) | (b & c)' })
    const render = tools.logic_minimize.output.render as unknown as (
      args: unknown,
      value: unknown,
    ) => { type: string; text: string }[]
    const text = render({ expr: '((a & b) | (a & c)) | (b & c)' }, value)
      .map((b) => b.text)
      .join('\n')
    expect(text).toContain('minimal SOP of ((a & b) | (a & c)) | (b & c) over a, b, c: a & b | a & c | b & c')
    expect(text).toContain('3 term(s), 6 literal(s) (proven minimum, unique)')
    expect(text).toContain('prime implicants: a & b m[6, 7]; a & c m[5, 7]; b & c m[3, 7]')
    expect(text).toContain('essential: a & b, a & c, b & c')
  })

  it('renders the empty cover for a contradiction', async () => {
    const value = await run({ expr: 'a & !a' })
    const render = tools.logic_minimize.output.render as unknown as (
      args: unknown,
      value: unknown,
    ) => { type: string; text: string }[]
    const text = render({ expr: 'a & !a' }, value)
      .map((b) => b.text)
      .join('\n')
    expect(text).toContain('(empty: the function is false on every row)')
    expect(text).toContain('note:')
  })

  it('renders the tool error for invalid input', async () => {
    const value = await run({ expr: '' })
    const render = tools.logic_minimize.output.render as unknown as (
      args: unknown,
      value: unknown,
    ) => { type: string; text: string }[]
    const text = render({ expr: '' }, value)
      .map((b) => b.text)
      .join('\n')
    expect(text).toContain('logic_minimize failed: expression is empty')
  })
})
