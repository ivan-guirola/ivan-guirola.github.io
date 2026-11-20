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
import { CharArray, JavaSet, JsonValue, javaList, javaMap, plain } from './java';

/** A Scripted Decision node, run the way AM runs it, with the bindings of the legacy or the next-generation engine. */

export type CallbackType = 'name' | 'password' | 'textInput' | 'textOutput' | 'choice' | 'confirmation' | 'hidden' | 'scriptTextOutput';

export interface CallbackRequest {
  type: CallbackType;
  prompt?: string;
  defaultValue?: string;
  echoOn?: boolean;
  messageType?: number;
  message?: string;
  choices?: string[];
  defaultChoice?: number;
  multiple?: boolean;
  id?: string;
  value?: string;
}

/** What the user sends back for one callback: text, the chosen indexes of a choice, or the chosen option. */
export type Answer = string | number | number[] | null;

export interface NodeScenario {
  outcomes: string[];
  shared: Record<string, unknown>;
  transient: Record<string, unknown>;
  users: Record<string, Record<string, string[]>>;
  headers: Record<string, string[]>;
  parameters: Record<string, string[]>;
  cookies: Record<string, string>;
  http: HttpMock[];
  secrets?: Record<string, string>;
}

export interface StateWrite {
  state: 'shared' | 'transient';
  key: string;
  value: unknown;
}

export interface ProfileChange {
  user: string;
  attribute: string;
  values: string[];
  saved: boolean;
}

export interface NodeResult {
  status: 'outcome' | 'callbacks' | 'error';
  outcome?: string;
  error?: { message: string; line?: number };
  callbacks: CallbackRequest[];
  writes: StateWrite[];
  profile: ProfileChange[];
  messages: Record<string, string>;
  sessionProperties: Record<string, string>;
  logs: LogLine[];
  http: HttpCall[];
}

export const emptyScenario = (): NodeScenario => ({
  outcomes: ['true', 'false'],
  shared: {},
  transient: {},
  users: {},
  headers: {},
  parameters: {},
  cookies: {},
  http: [],
});

const OPTION_SETS: Record<number, string[]> = { 0: ['Yes', 'No'], 1: ['Yes', 'No', 'Cancel'], 2: ['OK', 'Cancel'] };
const CONSTANTS = {
  INFORMATION: 0,
  WARNING: 1,
  ERROR: 2,
  UNSPECIFIED_OPTION: -1,
  YES_NO_OPTION: 0,
  YES_NO_CANCEL_OPTION: 1,
  OK_CANCEL_OPTION: 2,
  YES: 0,
  NO: 1,
  CANCEL: 2,
  OK: 3,
};

const strings = (values: unknown): string[] => {
  if (values === null || values === undefined) return [];
  if (values instanceof JavaSet) return values.toArray().map(String);
  if (Array.isArray(values)) return [...values].map(String);
  return [String(values)];
};

/** The callbacks both engines can send, described the same way so their requests can be compared. */
const requests = {
  name: (prompt: unknown, defaultValue?: unknown): CallbackRequest => ({
    type: 'name',
    prompt: String(prompt),
    ...(defaultValue !== undefined ? { defaultValue: String(defaultValue) } : {}),
  }),
  password: (prompt: unknown, echoOn?: unknown): CallbackRequest => ({ type: 'password', prompt: String(prompt), echoOn: Boolean(echoOn) }),
  textInput: (prompt: unknown, defaultValue?: unknown): CallbackRequest => ({
    type: 'textInput',
    prompt: String(prompt),
    ...(defaultValue !== undefined ? { defaultValue: String(defaultValue) } : {}),
  }),
  textOutput: (messageType: unknown, message: unknown): CallbackRequest => ({ type: 'textOutput', messageType: Number(messageType), message: String(message) }),
  choice: (prompt: unknown, choices: unknown, defaultChoice: unknown, multiple: unknown): CallbackRequest => ({
    type: 'choice',
    prompt: String(prompt),
    choices: strings(choices),
    defaultChoice: Number(defaultChoice),
    multiple: Boolean(multiple),
  }),
  confirmation: (...args: unknown[]): CallbackRequest => {
    const prompt = typeof args[0] === 'string' ? (args.shift() as string) : undefined;
    const [messageType, options, defaultChoice] = args;
    return {
      type: 'confirmation',
      ...(prompt !== undefined ? { prompt } : {}),
      messageType: Number(messageType),
      choices: typeof options === 'number' ? (OPTION_SETS[options] ?? []) : strings(options),
      defaultChoice: Number(defaultChoice),
    };
  },
  hidden: (id: unknown, value?: unknown): CallbackRequest => ({ type: 'hidden', id: String(id), value: value === undefined ? '' : String(value) }),
  scriptTextOutput: (message: unknown): CallbackRequest => ({ type: 'scriptTextOutput', message: String(message) }),
};

/** A legacy callback object: created with new, read back with its getter once the user has answered. */
class LegacyCallback {
  constructor(
    readonly request: CallbackRequest,
    readonly answer: Answer = null,
  ) {}
  getPrompt() {
    return this.request.prompt ?? null;
  }
  getName() {
    return this.answer === null ? null : String(this.answer);
  }
  getPassword() {
    return this.answer === null ? null : new CharArray(String(this.answer));
  }
  getText() {
    return this.answer === null ? null : String(this.answer);
  }
  getValue() {
    return this.answer === null ? (this.request.value ?? null) : String(this.answer);
  }
  getId() {
    return this.request.id ?? null;
  }
  getSelectedIndexes() {
    return Array.isArray(this.answer) ? [...this.answer] : this.answer === null ? null : [Number(this.answer)];
  }
  getSelectedIndex() {
    return this.answer === null ? (this.request.defaultChoice ?? -1) : Number(this.answer);
  }
  getMessage() {
    return this.request.message ?? null;
  }
}

function callbackClass(type: CallbackType, constants = false) {
  const make = requests[type] as (...args: unknown[]) => CallbackRequest;
  const Class = function (this: unknown, ...args: unknown[]) {
    return new LegacyCallback(make(...args));
  } as unknown as Record<string, unknown>;
  if (constants) Object.assign(Class, CONSTANTS);
  return Class;
}

const LEGACY_CALLBACKS: Record<string, CallbackType> = {
  'javax.security.auth.callback.NameCallback': 'name',
  'javax.security.auth.callback.PasswordCallback': 'password',
  'javax.security.auth.callback.TextInputCallback': 'textInput',
  'javax.security.auth.callback.TextOutputCallback': 'textOutput',
  'javax.security.auth.callback.ChoiceCallback': 'choice',
  'javax.security.auth.callback.ConfirmationCallback': 'confirmation',
  'com.sun.identity.authentication.callbacks.HiddenValueCallback': 'hidden',
  'com.sun.identity.authentication.callbacks.ScriptTextOutputCallback': 'scriptTextOutput',
};

interface Chosen {
  outcome?: string;
  callbacks?: CallbackRequest[];
  messages: Record<string, string>;
  sessionProperties: Record<string, string>;
}

const BUILT = Symbol('built');

/** The chainable methods both engines offer after goTo() or send(). */
function chain<T extends object>(target: T, chosen: Chosen, extra: Record<string, string> = {}) {
  const set = (key: string) => (value: unknown) => {
    chosen.messages[key] = String(value);
    return target;
  };
  const methods: Record<string, (...args: unknown[]) => T> = {
    withErrorMessage: set('errorMessage'),
    withLockoutMessage: set('lockoutMessage'),
    withHeader: set('header'),
    withStage: set('stage'),
    withDescription: set('description'),
    putSessionProperty: (key, value) => {
      chosen.sessionProperties[String(key)] = String(value);
      return target;
    },
    removeSessionProperty: (key) => {
      delete chosen.sessionProperties[String(key)];
      return target;
    },
  };
  for (const [name, key] of Object.entries(extra)) methods[name] = set(key);
  return Object.assign(target, methods);
}

function legacyAction(chosen: () => Chosen) {
  const builder = (choice: Chosen) => {
    const target = {} as Record<string | symbol, unknown>;
    chain(target, choice, { withIdentifiedIdentity: 'identifiedIdentity' });
    target.build = () => ({ [BUILT]: choice });
    return target;
  };
  return {
    goTo(outcome: unknown) {
      const choice = chosen();
      choice.outcome = String(outcome);
      return builder(choice);
    },
    send(...callbacks: unknown[]) {
      const list = callbacks.length === 1 && Array.isArray(callbacks[0]) ? (callbacks[0] as unknown[]) : callbacks;
      const choice = chosen();
      choice.callbacks = list.map((callback) => {
        if (!(callback instanceof LegacyCallback)) throw new TypeError('Action.send() expects callback objects, such as new NameCallback("User Name").');
        return callback.request;
      });
      return builder(choice);
    },
  };
}

interface Run {
  engine: Engine;
  scenario: NodeScenario;
  answers?: Answer[];
  sent?: CallbackRequest[];
}

export function runNode(code: string, engine: Engine, scenario: NodeScenario, answers?: Answer[], sent?: CallbackRequest[]): NodeResult {
  return new NodeRun({ engine, scenario, answers, sent }).run(code);
}

class NodeRun {
  readonly effects = newEffects();
  readonly shared: Record<string, unknown>;
  readonly transient: Record<string, unknown>;
  readonly writes: StateWrite[] = [];
  readonly profile: ProfileChange[] = [];
  readonly users: Record<string, Record<string, string[]>>;
  readonly random = sequence();

  constructor(readonly options: Run) {
    this.shared = structuredClone(options.scenario.shared);
    this.transient = structuredClone(options.scenario.transient);
    this.users = structuredClone(options.scenario.users);
  }

  put(state: 'shared' | 'transient', key: unknown, value: unknown) {
    const stored = plain(value);
    (state === 'shared' ? this.shared : this.transient)[String(key)] = stored;
    this.writes.push({ state, key: String(key), value: stored });
  }

  read(key: unknown) {
    const name = String(key);
    if (Object.hasOwn(this.transient, name)) return this.transient[name];
    if (Object.hasOwn(this.shared, name)) return this.shared[name];
    return null;
  }

  remove(key: unknown) {
    delete this.shared[String(key)];
    delete this.transient[String(key)];
  }

  saveProfile(user: string, attribute: string, values: string[], saved: boolean) {
    const existing = this.profile.find((change) => change.user === user && change.attribute === attribute && !change.saved);
    if (existing) {
      existing.values = values;
      existing.saved = saved;
    } else this.profile.push({ user, attribute, values, saved });
    if (saved) (this.users[user] ??= {})[attribute] = values;
  }

  headers() {
    const { headers, cookies } = this.options.scenario;
    const all = { ...headers };
    const cookie = Object.entries(cookies).map(([name, value]) => `${name}=${value}`).join('; ');
    if (cookie && !all.Cookie) all.Cookie = [cookie];
    return all;
  }

  map(values: Record<string, string[]>) {
    return { get: (name: unknown) => (Object.hasOwn(values, String(name)) ? javaList(values[String(name)]) : null) };
  }

  stateBinding(state: 'shared' | 'transient') {
    const store = () => (state === 'shared' ? this.shared : this.transient);
    return {
      get: (key: unknown) => (Object.hasOwn(store(), String(key)) ? store()[String(key)] : null),
      put: (key: unknown, value: unknown) => this.put(state, key, value),
      remove: (key: unknown) => delete store()[String(key)],
      keys: () => new JavaSet(Object.keys(store())),
      isDefined: (key: unknown) => Object.hasOwn(store(), String(key)),
    };
  }

  nodeState(engine: Engine) {
    const self = this;
    const binding = {
      get: (key: unknown) => {
        const value = self.read(key);
        if (engine === 'next') return value;
        return value === null ? null : new JsonValue(value);
      },
      getObject: (key: unknown) => {
        const name = String(key);
        const values = [self.shared[name], self.transient[name]];
        const merged = values.every((value) => value && typeof value === 'object' && !Array.isArray(value))
          ? Object.freeze({ ...(values[0] as object), ...(values[1] as object) })
          : self.read(name);
        if (engine === 'next') return merged;
        return merged === null ? null : new JsonValue(merged);
      },
      putShared: (key: unknown, value: unknown) => {
        self.put('shared', key, value);
        return binding;
      },
      putTransient: (key: unknown, value: unknown) => {
        self.put('transient', key, value);
        return binding;
      },
      remove: (key: unknown) => {
        self.remove(key);
        return binding;
      },
      isDefined: (key: unknown) => self.read(key) !== null,
      keys: () => new JavaSet([...Object.keys(self.shared), ...Object.keys(self.transient)]),
    };
    return binding;
  }

  legacyCallbacks() {
    const { sent = [], answers } = this.options;
    if (!answers) return javaList<LegacyCallback>([]);
    return javaList(sent.map((request, index) => new LegacyCallback(request, answers[index] ?? null)));
  }

  nextCallbacks() {
    const { sent = [], answers } = this.options;
    const of = (type: CallbackType) =>
      answers ? sent.flatMap((request, index) => (request.type === type ? [answers[index] ?? null] : [])) : [];
    const text = (type: CallbackType) => () => javaList(of(type).map((value) => (value === null ? null : String(value))));
    return {
      isEmpty: () => !answers || sent.length === 0,
      getNameCallbacks: text('name'),
      getPasswordCallbacks: text('password'),
      getTextInputCallbacks: text('textInput'),
      getChoiceCallbacks: () => javaList(of('choice').map((value) => (Array.isArray(value) ? value : value === null ? null : [Number(value)]))),
      getConfirmationCallbacks: () => javaList(of('confirmation').map((value) => (value === null ? null : Number(value)))),
      getHiddenValueCallbacks: () => {
        const values: Record<string, unknown> = {};
        sent.forEach((request, index) => {
          if (request.type === 'hidden' && request.id) values[request.id] = answers?.[index] ?? request.value ?? null;
        });
        return javaMap(values);
      },
    };
  }

  legacyIdRepository() {
    const values = (user: unknown, attribute: unknown) => this.users[String(user)]?.[String(attribute)] ?? [];
    return {
      getAttribute: (user: unknown, attribute: unknown) => new JavaSet(values(user, attribute)),
      setAttribute: (user: unknown, attribute: unknown, list: unknown) => this.saveProfile(String(user), String(attribute), strings(list), true),
      addAttribute: (user: unknown, attribute: unknown, value: unknown) =>
        this.saveProfile(String(user), String(attribute), [...values(user, attribute), String(value)], true),
    };
  }

  nextIdRepository() {
    return {
      getIdentity: (user: unknown) => {
        const name = String(user);
        const pending: Record<string, string[]> = {};
        const current = (attribute: string) => pending[attribute] ?? this.users[name]?.[attribute] ?? [];
        return {
          exists: () => Object.hasOwn(this.users, name),
          getName: () => name,
          getUniversalId: () => `id=${name},ou=user,o=alpha,ou=services,ou=am-config`,
          getAttributeValues: (attribute: unknown) => javaList([...current(String(attribute))]),
          setAttribute: (attribute: unknown, list: unknown) => {
            pending[String(attribute)] = strings(list);
            this.saveProfile(name, String(attribute), pending[String(attribute)], false);
          },
          addAttribute: (attribute: unknown, value: unknown) => {
            pending[String(attribute)] = [...current(String(attribute)), ...strings(value)];
            this.saveProfile(name, String(attribute), pending[String(attribute)], false);
          },
          store: () => {
            if (!Object.hasOwn(this.users, name)) throw new Error(`IdentityUpdateException: ${name} does not exist`);
            for (const [attribute, list] of Object.entries(pending)) this.saveProfile(name, attribute, list, true);
          },
        };
      },
    };
  }

  run(code: string): NodeResult {
    const { engine, scenario } = this.options;
    const chosen: Chosen = { messages: {}, sessionProperties: {} };
    let picked: Chosen | undefined;
    const choose = () => {
      picked = { messages: {}, sessionProperties: {} };
      return picked;
    };
    const common = {
      logger: logger(engine, this.effects),
      httpClient: httpClient(engine, scenario.http, this.effects),
      requestHeaders: this.map(this.headers()),
      requestParameters: this.map(scenario.parameters),
      secrets: secrets(scenario.secrets ?? {}),
      realm: '/alpha',
      scriptName: 'Scripted Decision',
    };

    let bindings: Record<string, unknown>;
    let built: Chosen[] = [];
    const nextCallbacks: CallbackRequest[] = [];
    if (engine === 'legacy') {
      const classes: Record<string, unknown> = { ...javaClasses(this.random) };
      const Action = legacyAction(choose);
      classes['org.forgerock.openam.auth.node.api.Action'] = Action;
      for (const [name, type] of Object.entries(LEGACY_CALLBACKS)) classes[name] = callbackClass(type, type === 'textOutput' || type === 'confirmation');
      bindings = {
        ...common,
        ...javaPackages(classes),
        action: undefined,
        outcome: undefined,
        sharedState: this.stateBinding('shared'),
        transientState: this.stateBinding('transient'),
        nodeState: this.nodeState('legacy'),
        callbacks: this.legacyCallbacks(),
        idRepository: this.legacyIdRepository(),
      };
    } else {
      const builder = Object.fromEntries(
        Object.entries(requests).map(([type, make]) => [
          `${type === 'hidden' ? 'hiddenValue' : type}Callback`,
          (...args: unknown[]) => {
            nextCallbacks.push((make as (...values: unknown[]) => CallbackRequest)(...args));
          },
        ]),
      );
      const action = {
        goTo: (outcome: unknown) => {
          const choice = choose();
          choice.outcome = String(outcome);
          built = [choice];
          return chain({}, choice, {
            withIdentifiedUser: 'identifiedUser',
            withIdentifiedAgent: 'identifiedAgent',
            withMaxIdleTime: 'maxIdleTime',
            withMaxSessionTime: 'maxSessionTime',
          });
        },
      };
      bindings = {
        ...common,
        action,
        callbacksBuilder: builder,
        callbacks: this.nextCallbacks(),
        nodeState: this.nodeState('next'),
        idRepository: this.nextIdRepository(),
        requestCookies: javaMap(scenario.cookies),
        utils: utils(this.random),
      };
    }

    const execution = execute(code, bindings, engine === 'legacy' ? ['action', 'outcome'] : []);
    const result = (fields: Partial<NodeResult>): NodeResult => ({
      status: 'error',
      callbacks: [],
      writes: this.writes,
      profile: this.profile,
      messages: {},
      sessionProperties: {},
      ...this.effects,
      ...fields,
    });
    if (execution.error) return result({ error: execution.error });

    let final: Chosen | undefined;
    if (engine === 'legacy') {
      const { action, outcome } = execution.values as { action?: Record<symbol, Chosen>; outcome?: unknown };
      if (action && typeof action === 'object' && BUILT in action) final = action[BUILT];
      else if (action && typeof action === 'object' && 'build' in action) {
        return result({ error: { message: 'action is an ActionBuilder, not an Action. Call .build() at the end.' } });
      } else if (action !== undefined && action !== null) {
        return result({ error: { message: 'action must be built with Action.goTo(...).build() or Action.send(...).build().' } });
      } else if (outcome !== undefined && outcome !== null) final = { ...chosen, outcome: String(outcome) };
    } else if (nextCallbacks.length) {
      final = { messages: picked?.messages ?? {}, sessionProperties: picked?.sessionProperties ?? {}, callbacks: nextCallbacks };
    } else final = built[0];

    if (!final) return result({ error: { message: 'The script ended without choosing an outcome. AM stops the journey with an error.' } });
    if (final.callbacks?.length) {
      return result({ status: 'callbacks', callbacks: final.callbacks, messages: final.messages, sessionProperties: final.sessionProperties });
    }
    if (!scenario.outcomes.includes(final.outcome!)) {
      return result({ error: { message: `"${final.outcome}" is not one of the node's outcomes (${scenario.outcomes.join(', ')}).` } });
    }
    return result({ status: 'outcome', outcome: final.outcome, messages: final.messages, sessionProperties: final.sessionProperties });
  }
}

/** What the node left behind: the shared and transient state after the script ran. */
export function finalState(scenario: NodeScenario, result: NodeResult) {
  const shared = structuredClone(scenario.shared);
  const transient = structuredClone(scenario.transient);
  for (const write of result.writes) (write.state === 'shared' ? shared : transient)[write.key] = write.value;
  return { shared, transient };
}

export type Aspect = 'result' | 'callbacks' | 'state' | 'profile' | 'http' | 'logs' | 'messages';

/** What two runs of the same node did differently, aspect by aspect. */
export function differences(a: NodeResult, b: NodeResult): Aspect[] {
  const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y);
  const found: Aspect[] = [];
  if (a.status !== b.status || a.outcome !== b.outcome || Boolean(a.error) !== Boolean(b.error)) found.push('result');
  if (!same(a.callbacks, b.callbacks)) found.push('callbacks');
  if (!same(a.writes, b.writes)) found.push('state');
  if (!same(a.profile, b.profile)) found.push('profile');
  if (!same(a.http, b.http)) found.push('http');
  if (!same(a.logs, b.logs)) found.push('logs');
  if (!same([a.messages, a.sessionProperties], [b.messages, b.sessionProperties])) found.push('messages');
  return found;
}
