/**
 * Tool definitions for dsh-boolean: four boolean-algebra tools via defineTool.
 *   truth_table   — full truth table + minterm/maxterm summary + canonical DNF/CNF
 *   logic_eval    — evaluate an expression under one complete assignment
 *   logic_equiv   — equivalence check of two expressions over all rows
 *   logic_convert — canonical conversion: nnf / dnf / cnf / nand / nor
 *
 * @module dsh-boolean/tools
 */

import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import {
  BooleanParseError,
  MAX_TABLE_VARS,
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
} from './boolean.ts'

export interface ToolSet {
  truth_table: ToolDefinition
  logic_eval: ToolDefinition
  logic_equiv: ToolDefinition
  logic_convert: ToolDefinition
}

export type ConvertOp = 'nnf' | 'dnf' | 'cnf' | 'nand' | 'nor'

const CONVERT_OPS: readonly ConvertOp[] = ['nnf', 'dnf', 'cnf', 'nand', 'nor']

const EXPR_DOC =
  'Operators (precedence high to low): NOT !/not/¬, AND &/and/∧, XOR ^/xor/⊕, OR |/or/∨, IMPLIES ->/=>/→, IFF <->/<=>/↔. '
  + 'Variables are single letters a-z; use parentheses () to group. Binary operators are left-associative.'

/** Parse and validate an expression; returns the node or a failure payload. */
type ParseOutcome = { ok: true; node: Node } | { ok: false; error: string }

function tryParse(expr: string): ParseOutcome {
  if (expr.length === 0) return { ok: false, error: 'expression is empty' }
  if (expr.length > 512) return { ok: false, error: `expression too long (${expr.length} chars, limit 512)` }
  try {
    return { ok: true, node: parseExpression(expr) }
  } catch (error) {
    const message = error instanceof BooleanParseError ? error.message : (error as Error).message
    return { ok: false, error: message }
  }
}

/** Validate single-letter variable names, dedupe, sort. */
function normalizeVarList(raw: readonly string[], label: string): { ok: true; vars: string[] } | { ok: false; error: string } {
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of raw) {
    const name = item.trim().toLowerCase()
    if (!/^[a-z]$/.test(name)) {
      return { ok: false, error: `invalid variable name '${item}' in ${label}: variables are single letters a-z` }
    }
    if (!seen.has(name)) {
      seen.add(name)
      out.push(name)
    }
  }
  out.sort()
  return { ok: true, vars: out }
}

function tableVars(node: Node, explicit?: string[]): { ok: true; vars: string[] } | { ok: false; error: string } {
  const detected = expressionVars(node)
  let vars = detected
  if (explicit !== undefined && explicit.length > 0) {
    const normalized = normalizeVarList(explicit, 'vars')
    if (!normalized.ok) return normalized
    for (const name of normalized.vars) {
      if (!detected.includes(name)) detected.push(name)
    }
    detected.sort()
    vars = detected
  }
  if (vars.length > MAX_TABLE_VARS) {
    return {
      ok: false,
      error: `expression involves ${vars.length} variables (${vars.join(', ')}); truth-table tools support at most ${MAX_TABLE_VARS} (2^${MAX_TABLE_VARS} = 256 rows)`,
    }
  }
  return { ok: true, vars }
}

/** ---- truth_table ---- */

interface TruthRowOut {
  index: number
  assignment: Record<string, boolean>
  result: boolean
}

interface TruthTableResult {
  valid: boolean
  error?: string
  expr?: string
  vars?: string[]
  nVars?: number
  nRows?: number
  rows?: TruthRowOut[]
  trueCount?: number
  falseCount?: number
  minterms?: number[]
  maxterms?: number[]
  isTautology?: boolean
  isContradiction?: boolean
  isSatisfiable?: boolean
  dnf?: string
  cnf?: string
  note?: string
}

function renderTruthTable(value: unknown): string {
  const result = value as TruthTableResult
  if (!result.valid) return `truth_table failed: ${result.error}`
  const lines: string[] = []
  lines.push(`truth table of ${result.expr} over ${result.vars?.join(', ')} (${result.nRows} rows):`)
  for (const row of result.rows as TruthRowOut[]) {
    const bits = (result.vars as string[]).map((v) => (row.assignment[v] ? '1' : '0')).join('')
    lines.push(`  m${row.index} (${bits}) ${row.result ? '1' : '0'}`)
  }
  lines.push(
    `minterms m[${result.minterms?.join(', ')}] -> DNF ${result.dnf}; maxterms M[${result.maxterms?.join(', ')}] -> CNF ${result.cnf}`,
  )
  const note = result.note === undefined ? '' : `\n  note: ${result.note}`
  return lines.join('\n') + note
}

/** ---- logic_eval ---- */

interface EvalResult {
  valid: boolean
  error?: string
  expr?: string
  result?: boolean
  vars?: string[]
  assignment?: Record<string, boolean>
  missingVars?: string[]
}

function renderEval(value: unknown): string {
  const result = value as EvalResult
  if (!result.valid) return `logic_eval failed: ${result.error}`
  const envText = Object.entries(result.assignment as Record<string, boolean>)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ')
  return `${result.expr} with ${envText} = ${result.result}`
}

/** ---- logic_equiv ---- */

interface EquivResult {
  valid: boolean
  error?: string
  exprA?: string
  exprB?: string
  equivalent?: boolean
  vars?: string[]
  nRows?: number
  differingRows?: number
  counterexample?: { index: number; assignment: Record<string, boolean>; a: boolean; b: boolean }
}

function renderEquiv(value: unknown): string {
  const result = value as EquivResult
  if (!result.valid) return `logic_equiv failed: ${result.error}`
  if (result.equivalent) return `equivalent: ${result.exprA} == ${result.exprB} (all ${result.nRows} rows agree)`
  const cx = result.counterexample
  const cxText =
    cx === undefined
      ? ''
      : ` counterexample m${cx.index}: ${Object.entries(cx.assignment)
          .map(([k, v]) => `${k}=${v}`)
          .join(', ')} (a=${cx.a}, b=${cx.b})`
  return `not equivalent: ${result.exprA} and ${result.exprB} differ on ${result.differingRows}/${result.nRows} rows.${cxText}`
}

/** ---- logic_convert ---- */

interface ConvertResult {
  valid: boolean
  error?: string
  operation?: ConvertOp
  input?: string
  output?: string
  note?: string
}

function renderConvert(value: unknown): string {
  const result = value as ConvertResult
  if (!result.valid) return `logic_convert failed: ${result.error}`
  const note = result.note === undefined ? '' : `\n  note: ${result.note}`
  return `${result.operation} of ${result.input}:\n  ${result.output}${note}`
}

/** Build all four boolean tool definitions. */
export function buildBooleanTools(): ToolSet {
  const truth_table = defineTool({
    name: 'truth_table',
    description:
      'Build the full truth table of a boolean expression: every assignment row with the result, minterm and '
      + 'maxterm indices, tautology/contradiction/satisfiability flags, and the canonical DNF and CNF strings. '
      + EXPR_DOC
      + ' The optional vars parameter adds extra columns to the table (single letters). '
      + 'At most 8 variables (256 rows). Use this instead of enumerating rows by hand.',
    parameters: {
      expr: { type: 'string', required: true, description: 'Boolean expression, e.g. "(a & b) | (!a & c)".' },
      vars: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional extra variables to include as columns, e.g. ["d"]. Defaults to the variables of expr.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          valid: { type: 'boolean', required: true },
          error: { type: 'string' },
          expr: { type: 'string' },
          vars: { type: 'array', items: { type: 'string' } },
          nVars: { type: 'number' },
          nRows: { type: 'number' },
          rows: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                index: { type: 'number', required: true },
                assignment: { type: 'object', additionalProperties: true, required: true },
                result: { type: 'boolean', required: true },
              },
            },
          },
          trueCount: { type: 'number' },
          falseCount: { type: 'number' },
          minterms: { type: 'array', items: { type: 'number' } },
          maxterms: { type: 'array', items: { type: 'number' } },
          isTautology: { type: 'boolean' },
          isContradiction: { type: 'boolean' },
          isSatisfiable: { type: 'boolean' },
          dnf: { type: 'string' },
          cnf: { type: 'string' },
          note: { type: 'string' },
        },
      },
      render: (_args: { expr: string }, value: unknown) => [{ type: 'text', text: renderTruthTable(value) }],
    },
    async execute(args: { expr: string; vars?: string[] }): Promise<TruthTableResult> {
      const parsed = tryParse(args.expr)
      if (!parsed.ok) return { valid: false, error: parsed.error }
      const tv = tableVars(parsed.node, args.vars)
      if (!tv.ok) return { valid: false, error: tv.error }
      const table = truthTable(parsed.node, tv.vars)
      const rows: TruthRowOut[] = table.rows.map((row) => ({ index: row.index, assignment: row.assignment, result: row.result }))
      const minterms = table.minterms
      const maxterms = table.maxterms
      const isContradiction = minterms.length === 0
      const isTautology = maxterms.length === 0
      const dnf = dnfFromMinterms(minterms, tv.vars)
      const cnf = cnfFromMaxterms(maxterms, tv.vars)
      const out: TruthTableResult = {
        valid: true,
        expr: args.expr,
        vars: tv.vars,
        nVars: tv.vars.length,
        nRows: rows.length,
        rows,
        trueCount: minterms.length,
        falseCount: maxterms.length,
        minterms,
        maxterms,
        isTautology,
        isContradiction,
        isSatisfiable: minterms.length > 0,
        dnf,
        cnf,
      }
      if (isTautology) out.note = 'tautology: the expression is true on every row; its CNF is empty'
      if (isContradiction) out.note = 'contradiction: the expression is false on every row; its DNF is empty'
      return out
    },
  })

  const logic_eval = defineTool({
    name: 'logic_eval',
    description:
      'Evaluate a boolean expression under one complete assignment. Every variable of the expression must be listed '
      + 'exactly once, either in trueVars (set to true) or in falseVars (set to false); extra listed variables are '
      + 'ignored. ' + EXPR_DOC
      + ' Use this to check a single row instead of printing a whole truth table.',
    parameters: {
      expr: { type: 'string', required: true, description: 'Boolean expression, e.g. "a -> (b | c)".' },
      trueVars: {
        type: 'array',
        items: { type: 'string' },
        description: 'Variables to assign true, e.g. ["a"]. All expression variables must be covered by trueVars + falseVars.',
      },
      falseVars: {
        type: 'array',
        items: { type: 'string' },
        description: 'Variables to assign false, e.g. ["b", "c"]. All expression variables must be covered by trueVars + falseVars.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          valid: { type: 'boolean', required: true },
          error: { type: 'string' },
          expr: { type: 'string' },
          result: { type: 'boolean' },
          vars: { type: 'array', items: { type: 'string' } },
          assignment: { type: 'object', additionalProperties: true },
          missingVars: { type: 'array', items: { type: 'string' } },
        },
      },
      render: (_args: { expr: string }, value: unknown) => [{ type: 'text', text: renderEval(value) }],
    },
    async execute(args: { expr: string; trueVars?: string[]; falseVars?: string[] }): Promise<EvalResult> {
      const parsed = tryParse(args.expr)
      if (!parsed.ok) return { valid: false, error: parsed.error }
      const truth = args.trueVars === undefined ? [] : args.trueVars
      const falsity = args.falseVars === undefined ? [] : args.falseVars
      const trueNorm = normalizeVarList(truth, 'trueVars')
      if (!trueNorm.ok) return { valid: false, error: trueNorm.error }
      const falseNorm = normalizeVarList(falsity, 'falseVars')
      if (!falseNorm.ok) return { valid: false, error: falseNorm.error }
      const overlap = trueNorm.vars.filter((v) => falseNorm.vars.includes(v))
      if (overlap.length > 0) {
        return { valid: false, error: `variable(s) listed in both trueVars and falseVars: ${overlap.join(', ')}` }
      }
      const vars = expressionVars(parsed.node)
      const missing = vars.filter((v) => !trueNorm.vars.includes(v) && !falseNorm.vars.includes(v))
      if (missing.length > 0) {
        const out: EvalResult = { valid: false, error: `missing assignment for variable(s): ${missing.join(', ')}` }
        out.missingVars = missing
        return out
      }
      const env: Record<string, boolean> = {}
      for (const v of trueNorm.vars) env[v] = true
      for (const v of falseNorm.vars) env[v] = false
      const result = evaluate(parsed.node, new Map(Object.entries(env)))
      const used: Record<string, boolean> = {}
      for (const v of vars) used[v] = env[v] as boolean
      return { valid: true, expr: args.expr, result, vars, assignment: used }
    },
  })

  const logic_equiv = defineTool({
    name: 'logic_equiv',
    description:
      'Check whether two boolean expressions are logically equivalent by comparing all rows of their combined truth '
      + 'table (at most 8 variables). Returns how many rows differ and one concrete counterexample assignment when '
      + 'they are not equivalent. ' + EXPR_DOC
      + ' Use this to verify identities such as De Morgan or distributive rewrites.',
    parameters: {
      exprA: { type: 'string', required: true, description: 'First boolean expression, e.g. "!(a & b)".' },
      exprB: { type: 'string', required: true, description: 'Second boolean expression, e.g. "!a | !b".' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          valid: { type: 'boolean', required: true },
          error: { type: 'string' },
          exprA: { type: 'string' },
          exprB: { type: 'string' },
          equivalent: { type: 'boolean' },
          vars: { type: 'array', items: { type: 'string' } },
          nRows: { type: 'number' },
          differingRows: { type: 'number' },
          counterexample: {
            type: 'object',
            additionalProperties: false,
            properties: {
              index: { type: 'number', required: true },
              assignment: { type: 'object', additionalProperties: true, required: true },
              a: { type: 'boolean', required: true },
              b: { type: 'boolean', required: true },
            },
          },
        },
      },
      render: (_args: { exprA: string }, value: unknown) => [{ type: 'text', text: renderEquiv(value) }],
    },
    async execute(args: { exprA: string; exprB: string }): Promise<EquivResult> {
      const a = tryParse(args.exprA)
      if (!a.ok) return { valid: false, error: `exprA: ${a.error}` }
      const b = tryParse(args.exprB)
      if (!b.ok) return { valid: false, error: `exprB: ${b.error}` }
      const varsA = expressionVars(a.node)
      const varsB = expressionVars(b.node)
      const union = [...new Set([...varsA, ...varsB])].sort()
      if (union.length > MAX_TABLE_VARS) {
        return {
          valid: false,
          error: `the two expressions involve ${union.length} variables together (${union.join(', ')}); logic_equiv supports at most ${MAX_TABLE_VARS}`,
        }
      }
      const tableA = truthTable(a.node, union)
      const tableB = truthTable(b.node, union)
      const differing: TruthRowOut[] = []
      for (let i = 0; i < tableA.rows.length; i += 1) {
        const rowA = tableA.rows[i] as TruthRowOut
        const rowB = tableB.rows[i] as TruthRowOut
        if (rowA.result !== rowB.result) differing.push(rowA)
      }
      const out: EquivResult = {
        valid: true,
        exprA: args.exprA,
        exprB: args.exprB,
        equivalent: differing.length === 0,
        vars: union,
        nRows: tableA.rows.length,
        differingRows: differing.length,
      }
      if (differing.length > 0) {
        const first = differing[0] as TruthRowOut
        out.counterexample = { index: first.index, assignment: first.assignment, a: first.result, b: !first.result }
      }
      return out
    },
  })

  const logic_convert = defineTool({
    name: 'logic_convert',
    description:
      'Convert a boolean expression into a canonical form: nnf (negation normal form, NOT pushed down to variables), '
      + 'dnf (disjunctive normal form, OR of AND terms), cnf (conjunctive normal form, AND of OR clauses), '
      + 'nand (a network using only NAND gates), or nor (a network using only NOR gates). DNF and CNF come from the '
      + 'truth table, so they are limited to 8 variables; nnf/nand/nor are structural and unlimited. '
      + 'Gate outputs use function-call syntax: NAND(a,b), NOR(a,b), with NOT(x) written as NAND(x,x) or NOR(x,x). '
      + EXPR_DOC
      + ' Use this when you need a canonical form or a single-gate implementation of an expression.',
    parameters: {
      expr: { type: 'string', required: true, description: 'Boolean expression, e.g. "a xor b".' },
      operation: {
        type: 'string',
        enum: [...CONVERT_OPS],
        required: true,
        description: 'Target form: nnf, dnf, cnf, nand, or nor.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          valid: { type: 'boolean', required: true },
          error: { type: 'string' },
          operation: { type: 'string' },
          input: { type: 'string' },
          output: { type: 'string' },
          note: { type: 'string' },
        },
      },
      render: (_args: { expr: string }, value: unknown) => [{ type: 'text', text: renderConvert(value) }],
    },
    async execute(args: { expr: string; operation: ConvertOp }): Promise<ConvertResult> {
      const parsed = tryParse(args.expr)
      if (!parsed.ok) return { valid: false, error: parsed.error }
      const op = args.operation
      if (op === 'nnf') return { valid: true, operation: op, input: args.expr, output: render(toNnf(parsed.node)) }
      if (op === 'nand') return { valid: true, operation: op, input: args.expr, output: nandForm(parsed.node) }
      if (op === 'nor') return { valid: true, operation: op, input: args.expr, output: norForm(parsed.node) }
      const tv = tableVars(parsed.node)
      if (!tv.ok) return { valid: false, error: tv.error }
      const table = truthTable(parsed.node, tv.vars)
      const out: ConvertResult = { valid: true, operation: op, input: args.expr }
      if (op === 'dnf') {
        const dnf = dnfFromMinterms(table.minterms, tv.vars)
        out.output = dnf
        if (dnf.length === 0) out.note = 'expression is a contradiction: the DNF over these variables is empty'
        return out
      }
      const cnf = cnfFromMaxterms(table.maxterms, tv.vars)
      out.output = cnf
      if (cnf.length === 0) out.note = 'expression is a tautology: the CNF over these variables is empty'
      return out
    },
  })

  return { truth_table, logic_eval, logic_equiv, logic_convert }
}
