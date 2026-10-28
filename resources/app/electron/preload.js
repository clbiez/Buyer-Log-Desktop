'use strict';

/*
 * Buyer Log — PRELOAD KÖPRÜSÜ
 *
 * Renderer'da Node YOKTUR (nodeIntegration:false, contextIsolation:true,
 * sandbox:true). Arayüzün masaüstü tarafına açılan tek kapısı burasıdır ve
 * kapı DAR tutulur: adı sabit, sayısı sınırlı, argümansız birkaç kanal.
 *
 * Keyfi IPC çalıştırma yolu AÇILMAZ. `ipcRenderer` doğrudan dışa verilmez;
 * "kanal adını sen ver" biçiminde genel bir invoke sarmalayıcısı da verilmez —
 * ikisi de renderer'a düşen herhangi bir betiğe ana süreç yetkisi kazandırır.
 *
 * Buyer Log arayüzü bu köprü OLMADAN da tam olarak çalışır: masaüstü kipinde
 * fazladan bir yetenek eklenmedi, yalnız teşhis ve hata ekranı için okuma
 * uçları var. Bu, arayüzün tarayıcıda da çalışmaya devam etmesini sağlar.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('buyerLogDesktop', {
  isDesktop: true,
  versions: {
    electron: process.versions.electron,
    chromium: process.versions.chrome,
    node: process.versions.node,
    app: String(process.env.BUYER_LOG_ACTIVE_VERSION || ''),
    updater: String(process.env.BUYER_LOG_UPDATER_VERSION || ''),
  },
  workspace: {
    openModule: (moduleId) => ipcRenderer.invoke('buyerlog:workspace-open-module', String(moduleId || '')),
    showModuleContextMenu: (moduleId, language) => ipcRenderer.invoke('buyerlog:workspace-show-module-context-menu', {
      moduleId: String(moduleId || ''),
      language: String(language || ''),
    }),
    setModule: (moduleId) => ipcRenderer.invoke('buyerlog:workspace-set-module', String(moduleId || '')),
    setTheme: (theme) => ipcRenderer.invoke('buyerlog:workspace-theme', String(theme || '')),
    onTabActivity: (callback) => {
      if (typeof callback !== 'function') return () => {};
      const listener = (_event, payload = {}) => callback({
        active: Boolean(payload && payload.active),
        tabId: String(payload && payload.tabId || ''),
        module: String(payload && payload.module || ''),
      });
      ipcRenderer.on('buyerlog:workspace-tab-activity', listener);
      return () => ipcRenderer.removeListener('buyerlog:workspace-tab-activity', listener);
    },
  },
  /* Teşhis: kimlik bilgisi, token veya oturum anahtarı İÇERMEZ (bkz. main.js → diagnostics). */
  diagnostics: () => ipcRenderer.invoke('buyerlog:diagnostics'),
  startupFailure: () => ipcRenderer.invoke('buyerlog:startup-failure'),
  openLogFolder: () => ipcRenderer.invoke('buyerlog:open-logs'),
  retryStartup: () => ipcRenderer.invoke('buyerlog:retry'),
  /* Portu tutan kopyayı inceler / kapatır. Kapatma yalnız DOĞRULANMIŞ bir
     Buyer Log kopyasına uygulanır (bkz. electron/port-owner.js). */
  inspectPort: () => ipcRenderer.invoke('buyerlog:inspect-port'),
  closeOtherInstance: () => ipcRenderer.invoke('buyerlog:close-other'),
  quit: () => ipcRenderer.invoke('buyerlog:quit'),
  updates: {
    status: (userId) => ipcRenderer.invoke('buyerlog:update-status', { userId: String(userId || '') }),
    check: (options) => ipcRenderer.invoke('buyerlog:update-check', options || {}),
    configure: (options) => ipcRenderer.invoke('buyerlog:update-configure', options || {}),
    chooseSource: (userId) => ipcRenderer.invoke('buyerlog:update-choose-source', { userId: String(userId || '') }),
    restart: () => ipcRenderer.invoke('buyerlog:update-restart'),
    retry: (options) => ipcRenderer.invoke('buyerlog:update-retry', options || {}),
    prepareSignedPatch: (options) => ipcRenderer.invoke('buyerlog:update-signed-patch', {userId:String(options?.userId||''),language:options?.language==='en'?'en':'tr'}),
    onStatus: (callback) => {
      if (typeof callback !== 'function') return () => {};
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on('buyerlog:update-status-changed', listener);
      return () => ipcRenderer.removeListener('buyerlog:update-status-changed', listener);
    },
  },
  /* Shared Hub folder picker: renderer receives only the user-selected folder
     path. There is no generic filesystem IPC surface. */
  chooseSharedHubFolder: () => ipcRenderer.invoke('buyerlog:choose-shared-hub-folder'),
  /* Database workbook picker: returns only the explicitly selected workbook path
     plus a one-time-verifiable HMAC proof; no generic file-system API is exposed. */
  chooseDatabaseWorkbook: () => ipcRenderer.invoke('buyerlog:choose-database-workbook'),
  /* CoreNectum SSO: token değeri renderer'a dönmez; yalnız sonuç durumu. */
  ensureCoreNectumAuth: (options) => ipcRenderer.invoke('buyerlog:corenectum-auth', options || {}),
  clearCoreNectumAuth: () => ipcRenderer.invoke('buyerlog:corenectum-auth-clear'),
  /* OAB SSO: renderer receives only success/authenticated state, never Authorization. */
  ensureOabAuth: (options) => ipcRenderer.invoke('buyerlog:oab-auth', options || {}),
  clearOabAuth: () => ipcRenderer.invoke('buyerlog:oab-auth-clear'),
  /*
   * "Dosya hazır" bildirim kartı. Ana süreç, tarayıcı indirme yöneticisinden
   * geçen her dosyanın GERÇEK son yolunu bilir (bkz. main.js → will-download);
   * burada renderer'a yalnız görüntülemelik bir yol METNİ ve opak bir TOKEN
   * geçer. Aç/Klasörde Göster o token'ı geri gönderir — hiçbir zaman bir yol
   * argümanı değil; ana süreç yolu kendi kaydından çözer.
   */
  onDownloadComplete: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('buyerlog:download-complete', listener);
    return () => ipcRenderer.removeListener('buyerlog:download-complete', listener);
  },
  openDownload: (token) => ipcRenderer.invoke('buyerlog:open-download', token),
  revealDownload: (token) => ipcRenderer.invoke('buyerlog:reveal-download', token),
  // LCW AI çıktıları yalnız İndirilenler klasöründeki dosya adıyla açılır;
  // renderer keyfi bir dosya sistemi yolu veremez.
  openGeneratedDownload: (fileName) => ipcRenderer.invoke('buyerlog:open-generated-download', String(fileName || '')),
  revealGeneratedDownload: (fileName) => ipcRenderer.invoke('buyerlog:reveal-generated-download', String(fileName || '')),
  /* LCW AI arka plan oturumu (PLM Sync deseni): gizli Electron oturumu.
     Yanıt yalnız { ok, code }; token renderer'a dönmez. */
  ensureLcwAiAuth: (options) => ipcRenderer.invoke('buyerlog:lcwai-auth', { interactive: !(options && options.interactive === false) }),
  clearLcwAiAuth: () => ipcRenderer.invoke('buyerlog:lcwai-auth-clear'),
  /* LCW AI Export Engine: sunucunun temizlediği rapor HTML'i → PDF baytları.
     Ana süreç JS'i kapalı, ağı engelli gizli pencerede basar; yol/dosya
     yetkisi yoktur (kaydı sunucu yapar). */
  renderPdf: (html, options) => ipcRenderer.invoke('buyerlog:render-pdf', {
    html: String(html || ''),
    landscape: Boolean(options && options.landscape),
  }),
});
