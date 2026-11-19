import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const BASE = process.env.BASE_URL ?? 'http://localhost:4399';
const CHROME = process.env.CHROME_PATH ?? '/usr/bin/google-chrome-stable';
const PATH = '/tools/metadata/';

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const results = [];
const md = (name) => `[data-md="${name}"]`;

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
  await page.waitForSelector(`${md('verdict')}[data-state="${state}"]`);
  return page.innerText(md('verdict'));
}

const ISSUER = 'https://login.test/realms/demo';
const discovery = {
  issuer: ISSUER,
  authorization_endpoint: `${ISSUER}/auth`,
  token_endpoint: `${ISSUER}/token`,
  jwks_uri: `${ISSUER}/certs`,
  code_challenge_methods_supported: ['S256'],
};
const json = (body) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

await scenario('the sample SAML metadata reports its expired certificate', async (page) => {
  assert.equal(await page.isHidden(md('output')), true);
  await page.click(md('sample-saml'));
  assert.match(await verdict(page, 'error'), /Identity provider metadata\. 1 certificate\(s\) expired/);
  const blocks = await page.innerText(md('blocks'));
  assert.match(blocks, /https:\/\/idp\.example\.com\/saml/);
  assert.match(blocks, /Sign-in \(HTTP-POST\)/);
  assert.match(blocks, /idp\.example\.com/);
  assert.match(blocks, /RSA 2048/);
  assert.match(blocks, /Expired .* ago/);
  assert.equal(await page.locator('.keys li[data-state="valid"]').count(), 1);
  assert.equal(await page.locator('.keys li[data-state="expired"]').count(), 1);
});

await scenario('a certificate shows its fingerprint', async (page) => {
  await page.click(md('sample-saml'));
  await page.locator('.keys li[data-state="expired"] summary').click();
  await page.waitForFunction(() => document.querySelector('.keys li[data-state="expired"] code')?.textContent?.startsWith('C8:AD:59'));
});

await scenario('the sample discovery document is explained', async (page) => {
  await page.click(md('sample-oidc'));
  assert.match(await verdict(page, 'ok'), /OpenID Connect provider\. Nothing needs attention/);
  const blocks = await page.innerText(md('blocks'));
  assert.match(blocks, /Tokens/);
  assert.match(blocks, /private_key_jwt/);
  assert.match(blocks, /Keys are read only when you give the address/);
});

await scenario('an issuer address is read together with its keys', async (page) => {
  await page.route(`${ISSUER}`, (route) => route.fulfill({ status: 404, body: 'no' }));
  await page.route(`${ISSUER}/.well-known/openid-configuration`, (route) => route.fulfill(json(discovery)));
  await page.route(`${ISSUER}/certs`, (route) =>
    route.fulfill(json({ keys: [{ kty: 'RSA', kid: 'key-1', use: 'sig', alg: 'RS256', n: 'A'.repeat(342), e: 'AQAB' }] })),
  );
  await page.fill(md('input'), ISSUER);
  assert.match(await verdict(page, 'ok'), /OpenID Connect provider/);
  const blocks = await page.innerText(md('blocks'));
  assert.match(blocks, /key-1/);
  assert.match(blocks, /RSA 2048, RS256/);
});

await scenario('an issuer that does not match its address is flagged', async (page) => {
  await page.route('https://other.test/.well-known/openid-configuration', (route) => route.fulfill(json(discovery)));
  await page.route(`${ISSUER}/certs`, (route) => route.fulfill(json({ keys: [] })));
  await page.fill(md('input'), 'https://other.test/.well-known/openid-configuration');
  assert.match(await verdict(page, 'error'), /1 thing\(s\) to check/);
  assert.match(await page.innerText(md('blocks')), /does not match the address/);
});

await scenario('an address that cannot be read says so', async (page) => {
  await page.route('https://down.test/**', (route) => route.abort());
  await page.fill(md('input'), 'https://down.test/metadata');
  assert.match(await verdict(page, 'error'), /could not be read from the browser/);
  assert.equal(await page.isHidden(md('output')), true);
});

await scenario('other text is not recognised', async (page) => {
  await page.fill(md('input'), 'hello there');
  assert.match(await verdict(page, 'error'), /not recognised/);
});

await scenario('clear empties the input and hides the result', async (page) => {
  await page.click(md('sample-oidc'));
  await verdict(page, 'ok');
  await page.click(md('clear'));
  await page.waitForSelector(`${md('verdict')}[data-state=""]`);
  assert.equal(await page.inputValue(md('input')), '');
  assert.equal(await page.isHidden(md('output')), true);
});

await browser.close();
console.log(results.join('\n'));
console.log(`\n${results.filter((line) => line.startsWith('PASS')).length}/${results.length} scenarios passed`);
