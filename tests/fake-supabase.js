// A tiny in-memory stand-in for the Supabase client, used by the website tests.
// It supports exactly what js/api.js uses, plus helpers to play the extension's role.

export function makeFake() {
  const db = { snapshots: [], commands: [] };
  const users = {}; // email -> { id, email, password, confirmed }
  let session = null;
  let nextId = 1;
  const authListeners = [];
  const realtime = []; // { table, cb }
  const emit = (table, row) => realtime.filter((r) => r.table === table).forEach((r) => r.cb({ new: structuredClone(row) }));
  const mine = (rows) => rows.filter((r) => session && r.user_id === session.user.id);

  function query(table) {
    const q = { filters: [], orderBy: null, lim: null };
    const run = () => {
      let rows = mine(db[table]);
      for (const [k, v] of q.filters) rows = rows.filter((r) => r[k] === v);
      if (q.orderBy) rows = rows.slice().sort((a, b) => (q.orderBy.asc ? a[q.orderBy.col] - b[q.orderBy.col] : b[q.orderBy.col] - a[q.orderBy.col]));
      if (q.lim) rows = rows.slice(0, q.lim);
      return structuredClone(rows);
    };
    const api = {
      select() { return api; },
      eq(k, v) { q.filters.push([k, v]); return api; },
      order(col, o) { q.orderBy = { col, asc: o?.ascending !== false }; return api; },
      limit(n) { q.lim = n; return api; },
      maybeSingle: async () => ({ data: run()[0] || null, error: null }),
      then(res, rej) { return Promise.resolve({ data: run(), error: null }).then(res, rej); },
      insert(row) {
        if (!session) return { select: () => ({ single: async () => ({ data: null, error: { message: 'not authenticated' } }) }) };
        const full = { id: nextId++, user_id: session.user.id, status: 'pending', args: {}, created_at: new Date().toISOString(), ...row };
        db[table].push(full);
        emit(table, full);
        return { select: () => ({ single: async () => ({ data: structuredClone(full), error: null }) }) };
      },
    };
    return api;
  }

  const client = {
    auth: {
      async signInWithPassword({ email, password }) {
        const u = users[email];
        if (!u || u.password !== password) return { data: {}, error: { message: 'Invalid login credentials' } };
        if (!u.confirmed) return { data: {}, error: { message: 'Email not confirmed' } };
        session = { user: { id: u.id, email } };
        authListeners.forEach((f) => f('SIGNED_IN', session));
        return { data: { user: session.user }, error: null };
      },
      async signUp({ email, password }) {
        if (users[email]) return { data: {}, error: { message: 'User already registered' } };
        if (password.length < 6) return { data: {}, error: { message: 'Password should be at least 6 characters' } };
        users[email] = { id: 'u-' + Object.keys(users).length, email, password, confirmed: false };
        return { data: { user: { email }, session: null }, error: null };
      },
      async resetPasswordForEmail() { return { error: null }; },
      async updateUser({ password }) { if (session) users[session.user.email].password = password; return { error: null }; },
      async signOut() { session = null; authListeners.forEach((f) => f('SIGNED_OUT', null)); return { error: null }; },
      async getUser() { return { data: { user: session?.user || null } }; },
      onAuthStateChange(f) { authListeners.push(f); return { data: { subscription: { unsubscribe() {} } } }; },
    },
    from: (table) => query(table),
    async rpc(name) {
      if (name === 'delete_my_account' && session) {
        const id = session.user.id;
        for (const t of ['snapshots', 'commands']) db[t] = db[t].filter((r) => r.user_id !== id);
        delete users[session.user.email];
        return { error: null };
      }
      return { error: null };
    },
    channel() {
      const ch = { on(_type, opts, cb) { realtime.push({ table: opts.table, cb }); return ch; }, subscribe() { return ch; } };
      return ch;
    },
    removeChannel() {},
  };

  // ---- helpers for the tests (play the user and the extension) ----
  const helpers = {
    db,
    users,
    confirm(email) { users[email].confirmed = true; },
    // The extension pushes its state.
    pushSnapshot(email, data, { seenAgoMs = 0 } = {}) {
      const id = users[email].id;
      const row = { user_id: id, data, vinted_login: data.me?.login || null, updated_at: new Date().toISOString(), seen_at: new Date(Date.now() - seenAgoMs).toISOString() };
      db.snapshots = db.snapshots.filter((r) => r.user_id !== id).concat(row);
      emit('snapshots', row);
    },
    // The extension runs the pending orders.
    runCommands(fn = () => ({ ok: true })) {
      for (const c of db.commands.filter((x) => x.status === 'pending')) {
        try {
          c.result = fn(c);
          c.status = 'done';
        } catch (e) {
          c.status = 'error';
          c.error = e.message;
        }
        c.done_at = new Date().toISOString();
        emit('commands', c);
      }
    },
  };
  return { client, helpers };
}
