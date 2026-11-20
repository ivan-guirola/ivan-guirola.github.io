import policyData from './data.json';

export type Action = 'read' | 'approve';
export type PersonId = 'laura' | 'marco' | 'ana' | 'bot';

export interface Token {
  sub: string;
  aud: string;
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

const TOKENS: Record<PersonId, Token> = {
  laura: { sub: 'laura.martin', aud: 'expenses-api', roles: ['employee'], department: 'Sales', amr: ['pwd'] },
  marco: { sub: 'marco.ruiz', aud: 'expenses-api', roles: ['employee', 'manager'], department: 'Sales', amr: ['pwd'] },
  ana: { sub: 'ana.lopez', aud: 'expenses-api', roles: ['employee', 'finance'], department: 'Finance', amr: ['pwd'] },
  bot: { sub: 'expense-bot', aud: 'expenses-api', client_id: 'expense-bot', scope: 'expenses:read' },
};

export const isPerson = (person: PersonId) => person !== 'bot';

export function token(person: PersonId, mfa: boolean): Token {
  const base = TOKENS[person];
  if (!isPerson(person)) return { ...base };
  return { ...base, amr: mfa ? ['pwd', 'mfa'] : ['pwd'] };
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
