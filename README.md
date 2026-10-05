# dsh-boolean

Boolean algebra toolbox for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh).
Parse propositional-logic expressions and get **full truth tables with minterm/maxterm summaries,
canonical DNF/CNF, a minimized sum of products (with don't-cares), NNF, and NAND-only / NOR-only gate
networks** — no hand-drawn 16-row tables, no De Morgan slips, no hand-run Karnaugh maps.

Zero runtime dependencies, pure local math.

## Why

Modeled reasoning often derails on small logic chores: expanding `¬(a∧b)`, listing the satisfying
rows of a 3-variable expression, or checking whether two formulas say the same thing. These tools do
the bookkeeping exactly, one expression at a time.

## Install

```bash
dsh plugin --profile web add github:TYEclipse/dsh-boolean
```

Restart the profile session (or start a new one) and the five tools are registered
under `tools` for every agent. Requires `pnpm` on `PATH` (the plugin host resolves it).

## Tools

| Tool | What it does |
|------|--------------|
| `truth_table` | Enumerates every assignment row (up to 8 variables / 256 rows) with the result, minterm & maxterm indices, tautology / contradiction / satisfiability flags, and canonical DNF and CNF strings. |
| `logic_eval` | Evaluates an expression under one complete assignment (`trueVars` / `falseVars`); missing variables are reported, never silently defaulted. |
| `logic_equiv` | Compares two expressions over all rows of the combined table; reports how many rows differ and one concrete counterexample when they are not equivalent. |
| `logic_convert` | Converts an expression to `nnf`, `dnf`, `cnf`, `nand`, or `nor` canonical form. DNF/CNF come from the truth table (8-variable cap); nnf/nand/nor are structural rewrites without a cap. |
| `logic_minimize` | Minimizes to a sum of products (Quine–McCluskey): prime implicants, essential ones, and a cover of minimum term count (ties broken by fewest literals, then reading order). Optional `dontCare` minterm indices replace a hand-run Karnaugh map. |

## Expression syntax

| Meaning | Symbols | Words | Unicode |
|---------|---------|-------|---------|
| NOT (prefix) | `!` | `not` | `¬` |
| AND | `&` | `and` | `∧` |
| XOR | `^` | `xor` | `⊕` |
| OR | `\|` | `or` | `∨` |
| IMPLIES | `->` `=>` | `implies` | `→` |
| IFF | `<->` `<=>` | `iff` | `↔` |

- Variables are single letters `a`–`z` (upper case is normalized); parentheses `()` group.
- Precedence, high to low: `NOT` → `AND` → `XOR` → `OR` → `IMPLIES` → `IFF`.
- Binary operators are **left-associative**; parenthesize chains of `->` / `<->` when in doubt.
- XOR, IMPLIES and IFF are desugared at parse time to NOT/AND/OR with the textbook identities
  (`a^b ≡ (a&!b)|(!a&b)`, `a->b ≡ !a|b`, `a<->b ≡ (a&b)|(!a&!b)`).
- Expressions are limited to 512 characters; truth-table enumeration to 8 variables.

## Examples

All outputs below are real tool output (v0.1.0).

Truth table of XOR — every row plus the canonical forms:

```
truth_table { expr: "a ^ b" }
→ rows: m0(00)=0, m1(01)=1, m2(10)=1, m3(11)=0
  minterms [1,2]  DNF = (!a & b) | (a & !b)
  maxterms [0,3]  CNF = (a | b) & (!a | !b)
```

Check one row instead of the whole table:

```
logic_eval { expr: "a -> (b | c)", trueVars: ["a"], falseVars: ["b","c"] }
→ a -> (b | c) with a=true, b=false, c=false = false
```

Verify a rewrite identity (De Morgan):

```
logic_equiv { exprA: "!(a | b)", exprB: "!a & !b" }
→ equivalent: !(a | b) == !a & !b (all 4 rows agree)
```

Push negations down or build single-gate networks:

```
logic_convert { expr: "!(a & b)", operation: "nnf" } → !a | !b
logic_convert { expr: "a & b",   operation: "nand" } → NAND(NAND(a,b),NAND(a,b))
logic_convert { expr: "a | b",   operation: "nor"  } → NOR(NOR(a,b),NOR(a,b))
logic_convert { expr: "a -> b",  operation: "dnf"  } → (!a & !b) | (!a & b) | (a & b)
```

Invalid input is reported with a position and a reason instead of a wrong answer:
`a &` → `unexpected end of expression (at position 3)`; `foo & a` → variables must be single
letters `a`–`z`.

Minimize — the smallest sum of products, plus prime implicants and essentials:

```
logic_minimize { expr: "((a & b) | (a & c)) | (b & c)" }
→ a & b | a & c | b & c   (3 terms, 6 literals, proven minimum, unique)
  prime implicants: a & b m[6, 7]; a & c m[5, 7]; b & c m[3, 7]
```

Don't-cares are the Karnaugh-map move: mark rows you don't care about and the cover grows past them.

```
logic_minimize { expr: "a & !b & c | a & !b & !c", dontCare: [6, 7] }
→ a   (1 term, 1 literal; the prime implicant covers m[4,5] and the don't-cares dc[6,7])
```

Ties are resolved deterministically (fewest terms, then fewest literals, then reading order) and the
result says so instead of pretending there is only one answer:

```
logic_minimize { expr: "a & (b | c)", dontCare: [1, 2] }
→ a & b | a & c   (proven minimum, a tie was resolved — three 2-term covers exist)
```

## Notes & limits

- Truth-table tools cap at **8 variables** (256 rows); `nnf`/`nand`/`nor` conversions are
  structural and unlimited.
- `logic_eval` needs every expression variable in exactly one of `trueVars` / `falseVars`;
  listing a variable in both, or a variable name outside `a`–`z`, is an error.
- Gate outputs use function-call syntax: `NAND(a,b)` / `NOR(a,b)`, with `NOT(x)` written as
  `NAND(x,x)` or `NOR(x,x)`. Input grammar does not accept gate names — convert, don't write gates.
- Canonical DNF of a contradiction and canonical CNF of a tautology are the empty string, with an
  explanatory `note`.
- `logic_minimize` returns `""` for a function that is false on every row and `1` when the cover is
  the constant 1. The search is exhaustive with a node budget; in the (rare) case the budget is hit,
  the result is flagged `exact: false` and the cover is essentials + greedy rather than claimed
  minimal. Ties are resolved by fewest terms, then fewest literals, then reading order, so the same
  input always yields the same string.

## Development

```bash
pnpm install
pnpm build      # tsc -> dist/ (committed: git installs do not build)
pnpm test       # 144 tests: parser semantics, oracle-anchored tables (independent Python
                # enumeration), minimization, gate networks, schema guards, lossless-JSON discipline
pnpm lint       # oxlint src test
python3 test/oracle/anchors.py --check   # re-verify the oracle's own anchors
```

Test anchors are generated by an independent Python oracle (`test/oracle/anchors.py`): `itertools`
truth enumeration for the fixture, and an **exhaustive set-cover search** over all cubes in
`{0,1,-}^n` for minimization — no Quine–McCluskey code is shared with the plugin, so agreement
between oracle and implementation is evidence rather than a tautology. Every DNF/CNF string, truth
row, minimized cover, prime-implicant list and uniqueness flag in the tests is printed by that
oracle (regenerate the fixture with `python3 test/oracle/anchors.py --write-fixture`).

## License

MIT — see [LICENSE](LICENSE).
