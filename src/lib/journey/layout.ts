import { FAILURE, SUCCESS, type Journey, type JourneyNode, type Point } from './parse';

export const NODE_WIDTH = 210;
const HEADER = 52;
const CHILD = 22;
const PORT = 24;
const PAD = 40;
const COLUMN = 290;
const GAP = 36;

export type BoxKind = 'node' | 'start' | 'success' | 'failure';

export interface Port {
  outcome: string;
  y: number;
  target?: string;
}

export interface Box {
  id: string;
  kind: BoxKind;
  x: number;
  y: number;
  width: number;
  height: number;
  ports: Port[];
}

export interface Edge {
  from: string;
  outcome: string;
  to: string;
  path: string;
}

export interface Layout {
  boxes: Box[];
  edges: Edge[];
  width: number;
  height: number;
}

export const START = 'startNode';

export function portsOf(node: JourneyNode): string[] {
  const listed = node.outcomes ?? [];
  const extra = Object.keys(node.connections).filter((outcome) => !listed.includes(outcome));
  return [...listed, ...extra];
}

function size(kind: BoxKind, node?: JourneyNode) {
  if (kind === 'start') return { width: 40, height: 40 };
  if (kind !== 'node' || !node) return { width: 104, height: 40 };
  const children = node.children?.length ?? 0;
  const ports = Math.max(portsOf(node).length, 1);
  return { width: NODE_WIDTH, height: HEADER + (children > 0 ? children * CHILD + 8 : 0) + ports * PORT + 6 };
}

function columns(journey: Journey): Map<string, number> {
  const byId = new Map(journey.nodes.map((node) => [node.id, node]));
  const depth = new Map<string, number>([[START, 0]]);
  const queue: [string, number][] = [[journey.entry, 1]];
  while (queue.length > 0) {
    const [id, level] = queue.shift()!;
    if (depth.has(id) || !byId.has(id)) continue;
    depth.set(id, level);
    for (const target of Object.values(byId.get(id)!.connections)) queue.push([target, level + 1]);
  }
  let last = Math.max(1, ...depth.values());
  const orphans = journey.nodes.filter((node) => !depth.has(node.id));
  if (orphans.length > 0) last += 1;
  for (const node of orphans) depth.set(node.id, last);
  depth.set(SUCCESS, last + 1);
  depth.set(FAILURE, last + 1);
  return depth;
}

function stacked(journey: Journey, sizes: Map<string, { width: number; height: number }>): Map<string, Point> {
  const depth = columns(journey);
  const heights = new Map<number, number>();
  const positions = new Map<string, Point>();
  const order = [START, ...journey.nodes.map((node) => node.id), SUCCESS, FAILURE];
  for (const id of order) {
    const column = depth.get(id) ?? 0;
    const y = heights.get(column) ?? 0;
    positions.set(id, { x: column * COLUMN, y });
    heights.set(column, y + sizes.get(id)!.height + GAP);
  }
  return positions;
}

function curve(from: Point, to: Point, below: number): string {
  if (to.x >= from.x + 30) {
    const reach = Math.max(60, (to.x - from.x) / 2);
    return `M${from.x} ${from.y} C${from.x + reach} ${from.y} ${to.x - reach} ${to.y} ${to.x} ${to.y}`;
  }
  const r = 28;
  return [
    `M${from.x} ${from.y}`,
    `C${from.x + r * 2} ${from.y} ${from.x + r * 2} ${below} ${from.x} ${below}`,
    `L${to.x} ${below}`,
    `C${to.x - r * 2} ${below} ${to.x - r * 2} ${to.y} ${to.x} ${to.y}`,
  ].join(' ');
}

export function layoutJourney(journey: Journey): Layout {
  const sizes = new Map<string, { width: number; height: number }>();
  sizes.set(START, size('start'));
  sizes.set(SUCCESS, size('success'));
  sizes.set(FAILURE, size('failure'));
  for (const node of journey.nodes) sizes.set(node.id, size('node', node));

  const placed = journey.nodes.length > 0 && journey.nodes.every((node) => node.position);
  let positions: Map<string, Point>;
  if (placed) {
    positions = new Map(journey.nodes.map((node) => [node.id, node.position!]));
    const xs = journey.nodes.map((node) => node.position!.x);
    const ys = journey.nodes.map((node) => node.position!.y);
    const right = Math.max(...xs) + NODE_WIDTH + 80;
    const entry = positions.get(journey.entry) ?? { x: Math.min(...xs), y: Math.min(...ys) };
    positions.set(START, journey.statics.start ?? { x: Math.min(...xs) - 100, y: entry.y });
    positions.set(SUCCESS, journey.statics.success ?? { x: right, y: Math.min(...ys) });
    positions.set(FAILURE, journey.statics.failure ?? { x: right, y: Math.max(...ys) });
  } else {
    positions = stacked(journey, sizes);
  }

  const kinds: [string, BoxKind][] = [
    [START, 'start'],
    ...journey.nodes.map((node): [string, BoxKind] => [node.id, 'node']),
    [SUCCESS, 'success'],
    [FAILURE, 'failure'],
  ];
  const minX = Math.min(...kinds.map(([id]) => positions.get(id)!.x));
  const minY = Math.min(...kinds.map(([id]) => positions.get(id)!.y));
  const byId = new Map(journey.nodes.map((node) => [node.id, node]));

  const boxes: Box[] = kinds.map(([id, kind]) => {
    const { x, y } = positions.get(id)!;
    const { width, height } = sizes.get(id)!;
    const node = byId.get(id);
    const top = height - (node ? Math.max(portsOf(node).length, 1) * PORT + 6 : height / 2) + PORT / 2;
    const ports: Port[] =
      kind === 'start'
        ? [{ outcome: 'start', y: height / 2, target: journey.entry }]
        : node
          ? portsOf(node).map((outcome, index) => ({ outcome, y: top + index * PORT, target: node.connections[outcome] }))
          : [];
    return { id, kind, x: x - minX + PAD, y: y - minY + PAD, width, height, ports };
  });

  const index = new Map(boxes.map((box) => [box.id, box]));
  const edges: Edge[] = [];
  for (const box of boxes) {
    for (const port of box.ports) {
      const target = port.target && index.get(port.target);
      if (!target) continue;
      const from = { x: box.x + box.width, y: box.y + port.y };
      const to = { x: target.x, y: target.y + (target.kind === 'node' ? 26 : target.height / 2) };
      const below = Math.max(box.y + box.height, target.y + target.height) + 22;
      edges.push({ from: box.id, outcome: port.outcome, to: target.id, path: curve(from, to, below) });
    }
  }

  return {
    boxes,
    edges,
    width: Math.max(...boxes.map((box) => box.x + box.width)) + PAD,
    height: Math.max(...boxes.map((box) => box.y + box.height)) + PAD + 24,
  };
}
