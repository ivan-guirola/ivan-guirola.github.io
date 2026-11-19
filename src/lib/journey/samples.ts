import { FAILURE, SUCCESS } from './parse';

type Json = Record<string, unknown>;

interface Spec {
  id: string;
  type: string;
  name: string;
  x: number;
  y: number;
  to: Record<string, string>;
  config?: Json;
  children?: { id: string; type: string; name: string; config?: Json }[];
}

const id = (n: number) => `0b1e${n.toString(16).padStart(4, '0')}-5a3c-4d2e-9f10-7c6b5a4d3e2f`;

const ids = {
  page: id(1),
  username: id(2),
  password: id(3),
  check: id(4),
  retry: id(5),
  mfa: id(6),
  route: id(7),
  partner: id(8),
  count: id(9),
  oldLockout: id(10),
  active: id(11),
  create: id(21),
  send: id(22),
  codePage: id(23),
  collect: id(24),
  log: id(25),
  routeScript: 'b6f3d2a1-4c5e-4f60-8a7b-9c0d1e2f3a4b',
  logScript: 'c7a4e3b2-5d6f-4071-9b8c-0d1e2f3a4b5c',
};

function tree(name: string, entry: string, specs: Spec[], statics: { start: [number, number]; success: [number, number]; failure: [number, number] }, extra: Json = {}) {
  const nodes: Json = {};
  const configs: Json = {};
  const inner: Json = {};
  for (const spec of specs) {
    nodes[spec.id] = { connections: spec.to, displayName: spec.name, nodeType: spec.type, x: spec.x, y: spec.y };
    const config: Json = { _id: spec.id, _rev: '1', _type: { _id: spec.type, collection: true }, ...spec.config };
    if (spec.children) {
      config.nodes = spec.children.map((child) => ({ _id: child.id, displayName: child.name, nodeType: child.type }));
      for (const child of spec.children) inner[child.id] = { _id: child.id, _type: { _id: child.type }, ...child.config };
    }
    configs[spec.id] = config;
  }
  return {
    tree: {
      _id: name,
      _rev: '1',
      enabled: true,
      identityResource: 'managed/alpha_user',
      uiConfig: { categories: '["Authentication"]' },
      entryNodeId: entry,
      nodes,
      staticNodes: {
        startNode: { x: statics.start[0], y: statics.start[1] },
        [SUCCESS]: { x: statics.success[0], y: statics.success[1] },
        [FAILURE]: { x: statics.failure[0], y: statics.failure[1] },
      },
      ...extra,
    },
    nodes: configs,
    innerNodes: inner,
  };
}

const ROUTE_SCRIPT = [
  "var username = nodeState.get('username');",
  'var identity = idRepository.getIdentity(username);',
  "var mail = String(identity.getAttributeValues('mail')[0] || '');",
  "var domain = mail.split('@').pop().toLowerCase();",
  '',
  "if (domain === 'example.com') {",
  "  action.goTo('employee');",
  "} else if (['partner.example'].indexOf(domain) !== -1) {",
  "  action.goTo('partner');",
  '} else {',
  "  action.goTo('unknown');",
  '}',
];

const LOG_SCRIPT = [
  "var username = sharedState.get('username');",
  "logger.message('Wrong one-time code for ' + username);",
  "outcome = 'logged';",
];

const encode = (lines: string[]) => btoa(lines.join('\n'));

function routeScript(lines: string[], asArray: boolean) {
  return {
    _id: ids.routeScript,
    name: 'Route by email domain',
    description: 'Sends employees and partners down different paths.',
    language: 'JAVASCRIPT',
    context: 'SCRIPTED_DECISION_NODE',
    evaluatorVersion: '2.0',
    script: asArray ? lines : encode(lines),
  };
}

const logScript = {
  _id: ids.logScript,
  name: 'Log wrong code',
  language: 'JAVASCRIPT',
  context: 'AUTHENTICATION_TREE_DECISION_NODE',
  evaluatorVersion: '1.0',
  script: encode(LOG_SCRIPT),
};

function secondFactor() {
  return tree(
    'SecondFactor',
    ids.create,
    [
      { id: ids.create, type: 'OneTimePasswordGeneratorNode', name: 'Create a code', x: 140, y: 120, to: { outcome: ids.send }, config: { length: 6 } },
      {
        id: ids.send,
        type: 'OneTimePasswordSmtpSenderNode',
        name: 'Email the code',
        x: 420,
        y: 120,
        to: { outcome: ids.codePage },
        config: { hostName: 'smtp.example.com', port: 587, fromEmailAddress: 'no-reply@example.com', emailAttribute: 'mail' },
      },
      {
        id: ids.codePage,
        type: 'PageNode',
        name: 'Enter the code',
        x: 700,
        y: 100,
        to: { true: SUCCESS, false: ids.log },
        config: { pageHeader: { en: 'Check your email' } },
        children: [{ id: id(26), type: 'OneTimePasswordCollectorDecisionNode', name: 'One-time code', config: { passwordExpiryTime: 5 } }],
      },
      {
        id: ids.log,
        type: 'ScriptedDecisionNode',
        name: 'Log wrong code',
        x: 980,
        y: 240,
        to: { logged: FAILURE },
        config: { script: ids.logScript, outcomes: ['logged'], inputs: ['*'], outputs: ['*'] },
      },
    ],
    { start: [50, 145], success: [1000, 90], failure: [1250, 260] },
    { innerTreeOnly: true },
  );
}

function login(version: 'production' | 'development') {
  const dev = version === 'development';
  const shift = dev ? 280 : 0;
  const specs: Spec[] = [
    {
      id: ids.page,
      type: 'PageNode',
      name: 'Sign in',
      x: 140,
      y: 180,
      to: { outcome: ids.check },
      config: { pageHeader: { en: 'Sign in' } },
      children: [
        { id: ids.username, type: 'ValidatedUsernameNode', name: 'Username', config: { usernameAttribute: 'userName', validateInput: false } },
        { id: ids.password, type: 'ValidatedPasswordNode', name: 'Password', config: { passwordAttribute: 'password', validateInput: false } },
      ],
    },
    {
      id: ids.check,
      type: 'DataStoreDecisionNode',
      name: 'Check the password',
      x: 420,
      y: 200,
      to: { true: dev ? ids.active : ids.mfa, false: ids.retry },
      config: { _outcomes: [{ id: 'true', displayName: 'True' }, { id: 'false', displayName: 'False' }] },
    },
    {
      id: ids.retry,
      type: 'RetryLimitDecisionNode',
      name: dev ? 'Five attempts' : 'Three attempts',
      x: 700 + shift,
      y: 400,
      to: { Retry: ids.page, Reject: FAILURE },
      config: { retryLimit: dev ? 5 : 3, incrementUserAttributeOnFailure: true },
    },
    {
      id: ids.mfa,
      type: 'InnerTreeEvaluatorNode',
      name: 'Second factor',
      x: 700 + shift,
      y: 160,
      to: { true: ids.route, false: FAILURE },
      config: { tree: 'SecondFactor' },
    },
    {
      id: ids.route,
      type: 'ScriptedDecisionNode',
      name: 'Route by email domain',
      x: 980 + shift,
      y: 120,
      to: { employee: ids.count, partner: ids.partner, unknown: FAILURE },
      config: { script: ids.routeScript, outcomes: ['employee', 'partner', 'unknown'], inputs: ['*'], outputs: ['*'] },
    },
    {
      id: ids.partner,
      type: 'MessageNode',
      name: 'Partner notice',
      x: 1260 + shift,
      y: 260,
      to: { true: ids.count, false: FAILURE },
      config: {
        message: { en: dev ? 'You are signing in as a partner. Your access is reviewed every 90 days.' : 'You are signing in as a partner.' },
        messageYes: { en: 'Continue' },
        messageNo: { en: 'Cancel' },
      },
    },
    {
      id: ids.count,
      type: 'IncrementLoginCountNode',
      name: 'Count the sign-in',
      x: 1260 + shift,
      y: 60,
      to: { outcome: SUCCESS },
      config: { identityAttribute: 'userName' },
    },
  ];
  if (dev) {
    specs.push({
      id: ids.active,
      type: 'AccountActiveDecisionNode',
      name: 'Is the account active',
      x: 700,
      y: 200,
      to: { true: ids.mfa, false: FAILURE },
    });
  } else {
    specs.push({
      id: ids.oldLockout,
      type: 'AccountActiveDecisionNode',
      name: 'Old lockout check',
      x: 420,
      y: 420,
      to: { true: ids.mfa, false: FAILURE },
    });
  }
  return tree('Login', ids.page, specs, { start: [50, 225], success: [1540 + shift, 80], failure: [1540 + shift, 420] });
}

function exportOf(version: 'production' | 'development') {
  const dev = version === 'development';
  const route = dev ? [...ROUTE_SCRIPT.slice(0, 7), "} else if (['partner.example', 'supplier.example'].indexOf(domain) !== -1) {", ...ROUTE_SCRIPT.slice(8)] : ROUTE_SCRIPT;
  const main = login(version);
  const inner = secondFactor();
  return {
    meta: { origin: `https://am.${dev ? 'dev' : 'prod'}.example.com/am`, exportTool: 'frodo' },
    trees: {
      Login: { ...main, scripts: { [ids.routeScript]: routeScript(route, dev) } },
      SecondFactor: { ...inner, scripts: { [ids.logScript]: logScript } },
    },
  };
}

export const PRODUCTION = JSON.stringify(exportOf('production'), null, 2);
export const DEVELOPMENT = JSON.stringify(exportOf('development'), null, 2);
