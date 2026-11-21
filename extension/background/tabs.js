// The Vinted tab the content script runs in, and the bridge to it.

// ---------- Vinted tab ----------

function waitForTab(tabId) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("L'onglet Vinted met trop de temps à charger."));
    }, 60000);
    function listener(id, info) {
      if (id === tabId && info.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then((t) => {
      if (t.status === 'complete') listener(tabId, { status: 'complete' });
    });
  });
}

async function getVintedTab(domain) {
  const tabs = await chrome.tabs.query({ url: `https://${domain}/*` });
  let tab = tabs.find((t) => t.status === 'complete') || tabs[0];
  if (!tab) {
    // No Vinted tab open: open one in the background and remember it,
    // so it can be closed again once the work is done.
    tab = await chrome.tabs.create({ url: `https://${domain}/`, active: false });
    await setState({ ownTabId: tab.id });
  }
  await waitForTab(tab.id);
  return tab;
}

let bulkRunning = false;
const isBusy = () => running || offersRunning || bulkRunning || messagesRunning;

// Closes the tab the extension opened itself, 2 minutes after the last use,
// unless the user started using it (switched to it).
async function closeOwnTabIfIdle() {
  const state = await getState();
  if (!state.ownTabId || isBusy() || state.queue.length) return;
  if (Date.now() - (state.lastVintedUse || 0) < 2 * 60 * 1000) return;
  try {
    const tab = await chrome.tabs.get(state.ownTabId);
    if (!tab.active) await chrome.tabs.remove(tab.id);
  } catch {
    /* already closed */
  }
  await setState({ ownTabId: null });
}

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const state = await getState();
  if (state.ownTabId === tabId) await setState({ ownTabId: null }); // the user took it over
});
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const state = await getState();
  if (state.ownTabId === tabId) await setState({ ownTabId: null });
});

async function callVinted(action, args = {}) {
  const { domain } = await getSettings();
  const tab = await getVintedTab(domain);
  await setState({ lastVintedUse: Date.now() });
  const msg = { type: 'vp', action, args };
  let res;
  try {
    res = await chrome.tabs.sendMessage(tab.id, msg);
  } catch {
    // Tab was open before the extension was (re)loaded: inject the script.
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    res = await chrome.tabs.sendMessage(tab.id, msg);
  }
  await setState({ lastVintedUse: Date.now() });
  if (!res) throw new Error('Pas de réponse de la page Vinted.');
  if (!res.ok) {
    const err = new Error(res.error);
    err.status = res.status;
    throw err;
  }
  return res.data;
}

async function fetchImage(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Photo ${r.status}`);
  const bytes = new Uint8Array(await r.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return { b64: btoa(bin), type: r.headers.get('content-type') || 'image/jpeg' };
}
