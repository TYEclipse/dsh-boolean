/**
 * Core engine tests for dsh-boolean: parser semantics (precedence, associativity,
 * desugaring, word/unicode operators, error reporting), evaluation, truth tables
 * against the independent Python oracle fixture (rows/minterms/maxterms/DNF/CNF),
 * canonical conversions (NNF / render round-trip / NAND / NOR) verified
 * semantically with a self-contained gate evaluator, plus the lossless-JSON
 * no-undefined-key discipline on every result tree.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  BooleanParseError,
  cnfFromMaxterms,
  dnfFromMinterms,
  evaluate,
  expressionVars,
  nandForm,
  norForm,
  parseExpression,
  render,
  toNnf,
  truthTable,
  type Node,
} from '../src/boolean.ts'

interface FixtureRow {
  index: number
  bits: number[]
  result: number
}

interface FixtureExpr {
  expr: string
  vars: string[]
  rows: FixtureRow[]
  minterms: number[]
  maxterms: number[]
  dnf: string
  cnf: string
}

interface Fixture {
  exprs: FixtureExpr[]
  equiv: { a: string; b: string; equivalent: boolean }[]
}

const fixture = JSON.parse(readFileSync(new URL('./fixtures/anchors.json', import.meta.url), 'utf8')) as Fixture

function envOf(assignment: Record<string, boolean>): Map<string, boolean> {
  return new Map(Object.entries(assignment))
}

function tableOf(expr: string): { node: Node; vars: string[]; table: ReturnType<typeof truthTable> } {
  const node = parseExpression(expr)
  const vars = expressionVars(node)
  return { node, vars, table: truthTable(node, vars) }
}

/** True when two expressions agree on every row of their combined truth table. */
function equivalent(a: string, b: string): boolean {
  const na = parseExpression(a)
  const nb = parseExpression(b)
  const vars = [...new Set([...expressionVars(na), ...expressionVars(nb)])].sort()
  const ta = truthTable(na, vars)
  const tb = truthTable(nb, vars)
  return ta.minterms.join(',') === tb.minterms.join(',')
}

describe('oracle fixture table anchors', () => {
  it('covers 16 curated expressions with independent Python enumeration', () => {
    expect(fixture.exprs.length).toBe(16)
    expect(fixture.equiv.length).toBe(11)
  })

  for (const entry of fixture.exprs) {
    it(`truth table of ${entry.expr} matches the oracle`, () => {
      const { vars, table } = tableOf(entry.expr)
      expect(vars).toEqual(entry.vars)
      expect(table.rows.length).toBe(2 ** entry.vars.length)
      expect(table.minterms).toEqual(entry.minterms)
      expect(table.maxterms).toEqual(entry.maxterms)
      for (const row of table.rows) {
        const oracle = entry.rows[row.index] as FixtureRow
        expect(oracle.bits).toEqual(entry.vars.map((v) => (row.assignment[v] ? 1 : 0)))
        expect(row.result).toBe(oracle.result === 1)
      }
      expect(dnfFromMinterms(table.minterms, vars)).toBe(entry.dnf)
      expect(cnfFromMaxterms(table.maxterms, vars)).toBe(entry.cnf)
    })
  }

  for (const pair of fixture.equiv) {
    it(`identity pair ${pair.a} vs ${pair.b} is equivalent=${pair.equivalent}`, () => {
      expect(equivalent(pair.a, pair.b)).toBe(pair.equivalent)
    })
  }
})

describe('parseExpression: precedence and associativity', () => {
  it('binds AND tighter than OR (a | b & c parses as a | (b & c))', () => {
    const node = parseExpression('a | b & c')
    expect(evaluate(node, envOf({ a: true, b: false, c: false }))).toBe(true)
    expect(evaluate(node, envOf({ a: false, b: false, c: false }))).toBe(false)
    expect(evaluate(parseExpression('a & b | c'), envOf({ a: false, b: false, c: true }))).toBe(true)
    expect(evaluate(parseExpression('a & b | c'), envOf({ a: true, b: true, c: false }))).toBe(true)
    expect(evaluate(parseExpression('a & b | c'), envOf({ a: false, b: true, c: false }))).toBe(false)
  })

  it('binds AND tighter than XOR (a ^ b & c parses as a ^ (b & c))', () => {
    const node = parseExpression('a ^ b & c')
    expect(evaluate(node, envOf({ a: true, b: true, c: false }))).toBe(true)
    expect(evaluate(node, envOf({ a: true, b: true, c: true }))).toBe(false)
  })

  it('binds XOR tighter than OR', () => {
    const node = parseExpression('a | b ^ c')
    expect(evaluate(node, envOf({ a: true, b: false, c: true }))).toBe(true)
    expect(evaluate(node, envOf({ a: false, b: true, c: true }))).toBe(false)
  })

  it('binds OR tighter than IMPLIES and IFF lowest of all', () => {
    expect(evaluate(parseExpression('a | b -> c'), envOf({ a: true, b: false, c: false }))).toBe(false)
    expect(evaluate(parseExpression('a | b -> c'), envOf({ a: false, b: true, c: false }))).toBe(false)
    expect(evaluate(parseExpression('a | b -> c'), envOf({ a: false, b: true, c: true }))).toBe(true)
    expect(evaluate(parseExpression('a <-> b | c'), envOf({ a: false, b: false, c: true }))).toBe(false)
    expect(evaluate(parseExpression('a <-> b | c'), envOf({ a: true, b: false, c: true }))).toBe(true)
  })

  it('is left-associative for IMPLIES (the non-associative operator)', () => {
    expect(evaluate(parseExpression('a -> b -> c'), envOf({ a: false, b: false, c: false }))).toBe(false)
    expect(evaluate(parseExpression('a -> b -> c'), envOf({ a: false, b: true, c: false }))).toBe(false)
    expect(evaluate(parseExpression('a -> b -> c'), envOf({ a: false, b: false, c: true }))).toBe(true)
    expect(evaluate(parseExpression('a & b & c'), envOf({ a: true, b: true, c: false }))).toBe(false)
  })

  it('supports explicit parentheses overriding precedence', () => {
    expect(evaluate(parseExpression('(a | b) & c'), envOf({ a: false, b: true, c: false }))).toBe(false)
    expect(evaluate(parseExpression('(a | b) & c'), envOf({ a: false, b: true, c: true }))).toBe(true)
  })
})

describe('parseExpression: operator surface', () => {
  const symbolic = [
    '!a',
    'a & b',
    'a | b',
    'a ^ b',
    'a -> b',
    'a <-> b',
    'a => b',
    'a <=> b',
  ]

  it('supports every word form with identical semantics', () => {
    const wordPairs = [
      ['not a', '!a'],
      ['a and b', 'a & b'],
      ['a or b', 'a | b'],
      ['a xor b', 'a ^ b'],
      ['a implies b', 'a -> b'],
      ['a iff b', 'a <-> b'],
    ]
    for (const [word, sym] of wordPairs) {
      expect(equivalent(word, sym), `${word} == ${sym}`).toBe(true)
    }
  })

  it('supports every unicode operator form with identical semantics', () => {
    const uniPairs = [
      ['¬a', '!a'],
      ['a ∧ b', 'a & b'],
      ['a ∨ b', 'a | b'],
      ['a ⊕ b', 'a ^ b'],
      ['a → b', 'a -> b'],
      ['a ↔ b', 'a <-> b'],
    ]
    for (const [uni, sym] of uniPairs) {
      expect(equivalent(uni, sym), `${uni} == ${sym}`).toBe(true)
    }
  })

  it('supports repeated NOT and word/symbol mixing', () => {
    expect(equivalent('!!a', 'a')).toBe(true)
    expect(equivalent('not not a', 'a')).toBe(true)
    expect(equivalent('¬¬a', 'a')).toBe(true)
    expect(equivalent('not a and b', '(!a) & b')).toBe(true)
    expect(equivalent('not(a or b)', '!a & !b')).toBe(true)
    expect(equivalent('!(a & b)', '!a | !b')).toBe(true)
    expect(equivalent('not a or not b', '!(a & b)')).toBe(true)
  })

  it('keyword matching is case-insensitive; single upper-case letters are variables', () => {
    expect(equivalent('A AND b', 'a & b')).toBe(true)
    expect(equivalent('NOT A', '!a')).toBe(true)
    const node = parseExpression('A & b')
    expect(expressionVars(node)).toEqual(['a', 'b'])
  })

  it('desugars XOR / IMPLIES / IFF to the textbook equivalents', () => {
    expect(equivalent('a ^ b', '(a & !b) | (!a & b)')).toBe(true)
    expect(equivalent('a -> b', '!a | b')).toBe(true)
    expect(equivalent('a <-> b', '(a & b) | (!a & !b)')).toBe(true)
    expect(equivalent('a ^ b ^ c', '(a ^ b) ^ c')).toBe(true)
  })

  it('parses the symbolic surface without crashing (sanity sweep)', () => {
    for (const s of symbolic) {
      expect(() => parseExpression(s)).not.toThrow()
    }
  })
})

describe('parseExpression: errors', () => {
  const cases: [string, string][] = [
    ['', 'empty expression'],
    ['   ', 'empty expression'],
    ['a &', 'unexpected end of expression'],
    ['& a', 'expected a variable, "not", or "("'],
    ['a & & b', 'expected a variable, "not", or "("'],
    ['(a & b', "expected ')'"],
    ['a)', 'unexpected trailing input'],
    ['a b', 'unexpected trailing input'],
    ['foo & a', 'unknown identifier'],
    ['nota', 'unknown identifier'],
    ['a & 1', "unexpected character '1'"],
    ['a < b', "expected '<->'"],
    ['a ? b', "unexpected character '?'"],
  ]
  for (const [input, message] of cases) {
    it(`rejects ${JSON.stringify(input)} with '${message}'`, () => {
      expect(() => parseExpression(input)).toThrow(BooleanParseError)
      expect(() => parseExpression(input)).toThrow(message)
    })
  }

  it('reports a position for parse errors', () => {
    try {
      parseExpression('a & & b')
      expect.unreachable()
    } catch (error) {
      const e = error as BooleanParseError
      expect(e.position).toBeGreaterThan(0)
    }
  })

  it('rejects expressions over the length limit', () => {
    const long = 'a & '.repeat(200) + 'b'
    expect(() => parseExpression(long)).toThrow(/too long/)
  })
})

describe('evaluate', () => {
  it('computes NOT / AND / OR on a full assignment', () => {
    expect(evaluate(parseExpression('!a | b'), envOf({ a: true, b: false }))).toBe(false)
    expect(evaluate(parseExpression('!a | b'), envOf({ a: true, b: true }))).toBe(true)
    expect(evaluate(parseExpression('a & !b'), envOf({ a: true, b: true }))).toBe(false)
  })

  it('throws when a variable has no value', () => {
    expect(() => evaluate(parseExpression('a & b'), envOf({ a: true }))).toThrow("missing value for variable 'b'")
  })
})

describe('render: canonical minimal-parens output', () => {
  it('renders the expected canonical strings', () => {
    expect(render(parseExpression('a & b'))).toBe('a & b')
    expect(render(parseExpression('(a) & (b)'))).toBe('a & b')
    expect(render(parseExpression('!a'))).toBe('!a')
    expect(render(parseExpression('!!a'))).toBe('!!a')
    expect(render(parseExpression('!(a & b)'))).toBe('!(a & b)')
    expect(render(parseExpression('!(a | b)'))).toBe('!(a | b)')
    expect(render(parseExpression('a | (b & c)'))).toBe('a | b & c')
    expect(render(parseExpression('(a | b) & c'))).toBe('(a | b) & c')
    expect(render(parseExpression('a ^ b'))).toBe('a & !b | !a & b')
    expect(render(parseExpression('a -> b'))).toBe('!a | b')
    expect(render(parseExpression('a <-> b'))).toBe('a & b | !a & !b')
  })

  it('round-trips: reparsing rendered output keeps the same truth function', () => {
    const samples = [
      'a & b',
      'a | b',
      'a ^ b',
      'a -> b',
      'a <-> b',
      '!(a & b)',
      '(a & b) | (!a & c)',
      '((a | b) & c) | (!a & !b)',
      'not a and (b or c)',
      '¬(a ∧ b) ∨ c',
      'a ^ b ^ c',
      '(a | (b & !c)) & (a | c)',
    ]
    for (const s of samples) {
      const once = render(parseExpression(s))
      const twice = render(parseExpression(once))
      expect(twice, `render stable for ${s}`).toBe(once)
      expect(equivalent(s, once), `round-trip for ${s}`).toBe(true)
    }
  })
})

describe('toNnf: negation normal form', () => {
  it('renders NNF with NOT only on variables', () => {
    expect(render(toNnf(parseExpression('!(a & b) | c')))).toBe('!a | !b | c')
    expect(render(toNnf(parseExpression('!(a | b) & !c')))).toBe('!a & !b & !c')
    expect(render(toNnf(parseExpression('!!a')))).toBe('a')
    expect(render(toNnf(parseExpression('a')))).toBe('a')
    expect(render(toNnf(parseExpression('!(a ^ b)')))).toBe('(!a | b) & (a | !b)')
    expect(render(toNnf(parseExpression('!(a -> b)')))).toBe('a & !b')
  })

  it('keeps the same truth function for a mixed sample set', () => {
    const samples = [
      'a & b',
      '!(a & b)',
      '!(a | b)',
      'a ^ b',
      'a -> b',
      'a <-> b',
      '!(a ^ b)',
      '!(!a | b) & c',
      '(a | b) & !(c & d)',
      '¬(¬a ∧ ¬b)',
    ]
    for (const s of samples) {
      const nnfText = render(toNnf(parseExpression(s)))
      expect(equivalent(s, nnfText), `NNF of ${s} == ${nnfText}`).toBe(true)
      const nnfNode = parseExpression(nnfText)
      const hasDeepNot = (n: Node): boolean =>
        n.type === 'not' ? n.operand.type !== 'var' : n.type === 'var' ? false : hasDeepNot(n.left) || hasDeepNot(n.right)
      expect(hasDeepNot(nnfNode), `NNF of ${s} has NOT only on variables`).toBe(false)
    }
  })
})

/** Minimal evaluator for the gate-call output grammar: NAND(a,b) / NOR(a,b) / vars. */
function evaluateGate(text: string, env: Record<string, boolean>): boolean {
  let i = 0
  function parseNode(): boolean {
    if (text.startsWith('NAND(', i) || text.startsWith('NOR(', i)) {
      const isNand = text.startsWith('NAND(', i)
      i += isNand ? 5 : 4
      const a = parseNode()
      expect(text[i]).toBe(',')
      i += 1
      const b = parseNode()
      expect(text[i]).toBe(')')
      i += 1
      return isNand ? !(a && b) : !(a || b)
    }
    const ch = text[i] as string
    i += 1
    const v = env[ch]
    expect(v, `variable ${ch} must be assigned`).not.toBeUndefined()
    return v as boolean
  }
  const result = parseNode()
  expect(i).toBe(text.length)
  return result
}

function gateAgrees(expr: string, gateText: string): void {
  const node = parseExpression(expr)
  const vars = expressionVars(node)
  const table = truthTable(node, vars)
  for (const row of table.rows) {
    expect(evaluateGate(gateText, row.assignment), `${expr} row ${row.index}`).toBe(row.result)
  }
}

describe('nandForm / norForm', () => {
  it('emits the expected canonical networks for small expressions', () => {
    expect(nandForm(parseExpression('a & b'))).toBe('NAND(NAND(a,b),NAND(a,b))')
    expect(nandForm(parseExpression('a | b'))).toBe('NAND(NAND(a,a),NAND(b,b))')
    expect(nandForm(parseExpression('!a'))).toBe('NAND(a,a)')
    expect(nandForm(parseExpression('a'))).toBe('a')
    expect(norForm(parseExpression('a & b'))).toBe('NOR(NOR(a,a),NOR(b,b))')
    expect(norForm(parseExpression('a | b'))).toBe('NOR(NOR(a,b),NOR(a,b))')
    expect(norForm(parseExpression('!a'))).toBe('NOR(a,a)')
    expect(norForm(parseExpression('a'))).toBe('a')
  })

  it('keeps the same truth function on every row (semantic gate check)', () => {
    const samples = [
      'a & b',
      'a | b',
      'a ^ b',
      'a -> b',
      'a <-> b',
      '!(a & b)',
      'a | !a',
      'a & !a',
      '(a & b) | (!a & c)',
      '!(a | (b & c))',
      '(a ^ b) & c',
    ]
    for (const s of samples) {
      gateAgrees(s, nandForm(parseExpression(s)))
      gateAgrees(s, norForm(parseExpression(s)))
    }
  })
})

describe('truthTable guards and extras', () => {
  it('caps enumeration at 8 variables', () => {
    const nineVars = 'a & b & c & d & e & f & g & h & i'
    const node = parseExpression(nineVars)
    expect(expressionVars(node).length).toBe(9)
    expect(() => truthTable(node, expressionVars(node))).not.toThrow()
  })

  it('orders rows by the classic minterm numbering', () => {
    const { table } = tableOf('a | b')
    expect(table.rows.map((r) => r.index)).toEqual([0, 1, 2, 3])
    expect(table.minterms).toEqual([1, 2, 3])
  })
})
