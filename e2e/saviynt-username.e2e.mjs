import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const BASE = process.env.BASE_URL ?? 'http://localhost:4399';
const CHROME = process.env.CHROME_PATH ?? '/usr/bin/google-chrome-stable';
const PATH = '/tools/saviynt-username/';

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const results = [];
const sv = (name) => `[data-sv="${name}"]`;

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
  await page.waitForSelector(`${sv('verdict')}[data-state="${state}"]`);
  return page.innerText(sv('verdict'));
}

const names = (page) => page.locator('.sv-name').allInnerTexts();

await scenario('the starting rule shows a username for each person', async (page) => {
  await page.click(sv('tab-test'));
  assert.equal(await verdict(page, 'warn'), '3 of 7 people get a username with nothing to review.');
  assert.deepEqual(await names(page), [
    'jane.doe',
    'john.smith1',
    'maría josé.fernández',
    "sean.o'brien",
    'jane.doe1',
    'alexandrina.montgomery-wellington',
    'No username',
  ]);
  assert.match(await page.innerText(`${sv('options')} li:nth-child(2)`), /^Option 2\s+2 person\(s\)$/);
});

await scenario('each person explains the options skipped and the problems found', async (page) => {
  await page.click(sv('tab-test'));
  await verdict(page, 'warn');
  const rows = page.locator('.sv-results > li');
  assert.match(await rows.nth(1).innerText(), /Option 1 gave “john\.smith”, which is already taken/);
  assert.match(await rows.nth(2).innerText(), /It has spaces\.[\s\S]*not allowed: í é á/);
  assert.match(await rows.nth(5).innerText(), /It has 33 characters and the limit is 20/);
  const lucia = await rows.nth(6).innerText();
  assert.match(lucia, /Option 1 gave NULL because users\.lastname is empty, and CONCAT returns NULL/);
  assert.match(lucia, /Option 2 gave NULL for the same reason/);
  assert.match(lucia, /No option gave a free username/);
  assert.equal(await rows.nth(6).getAttribute('data-state'), 'error');
});

await scenario('the examples fix the usual problems', async (page) => {
  await page.click(sv('tab-test'));
  await page.click('[data-rule^="LOWER(CONCAT_WS"]');
  assert.equal((await names(page))[6], 'lucía');
  await page.click('button:text("Without accents, spaces or apostrophes")');
  const list = await names(page);
  assert.equal(list[2], 'mariajose.fernandez');
  assert.equal(list[3], 'sean.obrien');
  await page.click('button:text("From the employee ID")');
  assert.equal(await verdict(page, 'ok'), '7 of 7 people get a username with nothing to review.');
  assert.equal(await page.isHidden(sv('options')), true);
});

await scenario('the settings change what counts as a problem', async (page) => {
  await page.click(sv('tab-test'));
  await page.fill(sv('max'), '40');
  await page.uncheck(sv('strict'));
  await page.waitForFunction(() => document.querySelector('[data-sv="verdict"]').textContent.startsWith('6 of 7'));
});

await scenario('a rule that cannot be read is pointed at, with MySQL advice', async (page) => {
  await page.click(sv('tab-test'));
  const rule = "LOWER(users.firstname)###users.firstname || '.' || users.lastname";
  await page.fill(sv('rule'), rule);
  assert.equal(
    await verdict(page, 'error'),
    'Option 2 has a problem: In MySQL “||” means OR, not joining texts. Use CONCAT(…) to join them.',
  );
  assert.equal(await page.innerText(sv('pointer')), `${rule}\n${' '.repeat(rule.indexOf('||'))}^`);
  await page.fill(sv('rule'), 'NVL(users.middlename, users.firstname)');
  await page.waitForFunction(() => document.querySelector('[data-sv="verdict"]').textContent.includes('NVL'));
  assert.equal(await page.innerText(sv('verdict')), 'The rule has a problem: NVL is not a MySQL function. Use IFNULL instead.');
});

await scenario('the sample people and taken names can be edited and reset', async (page) => {
  await page.click(sv('tab-test'));
  await page.click('summary:text("Sample people (CSV)")');
  await page.fill(sv('taken'), '');
  await page.waitForFunction(() => document.querySelectorAll('.sv-name')[1]?.textContent === 'john.smith');
  await page.fill(sv('users'), 'firstname,lastname\nAna,Ruiz');
  await page.waitForFunction(() => document.querySelectorAll('.sv-name').length === 1);
  assert.deepEqual(await names(page), ['ana.ruiz']);
  await page.fill(sv('users'), 'first name\nx');
  assert.match(await verdict(page, 'error'), /^The sample people cannot be read: the first line must name the columns/);
  await page.click(sv('reset'));
  assert.equal((await names(page)).length, 7);
});

await scenario('an empty rule asks for one', async (page) => {
  await page.click(sv('tab-test'));
  await page.fill(sv('rule'), ' ');
  await page.waitForFunction(() => document.querySelector('[data-sv="verdict"]').textContent.startsWith('Write'));
  assert.equal(await page.isHidden(sv('output')), true);
});

const option = (n) => `.sv-opt:nth-child(${n})`;

await scenario('the builder starts from a working rule', async (page) => {
  assert.equal(await verdict(page, 'warn'), '6 of 7 people get a username with nothing to review.');
  assert.deepEqual(await names(page), ['jdoe', 'jsmith', 'mjfernandez', 'sobrien', 'jadoe', 'amontgomeryw', 'No username']);
  assert.equal(await page.locator('.sv-opt').count(), 2);
  const sql = await page.innerText(sv('sql'));
  assert.match(sql, /^LEFT\(REPLACE\(/);
  assert.equal(sql.split('\n#\n').length, 2);
  assert.match(await page.locator('.sv-results > li').nth(4).innerText(), /Option 1 gave “jdoe”, which is already taken/);
});

await scenario('changing a setting changes the SQL and the usernames', async (page) => {
  await page.fill(`${option(1)} .sv-cleanup input[type="number"]`, '5');
  await page.waitForFunction(() => document.querySelectorAll('.sv-name')[2]?.textContent === 'mjfer');
  assert.match(await page.innerText(sv('sql')), /, 5\)\n#\nLEFT\(/);
  await page.uncheck(`${option(1)} .sv-cleanup input[type="checkbox"] >> nth=1`);
  await page.fill(`${option(1)} .sv-cleanup input[type="number"]`, '');
  await page.waitForFunction(() => document.querySelectorAll('.sv-name')[2]?.textContent === 'mjfernández');
});

await scenario('options, parts and conditions can be added, moved and removed', async (page) => {
  await page.click(sv('add-option'));
  assert.equal(await page.locator('.sv-opt').count(), 3);
  await page.click(`${option(3)} .sv-opt-head [aria-label="Move up"]`);
  await page.click(`${option(2)} .sv-opt-head [aria-label="Move up"]`);
  assert.match(await page.innerText(sv('sql')), /^REPLACE\(/);
  await page.click(`${option(3)} .sv-opt-head [aria-label="Remove"]`);
  await page.click(`${option(2)} .sv-opt-head [aria-label="Remove"]`);
  assert.equal((await names(page))[1], 'john');
  await page.click(`${option(1)} .sv-adds button:text("Add a text")`);
  await page.fill(`${option(1)} .sv-row:last-child input[type="text"]`, '.x');
  await page.waitForFunction(() => document.querySelectorAll('.sv-name')[0]?.textContent === 'jane.x');
  await page.click(`${option(1)} button:text("Add a condition")`);
  await page.click(`${option(1)} button:text("Or…")`);
  await page.click(`${option(1)} .sv-groups > button:text("And…") >> nth=1`);
  assert.equal(await page.locator(`${option(1)} .sv-or`).count(), 1);
  assert.equal(await page.locator(`${option(1)} .sv-group`).nth(1).locator('.sv-row').count(), 2);
  await page.click(`${option(1)} .sv-group >> nth=1 >> [aria-label="Remove"] >> nth=0`);
  await page.click(`${option(1)} .sv-group >> nth=1 >> [aria-label="Remove"] >> nth=0`);
  assert.equal(await page.locator(`${option(1)} .sv-or`).count(), 0);
  await page.selectOption(`${option(1)} .sv-row select[aria-label="Comparison"]`, 'isNotEmpty');
  await page.click(`${option(1)} button:text("Or…")`);
  await page.selectOption(`${option(1)} .sv-group >> nth=1 >> select[aria-label="Comparison"]`, 'isEmpty');
  assert.match(await page.innerText(sv('sql')), /^CASE WHEN \(users\.firstname <> ''\)\n    OR \(\(users\.firstname IS NULL OR users\.firstname = ''\)\)/);
  await page.click(`${option(1)} .sv-group >> nth=1 >> [aria-label="Remove"]`);
  assert.equal(await page.locator(`${option(1)} .sv-row select[aria-label="Comparison"]`).count(), 1);
  assert.match(await page.innerText(sv('sql')), /^CASE WHEN users\.firstname <> ''/);
});

await scenario('the separator can be changed and the rule opened as SQL', async (page) => {
  await page.selectOption(sv('separator'), '###');
  assert.equal((await page.innerText(sv('sql'))).split('\n###\n').length, 2);
  const sql = await page.innerText(sv('sql'));
  await page.click(sv('edit'));
  assert.equal(await page.isVisible(sv('rule')), true);
  assert.equal(await page.inputValue(sv('rule')), sql);
  assert.equal(await verdict(page, 'warn'), '6 of 7 people get a username with nothing to review.');
});

await browser.close();
console.log(results.join('\n'));
