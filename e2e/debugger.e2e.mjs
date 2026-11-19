import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const BASE = process.env.BASE_URL ?? 'http://localhost:4399';
const CHROME = process.env.CHROME_PATH ?? '/usr/bin/google-chrome-stable';

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const results = [];
const db = (name) => `[data-db="${name}"]`;

async function scenario(name, path, run) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto(BASE + path);
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
  await page.waitForSelector(`${db('verdict')}[data-state="${state}"]`);
  return page.innerText(db('verdict'));
}

const part = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const jwt = (payload) => `${part({ alg: 'RS256', typ: 'JWT' })}.${part(payload)}.c2ln`;
const now = Math.floor(Date.now() / 1000);

await scenario('the sample JWT is analysed and explained', '/tools/debugger/', async (page) => {
  assert.equal(await page.isHidden(db('output')), true);
  await page.click(db('sample-jwt'));
  assert.match(await verdict(page, 'ok'), /Valid token/);
  const summary = await page.innerText(db('summary'));
  assert.match(summary, /JWT/);
  assert.match(summary, /https:\/\/login\.example\.com/);
  assert.match(await page.innerText(db('claims')), /Ana García/);
  assert.match(await page.textContent(db('raw')), /"alg": "ES256"/);
});

await scenario('the sample SAML is analysed and shows its attributes', '/tools/debugger/', async (page) => {
  await page.click(db('sample-saml'));
  assert.match(await verdict(page, 'ok'), /Successful sign-in/);
  assert.match(await page.innerText(db('summary')), /SAML response/);
  assert.match(await page.innerText(db('claims')), /ana@example\.com/);
  assert.match(await page.textContent(db('raw')), /\n {2}<saml:Issuer>/);
});

await scenario('an expired JWT is reported as expired', '/tools/debugger/', async (page) => {
  await page.fill(db('input'), jwt({ sub: 'ana', exp: now - 7200 }));
  assert.match(await verdict(page, 'error'), /Expired token/);
});

await scenario('a SAML request inside a URL is extracted', '/tools/debugger/', async (page) => {
  const url = await page.evaluate(async () => {
    const xml =
      '<samlp:AuthnRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_1" AssertionConsumerServiceURL="https://app.test/acs"><saml:Issuer>https://app.test</saml:Issuer></samlp:AuthnRequest>';
    const stream = new Blob([xml]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    return `https://idp.test/sso?SAMLRequest=${encodeURIComponent(btoa(String.fromCharCode(...bytes)))}&RelayState=x`;
  });
  await page.fill(db('input'), url);
  assert.match(await verdict(page, 'ok'), /Sign-in request/);
  assert.match(await page.innerText(db('summary')), /https:\/\/app\.test\/acs/);
});

await scenario('arbitrary text is not recognised', '/tools/debugger/', async (page) => {
  await page.fill(db('input'), 'hello, this is not a token');
  assert.match(await verdict(page, 'error'), /not recognised/);
  assert.equal(await page.isHidden(db('output')), true);
});

await scenario('clear empties the input and hides the result', '/tools/debugger/', async (page) => {
  await page.click(db('sample-jwt'));
  await verdict(page, 'ok');
  await page.click(db('clear'));
  assert.equal(await page.inputValue(db('input')), '');
  assert.equal(await page.isHidden(db('output')), true);
});

await browser.close();
console.log(results.join('\n'));
console.log(`\n${results.filter((r) => r.startsWith('PASS')).length}/${results.length} scenarios passed`);
