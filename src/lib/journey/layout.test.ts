import { describe, expect, it } from 'vitest';
import { NODE_WIDTH, START, layoutJourney } from './layout';
import { FAILURE, SUCCESS, parseExport } from './parse';
import { PRODUCTION } from './samples';

const login = parseExport(PRODUCTION).journeys[0];

describe('layoutJourney', () => {
  const layout = layoutJourney(login);
  const box = (id: string) => layout.boxes.find((candidate) => candidate.id === id)!;

  it('places every node, the start and both ends, keeping the editor positions', () => {
    expect(layout.boxes).toHaveLength(login.nodes.length + 3);
    const page = box(login.entry);
    const retry = box(login.nodes.find((n) => n.name === 'Three attempts')!.id);
    expect(retry.x - page.x).toBe(700 - 140);
    expect(retry.y - page.y).toBe(400 - 180);
    expect(box(START).x).toBe(40);
  });

  it('gives each outcome a port and draws one edge per connection', () => {
    const route = box(login.nodes.find((n) => n.name === 'Route by email domain')!.id);
    expect(route.width).toBe(NODE_WIDTH);
    expect(route.ports.map((port) => port.outcome)).toEqual(['employee', 'partner', 'unknown']);
    const connections = login.nodes.reduce((sum, node) => sum + Object.keys(node.connections).length, 0);
    expect(layout.edges).toHaveLength(connections + 1);
    expect(layout.edges.filter((edge) => edge.to === SUCCESS)).toHaveLength(1);
    expect(layout.edges.every((edge) => edge.path.startsWith('M'))).toBe(true);
  });

  it('makes room for the steps inside a page', () => {
    const page = box(login.entry);
    const check = box(login.nodes.find((n) => n.name === 'Check the password')!.id);
    expect(page.height).toBeGreaterThan(check.height - 24);
  });

  it('lays the journey out in columns when positions are missing', () => {
    const bare = structuredClone(login);
    for (const node of bare.nodes) delete node.position;
    bare.statics = {};
    const columns = layoutJourney(bare);
    const at = (id: string) => columns.boxes.find((candidate) => candidate.id === id)!;
    expect(at(START).x).toBeLessThan(at(bare.entry).x);
    expect(at(bare.entry).x).toBeLessThan(at(bare.nodes.find((n) => n.name === 'Check the password')!.id).x);
    expect(at(SUCCESS).x).toBe(at(FAILURE).x);
    const orphan = at(bare.nodes.find((n) => n.name === 'Old lockout check')!.id);
    expect(orphan.x).toBeLessThan(at(SUCCESS).x);
    expect(columns.width).toBeGreaterThan(at(SUCCESS).x);
  });

  it('skips connections to nodes that do not exist', () => {
    const broken = structuredClone(login);
    broken.nodes[0].connections.outcome = 'nowhere';
    const result = layoutJourney(broken);
    expect(result.edges.some((edge) => edge.from === broken.nodes[0].id)).toBe(false);
  });
});
