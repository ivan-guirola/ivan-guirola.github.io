import { formatValue } from './nodes';
import { FAILURE, SUCCESS, scriptOf, type Journey, type JourneyExport, type JourneyNode } from './parse';

export interface Change {
  field: string;
  before?: string;
  after?: string;
}

export interface DiffLine {
  op: ' ' | '+' | '-';
  text: string;
}

export interface NodeDiff {
  status: 'added' | 'removed' | 'changed';
  id: string;
  name: string;
  type: string;
  changes: Change[];
  script?: DiffLine[];
}

export interface JourneyDiff {
  name: string;
  settings: Change[];
  nodes: NodeDiff[];
}

export interface JourneyComparison {
  name: string;
  status: 'added' | 'removed' | 'changed' | 'same';
  diff?: JourneyDiff;
}

const MAX_LINES = 4000;

export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before.split('\n');
  const b = after.split('\n');
  if (a.length * b.length > MAX_LINES * MAX_LINES / 4) {
    return [...a.map((text) => ({ op: '-' as const, text })), ...b.map((text) => ({ op: '+' as const, text }))];
  }
  const table = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      lines.push({ op: ' ', text: a[i] });
      i++;
      j++;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      lines.push({ op: '-', text: a[i++] });
    } else {
      lines.push({ op: '+', text: b[j++] });
    }
  }
  while (i < a.length) lines.push({ op: '-', text: a[i++] });
  while (j < b.length) lines.push({ op: '+', text: b[j++] });
  return lines;
}

const show = (value: unknown): string | undefined => (value === undefined ? undefined : formatValue(value));

function compare(field: string, before: unknown, after: unknown, into: Change[]) {
  const a = show(before);
  const b = show(after);
  if (a !== b) into.push({ field, before: a, after: b });
}

function targetName(journey: Journey, id: string): string {
  if (id === SUCCESS) return 'Success';
  if (id === FAILURE) return 'Failure';
  return journey.nodes.find((node) => node.id === id)?.name ?? id;
}

function scriptText(journey: Journey, node: JourneyNode) {
  const id = scriptOf(node);
  if (!id) return undefined;
  return journey.scripts[id];
}

function pair(a: Journey, b: Journey): [JourneyNode | undefined, JourneyNode | undefined][] {
  const pairs: [JourneyNode | undefined, JourneyNode | undefined][] = [];
  const left = new Map(a.nodes.map((node) => [node.id, node]));
  const right = new Map(b.nodes.map((node) => [node.id, node]));
  for (const [id, node] of left) {
    if (right.has(id)) {
      pairs.push([node, right.get(id)]);
      left.delete(id);
      right.delete(id);
    }
  }
  const key = (node: JourneyNode) => `${node.type}\u0000${node.name}`;
  for (const node of [...left.values()]) {
    const match = [...right.values()].find((candidate) => key(candidate) === key(node));
    if (match) {
      pairs.push([node, match]);
      left.delete(node.id);
      right.delete(match.id);
    }
  }
  for (const node of left.values()) pairs.push([node, undefined]);
  for (const node of right.values()) pairs.push([undefined, node]);
  return pairs;
}

function steps(node: JourneyNode) {
  return node.children?.map((child) => `${child.name} (${child.type})`).join(', ');
}

export function diffJourneys(a: Journey, b: Journey): JourneyDiff {
  const settings: Change[] = [];
  const keys = new Set([...Object.keys(a.settings), ...Object.keys(b.settings)]);
  for (const key of keys) compare(key, a.settings[key], b.settings[key], settings);
  compare('entry', targetName(a, a.entry), targetName(b, b.entry), settings);

  const pairs = pair(a, b);
  const match = new Map<string, string>([
    [SUCCESS, SUCCESS],
    [FAILURE, FAILURE],
  ]);
  for (const [before, after] of pairs) if (before && after) match.set(before.id, after.id);

  const nodes: NodeDiff[] = [];
  for (const [before, after] of pairs) {
    const node = (after ?? before)!;
    const base = { id: node.id, name: node.name, type: node.type };
    if (!before) {
      nodes.push({ ...base, status: 'added', changes: [] });
      continue;
    }
    if (!after) {
      nodes.push({ ...base, status: 'removed', changes: [] });
      continue;
    }

    const changes: Change[] = [];
    compare('name', before.name, after.name, changes);
    compare('type', before.type, after.type, changes);
    const outcomes = new Set([...Object.keys(before.connections), ...Object.keys(after.connections)]);
    for (const outcome of outcomes) {
      const from = before.connections[outcome];
      const to = after.connections[outcome];
      if (from && to && match.get(from) === to) continue;
      compare(`outcome:${outcome}`, from && targetName(a, from), to && targetName(b, to), changes);
    }
    const config = new Set([...Object.keys(before.config ?? {}), ...Object.keys(after.config ?? {})]);
    config.delete('script');
    for (const key of config) compare(`config:${key}`, before.config?.[key], after.config?.[key], changes);
    compare('steps', steps(before), steps(after), changes);

    const oldScript = scriptText(a, before);
    const newScript = scriptText(b, after);
    let script: DiffLine[] | undefined;
    if (oldScript || newScript) {
      compare('script', oldScript?.name ?? scriptOf(before), newScript?.name ?? scriptOf(after), changes);
      if (oldScript && newScript && oldScript.source !== newScript.source) {
        script = lineDiff(oldScript.source, newScript.source);
        changes.push({ field: 'scriptSource' });
      }
      if (oldScript && newScript && oldScript.nextGen !== newScript.nextGen) {
        compare('scriptEngine', oldScript.nextGen ? 'next' : 'legacy', newScript.nextGen ? 'next' : 'legacy', changes);
      }
    }

    if (changes.length > 0) nodes.push({ ...base, status: 'changed', changes, script });
  }

  return { name: b.name, settings, nodes };
}

export function compareExports(a: JourneyExport, b: JourneyExport): JourneyComparison[] {
  const left = new Map(a.journeys.map((journey) => [journey.name, journey]));
  const right = new Map(b.journeys.map((journey) => [journey.name, journey]));
  const names = [...new Set([...left.keys(), ...right.keys()])];
  return names.map((name) => {
    const before = left.get(name);
    const after = right.get(name);
    if (!before) return { name, status: 'added' };
    if (!after) return { name, status: 'removed' };
    const diff = diffJourneys(before, after);
    const same = diff.settings.length === 0 && diff.nodes.length === 0;
    return { name, status: same ? 'same' : 'changed', diff };
  });
}
