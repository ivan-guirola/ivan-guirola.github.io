import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const BASE = process.env.BASE_URL ?? 'http://localhost:4399';
const CHROME = process.env.CHROME_PATH ?? '/usr/bin/google-chrome-stable';
const PATH = '/tools/rar/';

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const results = [];
const rx = (name) => `[data-rx="${name}"]`;

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

async function approve(page, caseId, mode) {
  await page.click(`[data-case="${caseId}"]`);
  await page.click(`[data-mode="${mode}"]`);
  await page.click(`${rx('form')} button[type=submit]`);
  await page.click(rx('approve'));
  await page.waitForSelector(`${rx('tries')}:not([hidden])`);
}

async function attempt(page, id) {
  await page.click(`[data-attempt="${id}"]`);
  return page.innerText(`${rx('result')} .rx-verdict`);
}

await scenario('the consent screen shows the exact payment', async (page) => {
  await page.fill('input[name="amount"]', '72.50');
  await page.click(`${rx('form')} button[type=submit]`);
  const consent = await page.innerText(rx('consent'));
  assert.match(consent, /72\.50 EUR/);
  assert.match(consent, /DE02 1001 0010 9307 1186 03/);
  assert.match(consent, /Once/);
  const paths = await page.locator(`${rx('calls')} .sc-path`).allInnerTexts();
  assert.deepEqual(paths, ['auth.bank.example/par', 'auth.bank.example/authorize']);
});

await scenario('a scope lets the store pay anyone', async (page) => {
  await approve(page, 'payment', 'scope');
  assert.equal(await page.isVisible(rx('consent')), false);
  assert.match(await attempt(page, 'payee'), /^Accepted\. The token only says “payments”/);
  assert.equal(await page.getAttribute('[data-attempt="payee"]', 'data-picked'), 'warn');
});

await scenario('RAR rejects ten times the amount and allows the payment once', async (page) => {
  await approve(page, 'payment', 'rar');
  assert.match(await attempt(page, 'amount'), /the amount does not match/);
  assert.match(await attempt(page, 'agreed'), /^Accepted\. It matches/);
  assert.match(await attempt(page, 'again'), /has been used/);
  const paths = await page.locator(`${rx('calls')} .sc-path`).allInnerTexts();
  assert.equal(paths.length, 7);
});

await scenario('the token carries authorization_details', async (page) => {
  await approve(page, 'payment', 'rar');
  const token = await page.innerText(rx('token'));
  assert.match(token, /"typ": "at\+jwt"/);
  assert.match(token, /"authorization_details"/);
  assert.match(token, /"type": "payment_initiation"/);
});

await scenario('the AI agent cannot upgrade to business class or book a hotel', async (page) => {
  await approve(page, 'agent', 'rar');
  assert.match(await attempt(page, 'business'), /the class does not match/);
  assert.match(await page.innerText(rx('result')), /✗?\s*Price[\s\S]*up to 300\.00/);
  assert.match(await attempt(page, 'hotel'), /the address it called does not match/);
  assert.match(await attempt(page, 'agreed'), /^Accepted/);
});

await scenario('declining leaves the app without a token', async (page) => {
  await page.click(`${rx('form')} button[type=submit]`);
  await page.click(rx('decline'));
  assert.match(await page.innerText(rx('server-status')), /declined/);
  assert.equal(await page.isVisible(rx('tries')), false);
});

await browser.close();
console.log(results.join('\n'));
