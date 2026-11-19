import { describe, expect, it } from 'vitest';
import { FAILURE, SUCCESS, decodeSource, innerJourney, parseExport, scriptOf } from './parse';
import { DEVELOPMENT, PRODUCTION } from './samples';

describe('parseExport', () => {
  const sample = parseExport(PRODUCTION);
  const login = sample.journeys.find((journey) => journey.name === 'Login')!;
  const node = (name: string) => login.nodes.find((candidate) => candidate.name === name)!;

  it('reads every journey of a multi-journey export, with its origin', () => {
    expect(sample.origin).toBe('https://am.prod.example.com/am');
    expect(sample.journeys.map((journey) => journey.name)).toEqual(['Login', 'SecondFactor']);
  });

  it('reads the entry, the settings and the static positions', () => {
    expect(login.entry).toBe(node('Sign in').id);
    expect(login.settings).toMatchObject({ enabled: true, identityResource: 'managed/alpha_user' });
    expect(login.statics.start).toEqual({ x: 50, y: 225 });
    expect(login.statics.success).toEqual({ x: 1540, y: 80 });
  });

  it('reads a node with its type, connections, position and configuration', () => {
    const retry = node('Three attempts');
    expect(retry.type).toBe('RetryLimitDecisionNode');
    expect(retry.connections).toEqual({ Retry: login.entry, Reject: FAILURE });
    expect(retry.position).toEqual({ x: 700, y: 400 });
    expect(retry.config).toEqual({ retryLimit: 3, incrementUserAttributeOnFailure: true });
  });

  it('reads the steps inside a page and leaves them out of its configuration', () => {
    const page = node('Sign in');
    expect(page.children?.map((child) => [child.name, child.type])).toEqual([
      ['Username', 'ValidatedUsernameNode'],
      ['Password', 'ValidatedPasswordNode'],
    ]);
    expect(page.children?.[0].config).toEqual({ usernameAttribute: 'userName', validateInput: false });
    expect(page.config).toEqual({ pageHeader: { en: 'Sign in' } });
    expect(page.outcomes).toEqual(['outcome']);
  });

  it('takes outcomes from the export, the script settings or the known node types', () => {
    expect(node('Check the password').outcomes).toEqual(['true', 'false']);
    expect(node('Route by email domain').outcomes).toEqual(['employee', 'partner', 'unknown']);
    expect(node('Three attempts').outcomes).toEqual(['Retry', 'Reject']);
  });

  it('takes the outcomes of a page from the step that branches', () => {
    const inner = sample.journeys[1];
    expect(inner.nodes.find((n) => n.type === 'PageNode')?.outcomes).toEqual(['true', 'false']);
  });

  it('decodes scripts stored as base64 or as lines and tells the engines apart', () => {
    const route = login.scripts[scriptOf(node('Route by email domain'))!];
    expect(route.nextGen).toBe(true);
    expect(route.source).toContain("action.goTo('employee');");
    const dev = parseExport(DEVELOPMENT).journeys[0];
    expect(Object.values(dev.scripts)[0].source).toContain('supplier.example');
    const inner = sample.journeys[1];
    expect(Object.values(inner.scripts)[0]).toMatchObject({ name: 'Log wrong code', nextGen: false });
  });

  it('finds the journey run by an inner journey node', () => {
    expect(innerJourney(node('Second factor'))).toBe('SecondFactor');
    expect(innerJourney(node('Sign in'))).toBeUndefined();
  });

  it('reads a single-journey export', () => {
    const single = JSON.parse(PRODUCTION).trees.Login;
    const [journey] = parseExport(JSON.stringify(single)).journeys;
    expect(journey.name).toBe('Login');
    expect(journey.nodes).toHaveLength(login.nodes.length);
  });

  it('reads a bare tree as returned by the AM REST API', () => {
    const bare = JSON.parse(PRODUCTION).trees.Login.tree;
    const [journey] = parseExport(JSON.stringify(bare)).journeys;
    expect(journey.nodes.find((n) => n.name === 'Three attempts')?.config).toBeUndefined();
    expect(journey.nodes.find((n) => n.name === 'Three attempts')?.outcomes).toEqual(['Retry', 'Reject']);
    expect(journey.nodes.find((n) => n.name === 'Sign in')?.children).toBeUndefined();
  });

  it('falls back to the configuration type when the tree omits it', () => {
    const data = JSON.parse(PRODUCTION);
    delete data.trees.Login.tree.nodes[login.entry].nodeType;
    const journey = parseExport(JSON.stringify(data)).journeys[0];
    expect(journey.nodes.find((n) => n.id === login.entry)?.type).toBe('PageNode');
  });

  it('rejects text that is not a journey export', () => {
    expect(() => parseExport('{')).toThrow('Not valid JSON');
    expect(() => parseExport('[]')).toThrow('Not a journey export');
    expect(() => parseExport('{"a":1}')).toThrow('Not a journey export');
    expect(() => parseExport('{"trees":{}}')).toThrow('The export has no journeys');
  });

  it('keeps success and failure as special targets', () => {
    expect(node('Count the sign-in').connections.outcome).toBe(SUCCESS);
  });
});

describe('decodeSource', () => {
  it('joins lines, decodes base64 and keeps plain text', () => {
    expect(decodeSource(['a', 'b'])).toBe('a\nb');
    expect(decodeSource(btoa('outcome = "true";'))).toBe('outcome = "true";');
    expect(decodeSource('outcome = "true";')).toBe('outcome = "true";');
    expect(decodeSource('abcdefgh')).toBe('abcdefgh');
    expect(decodeSource(undefined)).toBe('');
  });
});
