'use strict';

const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const baseUrl = String(process.env.AEGIS_LIVE_URL || 'https://aegispay-pro.pages.dev').replace(/\/+$/, '');
const sameOriginErrors = [];
const pageErrors = [];

async function visit(page, url, expectedSelector) {
  const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  assert.ok(response, 'No document response for ' + url);
  assert.equal(response.status(), 200, 'Unexpected HTTP status for ' + url + ': ' + response.status());
  await page.locator(expectedSelector).waitFor({ state: 'visible', timeout: 20000 });
  return response;
}

(async () => {
  let browser;
  try {
    assert.equal(new URL(baseUrl).protocol, 'https:', 'Live smoke tests must use HTTPS.');
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      serviceWorkers: 'block',
      reducedMotion: 'reduce'
    });

    const page = await context.newPage();
    page.on('pageerror', error => pageErrors.push('client: ' + error.message));
    page.on('response', response => {
      if (response.url().startsWith(baseUrl) && response.status() >= 400) {
        sameOriginErrors.push(response.status() + ' ' + response.url());
      }
    });

    await visit(page, baseUrl + '/', 'a.top-cta[href="/app/"]');
    assert.match(await page.title(), /AegisPay/i, 'Public landing page title should identify AegisPay.');
    assert.ok(await page.getByRole('link', { name: /Open App|Open secure web app/i }).count(),
      'Landing page should expose a working Open App route.');

    await visit(page, baseUrl + '/app/', '#liveLogin');
    const loginFields = await page.evaluate(() => ({
      usernameType: document.querySelector('#le')?.type,
      passwordType: document.querySelector('#lp')?.type,
      loginHeight: Math.round(document.querySelector('#liveLogin button[type="submit"]')?.getBoundingClientRect().height || 0),
      langHeight: Math.round(document.querySelector('.ap-auth [data-a="lang"]')?.getBoundingClientRect().height || 0),
      appVisible: !!document.querySelector('#app')
    }));
    assert.equal(loginFields.usernameType, 'text', 'Live Client login identifier must be readable.');
    assert.equal(loginFields.passwordType, 'password', 'Live Client password must remain masked.');
    assert.ok(loginFields.loginHeight >= 44, 'Live Client login button must provide a 44px touch target.');
    assert.ok(loginFields.langHeight >= 40, 'Live Client language button must provide a 40px touch target.');
    assert.ok(loginFields.appVisible, 'Live Client app root must render.');

    await page.locator('.ap-auth [data-a="lang"]').first().click();
    await page.locator('#ov.show').waitFor({ state: 'visible', timeout: 5000 });
    await page.locator('#sh [data-ap-lang="ur"]').click();
    assert.equal(await page.evaluate(() => localStorage.getItem('ap-lang')), 'ur',
      'Live Client language selection should persist Urdu.');
    await page.locator('.ap-auth [data-a="lang"]').first().click();
    await page.locator('#ov.show').waitFor({ state: 'visible', timeout: 5000 });
    await page.locator('#sh [data-ap-lang="en"]').click();
    assert.equal(await page.evaluate(() => localStorage.getItem('ap-lang')), 'en',
      'Live Client language selection should persist English.');

    const modeBefore = await page.evaluate(() => document.documentElement.getAttribute('data-mode'));
    await page.locator('.ap-auth [data-a="mode"]').first().click();
    const modeAfter = await page.evaluate(() => ({
      attr: document.documentElement.getAttribute('data-mode'),
      pref: localStorage.getItem('ap-mode')
    }));
    assert.ok(['light', 'dark'].includes(modeAfter.pref), 'Live Client theme selection should persist.');
    assert.notEqual(modeAfter.attr, modeBefore, 'Live Client theme button should change the visible theme.');

    const clientWidths = [];
    for (const width of [320, 360, 390, 430, 768, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      const dimensions = await page.evaluate(() => ({
        width: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        appVisible: !!document.querySelector('#app')
      }));
      assert.ok(dimensions.appVisible, 'Live Client app root disappeared at ' + width + 'px.');
      assert.ok(dimensions.documentWidth <= dimensions.width,
        'Live Client horizontal overflow at ' + width + 'px: ' + JSON.stringify(dimensions));
      clientWidths.push(width);
    }

    const adminPage = await context.newPage();
    adminPage.on('pageerror', error => pageErrors.push('admin: ' + error.message));
    adminPage.on('response', response => {
      if (response.url().startsWith(baseUrl) && response.status() >= 400) {
        sameOriginErrors.push(response.status() + ' ' + response.url());
      }
    });
    await visit(adminPage, baseUrl + '/admin/', '#aaLoginForm');
    const adminControls = await adminPage.evaluate(() => ({
      usernameType: document.querySelector('#aaUsername')?.type,
      passwordType: document.querySelector('#aaPassword')?.type,
      submitHeight: Math.round(document.querySelector('#aaLoginForm button[type="submit"]')?.getBoundingClientRect().height || 0),
      themeHeight: Math.round(document.querySelector('.aa-theme-toggle')?.getBoundingClientRect().height || 0),
      themeWidth: Math.round(document.querySelector('.aa-theme-toggle')?.getBoundingClientRect().width || 0)
    }));
    assert.equal(adminControls.usernameType, 'text', 'Live Master Admin username must be readable.');
    assert.equal(adminControls.passwordType, 'password', 'Live Master Admin password must remain masked.');
    assert.ok(adminControls.submitHeight >= 40, 'Live Master Admin login button must provide a 40px touch target.');
    assert.ok(adminControls.themeHeight >= 40, 'Live Master Admin theme button must provide a 40px touch target.');
    assert.ok(Math.abs(adminControls.themeWidth - adminControls.themeHeight) <= 1,
      'Live Master Admin theme button must be square: ' + JSON.stringify(adminControls));

    const adminModeBefore = await adminPage.evaluate(() => document.documentElement.getAttribute('data-mode'));
    await adminPage.locator('.aa-theme-toggle').click();
    assert.notEqual(await adminPage.evaluate(() => document.documentElement.getAttribute('data-mode')), adminModeBefore,
      'Live Master Admin theme control should change the theme.');

    const adminWidths = [];
    for (const width of [320, 390, 768, 1280]) {
      await adminPage.setViewportSize({ width, height: 844 });
      const dimensions = await adminPage.evaluate(() => ({
        width: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth
      }));
      assert.ok(dimensions.documentWidth <= dimensions.width,
        'Live Master Admin horizontal overflow at ' + width + 'px: ' + JSON.stringify(dimensions));
      adminWidths.push(width);
    }

    assert.deepEqual(sameOriginErrors, [], 'Live site returned failed same-origin resources: ' + sameOriginErrors.join(' | '));
    assert.deepEqual(pageErrors, [], 'Live site uncaught browser errors: ' + pageErrors.join(' | '));

    const configResponse = await fetch(baseUrl + '/supabase-client.js');
    assert.equal(configResponse.status, 200, 'Live Supabase client configuration must load.');
    const configText = await configResponse.text();
    const supabaseUrl = configText.match(/url:'([^']+)'/)?.[1];
    const publishableKey = configText.match(/publishableKey:'([^']+)'/)?.[1];
    assert.ok(supabaseUrl && publishableKey, 'Live Supabase client URL and publishable key must be configured.');

    // Server-side CAPTCHA enforcement regression checks. These requests use a
    // non-routable test email and the password-grant endpoint only; they do not
    // create accounts or mutate app/database state.
    const captchaCases = [
      {
        name: 'missing-token',
        payload: {
          email: 'turnstile-negative-check@example.invalid',
          password: 'AegisPay-CI-Password-Not-A-Real-Account-8042'
        }
      },
      {
        name: 'invalid-token',
        payload: {
          email: 'turnstile-negative-check@example.invalid',
          password: 'AegisPay-CI-Password-Not-A-Real-Account-8042',
          gotrue_meta_security: { captcha_token: 'invalid-turnstile-token-for-aegispay-ci' }
        }
      }
    ];
    for (const testCase of captchaCases) {
      const response = await fetch(supabaseUrl + '/auth/v1/token?grant_type=password', {
        method: 'POST',
        headers: { apikey: publishableKey, 'Content-Type': 'application/json' },
        body: JSON.stringify(testCase.payload)
      });
      const responseText = await response.text();
      let responseBody;
      try { responseBody = JSON.parse(responseText); } catch { responseBody = { raw: responseText }; }
      const errorText = JSON.stringify(responseBody);
      assert.ok(response.status >= 400 && response.status < 500,
        'Supabase Auth must reject ' + testCase.name + ' CAPTCHA requests with 4xx; received ' + response.status + ' ' + errorText);
      assert.match(errorText, /captcha|turnstile|security verification/i,
        'Supabase Auth must reject ' + testCase.name + ' specifically as a CAPTCHA failure; response was ' + errorText);
    }

    const protectedFunctions = [
      'ai-support',
      'execute-payout',
      'get-deposit-address',
      'monitor-deposits',
      'production-readiness',
      'record-user-access',
      'submit-deposit',
      'verify-deposit'
    ];
    const guardResults = [];
    for (const slug of protectedFunctions) {
      const response = await fetch(supabaseUrl + '/functions/v1/' + slug, {
        method: 'POST',
        headers: { apikey: publishableKey, 'Content-Type': 'application/json' },
        body: '{}'
      });
      assert.equal(response.status, 401,
        'Protected Edge Function ' + slug + ' must reject anonymous invocation with 401, received ' + response.status);
      guardResults.push(slug + '=401');
    }

    console.log('LIVE SMOKE PASS: landing page + Client + Master Admin; language/theme interactions passed; no same-origin HTTP errors or uncaught page errors.');
    console.log('Client viewports: ' + clientWidths.join(', ') + 'px. Master Admin viewports: ' + adminWidths.join(', ') + 'px.');
    console.log('Unauthenticated Edge Function guards: ' + guardResults.join(', ') + '.');
    const sweepGuardResponse = await fetch(supabaseUrl + '/functions/v1/sweep-deposit-wallets', {
      method: 'POST',
      headers: { apikey: publishableKey, 'Content-Type': 'application/json' },
      body: '{}'
    });
    assert.equal(sweepGuardResponse.status, 423,
      'Testnet sweep must remain disabled by default and reject invocation with 423.');
    const sweepGuardBody = await sweepGuardResponse.json();
    assert.equal(sweepGuardBody.code, 'TESTNET_SWEEP_DISABLED',
      'Testnet sweep must remain disabled by default rather than process wallets.');
    console.log('Testnet sweep guard: ' + sweepGuardResponse.status + ' (' + sweepGuardBody.code + ').');
    console.log('No credentials were used; no database writes, deposits, withdrawals, or payouts were attempted.');
    await context.close();
  } catch (error) {
    console.error(error && error.stack || error);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
  }
})();
