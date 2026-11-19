import { knownOutcomes } from './nodes';

export const SUCCESS = '70e691a5-1e33-4ac3-a356-e7b6d60d92e0';
export const FAILURE = 'e301438c-0bd0-429c-ab0c-66126501069a';

export interface Point {
  x: number;
  y: number;
}

export interface Child {
  id: string;
  type: string;
  name: string;
  config?: Record<string, unknown>;
}

export interface JourneyNode {
  id: string;
  type: string;
  name: string;
  connections: Record<string, string>;
  outcomes?: string[];
  config?: Record<string, unknown>;
  children?: Child[];
  position?: Point;
}

export interface Script {
  id: string;
  name: string;
  language?: string;
  context?: string;
  nextGen: boolean;
  source: string;
  description?: string;
}

export interface Journey {
  name: string;
  entry: string;
  settings: Record<string, unknown>;
  nodes: JourneyNode[];
  statics: { start?: Point; success?: Point; failure?: Point };
  scripts: Record<string, Script>;
}

export interface JourneyExport {
  origin?: string;
  journeys: Journey[];
}

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);

const HIDDEN = new Set(['_id', '_rev', '_type', '_outcomes']);
const SETTINGS = ['description', 'enabled', 'identityResource', 'innerTreeOnly', 'mustRun', 'noSession', 'uiConfig'];

function point(value: unknown): Point | undefined {
  if (!isObject(value)) return undefined;
  if (value.x === undefined || value.y === undefined) return undefined;
  const x = Number(value.x);
  const y = Number(value.y);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : undefined;
}

function cleanConfig(value: unknown): Record<string, unknown> | undefined {
  if (!isObject(value)) return undefined;
  const config = Object.fromEntries(Object.entries(value).filter(([key]) => !HIDDEN.has(key)));
  return Object.keys(config).length > 0 ? config : undefined;
}

export function decodeSource(value: unknown): string {
  if (Array.isArray(value)) return value.map(String).join('\n');
  if (typeof value !== 'string') return '';
  const compact = value.replace(/\s/g, '');
  if (compact.length >= 8 && compact.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(compact)) {
    try {
      const bytes = Uint8Array.from(atob(compact), (char) => char.charCodeAt(0));
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      if (!/[\u0000-\u0008\u000e-\u001f]/.test(text)) return text;
    } catch {
      return value;
    }
  }
  return value;
}

function parseScript(id: string, value: Json): Script {
  const context = typeof value.context === 'string' ? value.context : undefined;
  const version = String(value.evaluatorVersion ?? '');
  return {
    id,
    name: typeof value.name === 'string' ? value.name : id,
    language: typeof value.language === 'string' ? value.language : undefined,
    context,
    nextGen: version.startsWith('2') || context === 'SCRIPTED_DECISION_NODE',
    source: decodeSource(value.script),
    description: typeof value.description === 'string' && value.description ? value.description : undefined,
  };
}

function outcomesOf(type: string, config: Json | undefined, children?: Child[]): string[] | undefined {
  const declared = config?._outcomes;
  if (Array.isArray(declared) && declared.length > 0) {
    return declared.map((item) => (isObject(item) ? String(item.id) : String(item)));
  }
  if (type === 'ScriptedDecisionNode' && Array.isArray(config?.outcomes)) return config.outcomes.map(String);
  if (type === 'ChoiceCollectorNode' && Array.isArray(config?.choices)) return config.choices.map(String);
  if (type === 'PageNode' && children && children.length > 0) {
    const lists = children.map((child) => outcomesOf(child.type, child.config));
    const branching = lists.filter((list) => list && !(list.length === 1 && list[0] === 'outcome'));
    if (branching.length > 0) return branching[branching.length - 1];
    return lists.every(Boolean) ? ['outcome'] : undefined;
  }
  return knownOutcomes[type];
}

function typeFromConfig(config: unknown): string | undefined {
  if (isObject(config) && isObject(config._type) && typeof config._type._id === 'string') return config._type._id;
  return undefined;
}

function parseTree(name: string, tree: Json, configs: Json, inner: Json, scripts: Json): Journey {
  const nodes = isObject(tree.nodes) ? tree.nodes : {};
  const parsed: JourneyNode[] = [];
  for (const [id, value] of Object.entries(nodes)) {
    if (!isObject(value)) continue;
    const rawConfig = isObject(configs[id]) ? configs[id] : undefined;
    const type = String(value.nodeType ?? typeFromConfig(rawConfig) ?? 'Unknown');
    const children: Child[] | undefined =
      type === 'PageNode' && Array.isArray(rawConfig?.nodes)
        ? rawConfig.nodes.filter(isObject).map((child) => {
            const childId = String(child._id);
            return {
              id: childId,
              type: String(child.nodeType ?? typeFromConfig(inner[childId]) ?? 'Unknown'),
              name: String(child.displayName ?? child.nodeType ?? childId),
              config: isObject(inner[childId]) ? inner[childId] : undefined,
            };
          })
        : undefined;
    const connections = isObject(value.connections)
      ? Object.fromEntries(Object.entries(value.connections).map(([outcome, target]) => [outcome, String(target)]))
      : {};
    let config = cleanConfig(rawConfig);
    if (config && children) {
      const { nodes: _, ...rest } = config;
      config = Object.keys(rest).length > 0 ? rest : undefined;
    }
    parsed.push({
      id,
      type,
      name: String(value.displayName ?? type),
      connections,
      outcomes: outcomesOf(type, rawConfig, children),
      config,
      children: children?.map((child) => ({ ...child, config: cleanConfig(child.config) })),
      position: point(value),
    });
  }

  const statics = isObject(tree.staticNodes) ? tree.staticNodes : {};
  return {
    name: String(tree._id ?? name),
    entry: String(tree.entryNodeId ?? ''),
    settings: Object.fromEntries(SETTINGS.filter((key) => key in tree).map((key) => [key, tree[key]])),
    nodes: parsed,
    statics: { start: point(statics.startNode), success: point(statics[SUCCESS]), failure: point(statics[FAILURE]) },
    scripts: Object.fromEntries(
      Object.entries(scripts)
        .filter((entry): entry is [string, Json] => isObject(entry[1]))
        .map(([id, value]) => [id, parseScript(id, value)]),
    ),
  };
}

function bundle(name: string, value: Json): Journey {
  const pick = (key: string) => (isObject(value[key]) ? (value[key] as Json) : {});
  if (!isObject(value.tree)) return parseTree(name, value, {}, {}, {});
  return parseTree(name, value.tree, pick('nodes'), pick('innerNodes'), pick('scripts'));
}

export function parseExport(text: string): JourneyExport {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Not valid JSON');
  }
  if (!isObject(data)) throw new Error('Not a journey export');

  const origin = isObject(data.meta) && typeof data.meta.origin === 'string' ? data.meta.origin : undefined;
  let journeys: Journey[];
  if (isObject(data.trees)) {
    journeys = Object.entries(data.trees)
      .filter((entry): entry is [string, Json] => isObject(entry[1]))
      .map(([name, value]) => bundle(name, value));
  } else if (isObject(data.tree)) {
    journeys = [bundle('Journey', data)];
  } else if ('entryNodeId' in data && isObject(data.nodes)) {
    journeys = [parseTree('Journey', data, {}, {}, {})];
  } else {
    throw new Error('Not a journey export');
  }
  if (journeys.length === 0) throw new Error('The export has no journeys');
  return { origin, journeys };
}

export function innerJourney(node: JourneyNode): string | undefined {
  return node.type === 'InnerTreeEvaluatorNode' && typeof node.config?.tree === 'string' ? node.config.tree : undefined;
}

export function scriptOf(node: JourneyNode): string | undefined {
  return typeof node.config?.script === 'string' ? node.config.script : undefined;
}
