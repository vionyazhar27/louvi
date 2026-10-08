// Small single-series line chart (SVG) with a hover/tap tooltip.
// Drawn at the container's real pixel width so text stays readable on phones.
//
// mountLineChart(container, points, { format, formatAxis, label })
//   points: [{ x: 'Oct 26', value: 123, title: 'October 2026' }]

import { esc } from './dom.js';

function niceTicks(min, max, count = 4) {
  if (min === max) { const pad = Math.abs(min) * 0.1 || 1; min -= pad; max += pad; }
  const raw = (max - min) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || raw;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v));
  return ticks;
}

export function mountLineChart(container, points, { format = String, formatAxis = format, label = 'Chart' } = {}) {
  let ro;
  const draw = () => {
    const width = Math.max(260, Math.floor(container.clientWidth));
    const height = width < 480 ? 180 : 220;
    const pad = { l: 58, r: 20, t: 16, b: 28 };
    const values = points.map((p) => p.value);
    const ticks = niceTicks(Math.min(...values), Math.max(...values));
    const yMin = ticks[0], yMax = ticks[ticks.length - 1];
    const iw = width - pad.l - pad.r, ih = height - pad.t - pad.b;
    const x = (i) => pad.l + (points.length === 1 ? iw / 2 : (i * iw) / (points.length - 1));
    const y = (v) => pad.t + ih - ((v - yMin) / (yMax - yMin || 1)) * ih;

    const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
    const area = `${line} L${x(points.length - 1).toFixed(1)},${(pad.t + ih).toFixed(1)} L${x(0).toFixed(1)},${(pad.t + ih).toFixed(1)} Z`;
    // Show at most ~6 x labels so they never collide.
    const every = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor(iw / 70))));
    const last = points.length - 1;

    container.innerHTML = `
      <svg class="lc" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(label)}">
        ${ticks.map((t) => `<line class="lc__grid" x1="${pad.l}" x2="${width - pad.r}" y1="${y(t)}" y2="${y(t)}"/>
          <text class="lc__axis" x="${pad.l - 8}" y="${y(t)}" text-anchor="end" dominant-baseline="middle">${esc(formatAxis(t))}</text>`).join('')}
        ${points.map((p, i) => (i % every === 0 || i === last) && !(i !== last && last - i < every) ? `<text class="lc__axis" x="${x(i)}" y="${height - 8}" text-anchor="middle">${esc(p.x)}</text>` : '').join('')}
        <path class="lc__area" d="${area}"/>
        <path class="lc__line" d="${line}"/>
        <line class="lc__cross" x1="0" x2="0" y1="${pad.t}" y2="${pad.t + ih}" hidden/>
        <circle class="lc__dot" r="4.5" cx="${x(last)}" cy="${y(points[last].value)}"/>
        <circle class="lc__hover" r="4.5" cx="0" cy="0" hidden/>
        ${points.map((p, i) => {
          const left = i === 0 ? pad.l : (x(i - 1) + x(i)) / 2;
          const right = i === last ? width - pad.r : (x(i) + x(i + 1)) / 2;
          return `<rect class="lc__hit" data-i="${i}" x="${left}" y="${pad.t}" width="${Math.max(1, right - left)}" height="${ih}"/>`;
        }).join('')}
      </svg>
      <div class="lc__tip" hidden></div>`;

    const svg = container.querySelector('svg');
    const tip = container.querySelector('.lc__tip');
    const cross = container.querySelector('.lc__cross');
    const hover = container.querySelector('.lc__hover');
    const show = (i) => {
      const p = points[i];
      cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.hidden = false;
      hover.setAttribute('cx', x(i)); hover.setAttribute('cy', y(p.value)); hover.hidden = false;
      tip.innerHTML = `<span class="lc__tip-t">${esc(p.title || p.x)}</span><strong>${esc(format(p.value))}</strong>`;
      tip.hidden = false;
      const tw = tip.offsetWidth;
      tip.style.left = `${Math.min(Math.max(0, x(i) - tw / 2), width - tw)}px`;
      tip.style.top = `${Math.max(0, y(p.value) - 58)}px`;
    };
    const hide = () => { tip.hidden = true; cross.hidden = true; hover.hidden = true; };
    svg.addEventListener('pointermove', (ev) => { const r = ev.target.closest('.lc__hit'); if (r) show(+r.dataset.i); });
    svg.addEventListener('pointerdown', (ev) => { const r = ev.target.closest('.lc__hit'); if (r) show(+r.dataset.i); });
    svg.addEventListener('pointerleave', hide);
  };
  draw();
  if ('ResizeObserver' in window) {
    let w = container.clientWidth;
    ro = new ResizeObserver(() => { if (Math.abs(container.clientWidth - w) > 4) { w = container.clientWidth; draw(); } });
    ro.observe(container);
  }
  return () => ro?.disconnect();
}
