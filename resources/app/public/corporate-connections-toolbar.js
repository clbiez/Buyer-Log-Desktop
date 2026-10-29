/* Buyer Log upper bar — read-only corporate session indicators and explicit SSO actions.
 * Status checks never initiate login and never expose credentials to the renderer.
 * Connect uses the existing LCW AI / CoreNectum / OAB authentication paths. */
(function initCorporateConnectionToolbar(root) {
  'use strict';
  const host = root.document && root.document.getElementById('corporateConnections');
  if (!host) return;

  const keys = ['lcwai', 'plm', 'oab'];
  const buttons = Object.fromEntries(keys.map(key => [key, host.querySelector('[data-corporate-connection="' + key + '"]')]));
  const names = { lcwai: 'LCW AI', plm: 'PLM', oab: 'OAB' };
  const trigger = root.document.getElementById('corporateConnectionsBtn');
  const busy = new Set();
  const revision = { lcwai: 0, plm: 0, oab: 0 };
  const connected = { lcwai: false, plm: false, oab: false };
  let lastRefresh = 0;

  function en() {
    return String(root.appLang || root.document.documentElement.lang || 'tr').toLowerCase().startsWith('en');
  }
  function t(tr, eng) { return en() ? eng : tr; }
  function notify(message) {
    if (typeof root.showToast === 'function') root.showToast(message);
    else if (root.BLUI && typeof root.BLUI.notify === 'function') root.BLUI.notify(message);
  }
  function paint(key, state) {
    const button = buttons[key];
    if (!button) return;
    button.dataset.state = state;
    const status = state === 'connected'
      ? t('Bağlı', 'Connected')
      : state === 'connecting' ? t('Bağlantı kuruluyor…', 'Connecting…')
      : t('Bağlı değil', 'Disconnected');
    const hint = t('Bağlantı kurmak veya oturumu yenilemek için tıklayın.', 'Click to connect or renew the session.');
    button.title = names[key] + ' — ' + status + '. ' + hint;
    button.setAttribute('aria-label', button.title);
    button.setAttribute('aria-busy', state === 'connecting' ? 'true' : 'false');
    // Kapalı tetikleyicideki durum noktası aynı durumu gösterir.
    const dot = trigger && trigger.querySelector('[data-corporate-dot="' + key + '"]');
    if (dot) dot.dataset.state = state;
    if (trigger) {
      const summary = keys.map(name => names[name] + ': ' + (buttons[name] && buttons[name].dataset.state === 'connected' ? t('bağlı', 'connected') : t('bağlı değil', 'disconnected'))).join(' · ');
      trigger.title = t('Kurumsal bağlantılar', 'Corporate connections') + ' — ' + summary;
      trigger.setAttribute('aria-label', trigger.title);
    }
  }
  keys.forEach(key => paint(key, 'disconnected'));

  async function getJson(url, options) {
    const response = await root.fetch(url, { credentials: 'same-origin', cache: 'no-store', ...options });
    if (!response.ok) throw new Error('STATUS_UNAVAILABLE');
    const data = await response.json();
    if (!data || data.ok === false) throw new Error('STATUS_UNAVAILABLE');
    return data;
  }
  async function readConnected(key) {
    if (key === 'lcwai') {
      const data = await getJson('/api/lcwai/status');
      return Boolean(data.status && data.status.connected);
    }
    if (key === 'plm') {
      const data = await getJson('/api/corenectum-api/status');
      // Only an existing server-side token counts as an available PLM session.
      return Boolean(data.status && data.status.configured);
    }
    const desktop = root.buyerLogDesktop && typeof root.buyerLogDesktop.ensureOabAuth === 'function';
    const data = await getJson('/api/oab/auth/status', {
      headers: desktop ? { 'X-BuyerLog-OAB-Transport': 'desktop' } : {},
    });
    return Boolean(data.status && (data.status.authenticated || data.status.connected));
  }
  async function refreshOne(key) {
    if (busy.has(key)) return;
    const seq = ++revision[key];
    let ok = false;
    try { ok = await readConnected(key); }
    catch (_) { ok = false; }
    if (revision[key] !== seq || busy.has(key)) return;
    connected[key] = ok;
    paint(key, ok ? 'connected' : 'disconnected');
  }
  async function refresh(force) {
    if (root.document.hidden) return;
    if (!force && Date.now() - lastRefresh < 30000) return;
    lastRefresh = Date.now();
    await Promise.all(keys.map(refreshOne));
  }

  async function openSession(key) {
    const desktop = root.buyerLogDesktop;
    if (key === 'plm') {
      if (desktop && typeof desktop.ensureCoreNectumAuth === 'function') {
        const result = await desktop.ensureCoreNectumAuth({ interactive: true, reason: 'topbar-connect' });
        if (!result || !result.ok) throw new Error('PLM_AUTH_FAILED');
        return;
      }
      // Web-only legacy mode retains its existing manual settings dialog.
      if (typeof root.openCoreNectumApiSettings === 'function') {
        root.openCoreNectumApiSettings({ required: false, manual: true });
        return 'deferred';
      }
      throw new Error('PLM_UNAVAILABLE');
    }
    if (key === 'oab') {
      if (desktop && typeof desktop.ensureOabAuth === 'function') {
        const result = await desktop.ensureOabAuth({ interactive: true });
        if (!result || !result.ok || result.authenticated === false) throw new Error('OAB_AUTH_FAILED');
      } else {
        const result = await getJson('/api/oab/auth/connect', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
        });
        if (!result.status || !(result.status.connected || result.status.authenticated)) throw new Error('OAB_AUTH_FAILED');
      }
      return;
    }
    if (!root.BuyerLogAI && root.BLPerf && typeof root.BLPerf._loadScript === 'function') {
      await root.BLPerf._loadScript('lcwai-assistant.js?rev=1');
    }
    if (!root.BuyerLogAI || typeof root.BuyerLogAI.connect !== 'function') throw new Error('LCWAI_UNAVAILABLE');
    const result = await root.BuyerLogAI.connect({ quiet: true });
    if (!result || !result.connected) throw new Error('LCWAI_AUTH_FAILED');
  }

  async function connect(key) {
    if (!keys.includes(key) || busy.has(key)) return;
    busy.add(key);
    ++revision[key]; // Ignore any status check started before this user action.
    paint(key, 'connecting');
    try {
      const result = await openSession(key);
      if (result === 'deferred') {
        notify(t('PLM giriş ekranı açıldı. Giriş tamamlanınca bağlantı durumu güncellenecek.', 'PLM sign-in opened. The status will update after sign-in.'));
        connected[key] = false;
        paint(key, 'disconnected');
        return;
      }
      const ok = await readConnected(key);
      if (!ok) throw new Error('SESSION_NOT_CONFIRMED');
      connected[key] = true;
      paint(key, 'connected');
      notify(names[key] + ' — ' + t('Bağlantı aktif.', 'Connected.'));
    } catch (_) {
      connected[key] = false;
      paint(key, 'disconnected');
      notify(names[key] + ' — ' + t('Bağlantı kurulamadı. Kurumsal oturumu veya ağ erişimini kontrol edin.', 'Could not connect. Check your corporate sign-in or network access.'));
    } finally {
      busy.delete(key);
    }
  }

  keys.forEach(key => buttons[key] && buttons[key].addEventListener('click', () => { void connect(key); }));
  // Tetikleyici yalnız bağlantı penceresini açar/kapatır; oturum işlemleri pencere içindeki düğmelerdedir.
  if (trigger) {
    const setOpen = open => {
      host.hidden = !open;
      trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
      // Üst çubuk taşan içeriği kırptığı için pencere tetikleyicinin altına sabit konumlanır.
      if (open && typeof trigger.getBoundingClientRect === 'function') {
        const rect = trigger.getBoundingClientRect();
        host.style.top = Math.round(rect.bottom + 6) + 'px';
        host.style.right = Math.max(8, Math.round(root.innerWidth - rect.right)) + 'px';
      }
      if (open) { void refresh(false); if (root.BLMotionPlus && root.BLMotionPlus.play) root.BLMotionPlus.play('overlay', host); }
    };
    trigger.addEventListener('click', event => { event.stopPropagation(); setOpen(host.hidden); });
    root.document.addEventListener('click', event => {
      if (!host.hidden && !host.contains(event.target) && !trigger.contains(event.target)) setOpen(false);
    });
    root.document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !host.hidden) { setOpen(false); trigger.focus(); }
    });
  }
  root.addEventListener('focus', () => { void refresh(false); });
  root.addEventListener('bl:startup-complete', () => { void refresh(true); });
  root.document.addEventListener('visibilitychange', () => { if (!root.document.hidden) void refresh(false); });
  root.document.addEventListener('bl:language-changed', () => {
    keys.forEach(key => paint(key, busy.has(key) ? 'connecting' : connected[key] ? 'connected' : 'disconnected'));
  });
  root.setInterval(() => { if (!root.document.hidden) void refresh(false); }, 60000);
  void refresh(true);
  root.BLTopCorporateConnections = { refresh: () => refresh(true), connect };
})(window);
