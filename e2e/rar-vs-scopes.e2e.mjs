import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const BASE = process.env.BASE_URL ?? 'http://localhost:4399';
const CHROME = process.env.CHROME_PATH ?? '/usr/bin/google-chrome-stable';
const PATH = '/tools/rar-vs-scopes/';

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const results = [];
const ra = (name) => `[data-ra="${name}"]`;
const paths = (page) => page.locator(`${ra('calls')} .sc-path`).allInnerTexts();

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

await scenario('opens on the scope, with a vague consent screen', async (page) => {
  assert.deepEqual(await paths(page), [
    'auth.bank.example/par',
    'auth.bank.example/authorize',
    'store.example/callback',
    'auth.bank.example/token',
    'api.bank.example/payments',
  ]);
  const consent = await page.innerText(ra('consent'));
  assert.match(consent, /Make payments from your accounts/);
  assert.doesNotMatch(consent, /45\.00/);
  assert.match(await page.innerText(ra('token')), /"scope": "payments"/);
});

await scenario('Berlin Group creates the payment first', async (page) => {
  await page.click('[data-approach="psd2"]');
  assert.equal((await paths(page))[0], 'api.bank.example/psd2/v1/payments/sepa-credit-transfers');
  assert.match(await page.innerText(ra('consent')), /45\.00 EUR/);
  assert.match(await page.innerText(ra('token')), /"scope": "PIS:1234-wertiq-983"/);
});

await scenario('the RAR request carries the payment', async (page) => {
  await page.click('[data-approach="rar"]');
  const details = page.locator(`${ra('calls')} details`).first();
  await details.locator('summary').click();
  assert.match(await details.innerText(), /authorization_details=\[/);
  assert.match(await page.innerText(ra('token')), /"authorization_details"/);
});

await scenario('another payment goes through only with the scope', async (page) => {
  assert.equal(await page.isHidden(ra('misuse')), true);
  await page.click(ra('try'));
  assert.match(await page.innerText(ra('outcome')), /accepts it/);
  await page.click('[data-approach="rar"]');
  assert.equal(await page.isHidden(ra('misuse')), true, 'changing approach hides the old outcome');
  await page.click(ra('try'));
  assert.match(await page.innerText(ra('outcome')), /rejects it/);
  assert.match(await page.innerText(`${ra('misuse-call')} .sc-status`), /403/);
  await page.click('[data-approach="psd2"]');
  await page.click(ra('try'));
  assert.match(await page.innerText(ra('outcome')), /approves it at her bank/);
});

await browser.close();
console.log(results.join('\n'));
