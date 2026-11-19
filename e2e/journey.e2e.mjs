import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const BASE = process.env.BASE_URL ?? 'http://localhost:4399';
const CHROME = process.env.CHROME_PATH ?? '/usr/bin/google-chrome-stable';
const PATH = '/tools/journey/';

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const results = [];
const jv = (name) => `[data-jv="${name}"]`;

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
  await page.waitForSelector(`${jv('verdict')}[data-state="${state}"]`);
  return page.innerText(jv('verdict'));
}

const node = (name) => `.jv-box.node[aria-label^="${name},"]`;

await scenario('the example journey is drawn and its leftover step reported', async (page) => {
  assert.equal(await page.isHidden(jv('output')), true);
  await page.click(jv('sample'));
  assert.equal(await verdict(page, 'warn'), 'Login: 8 steps. 1 thing(s) to review.');
  assert.equal(await page.locator('.jv-box.node').count(), 8);
  assert.equal(await page.locator('.jv-box.success').count(), 1);
  assert.equal(await page.locator('.jv-edges path').count(), 16);
  assert.match(await page.innerText(jv('report')), /“Old lockout check” cannot be reached from the start/);
  assert.equal(await page.getAttribute(node('Old lockout check'), 'data-flag'), 'warn');
});

await scenario('selecting a step shows where it goes and its script', async (page) => {
  await page.click(jv('sample'));
  await page.click(node('Route by email domain'));
  const detail = await page.innerText(jv('detail'));
  assert.match(detail, /Runs a script that decides which way to go/);
  assert.match(detail, /Employee → Count the sign-in/);
  assert.match(detail, /Next-generation/);
  assert.match(detail, /action\.goTo\('employee'\)/);
  assert.equal(await page.getAttribute(node('Route by email domain'), 'data-selected'), 'true');
  await page.click(`${jv('detail')} .jv-outcomes li:first-child .jv-link`);
  assert.match(await page.innerText(`${jv('detail')} h3`), /Count the sign-in/);
});

await scenario('a finding selects its step, and an inner journey opens', async (page) => {
  await page.click(jv('sample'));
  await page.click('.jv-findings .jv-link');
  assert.match(await page.innerText(`${jv('detail')} h3`), /Old lockout check/);
  await page.click(node('Second factor'));
  await page.click(`${jv('detail')} .facts .jv-link:text("SecondFactor")`);
  assert.match(await verdict(page, 'warn'), /^SecondFactor: 4 steps/);
  assert.match(await page.innerText(jv('report')), /legacy scripting engine/);
  assert.equal(await page.getAttribute(`${jv('journeys')} [data-journey="SecondFactor"]`, 'aria-pressed'), 'true');
});

await scenario('steps can be reached with the keyboard', async (page) => {
  await page.click(jv('sample'));
  await page.focus(node('Sign in'));
  await page.keyboard.press('Enter');
  const detail = await page.innerText(jv('detail'));
  assert.match(detail, /Steps on this page/);
  assert.match(detail, /Username/);
});

await scenario('an export can be opened from a file', async (page) => {
  await page.click(jv('sample'));
  const sample = await page.inputValue(jv('input'));
  await page.click(jv('clear'));
  const folder = await mkdtemp(join(tmpdir(), 'journey-'));
  const file = join(folder, 'second-factor.json');
  await writeFile(file, JSON.stringify(JSON.parse(sample).trees.SecondFactor));
  await page.setInputFiles(jv('file'), file);
  assert.match(await verdict(page, 'warn'), /^SecondFactor: 4 steps/);
  assert.equal(await page.isHidden(jv('journeys')), true);
});

await scenario('text that is not an export is explained', async (page) => {
  await page.fill(jv('input'), '{"hello": "world"}');
  assert.equal(await verdict(page, 'error'), 'This does not look like a journey export: not a journey export.');
  assert.equal(await page.isHidden(jv('output')), true);
});

await scenario('two exports are compared step by step', async (page) => {
  await page.click(jv('tab-compare'));
  assert.equal(await page.isVisible(jv('before')), true);
  await page.click(jv('sample-pair'));
  assert.equal(await verdict(page, 'warn'), '1 journey(s) changed, 1 unchanged.');
  const report = await page.innerText(jv('report'));
  assert.match(report, /Five attempts\s+Changed/);
  assert.match(report, /Retry limit\s+3\s*→\s*5/);
  assert.match(report, /Is the account active\s+Added/);
  assert.match(report, /Old lockout check\s+Removed/);
  assert.match(report, /You are signing in as a partner\.\s*→\s*You are signing in as a partner\. Your access/);
  assert.equal(await page.locator('.jv-code-diff [data-op="add"]').count(), 1);
  assert.equal(await page.getAttribute(node('Is the account active'), 'data-diff'), 'added');
  assert.equal(await page.getAttribute(node('Five attempts'), 'data-diff'), 'changed');
});

await scenario('an unchanged journey says so, and each tab keeps its own input', async (page) => {
  await page.click(jv('tab-compare'));
  await page.click(jv('sample-pair'));
  await page.click(`${jv('journeys')} [data-journey="SecondFactor"]`);
  assert.match(await page.innerText(jv('report')), /same in both exports/);
  await page.click(jv('tab-view'));
  assert.equal(await page.isHidden(jv('output')), true);
  await page.click(jv('tab-compare'));
  assert.equal(await page.isVisible(jv('output')), true);
});

await scenario('the diagram can be zoomed', async (page) => {
  await page.click(jv('sample'));
  const width = async () => Number(await page.getAttribute(`${jv('canvas')} svg`, 'width'));
  const fitted = await width();
  await page.click(jv('zoom-in'));
  assert.ok((await width()) > fitted);
  await page.click(jv('fit'));
  assert.equal(await width(), fitted);
});

await browser.close();
console.log(results.join('\n'));
