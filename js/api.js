// Talks to the Kaizen relay (Supabase): account, the extension's state, orders.
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

export let sb = null; // Supabase client (or a fake one in tests: window.__kaizenClient)

export async function initClient() {
  if (window.__kaizenClient) {
    sb = window.__kaizenClient;
    return sb;
  }
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm');
  sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, detectSessionInUrl: true } });
  return sb;
}

const fail = (error, fallback) => {
  if (!error) return;
  const m = error.message || fallback;
  if (/invalid login/i.test(m)) throw new Error('E-mail ou mot de passe incorrect.');
  if (/not confirmed/i.test(m)) throw new Error('Confirme d’abord ton adresse e-mail (lien reçu par mail).');
  if (/already registered/i.test(m)) throw new Error('Un compte existe déjà avec cet e-mail : connecte-toi.');
  if (/at least 6/i.test(m) || /password should/i.test(m)) throw new Error('Mot de passe trop court (6 caractères minimum).');
  throw new Error(m);
};

export async function signIn(email, password) {
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  fail(error, 'Connexion impossible.');
  return data.user;
}

export async function signUp(email, password) {
  const redirect = location.origin + location.pathname;
  const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: redirect } });
  fail(error, 'Inscription impossible.');
  return data;
}

export async function resetPassword(email) {
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
  fail(error, 'Envoi impossible.');
}

export async function setNewPassword(password) {
  const { error } = await sb.auth.updateUser({ password });
  fail(error, 'Changement impossible.');
}

export const signOut = () => sb.auth.signOut();

export async function deleteAccount() {
  const { error } = await sb.rpc('delete_my_account');
  fail(error, 'Suppression impossible.');
  await sb.auth.signOut();
}

export async function getUser() {
  const { data } = await sb.auth.getUser();
  return data?.user || null;
}

export async function loadSnapshot(userId) {
  const { data, error } = await sb.from('snapshots').select('*').eq('user_id', userId).maybeSingle();
  fail(error, 'Lecture impossible.');
  return data;
}

export async function loadCommands() {
  const { data, error } = await sb.from('commands').select('*').order('id', { ascending: false }).limit(30);
  fail(error, 'Lecture impossible.');
  return data || [];
}

// Sends an order to the extension (executed on the PC within ~30 s).
export async function sendCommand(action, args = {}) {
  const { data, error } = await sb.from('commands').insert({ action, args }).select().single();
  fail(error, 'Envoi impossible.');
  return data;
}

// Live updates of the state and of the orders.
export function subscribe(userId, onSnapshot, onCommand) {
  const ch = sb
    .channel('kaizen-' + userId)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'snapshots', filter: `user_id=eq.${userId}` }, (p) => onSnapshot(p.new))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'commands', filter: `user_id=eq.${userId}` }, (p) => onCommand(p.new))
    .subscribe();
  return () => sb.removeChannel(ch);
}

export const pruneCommands = () => sb.rpc('prune_commands').then(() => {}, () => {});
