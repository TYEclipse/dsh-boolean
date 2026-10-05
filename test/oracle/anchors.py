#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""anchors.py — independent Python oracle for dsh-boolean (v0.2.0).

Every numeric / textual expectation asserted in ``test/boolean.test.ts``,
``test/tools.test.ts`` and ``test/minimize.test.ts`` is produced here, from
primitives that share no code with the TypeScript implementation:

  * expression parsing + evaluation — a small recursive-descent parser written
    from the published grammar (NOT > AND > XOR > OR > IMPLIES > IFF, left
    associative, XOR/IMPLIES/IFF desugared), independent of ``src/boolean.ts``
  * truth tables — plain ``itertools.product`` enumeration
  * minimization — **exhaustive** set-cover search: enumerate every cube in
    ``{0,1,-}^n``, keep those fully inside ``on ∪ dc``, drop every cube that is a
    subset of another valid cube (prime implicants), force the essential ones,
    then brute-force every subset of the remaining candidates with
    ``itertools.combinations`` by increasing size. No Quine–McCluskey grouping
    and no branch-and-bound heuristic is shared with the plugin, so agreement is
    evidence rather than a tautology.

Sections mirror the test files so a reviewer can walk assertion -> anchor:

  A. legacy fixture anchors (v0.1.x): 16 curated expressions (rows / minterms /
     maxterms / DNF / CNF) and 11 identity pairs — also regenerates
     ``test/fixtures/anchors.json`` (``--write-fixture``)
  B. minimize anchors (v0.2.0): curated on-set / don't-care cases with the
     minimal cover, its cost, prime implicants and the uniqueness flag
  C. constants used by tests: variable cap, expression length cap, tool count

Usage:
  python3 test/oracle/anchors.py                  # print every anchor
  python3 test/oracle/anchors.py --json           # machine-readable anchors
  python3 test/oracle/anchors.py --write-fixture  # regenerate test/fixtures/anchors.json
  python3 test/oracle/anchors.py --check          # self-check printed anchors
"""

from __future__ import annotations

import argparse
import itertools
import json
import sys
from pathlib import Path

# --------------------------------------------------------------------------- #
# A tiny independent parser (same published grammar as the plugin, no shared code)
# --------------------------------------------------------------------------- #

WORD_OPS = {"not", "and", "xor", "or", "implies", "iff"}
SYMBOL_OPS = {"!": "not", "¬": "not", "&": "and", "∧": "and", "|": "or", "∨": "or",
              "^": "xor", "⊕": "xor", "→": "implies", "↔": "iff"}
PREC = {"iff": 10, "implies": 20, "or": 30, "xor": 40, "and": 50}


def tokenize(text: str) -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    i = 0
    while i < len(text):
        ch = text[i]
        if ch.isspace():
            i += 1
            continue
        if ch.isalpha():
            j = i
            while j < len(text) and text[j].isalpha():
                j += 1
            word = text[i:j]
            low = word.lower()
            if low in WORD_OPS:
                out.append(("op", low))
            elif len(word) == 1:
                out.append(("var", low))
            else:
                raise ValueError(f"unknown identifier {word!r}")
            i = j
            continue
        for sym in ("<->", "<=>", "->", "=>"):
            if text.startswith(sym, i):
                out.append(("op", "iff" if sym in ("<->", "<=>") else "implies"))
                i += len(sym)
                break
        else:
            if ch in SYMBOL_OPS:
                out.append(("op", SYMBOL_OPS[ch]))
                i += 1
            elif ch == "(":
                out.append(("lparen", "("))
                i += 1
            elif ch == ")":
                out.append(("rparen", ")"))
                i += 1
            else:
                raise ValueError(f"unexpected character {ch!r}")
    out.append(("eof", ""))
    return out


def parse(text: str):
    tokens = tokenize(text)
    pos = 0

    def peek():
        return tokens[pos]

    def advance():
        nonlocal pos
        tok = tokens[pos]
        pos += 1
        return tok

    def unary():
        tok = peek()
        if tok == ("op", "not"):
            advance()
            return ("not", unary())
        if tok[0] == "lparen":
            advance()
            inner = binary(0)
            if peek()[0] != "rparen":
                raise ValueError("expected ')'")
            advance()
            return inner
        if tok[0] == "var":
            advance()
            return ("var", tok[1])
        raise ValueError("expected variable, not, or (")

    def binary(min_prec: int):
        left = unary()
        while True:
            tok = peek()
            if tok[0] != "op" or tok[1] == "not":
                break
            op = tok[1]
            if PREC[op] < min_prec:
                break
            advance()
            right = binary(PREC[op] + 1)
            left = (op, left, right)
        return left

    tree = binary(0)
    if peek()[0] != "eof":
        raise ValueError("trailing input")
    return tree


def variables(node) -> list[str]:
    if node[0] == "var":
        return [node[1]]
    if node[0] == "not":
        return variables(node[1])
    return sorted(set(variables(node[1])) | set(variables(node[2])))


def evaluate(node, env: dict[str, bool]) -> bool:
    kind = node[0]
    if kind == "var":
        return env[node[1]]
    if kind == "not":
        return not evaluate(node[1], env)
    if kind == "and":
        return evaluate(node[1], env) and evaluate(node[2], env)
    if kind == "or":
        return evaluate(node[1], env) or evaluate(node[2], env)
    if kind == "xor":
        return evaluate(node[1], env) != evaluate(node[2], env)
    if kind == "implies":
        return (not evaluate(node[1], env)) or evaluate(node[2], env)
    if kind == "iff":
        return evaluate(node[1], env) == evaluate(node[2], env)
    raise ValueError(kind)


def minterm_bits(index: int, count: int) -> list[int]:
    return [(index >> (count - 1 - bit)) & 1 for bit in range(count)]


def minterm_string(index: int, vars_: list[str]) -> str:
    count = len(vars_)
    return " & ".join(v if b else f"!{v}" for v, b in zip(vars_, minterm_bits(index, count)))


def maxterm_string(index: int, vars_: list[str]) -> str:
    count = len(vars_)
    return " | ".join(f"!{v}" if b else v for v, b in zip(vars_, minterm_bits(index, count)))


def table_of(expr: str) -> dict:
    node = parse(expr)
    vars_ = variables(node)
    rows = []
    minterms = []
    maxterms = []
    for index in range(2 ** len(vars_)):
        bits = minterm_bits(index, len(vars_))
        env = {v: bool(b) for v, b in zip(vars_, bits)}
        result = evaluate(node, env)
        rows.append({"index": index, "bits": bits, "result": 1 if result else 0})
        (minterms if result else maxterms).append(index)
    return {
        "expr": expr,
        "vars": vars_,
        "rows": rows,
        "minterms": minterms,
        "maxterms": maxterms,
        "dnf": " | ".join(f"({minterm_string(m, vars_)})" for m in minterms),
        "cnf": " & ".join(f"({maxterm_string(m, vars_)})" for m in maxterms),
    }


def are_equivalent(a: str, b: str) -> bool:
    na, nb = parse(a), parse(b)
    vars_ = sorted(set(variables(na)) | set(variables(nb)))
    rows = []
    for index in range(2 ** len(vars_)):
        env = {v: bool(b_) for v, b_ in zip(vars_, minterm_bits(index, len(vars_)))}
        rows.append((evaluate(na, env), evaluate(nb, env)))
    return all(x == y for x, y in rows)


# --------------------------------------------------------------------------- #
# Exhaustive minimization (independent of the plugin's Quine–McCluskey engine)
# --------------------------------------------------------------------------- #

def _signature(pattern) -> str:
    return "".join("-" if v is None else str(v) for v in pattern)


def _sort_key(pattern) -> str:
    """Ordering key: fixed literals sort before free ones, then reading order."""
    return _signature(pattern).replace("-", "2")


def _term(pattern, vars_: list[str]) -> str:
    parts = [v if bit == 1 else f"!{v}" for v, bit in zip(vars_, pattern) if bit is not None]
    return " & ".join(parts) if parts else "1"


def _cover(pattern, n: int) -> frozenset[int]:
    out = []
    for m in range(1 << n):
        bits = minterm_bits(m, n)
        if all(v is None or v == bits[i] for i, v in enumerate(pattern)):
            out.append(m)
    return frozenset(out)


def minimize(expr: str, dont_care: list[int]) -> dict:
    """Minimum SOP over the variables of ``expr`` (exhaustive search)."""
    node = parse(expr)
    vars_ = variables(node)
    n = len(vars_)
    total = 1 << n
    table = table_of(expr)
    on = set(table["minterms"])
    dc = {m for m in dont_care if 0 <= m < total} - on
    care = on | dc

    # every cube fully inside the care set
    cubes = []
    for pattern in itertools.product((0, 1, None), repeat=n):
        covered = _cover(pattern, n)
        if covered <= care:
            cubes.append((pattern, covered))

    # prime implicants: valid cubes that are not a subset of another valid cube
    primes = [(p, c) for p, c in cubes if not any(c < c2 for _, c2 in cubes)]
    primes.sort(key=lambda pc: (n - pc[0].count(None), _sort_key(pc[0])))

    # essential prime implicants
    essentials = []
    for pattern, covered in primes:
        for m in covered & on:
            if sum(1 for _, c2 in primes if m in c2) == 1:
                essentials.append((pattern, covered))
                break

    must = frozenset().union(*[c for _, c in essentials]) & frozenset(on) if essentials else frozenset()
    candidates = [(p, c) for p, c in primes if (p, c) not in essentials]
    target = frozenset(on)

    best = None  # (terms, literals, tuple(sorted sort keys))
    covers = 0
    for size in range(0, len(candidates) + 1):
        improved = False
        for combo in itertools.combinations(candidates, size):
            covered = must | frozenset().union(*[c for _, c in combo]) if combo else must
            if not target <= covered:
                continue
            literals = sum(n - p.count(None) for p, _ in list(essentials) + list(combo))
            keys = tuple(sorted([_sort_key(p) for p, _ in essentials] + [_sort_key(p) for p, _ in combo]))
            terms = len(keys)
            if best is None or (terms, literals) < (best[0], best[1]):
                best = (terms, literals, keys)
                covers = 1
                improved = True
            elif (terms, literals) == (best[0], best[1]):
                covers += 1
                if keys < best[2]:
                    best = (terms, literals, keys)
                improved = True
        if best is not None and not improved:
            break

    if best is None:
        raise AssertionError(f"no cover found for {expr!r} dc={sorted(dc)} — oracle bug, do not trust this run")
    terms, literals, keys = best
    by_key = {_sort_key(p): _term(p, vars_) for p, _ in primes}
    return {
        "expr": expr,
        "vars": vars_,
        "minterms": sorted(on),
        "dontCares": sorted(dc),
        "minimal": " | ".join(by_key[k] for k in keys),
        "termCount": terms,
        "literalCount": literals,
        "primeImplicantCount": len(primes),
        "primeImplicants": [{"term": _term(p, vars_), "signature": _signature(p),
                             "literals": n - p.count(None),
                             "covers": sorted(c & on), "coversDontCare": sorted(c & dc)}
                            for p, c in primes],
        "essentialTerms": [t for t in (_term(p, vars_) for p, _ in essentials)],
        "unique": covers == 1,
        "minimumCoverCount": covers,
    }


# --------------------------------------------------------------------------- #
# Curated case tables (inputs live here; expected values are computed above)
# --------------------------------------------------------------------------- #

LEGACY_EXPRS = [
    "a & b", "a | b", "a ^ b", "a -> b", "a <-> b", "!(a & b)", "a | !a", "a & !a",
    "(a & b) | (!a & c)", "a ^ b ^ c", "((a & b) | (a & c)) | (b & c)", "!(!a | b)",
    "a & (b | c)", "(a | b) & (a | c)", "!(a | b) <-> (!a & !b)", "(a ^ b) & c",
]

LEGACY_EQUIV = [
    ("!(a & b)", "!a | !b", True), ("!(a | b)", "!a & !b", True),
    ("a ^ b", "(a & !b) | (!a & b)", True), ("a -> b", "!a | b", True),
    ("a <-> b", "(a & b) | (!a & !b)", True), ("!!a", "a", True),
    ("a & (b | c)", "(a & b) | (a & c)", True), ("a | (b & c)", "(a | b) & (a | c)", True),
    ("a ^ b", "a | b", False), ("a & !a", "a | !a", False), ("a -> b", "b -> a", False),
]

# (expression, don't-care minterms) — inputs only; every expected value is derived
MINIMIZE_CASES = [
    ("a & b | a & !b", []),                       # absorption: collapses to a
    ("((a & b) | (a & c)) | (b & c)", []),        # 3-variable majority
    ("a ^ b ^ c", []),                            # three-way XOR (no cube merges)
    ("a & !b & c | a & !b & !c", [6, 7]),         # don't-cares widen a & !b to a
    ("a & (b | c)", [1, 2]),                      # three equal-cost covers -> not unique
    ("a & !a", []),                               # contradiction
    ("a | !a", []),                               # tautology
    ("a & b", [0, 1, 2]),                         # don't-cares cover the whole table
    ("!a & !b", []),                              # already minimal
    ("(a & b) | (c & d)", []),                    # two disjoint product terms, 4 vars
    ("a & b & c", [4]),                           # don't-cares present but unused
]

CONSTANTS = {
    "maxTableVars": 8,
    "maxExprLength": 512,
    "toolCount": 5,
    "defaultNodeBudget": 300000,
    "legacyExprCount": len(LEGACY_EXPRS),
    "legacyEquivCount": len(LEGACY_EQUIV),
}


def all_anchors() -> dict:
    return {
        "constants": CONSTANTS,
        "legacy": {
            "exprs": [table_of(e) for e in LEGACY_EXPRS],
            "equiv": [{"a": a, "b": b, "equivalent": ok} for a, b, ok in LEGACY_EQUIV],
        },
        "minimize": [minimize(e, dc) for e, dc in MINIMIZE_CASES],
    }


def fixture_payload(data: dict) -> dict:
    return {"exprs": data["legacy"]["exprs"], "equiv": data["legacy"]["equiv"]}


def check(data: dict) -> int:
    """Self-check: textbook identities plus regression pins on every curated case."""
    failures: list[str] = []

    def expect(cond: bool, label: str) -> None:
        if not cond:
            failures.append(label)

    # A. known identities / textbook truth tables (independent of the engine)
    expect(are_equivalent("a ^ b", "(a & !b) | (!a & b)"), "xor definition")
    expect(not are_equivalent("a -> b", "b -> a"), "implies is not symmetric")
    expect(table_of("a | !a")["minterms"] == [0, 1], "tautology over one variable")
    expect(table_of("a & b")["minterms"] == [3], "conjunction minterms")
    expect(table_of("a ^ b ^ c")["minterms"] == [1, 2, 4, 7], "three-way xor minterms")

    # B. minimization regression pins (values read from this oracle, then pinned)
    by_expr = {}
    for item in data["minimize"]:
        by_expr.setdefault(item["expr"], []).append(item)

    def case(expr: str, dc: list[int]) -> dict:
        """Look up a curated case by expression + effective don't-care set."""
        for item in by_expr[expr]:
            if item["dontCares"] == sorted(dc):
                return item
        raise AssertionError(f"case {expr!r} dc={dc} missing")

    absorb = by_expr["a & b | a & !b"][0]
    expect(absorb["minimal"] == "a" and (absorb["termCount"], absorb["literalCount"]) == (1, 1),
           "absorption collapses to a")
    maj = by_expr["((a & b) | (a & c)) | (b & c)"][0]
    expect(maj["minimal"] == "a & b | a & c | b & c", "majority minimal form")
    expect((maj["termCount"], maj["literalCount"]) == (3, 6), "majority cost")
    expect(len(maj["essentialTerms"]) == 3, "majority: every prime implicant is essential")
    xor3 = by_expr["a ^ b ^ c"][0]
    expect((xor3["termCount"], xor3["literalCount"]) == (4, 12), "three-way xor cost")
    widened = by_expr["a & !b & c | a & !b & !c"][0]
    expect(widened["minimal"] == "a", "don't-cares widen the cover")
    expect(widened["primeImplicants"][0]["coversDontCare"] == [6, 7], "widened cube spans the don't-cares")
    contra = by_expr["a & !a"][0]
    expect(contra["minimal"] == "" and contra["termCount"] == 0 and contra["primeImplicantCount"] == 0,
           "contradiction has an empty cover")
    taut = by_expr["a | !a"][0]
    expect(taut["minimal"] == "1" and taut["literalCount"] == 0, "tautology is the constant 1")
    filled = case("a & b", [0, 1, 2])
    expect(filled["minimal"] == "1", "full don't-care coverage gives the constant 1")
    plain = case("a & b & c", [4])
    expect(plain["minimal"] == "a & b & c" and plain["unique"] is True,
           "unused don't-cares leave the cover alone")
    disjoint = by_expr["(a & b) | (c & d)"][0]
    expect(disjoint["minimal"] == "a & b | c & d" and disjoint["primeImplicantCount"] == 2,
           "disjoint products stay two terms over four variables")
    amb = by_expr["a & (b | c)"][0]
    expect(amb["minimumCoverCount"] == 3 and amb["unique"] is False, "three equal-cost covers are all found")
    expect(amb["minimal"] == "a & b | a & c", "ties resolve to the smallest sorted key list")
    expect(amb["essentialTerms"] == [], "the ambiguous case has no essential prime implicant")

    # C. the returned cover really covers the on-set and invents no true row, for every case
    for item in data["minimize"]:
        vars_ = item["vars"]
        covered = set()
        if item["minimal"] != "":
            for m in range(1 << len(vars_)):
                env = {v: bool(b) for v, b in zip(vars_, minterm_bits(m, len(vars_)))}
                if item["minimal"] == "1" or evaluate(parse(item["minimal"]), env):
                    covered.add(m)
        on = set(item["minterms"])
        expect(on <= covered, f"{item['expr']}: cover misses on-minterms")
        outside = covered - on - set(item["dontCares"])
        expect(not outside, f"{item['expr']}: cover invents true rows outside on ∪ dc")

    for label in failures:
        print(f"❌ {label}", file=sys.stderr)
    print(f"{'✅' if not failures else '❌'} oracle self-check: {len(failures)} failure(s)")
    return 1 if failures else 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="independent oracle for dsh-boolean")
    parser.add_argument("--json", action="store_true", help="print anchors as JSON")
    parser.add_argument("--write-fixture", action="store_true", help="regenerate test/fixtures/anchors.json")
    parser.add_argument("--check", action="store_true", help="self-check the anchors")
    args = parser.parse_args(argv)

    data = all_anchors()
    if args.write_fixture:
        target = Path(__file__).resolve().parent.parent / "fixtures" / "anchors.json"
        target.write_text(json.dumps(fixture_payload(data), indent=1) + "\n", encoding="utf-8")
        print(f"wrote {target}")
    if args.json:
        print(json.dumps(data, ensure_ascii=False, indent=1))
    elif args.check:
        return check(data)
    elif not args.write_fixture:
        print("== A. legacy fixture anchors ==")
        for item in data["legacy"]["exprs"]:
            print(f"{item['expr']:<28} vars={item['vars']} minterms={item['minterms']} maxterms={item['maxterms']}")
            print(f"{'':<28} dnf={item['dnf']}")
            print(f"{'':<28} cnf={item['cnf']}")
        for pair in data["legacy"]["equiv"]:
            print(f"equiv {pair['a']} <-> {pair['b']}: {pair['equivalent']}")
        print("\n== B. minimize anchors ==")
        for item in data["minimize"]:
            print(f"{item['expr']} dc={item['dontCares']}")
            print(f"   minterms={item['minterms']} minimal={item['minimal']!r} "
                  f"terms={item['termCount']} literals={item['literalCount']} "
                  f"primes={item['primeImplicantCount']} unique={item['unique']} "
                  f"covers={item['minimumCoverCount']}")
            print(f"   essential={item['essentialTerms']}")
            for pi in item["primeImplicants"]:
                print(f"   PI {pi['term']:<22} sig={pi['signature']} lit={pi['literals']} "
                      f"on={pi['covers']} dc={pi['coversDontCare']}")
        print("\n== C. constants ==")
        print(json.dumps(data["constants"], ensure_ascii=False))
    if args.check:
        return check(data)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
