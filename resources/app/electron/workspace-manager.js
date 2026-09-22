'use strict';

/*
 * Buyer Log desktop workspace.
 *
 * Each module tab owns one live WebContentsView. A tab switch only reparents
 * or hides the native View; it never reloads the renderer. Detach/reattach
 * moves that same View between BrowserWindows, so scroll position, filters,
 * pending editors and in-memory module state survive the operation.
 */

const WORKSPACE_BAR_HEIGHT = 44;
const MIN_WINDOW_WIDTH = 800;
const MIN_WINDOW_HEIGHT = 600;

const MODULES = Object.freeze({
  overview: { tr: 'Genel Bakış', en: 'Overview' },
  cp: { tr: 'CP Tracker', en: 'CP Tracker' },
  orders: { tr: 'Siparişler', en: 'Orders' },
  backlog: { tr: 'Backlog', en: 'Backlog' },
  shipping: { tr: 'Nakliye Kıyaslama', en: 'Shipping Comparison' },
  koleksiyon: { tr: 'Koleksiyon', en: 'Collection' },
  quotations: { tr: 'Quotations', en: 'Quotations' },
  pricinghistory: { tr: 'Fiyat Geçmişi', en: 'Pricing History' },
  priceanalysis: { tr: 'Fiyat & Üretici Analizi', en: 'Price & Supplier Analysis' },
  lfl: { tr: 'LFL Analizi', en: 'LFL Analysis' },
  opencosting: { tr: 'Ön Maliyet', en: 'Open Costing' },
  automations: { tr: 'Otomasyonlar', en: 'Automations' },
  source: { tr: 'Veri Yönetimi', en: 'Data Management' },
});

function normalizeModule(value) {
  const moduleId = String(value || '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(MODULES, moduleId) ? moduleId : 'overview';
}

function clampIndex(value, length) {
  const index = Number(value);
  if (!Number.isFinite(index)) return length;
  return Math.max(0, Math.min(length, Math.trunc(index)));
}

function createWorkspaceManager(options) {
  const {
    BrowserWindow, WebContentsView, dialog, screen, path, crypto, origin,
    shellFile, shellPreload, contentPreload, iconPath,
    loadWindowState, saveWindowState, applyNavigationPolicy, log,
    onFirstRendererReady,
  } = options;

  const windows = new Map();
  const tabs = new Map();
  const shellToWindow = new Map();
  const contentsToTab = new Map();
  let lastFocusedWindowId = 0;
  let rendererReadySignaled = false;

  function stateForWindow(windowId) {
    return windows.get(Number(windowId)) || null;
  }

  function tabForContents(contents) {
    if (!contents || contents.isDestroyed()) return null;
    const tabId = contentsToTab.get(contents.id);
    return tabId ? tabs.get(tabId) || null : null;
  }

  function windowForContents(contents) {
    const tab = tabForContents(contents);
    return tab ? stateForWindow(tab.windowId)?.window || null : null;
  }

  function windowForShellContents(contents) {
    if (!contents || contents.isDestroyed()) return null;
    const windowId = shellToWindow.get(contents.id);
    return windowId ? stateForWindow(windowId) || null : null;
  }

  function focusedState() {
    const focused = BrowserWindow.getFocusedWindow();
    if (focused && windows.has(focused.id)) return windows.get(focused.id);
    return stateForWindow(lastFocusedWindowId) || [...windows.values()][0] || null;
  }

  function focusedWindow() {
    return focusedState()?.window || null;
  }

  function activeContents(state = focusedState()) {
    const tab = state && tabs.get(state.activeTabId);
    return tab && !tab.view.webContents.isDestroyed() ? tab.view.webContents : null;
  }

  function allWindows() {
    return [...windows.values()].map(state => state.window).filter(window => !window.isDestroyed());
  }

  function allTabContents() {
    return [...tabs.values()].map(tab => tab.view.webContents).filter(contents => !contents.isDestroyed());
  }

  function snapshot(state) {
    return {
      windowId: state.window.id,
      activeTabId: state.activeTabId,
      tabs: state.tabs.map(tabId => {
        const tab = tabs.get(tabId);
        return tab ? { id: tab.id, module: tab.module, title: tab.title, loading: tab.loading } : null;
      }).filter(Boolean),
      modules: MODULES,
    };
  }

  function notify(state) {
    if (!state || state.window.isDestroyed() || state.window.webContents.isDestroyed()) return;
    try { state.window.webContents.send('buyerlog:workspace-state', snapshot(state)); } catch (_) {}
  }

  function notifyAll() {
    windows.forEach(notify);
  }

  function layout(state) {
    if (!state || state.window.isDestroyed()) return;
    const bounds = state.window.getContentBounds();
    const active = tabs.get(state.activeTabId);
    if (!active || active.view.webContents.isDestroyed()) return;
    active.view.setBounds({
      x: 0,
      y: WORKSPACE_BAR_HEIGHT,
      width: Math.max(1, bounds.width),
      height: Math.max(1, bounds.height - WORKSPACE_BAR_HEIGHT),
    });
  }

  function detachView(state, tab) {
    if (!state || !tab) return;
    try { state.window.contentView.removeChildView(tab.view); } catch (_) {}
  }

  function showActive(state, focus = true) {
    if (!state || state.window.isDestroyed()) return;
    const tab = tabs.get(state.activeTabId);
    if (!tab || tab.view.webContents.isDestroyed()) return;
    state.tabs.forEach(tabId => {
      const candidate = tabs.get(tabId);
      if (candidate && candidate !== tab) detachView(state, candidate);
    });
    state.window.contentView.addChildView(tab.view);
    layout(state);
    state.window.setTitle('Buyer Log · ' + tab.title);
    if (focus) {
      try { tab.view.webContents.focus(); } catch (_) {}
    }
    notify(state);
  }

  function activateTab(windowId, tabId, focus = true) {
    const state = stateForWindow(windowId);
    const tab = tabs.get(String(tabId || ''));
    if (!state || !tab || tab.windowId !== state.window.id) return false;
    state.activeTabId = tab.id;
    showActive(state, focus);
    return true;
  }

  function bindInputShortcuts(contents) {
    contents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      const key = String(input.key || '').toLowerCase();
      if (key === 'f12' || (input.control && input.shift && key === 'i')) {
        contents.toggleDevTools();
        event.preventDefault();
      }
      if (key === 'f5') {
        contents.reload();
        event.preventDefault();
      }
    });
  }

  function createTab(moduleId, state, index = state.tabs.length) {
    const module = normalizeModule(moduleId);
    const id = crypto.randomUUID();
    const view = new WebContentsView({
      webPreferences: {
        preload: contentPreload,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        spellcheck: false,
      },
    });
    view.setBackgroundColor('#f2f2f3');
    const tab = {
      id,
      module,
      title: MODULES[module].tr,
      view,
      windowId: state.window.id,
      loading: true,
    };
    tabs.set(id, tab);
    contentsToTab.set(view.webContents.id, id);
    state.tabs.splice(clampIndex(index, state.tabs.length), 0, id);

    applyNavigationPolicy(view.webContents, origin);
    bindInputShortcuts(view.webContents);
    view.webContents.on('did-start-loading', () => { tab.loading = true; notify(stateForWindow(tab.windowId)); });
    view.webContents.on('did-stop-loading', () => { tab.loading = false; notify(stateForWindow(tab.windowId)); });
    view.webContents.on('render-process-gone', (_event, details) => {
      log('Sekme renderer süreci sonlandı (' + tab.module + '): ' + JSON.stringify(details));
    });
    view.webContents.on('did-fail-load', (_event, code, description, url) => {
      if (code !== -3) log('Sekme yüklenemedi (' + code + ' ' + description + '): ' + url);
    });
    view.webContents.on('will-prevent-unload', event => {
      const parent = stateForWindow(tab.windowId)?.window;
      const answer = dialog.showMessageBoxSync(parent && !parent.isDestroyed() ? parent : undefined, {
        type: 'question',
        title: 'Buyer Log',
        message: 'Kaydedilmemiş değişiklikler var.',
        detail: 'Bu sekmeyi kapatırsanız bekleyen değişiklikler kaybolabilir.',
        buttons: ['Sekmeyi Kapat', 'Sekmede Kal'],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
      });
      if (answer === 0) event.preventDefault();
    });
    view.webContents.on('destroyed', () => {
      contentsToTab.delete(view.webContents.id);
      tabs.delete(id);
      const owner = stateForWindow(tab.windowId);
      if (!owner) return;
      const oldIndex = owner.tabs.indexOf(id);
      if (oldIndex >= 0) owner.tabs.splice(oldIndex, 1);
      if (owner.activeTabId === id) owner.activeTabId = owner.tabs[Math.min(oldIndex, owner.tabs.length - 1)] || '';
      if (owner.activeTabId) showActive(owner, false);
      else if (!owner.closingRequested && !owner.window.isDestroyed()) requestCloseWindow(owner);
      notify(owner);
    });
    view.webContents.on('did-finish-load', () => {
      tab.loading = false;
      log('Sekme yüklendi: ' + tab.module + ' · ' + view.webContents.getURL());
      notify(stateForWindow(tab.windowId));
      if (!rendererReadySignaled) {
        rendererReadySignaled = true;
        try { onFirstRendererReady?.(view.webContents); } catch (error) { log('Renderer ready bildirimi başarısız: ' + error.message); }
      }
    });

    const url = new URL(origin + '/');
    url.searchParams.set('launch', String(Date.now()));
    url.searchParams.set('workspaceTab', id);
    url.searchParams.set('module', module);
    view.webContents.loadURL(url.toString());
    return tab;
  }

  function windowOptions(bounds) {
    return {
      width: Math.max(MIN_WINDOW_WIDTH, Number(bounds.width) || 1200),
      height: Math.max(MIN_WINDOW_HEIGHT, Number(bounds.height) || 820),
      ...(Number.isInteger(bounds.x) ? { x: bounds.x } : {}),
      ...(Number.isInteger(bounds.y) ? { y: bounds.y } : {}),
      minWidth: MIN_WINDOW_WIDTH,
      minHeight: MIN_WINDOW_HEIGHT,
      show: false,
      backgroundColor: '#f2f2f3',
      title: 'Buyer Log',
      icon: iconPath,
      autoHideMenuBar: true,
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: '#ececed', symbolColor: '#1d1f20', height: WORKSPACE_BAR_HEIGHT },
      webPreferences: {
        preload: shellPreload,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        spellcheck: false,
      },
    };
  }

  function createWindow({ module = 'overview', bounds = null, empty = false } = {}) {
    const initial = bounds || loadWindowState();
    const window = new BrowserWindow(windowOptions(initial));
    const state = {
      window,
      tabs: [],
      activeTabId: '',
      closingRequested: false,
      forceClosing: false,
    };
    windows.set(window.id, state);
    shellToWindow.set(window.webContents.id, window.id);
    lastFocusedWindowId = window.id;

    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      const key = String(input.key || '').toLowerCase();
      const contents = activeContents(state);
      if (!contents) return;
      if (key === 'f12' || (input.control && input.shift && key === 'i')) {
        contents.toggleDevTools();
        event.preventDefault();
      } else if (key === 'f5') {
        contents.reload();
        event.preventDefault();
      }
    });
    window.on('focus', () => { lastFocusedWindowId = window.id; });
    window.on('resize', () => layout(state));
    window.on('maximize', () => { layout(state); notify(state); });
    window.on('unmaximize', () => { layout(state); notify(state); });
    window.on('close', event => {
      if (state.forceClosing) return;
      event.preventDefault();
      void requestCloseWindow(state);
    });
    window.on('closed', () => {
      shellToWindow.delete(window.webContents.id);
      windows.delete(window.id);
      if (lastFocusedWindowId === window.id) lastFocusedWindowId = [...windows.keys()][0] || 0;
      notifyAll();
    });
    window.webContents.on('did-finish-load', () => notify(state));
    window.once('ready-to-show', () => {
      if (initial.maximized) window.maximize();
      window.show();
      window.focus();
      showActive(state);
    });
    window.loadFile(shellFile);

    if (!empty) {
      const tab = createTab(module, state);
      state.activeTabId = tab.id;
      showActive(state, false);
    }
    return state;
  }

  function openModule(windowId, moduleId) {
    const state = stateForWindow(windowId) || focusedState();
    if (!state) return null;
    const module = normalizeModule(moduleId);
    const existing = state.tabs.map(id => tabs.get(id)).find(tab => tab && tab.module === module);
    if (existing) {
      activateTab(state.window.id, existing.id);
      return existing;
    }
    const tab = createTab(module, state);
    state.activeTabId = tab.id;
    showActive(state);
    return tab;
  }

  function updateTabModule(contents, moduleId) {
    const tab = tabForContents(contents);
    if (!tab) return false;
    const module = normalizeModule(moduleId);
    tab.module = module;
    tab.title = MODULES[module].tr;
    const state = stateForWindow(tab.windowId);
    if (state && state.activeTabId === tab.id && !state.window.isDestroyed()) state.window.setTitle('Buyer Log · ' + tab.title);
    notify(state);
    return true;
  }

  function moveTab(tabId, targetWindowId, index) {
    const tab = tabs.get(String(tabId || ''));
    const target = stateForWindow(targetWindowId);
    const source = tab ? stateForWindow(tab.windowId) : null;
    if (!tab || !target || !source) return false;

    const sourceIndex = source.tabs.indexOf(tab.id);
    if (sourceIndex >= 0) source.tabs.splice(sourceIndex, 1);
    if (source.activeTabId === tab.id) {
      detachView(source, tab);
      source.activeTabId = source.tabs[Math.min(sourceIndex, source.tabs.length - 1)] || '';
    }

    let insertAt = clampIndex(index, target.tabs.length);
    target.tabs.splice(insertAt, 0, tab.id);
    tab.windowId = target.window.id;
    target.activeTabId = tab.id;
    showActive(target);

    if (source !== target) {
      if (source.activeTabId) showActive(source, false);
      else {
        source.forceClosing = true;
        source.window.close();
      }
      notify(source);
    }
    notify(target);
    return true;
  }

  function detachTab(tabId, sourceWindowId, point = {}) {
    const tab = tabs.get(String(tabId || ''));
    if (!tab || tab.windowId !== Number(sourceWindowId)) return false;
    const source = stateForWindow(tab.windowId);
    if (!source) return false;
    const sourceBounds = source.window.getBounds();
    const pointX = Number.isFinite(Number(point.x)) && Number(point.x) !== 0 ? Math.round(Number(point.x)) : sourceBounds.x + 196;
    const pointY = Number.isFinite(Number(point.y)) && Number(point.y) !== 0 ? Math.round(Number(point.y)) : sourceBounds.y + 54;
    const area = screen.getDisplayNearestPoint({ x:pointX, y:pointY }).workArea;
    const width = Math.min(area.width, Math.max(MIN_WINDOW_WIDTH, Math.round(sourceBounds.width * 0.78)));
    const height = Math.min(area.height, Math.max(MIN_WINDOW_HEIGHT, Math.round(sourceBounds.height * 0.82)));
    const x = Math.max(area.x, Math.min(pointX - 160, area.x + area.width - width));
    const y = Math.max(area.y, Math.min(pointY - 18, area.y + area.height - height));
    const target = createWindow({ empty: true, bounds: { x, y, width, height, maximized: false } });
    return moveTab(tab.id, target.window.id, 0);
  }

  function closeTab(tabId) {
    const tab = tabs.get(String(tabId || ''));
    if (!tab || tab.view.webContents.isDestroyed()) return false;
    tab.view.webContents.close({ waitForBeforeUnload: true });
    return true;
  }

  async function requestCloseWindow(state) {
    if (!state || state.window.isDestroyed() || state.closingRequested) return;
    state.closingRequested = true;
    try {
      for (const tabId of [...state.tabs]) {
        const tab = tabs.get(tabId);
        if (!tab || tab.view.webContents.isDestroyed()) continue;
        tab.view.webContents.close({ waitForBeforeUnload: true });
        await new Promise(resolve => setImmediate(resolve));
        if (!tab.view.webContents.isDestroyed()) return;
      }
      try { saveWindowState(state.window); } catch (_) {}
      state.forceClosing = true;
      if (!state.window.isDestroyed()) state.window.close();
    } finally {
      if (!state.window.isDestroyed()) state.closingRequested = false;
    }
  }

  function closeAllWindows() {
    allWindows().forEach(window => window.close());
  }

  function destroyAllWindows() {
    windows.forEach(state => {
      state.forceClosing = true;
      state.tabs.forEach(tabId => {
        const tab = tabs.get(tabId);
        if (tab && !tab.view.webContents.isDestroyed()) tab.view.webContents.close();
      });
      if (!state.window.isDestroyed()) state.window.destroy();
    });
  }

  function broadcast(channel, payload) {
    allTabContents().forEach(contents => {
      try { contents.send(channel, payload); } catch (_) {}
    });
  }

  function sendToDownloadOwner(contents, channel, payload) {
    const target = tabForContents(contents)?.view.webContents;
    if (target && !target.isDestroyed()) {
      try { target.send(channel, payload); } catch (_) {}
      return;
    }
    broadcast(channel, payload);
  }

  function shellSnapshot(event) {
    const state = windowForShellContents(event && event.sender);
    return state ? snapshot(state) : null;
  }

  return {
    MODULES,
    WORKSPACE_BAR_HEIGHT,
    createWindow,
    openModule,
    updateTabModule,
    activateTab,
    moveTab,
    detachTab,
    closeTab,
    closeAllWindows,
    destroyAllWindows,
    broadcast,
    sendToDownloadOwner,
    tabForContents,
    windowForContents,
    windowForShellContents,
    shellSnapshot,
    focusedWindow,
    activeContents,
    allWindows,
    allTabContents,
    windowCount: () => windows.size,
    hasWindows: () => windows.size > 0,
    stateForWindow,
    snapshot,
  };
}

module.exports = { createWorkspaceManager, MODULES, WORKSPACE_BAR_HEIGHT, normalizeModule, clampIndex };
