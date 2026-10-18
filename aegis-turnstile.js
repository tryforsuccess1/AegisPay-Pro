(function () {
  'use strict';

  // Public Cloudflare Turnstile sitekey. The matching secret remains server-side.
  var SITEKEY = '0x4AAAAAAFZaOeTke8FQpVNS';
  var TEST_SITEKEY = '1x00000000000000000000AA';
  var AUTH_FORMS = new Set(['liveLogin', 'liveSignup', 'forgotForm', 'aaLoginForm']);
  var MANUAL_LOGIN_FORMS = new Set(['liveLogin', 'aaLoginForm']);
  var states = new WeakMap();
  var apiPromise = null;

  var style = document.createElement('style');
  style.textContent = [
    '.aegis-turnstile-wrap{display:flex;flex-direction:column;align-items:stretch;justify-content:center;gap:8px;width:100%;max-width:100%;margin:12px 0 14px;min-height:0;overflow:visible}',
    '.aegis-turnstile-widget{display:flex;justify-content:center;align-items:center;width:100%;min-height:0;max-width:100%;overflow:visible}',
    '.aegis-turnstile-status{display:block;width:100%;font:500 11px/1.45 system-ui,sans-serif;color:var(--mut,#8a7a68);text-align:center;min-height:0}',
    '.aegis-turnstile-status:empty{display:none}',
    '.aegis-turnstile-verify-button{width:100%;min-height:44px;padding:10px 14px;border:1px solid var(--line,#ddd2c5);border-radius:12px;background:var(--surface,#fff);color:var(--hd,#30251f);font:700 12px/1.3 system-ui,sans-serif;cursor:pointer;touch-action:manipulation;transition:opacity .15s ease,transform .15s ease}',
    '.aegis-turnstile-verify-button:active:not(:disabled){transform:scale(.99)}',
    '.aegis-turnstile-verify-button:disabled{opacity:.55;cursor:not-allowed}',
    '.aegis-turnstile-wrap[data-manual-login="true"] .aegis-turnstile-widget{min-height:0}',
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
        apiPromise = null;
        script.remove();
        reject(new Error('Cloudflare security verification did not load. Please refresh and try again.'));
      }, 20000);
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.defer = true;
      script.onload = function () {
        window.clearTimeout(timeout);
        if (window.turnstile && typeof window.turnstile.render === 'function') resolve();
        else {
          apiPromise = null;
          script.remove();
          reject(new Error('Cloudflare security verification is unavailable. Please refresh.'));
        }
      };
      script.onerror = function () {
        window.clearTimeout(timeout);
        apiPromise = null;
        script.remove();
        reject(new Error('Cloudflare security verification could not load. Check your connection and retry.'));
      };
      document.head.appendChild(script);
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
    if (state.verifyButton) {
      state.verifyButton.disabled = !ready || state.inProgress || state.busy || hasFreshToken || state.widgetId === null;
      state.verifyButton.textContent = hasFreshToken
        ? 'Verified ✓'
        : (state.inProgress ? 'Verifying…' : (state.error ? 'Try verification again' : 'Verify I’m not a robot'));
    }
    if (state.submit) state.submit.disabled = !hasFreshToken || state.inProgress || state.busy;
  }

  function attach(form) {
    if (!form || !AUTH_FORMS.has(form.id) || states.has(form)) return states.get(form) || null;

    var manual = MANUAL_LOGIN_FORMS.has(form.id);
    var wrap = document.createElement('div');
    wrap.className = 'aegis-turnstile-wrap';
    wrap.setAttribute('aria-label', 'Cloudflare security verification');
    if (manual) wrap.dataset.manualLogin = 'true';

    var verifyButton = null;
    if (manual) {
      verifyButton = document.createElement('button');
      verifyButton.type = 'button';
      verifyButton.className = 'aegis-turnstile-verify-button';
      verifyButton.textContent = 'Verify I’m not a robot';
      verifyButton.disabled = true;
      verifyButton.setAttribute('aria-label', 'Start Cloudflare human verification');
    }

    var widget = document.createElement('div');
    widget.className = 'aegis-turnstile-widget';
    var status = document.createElement('div');
    status.className = 'aegis-turnstile-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.textContent = manual
      ? 'Enter your username/email and password first.'
      : 'Loading security verification…';

    if (verifyButton) wrap.appendChild(verifyButton);
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
      verifyButton: verifyButton,
      submit: submit,
      manual: manual,
      widgetId: null,
      token: '',
      issuedAt: 0,
      error: null,
      readyResolve: null,
      readyReject: null,
      inProgress: false,
      busy: false,
      started: false,
      verifiedValues: ''
    };
    state.ready = new Promise(function (resolve, reject) {
      state.readyResolve = resolve;
      state.readyReject = reject;
    });
    states.set(form, state);

    function currentValues() {
      return credentialInputs(form).map(function (input) { return String(input.value || ''); }).join('\u0000');
    }

    function credentialChanged() {
      if (state.manual && state.token && !state.busy && currentValues() !== state.verifiedValues) {
        state.token = '';
        state.issuedAt = 0;
        state.error = null;
        state.inProgress = false;
        state.started = false;
        if (window.turnstile && state.widgetId !== null && form.isConnected) {
          try { window.turnstile.reset(state.widgetId); } catch (_) {}
        }
        status.textContent = 'Login details changed. Please verify again before logging in.';
      } else if (state.manual && !state.token && !state.inProgress && !state.busy) {
        status.textContent = credentialsReady(form)
          ? 'Click “Verify I’m not a robot”, complete the security check, then log in.'
          : 'Enter your username/email and password first.';
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
      verifyButton.addEventListener('click', async function (event) {
        event.preventDefault();
        if (!credentialsReady(form)) {
          var firstInvalid = credentialInputs(form).find(function (input) {
            return !String(input.value || '').trim() || !input.checkValidity();
          });
          if (firstInvalid) firstInvalid.reportValidity();
          status.textContent = 'Enter your username/email and password before verification.';
          syncManualControls(state);
          return;
        }
        try {
          if (state.widgetId === null) await state.ready;
          if (!window.turnstile || state.widgetId === null) throw state.error || new Error('Cloudflare security verification is unavailable. Please refresh.');
          state.error = null;
          state.inProgress = true;
          verifyButton.disabled = true;
          verifyButton.textContent = 'Verifying…';
          status.textContent = 'Complete the Cloudflare security check in the widget below.';
          if (state.started) {
            window.turnstile.reset(state.widgetId);
          }
          state.started = true;
          window.turnstile.execute(state.widgetId);
        } catch (error) {
          state.inProgress = false;
          state.error = error instanceof Error ? error : new Error('Cloudflare security verification failed. Please try again.');
          status.textContent = state.error.message;
          syncManualControls(state);
        }
      });
    }

    loadApi().then(function () {
      if (!form.isConnected || state.widgetId !== null) return;
      var options = {
        sitekey: resolvedSitekey(),
        theme: 'auto',
        execution: manual ? 'execute' : 'render',
        appearance: manual ? 'execute' : 'always',
        retry: manual ? 'never' : 'auto',
        'refresh-expired': manual ? 'manual' : 'auto',
        'refresh-timeout': manual ? 'manual' : 'auto',
        callback: function (token) {
          state.token = String(token || '');
          state.issuedAt = Date.now();
          state.error = null;
          state.inProgress = false;
          state.verifiedValues = currentValues();
          if (manual) {
            status.textContent = 'Verification complete. You can now log in.';
            syncManualControls(state);
          } else {
            status.textContent = '';
          }
        },
        'expired-callback': function () {
          state.token = '';
          state.issuedAt = 0;
          state.inProgress = false;
          state.error = null;
          status.textContent = manual
            ? 'Security check expired. Click “Verify I’m not a robot” to try again.'
            : 'Security check expired. Please complete it again.';
          syncManualControls(state);
        },
        'error-callback': function () {
          state.token = '';
          state.issuedAt = 0;
          state.inProgress = false;
          state.error = new Error('Cloudflare security verification failed. Please try again.');
          status.textContent = state.error.message;
          syncManualControls(state);
        },
        'timeout-callback': function () {
          state.token = '';
          state.issuedAt = 0;
          state.inProgress = false;
          status.textContent = manual
            ? 'Security check timed out. Click “Verify I’m not a robot” to try again.'
            : 'Security check timed out. Please complete it again.';
          syncManualControls(state);
        }
      };
      state.widgetId = window.turnstile.render(widget, options);
      state.readyResolve();
      if (manual) {
        status.textContent = credentialsReady(form)
          ? 'Click “Verify I’m not a robot”, complete the security check, then log in.'
          : 'Enter your username/email and password first.';
        syncManualControls(state);
      } else {
        status.textContent = 'Complete the security check to continue.';
      }
    }).catch(function (error) {
      state.error = error instanceof Error ? error : new Error('Security verification unavailable.');
      status.textContent = state.error.message;
      state.readyReject(state.error);
      syncManualControls(state);
    });

    // A rendered form may remain unused; handle readiness failures without unhandled rejections.
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
    if (state.error && state.widgetId === null) throw state.error;
    if (state.widgetId === null) {
      try { await state.ready; } catch (error) { throw state.error || error; }
    }
    if (!state.token || Date.now() - state.issuedAt >= 240000) {
      state.token = '';
      state.issuedAt = 0;
      state.status.textContent = state.manual
        ? 'Please click “Verify I’m not a robot” and complete verification before logging in.'
        : 'Please complete the Cloudflare security check, then submit again.';
      syncManualControls(state);
      throw new Error(state.manual
        ? 'Please verify that you are human before logging in.'
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
    state.token = '';
    state.issuedAt = 0;
    state.error = null;
    state.inProgress = false;
    state.busy = false;
    state.started = false;
    state.verifiedValues = '';
    if (state.manual) {
      setCredentialInputsDisabled(state, false);
      if (state.status) {
        state.status.textContent = credentialsReady(form)
          ? 'Please verify again before your next login attempt.'
          : 'Enter your username/email and password first.';
      }
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