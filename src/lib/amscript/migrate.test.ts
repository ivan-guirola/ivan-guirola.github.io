import { describe, expect, it } from 'vitest';
import { migrate, RULES } from './migrate';
import { runNode, type NodeResult } from './node';
import { NODE_SAMPLES, TOKEN_SAMPLES, tokenScenario } from './samples';
import { runToken } from './token';

const rules = (code: string, context: 'node' | 'token' = 'node') => migrate(code, context).changes.map((change) => change.rule);
const converted = (code: string, context: 'node' | 'token' = 'node') => migrate(code, context).code.trim();
const importer = 'var fr = JavaImporter(org.forgerock.openam.auth.node.api.Action);\n';

function both(code: string, sample: (typeof NODE_SAMPLES)[number]): [NodeResult, NodeResult] {
  const run = (script: string, engine: 'legacy' | 'next') => {
    const first = runNode(script, engine, sample.scenario);
    return first.status === 'callbacks' ? runNode(script, engine, sample.scenario, sample.answers, first.callbacks) : first;
  };
  return [run(sample.code, 'legacy'), run(code, 'next')];
}

describe('the sample decision scripts', () => {
  for (const sample of NODE_SAMPLES) {
    it(`converts "${sample.title}" with no warnings and the same result`, () => {
      const migration = migrate(sample.code);
      expect(migration.warnings).toEqual([]);
      expect(migration.code).not.toMatch(/JavaImporter|sharedState|transientState|\.build\(\)|org\.forgerock|java\./);
      const [legacy, next] = both(migration.code, sample);
      expect(legacy.status).toBe('outcome');
      expect(next).toEqual(legacy);
    });
  }
});

describe('the sample access token scripts', () => {
  for (const sample of TOKEN_SAMPLES) {
    it(`converts "${sample.title}" with the same token for every grant`, () => {
      const migration = migrate(sample.code, 'token');
      expect(migration.warnings).toEqual([]);
      for (const grant of ['authorization_code', 'client_credentials', 'jwt_bearer'] as const) {
        if (sample.id === 'profile' && grant === 'client_credentials') continue;
        const scenario = tokenScenario(grant, 'bjensen', 1795161600);
        const legacy = runToken(sample.code, 'legacy', scenario);
        const next = runToken(migration.code, 'next', scenario);
        expect(legacy.status).toBe('issued');
        expect({ ...next, logs: [], jwt: '', response: {} }).toEqual({ ...legacy, logs: [], jwt: '', response: {} });
      }
    });
  }
});

it('shows where the engines differ: an empty attribute throws in legacy and is undefined in the new engine', () => {
  const sample = TOKEN_SAMPLES.find((item) => item.id === 'profile')!;
  const scenario = tokenScenario('client_credentials', 'bjensen', 1795161600);
  const legacy = runToken(sample.code, 'legacy', scenario);
  expect(legacy.status).toBe('error');
  expect(legacy.error!.message).toMatch(/NoSuchElementException/);
  expect(legacy.error!.line).toBe(4);
  const next = runToken(migrate(sample.code, 'token').code, 'next', scenario);
  expect(next.status).toBe('issued');
  expect(next.claims).not.toHaveProperty('phone');
});

describe('migrate', () => {
  it('turns Action.goTo().build() into action.goTo(), keeping the chained calls', () => {
    const code = `${importer}action = fr.Action.goTo("false").withErrorMessage(message).withStage("one").build();`;
    expect(converted(code)).toBe('action.goTo("false").withErrorMessage(message).withStage("one");');
    expect(rules(code)).toEqual(['importer', 'goTo']);
  });

  it('accepts the full package name of Action', () => {
    expect(converted('action = org.forgerock.openam.auth.node.api.Action.goTo("true").build();')).toBe('action.goTo("true");');
  });

  it('renames withIdentifiedIdentity and warns about its argument', () => {
    const migration = migrate(`${importer}action = fr.Action.goTo("true").withIdentifiedIdentity(user).build();`);
    expect(migration.code.trim()).toBe('action.goTo("true").withIdentifiedUser(user);');
    expect(migration.warnings[0].message).toMatch(/withIdentifiedUser/);
  });

  it('replaces the outcome variable with action.goTo()', () => {
    expect(converted('outcome = "true";')).toBe('action.goTo("true");');
    expect(rules('outcome = "true";')).toEqual(['outcome']);
  });

  it('reads answers by callback type, counting only callbacks of that type', () => {
    const code = `var fr = JavaImporter(org.forgerock.openam.auth.node.api.Action, javax.security.auth.callback.NameCallback,
  javax.security.auth.callback.PasswordCallback, com.sun.identity.authentication.callbacks.HiddenValueCallback);
if (callbacks.isEmpty()) {
  action = fr.Action.send(new fr.NameCallback("First"), new fr.PasswordCallback("Secret", false),
    new fr.NameCallback("Second"), new fr.HiddenValueCallback("deviceId", "")).build();
} else {
  var second = callbacks.get(2).getName();
  var secret = callbacks.get(1).getPassword();
  var device = callbacks.get(3).getValue();
}`;
    const output = converted(code);
    expect(output).toContain('callbacksBuilder.nameCallback("First");\n  callbacksBuilder.passwordCallback("Secret", false);');
    expect(output).toContain('callbacksBuilder.hiddenValueCallback("deviceId", "");');
    expect(output).toContain('var second = callbacks.getNameCallbacks().get(1);');
    expect(output).toContain('var secret = callbacks.getPasswordCallbacks().get(0);');
    expect(output).toContain('var device = callbacks.getHiddenValueCallbacks().get("deviceId");');
  });

  it('warns instead of guessing when it cannot tell which callback is read', () => {
    const migration = migrate(`var answer = callbacks.get(index).getName();`);
    expect(migration.code).toBe('var answer = callbacks.get(index).getName();');
    expect(migration.warnings[0]).toMatchObject({ side: 'before', line: 1, message: expect.stringMatching(/not a number/) });
    expect(migrate('var answer = callbacks.get(0).getName();').warnings[0].message).toMatch(/were not found/);
    const mismatch = `${importer}action = fr.Action.send(new javax.security.auth.callback.PasswordCallback("P", false)).build();
var name = callbacks.get(0).getName();`;
    expect(migrate(mismatch).warnings[0].message).toMatch(/not a name callback/);
  });

  it('leaves a send() alone when the callbacks are not created inline', () => {
    const migration = migrate(`${importer}action = fr.Action.send(list).build();`);
    expect(migration.code).toContain('fr.Action.send(list).build()');
    expect(migration.warnings.map((warning) => warning.message).join()).toMatch(/callbacksBuilder/);
  });

  it('maps sharedState and transientState to nodeState', () => {
    const code = 'sharedState.put("a", 1);\ntransientState.put("b", 2);\nvar c = sharedState.get("c");\ntransientState.remove("b");';
    expect(converted(code)).toBe('nodeState.putShared("a", 1);\nnodeState.putTransient("b", 2);\nvar c = nodeState.get("c");\nnodeState.remove("b");');
  });

  it('drops JsonValue conversions, including on variables', () => {
    const code = 'var user = nodeState.get("username");\nvar name = user.asString();\nvar attrs = nodeState.get("objectAttributes").asMap();\nvar none = user.isNull();';
    expect(converted(code)).toBe(
      'var user = nodeState.get("username");\nvar name = user;\nvar attrs = nodeState.getObject("objectAttributes");\nvar none = (user === null);',
    );
  });

  it('reads profile data from an identity and saves changes with store()', () => {
    const code = `var mail = idRepository.getAttribute(user, "mail");
var first = mail.iterator().next();
var second = mail.toArray()[1];
var count = mail.size();
var known = mail.contains("a@example.com");
if (!mail.isEmpty()) {
  idRepository.addAttribute(user, "mail", "b@example.com");
}
idRepository.setAttribute(user, "status", ["active"]);`;
    const output = converted(code);
    expect(output).toContain('var mail = idRepository.getIdentity(user).getAttributeValues("mail");');
    expect(output).toContain('var first = mail[0];');
    expect(output).toContain('var second = mail[1];');
    expect(output).toContain('var count = mail.length;');
    expect(output).toContain('var known = mail.includes("a@example.com");');
    expect(output).toContain('if (mail.length > 0) {\n  var identity = idRepository.getIdentity(user);\n  identity.addAttribute("mail", "b@example.com");\n  identity.store();\n}');
    expect(output).toContain('var identity2 = idRepository.getIdentity(user);\nidentity2.setAttribute("status", ["active"]);\nidentity2.store();');
  });

  it('warns that a set and a list print differently', () => {
    const migration = migrate('var text = idRepository.getAttribute(user, "mail").toString();');
    expect(migration.warnings[0].message).toMatch(/JSON\.stringify/);
  });

  it('moves the logger to SLF4J names', () => {
    const code = 'if (logger.messageEnabled()) logger.message("a {}", b);\nlogger.warning("w");\nlogger.error("e");\nlogger.errorEnabled();';
    expect(converted(code)).toBe('if (logger.isDebugEnabled()) logger.debug("a {}", b);\nlogger.warn("w");\nlogger.error("e");\nlogger.isErrorEnabled();');
  });

  it('folds a Request into fetch-style options and reads the response directly', () => {
    const code = `var request = new org.forgerock.http.protocol.Request();
request.setUri(url).setMethod("PUT");
request.getHeaders().put("X-Key", key);
request.setEntity("raw text");
var response = httpClient.send(request).getOrThrow();
if (response.getStatus() == org.forgerock.http.protocol.Status.CREATED) {
  var data = response.getEntity().getJson();
  var headers = response.getHeaders();
  var all = response.getEntity();
}`;
    const output = converted(code);
    expect(output).toContain('var requestOptions = {\n  method: "PUT",\n  headers: {\n    "X-Key": key\n  },\n  body: "raw text"\n};');
    expect(output).toContain('var response = httpClient.send(url, requestOptions).get();');
    expect(output).toContain('if (response.status == 201)');
    expect(output).toContain('var data = response.json();');
    expect(output).toContain('var headers = response.headers;');
    expect(output).toContain('var all = response.text();');
  });

  it('leaves a request that is set up later as it is, with a warning', () => {
    const migration = migrate('var request = new org.forgerock.http.protocol.Request();\nvar other = 1;\nrequest.setUri(url);');
    expect(migration.code).toContain('new org.forgerock.http.protocol.Request()');
    expect(migration.warnings.some((warning) => /not set up right after/.test(warning.message))).toBe(true);
  });

  it('uses utils.base64 instead of java.util.Base64', () => {
    const code = 'var a = java.util.Base64.getEncoder().encodeToString(new java.lang.String(text).getBytes());\nvar b = java.util.Base64.getDecoder().decode(a);';
    const migration = migrate(code);
    expect(migration.code).toBe('var a = utils.base64.encode(text);\nvar b = utils.base64.decode(a);');
    expect(migration.warnings[0].message).toMatch(/returns text/);
  });

  it('writes callback constants as numbers', () => {
    const code = 'var fr = JavaImporter(javax.security.auth.callback.TextOutputCallback);\nvar level = fr.TextOutputCallback.WARNING;';
    expect(converted(code)).toBe('var level = 1;');
  });

  it('turns java.lang.String() into plain JavaScript', () => {
    expect(converted('var a = java.lang.String(x);\nvar b = new java.lang.String(1 + 2);')).toBe('var a = x;\nvar b = String(1 + 2);');
  });

  it('reports Java classes it cannot replace', () => {
    const migration = migrate('var format = new java.text.SimpleDateFormat("yyyy");\nvar again = new java.text.SimpleDateFormat("MM");');
    expect(migration.warnings).toHaveLength(1);
    expect(migration.warnings[0]).toMatchObject({ side: 'after', line: 1, message: expect.stringMatching(/java\.text\.SimpleDateFormat is a Java class/) });
  });

  it('reports what is still read from a JavaImporter alias', () => {
    const migration = migrate('var fr = JavaImporter(java.text.SimpleDateFormat);\nvar f = new fr.SimpleDateFormat("yyyy");');
    expect(migration.warnings[0]).toMatchObject({ side: 'after', message: expect.stringMatching(/fr came from JavaImporter/) });
  });

  it('suggests requestCookies when the script parses the Cookie header', () => {
    const migration = migrate('var cookie = requestHeaders.get("Cookie").get(0);');
    expect(migration.warnings[0].message).toMatch(/requestCookies/);
    expect(migrate('var cookie = requestHeaders.get("Cookie");', 'token').warnings).toEqual([]);
  });

  it('returns the parse error for a script that is not valid JavaScript', () => {
    const migration = migrate('var = ;');
    expect(migration.error).toMatch(/Unexpected token/);
    expect(migration.code).toBe('var = ;');
  });

  it('has a title and an explanation for every kind of change', () => {
    for (const rule of Object.values(RULES)) {
      expect(rule.title).toBeTruthy();
      expect(rule.detail.length).toBeGreaterThan(30);
    }
  });
});

describe('migrate for access token scripts', () => {
  it('checks the identity with exists()', () => {
    expect(converted('if (identity !== null) a();', 'token')).toBe('if (identity.exists()) a();');
    expect(converted('if (identity == null) a();', 'token')).toBe('if (!identity.exists()) a();');
    expect(converted('if (!identity) a();', 'token')).toBe('if (!identity.exists()) a();');
    expect(converted('if (identity) { a(); }', 'token')).toBe('if (identity.exists()) { a(); }');
    expect(converted('var x = identity ? 1 : 2;', 'token')).toBe('var x = identity.exists() ? 1 : 2;');
  });

  it('reads attributes as lists and saves changes with store()', () => {
    expect(converted('var mail = identity.getAttribute("mail").iterator().next();', 'token')).toBe('var mail = identity.getAttributeValues("mail")[0];');
    expect(converted('identity.setAttribute("seen", ["yes"]);', 'token')).toBe('identity.setAttribute("seen", ["yes"]);\nidentity.store();');
  });

  it('treats scopes as a list', () => {
    expect(converted('var n = scopes.size();\nvar s = accessToken.getScope().toArray();', 'token')).toBe('var n = scopes.length;\nvar s = accessToken.getScope();');
    expect(rules('var n = scopes.size();', 'token')).toEqual(['scopes']);
  });

  it('removes JsonValue and supplier functions', () => {
    const code = `accessToken.addExtraJsonData("a", function () { return org.forgerock.json.JsonValue.json([1]); });
accessToken.addExtraData("b", () => "x");
accessToken.setPermissions(JsonValue.json("p"));`;
    expect(converted(code, 'token')).toBe('accessToken.addExtraJsonData("a", [1]);\naccessToken.addExtraData("b", "x");\naccessToken.setPermissions("p");');
  });

  it('does not touch decision-node bindings in token scripts', () => {
    expect(converted('sharedState.put("a", 1);\noutcome = "x";', 'token')).toBe('sharedState.put("a", 1);\noutcome = "x";');
  });
});
