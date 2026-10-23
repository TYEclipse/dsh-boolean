/**
 * Tests for the Karnaugh-map layout and the logic_kmap tool: Gray-coded axes,
 * cell contents, the cover groups mapped back to cell coordinates, edge
 * wrapping, and the tool's guard rails and rendering.
 *
 * ORACLE: test/oracle/anchors.py
 *
 * Every expected value below was produced by that oracle's K-map section, which
 * lays the map out independently in Python (`python3 test/oracle/anchors.py`,
 * section "C. kmap anchors"; `--check` re-verifies structural invariants —
 * every minterm appears exactly once, groups only circle cells inside on ∪ dc,
 * the groups cover the on-set, and Gray order changes one bit per step).
 */

import { describe, expect, it } from 'vitest'
import { grayCodes, kmapLayout, renderKmapText, MAX_KMAP_VARS, axisSplit } from '../src/kmap.ts'
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

const tools = buildBooleanTools()
const run = tools.logic_kmap.execute as unknown as Exec

/** Grid of a result as compact strings, one per row. */
function gridOf(result: Record<string, unknown>): string[] {
  const rows = result.rows as { label: string; cells: { minterm: number; value: string }[] }[]
  return rows.map((row) => row.cells.map((cell) => cell.value).join(''))
}

describe('grayCodes', () => {
  it('walks one bit at a time, including across the wrap', () => {
    for (const bits of [0, 1, 2]) {
      const codes = grayCodes(bits)
      expect(codes.length).toBe(2 ** bits)
      for (let i = 0; i < codes.length; i += 1) {
        const next = codes[(i + 1) % codes.length] as number
        const diff = (codes[i] as number) ^ next
        expect(diff & (diff - 1), `step ${i} must change exactly one bit`).toBe(0)
      }
    }
  })

  it('matches the textbook two-bit sequence', () => {
    expect(grayCodes(2)).toEqual([0, 1, 3, 2])
  })
})

describe('kmapLayout', () => {
  it('refuses variable counts a map cannot show', () => {
    expect(() => kmapLayout(['a', 'b', 'c', 'd', 'e'], [], [], [])).toThrow(RangeError)
  })

  it('assigns the two axes by variable count', () => {
    expect(axisSplit(1)).toEqual({ rowVars: 0, colVars: 1 })
    expect(axisSplit(2)).toEqual({ rowVars: 1, colVars: 1 })
    expect(axisSplit(3)).toEqual({ rowVars: 1, colVars: 2 })
    expect(axisSplit(4)).toEqual({ rowVars: 2, colVars: 2 })
    expect(() => axisSplit(5)).toThrow(RangeError)
  })

  it('marks on, don\'t-care and off cells', () => {
    const layout = kmapLayout(['a', 'b', 'c'], [4, 5], [6, 7], [])
    const grid = layout.rows.map((row) => row.cells.map((cell) => cell.value).join(''))
    expect(grid).toEqual(['0000', '11xx'])
  })
})

describe('logic_kmap tool', () => {
  it('is registered with the other boolean tools', () => {
    expect(Object.keys(tools).sort()).toEqual(
      ['logic_convert', 'logic_equiv', 'logic_eval', 'logic_kmap', 'logic_minimize', 'truth_table'].sort(),
    )
  })

  it('lays out a two-variable map and circles the single cell', async () => {
    const result = (await run({ expr: 'a & b' })) as Record<string, unknown>
    assertNoUndefined(result)
    expect(result.valid).toBe(true)
    expect(result.vars).toEqual(['a', 'b'])
    expect(result.rowVars).toEqual(['a'])
    expect(result.colVars).toEqual(['b'])
    expect(result.columnLabels).toEqual(['0', '1'])
    expect(gridOf(result)).toEqual(['00', '01'])
    expect(result.minimal).toBe('a & b')
    const groups = result.groups as Record<string, unknown>[]
    expect(groups).toHaveLength(1)
    expect(groups[0]?.term).toBe('a & b')
    expect(groups[0]?.signature).toBe('11')
    expect(groups[0]?.essential).toBe(true)
    expect(groups[0]?.wraps).toBe(false)
    expect(groups[0]?.cells).toEqual([{ row: 1, col: 1, minterm: 3 }])
  })

  it('uses Gray-code column order for three variables', async () => {
    const result = (await run({ expr: 'a & !b | a & c' })) as Record<string, unknown>
    expect(result.columnLabels).toEqual(['00', '01', '11', '10'])
    expect(result.rowVars).toEqual(['a'])
    expect(result.colVars).toEqual(['b', 'c'])
    expect(gridOf(result)).toEqual(['0000', '1110'])
    const groups = result.groups as Record<string, unknown>[]
    expect(groups.map((group) => group.term)).toEqual(['a & !b', 'a & c'])
    expect(groups[0]?.cells).toEqual([
      { row: 1, col: 0, minterm: 4 },
      { row: 1, col: 1, minterm: 5 },
    ])
    expect(groups[1]?.cells).toEqual([
      { row: 1, col: 1, minterm: 5 },
      { row: 1, col: 2, minterm: 7 },
    ])
  })

  it('circles don\'t-care cells to widen a group', async () => {
    const result = (await run({ expr: 'a & !b & c | a & !b & !c', dontCare: [6, 7] })) as Record<string, unknown>
    assertNoUndefined(result)
    expect(gridOf(result)).toEqual(['0000', '11xx'])
    expect(result.minimal).toBe('a')
    expect(result.dontCares).toEqual([6, 7])
    const groups = result.groups as Record<string, unknown>[]
    expect(groups).toHaveLength(1)
    expect(groups[0]?.cells).toEqual([
      { row: 1, col: 0, minterm: 4 },
      { row: 1, col: 1, minterm: 5 },
      { row: 1, col: 3, minterm: 6 },
      { row: 1, col: 2, minterm: 7 },
    ])
    expect(groups[0]?.wraps).toBe(false)
  })

  it('flags a group that wraps around the column edge', async () => {
    const result = (await run({ expr: '!c & (a | !a) & (b | !b)' })) as Record<string, unknown>
    expect(gridOf(result)).toEqual(['1001', '1001'])
    expect(result.minimal).toBe('!c')
    const groups = result.groups as Record<string, unknown>[]
    expect(groups[0]?.signature).toBe('--0')
    expect(groups[0]?.wraps).toBe(true)
    expect(groups[0]?.cells).toEqual([
      { row: 0, col: 0, minterm: 0 },
      { row: 0, col: 3, minterm: 2 },
      { row: 1, col: 0, minterm: 4 },
      { row: 1, col: 3, minterm: 6 },
    ])
  })

  it('lays out four variables on two axes and keeps the wrapping group intact', async () => {
    const result = (await run({ expr: '!d & (a | !a) & (b | !b) & (c | !c)' })) as Record<string, unknown>
    expect(result.rowVars).toEqual(['a', 'b'])
    expect(result.colVars).toEqual(['c', 'd'])
    expect(result.columnLabels).toEqual(['00', '01', '11', '10'])
    expect(gridOf(result)).toEqual(['1001', '1001', '1001', '1001'])
    const groups = result.groups as Record<string, unknown>[]
    expect(groups[0]?.cells).toEqual([
      { row: 0, col: 0, minterm: 0 },
      { row: 0, col: 3, minterm: 2 },
      { row: 1, col: 0, minterm: 4 },
      { row: 1, col: 3, minterm: 6 },
      { row: 3, col: 0, minterm: 8 },
      { row: 3, col: 3, minterm: 10 },
      { row: 2, col: 0, minterm: 12 },
      { row: 2, col: 3, minterm: 14 },
    ])
    expect(groups[0]?.wraps).toBe(true)
  })

  it('places two disjoint terms on a four-variable map', async () => {
    const result = (await run({ expr: '(a & b) | (c & d)' })) as Record<string, unknown>
    expect(gridOf(result)).toEqual(['0010', '0010', '1111', '0010'])
    const groups = result.groups as Record<string, unknown>[]
    expect(groups.map((group) => group.term)).toEqual(['a & b', 'c & d'])
    expect(groups[0]?.cells).toEqual([
      { row: 2, col: 0, minterm: 12 },
      { row: 2, col: 1, minterm: 13 },
      { row: 2, col: 3, minterm: 14 },
      { row: 2, col: 2, minterm: 15 },
    ])
    expect(groups[1]?.cells).toEqual([
      { row: 0, col: 2, minterm: 3 },
      { row: 1, col: 2, minterm: 7 },
      { row: 3, col: 2, minterm: 11 },
      { row: 2, col: 2, minterm: 15 },
    ])
  })

  it('shows four single-cell groups for a three-way XOR', async () => {
    const result = (await run({ expr: 'a ^ b ^ c' })) as Record<string, unknown>
    expect(gridOf(result)).toEqual(['0101', '1010'])
    const groups = result.groups as Record<string, unknown>[]
    expect(groups).toHaveLength(4)
    expect(groups.map((group) => group.cells)).toEqual([
      [{ row: 0, col: 1, minterm: 1 }],
      [{ row: 0, col: 3, minterm: 2 }],
      [{ row: 1, col: 0, minterm: 4 }],
      [{ row: 1, col: 2, minterm: 7 }],
    ])
  })

  it('reports an ambiguous cover with no essential term', async () => {
    const result = (await run({ expr: 'a & (b | c)', dontCare: [1, 2] })) as Record<string, unknown>
    expect(gridOf(result)).toEqual(['0x0x', '0111'])
    const groups = result.groups as Record<string, unknown>[]
    expect(groups.every((group) => group.essential === false)).toBe(true)
    expect(groups.map((group) => group.term)).toEqual(['a & b', 'a & c'])
  })

  it('draws a contradiction as an all-zero map with no groups', async () => {
    const result = (await run({ expr: 'a & !a' })) as Record<string, unknown>
    assertNoUndefined(result)
    expect(gridOf(result)).toEqual(['00'])
    expect(result.minimal).toBe('')
    expect(result.groups).toEqual([])
    expect(result.termCount).toBe(0)
  })

  it('draws a tautology as one group over the whole map', async () => {
    const result = (await run({ expr: 'a | !a' })) as Record<string, unknown>
    expect(gridOf(result)).toEqual(['11'])
    expect(result.minimal).toBe('1')
    const groups = result.groups as Record<string, unknown>[]
    expect(groups).toHaveLength(1)
    expect(groups[0]?.literals).toBe(0)
    expect(groups[0]?.cells).toEqual([
      { row: 0, col: 0, minterm: 0 },
      { row: 0, col: 1, minterm: 1 },
    ])
  })

  it('lays out a single-variable function as one row', async () => {
    const result = (await run({ expr: 'a' })) as Record<string, unknown>
    expect(result.rowVars).toEqual([])
    expect(result.colVars).toEqual(['a'])
    expect(result.columnLabels).toEqual(['0', '1'])
    expect(gridOf(result)).toEqual(['01'])
  })

  it('keeps unused don\'t-cares out of the groups but on the map', async () => {
    const result = (await run({ expr: 'a & b & c', dontCare: [4] })) as Record<string, unknown>
    expect(gridOf(result)).toEqual(['0000', 'x010'])
    const groups = result.groups as Record<string, unknown>[]
    expect(groups.map((group) => group.term)).toEqual(['a & b & c'])
    expect(groups[0]?.cells).toEqual([{ row: 1, col: 2, minterm: 7 }])
  })

  it('says so when a listed don\'t-care is already true', async () => {
    const result = (await run({ expr: 'a & b', dontCare: [3] })) as Record<string, unknown>
    assertNoUndefined(result)
    expect(gridOf(result)).toEqual(['00', '01'])
    expect(String(result.note)).toContain('already true')
  })

  it('refuses functions wider than the map', async () => {
    const result = (await run({ expr: 'a & b & c & d & e' })) as Record<string, unknown>
    expect(result.valid).toBe(false)
    expect(String(result.error)).toContain(`${MAX_KMAP_VARS}`)
    expect(String(result.error)).toContain('logic_minimize')
  })

  it('rejects don\'t-care indices outside the table', async () => {
    const result = (await run({ expr: 'a & b', dontCare: [4] })) as Record<string, unknown>
    expect(result.valid).toBe(false)
    expect(String(result.error)).toContain('invalid dontCare')
  })

  it('reports a parse error instead of a map', async () => {
    const result = (await run({ expr: 'a & &' })) as Record<string, unknown>
    expect(result.valid).toBe(false)
    expect(String(result.error).length).toBeGreaterThan(5)
  })

  it('renders the map, the cover and one line per group', async () => {
    const result = (await run({ expr: 'a & !b | a & c' })) as Record<string, unknown>
    const text = renderKmapText(
      kmapLayout(['a', 'b', 'c'], [4, 5, 7], [], [], []) as NonNullable<ReturnType<typeof kmapLayout>>,
      'a & !b | a & c',
      result.minimal as string,
    )
    expect(text).toContain('K-map of a & !b | a & c')
    expect(text).toContain('rows a | cols b, c')
    expect(text).toContain('minimal cover: a & !b | a & c')
    expect(text).toContain('00 01 11 10')
    expect(text).toContain('1  1  1  0')
  })

  it('renders a failure as an error line', async () => {
    const rendered = tools.logic_kmap.output.render({ expr: 'a & &' } as never, {
      valid: false,
      error: 'unexpected token',
    })
    expect(rendered[0]?.text).toBe('logic_kmap failed: unexpected token')
  })
})
