import { FAILURE, SUCCESS, innerJourney, scriptOf, type Journey } from './parse';

export type Level = 'error' | 'warn' | 'info';

export type FindingCode =
  | 'noEntry'
  | 'brokenLink'
  | 'openOutcome'
  | 'unreachable'
  | 'noSuccess'
  | 'legacyScript'
  | 'missingScript'
  | 'missingJourney'
  | 'emptyPage'
  | 'disabled';

export interface Finding {
  level: Level;
  code: FindingCode;
  node?: string;
  detail?: string;
}

const ORDER: Record<Level, number> = { error: 0, warn: 1, info: 2 };

export function reachable(journey: Journey): Set<string> {
  const byId = new Map(journey.nodes.map((node) => [node.id, node]));
  const seen = new Set<string>();
  const queue = [journey.entry];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const node = byId.get(id);
    if (node) queue.push(...Object.values(node.connections));
  }
  return seen;
}

export function checkJourney(journey: Journey, available: string[] = []): Finding[] {
  const findings: Finding[] = [];
  const ids = new Set(journey.nodes.map((node) => node.id));
  const isTarget = (id: string) => ids.has(id) || id === SUCCESS || id === FAILURE;

  if (journey.settings.enabled === false) findings.push({ level: 'info', code: 'disabled' });

  if (!ids.has(journey.entry)) {
    findings.push({ level: 'error', code: 'noEntry' });
  } else {
    const seen = reachable(journey);
    if (!seen.has(SUCCESS)) findings.push({ level: 'error', code: 'noSuccess' });
    for (const node of journey.nodes) {
      if (!seen.has(node.id)) findings.push({ level: 'warn', code: 'unreachable', node: node.id });
    }
  }

  for (const node of journey.nodes) {
    for (const [outcome, target] of Object.entries(node.connections)) {
      if (!isTarget(target)) findings.push({ level: 'error', code: 'brokenLink', node: node.id, detail: outcome });
    }
    for (const outcome of node.outcomes ?? []) {
      if (!(outcome in node.connections)) findings.push({ level: 'warn', code: 'openOutcome', node: node.id, detail: outcome });
    }
    if (node.type === 'PageNode' && (node.children ?? []).length === 0) {
      findings.push({ level: 'warn', code: 'emptyPage', node: node.id });
    }
    const script = scriptOf(node);
    if (script) {
      const found = journey.scripts[script];
      if (!found) findings.push({ level: 'info', code: 'missingScript', node: node.id, detail: script });
      else if (!found.nextGen) findings.push({ level: 'warn', code: 'legacyScript', node: node.id, detail: found.name });
    }
    const inner = innerJourney(node);
    if (inner && !available.includes(inner)) {
      findings.push({ level: 'info', code: 'missingJourney', node: node.id, detail: inner });
    }
  }

  return findings.sort((a, b) => ORDER[a.level] - ORDER[b.level]);
}
