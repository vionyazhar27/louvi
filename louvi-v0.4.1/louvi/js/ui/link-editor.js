// Reusable "Links" field for forms (tasks, applications, and later modules).
//
//   linkFieldHTML()                → markup to put inside a <form>
//   mountLinkEditor(root, links)   → { links, addPending(), focus() }
// addPending() adds whatever is typed but not yet added; returns false if it's invalid,
// so the form can stop and show the error instead of silently dropping it.

import { esc } from './dom.js';
import { icon } from './icons.js';
import { normalizeUrl, linkText, hostOf, LINK_LIMITS } from '../lib/links.js';

export function linkFieldHTML({ hint = 'For files like a CV, PDF or drawing, upload it to Google Drive and paste the share link.', placeholder = 'Paste a link: Google Drive, job post, DOI…' } = {}) {
  return `
    <div class="field" data-link-editor>
      <span class="field__label" id="links-label">Links <span class="field__optional">optional</span></span>
      <ul class="link-list" data-links aria-labelledby="links-label"></ul>
      <div class="link-add">
        <label class="sr-only" for="link-url">Link address</label>
        <input class="input" id="link-url" type="url" inputmode="url" autocomplete="off" spellcheck="false" placeholder="${esc(placeholder)}">
        <label class="sr-only" for="link-label">Link label</label>
        <input class="input" id="link-label" maxlength="${LINK_LIMITS.label}" autocomplete="off" placeholder="Label (optional)">
        <button type="button" class="btn btn--ghost btn--sm" data-add-link>${icon('plus', 16)}Add</button>
      </div>
      <span class="field__hint">${esc(hint)}</span>
      <span class="field__error" data-error="links" hidden></span>
    </div>`;
}

export function mountLinkEditor(root, initial = []) {
  const links = [...initial];
  const list = root.querySelector('[data-links]');
  const urlIn = root.querySelector('#link-url');
  const labelIn = root.querySelector('#link-label');
  const err = root.querySelector('[data-error="links"]');

  const render = () => {
    list.innerHTML = links.map((l, i) => `
      <li class="link-item">
        <a class="link-item__a" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">
          ${icon('link', 16)}<span class="link-item__text"><span class="link-item__label">${esc(linkText(l))}</span>
          <span class="link-item__host">${esc(hostOf(l.url))}</span></span>${icon('external', 14)}
        </a>
        <button type="button" class="icon-btn" data-remove-link="${i}" aria-label="Remove link: ${esc(linkText(l))}">${icon('x', 16)}</button>
      </li>`).join('');
    list.hidden = !links.length;
  };
  const showError = (msg) => {
    err.textContent = msg;
    err.hidden = !msg;
    if (msg) urlIn.setAttribute('aria-invalid', 'true');
    else urlIn.removeAttribute('aria-invalid');
  };
  const addPending = () => {
    const raw = urlIn.value.trim();
    if (!raw) return true;
    const url = normalizeUrl(raw);
    if (!url) { showError("That doesn't look like a web address. Paste the full link, e.g. https://drive.google.com/…"); urlIn.focus(); return false; }
    if (links.length >= LINK_LIMITS.count) { showError(`You can add up to ${LINK_LIMITS.count} links.`); return false; }
    if (links.some((l) => l.url === url)) { showError('This link is already added.'); return false; }
    links.push({ label: labelIn.value.trim().slice(0, LINK_LIMITS.label), url });
    urlIn.value = '';
    labelIn.value = '';
    showError('');
    render();
    return true;
  };

  render();
  root.querySelector('[data-add-link]').addEventListener('click', () => { if (addPending()) urlIn.focus(); });
  [urlIn, labelIn].forEach((inp) => inp.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && !ev.metaKey && !ev.ctrlKey) {
      ev.preventDefault();
      if (addPending()) urlIn.focus();
    }
  }));
  urlIn.addEventListener('input', () => showError(''));
  list.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-remove-link]');
    if (!b) return;
    links.splice(Number(b.dataset.removeLink), 1);
    render();
    urlIn.focus();
  });

  return { links, addPending, focus: () => urlIn.focus(), showError };
}

// Read-only list of links for detail views.
export function linkListHTML(links) {
  if (!links?.length) return '';
  return `<ul class="link-list">${links.map((l) => `
    <li class="link-item"><a class="link-item__a" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">
      ${icon('link', 16)}<span class="link-item__text"><span class="link-item__label">${esc(linkText(l))}</span>
      <span class="link-item__host">${esc(hostOf(l.url))}</span></span>${icon('external', 14)}
    </a></li>`).join('')}</ul>`;
}
