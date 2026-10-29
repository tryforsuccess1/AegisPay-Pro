(function () {
  'use strict';

  if (window.__AEGIS_UI_FEEDBACK_V1__) return;
  window.__AEGIS_UI_FEEDBACK_V1__ = true;

  var TARGET_SELECTOR = [
    '.aa-alert', '.ap-alert', '.aegis-alert',
    '.aa-toast', '.ap-toast', '.toast', '.toast-message',
    '.notification-toast', '.flash-message',
    '[data-aegis-notification]', '[data-toast]', '[data-notification]',
    '[role="alert"]'
  ].join(',');
  var BUTTON_SELECTOR = 'button, [role="button"], input[type="button"], input[type="submit"], a[role="button"]';
  var queue = [];
  var active = null;
  var lastShown = new Map();
  var overlay = null;
  var dialog = null;
  var heading = null;
  var label = null;
  var messageNode = null;
  var iconNode = null;
  var okButton = null;
  var previousFocus = null;
  var priorBodyOverflow = '';
  var pressTimers = new WeakMap();

  var style = document.createElement('style');
  style.setAttribute('data-aegis-ui-feedback', 'true');
  style.textContent = [
    'button:not(:disabled),[role="button"]:not([aria-disabled="true"]),input[type="button"]:not(:disabled),input[type="submit"]:not(:disabled),a[role="button"]{transition:transform .14s ease,filter .14s ease,box-shadow .14s ease;-webkit-tap-highlight-color:transparent;transform-origin:center}',
    'button:not(:disabled):active,[role="button"]:not([aria-disabled="true"]):active,input[type="button"]:not(:disabled):active,input[type="submit"]:not(:disabled):active,a[role="button"]:active{transform:translateY(1px) scale(.975)!important;filter:brightness(1.06)}',
    '.aegis-button-pressed:not(:disabled){transform:translateY(1px) scale(.975)!important;filter:brightness(1.08);box-shadow:0 0 0 3px rgba(240,106,77,.17),0 5px 14px rgba(201,75,138,.12)!important}',
    '.aegis-click-feedback:not(:disabled){animation:aegisButtonPressFeedback .34s cubic-bezier(.2,.75,.25,1)}',
    '@keyframes aegisButtonPressFeedback{0%{filter:brightness(1);transform:translateY(0) scale(1)}24%{filter:brightness(1.1);transform:translateY(1px) scale(.975)}58%{filter:brightness(1.03);transform:translateY(-1px) scale(1.01)}100%{filter:brightness(1);transform:translateY(0) scale(1)}}',
    '.aegis-feedback-backdrop{position:fixed!important;inset:0!important;z-index:2147483000!important;display:grid!important;place-items:center!important;padding:22px!important;background:rgba(55,42,34,.42)!important;backdrop-filter:blur(7px);-webkit-backdrop-filter:blur(7px);opacity:0;transition:opacity .18s ease}',
    '.aegis-feedback-backdrop[hidden]{display:none!important}',
    '.aegis-feedback-backdrop.is-open{opacity:1}',
    '.aegis-feedback-dialog{position:relative;width:min(100%,480px);max-height:min(84vh,700px);overflow:hidden;display:flex;flex-direction:column;color:var(--text,#4a3a2c);background:var(--panel,#fff);border:1px solid rgba(201,75,138,.22);border-radius:24px;box-shadow:0 30px 100px rgba(42,27,22,.28),0 8px 32px rgba(201,75,138,.12);transform:translateY(12px) scale(.985);animation:aegisModalEnter .22s cubic-bezier(.2,.8,.2,1) forwards;isolation:isolate}',
    '.aegis-feedback-dialog:before{content:"";position:absolute;z-index:1;inset:0 0 auto;height:5px;background:var(--grad,linear-gradient(135deg,#f06a4d,#c94b8a))}',
    '@keyframes aegisModalEnter{to{transform:translateY(0) scale(1)}}',
    '.aegis-feedback-head{display:flex;align-items:center;gap:13px;padding:27px 26px 13px}',
    '.aegis-feedback-icon{flex:0 0 44px;width:44px;height:44px;display:grid;place-items:center;border-radius:15px;color:#fff;background:var(--grad,linear-gradient(135deg,#f06a4d,#c94b8a));box-shadow:0 10px 24px rgba(201,75,138,.18);font:800 23px/1 system-ui,sans-serif}',
    '.aegis-feedback-dialog[data-type="error"] .aegis-feedback-icon{background:linear-gradient(135deg,#f06a4d,#c94b8a)}',
    '.aegis-feedback-dialog[data-type="success"] .aegis-feedback-icon{background:linear-gradient(135deg,#1a9a6e,#36b78b)}',
    '.aegis-feedback-dialog[data-type="warning"] .aegis-feedback-icon{background:linear-gradient(135deg,#d98a1a,#f0ad45)}',
    '.aegis-feedback-brand{display:block;margin:0 0 5px;color:var(--muted,#8a7a68);font:800 9px/1.3 system-ui,sans-serif;letter-spacing:1.7px;text-transform:uppercase}',
    '.aegis-feedback-title{margin:0;color:var(--text,#4a3a2c);font:800 20px/1.2 Inter,ui-sans-serif,system-ui,sans-serif;letter-spacing:-.35px}',
    '.aegis-feedback-copy{margin:0;padding:4px 26px 22px;color:var(--text,#4a3a2c);font:500 14px/1.65 Inter,ui-sans-serif,system-ui,sans-serif;white-space:pre-wrap;overflow-wrap:anywhere;overflow-y:auto;max-height:48vh}',
    '.aegis-feedback-actions{display:flex;justify-content:flex-end;align-items:center;gap:10px;padding:15px 26px 22px;border-top:1px solid rgba(201,75,138,.12);background:linear-gradient(180deg,rgba(240,106,77,.025),rgba(201,75,138,.045))}',
    '.aegis-feedback-ok{min-width:112px;min-height:43px;padding:0 22px;border:0!important;border-radius:13px!important;color:#fff!important;background:var(--grad,linear-gradient(135deg,#f06a4d,#c94b8a))!important;box-shadow:0 12px 24px rgba(201,75,138,.2)!important;font:800 12px/1 system-ui,sans-serif!important;cursor:pointer}',
    '.aegis-feedback-ok:hover{filter:brightness(1.06);transform:translateY(-1px)}',
    '.aegis-feedback-ok:focus-visible{outline:3px solid var(--cyan,#c94b8a)!important;outline-offset:3px}',
    '[data-aegis-feedback-captured="true"]{display:none!important}',
    '@media(max-width:520px){.aegis-feedback-backdrop{padding:16px!important}.aegis-feedback-dialog{border-radius:21px}.aegis-feedback-head{padding:24px 20px 12px}.aegis-feedback-copy{padding:4px 20px 19px;font-size:13px}.aegis-feedback-actions{padding:13px 20px 18px}.aegis-feedback-title{font-size:18px}}',
    '@media(prefers-reduced-motion:reduce){.aegis-feedback-dialog,.aegis-click-feedback{animation:none!important}.aegis-feedback-backdrop,button,[role="button"],input[type="button"],input[type="submit"]{transition:none!important}}'
  ].join('\n');
  (document.head || document.documentElement).appendChild(style);

  function classify(message, element, requestedType) {
    if (requestedType) return requestedType;
    var classes = element && element.className ? String(element.className) : '';
    var text = String(message || '') + ' ' + classes;
    if (/\b(success|saved|completed|approved|paid|updated|confirmed)\b/i.test(text)) return 'success';
    if (/\b(warning|caution|attention)\b/i.test(text)) return 'warning';
    if (/\b(error|failed|failure|blocked|cannot|could not|invalid|required|requires|not ready|not authorized|denied|mismatch)\b/i.test(text)) return 'error';
    return 'info';
  }

  function buildModal() {
    if (overlay || !document.body) return;
    overlay = document.createElement('div');
    overlay.className = 'aegis-feedback-backdrop';
    overlay.hidden = true;
    overlay.setAttribute('aria-hidden', 'true');

    dialog = document.createElement('section');
    dialog.className = 'aegis-feedback-dialog';
    dialog.setAttribute('role', 'alertdialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'aegisFeedbackTitle');
    dialog.setAttribute('aria-describedby', 'aegisFeedbackMessage');
    dialog.setAttribute('tabindex', '-1');

    var head = document.createElement('div');
    head.className = 'aegis-feedback-head';
    iconNode = document.createElement('span');
    iconNode.className = 'aegis-feedback-icon';
    iconNode.setAttribute('aria-hidden', 'true');
    iconNode.textContent = '!';
    var copyHead = document.createElement('div');
    label = document.createElement('span');
    label.className = 'aegis-feedback-brand';
    label.textContent = 'AEGISPAY · NOTICE';
    heading = document.createElement('h2');
    heading.className = 'aegis-feedback-title';
    heading.id = 'aegisFeedbackTitle';
    heading.textContent = 'Please review this message';
    copyHead.appendChild(label);
    copyHead.appendChild(heading);
    head.appendChild(iconNode);
    head.appendChild(copyHead);

    messageNode = document.createElement('p');
    messageNode.className = 'aegis-feedback-copy';
    messageNode.id = 'aegisFeedbackMessage';
    messageNode.setAttribute('aria-live', 'assertive');

    var actions = document.createElement('div');
    actions.className = 'aegis-feedback-actions';
    okButton = document.createElement('button');
    okButton.type = 'button';
    okButton.className = 'aegis-feedback-ok';
    okButton.textContent = 'OK';
    okButton.addEventListener('click', closeModal);
    actions.appendChild(okButton);

    dialog.appendChild(head);
    dialog.appendChild(messageNode);
    dialog.appendChild(actions);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
  }

  function rememberAndEnqueue(message, type) {
    var text = String(message == null ? '' : message).replace(/\s+/g, ' ').trim();
    if (!text) return;
    var now = Date.now();
    var last = lastShown.get(text);
    if (last && now - last < 4500) return;
    lastShown.set(text, now);
    if (lastShown.size > 80) {
      lastShown.forEach(function (time, key) {
        if (now - time > 60000) lastShown.delete(key);
      });
    }
    queue.push({ message: text, type: type || classify(text, null, null) });
    showNext();
  }

  function showNext() {
    if (active || !queue.length || !document.body) return;
    buildModal();
    if (!overlay) return;
    active = queue.shift();
    previousFocus = document.activeElement;
    priorBodyOverflow = document.body.style.overflow;
    dialog.dataset.type = active.type;
    dialog.setAttribute('role', active.type === 'error' ? 'alertdialog' : 'dialog');
    label.textContent = 'AEGISPAY · ' + (active.type === 'error' ? 'ACTION REQUIRED' : active.type === 'success' ? 'SUCCESS' : active.type === 'warning' ? 'PLEASE NOTE' : 'NOTICE');
    heading.textContent = active.type === 'error' ? 'Please review this message' : active.type === 'success' ? 'Completed' : active.type === 'warning' ? 'Attention' : 'AegisPay Notification';
    iconNode.textContent = active.type === 'success' ? '✓' : active.type === 'info' ? 'i' : '!';
    messageNode.textContent = active.message;
    overlay.hidden = false;
    overlay.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(function () {
      if (overlay && active) overlay.classList.add('is-open');
      if (okButton) okButton.focus();
    });
  }

  function closeModal() {
    if (!active || !overlay) return;
    active = null;
    overlay.classList.remove('is-open');
    overlay.hidden = true;
    overlay.setAttribute('aria-hidden', 'true');
    if (document.body) document.body.style.overflow = priorBodyOverflow;
    if (previousFocus && typeof previousFocus.focus === 'function' && previousFocus.isConnected) {
      try { previousFocus.focus({ preventScroll: true }); } catch (_) {}
    }
    previousFocus = null;
    window.setTimeout(showNext, 40);
  }

  function extractText(element) {
    var clone = element.cloneNode(true);
    clone.querySelectorAll('button,svg,[aria-hidden="true"],.aegis-feedback-backdrop').forEach(function (item) {
      item.remove();
    });
    return String(clone.innerText || clone.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function isVisible(element) {
    if (!element || !element.isConnected || element.closest('.aegis-feedback-backdrop')) return false;
    if (element.dataset && element.dataset.aegisFeedbackCaptured === 'true') return false;
    var styleInfo;
    try { styleInfo = window.getComputedStyle(element); } catch (_) { return false; }
    if (styleInfo.display === 'none' || styleInfo.visibility === 'hidden' || Number(styleInfo.opacity) === 0) return false;
    return true;
  }

  function captureElement(element) {
    if (!element || element.nodeType !== 1 || !element.matches(TARGET_SELECTOR) || !isVisible(element)) return;
    var message = extractText(element);
    if (!message) return;
    element.dataset.aegisFeedbackCaptured = 'true';
    element.setAttribute('aria-hidden', 'true');
    rememberAndEnqueue(message, classify(message, element, null));
  }

  function inspectAddedNode(node) {
    if (!node || node.nodeType !== 1 || node.closest('.aegis-feedback-backdrop')) return;
    if (node.matches(TARGET_SELECTOR)) {
      captureElement(node);
      return;
    }
    node.querySelectorAll(TARGET_SELECTOR).forEach(captureElement);
  }

  function activateFeedback() {
    document.querySelectorAll(TARGET_SELECTOR).forEach(captureElement);

    if (window.MutationObserver && document.documentElement) {
      var observer = new MutationObserver(function (records) {
        records.forEach(function (record) {
          if (record.type === 'characterData') {
            var parent = record.target.parentElement;
            var target = parent && parent.closest(TARGET_SELECTOR);
            if (target) captureElement(target);
            return;
          }
          record.addedNodes.forEach(inspectAddedNode);
        });
      });
      observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true });
    }

    document.addEventListener('pointerdown', function (event) {
      var button = event.target && event.target.closest ? event.target.closest(BUTTON_SELECTOR) : null;
      if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true') return;
      button.classList.add('aegis-button-pressed');
      var previousTimer = pressTimers.get(button);
      if (previousTimer) clearTimeout(previousTimer);
      pressTimers.set(button, setTimeout(function () {
        button.classList.remove('aegis-button-pressed');
      }, 220));
    }, true);

    function releasePress(event) {
      var button = event.target && event.target.closest ? event.target.closest(BUTTON_SELECTOR) : null;
      if (!button) return;
      var timer = pressTimers.get(button);
      if (timer) clearTimeout(timer);
      pressTimers.set(button, setTimeout(function () {
        button.classList.remove('aegis-button-pressed');
      }, 95));
    }
    document.addEventListener('pointerup', releasePress, true);
    document.addEventListener('pointercancel', releasePress, true);

    document.addEventListener('click', function (event) {
      var button = event.target && event.target.closest ? event.target.closest(BUTTON_SELECTOR) : null;
      if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true') return;
      button.classList.remove('aegis-click-feedback');
      void button.offsetWidth;
      button.classList.add('aegis-click-feedback');
      window.setTimeout(function () {
        if (button && button.classList) button.classList.remove('aegis-click-feedback');
      }, 380);
    }, true);

    document.addEventListener('keydown', function (event) {
      if (!active || !overlay || overlay.hidden) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        closeModal();
        return;
      }
      if (event.key === 'Tab') {
        event.preventDefault();
        if (okButton) okButton.focus();
      }
    }, true);

    var originalAlert = window.alert ? window.alert.bind(window) : null;
    window.alert = function (message) {
      if (!document.body) {
        if (originalAlert) return originalAlert(String(message == null ? '' : message));
        return;
      }
      rememberAndEnqueue(String(message == null ? '' : message), classify(message, null, null));
    };
    window.AegisPayNotify = function (message, type) {
      rememberAndEnqueue(message, classify(message, null, type || null));
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', activateFeedback, { once: true });
  } else {
    activateFeedback();
  }
})();