import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const BASE = process.env.BASE_URL ?? 'http://localhost:4399';
const CHROME = process.env.CHROME_PATH ?? '/usr/bin/google-chrome-stable';
const PATH = '/tools/okta-expression/';

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const results = [];
const ok = (name) => `[data-ok="${name}"]`;

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

async function verdict(page, state) {
  await page.waitForSelector(`${ok('verdict')}[data-state="${state}"]`);
  return page.innerText(ok('verdict'));
}

await scenario('the first example is worked out on arrival', async (page) => {
  assert.equal(await verdict(page, 'ok'), 'The result is text.');
  assert.equal(await page.innerText(ok('value')), '"jane.doe"');
  assert.match(await page.innerText(ok('used')), /String\.substringBefore\(text, separator\)/);
});

await scenario('the result follows what is typed', async (page) => {
  await page.fill(ok('input'), 'String.toUpperCase(user.lastName) + "-" + user.employeeNumber');
  await page.waitForFunction(() => document.querySelector('[data-ok="value"]').textContent === '"DOE-00427"');
  assert.equal(await verdict(page, 'ok'), 'The result is text.');
});

await scenario('an example can be loaded with one click', async (page) => {
  await page.click('[data-example^="isMemberOfGroupName("]');
  assert.equal(await page.inputValue(ok('input')), 'isMemberOfGroupName("app-crm-admins") ? "admin" : "user"');
  assert.equal(await page.innerText(ok('value')), '"admin"');
  await page.click('[data-example^="user.department"]');
  assert.equal(await verdict(page, 'ok'), 'The result is true or false.');
  assert.match(await page.innerText(ok('use')), /condition of a group rule/);
});

await scenario('a mistake is explained and pointed at', async (page) => {
  await page.fill(ok('input'), 'String.substringBefore(user.email)');
  assert.equal(
    await verdict(page, 'error'),
    'The expression has a problem. String.substringBefore expects 2 value(s) but got 1: String.substringBefore(text, separator).',
  );
  assert.equal(await page.innerText(ok('value')), 'String.substringBefore(user.email)\n                      ^');
  await page.fill(ok('input'), 'user.email.toLowerCase()');
  await page.waitForFunction(() => /does not call functions/.test(document.querySelector('[data-ok="verdict"]').textContent));
});

await scenario('changing the sample user changes the result', async (page) => {
  await page.click('summary:text("Sample user and groups")');
  const sample = JSON.parse(await page.inputValue(ok('context')));
  sample.user.email = 'john.smith@example.com';
  await page.fill(ok('context'), JSON.stringify(sample));
  await page.waitForFunction(() => document.querySelector('[data-ok="value"]').textContent === '"john.smith"');
  await page.fill(ok('context'), '{');
  assert.match(await verdict(page, 'error'), /^The sample user is not valid JSON/);
  assert.equal(await page.isHidden(ok('output')), true);
  await page.click(ok('reset'));
  assert.equal(await page.innerText(ok('value')), '"jane.doe"');
});

await scenario('an empty expression asks for one', async (page) => {
  await page.fill(ok('input'), '');
  await page.waitForFunction(() => document.querySelector('[data-ok="verdict"]').textContent.startsWith('Write'));
  assert.equal(await page.isHidden(ok('output')), true);
});

await scenario('every function is listed in the reference', async (page) => {
  await page.click('summary:text("Supported functions")');
  assert.equal(await page.locator('.ok-reference > div').count(), 37);
});

await browser.close();
console.log(results.join('\n'));
