'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
function whiteTextMinContrast(backgroundImage) {
  const rgb = [...String(backgroundImage).matchAll(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/g)]
    .map(m => m.slice(1, 4).map(n => Number(n) / 255));
  if (!rgb.length) return 0;
  const linear = c => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  const luminance = c => 0.2126 * linear(c[0]) + 0.7152 * linear(c[1]) + 0.0722 * linear(c[2]);
  return Math.min(...rgb.map(c => 1.05 / (luminance(c) + 0.05)));
}
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json; charset=utf-8'
};
const server = http.createServer((req, res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname); }
  catch { res.writeHead(400).end('Bad request'); return; }
  if (pathname === '/') pathname = '/client.html';
  const file = path.resolve(root, '.' + pathname);
  if (file !== root && !file.startsWith(root + path.sep)) {
    res.writeHead(403).end('Forbidden'); return;
  }
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404).end('Not found'); return;
  }
  res.writeHead(200, {
    'Content-Type': mime[path.extname(file)] || 'application/octet-stream',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  fs.createReadStream(file).pipe(res);
});

(async () => {
  let browser;
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(4173, '127.0.0.1', resolve);
    });
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      serviceWorkers: 'block',
      reducedMotion: 'reduce'
    });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.goto('http://127.0.0.1:4173/client.html', { waitUntil: 'domcontentloaded' });
    await page.locator('#liveLogin').waitFor({ state: 'visible', timeout: 15000 });
    const googleButton = page.locator('#liveLogin [data-google-auth]');
    await googleButton.waitFor({ state: 'visible', timeout: 5000 });
    const googleControl = await googleButton.evaluate(el => ({
      text: el.textContent,
      height: Math.round(el.getBoundingClientRect().height),
      disabled: el.disabled,
      buttonType: el.type
    }));
    assert.match(googleControl.text, /Continue with Google/i, 'Client login should present Google sign-in.');
    assert.equal(googleControl.buttonType, 'button', 'Google sign-in must not submit the password form.');
    assert.ok(googleControl.height >= 44, 'Google sign-in should provide a 44px minimum touch target.');
    assert.equal(googleControl.disabled, false, 'Google sign-in should be enabled before interaction.');

    const loginFields = await page.evaluate(() => ({
      usernameType: document.querySelector('#le')?.type,
      passwordType: document.querySelector('#lp')?.type,
      usernameValue: document.querySelector('#le')?.value,
      passwordValue: document.querySelector('#lp')?.value,
      usernameAutocomplete: document.querySelector('#le')?.autocomplete,
      passwordAutocomplete: document.querySelector('#lp')?.autocomplete,
      usernameReadonly: document.querySelector('#le')?.readOnly,
      passwordReadonly: document.querySelector('#lp')?.readOnly,
      usernamePlaceholder: document.querySelector('#le')?.placeholder,
      passwordPlaceholder: document.querySelector('#lp')?.placeholder,
      usernameVisible: !!document.querySelector('#le') && getComputedStyle(document.querySelector('#le')).visibility !== 'hidden',
      usernameTextSecurity: getComputedStyle(document.querySelector('#le')).webkitTextSecurity || 'not-exposed',
      loginHeight: Math.round(document.querySelector('#liveLogin button[type="submit"]')?.getBoundingClientRect().height || 0),
      langHeight: Math.round(document.querySelector('.ap-auth [data-a="lang"]')?.getBoundingClientRect().height || 0),
      loginBackground: getComputedStyle(document.querySelector('#liveLogin button[type="submit"]')).backgroundImage
    }));
    assert.equal(loginFields.usernameType, 'text', 'Login identifier must be a readable text input.');
    assert.equal(loginFields.passwordType, 'password', 'Password input must remain masked.');
    assert.equal(loginFields.usernameVisible, true, 'Login identifier must be visible.');
    assert.equal(loginFields.usernameValue, '', 'Login identifier must not be prefilled on first load.');
    assert.equal(loginFields.passwordValue, '', 'Password must not be prefilled on first load.');
    assert.equal(loginFields.usernameAutocomplete, 'off', 'Login identifier should disable browser autofill.');
    assert.equal(loginFields.passwordAutocomplete, 'off', 'Login password should disable browser autofill.');
    assert.equal(loginFields.usernameReadonly, true, 'Login identifier should resist autofill until user focus.');
    assert.equal(loginFields.passwordReadonly, true, 'Login password should resist autofill until user focus.');
    assert.equal(loginFields.usernamePlaceholder, 'Enter username or Client ID', 'Login identifier should not display a demo username.');
    assert.equal(loginFields.passwordPlaceholder, 'Enter your password', 'Password placeholder should not resemble a prefilled password.');
    await page.locator('#le').focus();
    assert.equal(await page.locator('#le').evaluate(el => el.readOnly), false, 'Username should become editable on focus.');
    await page.locator('#lp').focus();
    assert.equal(await page.locator('#lp').evaluate(el => el.readOnly), false, 'Password should become editable on focus.');
    assert.equal(await page.locator('#le').inputValue(), '', 'Focusing must not populate username automatically.');
    assert.equal(await page.locator('#lp').inputValue(), '', 'Focusing must not populate password automatically.');
    assert.ok(loginFields.loginHeight >= 44, 'Primary login button should provide a 44px minimum touch target.');
    assert.ok(loginFields.langHeight >= 40, 'Language control should provide a 40px minimum touch target.');
    const clientContrast = whiteTextMinContrast(loginFields.loginBackground);
    assert.ok(clientContrast >= 4.5, 'Client primary button white-text contrast is below WCAG AA: ' + clientContrast.toFixed(2));

    await page.locator('.ap-auth [data-a="lang"]').first().click();
    await page.locator('#ov.show').waitFor({ state: 'visible', timeout: 3000 });
    await page.locator('#sh [data-ap-lang="ur"]').click();
    assert.equal(await page.evaluate(() => localStorage.getItem('ap-lang')), 'ur', 'Urdu choice should persist.');
    await page.locator('.ap-auth [data-a="lang"]').first().click();
    await page.locator('#ov.show').waitFor({ state: 'visible', timeout: 3000 });
    await page.locator('#sh [data-ap-lang="en"]').click();
    assert.equal(await page.evaluate(() => localStorage.getItem('ap-lang')), 'en', 'English choice should persist.');

    const modeBefore = await page.evaluate(() => document.documentElement.getAttribute('data-mode'));
    await page.locator('.ap-auth [data-a="mode"]').first().click();
    const modeAfter = await page.evaluate(() => ({
      attr: document.documentElement.getAttribute('data-mode'),
      pref: localStorage.getItem('ap-mode')
    }));
    assert.ok(['light', 'dark'].includes(modeAfter.pref), 'Appearance button should persist an explicit theme.');
    assert.notEqual(modeAfter.attr, modeBefore, 'Appearance button should change the current theme.');

    // Render the real AI template without a live session so unresolved template-scope dependencies fail in CI.
    const aiTemplate = await page.evaluate(() => {
      const html = SC.bot();
      const scratch = document.createElement('div');
      scratch.innerHTML = html;
      return {
        hasMessages: !!scratch.querySelector('#aiMessages'),
        hasInput: !!scratch.querySelector('#aiInput'),
        hasSend: !!scratch.querySelector('#aiSend'),
        navLinks: scratch.querySelectorAll('nav a').length
      };
    });
    assert.ok(aiTemplate.hasMessages, 'AI Assistant template must render its message panel.');
    assert.ok(aiTemplate.hasInput && aiTemplate.hasSend, 'AI Assistant template must render its input and send button.');
    assert.ok(aiTemplate.navLinks >= 3, 'AI Assistant template must render its navigation without scope errors.');

    const viewportResults = [];
    for (const width of [320, 360, 390, 430, 768, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      const dimension = await page.evaluate(() => ({
        width: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        appWidth: Math.round(document.querySelector('#app')?.getBoundingClientRect().width || 0),
        appVisible: !!document.querySelector('#app')
      }));
      assert.ok(dimension.appVisible, 'Application root must remain rendered at ' + width + 'px.');
      assert.ok(dimension.documentWidth <= dimension.width, 'Horizontal overflow at viewport width ' + width + ': ' + JSON.stringify(dimension));
      viewportResults.push(width);
    }
    const adminPage = await context.newPage();
    await adminPage.setViewportSize({ width: 390, height: 844 });
    const adminErrors = [];
    adminPage.on('pageerror', error => adminErrors.push(error.message));
    await adminPage.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2', route =>
      route.fulfill({ path: path.join(root, 'supabase-sdk.js'), contentType: 'application/javascript' })
    );
    await adminPage.goto('http://127.0.0.1:4173/master-admin.html', { waitUntil: 'domcontentloaded' });
    await adminPage.locator('#aaLoginForm').waitFor({ state: 'visible', timeout: 15000 });
    const adminControls = await adminPage.evaluate(() => ({
      usernameType: document.querySelector('#aaUsername')?.type,
      passwordType: document.querySelector('#aaPassword')?.type,
      submitHeight: Math.round(document.querySelector('#aaLoginForm button[type="submit"]')?.getBoundingClientRect().height || 0),
      themeHeight: Math.round(document.querySelector('.aa-theme-toggle')?.getBoundingClientRect().height || 0),
      themeWidth: Math.round(document.querySelector('.aa-theme-toggle')?.getBoundingClientRect().width || 0),
      loginBackground: getComputedStyle(document.querySelector('#aaLoginForm button[type="submit"]')).backgroundImage
    }));
    assert.equal(adminControls.usernameType, 'text', 'Master Admin username must be readable.');
    assert.equal(adminControls.passwordType, 'password', 'Master Admin password must remain masked.');
    assert.ok(adminControls.submitHeight >= 40, 'Master Admin primary button should have a 40px minimum touch target.');
    assert.ok(adminControls.themeHeight >= 40, 'Master Admin theme button should have a 40px minimum touch target.');
    assert.ok(Math.abs(adminControls.themeWidth - adminControls.themeHeight) <= 1, 'Master Admin icon control should be square: ' + JSON.stringify(adminControls));
    const adminContrast = whiteTextMinContrast(adminControls.loginBackground);
    assert.ok(adminContrast >= 4.5, 'Master Admin primary button white-text contrast is below WCAG AA: ' + adminContrast.toFixed(2));
    const adminModeBefore = await adminPage.evaluate(() => document.documentElement.getAttribute('data-mode'));
    await adminPage.locator('.aa-theme-toggle').click();
    const adminModeAfter = await adminPage.evaluate(() => document.documentElement.getAttribute('data-mode'));
    assert.notEqual(adminModeAfter, adminModeBefore, 'Master Admin theme button should change the theme.');

    const adminViewportResults = [];
    for (const width of [320, 390, 768, 1280]) {
      await adminPage.setViewportSize({ width, height: 844 });
      const dims = await adminPage.evaluate(() => ({width: window.innerWidth, documentWidth: document.documentElement.scrollWidth}));
      assert.ok(dims.documentWidth <= dims.width, 'Master Admin horizontal overflow at ' + width + 'px: ' + JSON.stringify(dims));
      adminViewportResults.push(width);
    }
    assert.deepEqual(adminErrors, [], 'Master Admin uncaught browser JavaScript errors: ' + adminErrors.join(' | '));
    console.log('Client browser smoke passed at ' + viewportResults.join(', ') + 'px (primary contrast ' + clientContrast.toFixed(2) + ':1); Master Admin login/theme smoke passed at ' + adminViewportResults.join(', ') + 'px (primary contrast ' + adminContrast.toFixed(2) + ':1).');
    await context.close();
  } catch (error) {
    console.error(error && error.stack || error);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})();
