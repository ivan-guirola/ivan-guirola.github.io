import {
  execute,
  httpClient,
  javaClasses,
  javaPackages,
  logger,
  newEffects,
  secrets,
  sequence,
  utils,
  type Engine,
  type HttpCall,
  type HttpMock,
  type LogLine,
} from './common';
import { JavaSet, JsonValue, javaList, javaMap, plain } from './java';
import type { ProfileChange } from './node';

/** An OAuth2 Access Token Modification script, run against the token AM is about to issue. */

export type Grant = 'authorization_code' | 'client_credentials' | 'jwt_bearer';

export interface TokenScenario {
  grant: Grant;
  /** The resource owner's profile, or null when AM doesn't know the subject. */
  user: { name: string; attributes: Record<string, string[]> } | null;
  client: { clientId: string; customProperties: Record<string, unknown>; allowedScopes: string[]; redirectUris: string[] };
  scopes: string[];
  requestParams: Record<string, string[]>;
  requestHeaders: Record<string, string[]>;
  session: Record<string, string> | null;
  http: HttpMock[];
  secrets?: Record<string, string>;
  /** Seconds since the epoch when the token is issued. */
  now: number;
  lifetime: number;
}

export interface TokenResult {
  status: 'issued' | 'error';
  error?: { message: string; line?: number };
  native: Record<string, unknown>;
  claims: Record<string, unknown>;
  added: string[];
  changed: string[];
  removed: string[];
  extra: Record<string, unknown>;
  response: Record<string, unknown>;
  introspection: Record<string, unknown>;
  jwt: string;
  size: number;
  nativeSize: number;
  profile: ProfileChange[];
  logs: LogLine[];
  http: HttpCall[];
}

export const GRANT_TYPES: Record<Grant, string> = {
  authorization_code: 'authorization_code',
  client_credentials: 'client_credentials',
  jwt_bearer: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
};

export const ISSUER = 'https://am.example.com/am/oauth2/realms/root/realms/alpha';
/** Many browsers and proxies cap request headers at about 8 KB in total; a token over 4 KB is a risk. */
export const SIZE_WARNING = 4096;

/** The claims AM puts in a client-side access token, in the order it writes them. */
export function nativeClaims(scenario: TokenScenario, ids = sequence()): Record<string, unknown> {
  const { grant, user, client, now, lifetime } = scenario;
  const subject = grant === 'client_credentials' ? `(usr!${client.clientId})` : (user?.name ?? 'cbc10a8b-2a5f-4a77-8c2a-5d5a8e3c0f11');
  const id = (prefix: string) => `${prefix}${ids.uuid().slice(-8)}`;
  return {
    sub: subject,
    cts: 'OAUTH2_STATELESS_GRANT',
    auth_level: grant === 'authorization_code' ? 1 : 0,
    auditTrackingId: `f20f4099-5248-4399-a7f0-2d54d4020099-${(now % 1000000).toString().padStart(6, '0')}`,
    subname: grant === 'client_credentials' ? client.clientId : subject,
    iss: ISSUER,
    tokenName: 'access_token',
    token_type: 'Bearer',
    authGrantId: id('sReMmkL05mN4xtDM'),
    aud: client.clientId,
    nbf: now,
    grant_type: GRANT_TYPES[grant],
    scope: [...scenario.scopes],
    auth_time: now,
    realm: '/alpha',
    exp: now + lifetime,
    iat: now,
    expires_in: lifetime,
    jti: id('FTQT6eZkDhm6PHEa'),
  };
}

const NATIVE_REMOVALS: Record<string, string> = {
  removeAuditTrackingId: 'auditTrackingId',
  removeAuthGrantId: 'authGrantId',
  removeAuthLevel: 'auth_level',
  removeAuthTime: 'auth_time',
  removeClaims: 'claims',
  removeClientId: 'aud',
  removeConfirmationKey: 'cnf',
  removeGrantType: 'grant_type',
  removeNonce: 'nonce',
  removePermissions: 'permissions',
  removeRealm: 'realm',
  removeResourceOwnerId: 'sub',
  removeScopes: 'scope',
  removeTokenName: 'tokenName',
  removeTokenType: 'token_type',
};

const base64url = (value: string) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(value)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Stands in for an RS256 signature: 342 base64url characters, the length of a 2048-bit RSA signature, that change with the claims. */
function signature(payload: string) {
  let seed = 2166136261;
  for (const char of payload) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619) >>> 0;
  let output = '';
  for (let index = 0; index < 342; index++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    output += ALPHABET[seed >>> 26];
  }
  return output;
}

/** The token as it travels: header and claims in base64url, with a placeholder for the signature. */
export function encodeJwt(claims: Record<string, unknown>) {
  const header = { typ: 'JWT', zip: 'NONE', alg: 'RS256', kid: 'am-signing-2026' };
  return `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}.${signature(JSON.stringify(claims))}`;
}

const unwrap = (value: unknown): unknown => {
  if (typeof value === 'function') return unwrap((value as () => unknown)());
  return plain(value);
};

export function runToken(code: string, engine: Engine, scenario: TokenScenario): TokenResult {
  const effects = newEffects();
  const random = sequence();
  const native = nativeClaims(scenario);
  const claims: Record<string, unknown> = structuredClone(native);
  const extra: Record<string, unknown> = {};
  const profile: ProfileChange[] = [];
  const touched = new Set<string>();
  const attributes = structuredClone(scenario.user?.attributes ?? {});

  const set = (name: string, value: unknown) => {
    const stored = unwrap(value);
    touched.add(name);
    if (stored === undefined) delete claims[name];
    else claims[name] = stored;
  };
  const scope = () => (Array.isArray(claims.scope) ? (claims.scope as string[]) : []);

  const accessToken: Record<string, unknown> = {
    setField: (name: unknown, value: unknown) => set(String(name), value),
    setFields: (fields: Record<string, unknown>) => {
      for (const [name, value] of Object.entries(plain(fields) as Record<string, unknown>)) set(name, value);
    },
    addExtraData: (key: unknown, value: unknown) => {
      const stored = unwrap(value);
      extra[String(key)] = stored === null || stored === undefined ? stored : String(stored);
    },
    addExtraJsonData: (key: unknown, value: unknown) => {
      extra[String(key)] = unwrap(value);
    },
    setExpiryTime: (milliseconds: unknown) => {
      const exp = Math.floor(Number(milliseconds) / 1000);
      set('exp', exp);
      claims.expires_in = Math.max(0, exp - scenario.now);
    },
    getExpiryTime: () => Number(claims.exp) * 1000,
    setScope: (values: unknown) => set('scope', values instanceof JavaSet ? values.toArray() : plain(values)),
    getScope: () => (engine === 'legacy' ? new JavaSet(scope()) : javaList(scope())),
    setPermissions: (value: unknown) => set('permissions', value),
    getPermissions: () => (engine === 'legacy' ? new JsonValue(claims.permissions ?? null) : (claims.permissions ?? null)),
    getClientId: () => claims.aud,
    getResourceOwnerId: () => claims.sub,
    getRealm: () => claims.realm,
    getGrantType: () => claims.grant_type,
    getTokenType: () => claims.token_type,
    getTokenName: () => claims.tokenName,
    getTokenId: () => claims.jti,
    getAuditTrackingId: () => claims.auditTrackingId,
    getAuthGrantId: () => claims.authGrantId,
    getAuthLevel: () => claims.auth_level,
    getAuthTimeSeconds: () => claims.auth_time,
    getCustomFields: () => javaMap(Object.fromEntries([...touched].filter((name) => !(name in native)).map((name) => [name, claims[name]]))),
    toMap: () => javaMap(structuredClone(claims)),
  };
  for (const [method, claim] of Object.entries(NATIVE_REMOVALS)) {
    accessToken[method] = () => {
      touched.add(claim);
      delete claims[claim];
    };
  }

  const change = (attribute: string, values: string[], saved: boolean) => {
    const existing = profile.find((item) => item.attribute === attribute && !item.saved);
    if (existing) Object.assign(existing, { values, saved });
    else profile.push({ user: scenario.user!.name, attribute, values, saved });
    if (saved) attributes[attribute] = values;
  };
  const list = (values: unknown) => (values instanceof JavaSet ? values.toArray() : Array.isArray(values) ? [...values] : [values]).map(String);

  let identity: unknown = null;
  if (engine === 'legacy') {
    if (scenario.user) {
      const user = scenario.user;
      identity = {
        getName: () => user.name,
        getUniversalId: () => `id=${user.name},ou=user,o=alpha,ou=services,ou=am-config`,
        isExists: () => true,
        getAttribute: (name: unknown) => new JavaSet(attributes[String(name)] ?? []),
        getAttributes: (names: unknown) => {
          const wanted = names instanceof JavaSet ? names.toArray() : list(names);
          return javaMap(Object.fromEntries(wanted.map((name) => [name, new JavaSet(attributes[name] ?? [])])));
        },
        setAttribute: (name: unknown, values: unknown) => change(String(name), list(values), true),
        addAttribute: (name: unknown, value: unknown) => change(String(name), [...(attributes[String(name)] ?? []), ...list(value)], true),
      };
    }
  } else {
    const pending: Record<string, string[]> = {};
    const current = (name: string) => pending[name] ?? attributes[name] ?? [];
    identity = {
      exists: () => scenario.user !== null,
      getName: () => scenario.user?.name ?? null,
      getUniversalId: () => (scenario.user ? `id=${scenario.user.name},ou=user,o=alpha,ou=services,ou=am-config` : null),
      getAttributeValues: (name: unknown) => javaList([...current(String(name))]),
      setAttribute: (name: unknown, values: unknown) => {
        pending[String(name)] = list(values);
        if (scenario.user) change(String(name), pending[String(name)], false);
      },
      addAttribute: (name: unknown, value: unknown) => {
        pending[String(name)] = [...current(String(name)), ...list(value)];
        if (scenario.user) change(String(name), pending[String(name)], false);
      },
      store: () => {
        if (!scenario.user) throw new Error('IdentityUpdateException: the resource owner is not a known identity');
        for (const [name, values] of Object.entries(pending)) change(name, values, true);
      },
    };
  }

  const session = scenario.session
    ? engine === 'legacy'
      ? {
          getProperty: (name: unknown) => scenario.session![String(name)] ?? null,
          getTimeLeft: () => 7140,
          getMaxIdleTime: () => 30,
          getTokenID: () => ({ toString: () => 'AQIC5wM2LY4SfcwNTU1-session-id*' }),
        }
      : {
          getProperty: (name: unknown) => scenario.session![String(name)] ?? null,
          setProperty: (name: unknown, value: unknown) => {
            scenario.session![String(name)] = String(value);
          },
        }
    : null;

  const lists = (values: Record<string, string[]>) => javaMap(Object.fromEntries(Object.entries(values).map(([key, items]) => [key, javaList(items)])));
  const { client } = scenario;
  const bindings: Record<string, unknown> = {
    accessToken,
    identity,
    session,
    scopes: engine === 'legacy' ? new JavaSet(scenario.scopes) : javaList(scenario.scopes),
    clientProperties: javaMap({
      clientId: client.clientId,
      allowedGrantTypes: javaList([GRANT_TYPES[scenario.grant]]),
      allowedResponseTypes: javaList(['code', 'token', 'id_token']),
      allowedScopes: javaList(client.allowedScopes),
      customProperties: javaMap(client.customProperties),
      redirectUris: javaList(client.redirectUris),
    }),
    requestProperties: javaMap({
      requestUri: `https://am.example.com/am/oauth2/realms/root/realms/alpha/access_token`,
      realm: '/alpha',
      requestParams: lists(scenario.requestParams),
      requestHeaders: lists(scenario.requestHeaders),
    }),
    logger: logger(engine, effects),
    httpClient: httpClient(engine, scenario.http, effects),
    secrets: secrets(scenario.secrets ?? {}),
    realm: '/alpha',
    scriptName: 'OAuth2 Access Token Modification Script',
  };
  if (engine === 'legacy') Object.assign(bindings, javaPackages(javaClasses(random)));
  else bindings.utils = utils(random);

  const execution = execute(code, bindings);
  const nativeJwt = encodeJwt(native);
  const empty = {
    native,
    claims: native,
    added: [],
    changed: [],
    removed: [],
    extra: {},
    response: {},
    introspection: {},
    jwt: nativeJwt,
    size: nativeJwt.length,
    nativeSize: nativeJwt.length,
    profile,
    ...effects,
  };
  if (execution.error) return { status: 'error', error: execution.error, ...empty };

  const jwt = encodeJwt(claims);
  const added = Object.keys(claims).filter((name) => !(name in native));
  const changed = Object.keys(native).filter((name) => name in claims && JSON.stringify(claims[name]) !== JSON.stringify(native[name]));
  const removed = Object.keys(native).filter((name) => !(name in claims));
  const scopes = scope().join(' ');
  const custom = Object.fromEntries(added.map((name) => [name, claims[name]]));

  return {
    ...empty,
    status: 'issued',
    claims,
    added,
    changed,
    removed,
    extra,
    jwt,
    size: jwt.length,
    response: { access_token: jwt, ...extra, scope: scopes, token_type: 'Bearer', expires_in: claims.expires_in },
    introspection: {
      active: true,
      scope: scopes,
      realm: claims.realm,
      client_id: client.clientId,
      user_id: claims.sub,
      username: claims.subname,
      token_type: claims.token_type,
      exp: claims.exp,
      sub: claims.sub,
      subname: claims.subname,
      iss: claims.iss,
      auth_level: claims.auth_level,
      authGrantId: claims.authGrantId,
      auditTrackingId: claims.auditTrackingId,
      expires_in: claims.expires_in,
      ...custom,
    },
  };
}
