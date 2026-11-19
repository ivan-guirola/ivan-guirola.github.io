import { describe, expect, it } from 'vitest';
import { checkJourney } from './check';
import { FAILURE, parseExport, type Journey } from './parse';
import { DEVELOPMENT, PRODUCTION } from './samples';

const load = (text: string, name: string) => parseExport(text).journeys.find((journey) => journey.name === name)!;
const clone = (journey: Journey): Journey => structuredClone(journey);
const codes = (journey: Journey, available?: string[]) => checkJourney(journey, available).map((f) => f.code);

describe('checkJourney', () => {
  it('flags the leftover node nobody can reach', () => {
    const login = load(PRODUCTION, 'Login');
    const findings = checkJourney(login, ['Login', 'SecondFactor']);
    expect(findings).toEqual([
      { level: 'warn', code: 'unreachable', node: login.nodes.find((n) => n.name === 'Old lockout check')!.id },
    ]);
  });

  it('finds nothing wrong in the development login', () => {
    expect(checkJourney(load(DEVELOPMENT, 'Login'), ['SecondFactor'])).toEqual([]);
  });

  it('warns about a script on the legacy engine', () => {
    const findings = checkJourney(load(PRODUCTION, 'SecondFactor'));
    expect(findings).toContainEqual(expect.objectContaining({ code: 'legacyScript', detail: 'Log wrong code' }));
  });

  it('notes an inner journey or a script missing from the file', () => {
    const login = load(PRODUCTION, 'Login');
    expect(codes(login, [])).toContain('missingJourney');
    login.scripts = {};
    expect(checkJourney(login, ['SecondFactor'])).toContainEqual(
      expect.objectContaining({ level: 'info', code: 'missingScript' }),
    );
  });

  it('reports a link to a node that does not exist', () => {
    const login = clone(load(DEVELOPMENT, 'Login'));
    login.nodes[1].connections.false = 'nowhere';
    expect(checkJourney(login, ['SecondFactor'])[0]).toEqual({
      level: 'error',
      code: 'brokenLink',
      node: login.nodes[1].id,
      detail: 'false',
    });
  });

  it('warns about an outcome that leads nowhere', () => {
    const login = clone(load(DEVELOPMENT, 'Login'));
    delete login.nodes[1].connections.false;
    expect(checkJourney(login, ['SecondFactor'])).toContainEqual(
      expect.objectContaining({ code: 'openOutcome', detail: 'false' }),
    );
  });

  it('reports a journey that can never succeed', () => {
    const login = clone(load(DEVELOPMENT, 'Login'));
    for (const node of login.nodes) {
      for (const outcome of Object.keys(node.connections)) node.connections[outcome] = FAILURE;
    }
    expect(codes(login, ['SecondFactor'])[0]).toBe('noSuccess');
  });

  it('reports a missing entry, an empty page and a disabled journey', () => {
    const login = clone(load(DEVELOPMENT, 'Login'));
    login.entry = 'missing';
    login.settings.enabled = false;
    login.nodes[0].children = [];
    expect(codes(login, ['SecondFactor'])).toEqual(['noEntry', 'emptyPage', 'disabled']);
  });
});
