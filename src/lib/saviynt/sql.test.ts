import { describe, expect, it } from 'vitest';
import { SqlError, compare, evaluateSql, parseSql, sqlFunctions, toNumber, type Row } from './sql';

const row: Row = { firstname: 'María', lastname: 'Fernández', middlename: null, employeeid: '42', email: 'maria.fernandez@example.com' };
const columns = Object.keys(row);
const run = (source: string) => evaluateSql(parseSql(source), row, columns).value;
const fails = (source: string) => {
  try {
    run(source);
  } catch (error) {
    expect(error).toBeInstanceOf(SqlError);
    return (error as SqlError).message;
  }
  throw new Error(`expected ${source} to fail`);
};
const parseError = (source: string) => {
  try {
    parseSql(source);
  } catch (caught) {
    return caught as SqlError;
  }
  throw new Error('expected an error');
};

describe('evaluateSql', () => {
  it('joins and transforms texts the way MySQL does', () => {
    expect(run("LOWER(CONCAT(users.firstname, '.', users.lastname))")).toBe('maría.fernández');
    expect(run("CONCAT(users.firstname, '.', users.middlename)")).toBeNull();
    expect(run("CONCAT_WS('.', users.firstname, users.middlename, users.lastname)")).toBe('María.Fernández');
    expect(run("CONCAT_WS(NULL, 'a')")).toBeNull();
    expect(run("UPPER(firstname) = 'MARÍA'")).toBe(1);
    expect(run("LCASE('A')")).toBe('a');
    expect(run("UCASE(NULL)")).toBeNull();
    expect(run("CONCAT('n', 5)")).toBe('n5');
  });

  it('counts from 1 and handles negative starts', () => {
    expect(run('SUBSTRING(users.firstname, 1, 1)')).toBe('M');
    expect(run('SUBSTR(users.firstname, 0, 2)')).toBe('');
    expect(run('MID(users.firstname, -3)')).toBe('ría');
    expect(run('SUBSTRING(users.firstname, 9)')).toBe('');
    expect(run('SUBSTRING(users.firstname, 2, 0)')).toBe('');
    expect(run('LEFT(users.lastname, 3)')).toBe('Fer');
    expect(run('LEFT(users.lastname, -1)')).toBe('');
    expect(run('RIGHT(users.lastname, 3)')).toBe('dez');
    expect(run('RIGHT(users.lastname, 0)')).toBe('');
  });

  it('counts bytes with LENGTH and characters with CHAR_LENGTH', () => {
    expect(run('LENGTH(users.firstname)')).toBe(6);
    expect(run('CHAR_LENGTH(users.firstname)')).toBe(5);
    expect(run('CHARACTER_LENGTH(NULL)')).toBeNull();
  });

  it('replaces texts, case-sensitively', () => {
    expect(run("REPLACE(users.firstname, 'í', 'i')")).toBe('Maria');
    expect(run("REPLACE('ÍA', 'í', 'i')")).toBe('ÍA');
    expect(run("REPLACE('abc', '', 'x')")).toBe('abc');
    expect(run("REGEXP_REPLACE(users.lastname, '[^A-Za-z]', '')")).toBe('Fernndez');
    expect(run("TRIM('  a b  ')")).toBe('a b');
    expect(run("LTRIM('  a ')")).toBe('a ');
    expect(run("RTRIM(' a  ')")).toBe(' a');
    expect(run('REVERSE(users.firstname)')).toBe('aíraM');
  });

  it('cuts and pads', () => {
    expect(run("SUBSTRING_INDEX(users.email, '@', 1)")).toBe('maria.fernandez');
    expect(run("SUBSTRING_INDEX(users.email, '@', -1)")).toBe('example.com');
    expect(run("SUBSTRING_INDEX('a', '', 1)")).toBe('');
    expect(run("LPAD(users.employeeid, 6, '0')")).toBe('000042');
    expect(run("RPAD('ab', 5, 'xy')")).toBe('abxyx');
    expect(run("LPAD('abcdef', 3, '0')")).toBe('abc');
    expect(run("LPAD('a', -1, '0')")).toBeNull();
    expect(run("LPAD('a', 3, '')")).toBe('');
    expect(run("INSTR(users.email, 'FERN')")).toBe(7);
    expect(run("INSTR('abc', 'z')")).toBe(0);
    expect(run('POSITION(" " IN "María José")')).toBe(6);
    expect(run("POSITION('x' IN users.firstname)")).toBe(0);
    expect(run("LOCATE('a', 'banana', 3)")).toBe(4);
    expect(run("LOCATE('a', 'banana', 9)")).toBe(0);
    expect(run('SUBSTRING("María José", POSITION(" " IN "María José"), 2)')).toBe(' J');
  });

  it('handles NULL with COALESCE, IFNULL, NULLIF, IF and CASE', () => {
    expect(run('COALESCE(users.middlename, users.firstname)')).toBe('María');
    expect(run('COALESCE(NULL, NULL)')).toBeNull();
    expect(run("IFNULL(users.middlename, '')")).toBe('');
    expect(run("NULLIF('', '')")).toBeNull();
    expect(run("NULLIF('a', 'b')")).toBe('a');
    expect(run("IF(users.middlename IS NULL, 'none', 'some')")).toBe('none');
    expect(run("IF(users.middlename IS NOT NULL, 'some', 'none')")).toBe('none');
    expect(run("CASE users.firstname WHEN 'maría' THEN 'yes' ELSE 'no' END")).toBe('yes');
    expect(run("CASE WHEN users.employeeid > 100 THEN 'big' WHEN users.employeeid > 10 THEN 'medium' END")).toBe('medium');
    expect(run("CASE WHEN 1 = 2 THEN 'x' END")).toBeNull();
  });

  it('compares, matches patterns and combines conditions', () => {
    expect(run("users.lastname LIKE 'fer%'")).toBe(1);
    expect(run("users.lastname NOT LIKE '_ernández'")).toBe(0);
    expect(run("'a.b' LIKE 'a\\\\.b'")).toBe(1);
    expect(run('users.employeeid IN (1, 42)')).toBe(1);
    expect(run("users.employeeid NOT IN ('1')")).toBe(1);
    expect(run('users.middlename IN (1)')).toBeNull();
    expect(run("'b' > 'A' AND 2 >= 2 AND 1 <= 1 AND 1 < 2 AND 'a ' = 'A' AND 1 <> 2 AND 1 != 2")).toBe(1);
    expect(run('NOT 0 OR FALSE')).toBe(1);
    expect(run('NOT NULL')).toBeNull();
    expect(run('NULL AND 1')).toBeNull();
    expect(run('NULL AND 0')).toBe(0);
    expect(run('0 && 1')).toBe(0);
    expect(run('NULL OR 0')).toBeNull();
    expect(run('NULL OR 1')).toBe(1);
    expect(run('NULL = NULL')).toBeNull();
    expect(run("NULL LIKE 'a'")).toBeNull();
    expect(run('TRUE')).toBe(1);
  });

  it('does arithmetic on numbers', () => {
    expect(run('users.employeeid + 1')).toBe(43);
    expect(run('-users.employeeid * 2 - 1')).toBe(-85);
    expect(run('7 / 2')).toBe(3.5);
    expect(run('7 % 4')).toBe(3);
    expect(run('1 / 0')).toBeNull();
    expect(run('-NULL')).toBeNull();
  });

  it('reads columns with or without the users prefix, in any case and between backticks', () => {
    expect(run('FIRSTNAME')).toBe('María');
    expect(run('Users.`lastname`')).toBe('Fernández');
  });

  it('explains mistakes, including habits from other databases', () => {
    expect(fails("users.firstname || '.' || users.lastname")).toBe('In MySQL “||” means OR, not joining texts. Use CONCAT(…) to join them');
    expect(fails("users.firstname + '.'")).toBe('In MySQL “+” only works with numbers and texts count as 0. Use CONCAT(…) to join texts');
    expect(fails("NVL(users.middlename, '')")).toBe('NVL is not a MySQL function. Use IFNULL instead');
    expect(fails('INITCAP(users.firstname)')).toMatch(/^INITCAP is not a MySQL function/);
    expect(fails('SOUNDEX(users.firstname)')).toBe('SOUNDEX is not supported here');
    expect(fails('accounts.name')).toBe('Username rules read the user, so columns start with users., not accounts.');
    expect(fails('users.nickname')).toMatch(/^users\.nickname is not a column of the sample users/);
    expect(fails('LOWER()')).toBe('LOWER expects 1 value(s) but got 0: LOWER(text)');
    expect(fails('CONCAT()')).toBe('CONCAT expects at least 1 value(s) but got 0: CONCAT(value, …)');
    expect(fails("SUBSTRING('a')")).toBe('SUBSTRING expects 2 or 3 value(s) but got 1: SUBSTRING(text, start, length)');
    expect(fails("REGEXP_REPLACE('a', '(', '')")).toBe('REGEXP_REPLACE received an invalid regular expression: (');
  });

  it('reports where a rule cannot be read', () => {
    expect(parseError('')).toMatchObject({ message: 'The rule is empty' });
    expect(parseError("CONCAT('a")).toMatchObject({ message: 'This text is missing its closing quote', position: 7 });
    expect(parseError('`name')).toMatchObject({ message: 'This name is missing its closing backtick' });
    expect(parseError('LOWER(a')).toMatchObject({ message: 'Expected “)” but found the end of the rule' });
    expect(parseError('a b')).toMatchObject({ message: 'Unexpected “b”' });
    expect(parseError('a #')).toMatchObject({ message: '“#” is not allowed here' });
    expect(parseError('users.')).toMatchObject({ message: 'Expected a column name after “.” but found the end of the rule' });
    expect(parseError('CASE END')).toMatchObject({ message: 'Unexpected END' });
    expect(parseError('CASE WHEN 1 2')).toMatchObject({ message: 'Expected THEN but found “2”' });
    expect(parseError('a IS 1')).toMatchObject({ message: 'Expected NULL but found “1”' });
    expect(parseError('CASE 1 END')).toMatchObject({ message: 'Expected WHEN but found “END”' });
    expect(parseError('POSITION(a b)')).toMatchObject({ message: 'Expected IN but found “b”' });
    expect(parseError('THEN')).toMatchObject({ message: 'Unexpected THEN' });
    expect(parseError(')')).toMatchObject({ message: 'Unexpected “)”' });
    expect(parseError('SUBSTRING(a FROM 1)')).toMatchObject({
      message: 'Write SUBSTRING(text, start, length) with commas; the FROM … FOR … form is not supported here',
    });
    expect(parseSql("'it''s' = \"a\\'b\\n\\t\"")).toMatchObject({ kind: 'binary', left: { value: "it's" }, right: { value: "a'b\n\t" } });
  });
});

describe('helpers', () => {
  it('turns texts into numbers the way MySQL does', () => {
    expect(toNumber('12abc')).toBe(12);
    expect(toNumber('abc')).toBe(0);
    expect(toNumber(null)).toBeNull();
    expect(compare('a', null)).toBeNull();
    expect(compare(2, '10')).toBe(-1);
    expect(compare('b', 'a')).toBe(1);
  });

  it('documents every function', () => {
    for (const [name, fn] of Object.entries(sqlFunctions)) {
      expect(fn.signature.startsWith(`${name}(`)).toBe(true);
      expect(fn.description).toMatch(/\.$/);
    }
  });
});
