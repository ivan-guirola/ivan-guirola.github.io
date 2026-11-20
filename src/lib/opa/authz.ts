import policyData from './data.json';

export type Action = 'read' | 'approve';
export type PersonId = 'laura' | 'marco' | 'ana' | 'bot';

export interface Token {
  iss: string;
  sub: string;
  aud: string;
  iat: number;
  exp: number;
  jti: string;
  roles?: string[];
  department?: string;
  amr?: string[];
  client_id?: string;
  scope?: string;
}

export interface Reason {
  id: string;
  message: string;
}

export interface Decision {
  allow: boolean;
  grants: Reason[];
  denies: Reason[];
}

export interface Input {
  token: Token;
  request: { method: 'GET' | 'POST'; path: string[] };
}

export type Data = typeof policyData;
export type Evaluate = (input: Input) => Decision;

export const ACTIONS: Action[] = ['read', 'approve'];
export const PEOPLE: PersonId[] = ['laura', 'marco', 'ana', 'bot'];
export const EXPENSES = Object.keys(policyData.expenses);
export const DATA: Data = policyData;
export const ENTRYPOINT = 'authz/decision';

const ISSUED = 1795161600;
const common = (jti: string) => ({ iss: 'https://login.example.com', aud: 'expenses-api', iat: ISSUED, exp: ISSUED + 900, jti });

const TOKENS: Record<PersonId, Token> = {
  laura: { ...common('a81f'), sub: 'laura.martin', client_id: 'expenses-web', roles: ['employee'], department: 'Sales', amr: ['pwd'] },
  marco: { ...common('c42d'), sub: 'marco.ruiz', client_id: 'expenses-web', roles: ['employee', 'manager'], department: 'Sales', amr: ['pwd'] },
  ana: { ...common('e93b'), sub: 'ana.lopez', client_id: 'expenses-web', roles: ['employee', 'finance'], department: 'Finance', amr: ['pwd'] },
  bot: { ...common('f17a'), sub: 'expense-bot', client_id: 'expense-bot', scope: 'expenses:read' },
};

export const isPerson = (person: PersonId) => person !== 'bot';

export function token(person: PersonId, mfa: boolean): Token {
  const base = TOKENS[person];
  if (!isPerson(person)) return { ...base };
  return { ...base, amr: mfa ? ['pwd', 'mfa'] : ['pwd'] };
}

const base64url = (value: string) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(value)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

/** The access token as it travels: a JWT (RFC 9068) whose signature is left out of this example. */
export function encodeToken(claims: Token) {
  const header = { alg: 'RS256', typ: 'at+jwt', kid: 'login-2026' };
  return `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}.signature`;
}

/** What each rule reads from the token, the expense and the data, found in the policy source. */
export function ruleInputs(source: string) {
  const lines = source.split('\n');
  const inputs: Record<string, string[]> = {};
  for (const [id, [start, end]] of Object.entries(ruleLines(source))) {
    const body = lines.slice(start - 1, end).join('\n');
    const found = new Set<string>();
    for (const [, claim] of body.matchAll(/\btoken\.(\w+)/g)) found.add(`token.${claim}`);
    if (/\bin roles\b/.test(body)) found.add('token.roles');
    for (const [, field] of body.matchAll(/\bexpense\.(\w+)/g)) found.add(`expense.${field}`);
    if (/\bnot expense\b/.test(body)) found.add('expense');
    for (const [, limit] of body.matchAll(/\bdata\.limits\.(\w+)/g)) found.add(`data.limits.${limit}`);
    inputs[id] = [...found];
  }
  return inputs;
}

export function input(person: PersonId, action: Action, expense: string, mfa: boolean): Input {
  return {
    token: token(person, mfa),
    request: action === 'read' ? { method: 'GET', path: ['expenses', expense] } : { method: 'POST', path: ['expenses', expense, 'approve'] },
  };
}

export const requestLine = ({ request }: Input) => `${request.method} /${request.path.join('/')}`;

export function withLimits(data: Data, limits: Partial<Data['limits']>): Data {
  return { ...data, limits: { ...data.limits, ...limits } };
}

/** The decision OPA returns for one entrypoint, from the raw result of opa-wasm. */
export function unwrap(result: unknown): Decision {
  const [first] = result as { result: Decision }[];
  const decision = first.result;
  const byId = (a: Reason, b: Reason) => a.id.localeCompare(b.id);
  return { allow: decision.allow, grants: [...decision.grants].sort(byId), denies: [...decision.denies].sort(byId) };
}

export function matrix(evaluate: Evaluate, action: Action, mfa: boolean) {
  return PEOPLE.map((person) => ({
    person,
    cells: EXPENSES.map((expense) => ({ expense, decision: evaluate(input(person, action, expense, mfa)) })),
  }));
}

/** First and last line (1-based) of every rule in the policy, found by the id it returns. */
export function ruleLines(source: string) {
  const lines = source.split('\n');
  const found: Record<string, [number, number]> = {};
  lines.forEach((line, index) => {
    const id = line.match(/"id": "([a-z-]+)"/)?.[1];
    if (!id) return;
    let start = index;
    while (start > 0 && !/^(grants|denies) contains/.test(lines[start])) start--;
    let end = index;
    while (end < lines.length - 1 && lines[end] !== '}') end++;
    found[id] = [start + 1, end + 1];
  });
  return found;
}

export const json = (value: unknown) => JSON.stringify(value, null, 2);
