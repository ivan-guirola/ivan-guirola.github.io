import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const BASE = process.env.BASE_URL ?? 'http://localhost:4399';
const CHROME = process.env.CHROME_PATH ?? '/usr/bin/google-chrome-stable';
const PATH = '/tools/am-script-migration/';

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const results = [];
const mg = (name) => `[data-mg="${name}"]`;

async function scenario(name, run) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto(BASE + PATH);
    await page.waitForFunction(() => document.querySelector('[data-mg="summary"]').textContent.length > 0);
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

const verdict = (page) =>
  page.waitForFunction(() => /did (the same|different) thing/.test(document.querySelector('[data-mg="verdict"]').textContent)).then(() => page.textContent(mg('verdict')));

await scenario('opens with the sign-in script converted and explained', async (page) => {
  assert.match(await page.textContent(mg('summary')), /^11 changes, nothing to review\.$/);
  const code = await page.textContent(mg('code'));
  assert.match(code, /callbacksBuilder\.nameCallback\("User Name"\);/);
  assert.match(code, /callbacks\.getPasswordCallbacks\(\)\.get\(0\)/);
  assert.doesNotMatch(code, /JavaImporter|sharedState|build\(\)/);
  const titles = await page.locator(`${mg('changes')} strong`).allInnerTexts();
  assert.ok(titles.includes('callbacksBuilder asks for input'));
  assert.ok(await page.locator(`${mg('code')} [data-op="add"]`).count() > 5);
  assert.equal(await page.isHidden(mg('warnings-block')), true);
});

await scenario('runs both versions through the callbacks and finds no difference', async (page) => {
  await page.click(mg('run'));
  await page.waitForSelector(`${mg('ask')}:not([hidden])`);
  assert.equal(await page.inputValue('#mg-answer-0'), 'bjensen');
  await page.fill('#mg-answer-0', 'scarter');
  await page.click(`${mg('ask')} button[type=submit]`);
  assert.equal(await verdict(page), 'Both versions did the same thing.');
  for (const engine of ['legacy', 'next']) {
    const text = await page.textContent(mg(`result-${engine}`));
    assert.match(text, /Outcometrue/);
    assert.match(text, /username = "scarter"/);
  }
});

await scenario('converts an HTTP call and gets the same score from the service', async (page) => {
  await page.click('[data-sample="risk"]');
  const code = await page.textContent(mg('code'));
  assert.match(code, /httpClient\.send\("https:\/\/risk\.example\.com\/v1\/score", requestOptions\)\.get\(\)/);
  assert.match(code, /utils\.base64\.encode\("journeys:" \+ password\)/);
  await page.click(mg('run'));
  assert.equal(await verdict(page), 'Both versions did the same thing.');
  assert.match(await page.textContent(mg('result-next')), /POST https:\/\/risk\.example\.com\/v1\/score → 200/);
  assert.match(await page.textContent(mg('result-legacy')), /Outcomehigh/);
});

await scenario('lists what it cannot convert', async (page) => {
  await page.fill(mg('legacy'), 'var f = new java.text.SimpleDateFormat("yyyy");\noutcome = "true";');
  await page.waitForSelector(`${mg('warnings-block')}:not([hidden])`);
  assert.match(await page.textContent(mg('warnings')), /java\.text\.SimpleDateFormat is a Java class/);
  assert.match(await page.textContent(mg('summary')), /1 change, 1 thing to review/);
});

await scenario('shows the differences line by line', async (page) => {
  await page.click('[data-view="diff"]');
  assert.ok(await page.locator(`${mg('code')} [data-op="del"]`).count() > 5);
  assert.ok(await page.locator(`${mg('code')} [data-op="add"]`).count() > 5);
});

await scenario('follows the error path when the profile has no department', async (page) => {
  await page.click('[data-sample="profile"]');
  await page.click('summary');
  const data = JSON.parse(await page.inputValue(mg('scenario')));
  data.users.bjensen.department = [];
  await page.fill(mg('scenario'), JSON.stringify(data));
  await page.click(mg('run'));
  assert.equal(await verdict(page), 'Both versions did the same thing.');
  assert.match(await page.textContent(mg('result-next')), /Outcomefalse/);
  assert.match(await page.textContent(mg('result-next')), /errorMessage: Your account has no department/);
});

await browser.close();
console.log(results.join('\n'));
