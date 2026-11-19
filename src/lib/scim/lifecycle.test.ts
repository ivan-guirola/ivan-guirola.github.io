import { describe, expect, it } from 'vitest';
import { EVENTS, IDS, PROVIDERS, SCHEMA, scenario } from './lifecycle';

const all = PROVIDERS.flatMap((provider) => EVENTS.map((event) => scenario(provider, event)));

describe('scenario', () => {
  it('has at least one call for every provider and event', () => {
    for (const item of all) expect(item.calls.length).toBeGreaterThan(0);
  });

  it('searches for the user before creating it', () => {
    for (const provider of PROVIDERS) {
      const { calls, before, after } = scenario(provider, 'join');
      expect(calls.map((call) => call.method)).toEqual(['GET', 'POST']);
      expect(calls[0].path).toContain('filter=userName eq "laura.martin@example.com"');
      expect(calls[1].status).toBe(201);
      expect(before).toBeNull();
      expect(after).toMatchObject({ id: IDS.user, active: true });
    }
  });

  it('sends the placeholder password and locale only from Okta', () => {
    expect(scenario('okta', 'join').calls[1].body).toMatchObject({ password: expect.any(String), locale: 'en-US', groups: [] });
    expect(scenario('entra', 'join').calls[1].body).toMatchObject({ roles: [], meta: { resourceType: 'User' } });
    expect(scenario('entra', 'join').calls[1].body).not.toHaveProperty('password');
  });

  it('pages the search only for Okta', () => {
    expect(scenario('okta', 'join').calls[0].path).toMatch(/&startIndex=1&count=100$/);
    expect(scenario('entra', 'join').calls[0].path).not.toContain('startIndex');
  });

  it('updates a department with PATCH in Entra and with GET then PUT in Okta', () => {
    const entra = scenario('entra', 'move');
    expect(entra.calls.map((call) => call.method)).toEqual(['PATCH']);
    expect(entra.calls[0].body).toEqual({
      schemas: [SCHEMA.patch],
      Operations: [{ op: 'Replace', path: `${SCHEMA.enterprise}:department`, value: 'Sales' }],
    });

    const okta = scenario('okta', 'move');
    expect(okta.calls.map((call) => call.method)).toEqual(['GET', 'PUT']);
    expect(okta.calls[1].body).toMatchObject({ id: IDS.user, meta: {}, [SCHEMA.enterprise]: { department: 'Sales' } });
  });

  it('sends active as a path in Entra and as a value object in Okta', () => {
    expect(scenario('entra', 'leave').calls[0].body).toEqual({
      schemas: [SCHEMA.patch],
      Operations: [{ op: 'Replace', path: 'active', value: false }],
    });
    expect(scenario('okta', 'leave').calls[0].body).toEqual({
      schemas: [SCHEMA.patch],
      Operations: [{ op: 'replace', value: { active: false } }],
    });
    expect(scenario('okta', 'return').calls[0].body).toMatchObject({ Operations: [{ value: { active: true } }] });
  });

  it('adds group members with a PATCH', () => {
    const [entra] = scenario('entra', 'group').calls;
    expect(entra).toMatchObject({ method: 'PATCH', path: `/Groups/${IDS.group}`, status: 204 });
    expect(entra.body).toMatchObject({ Operations: [{ op: 'Add', path: 'members', value: [{ $ref: null, value: IDS.user }] }] });
    expect(entra.response).toBeUndefined();
    const [okta] = scenario('okta', 'group').calls;
    expect(okta).toMatchObject({ method: 'PATCH', status: 200, response: { members: [{ value: IDS.user }] } });
    expect(scenario('okta', 'group').calls[0].body).toMatchObject({
      Operations: [{ op: 'add', path: 'members', value: [{ value: IDS.user, display: 'laura.martin@example.com' }] }],
    });
  });

  it('only deletes in Entra, and only later', () => {
    const entra = scenario('entra', 'delete');
    expect(entra.calls.map((call) => [call.method, call.later ?? false])).toEqual([
      ['PATCH', false],
      ['DELETE', true],
    ]);
    expect(entra.after).toBeNull();

    for (const item of all.filter((entry) => entry.provider === 'okta')) {
      expect(item.calls.some((call) => call.method === 'DELETE')).toBe(false);
    }
    expect(scenario('okta', 'delete').after).toMatchObject({ active: false });
  });

  it('ends with the account the last response describes', () => {
    for (const item of all) {
      const last = [...item.calls].reverse().find((call) => call.response && call.method !== 'GET' && call.path.startsWith('/Users'));
      if (last && item.after) expect(last.response).toEqual(item.after);
    }
  });

  it('puts PatchOp in every PATCH body', () => {
    for (const item of all) {
      for (const call of item.calls.filter((entry) => entry.method === 'PATCH')) {
        expect(call.body).toMatchObject({ schemas: [SCHEMA.patch] });
      }
    }
  });

  it('keeps group membership on the account', () => {
    expect(scenario('entra', 'leave').after).toMatchObject({ groups: [{ value: IDS.group }] });
    expect(scenario('entra', 'move').after).not.toHaveProperty('groups');
  });
});
