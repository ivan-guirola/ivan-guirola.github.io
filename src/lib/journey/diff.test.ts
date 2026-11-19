import { describe, expect, it } from 'vitest';
import { compareExports, diffJourneys, lineDiff } from './diff';
import { parseExport } from './parse';
import { DEVELOPMENT, PRODUCTION } from './samples';

const production = parseExport(PRODUCTION);
const development = parseExport(DEVELOPMENT);

describe('lineDiff', () => {
  it('keeps common lines and marks the rest', () => {
    expect(lineDiff('a\nb\nc', 'a\nx\nc\nd')).toEqual([
      { op: ' ', text: 'a' },
      { op: '-', text: 'b' },
      { op: '+', text: 'x' },
      { op: ' ', text: 'c' },
      { op: '+', text: 'd' },
    ]);
  });
});

describe('compareExports', () => {
  it('says which journeys changed', () => {
    const result = compareExports(production, development);
    expect(result.map((item) => [item.name, item.status])).toEqual([
      ['Login', 'changed'],
      ['SecondFactor', 'same'],
    ]);
  });

  it('notes journeys only on one side', () => {
    const only = { journeys: [production.journeys[1]] };
    expect(compareExports(only, production).map((item) => item.status)).toEqual(['same', 'added']);
    expect(compareExports(production, only).map((item) => item.status)).toEqual(['removed', 'same']);
  });
});

describe('diffJourneys', () => {
  const diff = diffJourneys(production.journeys[0], development.journeys[0]);
  const byName = (name: string) => diff.nodes.find((node) => node.name === name)!;

  it('lists the added and removed nodes', () => {
    expect(byName('Is the account active').status).toBe('added');
    expect(byName('Old lockout check').status).toBe('removed');
  });

  it('shows a changed setting and a new name', () => {
    expect(byName('Five attempts').changes).toEqual([
      { field: 'name', before: 'Three attempts', after: 'Five attempts' },
      { field: 'config:retryLimit', before: '3', after: '5' },
    ]);
  });

  it('shows where an outcome goes now, by name', () => {
    expect(byName('Check the password').changes).toEqual([
      { field: 'outcome:true', before: 'Second factor', after: 'Is the account active' },
    ]);
  });

  it('shows changed messages and script lines', () => {
    expect(byName('Partner notice').changes[0].field).toBe('config:message');
    const route = byName('Route by email domain');
    expect(route.changes).toEqual([{ field: 'scriptSource' }]);
    expect(route.script?.filter((line) => line.op !== ' ').map((line) => line.op)).toEqual(['-', '+']);
  });

  it('leaves untouched nodes and settings out', () => {
    expect(diff.settings).toEqual([]);
    expect(diff.nodes.map((node) => node.name).sort()).toEqual(
      ['Check the password', 'Five attempts', 'Is the account active', 'Old lockout check', 'Partner notice', 'Route by email domain'].sort(),
    );
  });

  it('matches nodes by type and name when their ids differ', () => {
    const renamed = structuredClone(development.journeys[1]);
    for (const node of renamed.nodes) node.id = `x-${node.id}`;
    renamed.entry = `x-${renamed.entry}`;
    for (const node of renamed.nodes) {
      for (const [outcome, target] of Object.entries(node.connections)) {
        if (renamed.nodes.some((n) => n.id === `x-${target}`)) node.connections[outcome] = `x-${target}`;
      }
    }
    expect(diffJourneys(production.journeys[1], renamed).nodes).toEqual([]);
  });

  it('reports a change of settings, of steps and of script engine', () => {
    const before = production.journeys[1];
    const after = structuredClone(before);
    after.settings.enabled = false;
    after.nodes[2].children![0].name = 'Code';
    const script = Object.values(after.scripts)[0];
    script.nextGen = true;
    const result = diffJourneys(before, after);
    expect(result.settings).toEqual([{ field: 'enabled', before: 'true', after: 'false' }]);
    expect(result.nodes.map((node) => node.changes.map((change) => change.field))).toEqual([['steps'], ['scriptEngine']]);
  });
});
