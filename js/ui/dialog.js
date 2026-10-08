// Modal dialogs built on the native <dialog> element (keyboard + focus handling for free).
// The browser's own alert/confirm are not used: they block the page and look out of place.

import { esc } from './dom.js';
import { icon } from './icons.js';

// openDialog({ title, body, footer, onMount, size }) → { el, close }
let dialogCount = 0;

// Forms pass backdropClose: false so a stray click outside doesn't throw away what was typed.
export function openDialog({ title, body, footer = '', onMount, onClose, size = 'md', backdropClose = true }) {
  const el = document.createElement('dialog');
  const titleId = `dialog-title-${++dialogCount}`;
  el.className = `dialog dialog--${size}`;
  el.setAttribute('aria-labelledby', titleId);
  el.innerHTML = `
    <div class="dialog__panel">
      <header class="dialog__head">
        <h2 class="dialog__title" id="${titleId}">${esc(title)}</h2>
        <button type="button" class="icon-btn" data-dialog-close aria-label="Close">${icon('x')}</button>
      </header>
      <div class="dialog__body">${body}</div>
      ${footer ? `<footer class="dialog__foot">${footer}</footer>` : ''}
    </div>`;
  document.body.appendChild(el);

  const returnFocus = document.activeElement;
  let closed = false;
  const close = (result) => {
    if (closed) return;
    closed = true;
    el.close();
    el.remove();
    onClose?.(result);
    if (returnFocus && document.contains(returnFocus)) returnFocus.focus({ preventScroll: true });
  };

  el.addEventListener('cancel', (ev) => {
    ev.preventDefault();
    close();
  });
  el.addEventListener('click', (ev) => {
    if (ev.target === el && backdropClose) close(); // click on the backdrop
    const closer = ev.target.closest('[data-dialog-close]');
    if (closer && closer.closest('dialog') === el) close();
  });

  el.showModal();
  onMount?.(el, close);
  const first = el.querySelector('[autofocus]') || el.querySelector('input, select, textarea, button:not([data-dialog-close])');
  first?.focus();
  return { el, close };
}

// confirmDialog({ title, message, confirmLabel, danger, typeToConfirm }) → Promise<boolean>
export function confirmDialog({ title, message, confirmLabel = 'Confirm', danger = false, typeToConfirm = null }) {
  return new Promise((resolve) => {
    const typeField = typeToConfirm
      ? `<label class="field">
           <span class="field__label">Type <strong>${esc(typeToConfirm)}</strong> to confirm</span>
           <input class="input" id="confirm-type" autocomplete="off" autocapitalize="characters" spellcheck="false">
         </label>`
      : '';
    let answered = false;
    const { el, close } = openDialog({
      title,
      size: 'sm',
      body: `<p class="dialog__msg">${message}</p>${typeField}`,
      footer: `
        <button type="button" class="btn btn--ghost" data-dialog-close>Cancel</button>
        <button type="button" class="btn ${danger ? 'btn--danger' : 'btn--primary'}" data-confirm ${typeToConfirm ? 'disabled' : 'autofocus'}>${esc(confirmLabel)}</button>`,
      onClose: () => { if (!answered) resolve(false); },
    });
    const btn = el.querySelector('[data-confirm]');
    if (typeToConfirm) {
      const input = el.querySelector('#confirm-type');
      input.focus();
      input.addEventListener('input', () => {
        btn.disabled = input.value.trim().toUpperCase() !== typeToConfirm.toUpperCase();
      });
      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' && !btn.disabled) btn.click();
      });
    }
    btn.addEventListener('click', () => {
      answered = true;
      resolve(true);
      close();
    });
  });
}
