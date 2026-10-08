// Short status messages at the bottom of the screen, with an optional action (e.g. Undo).

import { esc } from './dom.js';

let region = null;
let current = null;

// Modal dialogs sit in the browser's top layer, above everything else on the page.
// So while one is open, the toast lives inside the top-most dialog, or its Undo button
// would be hidden behind the dialog's backdrop.
function ensureRegion() {
  if (!region) {
    region = document.createElement('div');
    region.className = 'toast-region';
    region.setAttribute('role', 'status');
    region.setAttribute('aria-live', 'polite');
  }
  const dialogs = document.querySelectorAll('dialog[open]');
  const host = dialogs.length ? dialogs[dialogs.length - 1] : document.body;
  if (region.parentElement !== host) host.appendChild(region);
  return region;
}

export function toast(message, { action, tone = 'neutral', duration } = {}) {
  const host = ensureRegion();
  if (current) current.remove();
  const el = document.createElement('div');
  el.className = `toast toast--${tone}`;
  el.innerHTML = `<span class="toast__msg">${esc(message)}</span>` +
    (action ? `<button type="button" class="toast__action">${esc(action.label)}</button>` : '') +
    `<button type="button" class="toast__close" aria-label="Dismiss">×</button>`;
  host.appendChild(el);
  current = el;

  const close = () => {
    clearTimeout(timer);
    el.classList.add('is-leaving');
    setTimeout(() => el.remove(), 180);
    if (current === el) current = null;
  };
  const timer = setTimeout(close, duration ?? (action ? 7000 : 3500));
  el.querySelector('.toast__close').addEventListener('click', close);
  if (action) {
    el.querySelector('.toast__action').addEventListener('click', () => {
      close();
      action.onClick();
    });
  }
  return close;
}
