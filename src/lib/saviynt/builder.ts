export type Part = 'whole' | 'firstWord' | 'secondWord' | 'lastWord' | 'beforeAt';

export type Piece =
  | { kind: 'attribute'; column: string; part: Part; length: number | null; ifEmpty: 'skip' | 'leave' }
  | { kind: 'text'; text: string };

export type Operator = 'is' | 'isNot' | 'isEmpty' | 'isNotEmpty' | 'contains' | 'startsWith';

export interface Condition {
  column: string;
  operator: Operator;
  value: string;
}

export interface Option {
  conditions: Condition[][];
  pieces: Piece[];
  lowercase: boolean;
  removeAccents: boolean;
  removeSpaces: boolean;
  removeSymbols: boolean;
  maxLength: number | null;
}

export interface Design {
  separator: '#' | '###';
  options: Option[];
}

const ACCENTS: [string, string][] = [
  ['á', 'a'],
  ['à', 'a'],
  ['ä', 'a'],
  ['â', 'a'],
  ['é', 'e'],
  ['è', 'e'],
  ['ë', 'e'],
  ['ê', 'e'],
  ['í', 'i'],
  ['ì', 'i'],
  ['ï', 'i'],
  ['î', 'i'],
  ['ó', 'o'],
  ['ò', 'o'],
  ['ö', 'o'],
  ['ô', 'o'],
  ['ú', 'u'],
  ['ù', 'u'],
  ['ü', 'u'],
  ['û', 'u'],
  ['ñ', 'n'],
  ['ç', 'c'],
];

export const quote = (text: string) => `'${text.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
const column = (name: string) => `users.${name}`;

export function pieceSql(piece: Piece): string {
  if (piece.kind === 'text') return quote(piece.text);
  const value = column(piece.column);
  const parts: Record<Part, string> = {
    whole: value,
    firstWord: `SUBSTRING_INDEX(${value}, ' ', 1)`,
    secondWord: `IF(INSTR(${value}, ' ') > 0, SUBSTRING_INDEX(SUBSTRING_INDEX(${value}, ' ', 2), ' ', -1), '')`,
    lastWord: `SUBSTRING_INDEX(${value}, ' ', -1)`,
    beforeAt: `SUBSTRING_INDEX(${value}, '@', 1)`,
  };
  let sql = parts[piece.part];
  if (piece.length !== null && piece.length > 0) sql = `LEFT(${sql}, ${piece.length})`;
  return piece.ifEmpty === 'leave' ? `IFNULL(${sql}, '')` : sql;
}

export function conditionSql(condition: Condition): string {
  const value = column(condition.column);
  switch (condition.operator) {
    case 'is':
      return `${value} = ${quote(condition.value)}`;
    case 'isNot':
      return `(${value} IS NULL OR ${value} <> ${quote(condition.value)})`;
    case 'isEmpty':
      return `(${value} IS NULL OR ${value} = '')`;
    case 'isNotEmpty':
      return `${value} <> ''`;
    case 'contains':
      return `INSTR(${value}, ${quote(condition.value)}) > 0`;
    case 'startsWith':
      return `LEFT(${value}, ${[...condition.value].length}) = ${quote(condition.value)}`;
  }
}

export function optionSql(option: Option): string {
  let sql = option.pieces.length === 0 ? "''" : `CONCAT(${option.pieces.map(pieceSql).join(', ')})`;
  if (option.lowercase) sql = `LOWER(${sql})`;
  if (option.removeAccents) {
    const upper = ACCENTS.map(([from, to]): [string, string] => [from.toUpperCase(), to.toUpperCase()]);
    for (const [from, to] of option.lowercase ? ACCENTS : [...ACCENTS, ...upper]) sql = `REPLACE(${sql}, '${from}', '${to}')`;
  }
  if (option.removeSpaces) sql = `REPLACE(${sql}, ' ', '')`;
  if (option.removeSymbols) sql = `REPLACE(REPLACE(${sql}, '''', ''), '-', '')`;
  if (option.maxLength !== null && option.maxLength > 0) sql = `LEFT(${sql}, ${option.maxLength})`;
  const groups = option.conditions.filter((group) => group.length > 0);
  if (groups.length === 0) return sql;
  const test =
    groups.length === 1
      ? groups[0].map(conditionSql).join('\n    AND ')
      : groups.map((group) => `(${group.map(conditionSql).join(' AND ')})`).join('\n    OR ');
  return `CASE WHEN ${test}\n  THEN ${sql}\nEND`;
}

export function designSql(design: Design): string {
  return design.options.map(optionSql).join(`\n${design.separator}\n`);
}

const tidy = { conditions: [], lowercase: true, removeAccents: true, removeSpaces: true, removeSymbols: true, maxLength: 12 };
const firstName = (length: number): Piece => ({ kind: 'attribute', column: 'firstname', part: 'firstWord', length, ifEmpty: 'skip' });
const secondInitial: Piece = { kind: 'attribute', column: 'firstname', part: 'secondWord', length: 1, ifEmpty: 'leave' };
const surname: Piece = { kind: 'attribute', column: 'lastname', part: 'firstWord', length: null, ifEmpty: 'skip' };

export const STARTER: Design = {
  separator: '#',
  options: [
    { ...tidy, pieces: [firstName(1), secondInitial, surname] },
    { ...tidy, pieces: [firstName(2), secondInitial, surname] },
  ],
};

export function blankOption(columns: string[]): Option {
  const first = columns.find((name) => name.toLowerCase() === 'firstname') ?? columns[0] ?? 'firstname';
  return {
    conditions: [],
    pieces: [{ kind: 'attribute', column: first, part: 'whole', length: null, ifEmpty: 'skip' }],
    lowercase: true,
    removeAccents: true,
    removeSpaces: true,
    removeSymbols: false,
    maxLength: null,
  };
}
