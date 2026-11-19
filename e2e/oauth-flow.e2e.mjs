import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const BASE = process.env.BASE_URL ?? 'http://localhost:4399';
const CHROME = process.env.CHROME_PATH ?? '/usr/bin/google-chrome-stable';
const PATH = '/tools/oauth-flow/';

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const results = [];
const RESULT = '[data-of="result"]';

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

async function answer(page, question, value) {
  await page.click(`.pick-ask[data-question="${question}"] [data-value="${value}"]`);
}

await scenario('it starts with one question and no result', async (page) => {
  assert.equal(await page.locator('.pick-ask').count(), 1);
  assert.match(await page.innerText('.pick-ask legend'), /Who is signing in/);
  assert.equal(await page.isHidden(RESULT), true);
});

await scenario('a browser application with no server gets the code flow as a public client', async (page) => {
  await answer(page, 'actor', 'person');
  await answer(page, 'app', 'spa');
  await answer(page, 'backend', 'false');
  await answer(page, 'sensitive', 'false');
  await answer(page, 'offline', 'true');
  await page.waitForSelector(`${RESULT}[data-flow="authorizationCode"]`);
  const result = await page.innerText(RESULT);
  assert.match(result, /Authorization code with PKCE/);
  assert.match(result, /public client/);
  assert.match(result, /change on every use/);
  assert.match(result, /What to avoid/i);
  assert.match(result, /implicit flow/);
  assert.equal(await page.locator('.pick-done').count(), 5);
});

await scenario('an internal service gets client credentials with a secret', async (page) => {
  await answer(page, 'actor', 'service');
  await answer(page, 'onBehalf', 'false');
  await answer(page, 'exposure', 'internal');
  await answer(page, 'sensitive', 'false');
  await page.waitForSelector(`${RESULT}[data-flow="clientCredentials"]`);
  const result = await page.innerText(RESULT);
  assert.match(result, /client secret is enough/);
  assert.doesNotMatch(result, /What to avoid/);
});

await scenario('a sensitive service is told to use a key and bind its tokens', async (page) => {
  await answer(page, 'actor', 'service');
  await answer(page, 'onBehalf', 'true');
  await answer(page, 'exposure', 'internet');
  await answer(page, 'sensitive', 'true');
  await page.waitForSelector(`${RESULT}[data-flow="tokenExchange"]`);
  const result = await page.innerText(RESULT);
  assert.match(result, /private key/);
  assert.match(result, /DPoP/);
});

await scenario('a device with no browser gets the device flow', async (page) => {
  await answer(page, 'actor', 'device');
  await answer(page, 'sensitive', 'false');
  await answer(page, 'offline', 'false');
  await page.waitForSelector(`${RESULT}[data-flow="deviceCode"]`);
});

await scenario('changing an answer goes back to that question', async (page) => {
  await answer(page, 'actor', 'device');
  await answer(page, 'sensitive', 'false');
  await answer(page, 'offline', 'false');
  await page.waitForSelector(`${RESULT}[data-flow="deviceCode"]`);
  await page.click('.pick-done[data-question="actor"] .pick-change');
  assert.equal(await page.isHidden(RESULT), true);
  assert.equal(await page.locator('.pick-done').count(), 0);
  assert.match(await page.innerText('.pick-ask legend'), /Who is signing in/);
});

await scenario('start again clears everything', async (page) => {
  await answer(page, 'actor', 'device');
  await answer(page, 'sensitive', 'true');
  await answer(page, 'offline', 'false');
  await page.click('[data-of="restart"]');
  assert.equal(await page.isHidden(RESULT), true);
  assert.equal(await page.locator('.pick-ask').count(), 1);
});

await browser.close();
console.log(results.join('\n'));
console.log(`\n${results.filter((line) => line.startsWith('PASS')).length}/${results.length} scenarios passed`);
