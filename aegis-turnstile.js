(function () {
  'use strict';

  // Public Cloudflare Turnstile sitekey. Supabase Auth must be configured with
  // the matching secret before CAPTCHA enforcement is enabled in production.
  var SITEKEY = '0x4AAAAAAFZaOeTke8FQpVNS';
  var TEST_SITEKEY = '1x00000000000000000000AA';
  var AUTH_FORMS = new Set(['liveLogin', 'liveSignup', 'forgotForm', 'aaLoginForm']);
  var states = new WeakMap();
  var apiPromise = null;

  var style = document.createElement('style');
  style.textContent = [
    '.aegis-turnstile-wrap{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;width:100%;max-width:100%;margin:12px 0 14px;min-height:0;overflow:visible}',
    '.aegis-turnstile-widget{display:flex;justify-content:center;align-items:center;width:100%;min-height:0;max-width:100%;overflow:visible}',
    '.aegis-turnstile-status{display:block;width:100%;font:500 11px/1.45 system-ui,sans-serif;color:var(--mut,#8a7a68);text-align:center;min-height:0}',
    '.aegis-turnstile-status:empty{display:none}',
    '.aa-login .aegis-turnstile-wrap{margin:14px 0}',
    '.aa-login .aegis-turnstile-status{color:var(--muted,#8a7a68)}'
  ].join('');
  (document.head || document.documentElement).appendChild(style);

  function loadApi() {
    if (window.turnstile && typeof window.turnstile.render === 'function') return Promise.resolve();
    if (apiPromise) return apiPromise;
    apiPromise = new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      var timeout = window.setTimeout(function () {
        reject(new Error('Cloudflare security verification did not load. Please refresh and try again.'));
      }, 20000);
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.defer = true;
      script.onload = function () {
        window.clearTimeout(timeout);
        if (window.turnstile && typeof window.turnstile.render === 'function') resolve();
        else reject(new Error('Cloudflare security verification is unavailable. Please refresh.'));
      };
      script.onerror = function () {
        window.clearTimeout(timeout);
        reject(new Error('Cloudflare security verification could not load. Check your connection and retry.'));
      };
      document.head.appendChild(script);
    });
    return apiPromise;
  }

  function resolvedSitekey() {
    var host = String(window.location && window.location.hostname || '').toLowerCase();
    // Cloudflare's official always-pass test key is only used by localhost browser smoke tests.
    // Production uses the real sitekey and only its configured production/appasset hostnames.
    if (host === 'localhost' || host === '127.0.0.1') return TEST_SITEKEY;
    var config = window.AegisSupabaseConfig || {};
    return String(config.turnstileSiteKey || SITEKEY);
  }

  function attach(form) {
    if (!form || !AUTH_FORMS.has(form.id) || states.has(form)) return states.get(form) || null;
    var wrap = document.createElement('div');
    wrap.className = 'aegis-turnstile-wrap';
    wrap.setAttribute('aria-label', 'Cloudflare security verification');
    var widget = document.createElement('div');
    widget.className = 'aegis-turnstile-widget';
    var status = document.createElement('div');
    status.className = 'aegis-turnstile-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.textContent = 'Loading security verification…';
    wrap.appendChild(widget);
    wrap.appendChild(status);

    var submit = form.querySelector('button[type="submit"],input[type="submit"]');
    if (submit && submit.parentNode === form) form.insertBefore(wrap, submit);
    else form.appendChild(wrap);

    var state = { wrap: wrap, widget: widget, status: status, widgetId: null, token: '', issuedAt: 0, error: null, readyResolve: null, readyReject: null };
    state.ready = new Promise(function (resolve, reject) { state.readyResolve = resolve; state.readyReject = reject; });
    states.set(form, state);

    loadApi().then(function () {
      if (!form.isConnected || state.widgetId !== null) return;
      var sitekey = resolvedSitekey();
      state.widgetId = window.turnstile.render(widget, {
        sitekey: sitekey,
        theme: 'auto',
        callback: function (token) {
          state.token = String(token || '');
          state.issuedAt = Date.now();
          state.error = null;
          status.textContent = '';
        },
        'expired-callback': function () {
          state.token = '';
          state.issuedAt = 0;
          status.textContent = 'Security check expired. Please complete it again.';
        },
        'error-callback': function () {
          state.token = '';
          state.issuedAt = 0;
          state.error = new Error('Cloudflare security verification failed. Please refresh and try again.');
          status.textContent = state.error.message;
        },
        'timeout-callback': function () {
          state.token = '';
          state.issuedAt = 0;
          status.textContent = 'Security check timed out. Please complete it again.';
        }
      });
      state.readyResolve();
      status.textContent = 'Complete the security check to continue.';
    }).catch(function (error) {
      state.error = error instanceof Error ? error : new Error('Security verification unavailable.');
      status.textContent = state.error.message;
      state.readyReject(state.error);
    });
    // Avoid an unhandled rejection when a form is rendered but never submitted.
    state.ready.catch(function () {});
    return state;
  }

  function scan(root) {
    var scope = root && root.querySelectorAll ? root : document;
    if (scope.matches && scope.matches('form')) attach(scope);
    Array.prototype.forEach.call(scope.querySelectorAll('form#liveLogin,form#liveSignup,form#forgotForm,form#aaLoginForm'), attach);
  }

  async function requireToken(form) {
    if (!form || !AUTH_FORMS.has(form.id)) throw new Error('Security verification is unavailable for this form.');
    var state = states.get(form) || attach(form);
    if (!state) throw new Error('Security verification could not be initialized. Please refresh.');
    if (state.error) throw state.error;
    if (state.widgetId === null) {
      try { await state.ready; } catch (error) { throw state.error || error; }
    }
    if (!state.token || Date.now() - state.issuedAt >= 240000) {
      state.token = '';
      state.issuedAt = 0;
      state.status.textContent = 'Please complete the Cloudflare security check, then submit again.';
      throw new Error('Please complete the Cloudflare security check before continuing.');
    }
    var token = state.token;
    state.token = '';
    state.issuedAt = 0;
    return token;
  }

  function reset(form) {
    var state = form && states.get(form);
    if (!state) return;
    state.token = '';
    state.issuedAt = 0;
    state.error = null;
    if (state.status) state.status.textContent = 'Complete the security check to continue.';
    if (window.turnstile && state.widgetId !== null) {
      try { window.turnstile.reset(state.widgetId); } catch (_) {}
    }
  }

  window.AegisTurnstile = {
    requireToken: requireToken,
    reset: reset,
    isReady: function () { return !!(window.turnstile && typeof window.turnstile.render === 'function'); }
  };

  var observer = new MutationObserver(function (records) {
    records.forEach(function (record) {
      Array.prototype.forEach.call(record.addedNodes, function (node) {
        if (node && node.nodeType === 1) scan(node);
      });
    });
  });
  if (document.documentElement) observer.observe(document.documentElement, { childList: true, subtree: true });
  scan(document);
})();