'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
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

    const loginFields = await page.evaluate(() => ({
      usernameType: document.querySelector('#le')?.type,
      passwordType: document.querySelector('#lp')?.type,
      usernameVisible: !!document.querySelector('#le') && getComputedStyle(document.querySelector('#le')).visibility !== 'hidden',
      usernameTextSecurity: getComputedStyle(document.querySelector('#le')).webkitTextSecurity || 'not-exposed',
      loginHeight: Math.round(document.querySelector('#liveLogin button[type="submit"]')?.getBoundingClientRect().height || 0),
      langHeight: Math.round(document.querySelector('.ap-auth [data-a="lang"]')?.getBoundingClientRect().height || 0)
    }));
    assert.equal(loginFields.usernameType, 'text', 'Login identifier must be a readable text input.');
    assert.equal(loginFields.passwordType, 'password', 'Password input must remain masked.');
    assert.equal(loginFields.usernameVisible, true, 'Login identifier must be visible.');
    assert.ok(loginFields.loginHeight >= 44, 'Primary login button should provide a 44px minimum touch target.');
    assert.ok(loginFields.langHeight >= 40, 'Language control should provide a 40px minimum touch target.');

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
    assert.deepEqual(pageErrors, [], 'Uncaught browser JavaScript errors: ' + pageErrors.join(' | '));
    console.log('Client browser smoke passed: readable login ID, masked password, language open/select/persist, theme toggle/persist, control sizes, and no horizontal overflow at ' + viewportResults.join(', ') + 'px.');
    await context.close();
  } catch (error) {
    console.error(error && error.stack || error);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})();
