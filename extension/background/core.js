// Settings, state and history storage (loaded first).

// Bump together with EXPECTED_API in dashboard/core.js whenever the messages
// or settings shared with the dashboard change. A mismatch means Chrome is still
// running the old background: the dashboard then asks to reload the extension.
const API_VERSION = 6;

const DEFAULT_SETTINGS = {
  domain: 'www.vinted.fr',
  minDelay: 60, // seconds between two republications
  maxDelay: 180,
  dailyLimit: 40,
  oldListing: 'hide', // after republishing: 'hide' | 'delete' | 'keep'
  schedule: {
    enabled: false,
    times: ['18:00'],
    days: [0, 1, 2, 3, 4, 5, 6], // 0 = Sunday
    count: 5,
    strategy: 'oldest', // 'oldest' | 'selection'
  },
  selection: [], // item ids chosen for the "selection" strategy, in rotation order
  offers: {
    auto: false, // send offers automatically to new favourites
    percent: 10, // discount offered
    maxPerDay: 20,
    maxAgeHours: 48, // ignore favourites older than this
    minFavPrice: 5, // never offer on items cheaper than this
    mode: 'single', // 'single' = one % for all, 'tiers' = % by price band
    tiers: [
      { upTo: 30, percent: 5 },
      { upTo: 80, percent: 10 },
      { upTo: null, percent: 15 }, // null = above
    ],
  },
  messages: {
    maxPerDay: 30,
  },
  priceDrop: {
    enabled: false,
    everyDays: 7, // a listing unsold for this long gets cheaper
    percent: 5,
    minPrice: 5, // never below this (€)
    keepCost: true, // never below the purchase price
  },
  notify: { sales: true, favourites: true, errors: true },
  sales: { urssaf: false, urssafRate: 12.3 },
  keepPhotos: true, // republish from the saved original photos
  autoMsg: {
    enabled: false,
    templates: [
      "Bonjour ! Merci pour le favori sur « {titre} » 😊 Il est toujours dispo à {prix}, n'hésite pas si tu as une question !",
      "Hello ! J'ai vu que « {titre} » te plaisait 🙌 Je peux te faire un petit geste si tu es intéressé(e), dis-moi !",
      "Salut ! « {titre} » est encore disponible ({prix}). Si tu veux plus de photos ou de détails, je suis là 👍",
    ],
    minRating: 0, // 0 = off; otherwise skip buyers rated below this (and unrated ones)
    minAgeMin: 10, // wait a little after the favourite
    maxAgeHours: 48,
  },
  afterSale: {
    thanks: false,
    thanksTexts: [
      'Merci beaucoup pour ton achat ! 🙏 Je prépare « {titre} » et je l\'envoie très vite.',
      'Merci pour ta commande 😊 « {titre} » part dès que possible, bonne journée !',
    ],
    rate: false,
    rateComment: 'Acheteur au top, transaction parfaite, merci ! ⭐',
    since: 0, // only sales after the moment these options were turned on
  },
};
// Settings stored as sub-objects (merged key by key).
const NESTED = ['schedule', 'offers', 'messages', 'priceDrop', 'notify', 'sales', 'autoMsg', 'afterSale'];

const DEFAULT_STATE = {
  queue: [],
  current: null,
  todayDate: '',
  todayCount: 0,
  offersToday: 0,
  lastError: null,
  scheduleDone: { date: '', times: [] },
  lastFavCheck: 0,
  lastSnapshotDate: '',
};

let running = false;
let stopRequested = false;

// ---------- Storage helpers ----------

const today = () => new Date().toLocaleDateString('sv'); // YYYY-MM-DD, local time

async function getSettings() {
  const { settings = {} } = await chrome.storage.local.get('settings');
  const out = { ...DEFAULT_SETTINGS, ...settings };
  for (const k of NESTED) out[k] = { ...DEFAULT_SETTINGS[k], ...(settings[k] || {}) };
  return out;
}

async function saveSettings(patch) {
  const current = await getSettings();
  const next = { ...current, ...patch };
  for (const k of NESTED) next[k] = { ...current[k], ...(patch[k] || {}) };
  const pd = next.priceDrop;
  pd.everyDays = Math.max(1, Number(pd.everyDays) || 7);
  pd.percent = Math.min(50, Math.max(1, Number(pd.percent) || 5));
  pd.minPrice = Math.max(1, Number(pd.minPrice) || 1);
  next.sales.urssafRate = Math.min(50, Math.max(0, Number(next.sales.urssafRate) || 0));
  next.autoMsg.templates = (next.autoMsg.templates || []).map((t) => String(t).trim()).filter(Boolean).slice(0, 10);
  next.afterSale.thanksTexts = (next.afterSale.thanksTexts || []).map((t) => String(t).trim()).filter(Boolean).slice(0, 10);
  // After-sale actions only apply to sales made after they were switched on.
  const asOn = next.afterSale.thanks || next.afterSale.rate;
  const wasOn = current.afterSale.thanks || current.afterSale.rate;
  if (asOn && !wasOn) next.afterSale.since = Date.now();
  next.offers.tiers = (next.offers.tiers || []).map((t) => ({
    upTo: t.upTo === '' || t.upTo == null ? null : Math.max(1, Number(t.upTo) || 1),
    percent: Math.min(80, Math.max(1, Number(t.percent) || 10)),
  }));
  next.messages.maxPerDay = Math.min(100, Math.max(1, Number(next.messages.maxPerDay) || 1));
  next.offers.percent = Math.min(80, Math.max(1, Number(next.offers.percent) || 10));
  next.offers.maxPerDay = Math.max(1, Number(next.offers.maxPerDay) || 1);
  next.minDelay = Math.max(5, Number(next.minDelay) || 5);
  next.maxDelay = Math.max(next.minDelay, Number(next.maxDelay) || next.minDelay);
  next.dailyLimit = Math.max(1, Number(next.dailyLimit) || 1);
  await chrome.storage.local.set({ settings: next });
  return next;
}

async function getState() {
  const { state = {} } = await chrome.storage.local.get('state');
  const s = { ...DEFAULT_STATE, ...state };
  if (s.todayDate !== today()) {
    s.todayDate = today();
    s.todayCount = 0;
    s.offersToday = 0;
    s.messagesToday = 0;
  }
  return s;
}

async function setState(patch) {
  const s = { ...(await getState()), ...patch };
  await chrome.storage.local.set({ state: s });
  return s;
}

async function addHistory(entry) {
  const { history = [] } = await chrome.storage.local.get('history');
  history.unshift({ ts: Date.now(), ...entry });
  await chrome.storage.local.set({ history: history.slice(0, 300) });
}
