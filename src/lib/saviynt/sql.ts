export class SqlError extends Error {
  constructor(
    message: string,
    readonly position: number,
  ) {
    super(message);
  }
}

export type SqlValue = string | number | null;

export type Node =
  | { kind: 'literal'; value: SqlValue; at: number }
  | { kind: 'column'; name: string; at: number }
  | { kind: 'call'; name: string; args: Node[]; at: number }
  | { kind: 'unary'; operator: 'NOT' | '-'; operand: Node; at: number }
  | { kind: 'binary'; operator: string; left: Node; right: Node; at: number }
  | { kind: 'isNull'; operand: Node; negated: boolean; at: number }
  | { kind: 'in'; operand: Node; list: Node[]; negated: boolean; at: number }
  | { kind: 'case'; operand?: Node; branches: { when: Node; then: Node }[]; otherwise?: Node; at: number };

type Token =
  | { type: 'number'; value: number; at: number }
  | { type: 'string'; value: string; at: number }
  | { type: 'word'; value: string; at: number }
  | { type: 'symbol'; value: string; at: number }
  | { type: 'end'; at: number };

const SYMBOLS = ['<>', '!=', '<=', '>=', '||', '&&', '(', ')', ',', '.', '=', '<', '>', '+', '-', '*', '/', '%'];

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const char = source[i];
    if (/\s/.test(char)) {
      i++;
      continue;
    }
    if (char === "'" || char === '"') {
      const start = i;
      let value = '';
      i++;
      for (;;) {
        if (i >= source.length) throw new SqlError('This text is missing its closing quote', start);
        const current = source[i];
        if (current === '\\' && i + 1 < source.length) {
          const next = source[i + 1];
          value += next === 'n' ? '\n' : next === 't' ? '\t' : next;
          i += 2;
          continue;
        }
        if (current === char) {
          if (source[i + 1] === char) {
            value += char;
            i += 2;
            continue;
          }
          i++;
          break;
        }
        value += current;
        i++;
      }
      tokens.push({ type: 'string', value, at: start });
      continue;
    }
    if (char === '`') {
      const end = source.indexOf('`', i + 1);
      if (end === -1) throw new SqlError('This name is missing its closing backtick', i);
      tokens.push({ type: 'word', value: source.slice(i + 1, end), at: i });
      i = end + 1;
      continue;
    }
    if (/[0-9]/.test(char)) {
      const match = /^[0-9]+(\.[0-9]+)?/.exec(source.slice(i))!;
      tokens.push({ type: 'number', value: Number(match[0]), at: i });
      i += match[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(char)) {
      const match = /^[A-Za-z_][A-Za-z0-9_$]*/.exec(source.slice(i))!;
      tokens.push({ type: 'word', value: match[0], at: i });
      i += match[0].length;
      continue;
    }
    const symbol = SYMBOLS.find((candidate) => source.startsWith(candidate, i));
    if (!symbol) throw new SqlError(`“${char}” is not allowed here`, i);
    tokens.push({ type: 'symbol', value: symbol, at: i });
    i += symbol.length;
  }
  tokens.push({ type: 'end', at: source.length });
  return tokens;
}

const KEYWORDS = new Set(['AND', 'OR', 'NOT', 'IS', 'LIKE', 'IN', 'WHEN', 'THEN', 'ELSE', 'END']);

export function parseSql(source: string): Node {
  if (!source.trim()) throw new SqlError('The rule is empty', 0);
  const tokens = tokenize(source);
  let position = 0;
  const peek = () => tokens[position];
  const word = (value: string, offset = 0) => {
    const token = tokens[position + offset];
    return token.type === 'word' && token.value.toUpperCase() === value;
  };
  const symbol = (value: string) => {
    const token = peek();
    return token.type === 'symbol' && token.value === value;
  };
  const describe = (token: Token) =>
    token.type === 'end' ? 'the end of the rule' : `“${token.type === 'string' ? `'${token.value}'` : token.value}”`;
  const expectSymbol = (value: string) => {
    if (!symbol(value)) throw new SqlError(`Expected “${value}” but found ${describe(peek())}`, peek().at);
    position++;
  };
  const expectWord = (value: string) => {
    if (!word(value)) throw new SqlError(`Expected ${value} but found ${describe(peek())}`, peek().at);
    position++;
  };

  function or(): Node {
    let left = and();
    for (;;) {
      if (symbol('||')) {
        throw new SqlError('In MySQL “||” means OR, not joining texts. Use CONCAT(…) to join them', peek().at);
      }
      if (!word('OR')) return left;
      const at = tokens[position++].at;
      left = { kind: 'binary', operator: 'OR', left, right: and(), at };
    }
  }

  function and(): Node {
    let left = not();
    while (word('AND') || symbol('&&')) {
      const at = tokens[position++].at;
      left = { kind: 'binary', operator: 'AND', left, right: not(), at };
    }
    return left;
  }

  function not(): Node {
    if (word('NOT')) {
      const at = tokens[position++].at;
      return { kind: 'unary', operator: 'NOT', operand: not(), at };
    }
    return comparison();
  }

  function comparison(): Node {
    let left = additive();
    for (;;) {
      const token = peek();
      if (token.type === 'symbol' && ['=', '<>', '!=', '<', '>', '<=', '>='].includes(token.value)) {
        position++;
        left = { kind: 'binary', operator: token.value === '!=' ? '<>' : token.value, left, right: additive(), at: token.at };
      } else if (word('IS')) {
        position++;
        const negated = word('NOT');
        if (negated) position++;
        expectWord('NULL');
        left = { kind: 'isNull', operand: left, negated, at: token.at };
      } else if (word('LIKE') || (word('NOT') && word('LIKE', 1))) {
        const negated = word('NOT');
        position += negated ? 2 : 1;
        const node: Node = { kind: 'binary', operator: 'LIKE', left, right: additive(), at: token.at };
        left = negated ? { kind: 'unary', operator: 'NOT', operand: node, at: token.at } : node;
      } else if (word('IN') || (word('NOT') && word('IN', 1))) {
        const negated = word('NOT');
        position += negated ? 2 : 1;
        expectSymbol('(');
        const list = [or()];
        while (symbol(',')) {
          position++;
          list.push(or());
        }
        expectSymbol(')');
        left = { kind: 'in', operand: left, list, negated, at: token.at };
      } else {
        return left;
      }
    }
  }

  function additive(): Node {
    let left = multiplicative();
    for (;;) {
      const token = peek();
      if (token.type !== 'symbol' || (token.value !== '+' && token.value !== '-')) return left;
      position++;
      left = { kind: 'binary', operator: token.value, left, right: multiplicative(), at: token.at };
    }
  }

  function multiplicative(): Node {
    let left = unary();
    for (;;) {
      const token = peek();
      if (token.type !== 'symbol' || !['*', '/', '%'].includes(token.value)) return left;
      position++;
      left = { kind: 'binary', operator: token.value, left, right: unary(), at: token.at };
    }
  }

  function unary(): Node {
    if (symbol('-')) {
      const at = tokens[position++].at;
      return { kind: 'unary', operator: '-', operand: unary(), at };
    }
    return primary();
  }

  function caseExpression(at: number): Node {
    const operand = word('WHEN') ? undefined : or();
    const branches: { when: Node; then: Node }[] = [];
    while (word('WHEN')) {
      position++;
      const when = or();
      expectWord('THEN');
      branches.push({ when, then: or() });
    }
    if (branches.length === 0) throw new SqlError(`Expected WHEN but found ${describe(peek())}`, peek().at);
    let otherwise: Node | undefined;
    if (word('ELSE')) {
      position++;
      otherwise = or();
    }
    expectWord('END');
    return { kind: 'case', operand, branches, otherwise, at };
  }

  function call(name: string, at: number): Node {
    const args: Node[] = [];
    if (!symbol(')')) {
      for (;;) {
        args.push(or());
        if (symbol(',')) {
          position++;
          continue;
        }
        if (word('FROM') || word('FOR')) {
          throw new SqlError(`Write ${name}(text, start, length) with commas; the FROM … FOR … form is not supported here`, peek().at);
        }
        break;
      }
    }
    expectSymbol(')');
    return { kind: 'call', name, args, at };
  }

  function primary(): Node {
    const token = peek();
    position++;
    if (token.type === 'number' || token.type === 'string') return { kind: 'literal', value: token.value, at: token.at };
    if (token.type === 'symbol' && token.value === '(') {
      const inner = or();
      expectSymbol(')');
      return inner;
    }
    if (token.type === 'word') {
      const upper = token.value.toUpperCase();
      if (upper === 'NULL') return { kind: 'literal', value: null, at: token.at };
      if (upper === 'TRUE' || upper === 'FALSE') return { kind: 'literal', value: upper === 'TRUE' ? 1 : 0, at: token.at };
      if (upper === 'CASE') return caseExpression(token.at);
      if (upper === 'POSITION' && symbol('(')) {
        position++;
        const needle = additive();
        expectWord('IN');
        const haystack = additive();
        expectSymbol(')');
        return { kind: 'call', name: 'LOCATE', args: [needle, haystack], at: token.at };
      }
      if (symbol('(')) {
        position++;
        return call(upper, token.at);
      }
      if (KEYWORDS.has(upper)) throw new SqlError(`Unexpected ${upper}`, token.at);
      let name = token.value;
      if (symbol('.')) {
        position++;
        const column = peek();
        if (column.type !== 'word') throw new SqlError(`Expected a column name after “.” but found ${describe(column)}`, column.at);
        position++;
        name = `${token.value}.${column.value}`;
      }
      return { kind: 'column', name, at: token.at };
    }
    throw new SqlError(`Unexpected ${describe(token)}`, token.at);
  }

  const tree = or();
  if (peek().type !== 'end') throw new SqlError(`Unexpected ${describe(peek())}`, peek().at);
  return tree;
}

export interface Trace {
  nullColumns: Set<string>;
  concatNull: boolean;
  functions: Set<string>;
}

export function toNumber(value: SqlValue): number | null {
  if (value === null) return null;
  if (typeof value === 'number') return value;
  const match = /^\s*[-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?/.exec(value);
  return match ? Number(match[0]) : 0;
}

const toText = (value: SqlValue): string => String(value);
const truthy = (value: SqlValue): boolean | null => {
  const number = toNumber(value);
  return number === null ? null : number !== 0;
};
const bool = (value: boolean): SqlValue => (value ? 1 : 0);
const chars = (text: string) => Array.from(text);
const integer = (value: SqlValue) => Math.round(toNumber(value) ?? 0);

export function compare(a: SqlValue, b: SqlValue): number | null {
  if (a === null || b === null) return null;
  if (typeof a === 'number' || typeof b === 'number') {
    const x = toNumber(a)!;
    const y = toNumber(b)!;
    return x === y ? 0 : x < y ? -1 : 1;
  }
  const x = a.toLowerCase().trimEnd();
  const y = b.toLowerCase().trimEnd();
  return x === y ? 0 : x < y ? -1 : 1;
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function like(text: string, pattern: string): boolean {
  let source = '^';
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === '\\' && i + 1 < pattern.length) source += escape(pattern[++i]);
    else if (char === '%') source += '[\\s\\S]*';
    else if (char === '_') source += '[\\s\\S]';
    else source += escape(char);
  }
  return new RegExp(`${source}$`, 'iu').test(text);
}

interface Fn {
  min: number;
  max: number;
  signature: string;
  description: string;
  run: (args: SqlValue[], trace: Trace, fail: (message: string) => never) => SqlValue;
}

function substring(text: string, start: number, length?: number): string {
  const list = chars(text);
  if (start === 0) return '';
  const from = start > 0 ? start - 1 : list.length + start;
  if (from < 0 || from >= list.length) return '';
  if (length === undefined) return list.slice(from).join('');
  return length <= 0 ? '' : list.slice(from, from + length).join('');
}

const strict =
  (fn: Fn['run']): Fn['run'] =>
  (args, trace, fail) =>
    args.some((arg) => arg === null) ? null : fn(args, trace, fail);

function pad(left: boolean): Fn['run'] {
  return strict((args) => {
    const text = chars(toText(args[0]));
    const length = integer(args[1]);
    const filler = chars(toText(args[2]));
    if (length < 0) return null;
    if (text.length >= length) return text.slice(0, length).join('');
    if (filler.length === 0) return '';
    const padding = Array.from({ length: length - text.length }, (_, index) => filler[index % filler.length]).join('');
    return left ? padding + text.join('') : text.join('') + padding;
  });
}

export const sqlFunctions: Record<string, Fn> = {
  CONCAT: {
    min: 1,
    max: Infinity,
    signature: 'CONCAT(value, …)',
    description: 'Joins values. If any of them is NULL, the whole result is NULL.',
    run: (args, trace) => {
      if (args.some((arg) => arg === null)) {
        trace.concatNull = true;
        return null;
      }
      return args.map(toText).join('');
    },
  },
  CONCAT_WS: {
    min: 2,
    max: Infinity,
    signature: 'CONCAT_WS(separator, value, …)',
    description: 'Joins values with a separator between them and skips the ones that are NULL.',
    run: (args) =>
      args[0] === null
        ? null
        : args
            .slice(1)
            .filter((arg) => arg !== null)
            .map(toText)
            .join(toText(args[0])),
  },
  LOWER: {
    min: 1,
    max: 1,
    signature: 'LOWER(text)',
    description: 'Turns a text into lower case. Also LCASE.',
    run: strict((args) => toText(args[0]).toLowerCase()),
  },
  UPPER: {
    min: 1,
    max: 1,
    signature: 'UPPER(text)',
    description: 'Turns a text into upper case. Also UCASE.',
    run: strict((args) => toText(args[0]).toUpperCase()),
  },
  TRIM: { min: 1, max: 1, signature: 'TRIM(text)', description: 'Removes spaces at both ends.', run: strict((args) => toText(args[0]).replace(/^ +| +$/g, '')) },
  LTRIM: { min: 1, max: 1, signature: 'LTRIM(text)', description: 'Removes spaces at the start.', run: strict((args) => toText(args[0]).replace(/^ +/, '')) },
  RTRIM: { min: 1, max: 1, signature: 'RTRIM(text)', description: 'Removes spaces at the end.', run: strict((args) => toText(args[0]).replace(/ +$/, '')) },
  SUBSTRING: {
    min: 2,
    max: 3,
    signature: 'SUBSTRING(text, start, length)',
    description: 'Takes part of a text. The first character is 1, not 0, and a negative start counts from the end. Also SUBSTR and MID.',
    run: strict((args) => substring(toText(args[0]), integer(args[1]), args[2] === undefined ? undefined : integer(args[2]))),
  },
  LEFT: {
    min: 2,
    max: 2,
    signature: 'LEFT(text, length)',
    description: 'Takes the first characters of a text.',
    run: strict((args) => chars(toText(args[0])).slice(0, Math.max(0, integer(args[1]))).join('')),
  },
  RIGHT: {
    min: 2,
    max: 2,
    signature: 'RIGHT(text, length)',
    description: 'Takes the last characters of a text.',
    run: strict((args) => {
      const length = integer(args[1]);
      return length <= 0 ? '' : chars(toText(args[0])).slice(-length).join('');
    }),
  },
  CHAR_LENGTH: {
    min: 1,
    max: 1,
    signature: 'CHAR_LENGTH(text)',
    description: 'Counts the characters of a text.',
    run: strict((args) => chars(toText(args[0])).length),
  },
  LENGTH: {
    min: 1,
    max: 1,
    signature: 'LENGTH(text)',
    description: 'Counts bytes, not characters: “María” has 5 characters but LENGTH gives 6. Use CHAR_LENGTH to count characters.',
    run: strict((args) => new TextEncoder().encode(toText(args[0])).length),
  },
  REPLACE: {
    min: 3,
    max: 3,
    signature: 'REPLACE(text, from, to)',
    description: 'Replaces every occurrence of a text. It is case-sensitive: replacing “á” leaves “Á” untouched.',
    run: strict((args) => {
      const from = toText(args[1]);
      return from === '' ? toText(args[0]) : toText(args[0]).split(from).join(toText(args[2]));
    }),
  },
  REGEXP_REPLACE: {
    min: 3,
    max: 3,
    signature: 'REGEXP_REPLACE(text, pattern, to)',
    description: 'Replaces every match of a regular expression. Available from MySQL 8.',
    run: strict((args, _, fail) => {
      let pattern: RegExp;
      try {
        pattern = new RegExp(toText(args[1]), 'gu');
      } catch {
        return fail(`REGEXP_REPLACE received an invalid regular expression: ${args[1]}`);
      }
      return toText(args[0]).replace(pattern, toText(args[2]));
    }),
  },
  SUBSTRING_INDEX: {
    min: 3,
    max: 3,
    signature: 'SUBSTRING_INDEX(text, separator, count)',
    description: 'Takes what comes before the nth separator, or after it when count is negative. Handy for the part of an email before the @.',
    run: strict((args) => {
      const text = toText(args[0]);
      const separator = toText(args[1]);
      const count = integer(args[2]);
      if (count === 0 || separator === '') return '';
      const parts = text.split(separator);
      return count > 0 ? parts.slice(0, count).join(separator) : parts.slice(count).join(separator);
    }),
  },
  LPAD: {
    min: 3,
    max: 3,
    signature: 'LPAD(text, length, filler)',
    description: 'Fills a text on the left up to a length, for example with zeros. A longer text is cut.',
    run: pad(true),
  },
  RPAD: {
    min: 3,
    max: 3,
    signature: 'RPAD(text, length, filler)',
    description: 'Fills a text on the right up to a length. A longer text is cut.',
    run: pad(false),
  },
  LOCATE: {
    min: 2,
    max: 3,
    signature: 'LOCATE(part, text, start)',
    description: 'Position of a text inside another, counting from 1, or 0 when it is not there. POSITION(part IN text) does the same.',
    run: strict((args) => {
      const text = chars(toText(args[1]).toLowerCase());
      const from = args[2] === undefined ? 1 : integer(args[2]);
      if (from < 1 || from > text.length + 1) return 0;
      const index = text.slice(from - 1).join('').indexOf(toText(args[0]).toLowerCase());
      return index === -1 ? 0 : chars(text.slice(from - 1).join('').slice(0, index)).length + from;
    }),
  },
  INSTR: {
    min: 2,
    max: 2,
    signature: 'INSTR(text, part)',
    description: 'Position of a text inside another, counting from 1, or 0 when it is not there.',
    run: strict((args) => {
      const text = toText(args[0]).toLowerCase();
      const index = text.indexOf(toText(args[1]).toLowerCase());
      return index === -1 ? 0 : chars(text.slice(0, index)).length + 1;
    }),
  },
  REVERSE: {
    min: 1,
    max: 1,
    signature: 'REVERSE(text)',
    description: 'Writes a text backwards.',
    run: strict((args) => chars(toText(args[0])).reverse().join('')),
  },
  COALESCE: {
    min: 1,
    max: Infinity,
    signature: 'COALESCE(value, …)',
    description: 'The first value that is not NULL.',
    run: (args) => args.find((arg) => arg !== null) ?? null,
  },
  IFNULL: {
    min: 2,
    max: 2,
    signature: 'IFNULL(value, fallback)',
    description: 'The value, or the fallback when it is NULL.',
    run: (args) => args[0] ?? args[1],
  },
  NULLIF: {
    min: 2,
    max: 2,
    signature: 'NULLIF(value, other)',
    description: 'NULL when both are equal, otherwise the first value. Useful to treat empty texts as NULL.',
    run: (args) => (compare(args[0], args[1]) === 0 ? null : args[0]),
  },
  IF: {
    min: 3,
    max: 3,
    signature: 'IF(condition, then, otherwise)',
    description: 'Chooses between two values.',
    run: (args) => (truthy(args[0]) ? args[1] : args[2]),
  },
};

const ALIASES: Record<string, string> = {
  LCASE: 'LOWER',
  UCASE: 'UPPER',
  SUBSTR: 'SUBSTRING',
  MID: 'SUBSTRING',
  CHARACTER_LENGTH: 'CHAR_LENGTH',
};

const OTHER_DIALECTS: Record<string, string> = {
  NVL: 'IFNULL',
  ISNULL: 'IFNULL or IS NULL',
  LEN: 'CHAR_LENGTH',
  INITCAP: 'CONCAT(UPPER(LEFT(text, 1)), LOWER(SUBSTRING(text, 2)))',
  TRANSLATE: 'REPLACE, once for each character',
};

export type Row = Record<string, string | null>;

export function evaluateSql(tree: Node, row: Row, columns: string[]): { value: SqlValue; trace: Trace } {
  const trace: Trace = { nullColumns: new Set(), concatNull: false, functions: new Set() };
  const known = new Map(columns.map((column) => [column.toLowerCase(), column]));

  function run(node: Node): SqlValue {
    const fail = (message: string): never => {
      throw new SqlError(message, node.at);
    };
    switch (node.kind) {
      case 'literal':
        return node.value;
      case 'column': {
        const parts = node.name.split('.');
        if (parts.length === 2 && parts[0].toLowerCase() !== 'users') {
          return fail(`Username rules read the user, so columns start with users., not ${parts[0]}.`);
        }
        const name = parts[parts.length - 1];
        const column = known.get(name.toLowerCase());
        if (!column) {
          return fail(`users.${name} is not a column of the sample users. Add it to the sample or check the spelling. Columns: ${columns.join(', ')}`);
        }
        const value = row[column] ?? null;
        if (value === null) trace.nullColumns.add(column);
        return value;
      }
      case 'call': {
        const name = ALIASES[node.name] ?? node.name;
        const fn = sqlFunctions[name];
        if (!fn) {
          const instead = OTHER_DIALECTS[node.name];
          return fail(instead ? `${node.name} is not a MySQL function. Use ${instead} instead` : `${node.name} is not supported here`);
        }
        if (node.args.length < fn.min || node.args.length > fn.max) {
          const expected = fn.min === fn.max ? `${fn.min}` : fn.max === Infinity ? `at least ${fn.min}` : `${fn.min} or ${fn.max}`;
          return fail(`${node.name} expects ${expected} value(s) but got ${node.args.length}: ${fn.signature}`);
        }
        const values = node.args.map(run);
        trace.functions.add(name);
        return fn.run(values, trace, fail);
      }
      case 'unary': {
        const value = run(node.operand);
        if (node.operator === 'NOT') {
          const test = truthy(value);
          return test === null ? null : bool(!test);
        }
        const number = toNumber(value);
        return number === null ? null : -number;
      }
      case 'isNull': {
        const isNull = run(node.operand) === null;
        return bool(node.negated ? !isNull : isNull);
      }
      case 'in': {
        const value = run(node.operand);
        if (value === null) return null;
        const found = node.list.some((item) => compare(value, run(item)) === 0);
        return bool(node.negated ? !found : found);
      }
      case 'case': {
        const subject = node.operand ? run(node.operand) : undefined;
        for (const branch of node.branches) {
          const when = run(branch.when);
          const matches = node.operand ? compare(subject!, when) === 0 : truthy(when) === true;
          if (matches) return run(branch.then);
        }
        return node.otherwise ? run(node.otherwise) : null;
      }
      case 'binary':
        return binary(node.operator, node.left, node.right, fail);
    }
  }

  function binary(operator: string, leftNode: Node, rightNode: Node, fail: (message: string) => never): SqlValue {
    if (operator === 'AND' || operator === 'OR') {
      const stop = operator === 'OR';
      const left = truthy(run(leftNode));
      if (left === stop) return bool(stop);
      const right = truthy(run(rightNode));
      if (right === stop) return bool(stop);
      return left === null || right === null ? null : bool(!stop);
    }
    const left = run(leftNode);
    const right = run(rightNode);
    if (left === null || right === null) return null;
    if (operator === 'LIKE') return bool(like(toText(left), toText(right)));
    const order = compare(left, right)!;
    switch (operator) {
      case '=':
        return bool(order === 0);
      case '<>':
        return bool(order !== 0);
      case '<':
        return bool(order < 0);
      case '>':
        return bool(order > 0);
      case '<=':
        return bool(order <= 0);
      case '>=':
        return bool(order >= 0);
    }
    const numeric = (value: SqlValue) => typeof value === 'number' || /^\s*[-+]?(\d|\.\d)/.test(value!);
    if (!numeric(left) || !numeric(right)) {
      return fail(`In MySQL “${operator}” only works with numbers and texts count as 0. Use CONCAT(…) to join texts`);
    }
    const a = toNumber(left)!;
    const b = toNumber(right)!;
    if (operator === '+') return a + b;
    if (operator === '-') return a - b;
    if (operator === '*') return a * b;
    if (b === 0) return null;
    return operator === '/' ? a / b : a % b;
  }

  return { value: run(tree), trace };
}
