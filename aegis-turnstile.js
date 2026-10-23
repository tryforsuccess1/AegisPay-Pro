(function () {
  'use strict';

  // The helper can be encountered through an HTML document and a stale shell cache
  // during an update. Initialize its observer/widgets only once per page.
  var HELPER_INIT_KEY = '__AEGIS_TURNSTILE_HELPER_INITIALIZED__';
  if (window[HELPER_INIT_KEY]) return;
  window[HELPER_INIT_KEY] = true;

  // Share the loader promise across duplicate script evaluations as a second guard.
  var API_PROMISE_KEY = '__AEGIS_TURNSTILE_API_PROMISE__';

  // Public Cloudflare Turnstile sitekey. The matching secret remains server-side.
  var SITEKEY = '0x4AAAAAAFZaOeTke8FQpVNS';
  var TEST_SITEKEY = '1x00000000000000000000AA';
  var AUTH_FORMS = new Set(['liveLogin', 'liveSignup', 'forgotForm', 'aaLoginForm']);
  var MANUAL_LOGIN_FORMS = new Set(['liveLogin', 'aaLoginForm']);
  var states = new WeakMap();
  var apiPromise = null;
  var API_LOAD_TIMEOUT_MS = 10000;
  var VERIFY_RETRY_LIMIT = 1;
  var VERIFY_RETRY_DELAY_MS = 1000;
  var VERIFY_ATTEMPT_TIMEOUT_MS = 30000;

  function preconnectCloudflare() {
    var head = document.head || document.documentElement;
    if (!head || document.querySelector('link[data-aegis-turnstile-preconnect]')) return;
    var link = document.createElement('link');
    link.rel = 'preconnect';
    link.href = 'https://challenges.cloudflare.com';
    link.crossOrigin = 'anonymous';
    link.setAttribute('data-aegis-turnstile-preconnect', 'true');
    head.appendChild(link);
  }
  preconnectCloudflare();

  var style = document.createElement('style');
  style.textContent = [
    '.aegis-turnstile-wrap{display:flex;flex-direction:column;align-items:stretch;justify-content:center;gap:8px;width:100%;max-width:100%;margin:12px 0 14px;min-height:0;overflow:visible}',
    '.aegis-turnstile-widget{display:flex;justify-content:center;align-items:center;width:100%;min-height:0;max-width:100%;overflow:visible}',
    '.aegis-turnstile-status{display:block;width:100%;font:500 11px/1.45 system-ui,sans-serif;color:var(--mut,#8a7a68);text-align:center;min-height:0}',
    '.aegis-turnstile-status:empty{display:none}',
    '.aegis-turnstile-wrap[data-manual-login="true"]:not([data-challenge-active="true"]){display:none}',
    '.aegis-turnstile-wrap[data-manual-login="true"] .aegis-turnstile-widget{min-height:0}',
    '.aa-login .aegis-turnstile-wrap{margin:14px 0}',
    '.aa-login .aegis-turnstile-status{color:var(--muted,#8a7a68)}'
  ].join('');
  (document.head || document.documentElement).appendChild(style);

  function loadApi() {
    if (window.turnstile && typeof window.turnstile.render === 'function') return Promise.resolve();
    if (window[API_PROMISE_KEY]) {
      apiPromise = window[API_PROMISE_KEY];
      return apiPromise;
    }
    if (apiPromise) return apiPromise;

    apiPromise = new Promise(function (resolve, reject) {
      function apiReady() {
        return !!(window.turnstile && typeof window.turnstile.render === 'function');
      }

      function loadAttempt(attempt) {
        if (apiReady()) {
          resolve();
          return;
        }

        // Reuse an already-inserted Turnstile API script rather than adding a
        // second copy if another loader or a slow first request is still active.
        var script = document.querySelector('script[src*="challenges.cloudflare.com/turnstile/v0/api.js"]');
        var created = !script;
        var finished = false;
        var poll = null;
        var timeout = null;
        if (!script) {
          script = document.createElement('script');
          script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
          script.async = true;
          script.defer = true;
        }

        function cleanup() {
          if (timeout !== null) window.clearTimeout(timeout);
          if (poll !== null) window.clearInterval(poll);
          script.removeEventListener('load', onLoad);
          script.removeEventListener('error', onError);
        }

        function succeed() {
          if (finished || !apiReady()) return;
          finished = true;
          cleanup();
          resolve();
        }

        function fail(error, removeFailedScript) {
          if (finished) return;
          finished = true;
          cleanup();
          // A timeout is not proof that the browser request has stopped. Keep
          // the element so the retry can attach to it instead of double-loading.
          if (removeFailedScript && created && script.isConnected) script.remove();
          if (attempt < 1) {
            window.setTimeout(function () {
              if (apiReady()) {
                resolve();
                return;
              }
              loadAttempt(attempt + 1);
            }, VERIFY_RETRY_DELAY_MS);
            return;
          }
          if (window[API_PROMISE_KEY] === apiPromise) window[API_PROMISE_KEY] = null;
          apiPromise = null;
          reject(error);
        }

        function onLoad() {
          if (apiReady()) {
            succeed();
            return;
          }
          // The API script can finish its load event just before exposing the
          // global; the short poll below will settle it if it appears.
        }

        function onError() {
          fail(new Error('Cloudflare security verification could not load. Retrying automatically…'), true);
        }

        script.addEventListener('load', onLoad);
        script.addEventListener('error', onError);
        poll = window.setInterval(function () {
          if (apiReady()) succeed();
        }, 50);
        timeout = window.setTimeout(function () {
          fail(new Error('Cloudflare security verification did not load. Please check your connection and try again.'), false);
        }, API_LOAD_TIMEOUT_MS);

        if (created) document.head.appendChild(script);
      }

      loadAttempt(0);
    });

    window[API_PROMISE_KEY] = apiPromise;
    apiPromise.catch(function () {
      if (window[API_PROMISE_KEY] === apiPromise) window[API_PROMISE_KEY] = null;
      apiPromise = null;
    });
    return apiPromise;
  }

  function resolvedSitekey() {
    var host = String(window.location && window.location.hostname || '').toLowerCase();
    // Cloudflare's official always-pass test key is only used by localhost browser smoke tests.
    if (host === 'localhost' || host === '127.0.0.1') return TEST_SITEKEY;
    var config = window.AegisSupabaseConfig || {};
    return String(config.turnstileSiteKey || SITEKEY);
  }

  function credentialInputs(form) {
    if (!form) return [];
    if (form.id === 'liveLogin') {
      return [form.querySelector('#le'), form.querySelector('#lp')].filter(Boolean);
    }
    if (form.id === 'aaLoginForm') {
      return [form.querySelector('#aaUsername'), form.querySelector('#aaPassword')].filter(Boolean);
    }
    return [];
  }

  function credentialsReady(form) {
    var inputs = credentialInputs(form);
    return inputs.length === 2 && inputs.every(function (input) {
      return !input.disabled && String(input.value || '').trim().length > 0 && input.checkValidity();
    });
  }

  function setCredentialInputsDisabled(state, disabled) {
    credentialInputs(state.form).forEach(function (input) { input.disabled = !!disabled; });
  }

  function syncManualControls(state) {
    if (!state || !state.manual) return;
    var ready = credentialsReady(state.form);
    var hasFreshToken = !!state.token && Date.now() - state.issuedAt < 240000;
    if (!hasFreshToken && state.token) {
      state.token = '';
      state.issuedAt = 0;
    }
    // The Login button starts verification; it is not gated by a separate verification button.
    if (state.submit) state.submit.disabled = !ready || state.inProgress || state.busy || hasFreshToken;
  }

  function settleVerification(state, token, error) {
    var resolve = state.pendingResolve;
    var reject = state.pendingReject;
    if (state.verificationTimer) window.clearTimeout(state.verificationTimer);
    if (state.retryTimer) window.clearTimeout(state.retryTimer);
    state.verificationTimer = null;
    state.retryTimer = null;
    state.pendingResolve = null;
    state.pendingReject = null;
    state.pendingPromise = null;
    if (error) {
      if (reject) reject(error);
    } else if (resolve) {
      resolve(token);
    }
  }

  function armVerificationWatchdog(state) {
    if (state.verificationTimer) window.clearTimeout(state.verificationTimer);
    // Do not shrink the challenge timeout on retries: slow browsers or networks need time to complete Cloudflare's challenge.
    var timeoutMs = VERIFY_ATTEMPT_TIMEOUT_MS;
    state.verificationTimer = window.setTimeout(function () {
      state.verificationTimer = null;
      if (!state.manual || !state.inProgress || !state.pendingPromise) return;
      failOrRetryVerification(state, new Error('Cloudflare verification did not return a token within 30 seconds. One automatic retry has been attempted; refresh once, and if it repeats ask the administrator to check the Turnstile hostname and challenge connectivity.'));
    }, timeoutMs);
  }

  function failOrRetryVerification(state, error) {
    state.token = '';
    state.issuedAt = 0;
    state.error = error instanceof Error ? error : new Error(String(error || 'Cloudflare security verification failed.'));
    if (state.manual && state.inProgress && state.pendingPromise &&
        state.retryCount < VERIFY_RETRY_LIMIT && window.turnstile &&
        state.widgetId !== null && state.form.isConnected) {
      state.retryCount += 1;
      state.status.textContent = 'Security verification is taking longer than expected. Retrying automatically (' +
        state.retryCount + '/' + VERIFY_RETRY_LIMIT + ')…';
      if (state.retryTimer) window.clearTimeout(state.retryTimer);
      state.retryTimer = window.setTimeout(function () {
        state.retryTimer = null;
        if (!state.form.isConnected || !state.inProgress || !state.pendingPromise) return;
        try {
          window.turnstile.reset(state.widgetId);
          window.turnstile.execute(state.widgetId);
          armVerificationWatchdog(state);
        } catch (_) {
          failOrRetryVerification(state, new Error('Cloudflare security verification could not start.'));
        }
      }, VERIFY_RETRY_DELAY_MS);
      return;
    }
    state.inProgress = false;
    if (state.manual) {
      state.status.textContent = 'Security verification could not finish automatically. Click Login to try again.';
    } else {
      state.status.textContent = state.error.message;
    }
    settleVerification(state, null, state.error);
    syncManualControls(state);
  }

  function attach(form) {
    if (!form || !AUTH_FORMS.has(form.id) || states.has(form)) return states.get(form) || null;

    var manual = MANUAL_LOGIN_FORMS.has(form.id);
    var wrap = document.createElement('div');
    wrap.className = 'aegis-turnstile-wrap';
    wrap.setAttribute('aria-label', 'Cloudflare security verification');
    if (manual) wrap.dataset.manualLogin = 'true';

    var widget = document.createElement('div');
    widget.className = 'aegis-turnstile-widget';
    var status = document.createElement('div');
    status.className = 'aegis-turnstile-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.textContent = manual ? '' : 'Loading security verification…';

    wrap.appendChild(widget);
    wrap.appendChild(status);

    var submit = form.querySelector('button[type="submit"],input[type="submit"]');
    if (submit && submit.parentNode === form) form.insertBefore(wrap, submit);
    else form.appendChild(wrap);

    var state = {
      form: form,
      wrap: wrap,
      widget: widget,
      status: status,
      submit: submit,
      manual: manual,
      widgetId: null,
      token: '',
      issuedAt: 0,
      error: null,
      initializing: null,
      inProgress: false,
      busy: false,
      started: false,
      verifiedValues: '',
      challengeValues: '',
      pendingPromise: null,
      pendingResolve: null,
      pendingReject: null,
      retryCount: 0,
      verificationTimer: null,
      retryTimer: null
    };
    states.set(form, state);

    function currentValues() {
      return credentialInputs(form).map(function (input) { return String(input.value || ''); }).join('\u0000');
    }

    function credentialChanged() {
      var values = currentValues();
      var changedDuringChallenge = state.manual && state.inProgress && values !== state.challengeValues;
      var changedAfterVerification = state.manual && state.token && !state.busy && values !== state.verifiedValues;
      if ((changedDuringChallenge || changedAfterVerification) && !state.busy) {
        var changedError = new Error('Login details changed. Click Login and complete verification again.');
        state.token = '';
        state.issuedAt = 0;
        state.error = null;
        state.inProgress = false;
        state.started = false;
        settleVerification(state, null, changedError);
        if (window.turnstile && state.widgetId !== null && form.isConnected) {
          try { window.turnstile.reset(state.widgetId); } catch (_) {}
        }
        state.wrap.removeAttribute('data-challenge-active');
        status.textContent = credentialsReady(form)
          ? 'Login details changed. Click Login to verify again.'
          : 'Enter your username/email and password first.';
      } else if (state.manual && !state.token && !state.inProgress && !state.busy) {
        status.textContent = '';
      }
      syncManualControls(state);
    }

    if (manual) {
      credentialInputs(form).forEach(function (input) {
        input.addEventListener('input', credentialChanged);
        input.addEventListener('change', credentialChanged);
        input.addEventListener('blur', credentialChanged);
      });
      if (submit) submit.disabled = true;
    }

    function initializeWidget() {
      if (state.widgetId !== null) return Promise.resolve();
      if (state.initializing) return state.initializing;
      state.initializing = loadApi().then(function () {
        if (!form.isConnected) throw new Error('Security verification form is no longer available. Please refresh.');
        if (state.widgetId !== null) return;
        var options = {
          sitekey: resolvedSitekey(),
          theme: 'auto',
          execution: manual ? 'execute' : 'render',
          appearance: manual ? 'execute' : 'always',
          retry: manual ? 'never' : 'auto',
          'retry-interval': 3000,
          'refresh-expired': 'auto',
          'refresh-timeout': 'auto',
          callback: function (token) {
            state.token = String(token || '');
            state.issuedAt = Date.now();
            state.error = null;
            state.retryCount = 0;
            state.inProgress = false;
            state.verifiedValues = currentValues();
            if (manual) {
              if (state.challengeValues && state.verifiedValues !== state.challengeValues) {
                state.token = '';
                state.issuedAt = 0;
                state.status.textContent = 'Login details changed. Click Login and verify again.';
                settleVerification(state, null, new Error('Login details changed. Please verify again.'));
                syncManualControls(state);
                return;
              }
              status.textContent = 'Verification complete. Signing you in…';
              syncManualControls(state);
              settleVerification(state, state.token, null);
            } else {
              status.textContent = '';
            }
          },
          'expired-callback': function () {
            state.token = '';
            state.issuedAt = 0;
            if (manual && state.inProgress && state.pendingPromise) {
              failOrRetryVerification(state, new Error('Cloudflare security verification expired.'));
              return;
            }
            state.inProgress = false;
            state.error = null;
            var message = manual
              ? 'Security verification expired. Click Login to try again.'
              : 'Security verification expired. Please submit again to retry.';
            status.textContent = message;
            settleVerification(state, null, new Error(message));
            syncManualControls(state);
          },
          'error-callback': function (errorCode) {
            state.token = '';
            state.issuedAt = 0;
            var code = String(errorCode || 'unknown').slice(0, 24);
            var permanentConfigError = /^(110100|110110|110200|200100|400020|400021|400070)$/.test(code);
            var message = code === '110200'
              ? 'Cloudflare Turnstile does not authorize this website hostname (110200). The administrator must add the exact hostname to the widget allowlist.'
              : permanentConfigError
              ? 'Cloudflare Turnstile configuration error (' + code + '). The administrator must check the widget/sitekey configuration.'
              : 'Cloudflare security verification failed (code ' + code + '). Check the network or browser extensions and try again.';
            if (manual && state.inProgress && state.pendingPromise) {
              // Configuration errors will not be fixed by retrying the same key.
              if (permanentConfigError) state.retryCount = VERIFY_RETRY_LIMIT;
              failOrRetryVerification(state, new Error(message));
              return;
            }
            state.inProgress = false;
            state.error = new Error(message);
            status.textContent = state.error.message;
            settleVerification(state, null, state.error);
            syncManualControls(state);
          },
          'timeout-callback': function () {
            state.token = '';
            state.issuedAt = 0;
            if (manual && state.inProgress && state.pendingPromise) {
              failOrRetryVerification(state, new Error('Cloudflare security verification timed out.'));
              return;
            }
            state.inProgress = false;
            var message = manual
              ? 'Security verification timed out. Click Login to try again.'
              : 'Security verification timed out. Please submit again to retry.';
            status.textContent = message;
            settleVerification(state, null, new Error(message));
            syncManualControls(state);
          }
        };
        state.widgetId = window.turnstile.render(widget, options);
        if (manual) {
          status.textContent = state.wrap.dataset.challengeActive === 'true'
            ? 'Complete the Cloudflare security check to continue.'
            : '';
          syncManualControls(state);
        } else {
          status.textContent = 'Verifying automatically…';
        }
      }).catch(function (error) {
        state.error = error instanceof Error ? error : new Error('Security verification unavailable.');
        status.textContent = state.error.message;
        state.initializing = null;
        syncManualControls(state);
        throw state.error;
      });
      return state.initializing;
    }

    state.initializeWidget = initializeWidget;
    // Warm Turnstile before the visitor submits. The login challenge itself still starts only
    // after a valid Login click, so verification remains tied to the current credentials.
    if (manual) {
      loadApi().catch(function (error) {
        state.error = error instanceof Error ? error : new Error('Cloudflare security verification is unavailable.');
      });
    } else {
      initializeWidget().catch(function () {});
    }


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
    if (state.busy) throw new Error('Sign-in is already being submitted. Please wait.');
    if (!state.manual && state.error && state.widgetId === null) throw state.error;
    if (!state.manual && state.widgetId === null) {
      try { await state.initializeWidget(); } catch (error) { throw state.error || error; }
    }

    if (state.manual) {
      var freshManualToken = !!state.token && Date.now() - state.issuedAt < 240000;
      if (!freshManualToken) {
        if (!credentialsReady(form)) {
          throw new Error('Enter your username/email and password before continuing.');
        }
        if (state.pendingPromise) {
          throw new Error('Please complete the security check already in progress.');
        }
        if (state.token) {
          state.token = '';
          state.issuedAt = 0;
        }
        state.wrap.dataset.challengeActive = 'true';
        state.status.textContent = 'Loading Cloudflare security verification…';
        state.challengeValues = credentialInputs(form).map(function (input) { return String(input.value || ''); }).join('\u0000');
        state.inProgress = true;
        state.error = null;
        state.retryCount = 0;
        state.pendingPromise = new Promise(function (resolve, reject) {
          state.pendingResolve = resolve;
          state.pendingReject = reject;
        });
        var verification = state.pendingPromise;
        syncManualControls(state);

        try {
          await state.initializeWidget();
          if (state.pendingPromise !== verification || !state.inProgress ||
              credentialInputs(form).map(function (input) { return String(input.value || ''); }).join('\u0000') !== state.challengeValues) {
            throw new Error('Login details changed. Click Login and complete verification again.');
          }
          if (!window.turnstile || state.widgetId === null) {
            throw state.error || new Error('Cloudflare security verification is unavailable. Please refresh.');
          }
          state.status.textContent = 'Verifying automatically…';
          if (state.started) window.turnstile.reset(state.widgetId);
          state.started = true;
          window.turnstile.execute(state.widgetId);
          armVerificationWatchdog(state);
        } catch (error) {
          state.error = error instanceof Error ? error : new Error('Cloudflare security verification failed. Please try again.');
          failOrRetryVerification(state, state.error);
        }

        var issuedToken;
        try {
          issuedToken = await verification;
        } catch (error) {
          state.inProgress = false;
          syncManualControls(state);
          throw error;
        }
        var latestValues = credentialInputs(form).map(function (input) { return String(input.value || ''); }).join('\u0000');
        if (latestValues !== state.challengeValues || !issuedToken || state.token !== issuedToken || Date.now() - state.issuedAt >= 240000) {
          state.token = '';
          state.issuedAt = 0;
          state.inProgress = false;
          state.status.textContent = 'Security verification is no longer valid. Click Login to try again.';
          syncManualControls(state);
          throw new Error('Security verification expired or login details changed. Please click Login and verify again.');
        }
      }
    }

    if (!state.token || Date.now() - state.issuedAt >= 240000) {
      state.token = '';
      state.issuedAt = 0;
      state.status.textContent = state.manual
        ? 'Click Login and complete the Cloudflare security check before continuing.'
        : 'Please complete the Cloudflare security check, then submit again.';
      syncManualControls(state);
      throw new Error(state.manual
        ? 'Cloudflare security verification did not complete. Please try Login again.'
        : 'Please complete the Cloudflare security check before continuing.');
    }

    var token = state.token;
    state.token = '';
    state.issuedAt = 0;
    state.busy = true;
    state.inProgress = false;
    if (state.manual) {
      setCredentialInputsDisabled(state, true);
      state.status.textContent = 'Submitting securely…';
      syncManualControls(state);
    }
    return token;
  }

  function reset(form) {
    var state = form && states.get(form);
    if (!state) return;
    if (state.pendingPromise) settleVerification(state, null, new Error('Security verification was reset. Click Login to try again.'));
    if (state.verificationTimer) window.clearTimeout(state.verificationTimer);
    if (state.retryTimer) window.clearTimeout(state.retryTimer);
    state.verificationTimer = null;
    state.retryTimer = null;
    state.retryCount = 0;
    state.token = '';
    state.issuedAt = 0;
    state.error = null;
    state.inProgress = false;
    state.busy = false;
    state.started = false;
    state.verifiedValues = '';
    state.challengeValues = '';
    if (state.manual) {
      setCredentialInputsDisabled(state, false);
      state.wrap.removeAttribute('data-challenge-active');
      if (state.status) state.status.textContent = '';
      if (form.isConnected && window.turnstile && state.widgetId !== null) {
        try { window.turnstile.reset(state.widgetId); } catch (_) {}
      }
      syncManualControls(state);
    } else {
      if (state.status) state.status.textContent = 'Complete the security check to continue.';
      if (form.isConnected && window.turnstile && state.widgetId !== null) {
        try { window.turnstile.reset(state.widgetId); } catch (_) {}
      }
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