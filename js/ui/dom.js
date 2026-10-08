// Tiny DOM helpers. Views are written as template strings; always pass user text through esc().

export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// Event delegation: on(root, 'click', '[data-action="x"]', (ev, el) => ...)
export function on(root, type, selector, handler) {
  const listener = (ev) => {
    const el = ev.target.closest(selector);
    if (el && root.contains(el)) handler(ev, el);
  };
  root.addEventListener(type, listener);
  return () => root.removeEventListener(type, listener);
}

export function setHTML(el, html) {
  el.innerHTML = html;
  return el;
}

export function plural(n, one, many = one + 's') {
  return `${n} ${n === 1 ? one : many}`;
}
