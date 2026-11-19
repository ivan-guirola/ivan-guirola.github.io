export type Provider = 'entra' | 'okta';
export type Event = 'join' | 'move' | 'group' | 'leave' | 'return' | 'delete';
export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export type Step = 'search' | 'create' | 'read' | 'replace' | 'update' | 'addMember' | 'deactivate' | 'reactivate' | 'remove';

export interface Call {
  step: Step;
  method: Method;
  path: string;
  body?: object;
  status: number;
  response?: object;
  later?: boolean;
}

export interface Scenario {
  provider: Provider;
  event: Event;
  calls: Call[];
  before: object | null;
  after: object | null;
}

export const PROVIDERS: Provider[] = ['entra', 'okta'];
export const EVENTS: Event[] = ['join', 'move', 'group', 'leave', 'return', 'delete'];

export const SCHEMA = {
  user: 'urn:ietf:params:scim:schemas:core:2.0:User',
  enterprise: 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User',
  list: 'urn:ietf:params:scim:api:messages:2.0:ListResponse',
  patch: 'urn:ietf:params:scim:api:messages:2.0:PatchOp',
  group: 'urn:ietf:params:scim:schemas:core:2.0:Group',
};

export const PERSON = {
  userName: 'laura.martin@example.com',
  givenName: 'Laura',
  familyName: 'Martín',
  title: 'Analyst',
};

export const IDS = {
  user: '2819c223-7f76-453a-919d-413861904646',
  group: 'e9e30dba-f08f-4109-8486-d5c6a331660a',
  groupName: 'Sales team',
  entraExternal: 'laura.martin',
  oktaExternal: '00u5k3l9xq2br7mwz4x7',
};

interface State {
  department: string;
  active: boolean;
  groups: boolean;
}

const BASE_URL = 'https://app.example.com/scim/v2';
const CREATED = '2026-11-03T08:12:40Z';
const MODIFIED = '2026-11-19T09:30:05Z';

function core(provider: Provider, state: State) {
  return {
    schemas: [SCHEMA.user, SCHEMA.enterprise],
    externalId: provider === 'entra' ? IDS.entraExternal : IDS.oktaExternal,
    userName: PERSON.userName,
    name: {
      ...(provider === 'entra' ? { formatted: `${PERSON.givenName} ${PERSON.familyName}` } : {}),
      givenName: PERSON.givenName,
      familyName: PERSON.familyName,
    },
    displayName: `${PERSON.givenName} ${PERSON.familyName}`,
    title: PERSON.title,
    emails: [{ primary: true, type: 'work', value: PERSON.userName }],
    active: state.active,
    [SCHEMA.enterprise]: { department: state.department },
  };
}

export function stored(provider: Provider, state: State, modified = MODIFIED) {
  return {
    ...core(provider, state),
    id: IDS.user,
    ...(state.groups ? { groups: [{ value: IDS.group, display: IDS.groupName, $ref: `${BASE_URL}/Groups/${IDS.group}` }] } : {}),
    meta: {
      resourceType: 'User',
      created: CREATED,
      lastModified: modified,
      location: `${BASE_URL}/Users/${IDS.user}`,
    },
  };
}

const patch = (...operations: object[]) => ({ schemas: [SCHEMA.patch], Operations: operations });
const userPath = `/Users/${IDS.user}`;

function activeCall(provider: Provider, after: State): Call {
  const active = after.active;
  return {
    step: active ? 'reactivate' : 'deactivate',
    method: 'PATCH',
    path: userPath,
    body:
      provider === 'entra'
        ? patch({ op: 'Replace', path: 'active', value: active })
        : patch({ op: 'replace', value: { active } }),
    status: 200,
    response: stored(provider, after),
  };
}

const START: Record<Event, State | null> = {
  join: null,
  move: { department: 'Finance', active: true, groups: false },
  group: { department: 'Sales', active: true, groups: false },
  leave: { department: 'Sales', active: true, groups: true },
  return: { department: 'Sales', active: false, groups: true },
  delete: { department: 'Sales', active: true, groups: true },
};

export function scenario(provider: Provider, event: Event): Scenario {
  const start = START[event];
  const calls: Call[] = [];
  let end: State | null = null;

  switch (event) {
    case 'join': {
      end = { department: 'Finance', active: true, groups: false };
      const filter = `userName eq "${PERSON.userName}"`;
      calls.push({
        step: 'search',
        method: 'GET',
        path: provider === 'entra' ? `/Users?filter=${filter}` : `/Users?filter=${filter}&startIndex=1&count=100`,
        status: 200,
        response: { schemas: [SCHEMA.list], totalResults: 0, startIndex: 1, itemsPerPage: 0, Resources: [] },
      });
      const body = core(provider, end);
      calls.push({
        step: 'create',
        method: 'POST',
        path: '/Users',
        body:
          provider === 'entra'
            ? { ...body, meta: { resourceType: 'User' }, roles: [] }
            : { ...body, locale: 'en-US', groups: [], password: 'x8Qe2vLm' },
        status: 201,
        response: stored(provider, end, CREATED),
      });
      break;
    }
    case 'move':
      end = { ...start!, department: 'Sales' };
      if (provider === 'entra') {
        calls.push({
          step: 'update',
          method: 'PATCH',
          path: userPath,
          body: patch({ op: 'Replace', path: `${SCHEMA.enterprise}:department`, value: 'Sales' }),
          status: 200,
          response: stored(provider, end),
        });
      } else {
        calls.push({ step: 'read', method: 'GET', path: userPath, status: 200, response: stored(provider, start!, CREATED) });
        calls.push({
          step: 'replace',
          method: 'PUT',
          path: userPath,
          body: stored(provider, end, CREATED),
          status: 200,
          response: stored(provider, end),
        });
      }
      break;
    case 'group': {
      end = { ...start!, groups: true };
      const member = provider === 'entra' ? { $ref: null, value: IDS.user } : { value: IDS.user, display: PERSON.userName };
      calls.push({
        step: 'addMember',
        method: 'PATCH',
        path: `/Groups/${IDS.group}`,
        body: patch({ op: provider === 'entra' ? 'Add' : 'add', path: 'members', value: [member] }),
        ...(provider === 'entra'
          ? { status: 204 }
          : {
              status: 200,
              response: {
                schemas: [SCHEMA.group],
                id: IDS.group,
                displayName: IDS.groupName,
                members: [{ value: IDS.user, display: PERSON.userName }],
                meta: { resourceType: 'Group' },
              },
            }),
      });
      break;
    }
    case 'leave':
      end = { ...start!, active: false };
      calls.push(activeCall(provider, end));
      break;
    case 'return':
      end = { ...start!, active: true };
      calls.push(activeCall(provider, end));
      break;
    case 'delete':
      end = { ...start!, active: false };
      calls.push(activeCall(provider, end));
      if (provider === 'entra') {
        calls.push({ step: 'remove', method: 'DELETE', path: userPath, status: 204, later: true });
        end = null;
      }
      break;
  }

  return {
    provider,
    event,
    calls,
    before: start ? stored(provider, start, CREATED) : null,
    after: end ? stored(provider, end, event === 'join' ? CREATED : MODIFIED) : null,
  };
}

export const json = (value: unknown) => JSON.stringify(value, null, 2);
