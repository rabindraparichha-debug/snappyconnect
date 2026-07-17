/**
 * SnappyConnect content script.
 *
 * Scans visible text for phone numbers and decorates them with a small
 * "call" button. Clicking it sends the raw number to the background
 * service worker, which forwards it to the SnappyConnect API. No business
 * logic lives here — the API decides how the call is placed.
 */
(function () {
  'use strict';

  // Matches +country and local formats with 7–15 digits, tolerant of spaces/dashes/brackets.
  const PHONE_REGEX = /(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{1,4}\)[\s.-]?)?\d{2,4}(?:[\s.-]?\d{2,4}){1,3}/g;
  const MIN_DIGITS = 7;
  const MAX_DIGITS = 15;
  const SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT', 'BUTTON',
    'A', 'CODE', 'PRE', 'CANVAS', 'SVG',
  ]);

  function digitCount(text) {
    return (text.match(/\d/g) || []).length;
  }

  function looksLikePhone(candidate) {
    const digits = digitCount(candidate);
    if (digits < MIN_DIGITS || digits > MAX_DIGITS) return false;
    // Reject obvious non-phones: years, prices, long unbroken ids handled by digit cap.
    if (/^\d{4}$/.test(candidate.trim())) return false;
    return true;
  }

  function makeButton(number) {
    const btn = document.createElement('button');
    btn.className = 'sc-call-btn';
    btn.type = 'button';
    btn.title = `Call ${number} with SnappyConnect`;
    btn.setAttribute('data-sc-number', number);
    btn.innerHTML =
      '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.4">' +
      '<path stroke-linecap="round" stroke-linejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z"/></svg>';
    btn.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      btn.classList.add('sc-call-btn--busy');
      chrome.runtime.sendMessage({ type: 'SC_CALL', number: number }, function (response) {
        btn.classList.remove('sc-call-btn--busy');
        showToast(response && response.message ? response.message : 'Call request sent', response && response.ok);
      });
    });
    return btn;
  }

  let toastTimer = null;
  function showToast(message, ok) {
    let toast = document.getElementById('sc-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'sc-toast';
      document.documentElement.appendChild(toast);
    }
    toast.textContent = message;
    toast.className = ok === false ? 'sc-toast sc-toast--error' : 'sc-toast';
    toast.classList.add('sc-toast--visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toast.classList.remove('sc-toast--visible');
    }, 4000);
  }

  function processTextNode(node) {
    const text = node.nodeValue;
    if (!text || digitCount(text) < MIN_DIGITS) return;

    PHONE_REGEX.lastIndex = 0;
    let match;
    let lastIndex = 0;
    let fragment = null;

    while ((match = PHONE_REGEX.exec(text)) !== null) {
      const candidate = match[0];
      if (!looksLikePhone(candidate)) continue;

      if (!fragment) fragment = document.createDocumentFragment();
      fragment.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));

      const wrapper = document.createElement('span');
      wrapper.className = 'sc-number';
      wrapper.textContent = candidate;
      wrapper.appendChild(makeButton(candidate.trim()));
      fragment.appendChild(wrapper);

      lastIndex = match.index + candidate.length;
    }

    if (fragment) {
      fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
      node.parentNode.replaceChild(fragment, node);
    }
  }

  function scan(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
        if (parent.closest('.sc-number, [contenteditable="true"]')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(processTextNode);
  }

  // Initial scan + observe dynamic content (debounced).
  scan(document.body);
  let scanTimer = null;
  const observer = new MutationObserver(function (mutations) {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(function () {
      for (const mutation of mutations) {
        for (const added of mutation.addedNodes) {
          if (added.nodeType === Node.ELEMENT_NODE && !added.closest('.sc-number')) {
            scan(added);
          }
        }
      }
    }, 500);
  });
  observer.observe(document.body, { childList: true, subtree: true });
})();
