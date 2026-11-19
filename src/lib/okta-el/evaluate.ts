import { ExpressionError, parse, type Node } from './parse';

export type Value = string | number | boolean | null | Value[] | { [key: string]: Value };

export interface Group {
  id: string;
  name: string;
  source: string;
}

export interface Context {
  user?: Record<string, Value>;
  appuser?: Record<string, Value>;
  app?: Record<string, Value>;
  org?: Record<string, Value>;
  groups?: Group[];
  internal?: Record<string, Value>;
  now?: string;
}

export interface Result {
  value: Value;
  used: string[];
}

interface Fn {
  min: number;
  max: number;
  signature: string;
  description: string;
  run: (args: Value[], context: Context, fail: (message: string) => never) => Value;
}

export function typeOf(value: Value): 'text' | 'number' | 'boolean' | 'list' | 'object' | 'nothing' {
  if (value === null) return 'nothing';
  if (Array.isArray(value)) return 'list';
  if (typeof value === 'string') return 'text';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  return 'object';
}

const NAMES: Record<string, string> = {
  text: 'text',
  number: 'a number',
  boolean: 'true or false',
  list: 'a list',
  object: 'an object',
  nothing: 'nothing (null)',
};
const named = (value: Value) => NAMES[typeOf(value)];

function text(name: string, args: Value[], index: number, fail: (message: string) => never): string {
  const value = args[index];
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fail(`${name} expects text as value ${index + 1}, but got ${named(value)}`);
}

function list(name: string, value: Value, fail: (message: string) => never): Value[] {
  if (value === null) return [];
  if (Array.isArray(value)) return value;
  return fail(`${name} expects a list, but got ${named(value)}`);
}

function regex(name: string, pattern: string, fail: (message: string) => never, flags = ''): RegExp {
  try {
    return new RegExp(pattern, flags);
  } catch {
    return fail(`${name} received an invalid regular expression: ${pattern}`);
  }
}

const same = (a: Value, b: Value) => JSON.stringify(a) === JSON.stringify(b);

function nullSafe(name: string, run: (value: string) => Value): Fn['run'] {
  return (args, _, fail) => (args[0] === null ? null : run(text(name, args, 0, fail)));
}

function groupNames(context: Context) {
  return (context.groups ?? []).map((group) => group.name);
}

function groupsFrom(match: (name: string, pattern: string) => boolean): Fn['run'] {
  return (args, context, fail) => {
    const source = text('Groups', args, 0, fail).toLowerCase();
    const pattern = text('Groups', args, 1, fail);
    const limit = Math.min(Number(args[2] ?? 100), 100);
    if (!Number.isFinite(limit) || limit < 1) fail('The limit of a Groups function must be a number from 1 to 100');
    return (context.groups ?? [])
      .filter((group) => group.source.toLowerCase() === source && match(group.name, pattern))
      .slice(0, limit)
      .map((group) => group.name);
  };
}

const INTERNAL = ['id', 'status', 'created', 'activated', 'statusChanged', 'lastLogin', 'lastUpdated', 'passwordChanged'];

export const functions: Record<string, Fn> = {
  'String.append': {
    min: 2,
    max: 2,
    signature: 'String.append(text, text)',
    description: 'Joins two texts.',
    run: (args, _, fail) => text('String.append', args, 0, fail) + text('String.append', args, 1, fail),
  },
  'String.join': {
    min: 2,
    max: Infinity,
    signature: 'String.join(separator, text, …)',
    description: 'Joins several texts with a separator between them.',
    run: (args, _, fail) => {
      const parts = args.slice(1).filter((value) => value !== null);
      return parts.map((_, index) => text('String.join', parts, index, fail)).join(text('String.join', args, 0, fail));
    },
  },
  'String.len': {
    min: 1,
    max: 1,
    signature: 'String.len(text)',
    description: 'Counts the characters of a text.',
    run: nullSafe('String.len', (value) => value.length),
  },
  'String.removeSpaces': {
    min: 1,
    max: 1,
    signature: 'String.removeSpaces(text)',
    description: 'Removes every space.',
    run: nullSafe('String.removeSpaces', (value) => value.replace(/ /g, '')),
  },
  'String.replace': {
    min: 3,
    max: 3,
    signature: 'String.replace(text, pattern, replacement)',
    description: 'Replaces every match of a regular expression.',
    run: (args, _, fail) =>
      args[0] === null
        ? null
        : text('String.replace', args, 0, fail).replace(
            regex('String.replace', text('String.replace', args, 1, fail), fail, 'g'),
            text('String.replace', args, 2, fail),
          ),
  },
  'String.replaceFirst': {
    min: 3,
    max: 3,
    signature: 'String.replaceFirst(text, pattern, replacement)',
    description: 'Replaces the first match of a regular expression.',
    run: (args, _, fail) =>
      args[0] === null
        ? null
        : text('String.replaceFirst', args, 0, fail).replace(
            regex('String.replaceFirst', text('String.replaceFirst', args, 1, fail), fail),
            text('String.replaceFirst', args, 2, fail),
          ),
  },
  'String.stringContains': {
    min: 2,
    max: 2,
    signature: 'String.stringContains(text, part)',
    description: 'Says whether a text contains another.',
    run: (args, _, fail) =>
      args[0] !== null && text('String.stringContains', args, 0, fail).includes(text('String.stringContains', args, 1, fail)),
  },
  'String.stringSwitch': {
    min: 4,
    max: Infinity,
    signature: 'String.stringSwitch(text, default, key, value, …)',
    description: 'Returns the value of the first key the text contains, or the default.',
    run: (args, _, fail) => {
      if ((args.length - 2) % 2 !== 0) fail('String.stringSwitch needs pairs of key and value after the default');
      const input = args[0] === null ? '' : text('String.stringSwitch', args, 0, fail);
      for (let i = 2; i < args.length; i += 2) {
        if (input.includes(text('String.stringSwitch', args, i, fail))) return args[i + 1];
      }
      return args[1];
    },
  },
  'String.substring': {
    min: 3,
    max: 3,
    signature: 'String.substring(text, start, end)',
    description: 'Takes the characters from start up to, but not including, end. The first one is 0.',
    run: (args, _, fail) => {
      if (args[0] === null) return null;
      const value = text('String.substring', args, 0, fail);
      const [start, end] = [args[1], args[2]];
      if (typeof start !== 'number' || typeof end !== 'number') fail('String.substring expects numbers for start and end');
      if (start < 0 || end > value.length || start > end) {
        fail(`String.substring is out of range: the text has ${value.length} characters`);
      }
      return value.slice(start, end);
    },
  },
  'String.substringAfter': {
    min: 2,
    max: 2,
    signature: 'String.substringAfter(text, separator)',
    description: 'Takes what comes after the first separator.',
    run: (args, _, fail) => {
      if (args[0] === null) return null;
      const value = text('String.substringAfter', args, 0, fail);
      const separator = text('String.substringAfter', args, 1, fail);
      const index = value.indexOf(separator);
      return index === -1 ? '' : value.slice(index + separator.length);
    },
  },
  'String.substringBefore': {
    min: 2,
    max: 2,
    signature: 'String.substringBefore(text, separator)',
    description: 'Takes what comes before the first separator.',
    run: (args, _, fail) => {
      if (args[0] === null) return null;
      const value = text('String.substringBefore', args, 0, fail);
      const index = value.indexOf(text('String.substringBefore', args, 1, fail));
      return index === -1 ? value : value.slice(0, index);
    },
  },
  'String.toLowerCase': {
    min: 1,
    max: 1,
    signature: 'String.toLowerCase(text)',
    description: 'Turns a text into lower case.',
    run: nullSafe('String.toLowerCase', (value) => value.toLowerCase()),
  },
  'String.toUpperCase': {
    min: 1,
    max: 1,
    signature: 'String.toUpperCase(text)',
    description: 'Turns a text into upper case.',
    run: nullSafe('String.toUpperCase', (value) => value.toUpperCase()),
  },
  'Arrays.add': {
    min: 2,
    max: 2,
    signature: 'Arrays.add(list, value)',
    description: 'Adds a value at the end of a list.',
    run: (args, _, fail) => [...list('Arrays.add', args[0], fail), args[1]],
  },
  'Arrays.remove': {
    min: 2,
    max: 2,
    signature: 'Arrays.remove(list, value)',
    description: 'Removes a value from a list.',
    run: (args, _, fail) => list('Arrays.remove', args[0], fail).filter((item) => !same(item, args[1])),
  },
  'Arrays.clear': {
    min: 1,
    max: 1,
    signature: 'Arrays.clear(list)',
    description: 'Returns an empty list.',
    run: () => [],
  },
  'Arrays.contains': {
    min: 2,
    max: 2,
    signature: 'Arrays.contains(list, value)',
    description: 'Says whether a list contains a value.',
    run: (args, _, fail) => list('Arrays.contains', args[0], fail).some((item) => same(item, args[1])),
  },
  'Arrays.flatten': {
    min: 1,
    max: Infinity,
    signature: 'Arrays.flatten(value, …)',
    description: 'Puts values and the items of lists into a single list.',
    run: (args) => args.flatMap((value) => (Array.isArray(value) ? value : [value])),
  },
  'Arrays.isEmpty': {
    min: 1,
    max: 1,
    signature: 'Arrays.isEmpty(list)',
    description: 'Says whether a list is empty.',
    run: (args, _, fail) => list('Arrays.isEmpty', args[0], fail).length === 0,
  },
  'Arrays.size': {
    min: 1,
    max: 1,
    signature: 'Arrays.size(list)',
    description: 'Counts the items of a list.',
    run: (args, _, fail) => list('Arrays.size', args[0], fail).length,
  },
  'Arrays.toCsvString': {
    min: 1,
    max: 1,
    signature: 'Arrays.toCsvString(list)',
    description: 'Joins the items of a list with commas.',
    run: (args, _, fail) => list('Arrays.toCsvString', args[0], fail).map((item) => (item === null ? '' : String(item))).join(','),
  },
  'Convert.toInt': {
    min: 1,
    max: 1,
    signature: 'Convert.toInt(value)',
    description: 'Turns a text or a number into a whole number, rounding it.',
    run: (args, _, fail) => {
      const number = typeof args[0] === 'string' ? Number(args[0].trim()) : args[0];
      if (typeof number !== 'number' || !Number.isFinite(number) || (typeof args[0] === 'string' && !args[0].trim())) {
        return fail(`Convert.toInt cannot turn ${typeof args[0] === 'string' ? `“${args[0]}”` : named(args[0])} into a number`);
      }
      return Math.round(number);
    },
  },
  'Convert.toNum': {
    min: 1,
    max: 1,
    signature: 'Convert.toNum(value)',
    description: 'Turns a text or a number into a number.',
    run: (args, _, fail) => {
      const number = typeof args[0] === 'string' ? Number(args[0].trim()) : args[0];
      if (typeof number !== 'number' || !Number.isFinite(number) || (typeof args[0] === 'string' && !args[0].trim())) {
        return fail(`Convert.toNum cannot turn ${typeof args[0] === 'string' ? `“${args[0]}”` : named(args[0])} into a number`);
      }
      return number;
    },
  },
  'Time.now': {
    min: 0,
    max: 2,
    signature: 'Time.now()',
    description: 'The current date and time, in ISO 8601.',
    run: (_, context) => new Date(context.now ?? Date.now()).toISOString(),
  },
  'Time.fromIso8601ToUnix': {
    min: 1,
    max: 1,
    signature: 'Time.fromIso8601ToUnix(date)',
    description: 'Turns an ISO 8601 date into seconds since 1970.',
    run: (args, _, fail) => {
      const time = Date.parse(text('Time.fromIso8601ToUnix', args, 0, fail));
      if (Number.isNaN(time)) fail('Time.fromIso8601ToUnix expects a date such as 2026-01-31T10:00:00Z');
      return String(Math.floor(time / 1000));
    },
  },
  'Time.fromUnixToIso8601': {
    min: 1,
    max: 1,
    signature: 'Time.fromUnixToIso8601(seconds)',
    description: 'Turns seconds since 1970 into an ISO 8601 date.',
    run: (args, _, fail) => {
      const seconds = Number(args[0]);
      if (args[0] === null || !Number.isFinite(seconds)) fail('Time.fromUnixToIso8601 expects a number of seconds');
      return new Date(seconds * 1000).toISOString();
    },
  },
  'Time.fromWindowsToIso8601': {
    min: 1,
    max: 1,
    signature: 'Time.fromWindowsToIso8601(value)',
    description: 'Turns a Windows file time, as Active Directory stores it, into an ISO 8601 date.',
    run: (args, _, fail) => {
      const ticks = Number(args[0]);
      if (args[0] === null || !Number.isFinite(ticks)) fail('Time.fromWindowsToIso8601 expects a number');
      return new Date(ticks / 10_000 - 11_644_473_600_000).toISOString();
    },
  },
  'Groups.contains': {
    min: 3,
    max: 3,
    signature: 'Groups.contains(source, part, limit)',
    description: 'Names of the user’s groups from a source that contain a text. Used in token claims.',
    run: groupsFrom((name, pattern) => name.includes(pattern)),
  },
  'Groups.startsWith': {
    min: 3,
    max: 3,
    signature: 'Groups.startsWith(source, prefix, limit)',
    description: 'Names of the user’s groups from a source that start with a text. Used in token claims.',
    run: groupsFrom((name, pattern) => name.startsWith(pattern)),
  },
  'Groups.endsWith': {
    min: 3,
    max: 3,
    signature: 'Groups.endsWith(source, suffix, limit)',
    description: 'Names of the user’s groups from a source that end with a text. Used in token claims.',
    run: groupsFrom((name, pattern) => name.endsWith(pattern)),
  },
  isMemberOfGroup: {
    min: 1,
    max: 1,
    signature: 'isMemberOfGroup(groupId)',
    description: 'Says whether the user is in the group with that ID.',
    run: (args, context, fail) => (context.groups ?? []).some((group) => group.id === text('isMemberOfGroup', args, 0, fail)),
  },
  isMemberOfAnyGroup: {
    min: 1,
    max: Infinity,
    signature: 'isMemberOfAnyGroup(groupId, …)',
    description: 'Says whether the user is in any of the groups with those IDs.',
    run: (args, context, fail) => {
      const ids = args.map((_, index) => text('isMemberOfAnyGroup', args, index, fail));
      return (context.groups ?? []).some((group) => ids.includes(group.id));
    },
  },
  isMemberOfGroupName: {
    min: 1,
    max: 1,
    signature: 'isMemberOfGroupName(name)',
    description: 'Says whether the user is in a group with exactly that name.',
    run: (args, context, fail) => groupNames(context).includes(text('isMemberOfGroupName', args, 0, fail)),
  },
  isMemberOfGroupNameStartsWith: {
    min: 1,
    max: 1,
    signature: 'isMemberOfGroupNameStartsWith(prefix)',
    description: 'Says whether the user is in a group whose name starts with a text.',
    run: (args, context, fail) => {
      const prefix = text('isMemberOfGroupNameStartsWith', args, 0, fail);
      return groupNames(context).some((name) => name.startsWith(prefix));
    },
  },
  isMemberOfGroupNameContains: {
    min: 1,
    max: 1,
    signature: 'isMemberOfGroupNameContains(part)',
    description: 'Says whether the user is in a group whose name contains a text.',
    run: (args, context, fail) => {
      const part = text('isMemberOfGroupNameContains', args, 0, fail);
      return groupNames(context).some((name) => name.includes(part));
    },
  },
  isMemberOfGroupNameRegex: {
    min: 1,
    max: 1,
    signature: 'isMemberOfGroupNameRegex(pattern)',
    description: 'Says whether the user is in a group whose whole name matches a regular expression.',
    run: (args, context, fail) => {
      const pattern = regex('isMemberOfGroupNameRegex', `^(?:${text('isMemberOfGroupNameRegex', args, 0, fail)})$`, fail);
      return groupNames(context).some((name) => pattern.test(name));
    },
  },
  'user.getInternalProperty': {
    min: 1,
    max: 1,
    signature: 'user.getInternalProperty(name)',
    description: `Reads a property Okta keeps outside the profile: ${INTERNAL.join(', ')}.`,
    run: (args, context, fail) => {
      const name = text('user.getInternalProperty', args, 0, fail);
      if (!INTERNAL.includes(name)) fail(`“${name}” is not an internal property. Use one of: ${INTERNAL.join(', ')}`);
      return context.internal?.[name] ?? null;
    },
  },
};

const NAMESPACES = ['String', 'Arrays', 'Convert', 'Time', 'Groups'];
const ROOTS = ['user', 'appuser', 'app', 'org'];

function closest(name: string): string | undefined {
  const lower = name.toLowerCase();
  return Object.keys(functions).find((candidate) => candidate.toLowerCase() === lower);
}

function functionName(callee: Node): string | undefined {
  if (callee.kind === 'name') return callee.name;
  if (callee.kind === 'member' && callee.object.kind === 'name') return `${callee.object.name}.${callee.property}`;
  return undefined;
}

export function evaluate(source: string, context: Context): Result {
  const tree = parse(source);
  const used = new Set<string>();

  function run(node: Node): Value {
    const fail = (message: string): never => {
      throw new ExpressionError(message, node.at);
    };

    switch (node.kind) {
      case 'literal':
        return node.value;
      case 'list':
        return node.items.map(run);
      case 'name': {
        if (ROOTS.includes(node.name)) return (context[node.name as 'user'] as Value | undefined) ?? null;
        if (NAMESPACES.includes(node.name)) return fail(`${node.name} is a group of functions. Call one, for example ${node.name}.${Object.keys(functions).find((f) => f.startsWith(`${node.name}.`))!.split('.')[1]}(…)`);
        if (functions[node.name]) return fail(`${node.name} is a function and needs brackets: ${functions[node.name].signature}`);
        return fail(`Unknown name “${node.name}”. Expressions start from user, appuser, app or org`);
      }
      case 'member': {
        if (node.object.kind === 'name' && NAMESPACES.includes(node.object.name)) {
          const name = `${node.object.name}.${node.property}`;
          return fail(functions[name] ? `${name} needs brackets: ${functions[name].signature}` : `Okta has no function ${name}`);
        }
        const object = run(node.object);
        if (object === null) return null;
        if (typeof object !== 'object' || Array.isArray(object)) {
          return fail(`“${node.property}” cannot be read from ${named(object)}`);
        }
        return object[node.property] ?? null;
      }
      case 'index': {
        const object = run(node.object);
        const index = run(node.index);
        if (!Array.isArray(object)) return fail(`Only lists can be read by position, not ${named(object)}`);
        if (typeof index !== 'number' || !Number.isInteger(index)) return fail('A position must be a whole number');
        return object[index] ?? null;
      }
      case 'call': {
        const name = functionName(node.callee);
        const fn = name ? functions[name] : undefined;
        if (!name || !fn) {
          const suggestion = name && closest(name);
          if (suggestion) return fail(`Okta has no function ${name}. Did you mean ${suggestion}?`);
          const namespace = node.callee.kind === 'member' && node.callee.object.kind === 'name' && NAMESPACES.includes(node.callee.object.name);
          if (node.callee.kind === 'member' && !namespace) {
            return fail(`Okta does not call functions on values, such as .${node.callee.property}(). Use the String, Arrays or Convert functions instead`);
          }
          return fail(`Okta has no function ${name ?? 'here'}`);
        }
        if (node.args.length < fn.min || node.args.length > fn.max) {
          const expected = fn.min === fn.max ? `${fn.min}` : fn.max === Infinity ? `at least ${fn.min}` : `${fn.min} to ${fn.max}`;
          return fail(`${name} expects ${expected} value(s) but got ${node.args.length}: ${fn.signature}`);
        }
        const values = node.args.map(run);
        used.add(name);
        return fn.run(values, context, fail);
      }
      case 'unary': {
        const value = run(node.operand);
        if (node.operator === '!') {
          if (typeof value !== 'boolean') return fail(`“not” needs true or false, but got ${named(value)}`);
          return !value;
        }
        if (typeof value !== 'number') return fail(`Only numbers can be negative, not ${named(value)}`);
        return -value;
      }
      case 'binary':
        return binary(node.operator, node.left, node.right, fail);
      case 'ternary': {
        const test = run(node.test);
        if (typeof test !== 'boolean') return fail(`The condition before “?” must be true or false, but it is ${named(test)}`);
        return test ? run(node.then) : run(node.otherwise);
      }
      case 'elvis': {
        const value = run(node.value);
        return value === null ? run(node.fallback) : value;
      }
    }
  }

  function binary(operator: string, leftNode: Node, rightNode: Node, fail: (message: string) => never): Value {
    if (operator === '&&' || operator === '||') {
      const left = run(leftNode);
      if (typeof left !== 'boolean') return fail(`“${operator === '&&' ? 'and' : 'or'}” needs true or false on both sides, but the left side is ${named(left)}`);
      if (operator === '&&' && !left) return false;
      if (operator === '||' && left) return true;
      const right = run(rightNode);
      if (typeof right !== 'boolean') return fail(`“${operator === '&&' ? 'and' : 'or'}” needs true or false on both sides, but the right side is ${named(right)}`);
      return right;
    }
    const left = run(leftNode);
    const right = run(rightNode);
    switch (operator) {
      case '==':
        return same(left, right);
      case '!=':
        return !same(left, right);
      case '+':
        if (typeof left === 'number' && typeof right === 'number') return left + right;
        if (typeof left === 'string' || typeof right === 'string') {
          const show = (value: Value) => (value === null ? 'null' : typeof value === 'object' ? JSON.stringify(value) : String(value));
          return show(left) + show(right);
        }
        return fail(`“+” adds numbers or joins texts, but got ${named(left)} and ${named(right)}`);
    }
    if (operator === '<' || operator === '>' || operator === '<=' || operator === '>=') {
      const comparable = (typeof left === 'number' && typeof right === 'number') || (typeof left === 'string' && typeof right === 'string');
      if (!comparable) return fail(`“${operator}” compares two numbers or two texts, but got ${named(left)} and ${named(right)}`);
      const a = left as number | string;
      const b = right as number | string;
      return operator === '<' ? a < b : operator === '>' ? a > b : operator === '<=' ? a <= b : a >= b;
    }
    if (typeof left !== 'number' || typeof right !== 'number') {
      return fail(`“${operator}” works with numbers, but got ${named(left)} and ${named(right)}`);
    }
    if ((operator === '/' || operator === '%') && right === 0) return fail('Cannot divide by zero');
    if (operator === '-') return left - right;
    if (operator === '*') return left * right;
    if (operator === '%') return left % right;
    return left / right;
  }

  return { value: run(tree), used: [...used] };
}
