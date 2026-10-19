'use strict';

const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const baseUrl = String(process.env.AEGIS_LIVE_URL || 'https://aegispay-pro.pages.dev').replace(/\/+$/, '');
const fallbackUrl = String(process.env.AEGIS_FALLBACK_URL || '').replace(/\/+$/, '');
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
    // Mock the CAPTCHA browser API and intercept auth routes before they leave Chromium.
    // Dummy credentials are used only to verify that Login starts CAPTCHA and forwards its token; no backend login occurs.
    await context.addInitScript(() => {
      const stats = { renderCount: 0, executeCount: 0, resetCount: 0 };
      const widgets = new Map();
      let nextId = 0;
      window.__turnstileMockStats = stats;
      window.turnstile = {
        render: function (_container, options) {
          const id = 'live-smoke-widget-' + (++nextId);
          widgets.set(id, options);
          stats.renderCount += 1;
          return id;
        },
        execute: function (id) {
          stats.executeCount += 1;
          const widget = widgets.get(id);
          if (widget && typeof widget.callback === 'function') {
            widget.callback('live-smoke-token-' + stats.executeCount);
          }
        },
        reset: function () { stats.resetCount += 1; }
      };
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

    const clientSubmit = page.locator('#liveLogin button[type="submit"]');
    const clientVerify = page.locator('#liveLogin .aegis-turnstile-verify-button');
    assert.equal(await clientVerify.count(), 0, 'Live Client login must not show a separate human-verification button.');
    assert.equal(await clientSubmit.isDisabled(), true, 'Live Client Login must wait for valid login credentials.');
    assert.deepEqual(await page.evaluate(() => window.__turnstileMockStats), { renderCount: 0, executeCount: 0, resetCount: 0 },
      'Live Client Turnstile must not load or execute before Login is clicked.');

    // Intercept password auth in the browser so dummy smoke-test credentials never reach Supabase.
    let clientAuthRequest = null;
    await page.route('**/auth/v1/token**', async route => {
      const url = new URL(route.request().url());
      if (url.searchParams.get('grant_type') !== 'password') return route.continue();
      try { clientAuthRequest = route.request().postDataJSON(); } catch (_) { clientAuthRequest = null; }
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'invalid_credentials', error: 'invalid_grant', msg: 'Invalid login credentials' })
      });
    });
    await page.locator('#le').focus();
    await page.locator('#le').fill('live-smoke@example.invalid');
    await page.locator('#lp').focus();
    await page.locator('#lp').fill('not-a-real-password-for-live-smoke');
    assert.equal(await clientVerify.count(), 0, 'The separate verification button must remain removed after credentials are entered.');
    assert.equal(await clientSubmit.isDisabled(), false, 'Live Client Login should enable as soon as credentials are entered.');
    await clientSubmit.click();
    await page.waitForFunction(() => window.__turnstileMockStats.resetCount === 1, null, { timeout: 10000 });
    assert.ok(clientAuthRequest, 'Clicking Live Client Login should continue to password auth after the CAPTCHA callback.');
    assert.equal(clientAuthRequest.gotrue_meta_security?.captcha_token, 'live-smoke-token-1',
      'Live Client must forward the user-verified CAPTCHA token in Supabase Auth security metadata.');
    assert.deepEqual(await page.evaluate(() => window.__turnstileMockStats), { renderCount: 1, executeCount: 1, resetCount: 1 },
      'Live Client Turnstile should initialize and execute on Login click, then reset after the mocked auth attempt.');

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

    if (fallbackUrl) {
      const fallbackPage = await context.newPage();
      fallbackPage.on('pageerror', error => pageErrors.push('fallback: ' + error.message));
      fallbackPage.on('response', response => {
        if ((response.url().startsWith(fallbackUrl) || response.url().startsWith(baseUrl)) && response.status() >= 400) {
          sameOriginErrors.push('fallback ' + response.status() + ' ' + response.url());
        }
      });
      const fallbackResponse = await visit(fallbackPage, fallbackUrl + '/', '#liveLogin');
      assert.equal(new URL(fallbackPage.url()).origin, new URL(fallbackUrl).origin,
        'Fallback portal must stay on workers.dev instead of redirecting the browser to pages.dev.');
      assert.equal(fallbackResponse.headers()['x-aegispay-portal-source'], 'canonical-pages-proxy',
        'Fallback route must serve the current canonical Pages application through the proxy.');
      const fallbackTurnstileScript = await fallbackPage.request.get(fallbackUrl + '/aegis-turnstile.js');
      assert.equal(fallbackTurnstileScript.status(), 200, 'Fallback route must load the current Turnstile asset.');
      assert.match(await fallbackTurnstileScript.text(), /0x4AAAAAAFZaOeTke8FQpVNS/,
        'Fallback Turnstile asset must contain the configured public site key.');

      let fallbackAuthRequest = null;
      await fallbackPage.route('**/auth/v1/token**', async route => {
        const url = new URL(route.request().url());
        if (url.searchParams.get('grant_type') !== 'password') return route.continue();
        try { fallbackAuthRequest = route.request().postDataJSON(); } catch (_) { fallbackAuthRequest = null; }
        await route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({ code: 'invalid_credentials', error: 'invalid_grant', msg: 'Invalid login credentials' })
        });
      });
      await fallbackPage.locator('#le').fill('fallback-smoke@example.invalid');
      await fallbackPage.locator('#lp').fill('not-a-real-password-for-live-smoke');
      const fallbackSubmit = fallbackPage.locator('#liveLogin button[type="submit"]');
      assert.equal(await fallbackSubmit.isDisabled(), false, 'Fallback Client Login should enable after credentials.');
      await fallbackSubmit.click();
      await fallbackPage.waitForFunction(() => window.__turnstileMockStats.resetCount === 1, null, { timeout: 10000 });
      assert.ok(fallbackAuthRequest, 'Fallback Login should continue to the mocked Auth endpoint after CAPTCHA.');
      assert.equal(fallbackAuthRequest.gotrue_meta_security?.captcha_token, 'live-smoke-token-1',
        'Fallback Login must forward the CAPTCHA token to Supabase Auth metadata.');
      assert.deepEqual(await fallbackPage.evaluate(() => window.__turnstileMockStats), { renderCount: 1, executeCount: 1, resetCount: 1 },
        'Fallback Turnstile must initialize and execute on Login click, then reset after the mocked auth attempt.');

      const fallbackAdminResponse = await fallbackPage.request.get(fallbackUrl + '/admin/');
      assert.equal(fallbackAdminResponse.status(), 200, 'Fallback Master Admin route must render through the proxy.');
      assert.match(await fallbackAdminResponse.text(), /id="aaLoginForm"/,
        'Fallback Master Admin route must serve the current Admin login page.');
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

    const adminSubmit = adminPage.locator('#aaLoginForm button[type="submit"]');
    const adminVerify = adminPage.locator('#aaLoginForm .aegis-turnstile-verify-button');
    assert.equal(await adminVerify.count(), 0, 'Live Master Admin login must not show a separate human-verification button.');
    assert.equal(await adminSubmit.isDisabled(), true, 'Live Master Admin Login must wait for both credentials.');
    assert.deepEqual(await adminPage.evaluate(() => window.__turnstileMockStats), { renderCount: 0, executeCount: 0, resetCount: 0 },
      'Live Master Admin Turnstile must not load or execute before Login is clicked.');

    // Intercept the username-login edge call so test credentials never reach the backend.
    let adminAuthRequest = null;
    const corsHeaders = {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
      'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info',
      'access-control-max-age': '600'
    };
    await adminPage.route('**/functions/v1/username-login**', async route => {
      if (route.request().method() === 'OPTIONS') {
        await route.fulfill({ status: 204, headers: corsHeaders });
        return;
      }
      try { adminAuthRequest = route.request().postDataJSON(); } catch (_) { adminAuthRequest = null; }
      await route.fulfill({
        status: 400,
        headers: corsHeaders,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Invalid username or password.' })
      });
    });
    // Admin login signs out after a mocked auth failure; keep that cleanup request local too.
    await adminPage.route('**/auth/v1/logout**', async route => {
      if (route.request().method() === 'OPTIONS') {
        await route.fulfill({ status: 204, headers: corsHeaders });
        return;
      }
      await route.fulfill({ status: 204, headers: corsHeaders });
    });
    await adminPage.locator('#aaUsername').fill('live-smoke-admin');
    await adminPage.locator('#aaPassword').fill('not-a-real-password-for-live-smoke');
    assert.equal(await adminVerify.count(), 0, 'The separate verification button must remain removed on Master Admin login.');
    assert.equal(await adminSubmit.isDisabled(), false, 'Live Master Admin Login should enable after both credentials.');
    await adminSubmit.click();
    await adminPage.waitForFunction(() => window.__turnstileMockStats.executeCount === 1, null, { timeout: 10000 });
    assert.ok(adminAuthRequest, 'Clicking Master Admin Login should continue to username auth after CAPTCHA verification.');
    assert.equal(adminAuthRequest.captchaToken, 'live-smoke-token-1',
      'Master Admin must forward the user-verified CAPTCHA token to the username-login endpoint.');
    assert.deepEqual(await adminPage.evaluate(() => window.__turnstileMockStats), { renderCount: 1, executeCount: 1, resetCount: 0 },
      'Master Admin Turnstile should initialize and execute on Login click; the admin login render replaces the form before the detached widget reset.');

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

    // Validate the stable workers.dev fallback only in the production deploy
    // workflow, after it has deployed the proxy. Pull-request CI must not depend
    // on mutating or pre-deploy state of that live Worker.
    if (fallbackUrl) {
      const fallbackRoot = await fetch(fallbackUrl + '/', { redirect: 'manual' });
      assert.equal(fallbackRoot.status, 200, 'Fallback Worker root must serve the Client Portal without redirecting to pages.dev.');
      assert.equal(fallbackRoot.headers.get('x-aegispay-portal-source'), 'canonical-pages-proxy',
        'Fallback Worker must identify the current canonical proxy response.');
      assert.match(await fallbackRoot.text(), /id="liveLogin"/,
        'Fallback Worker root must serve the current Client login HTML.');

      const fallbackAdmin = await fetch(fallbackUrl + '/admin/', { redirect: 'manual' });
      assert.equal(fallbackAdmin.status, 200, 'Fallback Worker Admin route must serve the current Master Admin without redirecting.');
      assert.equal(fallbackAdmin.headers.get('x-aegispay-portal-source'), 'canonical-pages-proxy');
      assert.match(await fallbackAdmin.text(), /id="aaLoginForm"/,
        'Fallback Worker Admin route must serve the Admin login form.');

      const fallbackVerified = await fetch(fallbackUrl + '/?verified=1&keep=1', { redirect: 'manual' });
      assert.equal(fallbackVerified.status, 200, 'Fallback email-verification return must remain on the workers.dev origin.');
      assert.equal(fallbackVerified.headers.get('x-aegispay-portal-source'), 'canonical-pages-proxy');
      const fallbackReset = await fetch(fallbackUrl + '/?reset=1', { redirect: 'manual' });
      assert.equal(fallbackReset.status, 200, 'Fallback password-reset callback must remain on workers.dev.');
      assert.match(await fallbackReset.text(), /PASSWORD_RESET_COMPLETE/,
        'Fallback password-reset callback must retain the recovery flow.');
    }

    // This alias is newly deployed by the main-branch release workflow.
    // Gate only this assertion during pull-request CI; production deploy smoke sets
    // the flag after Wrangler has published the redirect Worker.
    if (process.env.AEGIS_CHECK_LEGACY_HOTFIX === '1') {
      const legacyHotfixBase = 'https://aegispay-web-hotfix.aegispay.workers.dev';
      const legacyHotfixRoot = await fetch(legacyHotfixBase + '/', { redirect: 'manual' });
      assert.equal(legacyHotfixRoot.status, 302, 'Legacy hotfix root must redirect to the canonical Client Portal.');
      assert.equal(new URL(legacyHotfixRoot.headers.get('location')).href, baseUrl + '/app/',
        'Legacy hotfix root must not redirect to a missing Worker.');
      const legacyHotfixAdmin = await fetch(legacyHotfixBase + '/master-admin.html', { redirect: 'manual' });
      assert.equal(legacyHotfixAdmin.status, 302, 'Legacy hotfix Master Admin route must redirect.');
      assert.equal(new URL(legacyHotfixAdmin.headers.get('location')).href, baseUrl + '/admin/',
        'Legacy hotfix Master Admin route must reach the canonical Admin portal.');
      const legacyHotfixQuery = await fetch(legacyHotfixBase + '/?verified=1&keep=1', { redirect: 'manual' });
      assert.equal(new URL(legacyHotfixQuery.headers.get('location')).href, baseUrl + '/app/?verified=1&keep=1',
        'Legacy hotfix redirect must preserve verification query parameters.');
    }

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
