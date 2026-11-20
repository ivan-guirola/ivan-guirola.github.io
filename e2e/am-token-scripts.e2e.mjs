import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const BASE = process.env.BASE_URL ?? 'http://localhost:4399';
const CHROME = process.env.CHROME_PATH ?? '/usr/bin/google-chrome-stable';
const PATH = '/tools/am-token-scripts/';

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const results = [];
const tk = (name) => `[data-tk="${name}"]`;

async function scenario(name, run) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto(BASE + PATH);
    await page.waitForSelector(`${tk('status')}[data-state]`);
    await run(page);
    assert.deepEqual(errors, [], 'the page must not throw');
    results.push(`PASS  ${name}`);
  } catch (error) {
    results.push(`FAIL  ${name}\n      ${error.message.split('\n')[0]}`);
    process.exitCode = 1;
  } finally {
    await context.close();
  }
}

const settle = (page, state) => page.waitForSelector(`${tk('status')}[data-state="${state}"]`);
const added = (page, panel = 'claims') => page.locator(`${tk(panel)} [data-mark="added"]`).allInnerTexts();
const payload = async (page) => {
  const text = await page.textContent(tk('jwt'));
  return JSON.parse(Buffer.from(text.split('.')[1], 'base64url').toString('utf8'));
};

await scenario('adds profile data to the token and introspection', async (page) => {
  await settle(page, 'ok');
  assert.equal(await page.textContent(tk('status')), 'AM issues the token.');
  const claims = await added(page);
  assert.equal(claims.length, 3);
  assert.match(claims.join('\n'), /"phone": "\+44 117 496 0228"/);
  assert.equal((await payload(page)).mail[0], 'bjensen@example.com');
  assert.equal((await added(page, 'introspection')).length, 3);
  assert.match(await page.textContent(tk('size')), /bytes more than without the script/);
});

await scenario('fails for a user without a phone number until the script is converted', async (page) => {
  await page.click('[data-person="scarter"]');
  await settle(page, 'error');
  assert.match(await page.textContent(tk('status')), /HTTP 500.*Line 4: java\.util\.NoSuchElementException/);
  assert.equal(await page.textContent(tk('response')), 'HTTP/1.1 500 Internal Server Error');
  await page.click(tk('convert'));
  await settle(page, 'ok');
  assert.match(await page.inputValue(tk('code')), /identity\.exists\(\)/);
  assert.equal(await page.getAttribute('[data-engine="next"]', 'aria-pressed'), 'true');
  assert.match(await page.textContent(tk('conversion')), /identity\.exists\(\) instead of null/);
  assert.equal((await payload(page)).phone, undefined);
});

await scenario('a legacy script fails on the next-generation engine as it is', async (page) => {
  await page.click('[data-engine="next"]');
  await settle(page, 'error');
  assert.match(await page.textContent(tk('status')), /getAttribute is not a function/);
});

await scenario('puts extra data in the response, not in the token', async (page) => {
  await page.click('[data-sample="response"]');
  await page.waitForFunction(() => document.querySelector('[data-tk="response"]').textContent.includes('ui_locale'));
  assert.deepEqual(await added(page), []);
  const extras = await added(page, 'response');
  assert.match(extras.join('\n'), /"ui_locale": "es-ES"/);
  assert.match(extras.join('\n'), /"payment_limits": \{"daily":2000,"currency":"EUR"\}/);
});

await scenario('handles a JWT bearer grant for an unknown subject', async (page) => {
  await page.click('[data-grant="jwt_bearer"]');
  assert.equal(await page.isHidden(tk('people')), true);
  await page.waitForFunction(() => document.querySelector('[data-tk="claims"]').textContent.includes('jwt-bearer'));
  await settle(page, 'ok');
  assert.deepEqual(await added(page), []);
});

await scenario('shortens the token for one client', async (page) => {
  await page.click('[data-sample="lifetime"]');
  await page.waitForFunction(() => document.querySelector('[data-tk="claims"] [data-mark="changed"]'));
  const claims = await payload(page);
  assert.ok(Math.abs(claims.exp - Math.floor(Date.now() / 1000) - 300) < 5);
  assert.match(await page.textContent(tk('effects')), /Token lifetime for banking-web set to 300 seconds/);
  assert.equal(await page.isHidden(tk('native')), true);
});

await browser.close();
console.log(results.join('\n'));
