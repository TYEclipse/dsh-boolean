/**
 * Tests for dsh-boolean tool definitions: assembly, execute paths, guard rails
 * (variable limits, overlap/missing assignments, invalid names), render
 * functions, and the lossless-JSON no-undefined-key discipline on result trees.
 */

import { describe, expect, it } from 'vitest'
import { resolveConfig } from '../src/index.ts'
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

describe('resolveConfig', () => {
  it('applies every default', () => {
    expect(resolveConfig({})).toEqual({ maxTableVars: 8 })
  })

  it('honours overrides', () => {
    expect(resolveConfig({ maxTableVars: 10 })).toEqual({ maxTableVars: 10 })
  })
})

describe('buildBooleanTools', () => {
  const tools = buildBooleanTools()

  it('exposes all four tools under their canonical names', () => {
    expect(Object.keys(tools).sort()).toEqual(['logic_convert', 'logic_equiv', 'logic_eval', 'truth_table'].sort())
  })

  it('gives every tool a name, description, schema and executable', () => {
    for (const [key, definition] of Object.entries(tools)) {
      expect(definition.name).toBe(key)
      expect(definition.description.length).toBeGreaterThan(20)
      expect(definition.parameters).toBeDefined()
      expect(definition.output.schema).toBeDefined()
      expect(typeof definition.execute).toBe('function')
    }
  })
})

describe('truth_table execute', () => {
  const tools = buildBooleanTools()
  const run = tools.truth_table.execute as unknown as Exec

  it('emits the full table of a xor b with canonical forms (oracle anchors)', async () => {
    const result = await run({ expr: 'a ^ b' }) as Record<string, unknown>
    assertNoUndefined(result)
    expect(result.valid).toBe(true)
    expect(result.vars).toEqual(['a', 'b'])
    expect(result.nRows).toBe(4)
    expect(result.trueCount).toBe(2)
    expect(result.minterms).toEqual([1, 2])
    expect(result.maxterms).toEqual([0, 3])
    expect(result.dnf).toBe('(!a & b) | (a & !b)')
    expect(result.cnf).toBe('(a | b) & (!a | !b)')
    expect(result.isSatisfiable).toBe(true)
    expect(result.isTautology).toBe(false)
    expect(result.isContradiction).toBe(false)
    expect('note' in result).toBe(false)
    const rows = result.rows as { index: number; assignment: Record<string, boolean>; result: boolean }[]
    expect(rows[1]).toEqual({ index: 1, assignment: { a: false, b: true }, result: true })
    expect(rows[2]).toEqual({ index: 2, assignment: { a: true, b: false }, result: true })
  })

  it('flags tautology and contradiction with notes', async () => {
    const taut = await run({ expr: 'a | !a' }) as Record<string, unknown>
    expect(taut.valid).toBe(true)
    expect(taut.isTautology).toBe(true)
    expect(taut.isSatisfiable).toBe(true)
    expect(taut.dnf).toBe('(!a) | (a)')
    expect(taut.cnf).toBe('')
    expect(typeof taut.note).toBe('string')

    const contra = await run({ expr: 'a & !a' }) as Record<string, unknown>
    expect(contra.valid).toBe(true)
    expect(contra.isContradiction).toBe(true)
    expect(contra.isSatisfiable).toBe(false)
    expect(contra.dnf).toBe('')
    expect(contra.cnf).toBe('(a) & (!a)')
    expect(typeof contra.note).toBe('string')
  })

  it('adds extra columns from the vars parameter', async () => {
    const result = await run({ expr: 'a', vars: ['b'] }) as Record<string, unknown>
    expect(result.valid).toBe(true)
    expect(result.vars).toEqual(['a', 'b'])
    expect(result.nRows).toBe(4)
    expect(result.minterms).toEqual([2, 3])
  })

  it('rejects invalid variable names in vars', async () => {
    const result = await run({ expr: 'a', vars: ['ab', 'c'] }) as Record<string, unknown>
    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/invalid variable name 'ab'/)
  })

  it('rejects parse errors with the position message', async () => {
    const result = await run({ expr: 'a & (b' }) as Record<string, unknown>
    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/expected '\)'/)
  })

  it('rejects more than 8 variables', async () => {
    const result = await run({ expr: 'a & b & c & d & e & f & g & h & i' }) as Record<string, unknown>
    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/at most 8/)
  })

  it('renders a readable text summary', async () => {
    const value = await run({ expr: 'a & b' })
    const render = tools.truth_table.output.render as unknown as (args: unknown, value: unknown) => { type: string; text: string }[]
    const text = render({ expr: 'a & b' }, value)
      .map((b) => b.text)
      .join('\n')
    expect(text).toContain('truth table of a & b')
    expect(text).toContain('m3 (11) 1')
    expect(text).toContain('DNF (a & b)')
  })
})

describe('logic_eval execute', () => {
  const tools = buildBooleanTools()
  const run = tools.logic_eval.execute as unknown as Exec

  it('evaluates a full assignment', async () => {
    const result = await run({ expr: 'a & (b | !c)', trueVars: ['a'], falseVars: ['b', 'c'] }) as Record<string, unknown>
    assertNoUndefined(result)
    expect(result.valid).toBe(true)
    expect(result.result).toBe(true)
    expect(result.assignment).toEqual({ a: true, b: false, c: false })
  })

  it('evaluates implication chains correctly', async () => {
    const result = await run({ expr: 'a -> b', trueVars: ['a', 'b'], falseVars: [] }) as Record<string, unknown>
    expect(result.valid).toBe(true)
    expect(result.result).toBe(true)
  })

  it('reports missing variables and does not silently default', async () => {
    const result = await run({ expr: 'a & b', trueVars: ['a'] }) as Record<string, unknown>
    expect(result.valid).toBe(false)
    expect(result.missingVars).toEqual(['b'])
    expect(result.error).toMatch(/missing assignment/)
  })

  it('rejects variables listed in both lists', async () => {
    const result = await run({ expr: 'a & b', trueVars: ['a', 'b'], falseVars: ['b'] }) as Record<string, unknown>
    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/both trueVars and falseVars/)
  })

  it('rejects invalid variable names', async () => {
    const result = await run({ expr: 'a', trueVars: ['aa'] }) as Record<string, unknown>
    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/invalid variable name 'aa'/)
  })

  it('ignores extra listed variables outside the expression', async () => {
    const result = await run({ expr: 'a', trueVars: ['a'], falseVars: ['z'] }) as Record<string, unknown>
    expect(result.valid).toBe(true)
    expect(result.result).toBe(true)
    expect(result.assignment).toEqual({ a: true })
  })

  it('normalizes upper-case names and duplicates', async () => {
    const result = await run({ expr: 'A', trueVars: ['A', 'a'] }) as Record<string, unknown>
    expect(result.valid).toBe(true)
    expect(result.vars).toEqual(['a'])
    expect(result.result).toBe(true)
  })

  it('renders a readable text summary', async () => {
    const value = await run({ expr: 'a | b', trueVars: ['a'], falseVars: ['b'] })
    const render = tools.logic_eval.output.render as unknown as (args: unknown, value: unknown) => { type: string; text: string }[]
    const text = render({ expr: 'a | b' }, value)
      .map((b) => b.text)
      .join('\n')
    expect(text).toContain('a | b with a=true, b=false = true')
  })
})

describe('logic_equiv execute', () => {
  const tools = buildBooleanTools()
  const run = tools.logic_equiv.execute as unknown as Exec

  it('confirms De Morgan equivalence over every row', async () => {
    const result = await run({ exprA: '!(a & b)', exprB: '!a | !b' }) as Record<string, unknown>
    assertNoUndefined(result)
    expect(result.valid).toBe(true)
    expect(result.equivalent).toBe(true)
    expect(result.differingRows).toBe(0)
    expect(result.nRows).toBe(4)
    expect('counterexample' in result).toBe(false)
  })

  it('reports a counterexample when expressions differ', async () => {
    const result = await run({ exprA: 'a ^ b', exprB: 'a | b' }) as Record<string, unknown>
    expect(result.valid).toBe(true)
    expect(result.equivalent).toBe(false)
    expect(result.differingRows).toBe(1)
    const cx = result.counterexample as { index: number; assignment: Record<string, boolean>; a: boolean; b: boolean }
    expect(cx.index).toBe(3)
    expect(cx.assignment).toEqual({ a: true, b: true })
    expect(cx.a).toBe(false)
    expect(cx.b).toBe(true)
  })

  it('checks identities with different variable counts per side', async () => {
    const result = await run({ exprA: 'a', exprB: 'a & (b | !b)' }) as Record<string, unknown>
    expect(result.valid).toBe(true)
    expect(result.equivalent).toBe(true)
    expect(result.vars).toEqual(['a', 'b'])
    expect(result.nRows).toBe(4)
  })

  it('rejects a parse error in either side with a side label', async () => {
    const bad = await run({ exprA: 'a &', exprB: 'b' }) as Record<string, unknown>
    expect(bad.valid).toBe(false)
    expect(bad.error).toMatch(/exprA:/)
  })

  it('rejects more than 8 combined variables', async () => {
    const result = await run({
      exprA: 'a & b & c & d & e',
      exprB: 'f & g & h & i & j',
    }) as Record<string, unknown>
    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/at most 8/)
  })

  it('renders a readable text summary', async () => {
    const value = await run({ exprA: 'a', exprB: 'a' })
    const render = tools.logic_equiv.output.render as unknown as (args: unknown, value: unknown) => { type: string; text: string }[]
    const text = render({ exprA: 'a', exprB: 'a' }, value)
      .map((b) => b.text)
      .join('\n')
    expect(text).toContain('equivalent: a == a')
  })
})

describe('logic_convert execute', () => {
  const tools = buildBooleanTools()
  const run = tools.logic_convert.execute as unknown as Exec

  it('produces the canonical DNF of a xor b', async () => {
    const result = await run({ expr: 'a ^ b', operation: 'dnf' }) as Record<string, unknown>
    assertNoUndefined(result)
    expect(result.valid).toBe(true)
    expect(result.output).toBe('(!a & b) | (a & !b)')
  })

  it('produces the canonical CNF of a -> b', async () => {
    const result = await run({ expr: 'a -> b', operation: 'cnf' }) as Record<string, unknown>
    expect(result.valid).toBe(true)
    expect(result.output).toBe('(!a | b)')
  })

  it('produces NNF with NOT only on variables', async () => {
    const result = await run({ expr: '!(a & b) | c', operation: 'nnf' }) as Record<string, unknown>
    expect(result.valid).toBe(true)
    expect(result.output).toBe('!a | !b | c')
  })

  it('produces NAND-only and NOR-only networks', async () => {
    const nand = await run({ expr: 'a & b', operation: 'nand' }) as Record<string, unknown>
    expect(nand.valid).toBe(true)
    expect(nand.output).toBe('NAND(NAND(a,b),NAND(a,b))')
    const nor = await run({ expr: 'a | b', operation: 'nor' }) as Record<string, unknown>
    expect(nor.valid).toBe(true)
    expect(nor.output).toBe('NOR(NOR(a,b),NOR(a,b))')
  })

  it('notes empty DNF for contradictions and empty CNF for tautologies', async () => {
    const dnf = await run({ expr: 'a & !a', operation: 'dnf' }) as Record<string, unknown>
    expect(dnf.valid).toBe(true)
    expect(dnf.output).toBe('')
    expect(dnf.note).toMatch(/contradiction/)
    const cnf = await run({ expr: 'a | !a', operation: 'cnf' }) as Record<string, unknown>
    expect(cnf.valid).toBe(true)
    expect(cnf.output).toBe('')
    expect(cnf.note).toMatch(/tautology/)
  })

  it('converts word-form and unicode input like symbolic input', async () => {
    const dnf1 = await run({ expr: 'a xor b', operation: 'dnf' }) as Record<string, unknown>
    const dnf2 = await run({ expr: 'a ⊕ b', operation: 'dnf' }) as Record<string, unknown>
    const dnf3 = await run({ expr: 'a ^ b', operation: 'dnf' }) as Record<string, unknown>
    expect(dnf1.output).toBe(dnf3.output)
    expect(dnf2.output).toBe(dnf3.output)
  })

  it('rejects a DNF request over more than 8 variables', async () => {
    const result = await run({ expr: 'a & b & c & d & e & f & g & h & i', operation: 'dnf' }) as Record<string, unknown>
    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/at most 8/)
  })

  it('allows structural conversions (nnf/nand/nor) beyond 8 variables', async () => {
    const expr = 'a & b & c & d & e & f & g & h & i'
    const nnf = await run({ expr, operation: 'nnf' }) as Record<string, unknown>
    expect(nnf.valid).toBe(true)
    const nand = await run({ expr, operation: 'nand' }) as Record<string, unknown>
    expect(nand.valid).toBe(true)
  })

  it('renders a readable text summary', async () => {
    const value = await run({ expr: 'a ^ b', operation: 'dnf' })
    const render = tools.logic_convert.output.render as unknown as (args: unknown, value: unknown) => { type: string; text: string }[]
    const text = render({ expr: 'a ^ b', operation: 'dnf' }, value)
      .map((b) => b.text)
      .join('\n')
    expect(text).toContain('dnf of a ^ b')
    expect(text).toContain('(!a & b) | (a & !b)')
  })
})
