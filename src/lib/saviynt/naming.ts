import { SqlError, evaluateSql, parseSql, type Node, type Row } from './sql';

export interface Rule {
  source: string;
  offset: number;
  tree: Node;
}

export interface Settings {
  maxLength: number;
  strictCharacters: boolean;
}

export type IssueCode = 'tooLong' | 'uppercase' | 'spaces' | 'characters' | 'edges' | 'doubleDot';

export interface Issue {
  code: IssueCode;
  detail?: string;
}

export interface Attempt {
  rule: number;
  value: string | null;
  outcome: 'used' | 'taken' | 'empty' | 'null';
  nullColumns: string[];
  concatNull: boolean;
}

export interface Outcome {
  row: Row;
  username: string | null;
  rule?: number;
  attempts: Attempt[];
  issues: Issue[];
}

export class RuleError extends SqlError {
  constructor(
    message: string,
    position: number,
    readonly rule: number,
  ) {
    super(message, position);
  }
}

export function splitRules(text: string): { source: string; offset: number }[] {
  const parts: { source: string; offset: number }[] = [];
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quote) {
      if (char === '\\') i++;
      else if (char === quote) quote = null;
    } else if (char === "'" || char === '"') {
      quote = char;
    } else if (char === '#') {
      let end = i;
      while (text[end] === '#') end++;
      parts.push({ source: text.slice(start, i), offset: start });
      start = end;
      i = end - 1;
    }
  }
  parts.push({ source: text.slice(start), offset: start });
  return parts;
}

export function compileRules(text: string): Rule[] {
  return splitRules(text).map((part, index) => {
    try {
      return { ...part, tree: parseSql(part.source) };
    } catch (error) {
      const sql = error as SqlError;
      const message = sql.message === 'The rule is empty' && text.includes('#') ? `Option ${index + 1} is empty` : sql.message;
      throw new RuleError(message, part.offset + sql.position, index);
    }
  });
}

export function parseCsv(text: string): { columns: string[]; rows: Row[] } {
  const lines: string[][] = [];
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  let field = '';
  let row: string[] = [];
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"' && field === '') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      lines.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    lines.push(row);
  }
  const filled = lines.filter((line) => line.some((cell) => cell.trim() !== ''));
  if (filled.length === 0) throw new Error('The sample users are empty');
  const columns = filled[0].map((name) => name.trim().replace(/^users\./i, ''));
  if (columns.some((name) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))) {
    throw new Error('The first line must name the columns, such as firstname,lastname');
  }
  const rows = filled.slice(1).map((line) =>
    Object.fromEntries(columns.map((column, index) => [column, line[index] === undefined || line[index] === '' ? null : line[index]])),
  );
  return { columns, rows };
}

export function checkUsername(username: string, settings: Settings): Issue[] {
  const issues: Issue[] = [];
  const length = Array.from(username).length;
  if (length > settings.maxLength) issues.push({ code: 'tooLong', detail: String(length) });
  if (settings.strictCharacters) {
    if (/[A-Z]/.test(username)) issues.push({ code: 'uppercase' });
    if (/\s/.test(username)) issues.push({ code: 'spaces' });
    const other = [...new Set(Array.from(username).filter((char) => !/[A-Za-z0-9._\-\s]/.test(char)))];
    if (other.length > 0) issues.push({ code: 'characters', detail: other.join(' ') });
  }
  if (/^[.-]|[.-]$/.test(username)) issues.push({ code: 'edges' });
  if (username.includes('..')) issues.push({ code: 'doubleDot' });
  return issues;
}

export function generate(rules: Rule[], rows: Row[], columns: string[], taken: string[], settings: Settings): Outcome[] {
  const used = new Set(taken.map((name) => name.trim().toLowerCase()).filter(Boolean));
  return rows.map((row) => {
    const attempts: Attempt[] = [];
    for (const [index, rule] of rules.entries()) {
      let result;
      try {
        result = evaluateSql(rule.tree, row, columns);
      } catch (error) {
        const sql = error as SqlError;
        throw new RuleError(sql.message, rule.offset + sql.position, index);
      }
      const value = result.value === null ? null : String(result.value);
      const attempt: Attempt = {
        rule: index,
        value,
        outcome: 'used',
        nullColumns: [...result.trace.nullColumns],
        concatNull: result.trace.concatNull,
      };
      attempts.push(attempt);
      if (value === null) attempt.outcome = 'null';
      else if (value.trim() === '') attempt.outcome = 'empty';
      else if (used.has(value.trim().toLowerCase())) attempt.outcome = 'taken';
      if (attempt.outcome !== 'used') continue;
      used.add(value!.trim().toLowerCase());
      return { row, username: value, rule: index, attempts, issues: checkUsername(value!, settings) };
    }
    return { row, username: null, attempts, issues: [] };
  });
}

export function ruleNotes(text: string): ('length')[] {
  const outside = splitRules(text)
    .map((part) => part.source.replace(/'(?:[^'\\]|\\.|'')*'|"(?:[^"\\]|\\.|"")*"/g, ''))
    .join(' ');
  return /\bLENGTH\s*\(/i.test(outside) ? ['length'] : [];
}
