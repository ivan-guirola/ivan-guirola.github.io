import { readFileSync } from 'node:fs';
import { loadPolicy } from '@open-policy-agent/opa-wasm';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  DATA,
  EXPENSES,
  PEOPLE,
  encodeToken,
  input,
  matrix,
  requestLine,
  ruleInputs,
  ruleLines,
  token,
  unwrap,
  withLimits,
  type Data,
  type Evaluate,
} from './authz';

const wasm = readFileSync(new URL('../../../public/opa/expenses.wasm', import.meta.url));
const source = readFileSync(new URL('./expenses.rego', import.meta.url), 'utf8');

let evaluateWith: (data: Data) => Evaluate;
let evaluate: Evaluate;

beforeAll(async () => {
  const policy = await loadPolicy(wasm);
  evaluateWith = (data) => {
    policy.setData(data);
    return (value) => unwrap(policy.evaluate(value));
  };
  evaluate = evaluateWith(DATA);
});

const ids = (reasons: { id: string }[]) => reasons.map((reason) => reason.id);

describe('the compiled policy', () => {
  it('lets employees read only their own expenses', () => {
    expect(evaluate(input('laura', 'read', 'E-101', false))).toMatchObject({ allow: true, denies: [] });
    expect(evaluate(input('laura', 'read', 'E-102', false))).toEqual({ allow: false, grants: [], denies: [] });
  });

  it('lets a service read but never approve', () => {
    expect(evaluate(input('bot', 'read', 'E-103', false)).allow).toBe(true);
    expect(evaluate(input('bot', 'approve', 'E-101', false))).toEqual({ allow: false, grants: [], denies: [] });
  });

  it('explains every reason for a denial', () => {
    const decision = evaluate(input('marco', 'approve', 'E-103', false));
    expect(decision.allow).toBe(false);
    expect(ids(decision.denies)).toEqual(['manager-limit', 'needs-mfa']);
    expect(decision.denies[0].message).toBe('Over the manager limit of 1000 EUR, so Finance has to approve it.');
  });

  it('needs MFA from Finance for large amounts', () => {
    expect(ids(evaluate(input('ana', 'approve', 'E-103', false)).denies)).toEqual(['needs-mfa']);
    expect(evaluate(input('ana', 'approve', 'E-103', true)).allow).toBe(true);
  });

  it('keeps the grant visible when a deny wins', () => {
    const decision = evaluate(input('marco', 'approve', 'E-102', false));
    expect(decision).toMatchObject({ allow: false });
    expect(ids(decision.grants)).toEqual(['approve-manager']);
    expect(ids(decision.denies)).toEqual(['own-approval']);
  });

  it('reads the limits from data', () => {
    expect(evaluate(input('marco', 'approve', 'E-101', false)).allow).toBe(true);
    const strict = evaluateWith(withLimits(DATA, { manager: 100 }));
    expect(ids(strict(input('marco', 'approve', 'E-101', false)).denies)).toEqual(['manager-limit']);
    expect(strict(input('marco', 'approve', 'E-101', false)).denies[0].message).toContain('100 EUR');
    evaluateWith(DATA);
  });
});

describe('input', () => {
  it('builds the request and adds MFA only to people', () => {
    expect(requestLine(input('laura', 'approve', 'E-101', true))).toBe('POST /expenses/E-101/approve');
    expect(token('laura', true).amr).toEqual(['pwd', 'mfa']);
    expect(token('bot', true)).not.toHaveProperty('amr');
  });
});

describe('matrix', () => {
  it('has a decision for every person and expense', () => {
    const rows = matrix(evaluate, 'read', false);
    expect(rows.map((row) => row.person)).toEqual(PEOPLE);
    for (const row of rows) expect(row.cells.map((cell) => cell.expense)).toEqual(EXPENSES);
    expect(rows.find((row) => row.person === 'ana')!.cells.every((cell) => cell.decision.allow)).toBe(true);
  });
});

describe('encodeToken', () => {
  it('writes a JWT whose payload decodes back to the claims', () => {
    const claims = token('marco', true);
    const [header, payload, signature] = encodeToken(claims).split('.');
    const decode = (part: string) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
    expect(decode(header)).toEqual({ alg: 'RS256', typ: 'at+jwt', kid: 'login-2026' });
    expect(decode(payload)).toEqual(claims);
    expect(signature).toBe('signature');
  });

  it('carries the claims RFC 9068 asks for', () => {
    for (const person of PEOPLE) {
      expect(Object.keys(token(person, false))).toEqual(expect.arrayContaining(['iss', 'exp', 'aud', 'sub', 'client_id', 'iat', 'jti']));
    }
  });
});

describe('ruleInputs', () => {
  it('lists what each rule reads from the token, the expense and the data', () => {
    const inputs = ruleInputs(source);
    expect(inputs['approve-manager'].sort()).toEqual(['data.limits.manager', 'expense.amount', 'expense.department', 'token.department', 'token.roles']);
    expect(inputs['needs-mfa'].sort()).toEqual(['data.limits.mfa', 'expense.amount', 'token.amr']);
    expect(inputs['read-service']).toEqual(['token.scope']);
    expect(inputs.audience).toEqual(['token.aud']);
    expect(inputs.unknown).toEqual(['expense']);
  });
});

describe('ruleLines', () => {
  it('finds every rule id in the policy, including rules written over several lines', () => {
    const lines = ruleLines(source);
    expect(Object.keys(lines).sort()).toEqual(
      ['approve-finance', 'approve-manager', 'audience', 'manager-limit', 'needs-mfa', 'not-submitted', 'own-approval', 'read-finance', 'read-own', 'read-service', 'read-team', 'unknown'].sort(),
    );
    const all = source.split('\n');
    const [start, end] = lines['manager-limit'];
    expect(all[start - 1]).toBe('denies contains {');
    expect(all[end - 1]).toBe('}');
    expect(all.slice(start - 1, end).join('\n')).toContain('expense.amount > data.limits.manager');
  });
});
