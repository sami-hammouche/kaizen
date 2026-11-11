// Kaizen web — start-up, account screens, navigation and live state.
import * as api from './api.js';
import { $, $$, toast } from './util.js';
import { S, isOnline, render, commandLabel } from './views.js';

// ---------- Account screens ----------

let authMode = 'login';

function showScreen(name) {
  $('#landing').hidden = name !== 'landing';
  $('#recovery').hidden = name !== 'recovery';
  $('#app').hidden = name !== 'app';
}

function setAuthMode(mode) {
  authMode = mode;
  $$('.seg button').forEach((b) => b.classList.toggle('on', b.dataset.auth === mode));
  $('#authBtn').textContent = mode === 'login' ? 'Se connecter' : 'Créer mon compte';
  $('#termsRow').hidden = mode !== 'signup';
  $('#authPass').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
  $('#authMsg').textContent = '';
}
$$('.seg button').forEach((b) => b.addEventListener('click', () => setAuthMode(b.dataset.auth)));

$('#authForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('#authEmail').value.trim();
  const pass = $('#authPass').value;
  const msg = $('#authMsg');
  msg.className = 'msg';
  if (authMode === 'signup' && !$('#authTerms').checked) {
    msg.textContent = 'Coche la case pour confirmer que tu as lu l’avertissement.';
    return;
  }
  $('#authBtn').disabled = true;
  try {
    if (authMode === 'login') {
      await api.signIn(email, pass);
      await enterApp();
    } else {
      const r = await api.signUp(email, pass);
      if (r.session) await enterApp();
      else {
        setAuthMode('login');
        msg.className = 'msg ok';
        msg.textContent = 'Compte créé ! Clique sur le lien reçu par e-mail pour le confirmer, puis connecte-toi.';
      }
    }
  } catch (err) {
    msg.textContent = err.message;
  }
  $('#authBtn').disabled = false;
});

$('#forgotBtn').addEventListener('click', async () => {
  const email = $('#authEmail').value.trim();
  const msg = $('#authMsg');
  if (!email) {
    msg.className = 'msg';
    msg.textContent = 'Écris ton e-mail ci-dessus, puis reclique sur « Mot de passe oublié ».';
    return;
  }
  try {
    await api.resetPassword(email);
    msg.className = 'msg ok';
    msg.textContent = 'Si un compte existe, un lien pour changer le mot de passe vient d’être envoyé.';
  } catch (err) {
    msg.className = 'msg';
    msg.textContent = err.message;
  }
});

$('#recoveryForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api.setNewPassword($('#newPass').value);
    toast('Mot de passe changé.');
    history.replaceState(null, '', location.pathname);
    await enterApp();
  } catch (err) {
    $('#recoveryMsg').textContent = err.message;
  }
});

// ---------- Application ----------

let unsubscribe = null;
let poll = null;

export function go(view) {
  S.view = view;
  S.dirty = false;
  $$('#nav button').forEach((b) => b.classList.toggle('on', b.dataset.view === view));
  render();
  window.scrollTo({ top: 0 });
  try {
    localStorage.setItem('kaizen.view', view);
  } catch {
    /* private mode */
  }
}
$$('#nav button').forEach((b) => b.addEventListener('click', () => go(b.dataset.view)));
S.go = go;

function updatePill() {
  const pill = $('#pcStatus');
  if (!S.snap) {
    pill.className = 'pill off';
    pill.textContent = 'Extension non reliée';
  } else if (isOnline()) {
    pill.className = 'pill on';
    pill.textContent = 'PC en ligne';
  } else {
    pill.className = 'pill off';
    pill.textContent = 'PC hors ligne';
  }
}
$('#pcStatus').addEventListener('click', () => go('home'));

function onSnapshot(row) {
  if (!row) return;
  S.snap = row;
  S.data = row.data || {};
  updatePill();
  render();
}

function onCommand(cmd) {
  if (!cmd) return;
  const i = S.commands.findIndex((c) => c.id === cmd.id);
  const before = i >= 0 ? S.commands[i] : null;
  if (i >= 0) S.commands[i] = cmd;
  else S.commands.unshift(cmd);
  if (before && before.status !== cmd.status) {
    if (cmd.status === 'done') toast(`✓ ${commandLabel(cmd)} : fait sur ton PC.`);
    if (cmd.status === 'error') toast(`✗ ${commandLabel(cmd)} : ${cmd.error}`, 'err');
  }
  render();
}

async function refreshAll() {
  const [snap, cmds] = await Promise.all([api.loadSnapshot(S.user.id), api.loadCommands()]);
  S.commands = cmds;
  if (snap) onSnapshot(snap);
  else {
    S.snap = null;
    S.data = {};
    updatePill();
    render();
  }
}

async function enterApp() {
  S.user = await api.getUser();
  if (!S.user) return showScreen('landing');
  showScreen('app');
  let view = 'home';
  try {
    view = localStorage.getItem('kaizen.view') || 'home';
  } catch {
    /* private mode */
  }
  go(view);
  await refreshAll();
  unsubscribe?.();
  unsubscribe = api.subscribe(S.user.id, onSnapshot, onCommand);
  clearInterval(poll);
  // Safety net if live updates are interrupted (phone asleep, network change).
  poll = setInterval(() => refreshAll().catch(() => {}), 20000);
  clearInterval(pillTimer);
  pillTimer = setInterval(updatePill, 15000);
  api.pruneCommands();
}
let pillTimer = null;

export async function leaveApp() {
  unsubscribe?.();
  clearInterval(poll);
  S.user = null;
  S.snap = null;
  S.data = {};
  S.commands = [];
  showScreen('landing');
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && S.user) refreshAll().catch(() => {});
});

// ---------- Start ----------

(async () => {
  const client = await api.initClient();
  if (!client) {
    showScreen('landing');
    $('#notConfigured').hidden = false;
    $('#authBtn').disabled = true;
    return;
  }
  client.auth.onAuthStateChange((event) => {
    if (event === 'PASSWORD_RECOVERY') showScreen('recovery');
    if (event === 'SIGNED_OUT') leaveApp();
  });
  if (/type=recovery/.test(location.hash)) return showScreen('recovery');
  const user = await api.getUser();
  if (user) await enterApp();
  else showScreen('landing');
})();

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
