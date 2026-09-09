/**
 * dsh-boolean — boolean algebra engine.
 *
 * Parses propositional-logic expressions over single-letter variables a-z,
 * desugars XOR / IMPLIES / IFF into NOT / AND / OR, and provides:
 *   - truth-table enumeration with minterm / maxterm indices
 *   - evaluation under a full assignment
 *   - canonical DNF / CNF strings (from the table)
 *   - NNF rewriting
 *   - NAND-only / NOR-only gate networks (structural rewrite)
 *
 * Pure local computation: no network, no processes, no eval.
 *
 * Operator syntax (precedence high -> low):
 *   NOT   !  not  ¬        (prefix, tightest)
 *   AND   &  and  ∧
 *   XOR   ^  xor  ⊕        (desugars to (a&!b)|(!a&b))
 *   OR    |  or   ∨
 *   IMPLIES -> => →        (desugars to !a|b)
 *   IFF   <-> <=> ↔        (desugars to (a&b)|(!a&!b), lowest)
 * Binary operators are left-associative; parentheses () group.
 * Variables are single letters a-z (upper case is normalized to lower).
 *
 * @module dsh-boolean/boolean
 */
export const MAX_TABLE_VARS = 8;
export const MAX_EXPR_LENGTH = 512;
export class BooleanParseError extends Error {
    position;
    constructor(message, position) {
        super(`${message} (at position ${position})`);
        this.position = position;
        this.name = 'BooleanParseError';
    }
}
const WORD_OPS = {
    not: 'not',
    and: 'and',
    xor: 'xor',
    or: 'or',
    implies: 'implies',
    iff: 'iff',
};
const SYMBOL_OPS = {
    '!': 'not',
    '¬': 'not',
    '&': 'and',
    '∧': 'and',
    '|': 'or',
    '∨': 'or',
    '^': 'xor',
    '⊕': 'xor',
    '→': 'implies',
    '↔': 'iff',
};
/** Binary-operator binding power (higher binds tighter); NOT is handled as a prefix. */
const PREC = { iff: 10, implies: 20, or: 30, xor: 40, and: 50 };
function isLetter(ch) {
    return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z');
}
function tokenize(input) {
    const tokens = [];
    let i = 0;
    const n = input.length;
    while (i < n) {
        const ch = input[i];
        if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
            i += 1;
            continue;
        }
        const pos = i;
        if (isLetter(ch)) {
            let word = '';
            while (i < n && isLetter(input[i])) {
                word += input[i];
                i += 1;
            }
            const lower = word.toLowerCase();
            const op = WORD_OPS[lower];
            if (op !== undefined) {
                tokens.push({ kind: 'op', op, pos });
            }
            else if (word.length === 1) {
                tokens.push({ kind: 'var', name: lower, pos });
            }
            else {
                throw new BooleanParseError(`unknown identifier '${word}': variables are single letters a-z; keywords are and/or/xor/not/implies/iff`, pos);
            }
            continue;
        }
        const uniOp = SYMBOL_OPS[ch];
        if (uniOp !== undefined) {
            tokens.push({ kind: 'op', op: uniOp, pos });
            i += 1;
            continue;
        }
        if (ch === '(') {
            tokens.push({ kind: 'lparen', pos });
            i += 1;
            continue;
        }
        if (ch === ')') {
            tokens.push({ kind: 'rparen', pos });
            i += 1;
            continue;
        }
        if (ch === '-') {
            const next = input[i + 1];
            if (next !== '>')
                throw new BooleanParseError("expected '>' after '-' to form '->' (implies)", pos);
            tokens.push({ kind: 'op', op: 'implies', pos });
            i += 2;
            continue;
        }
        if (ch === '=') {
            const next = input[i + 1];
            if (next !== '>')
                throw new BooleanParseError("expected '>' after '=' to form '=>' (implies)", pos);
            tokens.push({ kind: 'op', op: 'implies', pos });
            i += 2;
            continue;
        }
        if (ch === '<') {
            const next = input[i + 1];
            if (next === '-' && input[i + 2] === '>') {
                tokens.push({ kind: 'op', op: 'iff', pos });
                i += 3;
                continue;
            }
            if (next === '=' && input[i + 2] === '>') {
                tokens.push({ kind: 'op', op: 'iff', pos });
                i += 3;
                continue;
            }
            throw new BooleanParseError("expected '<->' (iff); '<' alone is not valid", pos);
        }
        throw new BooleanParseError(`unexpected character '${ch}'`, pos);
    }
    tokens.push({ kind: 'eof', pos: n });
    return tokens;
}
function mkNot(operand) {
    return { type: 'not', operand };
}
function mkBin(op, a, b) {
    if (op === 'and')
        return { type: 'and', left: a, right: b };
    if (op === 'or')
        return { type: 'or', left: a, right: b };
    if (op === 'xor')
        return { type: 'or', left: mkAnd(a, mkNot(b)), right: mkAnd(mkNot(a), b) };
    if (op === 'implies')
        return { type: 'or', left: mkNot(a), right: b };
    return { type: 'or', left: mkAnd(a, b), right: mkAnd(mkNot(a), mkNot(b)) };
}
function mkAnd(a, b) {
    return { type: 'and', left: a, right: b };
}
/** Parse a boolean expression into a desugared AST (only var/not/and/or). */
export function parseExpression(input) {
    if (input.trim().length === 0)
        throw new BooleanParseError('empty expression', 0);
    if (input.length > MAX_EXPR_LENGTH) {
        throw new BooleanParseError(`expression too long (${input.length} chars, limit ${MAX_EXPR_LENGTH})`, 0);
    }
    const tokens = tokenize(input);
    let idx = 0;
    function peek() {
        return tokens[idx];
    }
    function advance() {
        const t = tokens[idx];
        idx += 1;
        return t;
    }
    function parseUnary() {
        const t = peek();
        if (t.kind === 'op' && t.op === 'not') {
            advance();
            return mkNot(parseUnary());
        }
        if (t.kind === 'lparen') {
            advance();
            const inner = parseBinary(0);
            const close = peek();
            if (close.kind !== 'rparen') {
                throw new BooleanParseError("expected ')'", close.pos);
            }
            advance();
            return inner;
        }
        if (t.kind === 'var') {
            advance();
            return { type: 'var', name: t.name };
        }
        if (t.kind === 'eof') {
            throw new BooleanParseError('unexpected end of expression', t.pos);
        }
        throw new BooleanParseError('expected a variable, "not", or "("', t.pos);
    }
    function parseBinary(minPrec) {
        let left = parseUnary();
        for (;;) {
            const t = peek();
            if (t.kind === 'op' && t.op !== 'not') {
                const op = t.op;
                const prec = PREC[op];
                if (prec < minPrec)
                    break;
                advance();
                const right = parseBinary(prec + 1);
                left = mkBin(op, left, right);
                continue;
            }
            break;
        }
        return left;
    }
    const result = parseBinary(0);
    const tail = peek();
    if (tail.kind !== 'eof') {
        throw new BooleanParseError('unexpected trailing input', tail.pos);
    }
    return result;
}
/** All distinct variables of an expression, sorted alphabetically. */
export function expressionVars(node) {
    const seen = new Set();
    function walk(n) {
        if (n.type === 'var') {
            seen.add(n.name);
            return;
        }
        if (n.type === 'not') {
            walk(n.operand);
            return;
        }
        walk(n.left);
        walk(n.right);
    }
    walk(node);
    return [...seen].sort();
}
/** Evaluate under a complete assignment. Missing variables throw. */
export function evaluate(node, env) {
    if (node.type === 'var') {
        const v = env.get(node.name);
        if (v === undefined)
            throw new Error(`missing value for variable '${node.name}'`);
        return v;
    }
    if (node.type === 'not')
        return !evaluate(node.operand, env);
    if (node.type === 'and')
        return evaluate(node.left, env) && evaluate(node.right, env);
    return evaluate(node.left, env) || evaluate(node.right, env);
}
/**
 * Enumerate all 2^n rows over the given (sorted) variables.
 * Row index is the binary number with vars[0] as the most significant bit,
 * matching the conventional minterm numbering (m0 = all false ... m(2^n-1) = all true).
 */
export function truthTable(node, vars) {
    const count = vars.length;
    const rows = [];
    const minterms = [];
    const maxterms = [];
    const total = 2 ** count;
    for (let index = 0; index < total; index += 1) {
        const assignment = {};
        for (let bit = 0; bit < count; bit += 1) {
            const varName = vars[bit];
            assignment[varName] = ((index >> (count - 1 - bit)) & 1) === 1;
        }
        const result = evaluate(node, new Map(Object.entries(assignment)));
        rows.push({ index, assignment, result });
        if (result)
            minterms.push(index);
        else
            maxterms.push(index);
    }
    return { rows, minterms, maxterms };
}
/** Canonical DNF string from minterm indices over the given vars; '' when there are none. */
export function dnfFromMinterms(minterms, vars) {
    return minterms.map((m) => `(${mintermString(m, vars)})`).join(' | ');
}
/** Canonical CNF string from maxterm indices over the given vars; '' when there are none. */
export function cnfFromMaxterms(maxterms, vars) {
    return maxterms.map((m) => `(${maxtermString(m, vars)})`).join(' & ');
}
function mintermString(index, vars) {
    const count = vars.length;
    const literals = [];
    for (let bit = 0; bit < count; bit += 1) {
        const varName = vars[bit];
        const value = ((index >> (count - 1 - bit)) & 1) === 1;
        literals.push(value ? varName : `!${varName}`);
    }
    return literals.join(' & ');
}
function maxtermString(index, vars) {
    const count = vars.length;
    const literals = [];
    for (let bit = 0; bit < count; bit += 1) {
        const varName = vars[bit];
        const value = ((index >> (count - 1 - bit)) & 1) === 1;
        literals.push(value ? `!${varName}` : varName);
    }
    return literals.join(' | ');
}
/** Negation normal form: push every NOT down to the variables. */
export function toNnf(node) {
    function pushNot(x) {
        if (x.type === 'var')
            return { type: 'not', operand: x };
        if (x.type === 'not')
            return toNnf(x.operand);
        if (x.type === 'and')
            return { type: 'or', left: pushNot(x.left), right: pushNot(x.right) };
        return { type: 'and', left: pushNot(x.left), right: pushNot(x.right) };
    }
    if (node.type === 'var')
        return node;
    if (node.type === 'not')
        return pushNot(node.operand);
    if (node.type === 'and')
        return { type: 'and', left: toNnf(node.left), right: toNnf(node.right) };
    return { type: 'or', left: toNnf(node.left), right: toNnf(node.right) };
}
function precOf(x) {
    if (x.type === 'var')
        return 4;
    if (x.type === 'not')
        return 3;
    if (x.type === 'and')
        return 2;
    return 1;
}
/** Infix rendering with minimal parentheses (only & | ! remain after desugaring). */
export function render(node) {
    function renderOperand(x, parentPrec) {
        const text = renderNode(x);
        const prec = precOf(x);
        if (prec < parentPrec)
            return `(${text})`;
        return text;
    }
    function renderNode(x) {
        if (x.type === 'var')
            return x.name;
        if (x.type === 'not') {
            const inner = renderNode(x.operand);
            if (x.operand.type === 'and' || x.operand.type === 'or')
                return `!(${inner})`;
            return `!${inner}`;
        }
        if (x.type === 'and') {
            return `${renderOperand(x.left, precOf(x))} & ${renderOperand(x.right, precOf(x))}`;
        }
        return `${renderOperand(x.left, precOf(x))} | ${renderOperand(x.right, precOf(x))}`;
    }
    return renderNode(node);
}
function gateArgs(a, b) {
    return `${a},${b}`;
}
/** NAND-only network: NOT(x)=NAND(x,x), AND(a,b)=NAND(NAND(a,b),NAND(a,b)), OR(a,b)=NAND(NAND(a,a),NAND(b,b)). */
export function nandForm(node) {
    function g(x) {
        if (x.type === 'var')
            return x.name;
        if (x.type === 'not')
            return `NAND(${g(x.operand)},${g(x.operand)})`;
        if (x.type === 'and') {
            const l = g(x.left);
            const r = g(x.right);
            const core = `NAND(${gateArgs(l, r)})`;
            return `NAND(${gateArgs(core, core)})`;
        }
        const l = g(x.left);
        const r = g(x.right);
        return `NAND(${gateArgs(`NAND(${gateArgs(l, l)})`, `NAND(${gateArgs(r, r)})`)})`;
    }
    return g(node);
}
/** NOR-only network: NOT(x)=NOR(x,x), OR(a,b)=NOR(NOR(a,b),NOR(a,b)), AND(a,b)=NOR(NOR(a,a),NOR(b,b)). */
export function norForm(node) {
    function g(x) {
        if (x.type === 'var')
            return x.name;
        if (x.type === 'not')
            return `NOR(${g(x.operand)},${g(x.operand)})`;
        if (x.type === 'or') {
            const l = g(x.left);
            const r = g(x.right);
            const core = `NOR(${gateArgs(l, r)})`;
            return `NOR(${gateArgs(core, core)})`;
        }
        const l = g(x.left);
        const r = g(x.right);
        return `NOR(${gateArgs(`NOR(${gateArgs(l, l)})`, `NOR(${gateArgs(r, r)})`)})`;
    }
    return g(node);
}
//# sourceMappingURL=boolean.js.map