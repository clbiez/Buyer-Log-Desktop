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
const CLOSE_FORCE_DELAY_MS = 250;
const WINDOW_THEME = Object.freeze({
  light: { background:'#F6F7F9', overlay:'#FBFBFC', symbol:'#101828' },
  grey: { background:'#DFE1E4', overlay:'#E3E5E8', symbol:'#22262B' },
  dark: { background:'#131417', overlay:'#212429', symbol:'#E8EAED' },
});

function normalizeWorkspaceTheme(value, fallback = 'light') {
  const theme = String(value || '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(WINDOW_THEME, theme) ? theme : fallback;
}

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
    BrowserWindow, WebContentsView, dialog, screen, path, crypto, origin, nativeTheme,
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
  let primaryWindowId = 0;
  let workspaceTheme = normalizeWorkspaceTheme(
    options.initialTheme,
    nativeTheme && nativeTheme.shouldUseDarkColors ? 'dark' : 'light',
  );

  function currentWindowTheme() {
    return WINDOW_THEME[workspaceTheme] || WINDOW_THEME.light;
  }

  function applyWindowTheme(window) {
    if (!window || window.isDestroyed()) return;
    const theme = currentWindowTheme();
    try { window.setBackgroundColor(theme.background); } catch (_) {}
    try { window.setTitleBarOverlay({ color:theme.overlay, symbolColor:theme.symbol, height:WORKSPACE_BAR_HEIGHT }); } catch (_) {}
  }

  function setTheme(value) {
    const next = normalizeWorkspaceTheme(value, workspaceTheme);
    workspaceTheme = next;
    windows.forEach(state => applyWindowTheme(state.window));
    tabs.forEach(tab => {
      const contents = tabContents(tab);
      if (tab && tab.view && isLiveContents(contents)) {
        try { tab.view.setBackgroundColor(currentWindowTheme().background); } catch (_) {}
      }
    });
    notifyAll();
    return workspaceTheme;
  }

  function stateForWindow(windowId) {
    return windows.get(Number(windowId)) || null;
  }

  function isLiveWindowState(state) {
    return Boolean(state && state.window && typeof state.window.isDestroyed === 'function' && !state.window.isDestroyed());
  }

  function tabContents(tab) {
    return tab && tab.view && tab.view.webContents ? tab.view.webContents : null;
  }

  function isLiveContents(contents) {
    if (!contents || typeof contents.isDestroyed !== 'function') return false;
    try { return !contents.isDestroyed(); } catch (_) { return false; }
  }

  function isLiveTab(tab, state = null) {
    if (!tab || tab.closing || !tab.id || tabs.get(tab.id) !== tab) return false;
    const owner = state || stateForWindow(tab.windowId);
    if (!isLiveWindowState(owner) || tab.windowId !== owner.window.id || !owner.tabs.includes(tab.id)) return false;
    return Boolean(tab.view && isLiveContents(tabContents(tab)));
  }

  function tabForContents(contents) {
    if (!isLiveContents(contents)) return null;
    const tabId = contentsToTab.get(contents.id);
    const tab = tabId ? tabs.get(tabId) || null : null;
    return isLiveTab(tab) ? tab : null;
  }

  function windowForContents(contents) {
    const tab = tabForContents(contents);
    const state = tab ? stateForWindow(tab.windowId) : null;
    return isLiveWindowState(state) ? state.window : null;
  }

  function windowForShellContents(contents) {
    if (!isLiveContents(contents)) return null;
    const windowId = shellToWindow.get(contents.id);
    const state = windowId ? stateForWindow(windowId) : null;
    return isLiveWindowState(state) ? state : null;
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
    return isLiveTab(tab, state) ? tabContents(tab) : null;
  }

  function allWindows() {
    return [...windows.values()].filter(isLiveWindowState).map(state => state.window);
  }

  function allTabContents() {
    return [...tabs.values()].filter(tab => isLiveTab(tab)).map(tabContents);
  }

  function pointInside(bounds, x, y) {
    return Boolean(bounds && x >= bounds.x && y >= bounds.y && x < bounds.x + bounds.width && y < bounds.y + bounds.height);
  }

  function reattachTarget(source) {
    if (!isLiveWindowState(source) || source.window.id === primaryWindowId) return null;
    const primary = stateForWindow(primaryWindowId);
    if (isLiveWindowState(primary)) return primary;
    return [...windows.values()].find(candidate => candidate !== source && isLiveWindowState(candidate)) || null;
  }

  function settleCloseRequest(tab, closed) {
    const request = tab && tab.closeRequest;
    if (!request) return;
    tab.closeRequest = null;
    if (request.timer) clearTimeout(request.timer);
    request.resolve(Boolean(closed));
  }

  function cleanupTab(tab, { closeEmpty = true, notifyOwner = true } = {}) {
    if (!tab || !tab.id) return false;
    const id = String(tab.id);
    const owner = stateForWindow(tab.windowId);
    const oldIndex = owner ? owner.tabs.indexOf(id) : -1;
    const contents = tabContents(tab);

    tab.closing = true;
    if (owner) detachView(owner, tab);

    if (contents) {
      try {
        if (contentsToTab.get(contents.id) === id) contentsToTab.delete(contents.id);
      } catch (_) {}
    }
    for (const [contentsId, mappedTabId] of [...contentsToTab.entries()]) {
      if (mappedTabId === id) contentsToTab.delete(contentsId);
    }
    if (tabs.get(id) === tab) tabs.delete(id);

    if (owner) {
      owner.tabs = owner.tabs.filter(tabId => tabId !== id);
      if (owner.activeTabId === id || !tabs.has(owner.activeTabId)) {
        const fallbackIndex = oldIndex >= 0 ? Math.min(oldIndex, owner.tabs.length - 1) : 0;
        owner.activeTabId = owner.tabs[fallbackIndex] || owner.tabs[0] || '';
      }
    }

    settleCloseRequest(tab, true);

    if (isLiveWindowState(owner)) {
      if (owner.activeTabId && !owner.closingRequested) showActive(owner, false);
      else if (!owner.activeTabId && closeEmpty && !owner.closingRequested) void requestCloseWindow(owner);
      if (notifyOwner) notify(owner);
    }
    return true;
  }

  function purgeStaleTabs(state) {
    if (!state) return 0;
    let purged = 0;
    for (const id of [...state.tabs]) {
      const tab = tabs.get(id);
      if (isLiveTab(tab, state)) continue;
      if (tab) cleanupTab(tab, { closeEmpty:false, notifyOwner:false });
      else {
        state.tabs = state.tabs.filter(tabId => tabId !== id);
        for (const [contentsId, mappedTabId] of [...contentsToTab.entries()]) {
          if (mappedTabId === id) contentsToTab.delete(contentsId);
        }
      }
      purged += 1;
    }
    if (!state.activeTabId || !isLiveTab(tabs.get(state.activeTabId), state)) {
      state.activeTabId = state.tabs.find(id => isLiveTab(tabs.get(id), state)) || '';
    }
    return purged;
  }

  function snapshot(state) {
    return {
      windowId: state && state.window ? state.window.id : 0,
      activeTabId: state ? state.activeTabId : '',
      tabs: state ? state.tabs.map(tabId => {
        const tab = tabs.get(tabId);
        return isLiveTab(tab, state) ? { id: tab.id, module: tab.module, title: tab.title, loading: tab.loading } : null;
      }).filter(Boolean) : [],
      modules: MODULES,
      theme: workspaceTheme,
      isPrimaryWindow: state.window.id === primaryWindowId,
      canReattach: Boolean(reattachTarget(state)),
    };
  }

  function notify(state) {
    if (!isLiveWindowState(state) || !isLiveContents(state.window.webContents)) return;
    try { state.window.webContents.send('buyerlog:workspace-state', snapshot(state)); } catch (_) {}
  }

  function notifyAll() {
    windows.forEach(notify);
  }

  function layout(state) {
    if (!isLiveWindowState(state)) return;
    const bounds = state.window.getContentBounds();
    const active = tabs.get(state.activeTabId);
    if (!isLiveTab(active, state)) return;
    active.view.setBounds({
      x: 0,
      y: WORKSPACE_BAR_HEIGHT,
      width: Math.max(1, bounds.width),
      height: Math.max(1, bounds.height - WORKSPACE_BAR_HEIGHT),
    });
  }

  function detachView(state, tab) {
    if (!isLiveWindowState(state) || !tab || !tab.view) return;
    try { state.window.contentView.removeChildView(tab.view); } catch (_) {}
  }

  function showActive(state, focus = true) {
    if (!isLiveWindowState(state)) return;
    purgeStaleTabs(state);
    const tab = tabs.get(state.activeTabId);
    if (!isLiveTab(tab, state)) {
      notify(state);
      return;
    }
    state.tabs.forEach(tabId => {
      const candidate = tabs.get(tabId);
      if (candidate && candidate !== tab && candidate.view) detachView(state, candidate);
    });
    try { state.window.contentView.addChildView(tab.view); } catch (_) { return; }
    layout(state);
    state.window.setTitle('Buyer Log · ' + tab.title);
    if (focus) {
      try { tabContents(tab).focus(); } catch (_) {}
    }
    notify(state);
  }

  function activateTab(windowId, tabId, focus = true) {
    const state = stateForWindow(windowId);
    if (!isLiveWindowState(state)) return false;
    purgeStaleTabs(state);
    const tab = tabs.get(String(tabId || ''));
    if (!isLiveTab(tab, state)) return false;
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
    view.setBackgroundColor(currentWindowTheme().background);
    const tab = {
      id,
      module,
      title: MODULES[module].tr,
      view,
      windowId: state.window.id,
      loading: true,
      closing: false,
      closeRequest: null,
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
      if (tab.closing) {
        event.preventDefault();
        return;
      }
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
      if (answer === 0) {
        if (tab.closeRequest) tab.closeRequest.approved = true;
        event.preventDefault();
      } else if (tab.closeRequest) {
        settleCloseRequest(tab, false);
      }
    });
    view.webContents.on('destroyed', () => {
      cleanupTab(tab);
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
    const theme = currentWindowTheme();
    return {
      width: Math.max(MIN_WINDOW_WIDTH, Number(bounds.width) || 1200),
      height: Math.max(MIN_WINDOW_HEIGHT, Number(bounds.height) || 820),
      ...(Number.isInteger(bounds.x) ? { x: bounds.x } : {}),
      ...(Number.isInteger(bounds.y) ? { y: bounds.y } : {}),
      minWidth: MIN_WINDOW_WIDTH,
      minHeight: MIN_WINDOW_HEIGHT,
      show: false,
      backgroundColor: theme.background,
      title: 'Buyer Log',
      icon: iconPath,
      autoHideMenuBar: true,
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: theme.overlay, symbolColor: theme.symbol, height: WORKSPACE_BAR_HEIGHT },
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
    const shellContentsId = window.webContents.id;
    applyWindowTheme(window);
    const state = {
      window,
      tabs: [],
      activeTabId: '',
      closingRequested: false,
      forceClosing: false,
      emptyCloseScheduled: false,
    };
    windows.set(window.id, state);
    if (!primaryWindowId) primaryWindowId = window.id;
    shellToWindow.set(shellContentsId, window.id);
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
      shellToWindow.delete(shellContentsId);
      windows.delete(window.id);
      if (primaryWindowId === window.id) primaryWindowId = [...windows.keys()][0] || 0;
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
    if (!isLiveWindowState(state) || state.closingRequested) return null;
    purgeStaleTabs(state);
    const module = normalizeModule(moduleId);
    const existing = state.tabs.map(id => tabs.get(id)).find(tab => isLiveTab(tab, state) && tab.module === module);
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

  function closeEmptyDetachedWindow(state) {
    if (!isLiveWindowState(state) || state.window.id === primaryWindowId || state.tabs.length > 0) return false;
    if (state.emptyCloseScheduled) return true;
    state.emptyCloseScheduled = true;

    setImmediate(() => {
      state.emptyCloseScheduled = false;
      if (!windows.has(state.window.id) || !isLiveWindowState(state) || state.window.id === primaryWindowId || state.tabs.length > 0) return;
      state.forceClosing = true;
      try { state.window.close(); } catch (_) {}

      if (!state.window.isDestroyed()) {
        const fallback = setTimeout(() => {
          if (!windows.has(state.window.id) || !isLiveWindowState(state) || state.window.id === primaryWindowId || state.tabs.length > 0) return;
          try { state.window.destroy(); } catch (_) {}
        }, 250);
        fallback.unref?.();
      }
    });
    return true;
  }

  function settleSourceAfterMove(source, target) {
    if (!source || source === target || source.window.isDestroyed()) return;
    if (source.tabs.length > 0) {
      if (source.activeTabId) showActive(source, false);
      notify(source);
      return;
    }
    source.activeTabId = '';
    closeEmptyDetachedWindow(source);
  }

  function moveTab(tabId, targetWindowId, index) {
    const tab = tabs.get(String(tabId || ''));
    const target = stateForWindow(targetWindowId);
    const source = tab ? stateForWindow(tab.windowId) : null;
    if (!isLiveTab(tab, source) || !isLiveWindowState(target)) return false;

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

    if (source !== target) settleSourceAfterMove(source, target);
    notify(target);
    return true;
  }

  function detachTab(tabId, sourceWindowId, point = {}) {
    const tab = tabs.get(String(tabId || ''));
    const source = tab ? stateForWindow(tab.windowId) : null;
    if (!isLiveTab(tab, source) || tab.windowId !== Number(sourceWindowId)) return false;
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

  function finishTabDrag(tabId, sourceWindowId, point = {}) {
    const tab = tabs.get(String(tabId || ''));
    const source = stateForWindow(sourceWindowId);
    if (!isLiveTab(tab, source) || tab.windowId !== source.window.id) return false;
    const x = Math.round(Number(point.x));
    const y = Math.round(Number(point.y));
    if (!Number.isFinite(x) || !Number.isFinite(y) || (x === 0 && y === 0)) return false;
    if (pointInside(source.window.getBounds(), x, y)) return false;
    const target = [...windows.values()].find(candidate => candidate !== source && !candidate.window.isDestroyed() && pointInside(candidate.window.getBounds(), x, y));
    if (target) return moveTab(tab.id, target.window.id, target.tabs.length);
    return detachTab(tab.id, source.window.id, { x, y });
  }

  function reattachTab(tabId, sourceWindowId) {
    const tab = tabs.get(String(tabId || ''));
    const source = stateForWindow(sourceWindowId);
    if (!isLiveTab(tab, source) || tab.windowId !== source.window.id) return false;
    const target = reattachTarget(source);
    return target ? moveTab(tab.id, target.window.id, target.tabs.length) : false;
  }

  function forceCloseContents(contents) {
    if (!isLiveContents(contents)) return;
    try { contents.close({ waitForBeforeUnload:false }); } catch (_) {}
    if (!isLiveContents(contents)) return;
    try { contents.forcefullyCrashRenderer?.(); } catch (_) {}
    try { contents.close({ waitForBeforeUnload:false }); } catch (_) {}
  }

  function closeTab(tabId) {
    const tab = tabs.get(String(tabId || ''));
    if (!tab) return Promise.resolve(false);
    if (tab.closeRequest) return tab.closeRequest.promise;

    const contents = tabContents(tab);
    if (!isLiveContents(contents)) {
      cleanupTab(tab);
      return Promise.resolve(true);
    }

    let resolveRequest = null;
    const promise = new Promise(resolve => { resolveRequest = resolve; });
    tab.closeRequest = { promise, resolve:resolveRequest, timer:null };
    tab.closing = true;

    try { contents.close({ waitForBeforeUnload:false }); }
    catch (error) { log('Sekme kapatma isteği başarısız (' + tab.module + '): ' + error.message); }

    cleanupTab(tab);

    if (isLiveContents(contents)) {
      const fallback = setTimeout(() => forceCloseContents(contents), CLOSE_FORCE_DELAY_MS);
      fallback.unref?.();
    }
    return promise;
  }

  async function requestCloseWindow(state) {
    if (!isLiveWindowState(state) || state.closingRequested) return false;
    state.closingRequested = true;
    try {
      purgeStaleTabs(state);
      for (const tabId of [...state.tabs]) {
        if (!tabs.has(tabId)) continue;
        await closeTab(tabId);
      }
      try { saveWindowState(state.window); } catch (_) {}
      state.forceClosing = true;
      if (isLiveWindowState(state)) state.window.close();
      return true;
    } finally {
      if (isLiveWindowState(state)) state.closingRequested = false;
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
        const contents = tabContents(tab);
        if (isLiveContents(contents)) {
          try { contents.close({ waitForBeforeUnload:false }); } catch (_) {}
        }
        if (tab) cleanupTab(tab, { closeEmpty:false, notifyOwner:false });
      });
      if (isLiveWindowState(state)) state.window.destroy();
    });
  }

  function broadcast(channel, payload) {
    allTabContents().forEach(contents => {
      try { contents.send(channel, payload); } catch (_) {}
    });
  }

  function sendToDownloadOwner(contents, channel, payload) {
    const target = tabContents(tabForContents(contents));
    if (isLiveContents(target)) {
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
    finishTabDrag,
    reattachTab,
    closeEmptyDetachedWindow,
    closeTab,
    setTheme,
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

module.exports = { createWorkspaceManager, MODULES, WORKSPACE_BAR_HEIGHT, normalizeModule, normalizeWorkspaceTheme, clampIndex };
