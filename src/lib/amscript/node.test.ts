import { describe, expect, it } from 'vitest';
import { execute, httpClient, newEffects, utils } from './common';
import { CharArray, JavaSet, JsonValue, javaList, javaMap, javaString, plain } from './java';
import { differences, emptyScenario, finalState, runNode, type NodeScenario } from './node';

const scenario = (fields: Partial<NodeScenario> = {}): NodeScenario => ({ ...emptyScenario(), ...fields });
const legacy = 'var fr = JavaImporter(org.forgerock.openam.auth.node.api.Action);\n';

describe('runNode with the legacy engine', () => {
  it('needs build() at the end of the action', () => {
    expect(runNode(`${legacy}action = fr.Action.goTo("true");`, 'legacy', scenario()).error!.message).toMatch(/Call \.build\(\)/);
    expect(runNode('action = "true";', 'legacy', scenario()).error!.message).toMatch(/must be built/);
  });

  it('still honours the outcome variable', () => {
    expect(runNode('outcome = "false";', 'legacy', scenario())).toMatchObject({ status: 'outcome', outcome: 'false' });
  });

  it('turns a password into a char array, which String() does not join', () => {
    const code = `var fr = JavaImporter(org.forgerock.openam.auth.node.api.Action, javax.security.auth.callback.PasswordCallback, java.lang.String);
if (callbacks.isEmpty()) {
  action = fr.Action.send(new fr.PasswordCallback("Password", false)).build();
} else {
  sharedState.put("wrong", String(callbacks.get(0).getPassword()));
  sharedState.put("right", fr.String(callbacks.get(0).getPassword()));
  action = fr.Action.goTo("true").build();
}`;
    const first = runNode(code, 'legacy', scenario());
    expect(first).toMatchObject({ status: 'callbacks', callbacks: [{ type: 'password', prompt: 'Password', echoOn: false }] });
    const second = runNode(code, 'legacy', scenario(), ['s3cret'], first.callbacks);
    expect(finalState(scenario(), second).shared).toEqual({ wrong: '[C@6d06d69c', right: 's3cret' });
  });

  it('returns JsonValue from nodeState and plain values from sharedState', () => {
    const code = `${legacy}var a = nodeState.get("name");
sharedState.put("same", a === "Ana");
sharedState.put("text", a.asString() === "Ana");
sharedState.put("raw", sharedState.get("name") === "Ana");
sharedState.put("missing", nodeState.get("nothing") === null);
action = fr.Action.goTo("true").build();`;
    const result = runNode(code, 'legacy', scenario({ shared: { name: 'Ana' } }));
    expect(finalState(scenario(), result).shared).toMatchObject({ same: false, text: true, raw: true, missing: true });
  });

  it('saves profile changes straight away', () => {
    const code = `${legacy}idRepository.setAttribute("ana", "status", ["active"]);
idRepository.addAttribute("ana", "mail", "b@example.com");
action = fr.Action.goTo("true").build();`;
    const result = runNode(code, 'legacy', scenario({ users: { ana: { mail: ['a@example.com'] } } }));
    expect(result.profile).toEqual([
      { user: 'ana', attribute: 'status', values: ['active'], saved: true },
      { user: 'ana', attribute: 'mail', values: ['a@example.com', 'b@example.com'], saved: true },
    ]);
  });

  it('reads cookies only from the Cookie header', () => {
    const code = `${legacy}sharedState.put("cookie", requestHeaders.get("Cookie").get(0));
action = fr.Action.goTo(typeof requestCookies === "undefined" ? "true" : "false").build();`;
    const result = runNode(code, 'legacy', scenario({ cookies: { amlbcookie: '01', lang: 'es' } }));
    expect(result.outcome).toBe('true');
    expect(result.writes[0].value).toBe('amlbcookie=01; lang=es');
  });

  it('explains when a Java class is not available', () => {
    const result = runNode('var f = new java.text.SimpleDateFormat("yyyy");', 'legacy', scenario());
    expect(result).toMatchObject({ status: 'error', error: { message: expect.stringMatching(/java\.text\.SimpleDateFormat is not one of/), line: 1 } });
  });

  it('records session properties and messages set on the action', () => {
    const code = `${legacy}action = fr.Action.goTo("false").withErrorMessage("No").putSessionProperty("a", "1").putSessionProperty("b", "2").removeSessionProperty("b").withStage("S").build();`;
    expect(runNode(code, 'legacy', scenario())).toMatchObject({ messages: { errorMessage: 'No', stage: 'S' }, sessionProperties: { a: '1' } });
  });

  it('reads every kind of answer', () => {
    const code = `var fr = JavaImporter(org.forgerock.openam.auth.node.api.Action,
  javax.security.auth.callback.TextInputCallback, javax.security.auth.callback.ConfirmationCallback,
  com.sun.identity.authentication.callbacks.HiddenValueCallback, com.sun.identity.authentication.callbacks.ScriptTextOutputCallback);
if (callbacks.isEmpty()) {
  action = fr.Action.send(new fr.TextInputCallback("Code", "000"), new fr.ConfirmationCallback("Sure?", fr.ConfirmationCallback.INFORMATION, fr.ConfirmationCallback.YES_NO_OPTION, 1),
    new fr.HiddenValueCallback("device", "x"), new fr.ScriptTextOutputCallback("console.log(1)")).build();
} else {
  sharedState.put("code", callbacks.get(0).getText());
  sharedState.put("sure", callbacks.get(1).getSelectedIndex());
  sharedState.put("device", callbacks.get(2).getValue());
  action = fr.Action.goTo("true").build();
}`;
    const first = runNode(code, 'legacy', scenario());
    expect(first.callbacks).toEqual([
      { type: 'textInput', prompt: 'Code', defaultValue: '000' },
      { type: 'confirmation', prompt: 'Sure?', messageType: 0, choices: ['Yes', 'No'], defaultChoice: 1 },
      { type: 'hidden', id: 'device', value: 'x' },
      { type: 'scriptTextOutput', message: 'console.log(1)' },
    ]);
    const second = runNode(code, 'legacy', scenario(), ['123', 0, 'abc', null], first.callbacks);
    expect(finalState(scenario(), second).shared).toEqual({ code: '123', sure: 0, device: 'abc' });
  });
});

describe('runNode with the next-generation engine', () => {
  it('has no sharedState, transientState or Java classes', () => {
    expect(runNode('sharedState.put("a", 1);', 'next', scenario()).error!.message).toMatch(/sharedState is not defined/);
    expect(runNode('var fr = JavaImporter(org.forgerock.openam.auth.node.api.Action);', 'next', scenario()).error!.message).toMatch(/JavaImporter is not defined/);
  });

  it('ignores the outcome variable', () => {
    expect(runNode('outcome = "true";', 'next', scenario()).error!.message).toMatch(/without choosing an outcome/);
  });

  it('rejects an outcome the node does not have', () => {
    expect(runNode('action.goTo("maybe");', 'next', scenario()).error!.message).toMatch(/"maybe" is not one of the node's outcomes \(true, false\)/);
  });

  it('sends callbacks instead of following an outcome', () => {
    const result = runNode('callbacksBuilder.nameCallback("Name");\naction.goTo("true");', 'next', scenario());
    expect(result).toMatchObject({ status: 'callbacks', callbacks: [{ type: 'name', prompt: 'Name' }] });
  });

  it('keeps profile changes unsaved until store()', () => {
    const users = { ana: { mail: ['a@example.com'] } };
    const unsaved = runNode('var id = idRepository.getIdentity("ana");\nid.setAttribute("status", ["active"]);\naction.goTo("true");', 'next', scenario({ users }));
    expect(unsaved.profile).toEqual([{ user: 'ana', attribute: 'status', values: ['active'], saved: false }]);
    const saved = runNode(
      'var id = idRepository.getIdentity("ana");\nid.addAttribute("mail", "b@example.com");\nid.store();\naction.goTo(id.exists() ? "true" : "false");',
      'next',
      scenario({ users }),
    );
    expect(saved).toMatchObject({ outcome: 'true', profile: [{ attribute: 'mail', values: ['a@example.com', 'b@example.com'], saved: true }] });
    const unknown = runNode('var id = idRepository.getIdentity("bob");\nid.setAttribute("a", ["b"]);\nid.store();', 'next', scenario({ users }));
    expect(unknown.error!.message).toMatch(/bob does not exist/);
  });

  it('merges maps across states with getObject()', () => {
    const code = 'nodeState.putShared("seen", nodeState.getObject("attrs"));\naction.goTo("true");';
    const result = runNode(code, 'next', scenario({ shared: { attrs: { mail: 'a' } }, transient: { attrs: { password: 'p' } } }));
    expect(result.writes[0].value).toEqual({ mail: 'a', password: 'p' });
  });

  it('reads cookies, parameters and secrets', () => {
    const code = `nodeState.putShared("lang", requestCookies.get("lang"));
nodeState.putShared("channel", requestParameters.get("channel").get(0));
nodeState.putShared("none", requestParameters.get("nothing"));
nodeState.putShared("secret", secrets.getGenericSecret("label").getAsUtf8());
action.goTo("true");`;
    const result = runNode(code, 'next', scenario({ cookies: { lang: 'es' }, parameters: { channel: ['web'] }, secrets: { label: 'x' } }));
    expect(result.writes.map((write) => write.value)).toEqual(['es', 'web', null, 'x']);
    expect(runNode('secrets.getGenericSecret("missing");', 'next', scenario()).error!.message).toMatch(/no secret is mapped to missing/);
  });

  it('reads the answers grouped by type', () => {
    const code = `if (callbacks.isEmpty()) {
  callbacksBuilder.choiceCallback("Pick", ["a", "b"], 0, true);
  callbacksBuilder.confirmationCallback(0, ["OK", "Cancel"], 0);
  callbacksBuilder.hiddenValueCallback("device", "");
  callbacksBuilder.textOutputCallback(0, "Hi");
} else {
  nodeState.putShared("picked", callbacks.getChoiceCallbacks().get(0));
  nodeState.putShared("confirmed", callbacks.getConfirmationCallbacks().get(0));
  nodeState.putShared("device", callbacks.getHiddenValueCallbacks().get("device"));
  action.goTo("true");
}`;
    const first = runNode(code, 'next', scenario());
    expect(first.callbacks.map((callback) => callback.type)).toEqual(['choice', 'confirmation', 'hidden', 'textOutput']);
    const second = runNode(code, 'next', scenario(), [[0, 1], 1, 'phone', null], first.callbacks);
    expect(second.writes.map((write) => write.value)).toEqual([[0, 1], 1, 'phone']);
  });

  it('reports the line where the script failed', () => {
    const result = runNode('var a = 1;\nvar b = a.nothing.more;', 'next', scenario());
    expect(result.error).toEqual({ message: expect.stringMatching(/^TypeError/), line: 2 });
    expect(runNode('var = ;', 'next', scenario()).error!.message).toMatch(/^SyntaxError/);
  });
});

describe('httpClient', () => {
  it('answers from the mocks and records every call', () => {
    const effects = newEffects();
    const mocks = [{ url: 'https://api.example.com/form', status: 201, body: 'a=1&b=2' }];
    const client = httpClient('next', mocks, effects);
    const form = client.send('https://api.example.com/form', { method: 'post', form: { x: 'y z' }, token: 'Bearer t' }).get();
    expect(form).toMatchObject({ status: 201, statusText: 'Created', ok: true });
    expect(form.formData()).toEqual({ a: '1', b: '2' });
    const missing = client.send('https://other.example.com').get();
    expect(missing).toMatchObject({ status: 404, ok: false });
    expect(effects.http).toEqual([
      { method: 'POST', url: 'https://api.example.com/form', headers: { Authorization: 'Bearer t', 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'x=y+z', status: 201, matched: true },
      { method: 'GET', url: 'https://other.example.com', headers: {}, status: 404, matched: false },
    ]);
    expect(() => client.send({} as string)).toThrow(/expects a URL/);
    expect(() => httpClient('legacy', mocks, effects).send('https://api.example.com')).toThrow(/expects an org\.forgerock/);
  });
});

describe('the Java stand-ins', () => {
  it('behave like Java collections', () => {
    const set = new JavaSet(['a', 'b', 'a']);
    expect([set.size(), set.toString(), set.contains('b'), set.isEmpty()]).toEqual([2, '[a, b]', true, false]);
    const values: string[] = [];
    set.forEach((value) => values.push(value));
    expect(values).toEqual(['a', 'b']);
    const iterator = set.iterator();
    expect([iterator.next(), iterator.hasNext(), iterator.next(), iterator.hasNext()]).toEqual(['a', true, 'b', false]);
    expect(() => iterator.next()).toThrow(/NoSuchElementException/);
    const list = javaList([1, 2]);
    expect([list.get(1), list.size(), list.isEmpty(), list.contains(2), list.toArray(), list[0]]).toEqual([2, 2, false, true, [1, 2], 1]);
    expect(() => list.get(5)).toThrow(/IndexOutOfBoundsException/);
    const map = javaMap({ a: 1 });
    expect([map.get('a'), map.get('b'), map.put('a', 2), map.containsKey('a'), map.size(), map.keySet().toString()]).toEqual([1, null, 1, true, 1, '[a]']);
  });

  it('convert JsonValue like AM does', () => {
    const value = JsonValue.json({ a: [1] });
    expect([value.isNull(), value.isString(), value.asMap().get('a'), value.toString()]).toEqual([false, false, [1], '{"a":[1]}']);
    expect([new JsonValue('7').asInteger(), new JsonValue('7.5').asDouble(), new JsonValue(1).asBoolean(), new JsonValue(null).asString()]).toEqual([7, 7.5, true, null]);
    expect(new JsonValue([1, 2]).asList().size()).toBe(2);
    expect(JsonValue.object(JsonValue.field('k', JsonValue.array(1)))).toEqual({ k: [1] });
  });

  it('turn script values into plain JSON', () => {
    expect(plain({ set: new JavaSet(['x']), json: new JsonValue(1), chars: new CharArray('p'), text: new String('t'), bytes: new Uint8Array([1]), fn: () => 1 })).toEqual({
      set: ['x'],
      json: 1,
      chars: '[C@6d06d69c',
      text: 't',
      bytes: [1],
      fn: undefined,
    });
    expect(javaString(new CharArray('abc'))).toBe('abc');
  });

  it('provide utils with values that repeat in both engines', () => {
    const tools = utils();
    expect(tools.base64.decode(tools.base64.encode('añ'))).toBe('añ');
    expect(tools.base64url.decode(tools.base64url.encode('?>?'))).toBe('?>?');
    expect(tools.crypto.randomUUID()).toBe('00000000-0000-4000-8000-000000000001');
    expect(tools.crypto.getRandomValues([0, 0])).toHaveLength(2);
  });

  it('give Java strings getBytes() only when created with new', () => {
    const code = `${legacy}sharedState.put("length", new java.lang.String("hi").getBytes().length);
sharedState.put("type", typeof java.lang.String("hi"));
sharedState.put("uuid", java.util.UUID.randomUUID().toString());
action = fr.Action.goTo("true").build();`;
    expect(runNode(code, 'legacy', scenario()).writes.map((write) => write.value)).toEqual([2, 'string', '00000000-0000-4000-8000-000000000001']);
  });

  it('reads back only the variables it is asked for', () => {
    expect(execute('var kept = 1; var other = 2;', {}, ['kept', 'missing']).values).toEqual({ kept: 1, missing: undefined });
    expect(execute('throw "plain";', {}).error).toEqual({ message: 'plain', line: undefined });
  });
});

describe('differences', () => {
  it('names what two runs did differently', () => {
    const a = runNode('action.goTo("true");', 'next', scenario());
    expect(differences(a, a)).toEqual([]);
    const b = runNode('nodeState.putShared("x", 1);\nlogger.info("hi");\naction.goTo("false").withErrorMessage("no");', 'next', scenario());
    expect(differences(a, b)).toEqual(['result', 'state', 'logs', 'messages']);
    const c = runNode('callbacksBuilder.nameCallback("N");', 'next', scenario());
    expect(differences(a, c)).toEqual(['result', 'callbacks']);
  });
});
