import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const BASE = process.env.BASE_URL ?? 'http://localhost:4399';
const CHROME = process.env.CHROME_PATH ?? '/usr/bin/google-chrome-stable';
const PATH = '/tools/dpop/';

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const results = [];
const dp = (name) => `[data-dp="${name}"]`;

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

async function ready(page, mode) {
  await page.click(`[data-mode="${mode}"]`);
  await page.waitForTimeout(100);
  await page.click(dp('get-token'));
  await page.waitForSelector(`${dp('call-api')}:not([disabled])`);
  await page.click(dp('call-api'));
  await page.waitForSelector(`${dp('attacks')}:not([hidden])`);
}

async function attack(page, id) {
  await page.click(`[data-attack="${id}"]`);
  return page.innerText(`${dp('result')} .rx-verdict`);
}

await scenario('the app gets a token tied to its key and uses it', async (page) => {
  await ready(page, 'dpop');
  assert.match(await page.innerText(`${dp('result')} .rx-verdict`), /^Accepted\. This is the app’s own call/);
  assert.match(await page.innerText(dp('token')), /"jkt"/);
  assert.match(await page.innerText(dp('proof')), /"typ": "dpop\+jwt"[\s\S]*"htu": "https:\/\/api\.bank\.example\/accounts"[\s\S]*"ath"/);
  const thumbprint = (await page.innerText(`${dp('app-key')} code`)).trim();
  assert.match(await page.innerText(dp('token')), new RegExp(`"jkt": "${thumbprint.replace(/[-_]/g, '.')}"`));
});

await scenario('every attack on a DPoP token fails for its own reason', async (page) => {
  await ready(page, 'dpop');
  assert.match(await attack(page, 'token'), /cannot prove it holds it/);
  assert.match(await attack(page, 'ownKey'), /different key/);
  assert.match(await attack(page, 'replay'), /already been used/);
  assert.match(await attack(page, 'otherEndpoint'), /made for another call/);
  const statuses = await page.locator(`${dp('calls')} .sc-status`).allInnerTexts();
  assert.deepEqual(statuses, ['200 OK', '200 OK', '401 Unauthorized', '401 Unauthorized', '401 Unauthorized', '401 Unauthorized']);
});

await scenario('a stolen bearer token works for the attacker', async (page) => {
  await ready(page, 'bearer');
  assert.equal(await page.isVisible(dp('attacker-key')), false);
  assert.match(await attack(page, 'token'), /cannot tell the attacker from the app/);
  assert.match(await attack(page, 'otherEndpoint'), /^Accepted/);
  assert.equal(await page.getAttribute('[data-attack="otherEndpoint"]', 'data-picked'), 'warn');
  assert.match(await page.innerText(dp('proof')), /without a proof/);
});

await scenario('attacks wait until the app has used its token', async (page) => {
  assert.equal(await page.isVisible(dp('attacks')), false);
  assert.equal(await page.isDisabled(dp('call-api')), true);
});

await browser.close();
console.log(results.join('\n'));
