export class ExpressionError extends Error {
  constructor(
    message: string,
    readonly position: number,
  ) {
    super(message);
  }
}

export type Node =
  | { kind: 'literal'; value: string | number | boolean | null; at: number }
  | { kind: 'name'; name: string; at: number }
  | { kind: 'list'; items: Node[]; at: number }
  | { kind: 'member'; object: Node; property: string; at: number }
  | { kind: 'index'; object: Node; index: Node; at: number }
  | { kind: 'call'; callee: Node; args: Node[]; at: number }
  | { kind: 'unary'; operator: '!' | '-'; operand: Node; at: number }
  | { kind: 'binary'; operator: string; left: Node; right: Node; at: number }
  | { kind: 'ternary'; test: Node; then: Node; otherwise: Node; at: number }
  | { kind: 'elvis'; value: Node; fallback: Node; at: number };

type Token =
  | { type: 'number'; value: number; at: number }
  | { type: 'string'; value: string; at: number }
  | { type: 'name'; value: string; at: number }
  | { type: 'symbol'; value: string; at: number }
  | { type: 'end'; at: number };

const SYMBOLS = ['?:', '==', '!=', '<=', '>=', '&&', '||', '.', ',', '(', ')', '[', ']', '{', '}', '?', ':', '<', '>', '+', '-', '*', '/', '%', '!'];
const WORDS: Record<string, string> = {
  and: '&&',
  or: '||',
  not: '!',
  eq: '==',
  ne: '!=',
  lt: '<',
  gt: '>',
  le: '<=',
  ge: '>=',
};

export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const char = source[i];
    if (/\s/.test(char)) {
      i++;
      continue;
    }
    if (char === '"' || char === "'") {
      const start = i;
      let value = '';
      i++;
      for (;;) {
        if (i >= source.length) throw new ExpressionError('This text is missing its closing quote', start);
        if (source[i] === char) {
          if (source[i + 1] === char) {
            value += char;
            i += 2;
            continue;
          }
          i++;
          break;
        }
        value += source[i++];
      }
      tokens.push({ type: 'string', value, at: start });
      continue;
    }
    if (/[0-9]/.test(char)) {
      const match = /^[0-9]+(\.[0-9]+)?/.exec(source.slice(i))!;
      tokens.push({ type: 'number', value: Number(match[0]), at: i });
      i += match[0].length;
      continue;
    }
    if (/[A-Za-z_$]/.test(char)) {
      const match = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(source.slice(i))!;
      const word = WORDS[match[0].toLowerCase()];
      tokens.push(word ? { type: 'symbol', value: word, at: i } : { type: 'name', value: match[0], at: i });
      i += match[0].length;
      continue;
    }
    const symbol = SYMBOLS.find((candidate) => source.startsWith(candidate, i));
    if (!symbol) throw new ExpressionError(`“${char}” is not allowed here`, i);
    tokens.push({ type: 'symbol', value: symbol, at: i });
    i += symbol.length;
  }
  tokens.push({ type: 'end', at: source.length });
  return tokens;
}

export function parse(source: string): Node {
  if (!source.trim()) throw new ExpressionError('The expression is empty', 0);
  const tokens = tokenize(source);
  let position = 0;

  const peek = () => tokens[position];
  const isSymbol = (value: string) => {
    const token = peek();
    return token.type === 'symbol' && token.value === value;
  };
  const describe = (token: Token) =>
    token.type === 'end' ? 'the end of the expression' : `“${token.type === 'string' ? `"${token.value}"` : token.value}”`;
  const expect = (value: string) => {
    if (!isSymbol(value)) throw new ExpressionError(`Expected “${value}” but found ${describe(peek())}`, peek().at);
    position++;
  };

  function ternary(): Node {
    const test = or();
    if (isSymbol('?:')) {
      const at = tokens[position++].at;
      return { kind: 'elvis', value: test, fallback: ternary(), at };
    }
    if (isSymbol('?')) {
      const at = tokens[position++].at;
      const then = ternary();
      expect(':');
      return { kind: 'ternary', test, then, otherwise: ternary(), at };
    }
    return test;
  }

  function binary(next: () => Node, operators: string[]): () => Node {
    return () => {
      let left = next();
      for (;;) {
        const token = peek();
        if (token.type !== 'symbol' || !operators.includes(token.value)) return left;
        position++;
        left = { kind: 'binary', operator: token.value, left, right: next(), at: token.at };
      }
    };
  }

  function unary(): Node {
    const token = peek();
    if (token.type === 'symbol' && (token.value === '!' || token.value === '-')) {
      position++;
      return { kind: 'unary', operator: token.value, operand: unary(), at: token.at };
    }
    return postfix();
  }

  function items(close: string): Node[] {
    const list: Node[] = [];
    if (isSymbol(close)) {
      position++;
      return list;
    }
    for (;;) {
      list.push(ternary());
      if (isSymbol(',')) {
        position++;
        continue;
      }
      expect(close);
      return list;
    }
  }

  function postfix(): Node {
    let node = primary();
    for (;;) {
      if (isSymbol('.')) {
        position++;
        const token = peek();
        if (token.type !== 'name') throw new ExpressionError(`Expected a name after “.” but found ${describe(token)}`, token.at);
        position++;
        node = { kind: 'member', object: node, property: token.value, at: token.at };
      } else if (isSymbol('[')) {
        const at = tokens[position++].at;
        const index = ternary();
        expect(']');
        node = { kind: 'index', object: node, index, at };
      } else if (isSymbol('(')) {
        const at = tokens[position++].at;
        node = { kind: 'call', callee: node, args: items(')'), at };
      } else {
        return node;
      }
    }
  }

  function primary(): Node {
    const token = peek();
    position++;
    if (token.type === 'number' || token.type === 'string') return { kind: 'literal', value: token.value, at: token.at };
    if (token.type === 'name') {
      const lower = token.value.toLowerCase();
      if (lower === 'true' || lower === 'false') return { kind: 'literal', value: lower === 'true', at: token.at };
      if (lower === 'null') return { kind: 'literal', value: null, at: token.at };
      return { kind: 'name', name: token.value, at: token.at };
    }
    if (token.type === 'symbol' && token.value === '(') {
      const inner = ternary();
      expect(')');
      return inner;
    }
    if (token.type === 'symbol' && token.value === '{') return { kind: 'list', items: items('}'), at: token.at };
    throw new ExpressionError(`Unexpected ${describe(token)}`, token.at);
  }

  const multiplicative = binary(unary, ['*', '/', '%']);
  const additive = binary(multiplicative, ['+', '-']);
  const relational = binary(additive, ['<', '>', '<=', '>=']);
  const equality = binary(relational, ['==', '!=']);
  const and = binary(equality, ['&&']);
  const or = binary(and, ['||']);

  const tree = ternary();
  if (peek().type !== 'end') throw new ExpressionError(`Unexpected ${describe(peek())}`, peek().at);
  return tree;
}
