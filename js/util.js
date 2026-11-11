// Small DOM and formatting helpers.

export const $ = (s, root = document) => root.querySelector(s);
export const $$ = (s, root = document) => [...root.querySelectorAll(s)];

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export const money = (n) =>
  n == null || isNaN(n) ? '—' : `${Number(n).toFixed(2).replace('.', ',')} €`;

export const price = (p) => money(p?.amount ?? p);

export const fmtDate = (ts) =>
  ts ? new Date(ts).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '';

export function ago(ts) {
  if (!ts) return 'jamais';
  const s = Math.round((Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 60) return 'à l’instant';
  if (s < 3600) return `il y a ${Math.round(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.round(s / 3600)} h`;
  return `il y a ${Math.round(s / 86400)} j`;
}

let toastTimer;
export function toast(text, kind = '') {
  const t = $('#toast');
  t.textContent = text;
  t.className = 'toast ' + kind;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 4000);
}

// Lines separated by a "---" line <-> list of texts.
export const splitBlocks = (text) => text.split(/^\s*---\s*$/m).map((t) => t.trim()).filter(Boolean);
export const joinBlocks = (list) => (list || []).join('\n---\n');

export function lineChart(days, key, color, label) {
  if (!days.length) return '<p class="muted">Pas encore de relevé.</p>';
  const W = 460, H = 150, P = 28;
  const vals = days.map((d) => d[key]);
  let max = Math.max(...vals), min = Math.min(...vals);
  const pad = Math.max(1, Math.round((max - min) * 0.15));
  max += pad;
  min = Math.max(0, min - pad);
  const x = (i) => P + (days.length === 1 ? (W - 2 * P) / 2 : (i * (W - 2 * P)) / (days.length - 1));
  const y = (v) => H - P + 8 - ((v - min) / (max - min || 1)) * (H - 2 * P);
  const pts = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const d0 = days[0].date.slice(5).split('-').reverse().join('/');
  const d1 = days.at(-1).date.slice(5).split('-').reverse().join('/');
  return `<figure class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">
    <line class="axis" x1="${P}" y1="${H - P + 8}" x2="${W - P}" y2="${H - P + 8}"/>
    <text x="${P}" y="${H - 4}">${d0}</text><text x="${W - P}" y="${H - 4}" text-anchor="end">${d1}</text>
    <text x="2" y="${y(max) + 10}">${max}</text><text x="2" y="${y(min) - 2}">${min}</text>
    <polyline fill="none" stroke="${color}" stroke-width="2.5" points="${pts}"/></svg>
    <figcaption><i style="background:${color}"></i>${esc(label)}</figcaption></figure>`;
}
