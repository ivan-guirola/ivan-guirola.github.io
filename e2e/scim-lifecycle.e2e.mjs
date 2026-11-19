import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const BASE = process.env.BASE_URL ?? 'http://localhost:4399';
const CHROME = process.env.CHROME_PATH ?? '/usr/bin/google-chrome-stable';
const PATH = '/tools/scim-lifecycle/';

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const results = [];
const sc = (name) => `[data-sc="${name}"]`;
const methods = (page) => page.locator('.sc-call .sc-method').allInnerTexts();

async function scenario(name, run) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto(BASE + PATH);
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

await scenario('opens on Entra creating an account', async (page) => {
  assert.deepEqual(await methods(page), ['GET', 'POST']);
  assert.match(await page.innerText(sc('summary')), /Entra ID/);
  assert.match(await page.innerText(sc('account-hint')), /no account before/);
  assert.equal(await page.locator(`${sc('account')} [data-op="del"]`).count(), 0);
});

await scenario('Okta changes a department with GET and PUT', async (page) => {
  await page.click('[data-provider="okta"]');
  await page.click('[data-event="move"]');
  assert.deepEqual(await methods(page), ['GET', 'PUT']);
  assert.equal(await page.getAttribute('[data-event="move"]', 'aria-pressed'), 'true');
  const removed = await page.locator(`${sc('account')} [data-op="del"]`).allInnerTexts();
  assert.ok(removed.some((line) => line.includes('"Finance"')));
});

await scenario('the request and response can be opened', async (page) => {
  await page.click('[data-event="leave"]');
  const details = page.locator('.sc-call details').first();
  await details.locator('summary').click();
  const text = await details.innerText();
  assert.match(text, /"path": "active"/);
  assert.match(text, /"value": false/);
});

await scenario('only Entra deletes, and later', async (page) => {
  await page.click('[data-event="delete"]');
  assert.deepEqual(await methods(page), ['PATCH', 'DELETE']);
  assert.match(await page.innerText('.sc-call:last-child .sc-later'), /30 days later/);
  assert.match(await page.innerText(sc('account-hint')), /no longer exists/);
  await page.click('[data-provider="okta"]');
  assert.deepEqual(await methods(page), ['PATCH']);
});

await scenario('an empty note is hidden', async (page) => {
  await page.click('[data-provider="okta"]');
  await page.click('[data-event="return"]');
  assert.equal(await page.isHidden(sc('note')), true);
  await page.click('[data-event="group"]');
  assert.equal(await page.isVisible(sc('note')), true);
  assert.match(await page.innerText('.sc-call .sc-status'), /200/);
  await page.click('[data-provider="entra"]');
  assert.match(await page.innerText('.sc-call .sc-status'), /204/);
});

await browser.close();
console.log(results.join('\n'));
