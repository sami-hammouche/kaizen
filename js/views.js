// Kaizen web — the five screens (Accueil, Annonces, Auto, Ventes, Plus).
// Everything shown comes from the last state sent by the user's extension (S.data);
// every action is an order (command) that the extension runs on the PC.
import * as api from './api.js';
import { EXTENSION_ZIP, ONLINE_MS } from './config.js';
import { $, $$, esc, money, price, fmtDate, ago, toast, splitBlocks, joinBlocks, lineChart } from './util.js';

export const S = {
  user: null,
  snap: null, // row of the "snapshots" table
  data: {}, // snapshot data sent by the extension
  commands: [],
  view: 'home',
  selected: new Set(),
  filter: 'all',
  search: '',
  dirty: false, // a settings form is being edited: do not redraw it
  go: null, // set by main.js
  leave: null,
};

export const isOnline = () => !!S.snap && Date.now() - new Date(S.snap.seen_at).getTime() < ONLINE_MS;

const LABELS = {
  enqueue: 'Republication', stop: 'Arrêt de la file', runScheduleNow: 'Passage de planification',
  saveSettings: 'Réglages', bulk: 'Modification', priceDropNow: 'Baisse de prix', runAutoMessagesNow: 'Messages automatiques',
  createJob: 'Message programmé', cancelJob: 'Annulation', sendOffers: 'Offres', suggestPrices: 'Prix conseillé', refresh: 'Actualisation',
};
export function commandLabel(c) {
  if (c.action === 'bulk') return { setHidden: c.args?.ops?.[0]?.hidden ? 'Masquer' : 'Afficher', setPrice: 'Prix', deleteItem: 'Suppression' }[c.args?.action] || 'Modification';
  return LABELS[c.action] || c.action;
}
const pending = (action) => S.commands.some((c) => c.action === action && (c.status === 'pending' || c.status === 'running'));

async function send(action, args = {}) {
  try {
    const cmd = await api.sendCommand(action, args);
    S.commands.unshift(cmd);
    toast(isOnline() ? `${commandLabel(cmd)} : envoyé à ton PC.` : `${commandLabel(cmd)} : ton PC est hors ligne, ça partira à son retour.`);
    render();
    return cmd;
  } catch (e) {
    toast(e.message, 'err');
    return null;
  }
}

// ---------- Rendering ----------

export function render() {
  const v = $('#view');
  if (!v || $('#app').hidden) return;
  if (S.view === 'auto' && S.dirty) return; // keep what the user is typing
  const html = { home, items, auto, sales, more }[S.view]?.() ?? '';
  v.innerHTML = html;
  renderActionbar();
}

const onboarding = () => `
  <div class="card section">
    <h3>Relie Kaizen à ton PC</h3>
    <p>Le site pilote l'extension Kaizen installée dans Chrome sur ton ordinateur : c'est elle qui agit sur Vinted, avec ta propre connexion.</p>
    <ol class="steps">
      <li><a href="${EXTENSION_ZIP}" download>Télécharge l'extension Kaizen</a> (fichier ZIP) et décompresse-la dans un dossier que tu garderas.</li>
      <li>Dans Chrome, va sur <b>chrome://extensions</b>, active le <b>Mode développeur</b>, puis <b>Charger l'extension non empaquetée</b> et choisis le dossier.</li>
      <li>Ouvre Kaizen (icône puzzle 🧩 → Kaizen → Ouvrir le tableau de bord), lis l'accueil, connecte-toi à Vinted.</li>
      <li>Dans Kaizen, onglet <b>Réglages → Site Kaizen</b> : connecte-toi avec ce même compte (<b>${esc(S.user?.email)}</b>).</li>
    </ol>
    <p class="muted">Cette page se mettra à jour toute seule dès que ton extension sera reliée.</p>
  </div>`;

function statusBanner() {
  if (!S.snap) return '';
  const d = S.data, st = d.state || {};
  const on = isOnline();
  let activity = 'Aucune republication en cours.';
  if (st.current) activity = `Republication en cours (${st.queue?.length || 0} en file).`;
  else if (st.queue?.length) activity = `${st.queue.length} annonce(s) en file${st.nextAt ? ', pause de sécurité en cours' : ''}.`;
  return `<div class="banner ${on ? 'on' : 'off'}">
    <b>${on ? '🟢 Ton PC est en ligne' : '🔴 Ton PC est hors ligne'}</b>
    <div class="muted">${on ? 'Vu ' + ago(S.snap.seen_at) : 'Dernier signe ' + ago(S.snap.seen_at) + ' : allume ton PC et Chrome pour que Kaizen travaille. Tes ordres partiront à son retour.'}</div>
    <div>${activity}</div>
    ${st.lastError ? `<div class="msg">${esc(st.lastError)}</div>` : ''}
  </div>`;
}

function historyItem(e) {
  const icon = !e.ok ? '✗' : { sale: '🎉', offer: '✉', messages: '💬', thanks: '🙏', rated: '⭐', price: '€', delete: '🗑' }[e.kind] || '✓';
  const text = !e.ok ? e.error
    : e.kind === 'sale' ? `Vendu : ${e.title} (${money(e.price)})`
    : e.kind === 'offer' ? `Offre envoyée : ${e.title} à ${money(e.price)}`
    : e.kind === 'messages' ? `${e.count} message(s) envoyé(s) : ${e.title}`
    : e.kind === 'thanks' ? `Remerciement envoyé : ${e.title}`
    : e.kind === 'rated' ? `Acheteur évalué : ${e.title}`
    : e.kind === 'price' ? `${e.title} : ${e.oldPrice} → ${e.newPrice} €`
    : e.kind === 'delete' ? `Supprimée : ${e.title}`
    : `Republiée : ${e.title}`;
  return `<li><span class="${e.ok ? '' : 'tag err'}">${icon}</span><div class="grow"><div class="t">${esc(text)}</div><div class="s">${fmtDate(e.ts)}</div></div></li>`;
}

// ---------- Accueil ----------

function home() {
  if (!S.snap) return `<h2 class="title">Bienvenue 👋</h2>${onboarding()}`;
  const d = S.data, st = d.state || {}, set = d.settings || {};
  const items = d.items || [];
  const visible = items.filter((i) => !i.sold && !i.hidden && !i.reserved).length;
  const autos = [
    ['Planification', set.schedule?.enabled, set.schedule?.times?.join(', ')],
    ['Offres auto', set.offers?.auto],
    ['Messages auto', set.autoMsg?.enabled],
    ['Baisse de prix', set.priceDrop?.enabled],
    ['Après-vente', set.afterSale?.thanks || set.afterSale?.rate],
  ];
  return `
    <h2 class="title">Bonjour${d.me?.login ? ' ' + esc(d.me.login) : ''} 👋</h2>
    ${statusBanner()}
    <div class="grid2 section">
      <div class="stat"><div class="v">${st.todayCount ?? 0}<span class="muted">/${set.dailyLimit ?? '—'}</span></div><div class="l">Republiées aujourd'hui</div></div>
      <div class="stat"><div class="v">${st.offersToday ?? 0}</div><div class="l">Offres aujourd'hui</div></div>
      <div class="stat"><div class="v">${st.messagesToday ?? 0}</div><div class="l">Messages aujourd'hui</div></div>
      <div class="stat"><div class="v">${visible}</div><div class="l">Annonces visibles</div></div>
    </div>
    <div class="card section">
      <h3>Actions rapides</h3>
      <div class="btns">
        <button class="primary" data-act="runScheduleNow" ${pending('runScheduleNow') ? 'disabled' : ''}>🔁 Republier maintenant (${set.schedule?.count ?? 5})</button>
        ${st.queue?.length || st.current ? `<button class="danger" data-act="stop">⏹ Arrêter la file</button>` : ''}
        <button data-act="refresh" ${pending('refresh') ? 'disabled' : ''}>🔄 Actualiser mes annonces</button>
        <button data-act="runAutoMessagesNow" ${pending('runAutoMessagesNow') ? 'disabled' : ''}>💬 Vérifier les favoris</button>
      </div>
      <p class="muted">« Republier maintenant » utilise ta planification (${set.schedule?.strategy === 'selection' ? 'ta sélection' : 'les annonces les plus anciennes'}).</p>
    </div>
    <div class="card section">
      <h3>Automatisations</h3>
      <ul class="list">${autos.map(([n, on, extra]) => `<li><div class="grow">${n}${extra && on ? ` <span class="muted">· ${esc(extra)}</span>` : ''}</div><span class="tag ${on ? 'ok' : ''}">${on ? 'Activé' : 'Désactivé'}</span></li>`).join('')}</ul>
      <div class="btns"><button data-go="auto">Modifier</button></div>
    </div>
    <div class="card section">
      <h3>Dernières actions</h3>
      <ul class="list">${(d.history || []).slice(0, 6).map(historyItem).join('') || '<li class="muted">Rien pour l’instant.</li>'}</ul>
    </div>`;
}

// ---------- Annonces ----------

function filtered() {
  const q = S.search.trim().toLowerCase();
  return (S.data.items || [])
    .filter((i) => (S.filter === 'visible' ? !i.sold && !i.hidden && !i.reserved
      : S.filter === 'hidden' ? !i.sold && (i.hidden || i.reserved)
      : S.filter === 'sold' ? i.sold : !i.sold))
    .filter((i) => !q || i.title.toLowerCase().includes(q))
    .sort((a, b) => a.id - b.id);
}

function items() {
  if (!S.snap) return onboarding();
  const list = filtered();
  const fav = S.data.favCount || {};
  const chip = (k, l) => `<button data-filter="${k}" class="${S.filter === k ? 'on' : ''}">${l}</button>`;
  return `
    <div class="row"><h2 class="title">Annonces</h2><span class="spacer"></span>
      <button data-act="refresh" ${pending('refresh') ? 'disabled' : ''}>🔄</button></div>
    <p class="muted">Mises à jour ${ago(S.data.itemsAt)} · touche une annonce pour la sélectionner.</p>
    <input id="search" type="search" placeholder="Rechercher…" value="${esc(S.search)}">
    <div class="chips">${chip('all', 'Toutes')}${chip('visible', 'Visibles')}${chip('hidden', 'Masquées')}${chip('sold', 'Vendues')}</div>
    <div class="items">${list.map((i) => `
      <div class="item ${S.selected.has(i.id) ? 'sel' : ''}" data-id="${i.id}">
        ${i.sold ? '' : '<span class="box"></span>'}
        ${i.sold ? '<span class="badge">Vendue</span>' : i.reserved ? '<span class="badge">Réservée</span>' : i.hidden ? '<span class="badge">Masquée</span>' : ''}
        <img src="${esc(i.photo || '')}" alt="" loading="lazy">
        <div class="info"><div class="t">${esc(i.title)}</div>
          <div class="m"><span class="p">${price(i.price)}</span><span>👁 ${i.views} · ♥ ${i.favourites}${fav[i.id] ? ` · 👤${fav[i.id]}` : ''}</span></div></div>
      </div>`).join('') || '<p class="empty">Aucune annonce ici.</p>'}</div>`;
}

function renderActionbar() {
  const bar = $('#actionbar');
  const n = S.selected.size;
  bar.hidden = !(S.view === 'items' && n);
  if (bar.hidden) return;
  bar.innerHTML = `<b>${n} annonce(s) sélectionnée(s)</b>
    <button class="primary" data-bulk="republish">🔁 Republier</button>
    <button data-bulk="hide">Masquer</button>
    <button data-bulk="show">Afficher</button>
    <select id="pricePct"><option value="5">−5 %</option><option value="10" selected>−10 %</option><option value="15">−15 %</option><option value="20">−20 %</option></select>
    <button data-bulk="price">Baisser le prix</button>
    <button data-bulk="clear">✕</button>`;
}

// ---------- Automatisations ----------

const DAYS = [[1, 'Lun'], [2, 'Mar'], [3, 'Mer'], [4, 'Jeu'], [5, 'Ven'], [6, 'Sam'], [0, 'Dim']];
const sw = (id, on, label) => `<label class="switch">${label}<input type="checkbox" id="${id}" ${on ? 'checked' : ''}></label>`;

function auto() {
  if (!S.snap) return onboarding();
  const s = S.data.settings || {};
  const sch = s.schedule || {}, off = s.offers || {}, am = s.autoMsg || {}, pd = s.priceDrop || {}, as = s.afterSale || {};
  const t = off.tiers || [];
  const busy = pending('saveSettings') ? '<p class="tag wait">Réglages en cours d’envoi au PC…</p>' : '';
  return `
    <h2 class="title">Automatisations</h2>
    <p class="muted">Les changements sont envoyés à ton PC, qui les applique sous 30 secondes.</p>${busy}
    <form class="card section" data-form="schedule">
      ${sw('schOn', sch.enabled, '🔁 Republication planifiée')}
      <label>Heures (séparées par des virgules)<input id="schTimes" value="${esc((sch.times || []).join(', '))}" placeholder="12:30, 18:30, 21:00"></label>
      <div class="days">${DAYS.map(([d, l]) => `<label><input type="checkbox" data-day="${d}" ${(sch.days || []).includes(d) ? 'checked' : ''}> ${l}</label>`).join('')}</div>
      <div class="inline"><label>Annonces par passage<input id="schCount" type="number" min="1" max="100" value="${sch.count ?? 5}"></label>
        <label>Lesquelles<select id="schStrategy"><option value="oldest" ${sch.strategy !== 'selection' ? 'selected' : ''}>Les plus anciennes</option><option value="selection" ${sch.strategy === 'selection' ? 'selected' : ''}>Ma sélection</option></select></label></div>
      <div class="btns"><button type="button" data-fill-times>Créneaux conseillés</button><button class="primary" type="submit">Enregistrer</button></div>
    </form>

    <form class="card section" data-form="offers">
      ${sw('offAuto', off.auto, '✉️ Offres automatiques aux favoris')}
      <div class="inline">
        <label>Remise<select id="offMode"><option value="single" ${off.mode !== 'tiers' ? 'selected' : ''}>Unique</option><option value="tiers" ${off.mode === 'tiers' ? 'selected' : ''}>Par paliers</option></select></label>
        <label>% (unique)<input id="offPct" type="number" min="1" max="80" value="${off.percent ?? 10}"></label>
        <label>Max / jour<input id="offMax" type="number" min="1" value="${off.maxPerDay ?? 20}"></label>
      </div>
      <div class="inline"><label>Jusqu'à (€)<input id="t1u" type="number" value="${t[0]?.upTo ?? 30}"></label><label>%<input id="t1p" type="number" value="${t[0]?.percent ?? 5}"></label></div>
      <div class="inline"><label>Jusqu'à (€)<input id="t2u" type="number" value="${t[1]?.upTo ?? 80}"></label><label>%<input id="t2p" type="number" value="${t[1]?.percent ?? 10}"></label></div>
      <div class="inline"><label>Au-dessus : %<input id="t3p" type="number" value="${t[2]?.percent ?? 15}"></label></div>
      <div class="btns"><button class="primary" type="submit">Enregistrer</button></div>
    </form>

    <form class="card section" data-form="autoMsg">
      ${sw('amOn', am.enabled, '💬 Messages automatiques aux favoris')}
      <label>Modèles (séparés par une ligne ---), {titre} et {prix} remplacés<textarea id="amTpl" rows="7">${esc(joinBlocks(am.templates))}</textarea></label>
      <div class="inline">
        <label>Note minimum de l'acheteur<select id="amRating">${[[0, 'Aucune'], [3, '3 ★'], [4, '4 ★'], [4.5, '4,5 ★']].map(([v, l]) => `<option value="${v}" ${Number(am.minRating) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label>Attendre (min)<input id="amWait" type="number" min="0" value="${am.minAgeMin ?? 10}"></label>
      </div>
      <div class="btns"><button class="primary" type="submit">Enregistrer</button></div>
    </form>

    <form class="card section" data-form="priceDrop">
      ${sw('pdOn', pd.enabled, '📉 Baisse de prix automatique')}
      <div class="inline">
        <label>Baisser de (%)<input id="pdPct" type="number" min="1" max="50" value="${pd.percent ?? 5}"></label>
        <label>Tous les (jours)<input id="pdDays" type="number" min="1" value="${pd.everyDays ?? 7}"></label>
        <label>Prix plancher (€)<input id="pdMin" type="number" min="1" step="0.5" value="${pd.minPrice ?? 5}"></label>
      </div>
      <label class="check"><input id="pdCost" type="checkbox" ${pd.keepCost !== false ? 'checked' : ''}> Jamais sous le prix d'achat</label>
      <div class="btns"><button type="button" data-act="priceDropNow">Lancer maintenant</button><button class="primary" type="submit">Enregistrer</button></div>
    </form>

    <form class="card section" data-form="afterSale">
      ${sw('asThanks', as.thanks, '🙏 Message après chaque vente')}
      <textarea id="asTexts" rows="3">${esc(joinBlocks(as.thanksTexts))}</textarea>
      <div style="height:12px"></div>
      ${sw('asRate', as.rate, '⭐ Évaluer l’acheteur 5 ★ (finalisée)')}
      <input id="asComment" value="${esc(as.rateComment || '')}" maxlength="250">
      <div class="btns"><button class="primary" type="submit">Enregistrer</button></div>
    </form>

    <form class="card section" data-form="safety">
      <h3>🛡️ Prudence</h3>
      <div class="inline">
        <label>Max republications / jour<input id="sfLimit" type="number" min="1" value="${s.dailyLimit ?? 40}"></label>
        <label>Pause min (s)<input id="sfMin" type="number" min="5" value="${s.minDelay ?? 60}"></label>
        <label>Pause max (s)<input id="sfMax" type="number" min="5" value="${s.maxDelay ?? 180}"></label>
      </div>
      <label>Après une republication, l'ancienne annonce est<select id="sfOld">
        <option value="hide" ${s.oldListing === 'hide' ? 'selected' : ''}>Masquée (garde ses favoris)</option>
        <option value="delete" ${s.oldListing === 'delete' ? 'selected' : ''}>Supprimée</option>
        <option value="keep" ${s.oldListing === 'keep' ? 'selected' : ''}>Gardée visible</option></select></label>
      <p class="warn">Plus les pauses sont courtes et les limites élevées, plus Vinted risque de limiter ton compte.</p>
      <div class="btns"><button class="primary" type="submit">Enregistrer</button></div>
    </form>`;
}

const num = (id) => Number($('#' + id).value);
const FORMS = {
  schedule() {
    const times = $('#schTimes').value.split(',').map((t) => t.trim()).filter(Boolean).map((t) => {
      const m = t.match(/^(\d{1,2})[:hH](\d{2})?$/);
      if (!m || +m[1] > 23 || +(m[2] || 0) > 59) throw new Error(`Heure invalide : « ${t} » (format 18:30)`);
      return `${m[1].padStart(2, '0')}:${m[2] || '00'}`;
    });
    if (!times.length) throw new Error('Indique au moins une heure.');
    const days = $$('[data-day]').filter((c) => c.checked).map((c) => Number(c.dataset.day));
    return { schedule: { enabled: $('#schOn').checked, times, days, count: num('schCount'), strategy: $('#schStrategy').value } };
  },
  offers() {
    if (!(num('t1u') > 0 && num('t2u') > num('t1u'))) throw new Error('Les paliers doivent être croissants (ex. 30 € puis 80 €).');
    return { offers: { auto: $('#offAuto').checked, mode: $('#offMode').value, percent: num('offPct'), maxPerDay: num('offMax'),
      tiers: [{ upTo: num('t1u'), percent: num('t1p') }, { upTo: num('t2u'), percent: num('t2p') }, { upTo: null, percent: num('t3p') }] } };
  },
  autoMsg() {
    const templates = splitBlocks($('#amTpl').value);
    if ($('#amOn').checked && !templates.length) throw new Error('Écris au moins un message.');
    if (templates.length > 10) throw new Error('10 messages maximum.');
    return { autoMsg: { enabled: $('#amOn').checked, templates, minRating: num('amRating'), minAgeMin: num('amWait') } };
  },
  priceDrop() {
    return { priceDrop: { enabled: $('#pdOn').checked, percent: num('pdPct'), everyDays: num('pdDays'), minPrice: num('pdMin'), keepCost: $('#pdCost').checked } };
  },
  afterSale() {
    const thanksTexts = splitBlocks($('#asTexts').value);
    if ($('#asThanks').checked && !thanksTexts.length) throw new Error('Écris au moins un message de remerciement.');
    return { afterSale: { thanks: $('#asThanks').checked, thanksTexts, rate: $('#asRate').checked, rateComment: $('#asComment').value.trim() } };
  },
  safety() {
    if (num('sfMax') < num('sfMin')) throw new Error('La pause max doit être ≥ la pause min.');
    return { dailyLimit: num('sfLimit'), minDelay: num('sfMin'), maxDelay: num('sfMax'), oldListing: $('#sfOld').value };
  },
};

// ---------- Ventes ----------

function sales() {
  if (!S.snap) return onboarding();
  const orders = S.data.orders || [];
  const costs = S.data.costs || {};
  const ok = orders.filter((o) => o.userStatus !== 'failed');
  const sum = (l) => l.reduce((n, o) => n + (o.price || 0), 0);
  const month = new Date().toISOString().slice(0, 7);
  const thisMonth = ok.filter((o) => new Date(o.date).toISOString().slice(0, 7) === month);
  const withCost = ok.filter((o) => costs['t' + o.tx] != null);
  const margin = withCost.reduce((n, o) => n + o.price - costs['t' + o.tx], 0);
  const days = S.data.stats?.days || [];
  return `
    <h2 class="title">Ventes</h2>
    <div class="grid2 section">
      <div class="stat"><div class="v">${ok.length}</div><div class="l">Ventes</div></div>
      <div class="stat"><div class="v">${money(sum(ok))}</div><div class="l">Chiffre d'affaires</div></div>
      <div class="stat"><div class="v">${money(sum(thisMonth))}</div><div class="l">Ce mois-ci (${thisMonth.length})</div></div>
      <div class="stat"><div class="v">${ok.length ? money(sum(ok) / ok.length) : '—'}</div><div class="l">Panier moyen</div></div>
      ${withCost.length ? `<div class="stat"><div class="v">${money(margin)}</div><div class="l">Marge (${withCost.length} avec prix d'achat)</div></div>` : ''}
    </div>
    <div class="card section"><h3>Évolution</h3>
      ${lineChart(days, 'views', '#e0263a', 'Vues')}${lineChart(days, 'favs', '#f5b84a', 'Favoris')}</div>
    <div class="card section"><h3>Dernières ventes</h3>
      <ul class="list">${orders.slice(0, 40).map((o) => `<li>
        <img class="thumb" src="${esc(o.photo || '')}" alt="">
        <div class="grow"><div class="t">${esc(o.title)}</div><div class="s">${fmtDate(o.date)} · ${esc(o.status || '')}</div></div>
        <span class="tag ${o.userStatus === 'failed' ? 'err' : 'ok'}">${money(o.price)}</span></li>`).join('') || '<li class="muted">Aucune vente reçue pour l’instant.</li>'}</ul>
      <p class="muted">Les prix d'achat se saisissent dans l'extension (onglet Ventes).</p>
    </div>`;
}

// ---------- Plus ----------

function more() {
  const d = S.data;
  const jobs = d.jobs || [];
  const cmdTag = (c) => ({ pending: ['En attente', 'wait'], running: ['En cours', 'wait'], done: ['Fait', 'ok'], error: ['Erreur', 'err'] }[c.status] || [c.status, '']);
  return `
    <h2 class="title">Plus</h2>
    ${S.snap ? `<div class="card section"><h3>Historique</h3>
      <ul class="list">${(d.history || []).slice(0, 30).map(historyItem).join('') || '<li class="muted">Rien pour l’instant.</li>'}</ul></div>
    <div class="card section"><h3>Messages programmés</h3>
      <ul class="list">${jobs.map((j) => `<li><div class="grow"><div class="t">${esc(j.title)}</div>
        <div class="s">${fmtDate(j.at)} · ${Object.values(j.done || {}).filter((v) => v === 'ok').length}/${j.recipients} envoyé(s)</div></div>
        <span class="tag ${j.status === 'done' ? 'ok' : j.status === 'error' ? 'err' : ''}">${{ scheduled: 'Programmé', running: 'En cours', done: 'Terminé', cancelled: 'Annulé', error: 'Erreur' }[j.status] || j.status}</span>
        ${j.status === 'scheduled' || j.status === 'running' ? `<button data-cancel-job="${esc(j.id)}">Annuler</button>` : ''}</li>`).join('') || '<li class="muted">Aucun.</li>'}</ul>
      <p class="muted">Pour programmer un message, utilise l'onglet Messages de l'extension.</p></div>` : ''}
    <div class="card section"><h3>Ordres envoyés à ton PC</h3>
      <ul class="list">${S.commands.slice(0, 15).map((c) => { const [l, k] = cmdTag(c); return `<li><div class="grow"><div class="t">${esc(commandLabel(c))}</div><div class="s">${fmtDate(c.created_at)}${c.error ? ' · ' + esc(c.error) : ''}</div></div><span class="tag ${k}">${l}</span></li>`; }).join('') || '<li class="muted">Aucun.</li>'}</ul></div>
    <div class="card section"><h3>Mon compte</h3>
      <p>Connecté en tant que <b>${esc(S.user?.email)}</b>${d.me?.login ? ` · Vinted : <b>${esc(d.me.login)}</b>` : ''}</p>
      <p class="muted">Installer l'extension sur un autre PC : <a href="${EXTENSION_ZIP}" download>télécharger Kaizen</a>, puis Réglages → Site Kaizen.</p>
      <div class="btns"><button data-logout>Se déconnecter</button><button class="danger" data-delete-account>Supprimer mon compte</button></div>
      <p class="muted"><a href="privacy.html">Confidentialité et avertissement</a> · Kaizen n'est pas affilié à Vinted.</p></div>`;
}

// ---------- Events (one delegated listener for the whole app) ----------

document.addEventListener('click', async (e) => {
  const t = e.target.closest('button, .item');
  if (!t || $('#app').hidden) return;
  if (t.dataset.go) return S.go(t.dataset.go);
  if (t.dataset.act) {
    if (t.dataset.act === 'stop' && !confirm('Arrêter la file de republication ?')) return;
    return send(t.dataset.act);
  }
  if (t.dataset.filter) {
    S.filter = t.dataset.filter;
    return render();
  }
  if (t.classList.contains('item')) {
    const id = Number(t.dataset.id);
    const it = (S.data.items || []).find((i) => i.id === id);
    if (!it || it.sold) return;
    S.selected.has(id) ? S.selected.delete(id) : S.selected.add(id);
    t.classList.toggle('sel', S.selected.has(id));
    return renderActionbar();
  }
  if (t.dataset.bulk) {
    const ids = [...S.selected];
    const byId = new Map((S.data.items || []).map((i) => [i.id, i]));
    if (t.dataset.bulk === 'clear') S.selected.clear();
    else if (t.dataset.bulk === 'republish') {
      if (!confirm(`Republier ${ids.length} annonce(s) ? (une par une, avec des pauses)`)) return;
      await send('enqueue', { ids });
      S.selected.clear();
    } else if (t.dataset.bulk === 'hide' || t.dataset.bulk === 'show') {
      await send('bulk', { action: 'setHidden', ops: ids.map((id) => ({ id, hidden: t.dataset.bulk === 'hide' })) });
      S.selected.clear();
    } else if (t.dataset.bulk === 'price') {
      const pct = Number($('#pricePct').value);
      const ops = ids.map((id) => {
        const p = byId.get(id)?.price?.amount;
        return { id, price: Math.max(1, Math.round(p * (1 - pct / 100) * 10) / 10) };
      }).filter((o) => o.price < byId.get(o.id)?.price?.amount);
      if (!ops.length) return toast('Rien à baisser.');
      if (!confirm(`Baisser de ${pct} % le prix de ${ops.length} annonce(s) ?`)) return;
      await send('bulk', { action: 'setPrice', ops });
      S.selected.clear();
    }
    render();
    return;
  }
  if (t.dataset.fillTimes != null) {
    $('#schTimes').value = '12:30, 18:30, 21:00';
    S.dirty = true;
    return;
  }
  if (t.dataset.cancelJob) return send('cancelJob', { id: t.dataset.cancelJob });
  if (t.dataset.logout != null) return api.signOut();
  if (t.dataset.deleteAccount != null) {
    if (!confirm('Supprimer définitivement ton compte Kaizen et toutes ses données sur le site ?')) return;
    if (!confirm('Vraiment ? Cette action est irréversible.')) return;
    try {
      await api.deleteAccount();
      toast('Compte supprimé.');
    } catch (err) {
      toast(err.message, 'err');
    }
  }
});

document.addEventListener('submit', async (e) => {
  const form = e.target.closest('[data-form]');
  if (!form) return;
  e.preventDefault();
  let patch;
  try {
    patch = FORMS[form.dataset.form]();
  } catch (err) {
    return toast(err.message, 'err');
  }
  S.dirty = false;
  await send('saveSettings', { settings: patch });
});

document.addEventListener('input', (e) => {
  if (e.target.id === 'search') {
    S.search = e.target.value;
    const pos = e.target.selectionStart;
    render();
    const s = $('#search');
    s.focus();
    s.setSelectionRange(pos, pos);
    return;
  }
  if (S.view === 'auto' && e.target.closest('[data-form]')) S.dirty = true;
});
document.addEventListener('change', (e) => {
  if (S.view === 'auto' && e.target.closest('[data-form]')) S.dirty = true;
});
