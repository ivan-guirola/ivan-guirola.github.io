import { describe, expect, it } from 'vitest';
import { RuleError, checkUsername, compileRules, generate, parseCsv, ruleNotes, splitRules } from './naming';
import { EXAMPLES, SAMPLE_TAKEN, SAMPLE_USERS } from './samples';

const settings = { maxLength: 20, strictCharacters: true };
const { columns, rows } = parseCsv(SAMPLE_USERS);
const taken = SAMPLE_TAKEN.split('\n');
const names = (rule: string) => generate(compileRules(rule), rows, columns, taken, settings).map((outcome) => outcome.username);

describe('splitRules', () => {
  it('splits on ### outside quotes and keeps where each option starts', () => {
    expect(splitRules("a###'x###y'### b")).toEqual([
      { source: 'a', offset: 0 },
      { source: "'x###y'", offset: 4 },
      { source: ' b', offset: 14 },
    ]);
    expect(splitRules("'it\\'s###'")).toHaveLength(1);
    expect(splitRules('(a)\n#\n(b)').map((part) => part.source)).toEqual(['(a)\n', '\n(b)']);
  });
});

describe('compileRules', () => {
  it('points at the option and the place that cannot be read', () => {
    try {
      compileRules('LOWER(a)###LOWER(');
    } catch (error) {
      expect(error).toBeInstanceOf(RuleError);
      expect(error).toMatchObject({ rule: 1, position: 17, message: 'Unexpected the end of the rule' });
      return;
    }
    throw new Error('expected an error');
  });

  it('names an empty option', () => {
    expect(() => compileRules('a# #b')).toThrow('Option 2 is empty');
    expect(() => compileRules('  ')).toThrow('The rule is empty');
  });
});

describe('parseCsv', () => {
  it('reads columns, quoted cells and empty values as NULL', () => {
    const result = parseCsv('users.firstname;lastname\r\n"Doe; Jane";"O""Brien"\r\nJohn;\n\n');
    expect(result.columns).toEqual(['firstname', 'lastname']);
    expect(result.rows).toEqual([
      { firstname: 'Doe; Jane', lastname: 'O"Brien' },
      { firstname: 'John', lastname: null },
    ]);
    expect(parseCsv('a,b\n1').rows).toEqual([{ a: '1', b: null }]);
  });

  it('rejects an empty sample or a header that is not column names', () => {
    expect(() => parseCsv(' \n ')).toThrow('The sample users are empty');
    expect(() => parseCsv('first name,last\nx,y')).toThrow('The first line must name the columns');
  });
});

describe('checkUsername', () => {
  it('flags what directories usually reject', () => {
    expect(checkUsername('jane.doe', settings)).toEqual([]);
    expect(checkUsername('María José.fernández-montgomery', settings).map((issue) => issue.code)).toEqual([
      'tooLong',
      'uppercase',
      'spaces',
      'characters',
    ]);
    expect(checkUsername("o'brien", settings)).toEqual([{ code: 'characters', detail: "'" }]);
    expect(checkUsername('.a..b-', settings).map((issue) => issue.code)).toEqual(['edges', 'doubleDot']);
    expect(checkUsername('Ab c', { maxLength: 2, strictCharacters: false })).toEqual([{ code: 'tooLong', detail: '4' }]);
  });
});

describe('generate', () => {
  it('produces the names of every example', () => {
    expect(EXAMPLES.map((example) => names(example.rule))).toEqual([
      ['jane.doe', null, 'maría josé.fernández', "sean.o'brien", null, 'alexandrina.montgomery-wellington', null],
      ['jane.doe', 'john.smith1', 'maría josé.fernández', "sean.o'brien", 'jane.doe1', 'alexandrina.montgomery-wellington', null],
      ['jane.doe', null, 'mariajose.fernandez', 'sean.obrien', null, 'alexandrina.montgomery-wellington', null],
      ['jane.doe', 'john.paul.smith', 'maría josé.fernández', "sean.o'brien", 'jane.ann.doe', 'alexandrina.montgomery-wellington', 'lucía'],
      ['jdoe', 'jsmith', 'mfernández', "so'brien", null, 'amontgomery-wellingt', null],
      ['jane.doe', 'ext.john.smith', 'maría josé.fernández', "sean.o'brien", null, 'alexandrina.montgomery-wellington', null],
      ['u0000042', 'u0001043', 'u0002051', 'u0003307', 'u0004410', 'u0005120', 'u0006002'],
    ]);
  });

  it('records why each option was skipped', () => {
    const [, john, , , secondJane, , lucia] = generate(compileRules(EXAMPLES[1].rule), rows, columns, taken, settings);
    expect(john.attempts.map((attempt) => attempt.outcome)).toEqual(['taken', 'used']);
    expect(john.rule).toBe(1);
    expect(secondJane.attempts.map((attempt) => [attempt.outcome, attempt.value])).toEqual([
      ['taken', 'jane.doe'],
      ['used', 'jane.doe1'],
    ]);
    expect(lucia.username).toBeNull();
    expect(lucia.attempts[0]).toMatchObject({ outcome: 'null', nullColumns: ['lastname'], concatNull: true });
  });

  it('skips empty results and checks the chosen name', () => {
    const [jane] = generate(compileRules("''###users.firstname"), rows, columns, [], settings);
    expect(jane.attempts[0].outcome).toBe('empty');
    expect(jane.username).toBe('Jane');
    expect(jane.issues).toEqual([{ code: 'uppercase' }]);
  });

  it('turns numbers into text', () => {
    expect(generate(compileRules('users.employeeid + 0'), rows.slice(0, 1), columns, [], settings)[0].username).toBe('42');
  });

  it('reports which option failed while running', () => {
    expect(() => generate(compileRules('LOWER(users.firstname)###users.nickname'), rows, columns, ['jane'], settings)).toThrow(RuleError);
    try {
      generate(compileRules('LOWER(users.firstname)###users.nickname'), rows, columns, ['jane'], settings);
    } catch (error) {
      expect(error).toMatchObject({ rule: 1, position: 25 });
    }
  });
});

describe('ruleNotes', () => {
  it('warns about LENGTH outside quoted texts', () => {
    expect(ruleNotes('LENGTH(users.lastname) <= 6')).toEqual(['length']);
    expect(ruleNotes("CHAR_LENGTH(users.lastname)#'LENGTH('")).toEqual([]);
  });
});
