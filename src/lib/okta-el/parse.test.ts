import { describe, expect, it } from 'vitest';
import { ExpressionError, parse, tokenize } from './parse';

const error = (source: string) => {
  try {
    parse(source);
  } catch (caught) {
    return caught as ExpressionError;
  }
  throw new Error('expected a parse error');
};

const values = (source: string) => tokenize(source).map((token) => ('value' in token ? token.value : 'end'));

describe('tokenize', () => {
  it('reads texts in either quote, with doubled quotes inside', () => {
    expect(tokenize(`"a" 'b''c'`).slice(0, 2)).toEqual([
      { type: 'string', value: 'a', at: 0 },
      { type: 'string', value: "b'c", at: 4 },
    ]);
  });

  it('turns word operators into symbols, whatever their case', () => {
    expect(values('a AND b or not c')).toEqual(['a', '&&', 'b', '||', '!', 'c', 'end']);
  });

  it('reads decimal numbers and two-character operators', () => {
    expect(values('1.5 >= 2 ?: 3')).toEqual([1.5, '>=', 2, '?:', 3, 'end']);
  });
});

describe('parse', () => {
  it('gives multiplication priority over addition, and comparison over and', () => {
    expect(parse('1 + 2 * 3 == 7 and true')).toMatchObject({
      kind: 'binary',
      operator: '&&',
      left: { operator: '==', left: { operator: '+', right: { operator: '*' } } },
    });
  });

  it('reads member access, calls, indexes and lists', () => {
    expect(parse('String.len(user.tags[0])')).toMatchObject({
      kind: 'call',
      callee: { kind: 'member', object: { kind: 'name', name: 'String' }, property: 'len' },
      args: [{ kind: 'index', object: { kind: 'member', property: 'tags' }, index: { value: 0 } }],
    });
    expect(parse('{1, "a"}')).toMatchObject({ kind: 'list', items: [{ value: 1 }, { value: 'a' }] });
    expect(parse('{}')).toMatchObject({ kind: 'list', items: [] });
  });

  it('reads the conditional, the Elvis operator and negation', () => {
    expect(parse('a ? b : c')).toMatchObject({ kind: 'ternary' });
    expect(parse('a ?: b')).toMatchObject({ kind: 'elvis' });
    expect(parse('-x')).toMatchObject({ kind: 'unary', operator: '-' });
  });

  it('reads literals whatever their case', () => {
    expect(parse('TRUE')).toMatchObject({ value: true });
    expect(parse('Null')).toMatchObject({ value: null });
  });

  it('says where it went wrong', () => {
    expect(error('')).toMatchObject({ message: 'The expression is empty', position: 0 });
    expect(error('"open')).toMatchObject({ message: 'This text is missing its closing quote', position: 0 });
    expect(error('a # b')).toMatchObject({ message: '“#” is not allowed here', position: 2 });
    expect(error('String.len(a')).toMatchObject({ message: 'Expected “)” but found the end of the expression', position: 12 });
    expect(error('a b')).toMatchObject({ message: 'Unexpected “b”', position: 2 });
    expect(error('a "b"')).toMatchObject({ message: 'Unexpected “"b"”' });
    expect(error('user.')).toMatchObject({ message: 'Expected a name after “.” but found the end of the expression' });
    expect(error('a ? b')).toMatchObject({ message: 'Expected “:” but found the end of the expression' });
    expect(error(')')).toMatchObject({ message: 'Unexpected “)”' });
  });
});
