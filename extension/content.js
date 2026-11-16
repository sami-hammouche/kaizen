// Runs inside a Vinted tab. All Vinted API calls happen here, so they use
// the user's normal logged-in session (same cookies as the website).
(() => {
  if (window.__vintedPilotLoaded) return;
  window.__vintedPilotLoaded = true;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const rand = (min, max) => min + Math.random() * (max - min);

  // ---------- Session helpers ----------

  let csrfToken = null;

  function findCsrfIn(text) {
    const m = text.match(/CSRF_TOKEN\\?"\s*:\s*\\?"([^"\\]+)/);
    return m ? m[1] : null;
  }

  async function getCsrf(force = false) {
    if (csrfToken && !force) return csrfToken;
    let token = null;
    if (!force) {
      const meta = document.querySelector('meta[name="csrf-token"]');
      token = meta?.content || findCsrfIn(document.documentElement.innerHTML);
    }
    if (!token) {
      const html = await (await fetch('/', { credentials: 'include' })).text();
      token = findCsrfIn(html);
    }
    csrfToken = token;
    return token;
  }

  function getCookie(name) {
    const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : null;
  }

  async function refreshSession() {
    const headers = { Accept: 'application/json' };
    const token = await getCsrf();
    if (token) headers['X-CSRF-Token'] = token;
    const anon = getCookie('anon_id');
    if (anon) headers['X-Anon-Id'] = anon;
    const res = await fetch('/web/api/auth/refresh', { method: 'POST', headers, credentials: 'include' });
    if (!res.ok) throw new Error('Session Vinted expirée : reconnecte-toi sur vinted.fr dans Chrome.');
  }

  async function api(path, { method = 'GET', json, form, headers: extra = {}, retry = true } = {}) {
    const headers = { Accept: 'application/json, text/plain, */*', ...extra };
    const token = await getCsrf();
    if (token) headers['X-CSRF-Token'] = token;
    const anon = getCookie('anon_id');
    if (anon) headers['X-Anon-Id'] = anon;

    let body;
    if (json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(json);
    } else if (form) {
      body = form;
    }

    const res = await fetch(path, { method, headers, body, credentials: 'include' });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* not JSON */ }

    if (!res.ok) {
      if (retry && res.status === 401) {
        // The login token expires after a while (tab left open for hours):
        // renew it the same way the website does, then retry once.
        await refreshSession();
        return api(path, { method, json, form, headers: extra, retry: false });
      }
      if (retry && method !== 'GET' && res.status === 403) {
        // Expired CSRF token: read a fresh one and retry once.
        await getCsrf(true);
        return api(path, { method, json, form, headers: extra, retry: false });
      }
      const details =
        data?.message ||
        (Array.isArray(data?.errors) && data.errors.map((e) => e.value || e.field).join(', ')) ||
        text.slice(0, 200);
      const err = new Error(`Vinted a répondu ${res.status} (${path}) : ${details}`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  // ---------- Account & items ----------

  async function getMe() {
    const data = await api('/api/v2/users/current');
    const u = data?.user;
    if (!u?.id) throw new Error('Non connecté à Vinted dans ce navigateur.');
    return {
      id: u.id,
      login: u.login,
      photo: u.photo?.url || null,
      itemCount: u.item_count,
      rating: u.feedback_reputation,
      feedbackCount: u.feedback_count,
    };
  }

  function priceOf(item) {
    const p = item.price;
    if (p && typeof p === 'object') return { amount: Number(p.amount), currency: p.currency_code };
    return { amount: Number(p), currency: item.currency || 'EUR' };
  }

  async function listItems() {
    const me = await getMe();
    const all = [];
    for (let page = 1; page <= 30; page++) {
      const data = await api(
        `/api/v2/wardrobe/${me.id}/items?page=${page}&per_page=96&order=newest_first`
      );
      const items = data?.items || [];
      for (const it of items) {
        const photo = it.photo || it.photos?.[0];
        all.push({
          id: it.id,
          title: it.title,
          price: priceOf(it),
          photo: photo?.thumbnails?.find((t) => t.type === 'thumb310x430')?.url || photo?.url || null,
          url: it.url || `/items/${it.id}`,
          views: it.view_count ?? 0,
          favourites: it.favourite_count ?? 0,
          sold: !!it.is_closed,
          hidden: !!it.is_hidden,
          reserved: !!it.is_reserved,
          draft: !!it.is_draft,
          createdTs: photo?.high_resolution?.timestamp || null,
          brand: typeof it.brand === 'string' ? it.brand : it.brand?.title || it.brand_title || '',
          size: typeof it.size === 'string' ? it.size : it.size?.title || it.size_title || '',
        });
      }
      const totalPages = data?.pagination?.total_pages ?? 1;
      if (page >= totalPages || items.length === 0) break;
      await sleep(rand(300, 800));
    }
    return { me, items: all };
  }

  // ---------- Republication ----------

  // Asks the background script for the photo bytes (it can read the image CDN
  // without cross-origin limits), then rebuilds a Blob here.
  async function downloadPhoto(url) {
    // The image CDN usually allows a direct download; otherwise use the background.
    try {
      const r = await fetch(url);
      if (r.ok) return await r.blob();
    } catch { /* fall back below */ }
    const res = await chrome.runtime.sendMessage({ type: 'fetchImage', url });
    if (!res?.ok) throw new Error('Téléchargement photo impossible : ' + (res?.error || url));
    const bin = atob(res.b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: res.type || 'image/jpeg' });
  }

  async function uploadPhoto(blob, uploadUuid) {
    const form = new FormData();
    form.append('photo[type]', 'item');
    form.append('photo[file]', blob, 'photo.jpg');
    form.append('photo[temp_uuid]', uploadUuid);
    const data = await api('/api/v2/photos', { method: 'POST', form });
    if (!data?.id) throw new Error("L'envoi d'une photo n'a pas renvoyé d'identifiant.");
    return data.id;
  }

  function colorIds(item) {
    if (Array.isArray(item.color_ids)) return item.color_ids;
    return [item.color1_id, item.color2_id].filter(Boolean);
  }

  // Same shape as the payload built by Vinted's own "Sell an item" form
  // (size and condition live inside item_attributes).
  function buildNewItem(item, photoIds, uploadUuid, keepId = false) {
    const price = priceOf(item);
    const payload = {
      id: keepId ? item.id : null,
      currency: price.currency || 'EUR',
      temp_uuid: uploadUuid,
      title: item.title,
      description: item.description,
      brand_id: item.brand_id ?? item.brand_dto?.id ?? null,
      brand: item.brand_dto?.title ?? item.brand ?? null,
      catalog_id: item.catalog_id,
      isbn: item.isbn ?? null,
      ai_photo: !!item.ai_photo,
      price: String(price.amount),
      package_size_id: item.package_size_id,
      shipment_prices: { domestic: item.shipment_prices?.domestic ?? null },
      color_ids: colorIds(item),
      assigned_photos: photoIds.map((id) => ({ id, orientation: 0 })),
      measurement_length: item.measurement_length ?? null,
      measurement_width: item.measurement_width ?? null,
      item_attributes: item.item_attributes ?? [],
      manufacturer: item.manufacturer ?? null,
      manufacturer_labelling: item.manufacturer_labelling ?? null,
    };
    if (item.model?.metadata) payload.model = item.model;
    return payload;
  }

  // oldListing: what to do with the original once the copy exists:
  // 'hide' (keeps its favourites, invisible), 'delete', or 'keep' (both visible).
  const b64ToBlob = (b64, type) => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: type || 'image/jpeg' });
  };

  const sortedPhotos = (item) => (item.photos || []).slice().sort((a, b) => (a.is_main ? -1 : b.is_main ? 1 : 0));

  async function getPhotoUrls({ id }) {
    const data = await api(`/api/v2/item_upload/items/${id}`);
    if (!data?.item) throw new Error(`Annonce ${id} introuvable.`);
    return sortedPhotos(data.item).map((p) => p.full_size_url || p.url);
  }

  // savedPhotos: [{ b64, type }] kept by Kaizen since the first republication,
  // so photos are not re-compressed again and again.
  async function republish({ id, oldListing = 'hide', savedPhotos = null }) {
    // 1. Read the full listing exactly as the "edit" page sees it.
    const data = await api(`/api/v2/item_upload/items/${id}`);
    const item = data?.item;
    if (!item) throw new Error(`Annonce ${id} introuvable.`);
    if (item.is_closed) throw new Error(`L'annonce "${item.title}" est déjà vendue.`);

    // 2. Re-upload each photo (saved copy if we have one).
    const uploadUuid = crypto.randomUUID();
    const photoIds = [];
    const blobs = savedPhotos?.length
      ? savedPhotos.map((p) => () => b64ToBlob(p.b64, p.type))
      : sortedPhotos(item).map((p) => () => downloadPhoto(p.full_size_url || p.url));
    for (const getBlob of blobs) {
      photoIds.push(await uploadPhoto(await getBlob(), uploadUuid));
      await sleep(rand(600, 1500));
    }
    if (!photoIds.length) throw new Error(`L'annonce "${item.title}" n'a pas de photo.`);

    // 3. Create the new listing (copy of the old one).
    const created = await api('/api/v2/item_upload/items', {
      method: 'POST',
      headers: { 'X-Upload-Form': 'true' },
      json: {
        item: buildNewItem(item, photoIds, uploadUuid),
        push_up: false,
        parcel: data.parcel ?? null,
        upload_session_id: uploadUuid,
      },
    });
    const newId = created?.item?.id;
    if (!newId) throw new Error('Vinted n’a pas renvoyé la nouvelle annonce.');

    // 4. Handle the old one only once the new one exists.
    if (oldListing === 'delete') {
      await sleep(rand(1500, 3000));
      await api(`/api/v2/items/${id}/delete`, { method: 'POST' });
    } else if (oldListing === 'hide') {
      await sleep(rand(1500, 3000));
      try {
        await api(`/api/v2/items/${id}/is_hidden`, { method: 'PUT', json: { is_hidden: true } });
      } catch (e) {
        if (e.status !== 400) throw e; // 400 = it was already hidden
      }
    }
    return { oldId: id, newId, title: item.title, oldListing, usedSavedPhotos: !!savedPhotos?.length };
  }

  // ---------- Buyers, sales, after-sale ----------

  async function getUser({ id }) {
    const u = (await api(`/api/v2/users/${id}`))?.user;
    if (!u) throw new Error(`Membre ${id} introuvable.`);
    return {
      id: u.id,
      login: u.login,
      count: u.feedback_count || 0,
      rating: u.feedback_count ? Math.round((u.feedback_reputation || 0) * 50) / 10 : null, // 0-5 stars
    };
  }

  async function listOrders({ pages = 5 } = {}) {
    const out = [];
    for (let page = 1; page <= pages; page++) {
      const data = await api(`/api/v2/my_orders?type=sold&status=all&page=${page}&per_page=50`);
      for (const o of data?.my_orders || []) {
        out.push({
          tx: o.transaction_id,
          conversationId: o.conversation_id,
          title: o.title,
          price: Number(o.price?.amount ?? o.price),
          status: o.status,
          userStatus: o.transaction_user_status, // completed | failed | waiting | …
          date: new Date(o.date).getTime(),
          photo: o.photo?.url || o.photo_url || null,
        });
      }
      if (page >= (data?.pagination?.total_pages ?? 1)) break;
      await sleep(rand(300, 700));
    }
    return out;
  }

  async function replyInConversation({ conversationId, text }) {
    if (!text?.trim()) throw new Error('Message vide.');
    await api(`${apiHost()}/messaging/main/conversations/${conversationId}/replies`, {
      method: 'POST',
      headers: { Platform: 'web' },
      json: { content: text, is_personal_data_sharing_check_skipped: false, photo_temp_uuids: [] },
    });
    return { conversationId };
  }

  // Not verified live yet (it would rate a real buyer): field names may need adjusting.
  async function leaveFeedback({ transactionId, rating = 5, comment = '' }) {
    await api('/api/v2/user_feedbacks', {
      method: 'POST',
      json: { transaction_id: transactionId, rating, feedback: comment },
    });
    return { transactionId };
  }

  // ---------- Account management ----------

  async function setHidden({ id, hidden }) {
    await api(`/api/v2/items/${id}/is_hidden`, { method: 'PUT', json: { is_hidden: !!hidden } });
    return { id, hidden: !!hidden };
  }

  // Same request as saving the "edit listing" form, with only the price changed.
  async function setPrice({ id, price }) {
    const amount = Math.round(Number(price) * 100) / 100;
    if (!(amount >= 1)) throw new Error(`Prix invalide : ${price}`);
    const data = await api(`/api/v2/item_upload/items/${id}`);
    const item = data?.item;
    if (!item) throw new Error(`Annonce ${id} introuvable.`);
    const photoIds = (item.photos || [])
      .slice()
      .sort((a, b) => (a.is_main ? -1 : b.is_main ? 1 : 0))
      .map((p) => p.id);
    const payload = buildNewItem(item, photoIds, '', true); // no new photos: empty temp_uuid
    payload.price = String(amount);
    await api(`/api/v2/item_upload/items/${id}`, {
      method: 'PUT',
      json: { item: payload, push_up: false, parcel: data.parcel ?? null, upload_session_id: crypto.randomUUID() },
    });
    // Vinted re-checks the listing for a few seconds (404 meanwhile), then
    // shows the new price. Make sure it was really applied.
    for (let i = 0; i < 12; i++) {
      await sleep(4000);
      let check;
      try {
        check = await api(`/api/v2/item_upload/items/${id}`, { retry: false });
      } catch (e) {
        if (e.status === 404) continue; // still being checked
        throw e;
      }
      const now = priceOf(check.item).amount;
      if (now === amount) return { id, title: item.title, oldPrice: priceOf(item).amount, newPrice: amount };
      if (i >= 3) break;
    }
    throw new Error(`Vinted n'a pas appliqué le nouveau prix pour « ${item.title} ».`);
  }

  async function deleteItem({ id }) {
    await api(`/api/v2/items/${id}/delete`, { method: 'POST' });
    return { id, deleted: true };
  }

  // ---------- Offers to people who favourited an item ----------

  // Inbox notifications and messaging live on the "api." sub-domain.
  const apiHost = () => `https://api.${location.host.replace(/^www\./, '')}`;
  const ENTRY_ITEM_FAVOURITE = 20;

  async function getFavourites() {
    const out = [];
    for (let page = 1; page <= 5; page++) {
      const data = await api(`${apiHost()}/inbox-notifications/v1/notifications?page=${page}&per_page=50`, {
        headers: { Platform: 'web' },
      });
      for (const n of data?.notifications || []) {
        if (n.entry_type !== ENTRY_ITEM_FAVOURITE) continue;
        const query = new URLSearchParams((n.link || '').split('?')[1] || '');
        const userId = Number(query.get('offering_id'));
        const itemId = Number(n.subject_id);
        if (!userId || !itemId) continue;
        const tmp = document.createElement('div');
        tmp.innerHTML = n.body || '';
        out.push({
          key: `${itemId}_${userId}`,
          itemId,
          userId,
          text: tmp.textContent.trim(),
          photo: n.photo?.url || null,
          time: new Date(n.updated_at).getTime() || Date.now(),
        });
      }
      const p = data?.pagination;
      if (!p || page >= p.total_pages) break;
      await sleep(rand(300, 700));
    }
    return out;
  }

  // Same steps as the "Make an offer" button shown on a favourite notification.
  async function sendOffer({ itemId, userId, price, currency = 'EUR' }) {
    const amount = Math.round(Number(price) * 100) / 100;
    if (!(amount >= 1)) throw new Error(`Prix d'offre invalide : ${price}`);
    const conv = await api(`${apiHost()}/messaging/main/inquiries`, {
      method: 'POST',
      headers: { Platform: 'web' },
      json: { item_ids: [itemId], receiver_id: userId },
    });
    const transactionId = conv?.transaction_id;
    if (!transactionId) throw new Error("Vinted n'a pas ouvert de conversation pour cette offre.");
    await sleep(rand(800, 1600));
    await api(`/api/v2/transactions/${transactionId}/offers`, {
      method: 'POST',
      json: { offer: { price: String(amount), currency } },
    });
    return { itemId, userId, price: amount, conversationId: conv.conversation_id };
  }

  // Opens (or reuses) the conversation about the item with this person,
  // then writes the message, like the website's chat box.
  async function sendMessage({ itemId, userId, text }) {
    if (!text?.trim()) throw new Error('Message vide.');
    const conv = await api(`${apiHost()}/messaging/main/inquiries`, {
      method: 'POST',
      headers: { Platform: 'web' },
      json: { item_ids: [itemId], receiver_id: userId },
    });
    const conversationId = conv?.conversation_id;
    if (!conversationId) throw new Error("Vinted n'a pas ouvert de conversation.");
    await sleep(rand(1000, 2500));
    await api(`${apiHost()}/messaging/main/conversations/${conversationId}/replies`, {
      method: 'POST',
      headers: { Platform: 'web' },
      json: { content: text, is_personal_data_sharing_check_skipped: false, photo_temp_uuids: [] },
    });
    return { itemId, userId, conversationId };
  }

  // ---------- Market price (similar listings currently for sale) ----------

  async function marketPrice({ query, excludeUserId }) {
    const data = await api(
      `${apiHost()}/svc-catalogue/items?page=1&per_page=96&order=relevance&search_text=${encodeURIComponent(query)}`,
      { headers: { Platform: 'web' } }
    );
    const prices = (data?.items || [])
      .filter((i) => !excludeUserId || i.user?.id !== excludeUserId)
      .map((i) => Number(i.price?.amount ?? i.price))
      .filter((p) => p > 0)
      .sort((a, b) => a - b);
    if (prices.length < 3) return { query, count: prices.length, median: null };
    const at = (q) => prices[Math.min(prices.length - 1, Math.floor(q * prices.length))];
    return { query, count: prices.length, median: at(0.5), low: at(0.25), high: at(0.75) };
  }

  // ---------- Backup: every listing with all its details ----------

  async function exportDressing() {
    const { me, items } = await listItems();
    const out = [];
    for (const it of items) {
      let details = null;
      if (!it.sold) {
        try {
          const d = await api(`/api/v2/item_upload/items/${it.id}`);
          const x = d?.item;
          if (x) {
            details = {
              description: x.description,
              brand: x.brand_dto?.title ?? null,
              brand_id: x.brand_id,
              catalog_id: x.catalog_id,
              color_ids: [x.color1_id, x.color2_id].filter(Boolean),
              package_size_id: x.package_size_id,
              item_attributes: x.item_attributes,
              photos: (x.photos || []).map((p) => p.full_size_url || p.url),
            };
          }
        } catch {
          /* listing being checked by Vinted: keep the summary only */
        }
        await sleep(rand(300, 700));
      }
      out.push({ ...it, details });
    }
    return { exportedAt: new Date().toISOString(), user: me.login, count: out.length, items: out };
  }

  // ---------- Message bridge ----------

  const actions = {
    ping: async () => 'pong',
    me: getMe,
    listItems,
    republish,
    setHidden,
    setPrice,
    deleteItem,
    getFavourites,
    sendOffer,
    sendMessage,
    marketPrice,
    exportDressing,
    getPhotoUrls,
    getUser,
    listOrders,
    replyInConversation,
    leaveFeedback,
  };

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type !== 'vp') return;
    const fn = actions[msg.action];
    if (!fn) {
      sendResponse({ ok: false, error: 'Action inconnue : ' + msg.action });
      return;
    }
    fn(msg.args || {})
      .then((data) => sendResponse({ ok: true, data }))
      .catch((e) => sendResponse({ ok: false, error: e.message || String(e), status: e.status }));
    return true; // async response
  });
})();
