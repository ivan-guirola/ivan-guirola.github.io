import { describe, expect, it } from 'vitest';
import { evaluate, functions, typeOf, type Value } from './evaluate';
import { ExpressionError } from './parse';
import { EXAMPLES, SAMPLE_CONTEXT } from './samples';

const context = { ...SAMPLE_CONTEXT, now: '2026-11-17T10:00:00.000Z' };
const run = (source: string) => evaluate(source, context).value;
const fails = (source: string) => {
  try {
    evaluate(source, context);
  } catch (caught) {
    expect(caught).toBeInstanceOf(ExpressionError);
    return (caught as ExpressionError).message;
  }
  throw new Error(`expected ${source} to fail`);
};

describe('evaluate', () => {
  it('runs every example without errors', () => {
    const results = EXAMPLES.map((example) => run(example.expression));
    expect(results).toEqual([
      'jane.doe',
      'Jane Doe',
      'SLS',
      'no manager',
      true,
      true,
      'admin',
      ['app-crm-users', 'app-crm-admins'],
      '1794816082',
    ]);
  });

  it('reads profiles, lists and missing attributes', () => {
    expect(run('appuser.role')).toBe('editor');
    expect(run('org.name')).toBe('Example Corp');
    expect(run('user.entitlements[1]')).toBe('reports');
    expect(run('user.entitlements[5]')).toBeNull();
    expect(run('user.nickname')).toBeNull();
    expect(run('user.nickname.first')).toBeNull();
    expect(run('app.name')).toBeNull();
  });

  it('works out arithmetic, comparisons and logic', () => {
    expect(run('7 / 2')).toBe(3.5);
    expect(run('7 % 4 + 2 * 3 - 1')).toBe(8);
    expect(run('-(2)')).toBe(-2);
    expect(run('"b" > "a" && 2 <= 2 && 1 < 2 && 3 >= 4 == false')).toBe(true);
    expect(run('not (1 == 2) or false')).toBe(true);
    expect(run('{1, 2} == {1, 2}')).toBe(true);
    expect(run('user.managerId != null')).toBe(false);
    expect(run('"n=" + 1 + " " + null + " " + {1}')).toBe('n=1 null [1]');
    expect(run('false and 1')).toBe(false);
    expect(run('true or 1')).toBe(true);
    expect(run('user.firstName ?: "x"')).toBe('Jane');
  });

  it('runs the text functions', () => {
    expect(run('String.append("a", "b")')).toBe('ab');
    expect(run('String.join("-", "a", null, "b")')).toBe('a-b');
    expect(run('String.len(user.firstName)')).toBe(4);
    expect(run('String.removeSpaces(user.department)')).toBe('SalesEMEA');
    expect(run('String.replace(user.costCenter, "[^0-9]", "")')).toBe('1020');
    expect(run('String.replaceFirst("a-b-c", "-", "+")')).toBe('a+b-c');
    expect(run('String.stringContains(user.title, "manager")')).toBe(true);
    expect(run('String.stringContains(null, "x")')).toBe(false);
    expect(run('String.stringSwitch("Legal", "OTHER", "Sales", "S")')).toBe('OTHER');
    expect(run('String.substring(user.lastName, 0, 2)')).toBe('Do');
    expect(run('String.substringAfter(user.email, "@")')).toBe('example.com');
    expect(run('String.substringAfter("abc", "@")')).toBe('');
    expect(run('String.substringBefore("abc", "@")')).toBe('abc');
    expect(run('String.toUpperCase(user.countryCode) + String.toLowerCase("X")')).toBe('ESx');
    expect(run('String.toUpperCase(user.managerId)')).toBeNull();
    expect(run('String.substring(null, 0, 1)')).toBeNull();
    expect(run('String.substringBefore(null, "@")')).toBeNull();
    expect(run('String.substringAfter(null, "@")')).toBeNull();
    expect(run('String.replace(null, "a", "b")')).toBeNull();
    expect(run('String.replaceFirst(null, "a", "b")')).toBeNull();
    expect(run('String.len(12)')).toBe(2);
  });

  it('runs the list functions', () => {
    expect(run('Arrays.add(user.entitlements, "hr")')).toEqual(['crm', 'reports', 'hr']);
    expect(run('Arrays.remove(user.entitlements, "crm")')).toEqual(['reports']);
    expect(run('Arrays.clear(user.entitlements)')).toEqual([]);
    expect(run('Arrays.contains(user.entitlements, "crm")')).toBe(true);
    expect(run('Arrays.flatten(user.entitlements, "x", {"y"})')).toEqual(['crm', 'reports', 'x', 'y']);
    expect(run('Arrays.isEmpty(user.nothing)')).toBe(true);
    expect(run('Arrays.size(user.entitlements)')).toBe(2);
    expect(run('Arrays.toCsvString({"a", null, 1})')).toBe('a,,1');
  });

  it('converts numbers and dates', () => {
    expect(run('Convert.toInt("41.6") + 1')).toBe(43);
    expect(run('Convert.toNum(" 2.5 ")')).toBe(2.5);
    expect(run('Time.now()')).toBe('2026-11-17T10:00:00.000Z');
    expect(run('Time.fromUnixToIso8601("0")')).toBe('1970-01-01T00:00:00.000Z');
    expect(run('Time.fromWindowsToIso8601("116444736000000000")')).toBe('1970-01-01T00:00:00.000Z');
  });

  it('checks group membership by id, name, prefix, part and pattern', () => {
    expect(run('isMemberOfGroup("00g4d5e6f7")')).toBe(true);
    expect(run('isMemberOfAnyGroup("nope", "00g1a2b3c4")')).toBe(true);
    expect(run('isMemberOfGroupNameContains("vpn")')).toBe(true);
    expect(run('isMemberOfGroupNameRegex("app-.*-admins")')).toBe(true);
    expect(run('isMemberOfGroupNameRegex("crm")')).toBe(false);
    expect(run('Groups.contains("active_directory", "s", 100)')).toEqual(['Sales', 'vpn-users']);
    expect(run('Groups.endsWith("OKTA", "-users", 1)')).toEqual(['app-crm-users']);
    expect(evaluate('isMemberOfGroupName("x")', {}).value).toBe(false);
    expect(evaluate('Groups.contains("OKTA", "", 5)', {}).value).toEqual([]);
  });

  it('reads internal properties', () => {
    expect(run('user.getInternalProperty("status")')).toBe('ACTIVE');
    expect(run('user.getInternalProperty("activated")')).toBeNull();
  });

  it('lists the functions it used', () => {
    expect(evaluate('String.len(String.toUpperCase("a")) > 0 ? isMemberOfGroupName("x") : false', context).used).toEqual([
      'String.toUpperCase',
      'String.len',
      'isMemberOfGroupName',
    ]);
  });

  it('explains mistakes in plain words', () => {
    expect(fails('person.name')).toBe('Unknown name “person”. Expressions start from user, appuser, app or org');
    expect(fails('String')).toMatch(/^String is a group of functions\. Call one/);
    expect(fails('String.len')).toBe('String.len needs brackets: String.len(text)');
    expect(fails('String.size(user.login)')).toBe('Okta has no function String.size');
    expect(fails('String.tolowercase("A")')).toBe('Okta has no function String.tolowercase. Did you mean String.toLowerCase?');
    expect(fails('user.email.toLowerCase()')).toMatch(/^Okta does not call functions on values, such as \.toLowerCase\(\)/);
    expect(fails('foo()')).toBe('Okta has no function foo');
    expect(fails('isMemberOfGroupName')).toBe('isMemberOfGroupName is a function and needs brackets: isMemberOfGroupName(name)');
    expect(fails('String.len()')).toBe('String.len expects 1 value(s) but got 0: String.len(text)');
    expect(fails('String.join(",")')).toBe('String.join expects at least 2 value(s) but got 1: String.join(separator, text, …)');
    expect(fails('Time.now(1, 2, 3)')).toBe('Time.now expects 0 to 2 value(s) but got 3: Time.now()');
    expect(fails('String.len({1})')).toBe('String.len expects text as value 1, but got a list');
    expect(fails('user.firstName and true')).toBe('“and” needs true or false on both sides, but the left side is text');
    expect(fails('false or 1')).toBe('“or” needs true or false on both sides, but the right side is a number');
    expect(fails('user.firstName ? 1 : 2')).toBe('The condition before “?” must be true or false, but it is text');
    expect(fails('not "a"')).toBe('“not” needs true or false, but got text');
    expect(fails('-"a"')).toBe('Only numbers can be negative, not text');
    expect(fails('1 + true')).toBe('“+” adds numbers or joins texts, but got a number and true or false');
    expect(fails('1 < "a"')).toBe('“<” compares two numbers or two texts, but got a number and text');
    expect(fails('"a" * 2')).toBe('“*” works with numbers, but got text and a number');
    expect(fails('1 / 0')).toBe('Cannot divide by zero');
    expect(fails('user.firstName[0]')).toBe('Only lists can be read by position, not text');
    expect(fails('user.entitlements["a"]')).toBe('A position must be a whole number');
    expect(fails('user.firstName.x')).toBe('“x” cannot be read from text');
    expect(fails('String.replace("a", "(", "")')).toBe('String.replace received an invalid regular expression: (');
    expect(fails('String.stringSwitch("a", "b", "c")')).toMatch(/expects at least 4/);
    expect(fails('String.stringSwitch("a", "b", "c", "d", "e")')).toBe('String.stringSwitch needs pairs of key and value after the default');
    expect(fails('String.substring("abc", 1, 9)')).toBe('String.substring is out of range: the text has 3 characters');
    expect(fails('String.substring("abc", "1", 2)')).toBe('String.substring expects numbers for start and end');
    expect(fails('Arrays.size("a")')).toBe('Arrays.size expects a list, but got text');
    expect(fails('Convert.toInt("twelve")')).toBe('Convert.toInt cannot turn “twelve” into a number');
    expect(fails('Convert.toNum(null)')).toBe('Convert.toNum cannot turn nothing (null) into a number');
    expect(fails('Time.fromIso8601ToUnix("yesterday")')).toMatch(/expects a date/);
    expect(fails('Time.fromUnixToIso8601(null)')).toBe('Time.fromUnixToIso8601 expects a number of seconds');
    expect(fails('Time.fromWindowsToIso8601("x")')).toBe('Time.fromWindowsToIso8601 expects a number');
    expect(fails('Groups.contains("OKTA", "a", 0)')).toBe('The limit of a Groups function must be a number from 1 to 100');
    expect(fails('user.getInternalProperty("password")')).toMatch(/^“password” is not an internal property/);
  });

  it('points at the part that failed', () => {
    try {
      evaluate('user.firstName + String.len()', context);
    } catch (caught) {
      expect((caught as ExpressionError).position).toBe(27);
    }
  });
});

describe('typeOf and functions', () => {
  it('names each kind of value', () => {
    const values: Value[] = ['a', 1, true, [], {}, null];
    expect(values.map(typeOf)).toEqual(['text', 'number', 'boolean', 'list', 'object', 'nothing']);
  });

  it('documents every function', () => {
    for (const [name, fn] of Object.entries(functions)) {
      expect(fn.signature.startsWith(`${name}(`)).toBe(true);
      expect(fn.description).toMatch(/\.$/);
    }
  });
});
