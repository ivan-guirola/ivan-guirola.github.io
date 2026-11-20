import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const BASE = process.env.BASE_URL ?? 'http://localhost:4399';
const CHROME = process.env.CHROME_PATH ?? '/usr/bin/google-chrome-stable';
const PATH = '/tools/opa/';

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const results = [];
const op = (name) => `[data-op="${name}"]`;
const verdict = (page) => page.innerText(op('verdict'));
const reasons = (page) => page.locator(`${op('reasons')} li`).allInnerTexts();

async function scenario(name, run) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto(BASE + PATH);
    await page.waitForSelector(`${op('decision')}[data-allow]`);
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

await scenario('opens with a manager over the limit, explained by the policy', async (page) => {
  assert.equal(await verdict(page), 'Denied');
  assert.equal(await page.innerText(op('request')), 'POST /expenses/E-103/approve');
  const text = (await reasons(page)).join('\n');
  assert.match(text, /manager limit of 1000 EUR/);
  assert.match(text, /needs a sign-in with MFA/);
  assert.ok((await page.locator('[data-line][data-hit="deny"]').count()) > 5);
  assert.match(await page.innerText(op('call')), /POST \/v1\/data\/authz\/decision/);
});

await scenario('Finance approves a large expense only with MFA', async (page) => {
  await page.click('[data-person="ana"]');
  assert.equal(await verdict(page), 'Denied');
  await page.check(op('mfa'));
  assert.equal(await verdict(page), 'Allowed');
  assert.ok((await page.locator('[data-line][data-hit="grant"]').count()) > 0);
  assert.equal(await page.locator('[data-line][data-hit="deny"]').count(), 0);
});

await scenario('changing the limit in the data changes the decision', async (page) => {
  await page.click('[data-expense="E-101"]');
  assert.equal(await verdict(page), 'Allowed');
  await page.fill(op('manager'), '100');
  assert.equal(await verdict(page), 'Denied');
  assert.match((await reasons(page)).join('\n'), /limit of 100 EUR/);
  assert.match(await page.textContent(op('data')), /"manager": 100/);
});

await scenario('a deny wins over a grant, and a service never approves', async (page) => {
  await page.click('[data-expense="E-102"]');
  assert.match((await reasons(page)).join('\n'), /Nobody can approve their own expense[\s\S]*always wins/);
  await page.click('[data-person="bot"]');
  assert.equal(await page.isDisabled(op('mfa')), true);
  assert.match((await reasons(page)).join('\n'), /denies it by default/);
  await page.click('[data-action="read"]');
  assert.equal(await verdict(page), 'Allowed');
});

await scenario('the table selects a combination', async (page) => {
  await page.click('[data-action="read"]');
  const cells = page.locator(`${op('matrix')} button`);
  assert.equal(await cells.count(), 16);
  await page.click(`${op('matrix')} button[aria-label="Laura, E-102: Denied"]`);
  assert.equal(await page.getAttribute('[data-person="laura"]', 'aria-pressed'), 'true');
  assert.equal(await page.innerText(op('request')), 'GET /expenses/E-102');
  assert.equal(await verdict(page), 'Denied');
});

await scenario('shows the token and the claims the rules check', async (page) => {
  const jwt = await page.innerText(op('jwt'));
  const [, payload] = jwt.split('.');
  assert.equal(JSON.parse(Buffer.from(payload, 'base64url').toString()).sub, 'marco.ruiz');
  const hit = await page.locator(`${op('claims')} [data-hit]`).evaluateAll((lines) => lines.map((line) => `${line.dataset.claim}:${line.dataset.hit}`));
  assert.deepEqual(hit.sort(), ['amr:deny', 'roles:deny']);
  assert.match((await reasons(page)).join('\n'), /Checks token\.roles, expense\.amount, data\.limits\.manager/);
  await page.click('[data-person="bot"]');
  await page.click('[data-action="read"]');
  assert.deepEqual(await page.locator(`${op('claims')} [data-hit]`).evaluateAll((lines) => lines.map((line) => line.dataset.claim)), ['scope']);
});

await browser.close();
console.log(results.join('\n'));
