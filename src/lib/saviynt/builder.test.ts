import { describe, expect, it } from 'vitest';
import { STARTER, blankOption, conditionSql, designSql, optionSql, pieceSql, quote, type Option } from './builder';
import { compileRules, generate, parseCsv } from './naming';
import { evaluateSql, parseSql } from './sql';
import { SAMPLE_TAKEN, SAMPLE_USERS } from './samples';

const { columns, rows } = parseCsv(SAMPLE_USERS);
const value = (sql: string, row = rows[0]) => evaluateSql(parseSql(sql), row, columns).value;
const plain: Option = { ...blankOption(columns), removeAccents: false, removeSpaces: false, lowercase: false };

describe('pieceSql', () => {
  it('takes each part of an attribute', () => {
    const maria = rows[2];
    const part = (piece: Parameters<typeof pieceSql>[0]) => value(pieceSql(piece), maria);
    const base = { kind: 'attribute' as const, column: 'firstname', length: null, ifEmpty: 'skip' as const };
    expect(part({ ...base, part: 'whole' })).toBe('María José');
    expect(part({ ...base, part: 'firstWord' })).toBe('María');
    expect(part({ ...base, part: 'secondWord' })).toBe('José');
    expect(part({ ...base, part: 'lastWord' })).toBe('José');
    expect(part({ ...base, part: 'secondWord', length: 1 })).toBe('J');
    expect(value(pieceSql({ ...base, part: 'secondWord' }), rows[0])).toBe('');
    expect(value(pieceSql({ ...base, column: 'middlename', part: 'whole', ifEmpty: 'leave' }), rows[0])).toBe('');
    expect(value(pieceSql({ ...base, column: 'middlename', part: 'whole' }), rows[0])).toBeNull();
    expect(evaluateSql(parseSql(pieceSql({ ...base, column: 'email', part: 'beforeAt' })), { email: 'a.b@c.com' }, ['email']).value).toBe('a.b');
  });

  it('quotes text so that it cannot break the rule', () => {
    expect(quote("o'brien\\x")).toBe("'o''brien\\\\x'");
    expect(value(pieceSql({ kind: 'text', text: "it's" }))).toBe("it's");
  });
});

describe('conditionSql', () => {
  const test = (operator: Parameters<typeof conditionSql>[0]['operator'], text: string, row = rows[1]) =>
    value(conditionSql({ column: 'employeetype', operator, value: text }), row);

  it('builds each kind of condition', () => {
    expect(test('is', 'contractor')).toBe(1);
    expect(test('isNot', 'Contractor')).toBe(0);
    expect(test('isNot', 'Contractor', rows[0])).toBe(1);
    expect(test('isEmpty', '')).toBe(0);
    expect(test('isNotEmpty', '')).toBe(1);
    expect(test('contains', 'tract')).toBe(1);
    expect(test('startsWith', 'Con')).toBe(1);
    expect(value(conditionSql({ column: 'middlename', operator: 'isEmpty', value: '' }), rows[0])).toBe(1);
    expect(value(conditionSql({ column: 'middlename', operator: 'isNot', value: 'x' }), rows[0])).toBe(1);
  });
});

describe('optionSql', () => {
  it('applies the clean-up steps in order', () => {
    const option: Option = { ...plain, pieces: [{ kind: 'text', text: "Ó'Ñ -Ñe" }] };
    expect(value(optionSql(option))).toBe("Ó'Ñ -Ñe");
    expect(value(optionSql({ ...option, removeAccents: true }))).toBe("O'N -Ne");
    expect(value(optionSql({ ...option, lowercase: true, removeAccents: true }))).toBe("o'n -ne");
    expect(value(optionSql({ ...option, lowercase: true, removeAccents: true, removeSpaces: true, removeSymbols: true }))).toBe('onne');
    expect(value(optionSql({ ...option, maxLength: 3 }))).toBe("Ó'Ñ");
    expect(value(optionSql({ ...option, pieces: [] }))).toBe('');
  });

  it('wraps the conditions in a CASE that gives NULL otherwise', () => {
    const option: Option = { ...plain, conditions: [[{ column: 'employeetype', operator: 'is', value: 'Contractor' }]] };
    expect(optionSql(option)).toBe("CASE WHEN users.employeetype = 'Contractor'\n  THEN CONCAT(users.firstname)\nEND");
    expect(value(optionSql(option), rows[1])).toBe('John');
    expect(value(optionSql(option), rows[0])).toBeNull();
    expect(optionSql({ ...option, conditions: [[]] })).toBe('CONCAT(users.firstname)');
  });

  it('joins the conditions of a group with AND and the groups with OR', () => {
    const contractor = { column: 'employeetype', operator: 'is' as const, value: 'Contractor' };
    const jane = { column: 'firstname', operator: 'is' as const, value: 'Jane' };
    const withMiddle = { column: 'middlename', operator: 'isNotEmpty' as const, value: '' };
    const option: Option = { ...plain, conditions: [[contractor], [jane, withMiddle]] };
    expect(optionSql(option)).toBe(
      "CASE WHEN (users.employeetype = 'Contractor')\n    OR (users.firstname = 'Jane' AND users.middlename <> '')\n  THEN CONCAT(users.firstname)\nEND",
    );
    expect(rows.map((row) => value(optionSql(option), row))).toEqual([null, 'John', null, null, 'Jane', null, 'Lucía']);
  });
});

describe('designSql', () => {
  it('joins the options with the chosen separator', () => {
    expect(designSql({ separator: '###', options: [plain, plain] })).toBe('CONCAT(users.firstname)\n###\nCONCAT(users.firstname)');
  });

  it('builds a starter rule that the tester reads, with a second option for taken names', () => {
    const sql = designSql(STARTER);
    expect(sql.split('\n#\n')).toHaveLength(2);
    const names = generate(compileRules(sql), rows, columns, SAMPLE_TAKEN.split('\n'), { maxLength: 12, strictCharacters: true });
    expect(names.map((outcome) => [outcome.username, outcome.rule])).toEqual([
      ['jdoe', 0],
      ['jsmith', 0],
      ['mjfernandez', 0],
      ['sobrien', 0],
      ['jadoe', 1],
      ['amontgomeryw', 0],
      [null, undefined],
    ]);
    expect(names.every((outcome) => outcome.issues.length === 0)).toBe(true);
  });

  it('starts a new option from the first name when there is one', () => {
    expect(blankOption(['lastname', 'FirstName']).pieces[0]).toMatchObject({ column: 'FirstName' });
    expect(blankOption(['mail']).pieces[0]).toMatchObject({ column: 'mail' });
    expect(blankOption([]).pieces[0]).toMatchObject({ column: 'firstname' });
  });
});
