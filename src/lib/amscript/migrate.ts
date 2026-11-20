import { parse, type Node } from 'acorn';

/**
 * Converts a legacy (Rhino) AM script into a next-generation one, following Ping's migration guide:
 * the Action class becomes the action binding, callbacks go through callbacksBuilder, sharedState and
 * transientState become nodeState, idRepository returns identities, httpClient takes fetch-style options,
 * and Java classes give way to bindings. Whatever it can't convert safely is reported, not guessed.
 */

export type Context = 'node' | 'token';

export type Rule =
  | 'importer'
  | 'goTo'
  | 'send'
  | 'callbackRead'
  | 'string'
  | 'state'
  | 'conversion'
  | 'identityRead'
  | 'identityWrite'
  | 'identityExists'
  | 'logger'
  | 'http'
  | 'base64'
  | 'constant'
  | 'outcome'
  | 'json'
  | 'scopes';

export interface Change {
  rule: Rule;
  line: number;
}

export interface Warning {
  /** Line in the legacy script ('before') or in the converted one ('after'). */
  side: 'before' | 'after';
  line: number;
  message: string;
}

export interface Migration {
  code: string;
  changes: Change[];
  warnings: Warning[];
  error?: string;
}

/** What each kind of change means, in the words of the migration guide. */
export const RULES: Record<Rule, { title: string; detail: string }> = {
  importer: {
    title: 'No JavaImporter',
    detail: 'Next-generation scripts cannot import Java classes. The bindings used below do the same work.',
  },
  goTo: {
    title: 'action.goTo() sets the outcome',
    detail: 'There is no Action class and no build(): call goTo() on the action binding, and chain withErrorMessage() and the rest after it.',
  },
  send: {
    title: 'callbacksBuilder asks for input',
    detail: 'Instead of creating callback objects and sending them with Action.send(), add each callback to callbacksBuilder. AM sends them when the script ends.',
  },
  callbackRead: {
    title: 'Answers are read by type',
    detail: 'callbacks.get(1).getPassword() becomes callbacks.getPasswordCallbacks().get(0): the answers are grouped by callback type, so the index counts only callbacks of that type.',
  },
  string: {
    title: 'No java.lang.String',
    detail: 'Answers and state values are already JavaScript strings, so there is nothing to convert.',
  },
  state: {
    title: 'nodeState replaces sharedState and transientState',
    detail: 'nodeState.putShared() and nodeState.putTransient() write to each state; nodeState.get() reads from either.',
  },
  conversion: {
    title: 'No asString() or asMap()',
    detail: 'nodeState.get() returns plain JavaScript values. For maps stored across states, use nodeState.getObject().',
  },
  identityRead: {
    title: 'Profile data comes from an identity',
    detail: 'idRepository.getIdentity() returns the identity, and getAttributeValues() returns an array: [0] replaces iterator().next(), length replaces size() and isEmpty(). An empty attribute now gives undefined where iterator().next() threw an error.',
  },
  identityWrite: {
    title: 'Changes are saved with store()',
    detail: 'setAttribute() and addAttribute() no longer save by themselves. store() saves them, and throws if the update fails.',
  },
  identityExists: {
    title: 'identity.exists() instead of null',
    detail: 'The identity binding is always present in next-generation scripts. Call exists() to know whether the resource owner is a known identity.',
  },
  logger: {
    title: 'The logger follows SLF4J',
    detail: 'message() becomes debug(), warning() becomes warn(), and messageEnabled() becomes isDebugEnabled().',
  },
  http: {
    title: 'httpClient takes a URL and options',
    detail: 'The request is a plain object with method, headers and body, as in fetch(). The response has status, text() and json() instead of getStatus() and getEntity().',
  },
  base64: {
    title: 'utils.base64 instead of java.util.Base64',
    detail: 'The utils binding encodes and decodes Base64 without allowlisting Java classes.',
  },
  constant: {
    title: 'Callback constants are numbers',
    detail: 'TextOutputCallback.INFORMATION and similar constants are not available, so their values are written out: 0 information, 1 warning, 2 error.',
  },
  outcome: {
    title: 'The outcome variable has no effect',
    detail: 'Next-generation scripts ignore outcome = "...". The outcome is set with action.goTo().',
  },
  json: {
    title: 'No JsonValue',
    detail: 'Methods that took a JsonValue now take plain JavaScript values and convert them.',
  },
  scopes: {
    title: 'Scopes are a list',
    detail: 'scopes and accessToken.getScope() return a list instead of a set, so values can be read directly.',
  },
};

interface AnyNode extends Node {
  [key: string]: any;
}

const CALLBACK_CLASSES: Record<string, string> = {
  'javax.security.auth.callback.NameCallback': 'name',
  'javax.security.auth.callback.PasswordCallback': 'password',
  'javax.security.auth.callback.TextInputCallback': 'textInput',
  'javax.security.auth.callback.TextOutputCallback': 'textOutput',
  'javax.security.auth.callback.ChoiceCallback': 'choice',
  'javax.security.auth.callback.ConfirmationCallback': 'confirmation',
  'com.sun.identity.authentication.callbacks.HiddenValueCallback': 'hidden',
  'com.sun.identity.authentication.callbacks.ScriptTextOutputCallback': 'scriptTextOutput',
};

const GETTERS: Record<string, { type: string; method: string }> = {
  getName: { type: 'name', method: 'getNameCallbacks' },
  getPassword: { type: 'password', method: 'getPasswordCallbacks' },
  getText: { type: 'textInput', method: 'getTextInputCallbacks' },
  getSelectedIndexes: { type: 'choice', method: 'getChoiceCallbacks' },
  getSelectedIndex: { type: 'confirmation', method: 'getConfirmationCallbacks' },
  getValue: { type: 'hidden', method: 'getHiddenValueCallbacks' },
};

const CONSTANTS: Record<string, number> = {
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

const STATUS_CODES: Record<string, number> = {
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INTERNAL_SERVER_ERROR: 500,
};

const LOGGER: Record<string, string> = {
  message: 'debug',
  warning: 'warn',
  messageEnabled: 'isDebugEnabled',
  warningEnabled: 'isWarnEnabled',
  errorEnabled: 'isErrorEnabled',
};

const JSON_CONVERSIONS = new Set(['asString', 'asBoolean', 'asInteger', 'asLong', 'asDouble', 'asList', 'getObject']);
const REQUEST = 'org.forgerock.http.protocol.Request';
const REMOVED = '\u0000removed';

const ROOTS = new Set(['org', 'java', 'javax', 'com', 'Packages']);

type Kind = 'set' | 'response' | 'json';

function children(node: AnyNode): AnyNode[] {
  const found: AnyNode[] = [];
  for (const [key, value] of Object.entries(node)) {
    if (key === 'loc' || key === 'start' || key === 'end' || key === 'type') continue;
    if (Array.isArray(value)) {
      for (const item of value) if (item && typeof item.type === 'string') found.push(item);
    } else if (value && typeof value === 'object' && typeof value.type === 'string') found.push(value);
  }
  return found.sort((a, b) => a.start - b.start);
}

function walk(node: AnyNode, visit: (node: AnyNode, parent?: AnyNode) => void, parent?: AnyNode) {
  visit(node, parent);
  for (const child of children(node)) walk(child, visit, node);
}

/** The dotted name of a member chain made of plain identifiers, such as org.forgerock.http.protocol.Request. */
function dotted(node: AnyNode): string | undefined {
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'MemberExpression' && !node.computed && node.property.type === 'Identifier') {
    const object = dotted(node.object);
    return object ? `${object}.${node.property.name}` : undefined;
  }
  return undefined;
}

const isCall = (node: AnyNode | undefined, method?: string): node is AnyNode =>
  node?.type === 'CallExpression' &&
  node.callee.type === 'MemberExpression' &&
  !node.callee.computed &&
  (method === undefined || node.callee.property.name === method);

const calledOn = (node: AnyNode, object: string, method?: string) => isCall(node, method) && dotted(node.callee.object) === object;

class Migrator {
  readonly aliases = new Map<string, Map<string, string>>();
  readonly kinds = new Map<string, Kind>();
  readonly changes: Change[] = [];
  readonly warnings: Warning[] = [];
  readonly names = new Set<string>();
  readonly consumed = new Set<AnyNode>();
  readonly requests = new Map<string, { options: string; url: string; statements: Set<AnyNode>; last: AnyNode }>();
  sent: string[] = [];
  sentNodes: AnyNode[] = [];

  constructor(
    readonly source: string,
    readonly context: Context,
    readonly ast: AnyNode,
  ) {}

  text(node: AnyNode) {
    return this.source.slice(node.start, node.end);
  }
  line(node: AnyNode) {
    return node.loc?.start.line ?? 1;
  }
  change(rule: Rule, node: AnyNode) {
    const line = this.line(node);
    if (!this.changes.some((change) => change.rule === rule && change.line === line)) this.changes.push({ rule, line });
  }
  warn(node: AnyNode, message: string) {
    const line = this.line(node);
    if (!this.warnings.some((warning) => warning.line === line && warning.message === message)) this.warnings.push({ side: 'before', line, message });
  }
  indent(node: AnyNode) {
    const start = this.source.lastIndexOf('\n', node.start - 1) + 1;
    return /^[ \t]*/.exec(this.source.slice(start, node.start))![0];
  }
  fresh(name: string) {
    let candidate = name;
    for (let index = 2; this.names.has(candidate); index++) candidate = `${name}${index}`;
    this.names.add(candidate);
    return candidate;
  }

  /** The Java class a node refers to, through a full package name or a JavaImporter alias. */
  classOf(node: AnyNode): string | undefined {
    const name = dotted(node);
    if (!name) return undefined;
    const [first, ...rest] = name.split('.');
    if (ROOTS.has(first)) return first === 'Packages' ? rest.join('.') : name;
    const imported = this.aliases.get(first);
    if (imported && rest.length >= 1) {
      const full = imported.get(rest[0]);
      if (full) return [full, ...rest.slice(1)].join('.');
    }
    return undefined;
  }

  prepare() {
    walk(this.ast, (node) => {
      if (node.type === 'Identifier') this.names.add(node.name);
      if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier' && node.init) {
        if (node.init.type === 'CallExpression' && node.init.callee.type === 'Identifier' && node.init.callee.name === 'JavaImporter') {
          const imported = new Map<string, string>();
          for (const argument of node.init.arguments) {
            const name = dotted(argument);
            if (name) imported.set(name.split('.').pop()!, name.replace(/^Packages\./, ''));
          }
          this.aliases.set(node.id.name, imported);
        }
      }
    });
    walk(this.ast, (node) => {
      const target = node.type === 'VariableDeclarator' ? node.id : node.type === 'AssignmentExpression' ? node.left : undefined;
      const value = node.type === 'VariableDeclarator' ? node.init : node.type === 'AssignmentExpression' ? node.right : undefined;
      if (target?.type !== 'Identifier' || !value) return;
      const kind = this.kindOf(value);
      if (kind) this.kinds.set(target.name, kind);
    });
    if (this.context === 'token') this.kinds.set('scopes', 'set');
    this.findSend();
    this.findRequests();
  }

  /** Whether an expression is a Java set, an HTTP response or a JsonValue, which change shape in the new engine. */
  kindOf(node: AnyNode): Kind | undefined {
    if (node.type === 'Identifier') return this.kinds.get(node.name);
    if (calledOn(node, 'idRepository', 'getAttribute')) return 'set';
    if (this.context === 'token' && (calledOn(node, 'identity', 'getAttribute') || calledOn(node, 'accessToken', 'getScope'))) return 'set';
    if (isCall(node, 'get') || isCall(node, 'getOrThrow') || isCall(node, 'getOrThrowUninterruptibly')) {
      if (calledOn(node.callee.object, 'httpClient', 'send')) return 'response';
    }
    if (calledOn(node, 'nodeState', 'get') || calledOn(node, 'nodeState', 'getObject')) return 'json';
    return undefined;
  }

  findSend() {
    walk(this.ast, (node) => {
      if (this.sentNodes.length || node.type !== 'CallExpression') return;
      if (isCall(node, 'send') && this.classOf(node.callee.object) === 'org.forgerock.openam.auth.node.api.Action') {
        this.sentNodes = node.arguments;
        this.sent = node.arguments.map((argument: AnyNode) =>
          argument.type === 'NewExpression' ? (CALLBACK_CLASSES[this.classOf(argument.callee) ?? ''] ?? '?') : '?',
        );
      }
    });
  }

  /** Finds new Request() and the statements that configure it, to fold them into one options object. */
  findRequests() {
    const visitBody = (body: AnyNode[]) => {
      body.forEach((statement, index) => {
        if (statement.type !== 'VariableDeclaration' || statement.declarations.length !== 1) return;
        const declarator = statement.declarations[0];
        if (declarator.id.type !== 'Identifier' || declarator.init?.type !== 'NewExpression') return;
        if (this.classOf(declarator.init.callee) !== REQUEST) return;
        const name = declarator.id.name;
        const settings: { uri?: string; method?: string; headers: [string, string][]; body?: string } = { headers: [] };
        const statements = new Set<AnyNode>([statement]);
        let last = statement;
        for (const next of body.slice(index + 1)) {
          if (next.type !== 'ExpressionStatement' || !this.collectSettings(next.expression, name, settings)) break;
          statements.add(next);
          last = next;
        }
        if (!settings.uri) {
          this.warn(statement, `The request in ${name} is not set up right after it is created, so it was left as it is. Rewrite it as httpClient.send(url, options).`);
          return;
        }
        const pad = this.indent(last);
        const lines = [`method: ${settings.method ?? '"GET"'}`];
        if (settings.headers.length) {
          lines.push(`headers: {\n${settings.headers.map(([key, value]) => `${pad}    ${key}: ${value}`).join(',\n')}\n${pad}  }`);
        }
        if (settings.body) lines.push(`body: ${settings.body.replace(/\n/g, '\n  ')}`);
        const options = this.fresh(`${name}Options`);
        this.requests.set(name, {
          options: `var ${options} = {\n${lines.map((line) => `${pad}  ${line}`).join(',\n')}\n${pad}};`,
          url: settings.uri,
          statements,
          last,
        });
        this.requestOptions.set(name, options);
      });
    };
    walk(this.ast, (node) => {
      if (node.type === 'Program' || node.type === 'BlockStatement') visitBody(node.body);
    });
  }
  readonly requestOptions = new Map<string, string>();

  collectSettings(expression: AnyNode, name: string, settings: { uri?: string; method?: string; headers: [string, string][]; body?: string }): boolean {
    if (expression.type === 'Identifier') return expression.name === name;
    if (!isCall(expression)) return false;
    const method = expression.callee.property.name;
    const args: AnyNode[] = expression.arguments;
    const object: AnyNode = expression.callee.object;
    if ((method === 'add' || method === 'put') && isCall(object, 'getHeaders') && args.length === 2) {
      if (!this.collectSettings(object.callee.object, name, settings)) return false;
      const key = args[0].type === 'Literal' ? JSON.stringify(String(args[0].value)) : `[${this.emit(args[0])}]`;
      const value = args[1].type === 'Literal' && typeof args[1].value === 'string' ? JSON.stringify(args[1].value.replace(/;\s*$/, '')) : this.emit(args[1]);
      settings.headers.push([key, value]);
      return true;
    }
    if (!this.collectSettings(object, name, settings) || args.length !== 1) return false;
    if (method === 'setUri') settings.uri = this.emit(args[0]);
    else if (method === 'setMethod') settings.method = this.emit(args[0]);
    else if (method === 'setEntity') {
      const value = args[0];
      settings.body = calledOn(value, 'JSON', 'stringify') && value.arguments.length === 1 ? this.emit(value.arguments[0]) : this.emit(value);
    } else return false;
    return true;
  }

  /** Re-creates the source of a node, with every converted part replaced. */
  emit(node: AnyNode): string {
    const replaced = this.convert(node);
    return replaced !== undefined ? replaced : this.splice(node);
  }

  /** The node's own source with its children emitted, without converting the node itself. */
  splice(node: AnyNode): string {
    let output = '';
    let cursor = node.start;
    for (const child of children(node)) {
      output += this.source.slice(cursor, child.start);
      const text = this.emit(child);
      if (text === REMOVED) {
        output = output.replace(/[ \t]*$/, '');
        cursor = child.end;
        const rest = /^[ \t]*;?[ \t]*\r?\n?/.exec(this.source.slice(cursor))![0];
        cursor += rest.length;
      } else {
        output += text;
        cursor = child.end;
      }
    }
    return output + this.source.slice(cursor, node.end);
  }

  convert(node: AnyNode): string | undefined {
    switch (node.type) {
      case 'VariableDeclaration':
        return this.declaration(node);
      case 'ExpressionStatement':
        return this.statement(node);
      case 'AssignmentExpression':
        return this.assignment(node);
      case 'CallExpression':
        return this.call(node);
      case 'NewExpression':
        return this.construct(node);
      case 'MemberExpression':
        return this.member(node);
      case 'BinaryExpression':
        return this.binary(node);
      case 'UnaryExpression':
        return this.unary(node);
      case 'IfStatement':
      case 'ConditionalExpression':
        return this.test(node);
      default:
        return undefined;
    }
  }

  declaration(node: AnyNode): string | undefined {
    if (node.declarations.length !== 1) return undefined;
    const declarator = node.declarations[0];
    if (declarator.init?.type === 'CallExpression' && declarator.init.callee.type === 'Identifier' && declarator.init.callee.name === 'JavaImporter') {
      this.change('importer', node);
      return REMOVED;
    }
    return this.requestStatement(node);
  }

  requestStatement(node: AnyNode): string | undefined {
    for (const request of this.requests.values()) {
      if (!request.statements.has(node)) continue;
      if (node !== request.last) return REMOVED;
      this.change('http', node);
      return request.options;
    }
    return undefined;
  }

  statement(node: AnyNode): string | undefined {
    const request = this.requestStatement(node);
    if (request !== undefined) return request;
    const expression = node.expression;
    const pad = this.indent(node);

    if (expression.type === 'AssignmentExpression' && expression.left.type === 'Identifier' && expression.left.name === 'action') {
      const sent = this.sendCallbacks(expression.right, pad);
      if (sent !== undefined) return sent;
    }

    const repository = this.context === 'node' && (calledOn(expression, 'idRepository', 'setAttribute') || calledOn(expression, 'idRepository', 'addAttribute'));
    if (repository) {
      const [user, ...rest] = expression.arguments.map((argument: AnyNode) => this.emit(argument));
      const identity = this.fresh('identity');
      this.change('identityWrite', node);
      return [
        `var ${identity} = idRepository.getIdentity(${user});`,
        `${pad}${identity}.${expression.callee.property.name}(${rest.join(', ')});`,
        `${pad}${identity}.store();`,
      ].join('\n');
    }
    if (this.context === 'token' && (calledOn(expression, 'identity', 'setAttribute') || calledOn(expression, 'identity', 'addAttribute'))) {
      this.change('identityWrite', node);
      return `${this.splice(node)}\n${pad}identity.store();`;
    }
    return undefined;
  }

  /** action = Action.send(new NameCallback(...), ...).build() becomes one callbacksBuilder call per callback. */
  sendCallbacks(value: AnyNode, pad: string): string | undefined {
    if (!isCall(value, 'build') || !isCall(value.callee.object, 'send')) return undefined;
    const send = value.callee.object;
    if (this.classOf(send.callee.object) !== 'org.forgerock.openam.auth.node.api.Action') return undefined;
    const lines: string[] = [];
    for (const argument of send.arguments) {
      const type = argument.type === 'NewExpression' ? CALLBACK_CLASSES[this.classOf(argument.callee) ?? ''] : undefined;
      if (!type) {
        this.warn(argument, 'This callback is not created with new ...Callback(...) inside Action.send(), so it was left as it is. Add it with callbacksBuilder.');
        return undefined;
      }
      lines.push(`callbacksBuilder.${type === 'hidden' ? 'hiddenValue' : type}Callback(${argument.arguments.map((item: AnyNode) => this.emit(item)).join(', ')});`);
    }
    this.change('send', value);
    return lines.join(`\n${pad}`);
  }

  assignment(node: AnyNode): string | undefined {
    if (node.left.type !== 'Identifier') return undefined;
    if (node.left.name === 'action') {
      const chain = this.goTo(node.right);
      if (chain !== undefined) return chain;
    }
    if (node.left.name === 'outcome' && this.context === 'node') {
      this.change('outcome', node);
      return `action.goTo(${this.emit(node.right)})`;
    }
    return undefined;
  }

  /** Action.goTo("x").withErrorMessage(m).build() becomes action.goTo("x").withErrorMessage(m). */
  goTo(value: AnyNode): string | undefined {
    if (!isCall(value, 'build')) return undefined;
    const calls: AnyNode[] = [];
    let current: AnyNode = value.callee.object;
    while (isCall(current) && current.callee.property.name !== 'goTo') {
      calls.unshift(current);
      current = current.callee.object;
    }
    if (!isCall(current, 'goTo') || this.classOf(current.callee.object) !== 'org.forgerock.openam.auth.node.api.Action') return undefined;
    this.change('goTo', value);
    const args = (call: AnyNode) => call.arguments.map((argument: AnyNode) => this.emit(argument)).join(', ');
    let output = `action.goTo(${args(current)})`;
    for (const call of calls) {
      let method = call.callee.property.name;
      if (method === 'withIdentifiedIdentity') {
        method = 'withIdentifiedUser';
        this.warn(call, 'withIdentifiedIdentity() became withIdentifiedUser(), which takes the username. Use withIdentifiedAgent() for an agent.');
      }
      output += `.${method}(${args(call)})`;
    }
    return output;
  }

  call(node: AnyNode): string | undefined {
    const callee = node.callee;
    const args: AnyNode[] = node.arguments;

    // java.lang.String(x), fr.String(x)
    if (this.classOf(callee) === 'java.lang.String' && args.length === 1) return this.javaString(node, args[0]);

    // java.util.Base64.getEncoder().encodeToString(...)
    if (isCall(node, 'encodeToString') && isCall(callee.object, 'getEncoder') && this.classOf(callee.object.callee.object) === 'java.util.Base64') {
      const bytes = args[0];
      if (isCall(bytes, 'getBytes')) {
        const text = bytes.callee.object;
        const inner = (text.type === 'NewExpression' || text.type === 'CallExpression') && this.classOf(text.callee) === 'java.lang.String' ? text.arguments[0] : text;
        this.change('base64', node);
        return `utils.base64.encode(${this.emit(inner)})`;
      }
    }
    if (isCall(node, 'decode') && isCall(callee.object, 'getDecoder') && this.classOf(callee.object.callee.object) === 'java.util.Base64') {
      this.change('base64', node);
      this.warn(node, 'utils.base64.decode() returns text, while java.util.Base64 returned bytes. Check how the result is used.');
      return `utils.base64.decode(${args.map((argument) => this.emit(argument)).join(', ')})`;
    }

    if (callee.type !== 'MemberExpression' || callee.computed) return undefined;
    const method: string = callee.property.name;
    const object: AnyNode = callee.object;
    const on = dotted(object);

    // callbacks.get(1).getPassword()
    if (GETTERS[method] && isCall(object, 'get') && dotted(object.callee.object) === 'callbacks' && this.context === 'node') {
      return this.callbackRead(node, method, object.arguments[0]);
    }

    if ((on === 'sharedState' || on === 'transientState') && this.context === 'node') {
      const renamed: Record<string, string> = {
        get: 'get',
        put: on === 'sharedState' ? 'putShared' : 'putTransient',
        remove: 'remove',
        keys: 'keys',
        isDefined: 'isDefined',
      };
      if (renamed[method]) {
        this.change('state', node);
        return `nodeState.${renamed[method]}(${args.map((argument) => this.emit(argument)).join(', ')})`;
      }
    }

    if (on === 'logger' && LOGGER[method]) {
      this.change('logger', node);
      return `logger.${LOGGER[method]}(${args.map((argument) => this.emit(argument)).join(', ')})`;
    }

    if (on === 'idRepository' && method === 'getAttribute' && this.context === 'node' && args.length === 2) {
      this.change('identityRead', node);
      return `idRepository.getIdentity(${this.emit(args[0])}).getAttributeValues(${this.emit(args[1])})`;
    }
    if (on === 'identity' && this.context === 'token') {
      if (method === 'getAttribute') {
        this.change('identityRead', node);
        return `identity.getAttributeValues(${args.map((argument) => this.emit(argument)).join(', ')})`;
      }
    }

    // accessToken.addExtraJsonData("key", function () { return value; })
    if (on === 'accessToken' && (method === 'addExtraData' || method === 'addExtraJsonData') && args.length === 2) {
      const supplied = this.supplied(args[1]);
      if (supplied) {
        this.change('json', node);
        return `accessToken.${method}(${this.emit(args[0])}, ${this.emit(supplied)})`;
      }
    }

    // httpClient.send(request)
    if (on === 'httpClient' && method === 'send' && args.length === 1 && args[0].type === 'Identifier') {
      const request = this.requests.get(args[0].name);
      if (request) return `httpClient.send(${request.url}, ${this.requestOptions.get(args[0].name)})`;
    }
    if ((method === 'getOrThrow' || method === 'getOrThrowUninterruptibly') && calledOn(object, 'httpClient', 'send')) {
      this.change('http', node);
      return `${this.emit(object)}.get()`;
    }

    // JsonValue.json(x)
    if (this.classOf(object) === 'org.forgerock.json.JsonValue' || on === 'JsonValue') {
      if (method === 'json' && args.length === 1) {
        this.change('json', node);
        return this.emit(args[0]);
      }
    }

    const kind = this.kindOf(object);
    if (kind === 'set') return this.setCall(node, method, object, args);
    if (kind === 'json') return this.jsonCall(node, method, object);
    if (kind === 'response') return this.responseCall(node, method, object);
    if (method === 'getString' || method === 'getJson') {
      if (isCall(object, 'getEntity') && this.kindOf(object.callee.object) === 'response') {
        this.change('http', node);
        return `${this.emit(object.callee.object)}.${method === 'getString' ? 'text' : 'json'}()`;
      }
    }
    if (method === 'getCode' && isCall(object, 'getStatus') && this.kindOf(object.callee.object) === 'response') {
      this.change('http', node);
      return `${this.emit(object.callee.object)}.status`;
    }
    if (method === 'next' && isCall(object, 'iterator') && this.kindOf(object.callee.object) === 'set') {
      this.change(this.context === 'token' && dotted(object.callee.object) === 'scopes' ? 'scopes' : 'identityRead', node);
      return `${this.emit(object.callee.object)}[0]`;
    }
    return undefined;
  }

  /** The value a supplier function returns, when the function does nothing else. */
  supplied(node: AnyNode): AnyNode | undefined {
    if (node.type === 'ArrowFunctionExpression' && node.expression) return node.body;
    if ((node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') && node.body.body?.length === 1) {
      const statement = node.body.body[0];
      if (statement.type === 'ReturnStatement' && statement.argument) return statement.argument;
    }
    return undefined;
  }

  javaString(node: AnyNode, value: AnyNode) {
    this.change('string', node);
    if (isCall(value) && GETTERS[value.callee.property.name]) return this.emit(value);
    if (value.type === 'Identifier' || value.type === 'Literal') return this.emit(value);
    return `String(${this.emit(value)})`;
  }

  callbackRead(node: AnyNode, method: string, index: AnyNode | undefined): string | undefined {
    const getter = GETTERS[method];
    if (index?.type !== 'Literal' || typeof index.value !== 'number') {
      this.warn(node, `The callback index is not a number, so it was left as it is. Read it with callbacks.${getter.method}().`);
      return undefined;
    }
    const position = index.value;
    if (!this.sent.length) {
      this.warn(node, 'The callbacks this node sends were not found in the script, so this answer was left as it is.');
      return undefined;
    }
    if (this.sent[position] !== getter.type) {
      this.warn(node, `Callback ${position} is not a ${getter.type} callback, so this answer was left as it is.`);
      return undefined;
    }
    this.change('callbackRead', node);
    if (getter.type === 'hidden') {
      const id = this.sentNodes[position]?.arguments?.[0];
      return `callbacks.${getter.method}().get(${id ? this.emit(id) : '""'})`;
    }
    const nth = this.sent.slice(0, position).filter((type) => type === getter.type).length;
    return `callbacks.${getter.method}().get(${nth})`;
  }

  setCall(node: AnyNode, method: string, object: AnyNode, args: AnyNode[]): string | undefined {
    const rule: Rule = this.context === 'token' && (dotted(object) === 'scopes' || calledOn(object, 'accessToken', 'getScope')) ? 'scopes' : 'identityRead';
    const base = () => this.emit(object);
    switch (method) {
      case 'size':
        this.change(rule, node);
        return `${base()}.length`;
      case 'isEmpty':
        this.change(rule, node);
        return `${base()}.length === 0`;
      case 'contains':
        this.change(rule, node);
        return `${base()}.includes(${args.map((argument) => this.emit(argument)).join(', ')})`;
      case 'toArray':
        this.change(rule, node);
        return base();
      case 'toString':
        this.warn(node, 'A Java set printed as [a, b]; the list prints as a,b. Use JSON.stringify() if the format matters.');
        return undefined;
      default:
        return undefined;
    }
  }

  jsonCall(node: AnyNode, method: string, object: AnyNode): string | undefined {
    if (JSON_CONVERSIONS.has(method)) {
      this.change('conversion', node);
      return this.emit(object);
    }
    if (method === 'asMap') {
      this.change('conversion', node);
      if (calledOn(object, 'nodeState', 'get')) return `nodeState.getObject(${object.arguments.map((argument: AnyNode) => this.emit(argument)).join(', ')})`;
      return this.emit(object);
    }
    if (method === 'isNull') {
      this.change('conversion', node);
      return `(${this.emit(object)} === null)`;
    }
    return undefined;
  }

  responseCall(node: AnyNode, method: string, object: AnyNode): string | undefined {
    if (method === 'getStatus') {
      this.change('http', node);
      return `${this.emit(object)}.status`;
    }
    if (method === 'getEntity') {
      this.change('http', node);
      return `${this.emit(object)}.text()`;
    }
    if (method === 'getHeaders') {
      this.change('http', node);
      return `${this.emit(object)}.headers`;
    }
    return undefined;
  }

  construct(node: AnyNode): string | undefined {
    if (this.classOf(node.callee) === 'java.lang.String' && node.arguments.length === 1) return this.javaString(node, node.arguments[0]);
    return undefined;
  }

  member(node: AnyNode): string | undefined {
    if (node.computed) {
      // set.toArray()[1]
      if (isCall(node.object, 'toArray') && this.kindOf(node.object.callee.object) === 'set') {
        this.change('identityRead', node);
        return `${this.emit(node.object.callee.object)}[${this.emit(node.property)}]`;
      }
      return undefined;
    }
    const name = this.classOf(node);
    if (name) {
      const [owner, constant] = [name.slice(0, name.lastIndexOf('.')), name.slice(name.lastIndexOf('.') + 1)];
      if (CALLBACK_CLASSES[owner] && constant in CONSTANTS) {
        this.change('constant', node);
        return String(CONSTANTS[constant]);
      }
    }
    return undefined;
  }

  binary(node: AnyNode): string | undefined {
    if (!['==', '===', '!=', '!=='].includes(node.operator)) return undefined;
    // response.getStatus() === Status.CREATED
    for (const [left, right] of [
      [node.left, node.right],
      [node.right, node.left],
    ]) {
      const status = this.classOf(right);
      if (isCall(left, 'getStatus') && this.kindOf(left.callee.object) === 'response' && status?.startsWith('org.forgerock.http.protocol.Status.')) {
        const code = STATUS_CODES[status.split('.').pop()!];
        if (code) {
          this.change('http', node);
          return `${this.emit(left.callee.object)}.status ${node.operator} ${code}`;
        }
      }
    }
    // identity != null in access token scripts
    if (this.context === 'token') {
      const sides = [node.left, node.right];
      const identity = sides.find((side) => side.type === 'Identifier' && side.name === 'identity');
      const nothing = sides.find((side) => (side.type === 'Literal' && side.value === null) || (side.type === 'Identifier' && side.name === 'undefined'));
      if (identity && nothing) {
        this.change('identityExists', node);
        return node.operator.startsWith('!') ? 'identity.exists()' : '!identity.exists()';
      }
    }
    return undefined;
  }

  unary(node: AnyNode): string | undefined {
    if (node.operator !== '!') return undefined;
    const argument = node.argument;
    if (isCall(argument, 'isEmpty') && this.kindOf(argument.callee.object) === 'set') {
      this.change('identityRead', node);
      return `${this.emit(argument.callee.object)}.length > 0`;
    }
    if (this.context === 'token' && argument.type === 'Identifier' && argument.name === 'identity') {
      this.change('identityExists', node);
      return '!identity.exists()';
    }
    return undefined;
  }

  /** if (identity) and identity ? a : b in access token scripts. */
  test(node: AnyNode): string | undefined {
    if (this.context !== 'token' || node.test.type !== 'Identifier' || node.test.name !== 'identity') return undefined;
    this.change('identityExists', node);
    const replaced = this.splice(node);
    const offset = node.test.start - node.start;
    return `${replaced.slice(0, offset)}identity.exists()${replaced.slice(offset + 'identity'.length)}`;
  }

  /** Java classes still in the converted script, which the new engine can't load. */
  leftovers(code: string) {
    let ast: AnyNode;
    try {
      ast = parse(code, { ecmaVersion: 'latest', allowReturnOutsideFunction: true, locations: true }) as AnyNode;
    } catch (error) {
      return;
    }
    const after = new Migrator(code, this.context, ast);
    after.prepare();
    const reported = new Set<string>();
    walk(ast, (node, parent) => {
      if (parent?.type === 'MemberExpression' && parent.object === node) return;
      if (node.type !== 'MemberExpression' && node.type !== 'Identifier') return;
      const name = after.classOf(node);
      if (!name || reported.has(name)) return;
      reported.add(name);
      this.warnings.push({
        side: 'after',
        line: node.loc?.start.line ?? 1,
        message: `${name} is a Java class. Next-generation scripts can't use Java classes: look for a binding that does the same, or move the code to a library script.`,
      });
    });
    for (const [alias] of this.aliases) {
      if (after.names.has(alias) && !this.warnings.some((warning) => warning.message.includes(`${alias}.`))) {
        const line = code.split('\n').findIndex((text) => new RegExp(`\\b${alias}\\.`).test(text)) + 1;
        if (line > 0) this.warnings.push({ side: 'after', line, message: `${alias} came from JavaImporter, which next-generation scripts don't have. Replace what is still read from it.` });
      }
    }
    if (/\brequestHeaders\.get\(\s*["']Cookie["']\s*\)/.test(code) && this.context === 'node') {
      const line = code.split('\n').findIndex((text) => /requestHeaders\.get\(\s*["']Cookie["']\s*\)/.test(text)) + 1;
      this.warnings.push({ side: 'after', line, message: 'Next-generation scripts can read cookies directly with requestCookies, without parsing the Cookie header.' });
    }
  }
}

export function migrate(source: string, context: Context = 'node'): Migration {
  let ast: AnyNode;
  try {
    ast = parse(source, { ecmaVersion: 'latest', allowReturnOutsideFunction: true, locations: true }) as AnyNode;
  } catch (error) {
    return { code: source, changes: [], warnings: [], error: (error as Error).message };
  }
  const migrator = new Migrator(source, context, ast);
  migrator.prepare();
  const code = migrator.emit(ast).replace(/^[ \t]*\r?\n/, '');
  migrator.leftovers(code);
  migrator.changes.sort((a, b) => a.line - b.line);
  migrator.warnings.sort((a, b) => (a.side === b.side ? a.line - b.line : a.side === 'before' ? -1 : 1));
  return { code, changes: migrator.changes, warnings: migrator.warnings };
}
