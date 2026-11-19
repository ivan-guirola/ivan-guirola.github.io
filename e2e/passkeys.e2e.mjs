import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const BASE = process.env.BASE_URL ?? 'http://localhost:4399';
const CHROME = process.env.CHROME_PATH ?? '/usr/bin/google-chrome-stable';

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const results = [];

async function scenario(name, path, authenticator, run) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    if (authenticator) {
      const cdp = await context.newCDPSession(page);
      await cdp.send('WebAuthn.enable');
      await cdp.send('WebAuthn.addVirtualAuthenticator', {
        options: {
          protocol: 'ctap2',
          transport: 'internal',
          hasResidentKey: true,
          hasUserVerification: true,
          isUserVerified: true,
          automaticPresenceSimulation: true,
          ...authenticator,
        },
      });
    }
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

const pk = (name) => `[data-pk="${name}"]`;

async function register(page) {
  await page.fill('[name="userName"]', 'Ana');
  await page.click(pk('create'));
  await page.waitForSelector(`${pk('register-status')}[data-state="ok"]`);
}

async function authenticate(page) {
  await page.click(pk('authenticate'));
  await page.waitForSelector(`${pk('auth-status')}[data-state]:not([data-state=""])`);
  return page.$$eval(`${pk('checks')} li`, (items) => items.map((li) => [li.dataset.check, li.dataset.ok]));
}

const allPass = [
  ['type', 'true'],
  ['challenge', 'true'],
  ['origin', 'true'],
  ['rpId', 'true'],
  ['userPresent', 'true'],
  ['signature', 'true'],
];

await scenario('creates a passkey and shows what the authenticator returned', '/tools/passkeys/', {}, async (page) => {
  assert.equal(await page.isDisabled(pk('authenticate')), true, 'no passkey, no sign-in');
  await register(page);
  const text = await page.textContent(pk('registration'));
  assert.match(await page.innerText(pk('register-status')), /Ana/);
  assert.equal(await page.getAttribute(pk('where-device'), 'data-filled'), '');
  assert.match(text, /ES256 \(COSE -7\)/);
  assert.match(text, /"kty":"EC"/);
  assert.match(text, /internal/);
  assert.equal(await page.isDisabled(pk('authenticate')), false);
});

await scenario('signs in and passes the six checks', '/tools/passkeys/', {}, async (page) => {
  await register(page);
  assert.deepEqual(await authenticate(page), allPass);
  assert.equal(await page.getAttribute(pk('auth-status'), 'data-state'), 'ok');
});

await scenario('keeps the passkey across reloads and deletes it on request', '/tools/passkeys/', {}, async (page) => {
  await register(page);
  await page.reload();
  assert.match(await page.innerText(pk('where-browser')), /Ana/, 'restored from localStorage');
  assert.deepEqual(await authenticate(page), allPass);

  await page.click(pk('forget'));
  assert.equal(await page.isHidden(pk('details')), true);
  assert.equal(await page.getAttribute(pk('where-device'), 'data-filled'), null);
  assert.equal(await page.isDisabled(pk('authenticate')), true);
  await page.reload();
  assert.equal(await page.isDisabled(pk('authenticate')), true, 'still deleted after reload');
});

await scenario('works with an RS256-only authenticator', '/tools/passkeys/', { transport: 'usb' }, async (page) => {
  await page.addInitScript(() => {
    const create = navigator.credentials.create.bind(navigator.credentials);
    navigator.credentials.create = (options) => {
      options.publicKey.pubKeyCredParams = [{ type: 'public-key', alg: -257 }];
      return create(options);
    };
  });
  await page.reload();
  await register(page);
  assert.match(await page.textContent(pk('registration')), /RS256 \(COSE -257\)/);
  assert.deepEqual(await authenticate(page), allPass);
});

await scenario('reports the failure when the authenticator refuses', '/tools/passkeys/', null, async (page) => {
  await page.addInitScript(() => {
    navigator.credentials.create = () => Promise.reject(new DOMException('denied', 'NotAllowedError'));
  });
  await page.reload();
  await page.fill('[name="userName"]', 'Ana');
  await page.click(pk('create'));
  await page.waitForSelector(`${pk('register-status')}[data-state="error"]`);
  assert.match(await page.innerText(pk('register-status')), /cancelled/);
  assert.equal(await page.isDisabled(pk('create')), false, 'can retry');
});

await scenario('warns when the browser has no WebAuthn', '/tools/passkeys/', null, async (page) => {
  await page.addInitScript(() => {
    delete window.PublicKeyCredential;
  });
  await page.reload();
  assert.equal(await page.isVisible(pk('unsupported')), true);
  assert.equal(await page.isDisabled(pk('create')), true);
});

await browser.close();
console.log(results.join('\n'));
console.log(`\n${results.filter((r) => r.startsWith('PASS')).length}/${results.length} scenarios passed`);
