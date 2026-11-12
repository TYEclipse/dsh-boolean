/**
 * Tests for the product-of-sums dual (v0.4.0): sum-term rendering, row-exact
 * evaluation, the minimisePosFunction wrapper, the logic_minimize_pos tool
 * (validation, don't-care handling, render, lossless JSON) and — for every
 * curated case — a semantic re-check that the rendered product of sums agrees
 * with the input expression on every row outside the don't-care set.
 *
 * ORACLE: test/oracle/anchors.py
 *
 * Every expected value below (`(a) & (b)`, `(a | b) & (!a | !b)`, the clause
 * counts, literal counts and the signature/`falseOn` tuples) is printed by that
 * in-repo Python oracle, section "D. minimize_pos anchors". The oracle derives
 * a product of sums by minimising the *textual* complement `!(expr)` with its
 * own exhaustive set-cover search, then applying De Morgan — a different code
 * path from `src/minimize.ts`; `python3 test/oracle/anchors.py --check`
 * re-verifies the textbook duals, the dual-cost identity and the row-exactness
 * of every curated case.
 */

import { describe, expect, it } from 'vitest'
import { evaluate, parseExpression } from '../src/boolean.ts'
import { evaluatePos, minimizePosFunction, sumTermOf, type SumTerm } from '../src/minimize.ts'
import { buildBooleanTools } from '../src/tools.ts'

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

function bitsOf(index: number, nVars: number): boolean[] {
  return Array.from({ length: nVars }, (_, i) => ((index >> (nVars - 1 - i)) & 1) === 1)
}

/** Evaluate a rendered product of sums through the plugin's own expression parser. */
function evaluateRendered(minimal: string, vars: string[], index: number): boolean {
  if (minimal === '1') return true
  if (minimal === '0') return false
  const env = new Map<string, boolean>()
  vars.forEach((name, i) => env.set(name, bitsOf(index, vars.length)[i] as boolean))
  return evaluate(parseExpression(minimal), env)
}

describe('sumTermOf', () => {
  it('negates the variables the product term fixed to 1', () => {
    expect(sumTermOf('0-1', ['a', 'b', 'c'])).toBe('a | !c')
    expect(sumTermOf('00', ['a', 'b'])).toBe('a | b')
    expect(sumTermOf('11', ['a', 'b'])).toBe('!a | !b')
  })

  it('renders the all-free cube as the constant 0', () => {
    expect(sumTermOf('--', ['a', 'b'])).toBe('0')
  })
})

describe('evaluatePos', () => {
  const clause: SumTerm = { sum: 'a | !b', signature: '01', literals: 2, falseOn: [1], falseOnDontCare: [] }

  it('is false exactly on the cube the clause excludes', () => {
    // signature 01 over (a, b): false when a = 0 and b = 1, i.e. minterm 1
    expect(evaluatePos([clause], 0, 2)).toBe(true)
    expect(evaluatePos([clause], 1, 2)).toBe(false)
    expect(evaluatePos([clause], 2, 2)).toBe(true)
    expect(evaluatePos([clause], 3, 2)).toBe(true)
  })

  it('treats an empty product as true everywhere', () => {
    expect([0, 1, 2, 3].every((m) => evaluatePos([], m, 2))).toBe(true)
  })
})

describe('minimizePosFunction (oracle anchors)', () => {
  it('gives a product of unit clauses for a conjunction', () => {
    // zeros of a & b are m0, m1, m2
    const out = minimizePosFunction(['a', 'b'], [0, 1, 2], [])
    expect(out.minimal).toBe('(a) & (b)')
    expect(out.termCount).toBe(2)
    expect(out.literalCount).toBe(2)
    expect(out.unique).toBe(true)
    expect(out.terms.map((term) => term.sum)).toEqual(['a', 'b'])
  })

  it('gives the textbook two clauses for xor', () => {
    const out = minimizePosFunction(['a', 'b'], [0, 3], [])
    expect(out.minimal).toBe('(a | b) & (!a | !b)')
    expect(out.terms.map((term) => [term.sum, term.signature, term.falseOn])).toEqual([
      ['a | b', '00', [0]],
      ['!a | !b', '11', [3]],
    ])
  })

  it('reports the constant forms for a tautology and a contradiction', () => {
    const taut = minimizePosFunction(['a'], [], [])
    expect(taut.minimal).toBe('1')
    expect(taut.termCount).toBe(0)
    expect(taut.note).toContain('empty product 1')
    const contra = minimizePosFunction(['a'], [0, 1], [])
    expect(contra.minimal).toBe('0')
    expect(contra.termCount).toBe(1)
    expect(contra.note).toContain('constant 0')
  })

  it('counts the literals of the complement, not of the rendered text', () => {
    // a xor b xor c: four 3-literal clauses, 12 literals in total
    const out = minimizePosFunction(['a', 'b', 'c'], [0, 3, 5, 6], [])
    expect(out.termCount).toBe(4)
    expect(out.literalCount).toBe(12)
    expect(out.selected.map((term) => term.sum)).toEqual(['a | b | c', 'a | !b | !c', '!a | b | !c', '!a | !b | c'])
  })

  it('marks a budget-degraded answer as not proven minimal but still correct', () => {
    const out = minimizePosFunction(['a', 'b', 'c'], [0, 3, 5, 6], [], { nodeBudget: 0 })
    expect(out.exact).toBe(false)
    expect(out.note).toContain('not proven minimal')
    for (let m = 0; m < 8; m += 1) {
      expect(evaluatePos(out.selected, m, 3)).toBe(![0, 3, 5, 6].includes(m))
    }
  })
})

describe('logic_minimize_pos execute', () => {
  const tools = buildBooleanTools()
  const run = tools.logic_minimize_pos.execute as unknown as Exec

  it('reports the absorption case as a single unit clause', async () => {
    const result = await run({ expr: 'a & b | a & !b' }) as Record<string, unknown>
    assertNoUndefined(result)
    expect(result.valid).toBe(true)
    expect(result.vars).toEqual(['a', 'b'])
    expect(result.minterms).toEqual([2, 3])
    expect(result.zeroMinterms).toEqual([0, 1])
    expect(result.minimal).toBe('(a)')
    expect(result.termCount).toBe(1)
    expect(result.literalCount).toBe(1)
    expect(result.exact).toBe(true)
    expect(result.unique).toBe(true)
    expect(result.matchesTruthTable).toBe(true)
    expect(result.coverTerms).toEqual(['a'])
  })

  it('reports the majority function as three two-literal clauses', async () => {
    const result = await run({ expr: '((a & b) | (a & c)) | (b & c)' }) as Record<string, unknown>
    expect(result.minimal).toBe('(a | b) & (a | c) & (b | c)')
    expect(result.termCount).toBe(3)
    expect(result.literalCount).toBe(6)
    expect(result.essentialTerms).toEqual(['a | b', 'a | c', 'b | c'])
    expect(result.matchesTruthTable).toBe(true)
  })

  it('returns the constant forms for a tautology and a contradiction', async () => {
    const taut = await run({ expr: 'a | !a' }) as Record<string, unknown>
    expect(taut.minimal).toBe('1')
    expect(taut.termCount).toBe(0)
    expect(taut.matchesTruthTable).toBe(true)
    expect(typeof taut.note).toBe('string')

    const contra = await run({ expr: 'a & !a' }) as Record<string, unknown>
    expect(contra.minimal).toBe('0')
    expect(contra.termCount).toBe(1)
    expect(contra.zeroMinterms).toEqual([0, 1])
    expect(contra.matchesTruthTable).toBe(true)
    expect(typeof contra.note).toBe('string')
  })

  it('lets don\'t-cares widen a clause but never falsify a true row', async () => {
    const result = await run({ expr: 'a & !b & c | a & !b & !c', dontCare: [6, 7] }) as Record<string, unknown>
    expect(result.minimal).toBe('(a) & (!b)')
    expect(result.dontCares).toEqual([6, 7])
    const implicates = result.primeImplicates as SumTerm[]
    expect(implicates.map((term) => [term.sum, term.signature, term.falseOn])).toEqual([
      ['a', '0--', [0, 1, 2, 3]],
      ['!b', '-1-', [2, 3, 6, 7]],
    ])
    expect(implicates[1]?.falseOnDontCare).toEqual([6, 7])
    expect(result.matchesTruthTable).toBe(true)
  })

  it('ignores a don\'t-care that is already true and says so', async () => {
    const result = await run({ expr: 'a & b', dontCare: [3] }) as Record<string, unknown>
    expect(result.minimal).toBe('(a) & (b)')
    expect(result.dontCares).toEqual([])
    expect(result.note).toContain('are true in the expression')
    expect(result.matchesTruthTable).toBe(true)
  })

  it('still answers when the don\'t-cares cover the whole table', async () => {
    const result = await run({ expr: 'a & b', dontCare: [0, 1, 2] }) as Record<string, unknown>
    expect(result.minimal).toBe('(a) & (b)')
    expect(result.dontCares).toEqual([0, 1, 2])
    expect(result.matchesTruthTable).toBe(true)
  })

  it('keeps a four-variable pair of products as four clauses', async () => {
    const result = await run({ expr: '(a & b) | (c & d)' }) as Record<string, unknown>
    expect(result.minimal).toBe('(a | c) & (a | d) & (b | c) & (b | d)')
    expect(result.termCount).toBe(4)
    expect(result.literalCount).toBe(8)
    expect(result.matchesTruthTable).toBe(true)
  })

  it('leaves unused don\'t-cares alone', async () => {
    const result = await run({ expr: 'a & b & c', dontCare: [4] }) as Record<string, unknown>
    expect(result.minimal).toBe('(a) & (b) & (c)')
    expect(result.termCount).toBe(3)
    expect(result.literalCount).toBe(3)
    expect(result.unique).toBe(true)
    expect(result.matchesTruthTable).toBe(true)
  })

  it('agrees with the expression on every non-don\'t-care row, for every curated case', async () => {
    const cases: [string, number[]][] = [
      ['a & b | a & !b', []],
      ['((a & b) | (a & c)) | (b & c)', []],
      ['a ^ b ^ c', []],
      ['a & !b & c | a & !b & !c', [6, 7]],
      ['a & (b | c)', [1, 2]],
      ['a & !a', []],
      ['a | !a', []],
      ['a & b', [0, 1, 2]],
      ['!a & !b', []],
      ['(a & b) | (c & d)', []],
      ['a & b & c', [4]],
    ]
    for (const [expr, dontCare] of cases) {
      const result = await run({ expr, dontCare }) as Record<string, unknown>
      const vars = result.vars as string[]
      const dc = new Set(result.dontCares as number[])
      const on = new Set(result.minterms as number[])
      const rendered = result.minimal as string
      for (let m = 0; m < 2 ** vars.length; m += 1) {
        if (dc.has(m)) continue
        expect(evaluateRendered(rendered, vars, m), `${expr} at m${m}: ${rendered}`).toBe(on.has(m))
      }
    }
  })

  it('guards the expression and the don\'t-care indices', async () => {
    const empty = await run({ expr: '' }) as Record<string, unknown>
    expect(empty.valid).toBe(false)
    expect(typeof empty.error).toBe('string')

    const bad = await run({ expr: 'a & b', dontCare: [4] }) as Record<string, unknown>
    expect(bad.valid).toBe(false)
    expect(bad.error).toContain('invalid dontCare minterm(s) 4')

    const negative = await run({ expr: 'a & b', dontCare: [-1] }) as Record<string, unknown>
    expect(negative.valid).toBe(false)

    const tooMany = await run({ expr: 'a & b & c & d & e & f & g & h & i' }) as Record<string, unknown>
    expect(tooMany.valid).toBe(false)
    expect(tooMany.error).toContain('at most 8')
  })

  it('renders the answer, its cost and the row check', async () => {
    const result = await run({ expr: 'a ^ b' }) as Record<string, unknown>
    const rendered = tools.logic_minimize_pos.output.render({ expr: 'a ^ b' }, result) as { text: string }[]
    const text = rendered.map((part) => part.text).join('\n')
    expect(text).toContain('minimal POS of a ^ b over a, b')
    expect(text).toContain('(a | b) & (!a | !b)')
    expect(text).toContain('2 sum term(s), 4 literal(s)')
    expect(text).toContain('agrees with the truth table on every non-don\'t-care row: yes')
  })
})
