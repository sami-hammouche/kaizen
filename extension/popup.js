async function bg(action, args) {
  const res = await chrome.runtime.sendMessage({ type: 'bg', action, args });
  if (!res?.ok) throw new Error(res?.error);
  return res.data;
}

async function refresh() {
  const { state, settings, running } = await bg('status');
  const q = state.queue.length;
  document.getElementById('status').textContent = q
    ? `${q} annonce(s) en file${running ? '' : ' (en attente)'}`
    : settings.schedule.enabled
      ? `Planification active : ${settings.schedule.times.join(', ')}`
      : 'Aucune republication en cours.';
  document.getElementById('today').textContent = `Aujourd'hui : ${state.todayCount} / ${settings.dailyLimit}`;
  document.getElementById('stop').hidden = !q;
}

document.getElementById('open').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
});
document.getElementById('stop').addEventListener('click', async () => {
  await bg('stop');
  refresh();
});

refresh();
