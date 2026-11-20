import { JavaSet, JsonValue, javaList, javaString } from './java';

/** Bindings every AM script gets, in both engines: logger, httpClient, utils and, for legacy, Java classes. */

export type Engine = 'legacy' | 'next';

export interface HttpMock {
  /** The request matches when its URL starts with this. */
  url: string;
  method?: string;
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface HttpCall {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
  status: number;
  matched: boolean;
}

export interface LogLine {
  level: 'trace' | 'debug' | 'info' | 'warn' | 'error';
  message: string;
}

export interface Effects {
  logs: LogLine[];
  http: HttpCall[];
}

export const newEffects = (): Effects => ({ logs: [], http: [] });

const REASONS: Record<number, string> = {
  200: 'OK',
  201: 'Created',
  204: 'No Content',
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
};
const reason = (code: number) => REASONS[code] ?? '';

function format(message: unknown, args: unknown[]) {
  let index = 0;
  return String(message).replace(/\{\}/g, (match) => (index < args.length ? String(args[index++]) : match));
}

export function logger(engine: Engine, effects: Effects) {
  const log = (level: LogLine['level']) => (message: unknown, ...args: unknown[]) => {
    effects.logs.push({ level, message: format(message, args) });
  };
  if (engine === 'legacy') {
    return {
      message: log('debug'),
      warning: log('warn'),
      error: log('error'),
      messageEnabled: () => true,
      warningEnabled: () => true,
      errorEnabled: () => true,
    };
  }
  return {
    trace: log('trace'),
    debug: log('debug'),
    info: log('info'),
    warn: log('warn'),
    error: log('error'),
    isTraceEnabled: () => true,
    isDebugEnabled: () => true,
    isInfoEnabled: () => true,
    isWarnEnabled: () => true,
    isErrorEnabled: () => true,
  };
}

interface Exchange {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

function respond(exchange: Exchange, mocks: HttpMock[], effects: Effects) {
  const mock = mocks.find(
    (candidate) => exchange.url.startsWith(candidate.url) && (!candidate.method || candidate.method.toUpperCase() === exchange.method),
  );
  const status = mock?.status ?? 404;
  const body = mock?.body === undefined ? '' : typeof mock.body === 'string' ? mock.body : JSON.stringify(mock.body);
  effects.http.push({ ...exchange, status, matched: Boolean(mock) });
  return { status, body, headers: { ...(mock?.headers ?? {}), ...(mock?.body !== undefined && typeof mock.body !== 'string' ? { 'Content-Type': 'application/json' } : {}) } };
}

/** The promise CHF returns: legacy scripts call get() or getOrThrow() to wait for the response. */
function promise<T>(value: T) {
  return {
    get: () => value,
    getOrThrow: () => value,
    getOrThrowUninterruptibly: () => value,
    then: (callback: (value: T) => unknown) => promise(callback(value)),
  };
}

class Status {
  static #known = new Map<number, Status>();
  readonly #code: number;

  private constructor(code: number) {
    this.#code = code;
  }
  static valueOf(code: number) {
    if (!Status.#known.has(code)) Status.#known.set(code, new Status(code));
    return Status.#known.get(code)!;
  }
  static OK = Status.valueOf(200);
  static CREATED = Status.valueOf(201);
  static NO_CONTENT = Status.valueOf(204);
  static BAD_REQUEST = Status.valueOf(400);
  static UNAUTHORIZED = Status.valueOf(401);
  static FORBIDDEN = Status.valueOf(403);
  static NOT_FOUND = Status.valueOf(404);
  static INTERNAL_SERVER_ERROR = Status.valueOf(500);

  getCode() {
    return this.#code;
  }
  getReasonPhrase() {
    return reason(this.#code);
  }
  isSuccessful() {
    return this.#code >= 200 && this.#code < 300;
  }
  toString() {
    return `${this.#code} ${reason(this.#code)}`.trim();
  }
}

class Headers {
  readonly values: Record<string, string> = {};
  add(name: string, value: unknown) {
    this.values[name] = String(value);
    return this;
  }
  put(name: string, value: unknown) {
    return this.add(name, value);
  }
  get(name: string) {
    return name in this.values ? javaList([this.values[name]]) : null;
  }
  getFirst(name: string) {
    return this.values[name] ?? null;
  }
}

class Entity {
  readonly #text: string;
  constructor(text: string) {
    this.#text = text;
  }
  getString() {
    return this.#text;
  }
  getJson() {
    return JSON.parse(this.#text);
  }
  toString() {
    return this.#text;
  }
}

/** org.forgerock.http.protocol.Request */
export class Request {
  #uri = '';
  #method = 'GET';
  readonly #headers = new Headers();
  #entity = '';

  setUri(uri: unknown) {
    this.#uri = String(uri);
    return this;
  }
  getUri() {
    return this.#uri;
  }
  setMethod(method: unknown) {
    this.#method = String(method).toUpperCase();
    return this;
  }
  getMethod() {
    return this.#method;
  }
  getHeaders() {
    return this.#headers;
  }
  setEntity(entity: unknown) {
    this.#entity = typeof entity === 'string' ? entity : JSON.stringify(entity);
    return this;
  }
  getEntity() {
    return new Entity(this.#entity);
  }
  exchange(): Exchange {
    return { method: this.#method, url: this.#uri, headers: { ...this.#headers.values }, body: this.#entity || undefined };
  }
}

export function httpClient(engine: Engine, mocks: HttpMock[], effects: Effects) {
  if (engine === 'legacy') {
    return {
      send(request: unknown) {
        if (!(request instanceof Request)) throw new TypeError('httpClient.send() expects an org.forgerock.http.protocol.Request in legacy scripts.');
        const answer = respond(request.exchange(), mocks, effects);
        const status = Status.valueOf(answer.status);
        const headers = new Headers();
        for (const [name, value] of Object.entries(answer.headers)) headers.add(name, value);
        return promise({ getStatus: () => status, getEntity: () => new Entity(answer.body), getHeaders: () => headers });
      },
    };
  }
  return {
    send(url: unknown, options: Record<string, unknown> = {}) {
      if (typeof url !== 'string') throw new TypeError('httpClient.send() expects a URL and an options object in next-generation scripts.');
      const headers: Record<string, string> = {};
      for (const [name, value] of Object.entries((options.headers as Record<string, unknown>) ?? {})) headers[name] = String(value);
      if (options.token !== undefined) headers.Authorization = String(options.token);
      let body: string | undefined;
      if (options.form) {
        body = new URLSearchParams(options.form as Record<string, string>).toString();
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
      } else if (options.body !== undefined) {
        body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
      }
      const method = String(options.method ?? 'GET').toUpperCase();
      const answer = respond({ method, url, headers, body }, mocks, effects);
      return promise({
        status: answer.status,
        statusText: reason(answer.status),
        ok: answer.status >= 200 && answer.status < 300,
        headers: answer.headers,
        text: () => answer.body,
        json: () => JSON.parse(answer.body),
        formData: () => Object.fromEntries(new URLSearchParams(answer.body)),
      });
    },
  };
}

const utf8 = (text: string) => new TextEncoder().encode(text);
const fromUtf8 = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (text: string) => Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
const url = (text: string) => text.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unurl = (text: string) => text.replace(/-/g, '+').replace(/_/g, '/');

/** Random values that are the same in both engines, so their results can be compared. */
export function sequence() {
  let counter = 0;
  return {
    uuid: () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`,
    number: () => (++counter * 2654435761) % 4294967296,
  };
}

export function utils(random = sequence()) {
  return {
    base64: {
      encode: (text: unknown) => toBase64(utf8(String(text))),
      decode: (text: unknown) => fromUtf8(fromBase64(String(text))),
    },
    base64url: {
      encode: (text: unknown) => url(toBase64(utf8(String(text)))),
      decode: (text: unknown) => fromUtf8(fromBase64(unurl(String(text)))),
    },
    crypto: {
      randomUUID: () => random.uuid(),
      getRandomValues: (values: number[]) => {
        for (let index = 0; index < values.length; index++) values[index] = random.number();
        return values;
      },
    },
  };
}

/** The secrets binding: secrets.getGenericSecret("label").getAsUtf8(), from secrets set up in the realm. */
export function secrets(values: Record<string, string>) {
  return {
    getGenericSecret(label: unknown) {
      const name = String(label);
      if (!Object.hasOwn(values, name)) throw new Error(`NoSuchSecretException: no secret is mapped to ${name}`);
      return { getAsUtf8: () => values[name], getAsBytes: () => utf8(values[name]) };
    },
  };
}

/** java.lang.String: called as a function it gives text; with new, a string object that has getBytes(). */
function JavaStringClass(this: unknown, value: unknown) {
  const text = value instanceof Uint8Array ? fromUtf8(value) : javaString(value);
  if (!new.target) return text;
  const boxed = new String(text) as String & { getBytes(): Uint8Array; equals(other: unknown): boolean };
  Object.defineProperty(boxed, 'getBytes', { value: () => utf8(text) });
  Object.defineProperty(boxed, 'equals', { value: (other: unknown) => String(other) === text });
  return boxed;
}

export function javaClasses(random = sequence()): Record<string, unknown> {
  return {
    'java.lang.String': JavaStringClass,
    'java.util.Base64': {
      getEncoder: () => ({ encodeToString: (bytes: Uint8Array | string) => toBase64(typeof bytes === 'string' ? utf8(bytes) : bytes) }),
      getDecoder: () => ({ decode: (text: string) => fromBase64(String(text)) }),
    },
    'java.util.UUID': { randomUUID: () => ({ toString: () => random.uuid() }) },
    'java.util.HashSet': JavaSet,
    'org.forgerock.json.JsonValue': JsonValue,
    'org.forgerock.http.protocol.Request': Request,
    'org.forgerock.http.protocol.Status': Status,
  };
}

const PACKAGE_PATH = Symbol('package');

/** The Rhino package objects (org, java, javax, com) and JavaImporter, backed by the classes this simulator knows. */
export function javaPackages(classes: Record<string, unknown>) {
  const names = new Map<unknown, string>(Object.entries(classes).map(([name, value]) => [value, name]));
  const pkg = (path: string): unknown =>
    new Proxy(function unknownClass() {}, {
      get(_target, property) {
        if (property === PACKAGE_PATH) return path;
        if (typeof property === 'symbol' || property === 'then') return undefined;
        const name = `${path}.${property}`;
        return name in classes ? classes[name] : pkg(name);
      },
      apply() {
        throw new TypeError(`${path} is not one of the Java classes this simulator provides. In AM it has to be on the script allowlist.`);
      },
      construct() {
        throw new TypeError(`${path} is not one of the Java classes this simulator provides. In AM it has to be on the script allowlist.`);
      },
    });
  const roots = Object.fromEntries(['org', 'java', 'javax', 'com'].map((root) => [root, pkg(root)]));
  function JavaImporter(...imported: unknown[]) {
    const scope: Record<string, unknown> = {};
    for (const item of imported) {
      const name = names.get(item) ?? (item as Record<symbol, string>)?.[PACKAGE_PATH];
      if (name) scope[name.split('.').pop()!] = item;
    }
    return scope;
  }
  return { ...roots, Packages: roots, JavaImporter };
}

export interface Execution {
  values: Record<string, unknown>;
  error?: { message: string; line?: number };
}

let offset: number | undefined;

/** How many lines new Function() adds before the script, so errors point at the script's own lines. */
function lineOffset() {
  if (offset !== undefined) return offset;
  try {
    new Function('a', 'throw new Error()')(1);
  } catch (error) {
    const line = Number(/<anonymous>:(\d+):\d+/.exec(String((error as Error).stack))?.[1]);
    offset = Number.isFinite(line) ? line - 1 : 2;
  }
  return offset ?? 2;
}

function lineOf(error: unknown) {
  const match = /<anonymous>:(\d+):\d+/.exec(String((error as Error)?.stack ?? ''));
  return match ? Number(match[1]) - lineOffset() : undefined;
}

/** Runs a script with the given bindings and reads back the variables it is expected to set, such as action. */
export function execute(code: string, bindings: Record<string, unknown>, capture: string[] = []): Execution {
  const names = Object.keys(bindings);
  const tail = `\n;return {${capture.map((name) => `${JSON.stringify(name)}: typeof ${name} === "undefined" ? undefined : ${name}`).join(', ')}};`;
  let run: (...args: unknown[]) => Record<string, unknown>;
  try {
    run = new Function(...names, code + tail) as typeof run;
  } catch (error) {
    return { values: {}, error: { message: `${(error as Error).name}: ${(error as Error).message}` } };
  }
  try {
    return { values: run(...names.map((name) => bindings[name])) ?? {} };
  } catch (error) {
    const message = error instanceof Error ? `${error.name === 'Error' ? '' : `${error.name}: `}${error.message}` : String(error);
    return { values: {}, error: { message, line: lineOf(error) } };
  }
}
