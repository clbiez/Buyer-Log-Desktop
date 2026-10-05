/* ===================================================================
   LCW AI — Genel çalışma alanı (sol menü › LCW AI, üst çubuk › LCW AI)

   ChatGPT benzeri, Buyer Log'un her yerinden açılan genel kurumsal asistan.
   Calculated Column / Kurallar / Otomasyon içindeki "LCW AI'dan Destek Al"
   alanlarının YERİNE GEÇMEZ; onlar bağlama özel yardımcıdır. İkisi de aynı
   motoru kullanır: window.BuyerLogAI (public/lcwai-assistant.js) →
   /api/lcwai/chat → server/lib/lcwai (LCWAIEngine) → LCW AI HTTP API.

   - Sohbet: chatId=null yeni sohbet; dönen chatId ile devam. Görünen sohbet
     geçmişi BLStorage üzerinden kullanıcı bazlı ve yalnız bu cihazda saklanır;
     ek dosya baytları / Buyer Log bağlam tabloları geçmiş kaydına yazılmaz.
     chatId korunur, böylece LCW AI'daki aynı konuşmaya devam edilebilir.
   - Dosyalar: LCW AI upload uç noktasına doğrudan yüklenir, ek olarak gider.
   - Buyer Log bağlamı: isteğe bağlıdır. Ekranlar AIContextProvider kaydeder
     (BuyerLogAI.registerContextProvider); bu dosya varsayılan sağlayıcıları
     (CP, Siparişler, Nakliye, Koleksiyon, Overview, Backlog) kaydeder.
   - Cevaplar BLMarkdown ile güvenli görüntülenir; ham HTML DOM'a girmez.
   =================================================================== */
(function () {
  'use strict';
  if (window.initLcwAiChat) return;

  const isEn = () => String(window.appLang || document.documentElement.lang || 'tr').toLowerCase().startsWith('en');
  const L = (trText, enText) => (isEn() ? enText : trText);
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const AI = () => window.BuyerLogAI || null;
  /* Bağlam tabloları KESİLMEZ: tüm satırlar ve tüm görünür sütunlar CSV dosyası
     olarak LCW AI'a yüklenir (mesaj metni sınırı yok); mesajda yalnız kısa özet
     kalır. Eskiden 200 satır / 25 sütun / 20 bin karakterle kesiliyordu. */

  /* ---------------- Varsayılan bağlam sağlayıcıları ---------------- */
  const cellValue = value => (value == null ? '' : (typeof value === 'object' ? (value instanceof Date ? value.toISOString().slice(0, 10) : JSON.stringify(value)) : String(value)));
  /* Model görseli anahtarları: görselin kendisi LCW AI'a GİTMEZ; CSV'ye
     yalnız kısa anahtar (ör. KOL-3) yazılır. Çıktı bu anahtarı kullanırsa
     Buyer Log görseli yerel depodan alıp dosyaya gömer. */
  const IMAGE_PREFIX = { cp: 'CP', orders: 'ORD', koleksiyon: 'KOL', overview: 'OV', shipping: 'SHP' };
  const IMAGE_COLUMN = 'BL Image';
  // Aynı görsel → oturum boyunca aynı anahtar; farklı görsel → farklı anahtar
  // (birden çok bağlam eklense de anahtarlar çakışmaz).
  const imageKeys = new Map();
  function imageKeyFor(tab, identity) {
    const id = `${tab}|${identity.source}|${identity.modelId}|${identity.colourCode}`;
    if (!imageKeys.has(id)) imageKeys.set(id, `${IMAGE_PREFIX[tab]}-${imageKeys.size + 1}`);
    return imageKeys.get(id);
  }
  function withImageKeys(tab, rows, columns, values) {
    const screenData = window.BLAIScreenData;
    if (!screenData || typeof screenData.rowImage !== 'function' || !IMAGE_PREFIX[tab]) return { columns, values, images: null };
    const images = {};
    const keys = rows.map(row => {
      const identity = screenData.rowImage(tab, row);
      if (!identity) return '';
      const key = imageKeyFor(tab, identity);
      images[key] = identity;
      return key;
    });
    if (!Object.keys(images).length) return { columns, values, images: null };
    return { columns: [IMAGE_COLUMN, ...columns], values: values.map((row, index) => [keys[index], ...row]), images };
  }
  function tableContext(tab, mode) {
    const data = window.BLAIScreenData && window.BLAIScreenData.table(tab, { all: mode === 'all' });
    if (!data) return null;
    const columns = data.columns;
    const selected = new Set((data.selectedIds || []).map(String));
    const source = mode === 'selected' ? data.rows.filter(row => selected.has(String(row && row._id))) : data.rows;
    const title = window.BLAIScreenData.pageTitle(tab);
    const keyed = mode === 'filters' ? null : withImageKeys(tab, source, columns.map(col => col.label), source.map(row => columns.map(col => cellValue(row && row[col.key]))));
    return {
      images: keyed && keyed.images,
      label: mode === 'all' ? L(`${title} — tüm kayıtlar`, `${title} — all records`) : mode === 'selected' ? L(`${title} — seçili kayıtlar`, `${title} — selected records`) : mode === 'filters' ? L(`${title} — filtreler ve özet`, `${title} — filters and summary`) : L(`${title} — görünen kayıtlar`, `${title} — visible records`),
      screen: tab,
      summary: mode === 'all' ? L(`${source.length} kayıt (sayfa filtreleri uygulanmadan, tüm sütunlarla).`, `${source.length} records (without page filters, all columns).`) : L(`${source.length} kayıt (tablodaki filtreler uygulanmış).`, `${source.length} records (table filters applied).`),
      filters: data.filters,
      columns: keyed ? keyed.columns : [],
      rows: keyed ? keyed.values : [],
      totalRows: source.length,
    };
  }
  /* Bağlam tablosu → CSV (RFC 4180; Excel uyumu için UTF-8 BOM). */
  const csvCell = value => { const text = String(value == null ? '' : value); return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; };
  function contextCsv(context) {
    const lines = [context.columns.map(csvCell).join(',')];
    for (const row of context.rows) lines.push(context.columns.map((_, index) => csvCell(Array.isArray(row) ? row[index] : '')).join(','));
    return `\ufeff${lines.join('\r\n')}\r\n`;
  }
  function contextFileName(context) {
    const base = String(context.label || context.screen || 'buyerlog').replace(/ı/g, 'i').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'buyerlog';
    return `BuyerLog-${base}.csv`;
  }
  /* Tablo taşıyan bağlamı dosyaya çevirir: { context (yalnız özet), file }. */
  function contextAsFile(context) {
    if (!context || !Array.isArray(context.columns) || !context.columns.length || !Array.isArray(context.rows) || !context.rows.length) return { context, file: null };
    const name = contextFileName(context);
    const file = new File([contextCsv(context)], name, { type: 'text/csv' });
    const { rows, columns, images, ...rest } = context;
    return {
      file,
      context: { ...rest, text: L(`Tablonun tamamı ekli “${name}” dosyasında: ${rows.length} satır, ${columns.length} sütun (${columns.join(', ')}).`, `The full table is in the attached “${name}” file: ${rows.length} rows, ${columns.length} columns (${columns.join(', ')}).`) + (images ? L(` “${IMAGE_COLUMN}” sütunu kaydın Buyer Log’daki gerçek model görselinin anahtarıdır.`, ` The “${IMAGE_COLUMN}” column is the key of the record’s real model image in Buyer Log.`) : '') },
      images: images || null,
    };
  }

  function registerDefaultProviders() {
    const api = AI();
    if (!api || !api.registerContextProvider) return;
    const tables = [['cp', { tr: 'CP Tracker', en: 'CP Tracker' }], ['orders', { tr: 'Siparişler', en: 'Orders' }], ['shipping', { tr: 'Nakliye Kıyaslama', en: 'Shipping Comparison' }], ['koleksiyon', { tr: 'Koleksiyon', en: 'Collection' }]];
    for (const [tab, label] of tables) {
      api.registerContextProvider({
        id: tab, screen: tab, label,
        getOptions() {
          // Varsayılan: sayfa filtrelerinden bağımsız TÜM kayıtlar.
          const full = window.BLAIScreenData && window.BLAIScreenData.table(tab, { all: true });
          if (!full) return [];
          const data = window.BLAIScreenData.table(tab);
          const options = [{ id: 'all', label: { tr: `Tüm kayıtlar (${full.rows.length})`, en: `All records (${full.rows.length})` }, detail: { tr: 'Sayfa filtreleri olmadan, tüm sütunlar · CSV dosyası olarak', en: 'Without page filters, all columns · as a CSV file' } }];
          if (data && data.rows.length !== full.rows.length) options.push({ id: 'visible', label: { tr: `Yalnız filtrelenmiş kayıtlar (${data.rows.length})`, en: `Filtered records only (${data.rows.length})` }, detail: { tr: 'Sayfadaki filtreler uygulanmış', en: 'Page filters applied' } });
          if (data && data.selectedIds && data.selectedIds.length) options.push({ id: 'selected', label: { tr: `Seçili kayıtlar (${data.selectedIds.length})`, en: `Selected records (${data.selectedIds.length})` } });
          if (data) options.push({ id: 'filters', label: { tr: 'Aktif filtreler ve özet', en: 'Active filters and summary' } });
          return options;
        },
        build: mode => tableContext(tab, mode),
      });
    }
    api.registerContextProvider({
      id: 'overview', screen: 'overview', label: { tr: 'Overview', en: 'Overview' },
      getOptions() {
        const all = window.BLAIScreenData ? window.BLAIScreenData.overviewCpRows({ all: true }) : [];
        if (!all.length) return [];
        const rows = window.BLAIScreenData.overviewCpRows();
        const options = [{ id: 'all', label: { tr: `Tüm CP kayıtları (${all.length})`, en: `All CP records (${all.length})` }, detail: { tr: 'Overview filtreleri olmadan', en: 'Without Overview filters' } }];
        if (rows.length !== all.length) options.push({ id: 'cp', label: { tr: `Overview CP kümesi (${rows.length})`, en: `Overview CP set (${rows.length})` }, detail: { tr: 'Overview filtreleri uygulanmış', en: 'Overview filters applied' } });
        return options;
      },
      build(mode) {
        const rows = window.BLAIScreenData.overviewCpRows({ all: mode !== 'cp' });
        const columns = window.BLAIScreenData.cpColumns();
        const keyed = withImageKeys('overview', rows, columns.map(col => col.label), rows.map(row => columns.map(col => cellValue(row[col.key]))));
        return { label: mode === 'cp' ? L('Overview — CP kümesi', 'Overview — CP set') : L('Overview — tüm CP kayıtları', 'Overview — all CP records'), screen: 'overview', summary: mode === 'cp' ? L(`${rows.length} CP satırı (Overview filtreleri uygulanmış).`, `${rows.length} CP rows (Overview filters applied).`) : L(`${rows.length} CP satırı (filtre uygulanmadan).`, `${rows.length} CP rows (no filters applied).`), columns: keyed.columns, rows: keyed.values, images: keyed.images, totalRows: rows.length };
      },
    });
    api.registerContextProvider({
      id: 'backlog', screen: 'backlog', label: { tr: 'Backlog', en: 'Backlog' },
      getOptions() {
        const ready = window.BLAIScreenData && window.BLAIScreenData.backlogQuery();
        return ready ? [
          { id: 'all', label: { tr: 'Tüm Backlog kayıtları', en: 'All Backlog records' }, detail: { tr: 'Sayfa filtreleri olmadan · CSV dosyası olarak', en: 'Without page filters · as a CSV file' } },
          { id: 'rows', label: { tr: 'Backlog kayıtları (aktif filtre)', en: 'Backlog records (active filter)' }, detail: { tr: 'Sayfadaki filtreler uygulanmış', en: 'Page filters applied' } },
        ] : [];
      },
      async build(mode) {
        // Backlog ekranı hiç açılmamış olsa da veri sunucudan doğrudan alınır.
        const query = window.BLAIScreenData.backlogQuery({ all: mode !== 'rows' });
        const rows = window.BLBacklogRows ? await window.BLBacklogRows.load(query) : await window.BLAIScreenData.backlogRows(query);
        const columns = Object.keys(rows[0] || {}).filter(key => !key.startsWith('_'));
        return { label: mode === 'rows' ? L('Backlog — filtrelenmiş kayıtlar', 'Backlog — filtered records') : L('Backlog — tüm kayıtlar', 'Backlog — all records'), screen: 'backlog', summary: mode === 'rows' ? L(`${rows.length} Backlog satırı (sayfa filtreleri uygulanmış).`, `${rows.length} Backlog rows (page filters applied).`) : L(`${rows.length} Backlog satırı (filtre uygulanmadan).`, `${rows.length} Backlog rows (no filters applied).`), columns, rows: rows.map(row => columns.map(key => cellValue(row[key]))), totalRows: rows.length };
      },
    });
  }

  /* ---------------- Durum ---------------- */
  const state = {
    conversations: [], activeId: '', files: [], contexts: [], busy: false, requestId: '', config: null, status: null, mounted: false,
    // Yanıt biçimi: '' = sohbet; pdf/pptx/xlsx/html = AI Çıktı Oluşturma.
    output: { format: '', orientation: 'portrait', detail: 'standard' },
    // Mesajda ekran adı geçerse o ekranın verisi otomatik eklenir.
    autoContext: true,
  };

  /* ---------------- Kullanıcı bazlı sohbet geçmişi ----------------
     BLStorage bu anahtarı kullanıcı kimliğiyle scope eder; SYNCED listesine
     eklenmediği için konuşma içeriği Shared Hub / user-preferences sunucusuna
     taşınmaz. Yalnız metin + güvenli UI metadatası tutulur; yüklenen dosya
     baytları, attachment URL'leri, Buyer Log context satırları ve imageMap
     diske yazılmaz. */
  const HISTORY_KEY = 'bl.lcwai.history.v1';
  const HISTORY_MAX_CONVERSATIONS = 30;
  const HISTORY_MAX_MESSAGES = 80;
  const HISTORY_MAX_JSON = 2400000;
  const HISTORY_LABEL_CHARS = 200;
  const historyStore = () => (window.BLStorage && typeof window.BLStorage.getItem === 'function' && typeof window.BLStorage.setItem === 'function' ? window.BLStorage : null);
  const cleanHistoryText = value => String(value == null ? '' : value).slice(0, 100000);
  function historyFile(file) {
    if (!file || !file.id || !file.fileName) return null;
    return {
      id: String(file.id), fileName: String(file.fileName).slice(0, 240),
      format: String(file.format || '').slice(0, 12), title: cleanHistoryText(file.title).slice(0, 240),
      template: String(file.template || '').slice(0, 80), templateLabel: String(file.templateLabel || '').slice(0, 160),
      bytes: Number(file.bytes) || 0, createdAt: String(file.createdAt || '').slice(0, 40),
      attempts: Math.max(1, Number(file.attempts) || 1), fallback: String(file.fallback || '').slice(0, 20),
    };
  }
  function historyMessage(message) {
    if (!message || (message.role !== 'user' && message.role !== 'ai') || message.streaming) return null;
    const item = { role: message.role, text: cleanHistoryText(message.text) };
    if (message.error) item.error = cleanHistoryText(message.error).slice(0, 1000);
    if (message.model) item.model = String(message.model).slice(0, 80);
    if (message.role === 'user') {
      item.contextLabels = (Array.isArray(message.contextLabels) ? message.contextLabels : []).slice(0, 12).map(value => String(value).slice(0, HISTORY_LABEL_CHARS));
      item.fileNames = (Array.isArray(message.fileNames) ? message.fileNames : []).slice(0, 12).map(value => String(value).slice(0, 240));
      item.output = message.output && typeof message.output === 'object' ? {
        format: String(message.output.format || '').slice(0, 12),
        orientation: message.output.orientation === 'landscape' ? 'landscape' : 'portrait',
        detail: String(message.output.detail || 'standard').slice(0, 20),
      } : null;
      // Yeniden üretmede upstream sohbet geçmişi kullanılır; eski upload URL/context
      // nesnelerini kalıcı depoya taşımıyoruz.
      item.attachments = [];
      item.contexts = [];
    }
    const file = historyFile(message.file);
    if (file) item.file = file;
    return item;
  }
  function persistConversations() {
    const store = historyStore();
    if (!store) return;
    let list = state.conversations.filter(conv => conv && Array.isArray(conv.messages) && conv.messages.some(message => !message.streaming)).slice(0, HISTORY_MAX_CONVERSATIONS).map(conv => ({
      id: String(conv.id || '').slice(0, 80),
      chatId: conv.chatId == null ? null : String(conv.chatId).slice(0, 180),
      title: String(conv.title || '').slice(0, 120),
      messages: conv.messages.slice(-HISTORY_MAX_MESSAGES).map(historyMessage).filter(Boolean),
    })).filter(conv => conv.messages.length);
    try {
      let json = JSON.stringify(list);
      while (json.length > HISTORY_MAX_JSON && list.length > 1) {
        list.pop();
        json = JSON.stringify(list);
      }
      if (json.length <= HISTORY_MAX_JSON) store.setItem(HISTORY_KEY, json);
    } catch (_) { /* dolu/kapalı depolama sohbeti bozmaz */ }
  }
  function restoreConversations() {
    const store = historyStore();
    if (!store) return false;
    try {
      const parsed = JSON.parse(store.getItem(HISTORY_KEY) || '[]');
      if (!Array.isArray(parsed)) return false;
      const restored = parsed.slice(0, HISTORY_MAX_CONVERSATIONS).map(raw => {
        if (!raw || !Array.isArray(raw.messages)) return null;
        const messages = raw.messages.slice(-HISTORY_MAX_MESSAGES).map(message => {
          if (!message || (message.role !== 'user' && message.role !== 'ai')) return null;
          const item = { role: message.role, text: cleanHistoryText(message.text) };
          if (message.error) item.error = cleanHistoryText(message.error).slice(0, 1000);
          if (message.model) item.model = String(message.model).slice(0, 80);
          if (message.role === 'user') {
            item.contextLabels = Array.isArray(message.contextLabels) ? message.contextLabels.slice(0, 12).map(String) : [];
            item.fileNames = Array.isArray(message.fileNames) ? message.fileNames.slice(0, 12).map(String) : [];
            item.output = message.output && typeof message.output === 'object' ? message.output : null;
            item.attachments = [];
            item.contexts = [];
          }
          if (message.file && message.file.id && message.file.fileName) item.file = historyFile(message.file);
          return item;
        }).filter(Boolean);
        if (!messages.length) return null;
        return {
          id: String(raw.id || `c${Date.now().toString(36)}${(++seq).toString(36)}`).slice(0, 80),
          chatId: raw.chatId == null ? null : String(raw.chatId).slice(0, 180),
          title: String(raw.title || '').slice(0, 120),
          messages,
        };
      }).filter(Boolean);
      if (!restored.length) return false;
      state.conversations = restored;
      state.activeId = restored[0].id;
      return true;
    } catch (_) { return false; }
  }

  /* ---------------- Otomatik bağlam ----------------
     Kullanıcı "Backlog'da…", "CP'deki…", "bu ekranda…" dediğinde ve elle
     bağlam eklemediyse ilgili ekranın verisi otomatik eklenir. Konu
     kartları ve otomatik seçim aynı ekran listesini kullanır. */
  const SCREEN_HINTS = [
    ['backlog', /\bbacklog/i],
    ['cp', /\bcp\b|cp[- ]?tracker|cp takip/i], // i18n-ignore
    ['orders', /sipari[şs]ler|sipari[şs] (listesi|ekran|tablo)|\borders? (screen|table|tab|list)|\borders ekran/i], // i18n-ignore
    ['shipping', /nakliye|navlun|shipping|freight/i], // i18n-ignore
    ['koleksiyon', /koleksiyon|\bcollection/i], // i18n-ignore
    ['overview', /\boverview|genel bak[ıi][şs]/i], // i18n-ignore
  ];
  const THIS_SCREEN = /bu ekran|bu tablo|bu sayfa|this screen|this table|this page/i; // i18n-ignore
  function detectScreens(text) {
    const value = String(text || '');
    const screens = SCREEN_HINTS.filter(([, re]) => re.test(value)).map(([screen]) => screen);
    if (!screens.length && THIS_SCREEN.test(value) && window.BLAIScreenData) screens.push(window.BLAIScreenData.lastTab());
    return [...new Set(screens)].slice(0, 2);
  }
  /* Ekran → varsayılan bağlam seçeneği: seçili kayıt varsa onlar, yoksa
     görünen/tüm kayıtlar (yalnız-filtre seçeneği otomatik seçilmez). */
  function defaultContextFor(screen, groups) {
    const group = groups.find(item => item.screen === screen);
    if (!group) return null;
    // Varsayılan: sayfa filtrelerinden bağımsız tüm kayıtlar.
    const option = group.options.find(item => /:all$/.test(item.id)) || group.options.find(item => !/:filters$/.test(item.id));
    return option ? { id: option.id, label: `${group.label} — ${option.label}` } : null;
  }
  function autoContextsFor(text) {
    const api = AI();
    if (!api || !state.autoContext) return [];
    const groups = api.getAvailableContext({});
    return detectScreens(text).map(screen => defaultContextFor(screen, groups)).filter(Boolean);
  }
  const TOPIC_PROMPTS = {
    backlog: () => [L('Backlog’daki gecikmeleri analiz et ve en riskli 10 siparişi tablo hâlinde göster.', 'Analyse the delays in the Backlog and show the 10 riskiest orders as a table.'), L('Backlog’u tedarikçiye göre özetle; geç kalanları vurgula.', 'Summarise the Backlog by supplier and highlight late orders.')],
    cp: () => [L('CP Tracker’da önceliği yüksek ama gecikmeli modelleri listele.', 'List high-priority but delayed models in the CP Tracker.'), L('CP Tracker verisinden yönetici özeti hazırla.', 'Prepare an executive summary from the CP Tracker data.')],
    orders: () => [L('Siparişlerde termin riski taşıyanları ülke bazında özetle.', 'Summarise orders at delivery risk by country.'), L('Siparişleri lisansa göre grupla ve toplam adetleri ver.', 'Group the orders by license and give the total quantities.')],
    shipping: () => [L('Nakliye kıyaslamasında en maliyetli rotaları göster.', 'Show the most expensive routes in the shipping comparison.')],
    koleksiyon: () => [L('Koleksiyonda fiyat hedefini tutturamayan modelleri listele.', 'List the collection models that miss their price target.')],
    overview: () => [L('Overview’daki CP kümesinden durum özeti çıkar.', 'Give a status summary of the Overview CP set.')],
  };
  let activeTopic = '';
  const OUTPUT_FORMATS = () => [
    { key: '', label: L('Sohbet', 'Chat') },
    { key: 'pdf', label: 'PDF' },
    { key: 'pptx', label: 'PowerPoint' },
    { key: 'xlsx', label: 'Excel' },
    { key: 'html', label: 'HTML' },
  ];
  const formatLabel = key => (OUTPUT_FORMATS().find(item => item.key === key) || { label: key }).label;
  let seq = 0;
  const newConversation = () => { const conv = { id: `c${Date.now().toString(36)}${(++seq).toString(36)}`, chatId: null, title: '', messages: [] }; state.conversations.unshift(conv); state.activeId = conv.id; return conv; };
  const activeConversation = () => state.conversations.find(item => item.id === state.activeId) || newConversation();
  const host = () => document.getElementById('lcwaiChatPage');
  const $ = selector => host() && host().querySelector(selector);
  const md = text => (window.BLMarkdown ? window.BLMarkdown.render(text, { copyLabel: L('Kopyala', 'Copy') }) : `<p>${esc(text)}</p>`);
  const formatBytes = bytes => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

  const EXAMPLES = () => [
    L('Backlog’daki gecikmeleri analiz et ve en riskli 10 siparişi tablo hâlinde göster.', 'Analyse the delays in the Backlog and show the 10 riskiest orders as a table.'),
    L('Bu verilerden yönetici özeti hazırla.', 'Prepare an executive summary from this data.'),
    L('Bu maili daha profesyonel yaz.', 'Rewrite this e-mail more professionally.'),
    L('Bu iki dosyayı karşılaştır ve farkları listele.', 'Compare these two files and list the differences.'),
  ];

  /* ---------------- Çizim ---------------- */
  function render() {
    const el = host();
    if (!el) return;
    el.innerHTML = `<div class="lcwaiChat">
        <aside class="lcwaiChatSide" aria-label="${esc(L('Sohbetler', 'Conversations'))}">
          <button type="button" class="lcwaiBtn is-primary lcwaiNewChat" data-chat-new>＋ ${esc(L('Yeni Sohbet', 'New Chat'))}</button>
          <div class="lcwaiChatList" data-chat-list></div>
          <p class="lcwaiNote">${esc(L('Sohbet geçmişi bu kullanıcı için bu cihazda saklanır.', 'Chat history is kept for this user on this device.'))}</p>
        </aside>
        <div class="lcwaiChatMain">
          <header class="lcwaiChatHead"><div><b>LCW AI</b> <small class="lcwaiModel" data-chat-model>${esc(AI() ? AI().modelLabel : 'GPT-6 Sol')}</small></div><div class="lcwaiChatHeadActions"><button type="button" class="lcwaiBtn lcwaiLayoutControlBtn" data-layout-control>✓ ${esc(L('Layout Kontrol', 'Layout Control'))}</button><div class="lcwaiChatConn" data-chat-conn></div></div></header>
          <div class="lcwaiChatMessages" data-chat-messages role="log" aria-live="polite"></div>
          <form class="lcwaiComposer" data-chat-form>
            <div class="lcwaiOutputBar" data-chat-output>
              <span class="lcwaiOutputLabel">${esc(L('Yanıt biçimi', 'Answer as'))}</span>
              <div class="lcwaiSeg" role="radiogroup" aria-label="${esc(L('Yanıt biçimi', 'Answer as'))}">${OUTPUT_FORMATS().map(item => `<button type="button" role="radio" data-output-format="${esc(item.key)}">${esc(item.label)}</button>`).join('')}</div>
              <span class="lcwaiOutputOptions" data-output-options hidden>
                <select data-output-orientation aria-label="${esc(L('Sayfa yönü', 'Page orientation'))}"><option value="portrait">${esc(L('Dikey', 'Portrait'))}</option><option value="landscape">${esc(L('Yatay', 'Landscape'))}</option></select>
                <select data-output-detail aria-label="${esc(L('Detay seviyesi', 'Level of detail'))}"><option value="summary">${esc(L('Kısa', 'Brief'))}</option><option value="standard">${esc(L('Standart', 'Standard'))}</option><option value="detailed">${esc(L('Detaylı', 'Detailed'))}</option></select>
              </span>
            </div>
            <div class="lcwaiChips" data-chat-chips></div>
            <textarea data-chat-input rows="3" placeholder="${esc(L('Mesajınızı yazın… (Enter gönderir, Shift+Enter yeni satır)', 'Type your message… (Enter sends, Shift+Enter new line)'))}"></textarea>
            <div class="lcwaiComposerRow">
              <button type="button" class="lcwaiBtn" data-chat-file>＋ ${esc(L('Dosya Ekle', 'Add File'))}</button>
              <div class="lcwaiContextWrap"><button type="button" class="lcwaiBtn" data-chat-context aria-haspopup="menu">${esc(L('Bağlam Ekle', 'Add Context'))} ▾</button><div class="lcwaiContextMenu" data-chat-context-menu role="menu" hidden></div></div>
              <label class="lcwaiAuto" title="${esc(L('Mesajda ekran adı geçerse (Backlog, CP, Siparişler…) o ekranın verisi otomatik eklenir.', 'If your message names a screen (Backlog, CP, Orders…) that screen’s data is added automatically.'))}"><input type="checkbox" data-chat-auto${state.autoContext ? ' checked' : ''}> ${esc(L('Otomatik bağlam', 'Auto context'))}</label>
              <span class="lcwaiNote" data-chat-limits></span>
              <span style="flex:1"></span>
              <button type="button" class="lcwaiBtn" data-chat-cancel hidden>${esc(L('İptal', 'Cancel'))}</button>
              <button type="submit" class="lcwaiBtn is-primary" data-chat-send>${esc(L('Gönder', 'Send'))}</button>
            </div>
            <input type="file" data-chat-file-input multiple hidden>
          </form>
        </div>
      </div>`;
    bind();
    renderList(); renderMessages(); renderChips(); renderLimits(); renderConnection(); renderOutputBar();
  }

  /* Yanıt biçimi seçici: Sohbet ya da dosya (PDF/PowerPoint/Excel/HTML). */
  function renderOutputBar() {
    const bar = $('[data-chat-output]');
    if (!bar) return;
    const format = state.output.format;
    bar.querySelectorAll('[data-output-format]').forEach(button => {
      const active = button.dataset.outputFormat === format;
      button.setAttribute('aria-checked', active ? 'true' : 'false');
      button.classList.toggle('is-active', active);
    });
    const options = bar.querySelector('[data-output-options]');
    const orientation = bar.querySelector('[data-output-orientation]');
    const detail = bar.querySelector('[data-output-detail]');
    if (options) options.hidden = !format;
    if (orientation) { orientation.hidden = !(format === 'pdf' || format === 'html'); orientation.value = state.output.orientation; }
    if (detail) { detail.hidden = format === 'xlsx'; detail.value = state.output.detail; }
    const input = $('[data-chat-input]');
    if (input) {
      input.placeholder = format
        ? L(`${formatLabel(format)} dosyasında ne olmasını istediğinizi yazın… (Buyer Log dosyayı LCW AI içeriğiyle oluşturur)`, `Describe what the ${formatLabel(format)} file should contain… (Buyer Log builds the file from LCW AI content)`)
        : L('Mesajınızı yazın… (Enter gönderir, Shift+Enter yeni satır)', 'Type your message… (Enter sends, Shift+Enter new line)');
    }
    const sendButton = $('[data-chat-send]');
    if (sendButton) sendButton.textContent = format ? L(`${formatLabel(format)} Oluştur`, `Create ${formatLabel(format)}`) : L('Gönder', 'Send');
  }

  const formatBytesSafe = bytes => (Number(bytes) > 0 ? formatBytes(Number(bytes)) : '');
  function fileCardHtml(file) {
    const format = String(file.format || '').toLowerCase();
    const details = [file.templateLabel, formatBytesSafe(file.bytes), file.attempts > 1 ? L(`${file.attempts - 1} otomatik düzeltme`, `${file.attempts - 1} automatic repair(s)`) : ''].filter(Boolean).join(' · ');
    const fallback = file.fallback === 'html'
      ? `<p class="lcwaiNote">${esc(L('PDF basımı bu ortamda yapılamadı; rapor HTML olarak kaydedildi. Açıp Yazdır → PDF olarak kaydet ile PDF alabilirsiniz.', 'PDF printing is not available here; the report was saved as HTML. Open it and use Print → Save as PDF.'))}</p>`
      : '';
    return `<div class="lcwaiFile" data-file-card="${esc(file.id)}"><span class="lcwaiFileIcon is-${esc(format)}">${esc(format === 'pptx' ? 'PPT' : format.toUpperCase())}</span><div class="lcwaiFileInfo"><b title="${esc(file.path || file.fileName)}">${esc(file.fileName)}</b><small>${esc(details)}</small></div><div class="lcwaiFileActions"><button type="button" class="lcwaiBtn is-primary" data-file-open="${esc(file.id)}">${esc(L('Aç', 'Open'))}</button><button type="button" class="lcwaiBtn" data-file-reveal="${esc(file.id)}">${esc(L('Klasörde Göster', 'Show in folder'))}</button></div></div>${fallback}`;
  }

  /* Çıktının kullandığı model görsellerini yerel depodan çözer ve küçültür
     (JPEG, en uzun kenar 640 px): { anahtar: dataURL }. Bulunamayan görsel
     dosyayı durdurmaz; sunucu yerine "görsel yok" kutusu koyar. */
  async function shrinkImage(dataUrl) {
    try {
      const bitmap = new Image();
      bitmap.src = dataUrl;
      await bitmap.decode();
      const scale = Math.min(1, 640 / Math.max(bitmap.naturalWidth || 1, bitmap.naturalHeight || 1));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(bitmap.naturalHeight * scale));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/jpeg', 0.84);
    } catch (_) { return ''; }
  }
  async function resolveImages(conv, tokens, answer) {
    const map = conv.imageMap || {};
    const screenData = window.BLAIScreenData;
    const list = (tokens || []).filter(token => map[token]);
    const images = {};
    let done = 0;
    const paint = () => { answer.phase = L(`Model görselleri Buyer Log’dan ekleniyor (${done}/${list.length})…`, `Adding model images from Buyer Log (${done}/${list.length})…`); if (state.activeId === conv.id) renderMessages(); };
    paint();
    let cursor = 0;
    const worker = async () => {
      while (cursor < list.length) {
        const token = list[cursor++];
        try {
          const raw = screenData && typeof screenData.imageDataUrl === 'function' ? await screenData.imageDataUrl(map[token]) : '';
          const small = raw ? await shrinkImage(raw) : '';
          if (small) images[token] = small;
        } catch (_) { /* eksik görsel → "görsel yok" */ }
        done++;
        paint();
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    return images;
  }

  /* Kullanıcı başka ekrandaysa (iş arka planda bitti) ortak "Dosya
     oluşturuldu" bildirimi gösterilir; sohbet açıkken kart yeterlidir. */
  function notifyFile(file, conv) {
    const visible = document.body && document.body.dataset.activeTab === 'lcwai' && state.activeId === conv.id && !document.hidden;
    if (visible || typeof window.notifyFileReady !== 'function') return;
    const api = AI();
    window.notifyFileReady({ filename: file.fileName, path: file.path || '', mode: 'created', onOpen: () => api.openOutput(file.id, file.fileName), onReveal: () => api.revealOutput(file.id, file.fileName) });
  }

  function outputPhase(event, output) {
    const name = formatLabel(output.format);
    if (event.step === 'generating') return L(`LCW AI ${name} içeriğini hazırlıyor${event.templateLabel ? ` · ${event.templateLabel}` : ''}…`, `LCW AI is preparing the ${name} content${event.templateLabel ? ` · ${event.templateLabel}` : ''}…`);
    if (event.step === 'repairing') return L(`LCW AI çıktısı Buyer Log biçimine uymadı; düzeltme isteniyor (${event.attempt}/2)…`, `The LCW AI output did not match the Buyer Log format; asking for a fix (${event.attempt}/2)…`);
    if (event.step === 'rendering') return L(`Buyer Log ${name} dosyasını oluşturuyor…`, `Buyer Log is building the ${name} file…`);
    if (event.step === 'pdf') return L('PDF basılıyor…', 'Printing the PDF…');
    return '';
  }

  function renderList() {
    const list = $('[data-chat-list]');
    if (!list) return;
    list.innerHTML = state.conversations.filter(conv => conv.messages.length).map(conv => `<button type="button" class="lcwaiChatItem${conv.id === state.activeId ? ' is-active' : ''}" data-chat-open="${esc(conv.id)}" title="${esc(conv.title)}">${esc(conv.title || L('Yeni sohbet', 'New chat'))}</button>`).join('')
      || `<p class="lcwaiNote">${esc(L('Henüz sohbet yok.', 'No chats yet.'))}</p>`;
  }

  function messageHtml(message, index, conv) {
    if (message.role === 'user') {
      const meta = [...(message.contextLabels || []).map(label => `◆ ${label}`), ...(message.fileNames || []).map(name => `📎 ${name}`), ...(message.output && message.output.format ? [`⇩ ${formatLabel(message.output.format)}`] : [])];
      return `<div class="lcwaiMsg is-user"><div class="lcwaiMsgBody">${esc(message.text).replace(/\n/g, '<br>')}</div>${meta.length ? `<div class="lcwaiMsgMeta">${meta.map(esc).join(' · ')}</div>` : ''}</div>`;
    }
    const last = index === conv.messages.length - 1;
    const body = message.error
      ? `<div class="lcwaiMsgError">${esc(message.error)}${message.login ? ` <button type="button" class="lcwaiBtn is-link" data-chat-login>${esc(L('LCW AI Girişi Yap', 'Sign in to LCW AI'))}</button>` : ''}</div>`
      : message.file ? `${message.text ? md(message.text) : ''}${fileCardHtml(message.file)}`
        : (message.text ? md(message.text) : `<p class="lcwaiNote">${esc(message.phase || L('LCW AI düşünüyor…', 'LCW AI is thinking…'))}</p>`);
    const actions = message.streaming ? '' : `<div class="lcwaiMsgActions">${message.text ? `<button type="button" class="lcwaiBtn is-link" data-msg-copy="${index}">${esc(L('Kopyala', 'Copy'))}</button><button type="button" class="lcwaiBtn is-link" data-msg-reuse="${index}">${esc(L('Yeni mesajda kullan', 'Use in new message'))}</button>` : ''}${last ? `<button type="button" class="lcwaiBtn is-link" data-msg-retry>${esc(message.error ? L('Tekrar Dene', 'Try Again') : L('Yeniden üret', 'Regenerate'))}</button>` : ''}</div>`;
    return `<div class="lcwaiMsg is-ai${message.streaming ? ' is-streaming' : ''}"><div class="lcwaiMsgWho">LCW AI${message.model ? ` · ${esc(message.model)}` : ''}</div><div class="lcwaiMsgBody lcwaiMd">${body}</div>${actions}</div>`;
  }

  function renderMessages() {
    const box = $('[data-chat-messages]');
    if (!box) return;
    const conv = activeConversation();
    if (!conv.messages.length) {
      box.innerHTML = emptyStateHtml();
      return;
    }
    box.innerHTML = conv.messages.map((message, index) => messageHtml(message, index, conv)).join('');
    box.scrollTop = box.scrollHeight;
  }

  /* Boş ekran: önce giriş, sonra "ne hakkında konuşalım?" konu seçimi. */
  function emptyStateHtml() {
    const status = state.status;
    if (!status || !status.connected) {
      const checking = !status;
      const waiting = status && status.loginInProgress;
      return `<div class="lcwaiChatEmpty lcwaiOnboard"><span class="lcwaiStep">1</span><b>${esc(L('Önce LCW AI’a giriş yapın', 'First, sign in to LCW AI'))}</b><p>${esc(checking ? L('LCW AI oturumu kontrol ediliyor…', 'Checking the LCW AI session…') : waiting ? L('Giriş bekleniyor… Açılan LCW AI penceresinde kurumsal hesabınızla giriş yapın.', 'Waiting for sign-in… Sign in with your corporate account in the LCW AI window.') : L('Kurumsal hesabınızla bir kez giriş yapın; sonrasında Buyer Log oturumu arka planda kendisi yeniler. Buyer Log parolanızı görmez.', 'Sign in once with your corporate account; after that Buyer Log renews the session in the background. Buyer Log never sees your password.'))}</p>${checking || waiting ? '' : `<div><button type="button" class="lcwaiBtn is-primary" data-chat-login>${esc(L('LCW AI Girişi Yap', 'Sign in to LCW AI'))}</button></div>`}</div>`;
    }
    const api = AI();
    const groups = api ? api.getAvailableContext({ preferScreen: window.BLAIScreenData ? window.BLAIScreenData.lastTab() : '' }) : [];
    const topics = groups.map(group => `<button type="button" class="lcwaiTopic${activeTopic === group.screen ? ' is-active' : ''}" data-chat-topic="${esc(group.screen)}"><b>${esc(group.label)}</b><small>${esc(group.options.filter(option => !/:filters$/.test(option.id)).map(option => option.label).join(' · '))}</small></button>`);
    topics.push(`<button type="button" class="lcwaiTopic${activeTopic === 'general' ? ' is-active' : ''}" data-chat-topic="general"><b>${esc(L('Genel soru', 'General question'))}</b><small>${esc(L('Buyer Log verisi eklemeden', 'Without Buyer Log data'))}</small></button>`);
    const prompts = activeTopic && TOPIC_PROMPTS[activeTopic] ? TOPIC_PROMPTS[activeTopic]() : activeTopic === 'general' ? EXAMPLES().slice(1) : [];
    return `<div class="lcwaiChatEmpty lcwaiOnboard"><span class="lcwaiStep">2</span><b>${esc(L('Ne hakkında konuşalım?', 'What shall we talk about?'))}</b><p>${esc(L('Bir ekran seçin; o ekranın verisi sohbete eklenir. Ya da doğrudan yazın: mesajda ekran adı geçerse (ör. “Backlog’da…”, “CP’deki…”, “bu ekranda…”) Buyer Log ilgili veriyi otomatik ekler.', 'Pick a screen and its data is added to the chat. Or just type: if your message names a screen (e.g. “in the Backlog…”, “in CP…”, “on this screen…”) Buyer Log adds that data automatically.'))}</p><div class="lcwaiTopics">${topics.join('')}</div>${prompts.length ? `<div class="lcwaiExamples">${prompts.map(text => `<button type="button" class="lcwaiBtn" data-chat-example="${esc(text)}">${esc(text)}</button>`).join('')}</div>` : ''}${groups.length ? '' : `<p class="lcwaiNote">${esc(L('Henüz paylaşılabilir ekran verisi yok; CP, Siparişler gibi ekranlar yüklendiğinde burada görünür.', 'No screen data to share yet; screens such as CP or Orders appear here once loaded.'))}</p>`}</div>`;
  }

  function renderChips() {
    const box = $('[data-chat-chips]');
    if (!box) return;
    const files = state.files.map((item, index) => `<span class="lcwaiChip${item.error ? ' is-error' : ''}">📎 ${esc(item.file.name)} <small>${esc(formatBytes(item.file.size))}${item.error ? ` · ${esc(item.error)}` : ''}</small><button type="button" data-chip-file="${index}" aria-label="${esc(L('Kaldır', 'Remove'))}">×</button></span>`);
    const contexts = state.contexts.map((item, index) => `<span class="lcwaiChip is-context">◆ ${esc(item.label)}<button type="button" data-chip-context="${index}" aria-label="${esc(L('Kaldır', 'Remove'))}">×</button></span>`);
    box.innerHTML = [...contexts, ...files].join('');
    box.hidden = !files.length && !contexts.length;
  }

  function addFiles(files) {
    const limits = state.config && state.config.limits || { maxFilesPerRequest: 5, maxFileBytes: 20 * 1048576 };
    for (const file of Array.from(files || [])) {
      if (!file || typeof file.name !== 'string') continue;
      if (state.files.length >= limits.maxFilesPerRequest) {
        if (typeof showToast === 'function') showToast(L(`En fazla ${limits.maxFilesPerRequest} dosya eklenebilir.`, `Up to ${limits.maxFilesPerRequest} files can be added.`));
        break;
      }
      state.files.push({ file, error: file.size > limits.maxFileBytes ? L('çok büyük', 'too large') : '' });
    }
    renderChips();
  }

  function renderLimits() {
    const box = $('[data-chat-limits]');
    const input = $('[data-chat-file-input]');
    const config = state.config;
    if (!box || !config || !config.limits) return;
    box.textContent = L(`En fazla ${config.limits.maxFilesPerRequest} dosya · dosya başına ${formatBytes(config.limits.maxFileBytes)}`, `Up to ${config.limits.maxFilesPerRequest} files · ${formatBytes(config.limits.maxFileBytes)} per file`);
    if (input && Array.isArray(config.allowedUploadTypes)) input.accept = config.allowedUploadTypes.join(',');
  }

  function renderConnection() {
    const box = $('[data-chat-conn]');
    if (!box) return;
    if (!activeConversation().messages.length) renderMessages();
    const status = state.status;
    const model = $('[data-chat-model]');
    if (model && AI()) model.textContent = AI().modelLabel;
    if (status && status.connected) {
      const background = status.source === 'desktop-sso';
      box.innerHTML = `<span class="lcwaiConnPill is-ok" title="${esc(background ? L('LCW AI, PLM gibi arka planda gizli bir oturumla bağlı; tarayıcı açılmaz.', 'LCW AI is connected through a hidden background session, like PLM; no browser opens.') : '')}">${esc(background ? L('✓ LCW AI Bağlı · arka plan', '✓ LCW AI Connected · background') : L('✓ LCW AI Bağlı', '✓ LCW AI Connected'))}</span>`;
      return;
    }
    const text = !status ? L('Kontrol ediliyor…', 'Checking…')
      : status.loginInProgress ? L('Giriş bekleniyor…', 'Waiting for sign-in…')
        : status.state === 'expired' ? L('LCW AI oturumu yenilenmeli.', 'The LCW AI session needs renewal.')
          : L('LCW AI oturumu hazır değil.', 'The LCW AI session is not ready.');
    box.innerHTML = `<span class="lcwaiConnPill is-warn">${esc(text)}</span>${status && !status.loginInProgress ? ` <button type="button" class="lcwaiBtn is-link" data-chat-login>${esc(L('LCW AI Girişi Yap', 'Sign in to LCW AI'))}</button>` : ''}`;
  }

  function setBusy(busy) {
    state.busy = busy;
    const send = $('[data-chat-send]'), cancel = $('[data-chat-cancel]');
    if (send) send.disabled = busy;
    if (cancel) cancel.hidden = !busy;
  }

  /* ---------------- Bağlam menüsü ---------------- */
  function openContextMenu() {
    const menu = $('[data-chat-context-menu]');
    const api = AI();
    if (!menu || !api) return;
    const lastTab = window.BLAIScreenData ? window.BLAIScreenData.lastTab() : '';
    const groups = api.getAvailableContext({ preferScreen: lastTab });
    menu.innerHTML = groups.length
      ? groups.map(group => `<div class="lcwaiContextGroup"><b>${esc(group.label)}${group.screen === lastTab ? ` <small>${esc(L('· son ekran', '· last screen'))}</small>` : ''}</b>${group.options.map(option => `<button type="button" role="menuitem" data-context-add="${esc(option.id)}" data-context-label="${esc(`${group.label} — ${option.label}`)}"><span>${esc(option.label)}</span>${option.detail ? `<small>${esc(option.detail)}</small>` : ''}</button>`).join('')}</div>`).join('')
      : `<p class="lcwaiNote">${esc(L('Eklenebilecek Buyer Log verisi yok. Önce CP, Siparişler, Backlog gibi bir ekranda veriyi açın.', 'No Buyer Log data to add. First open data on a screen such as CP, Orders or Backlog.'))}</p>`;
    menu.hidden = false;
  }
  function closeContextMenu() { const menu = $('[data-chat-context-menu]'); if (menu) menu.hidden = true; }

  /* ---------------- Gönderme ---------------- */
  async function send(text, { reuse = null } = {}) {
    const api = AI();
    if (!api || state.busy) return;
    const conv = activeConversation();
    const message = String(text || '').trim();
    const files = reuse ? [] : state.files.filter(item => !item.error).map(item => item.file);
    // Elle bağlam eklenmediyse mesajdaki ekran adına göre otomatik bağlam.
    const auto = reuse || state.contexts.length ? [] : autoContextsFor(text);
    const contextIds = reuse ? [] : [...state.contexts.map(item => item.id), ...auto.map(item => item.id)];
    if (!message && !files.length && !reuse) return;
    const userMessage = reuse || { role: 'user', text: message, contextLabels: [...state.contexts.map(item => item.label), ...auto.map(item => `${item.label} · ${L('otomatik', 'automatic')}`)], fileNames: files.map(file => file.name), contexts: null, attachments: null, output: state.output.format ? { ...state.output } : null };
    const output = userMessage.output || null;
    if (!reuse) conv.messages.push(userMessage);
    if (!conv.title) conv.title = (message || files.map(file => file.name).join(', ')).slice(0, 60);
    const answer = { role: 'ai', text: '', streaming: true, phase: '' };
    conv.messages.push(answer);
    if (!reuse) { state.files = []; state.contexts = []; const input = $('[data-chat-input]'); if (input) input.value = ''; }
    renderChips(); renderList(); renderMessages(); setBusy(true);
    // Kullanıcı mesajını hemen kaydet; uygulama cevap beklerken kapanırsa istem
    // geçmişten kaybolmasın. Streaming AI placeholder geçmişe yazılmaz.
    persistConversations();
    state.requestId = `bl${Date.now().toString(36)}${(++seq).toString(36)}`;
    try {
      if (!userMessage.attachments) {
        userMessage.attachments = [];
        for (let index = 0; index < files.length; index++) {
          answer.phase = L(`Dosya yükleniyor (${index + 1}/${files.length}): ${files[index].name}`, `Uploading file (${index + 1}/${files.length}): ${files[index].name}`);
          renderMessages();
          userMessage.attachments.push(await api.uploadFile(files[index]));
        }
      }
      if (!userMessage.contexts) {
        userMessage.contexts = [];
        for (const id of contextIds) {
          answer.phase = L('Buyer Log bağlamı hazırlanıyor…', 'Preparing Buyer Log context…');
          renderMessages();
          const prepared = contextAsFile(await api.buildContext(id));
          if (prepared.images) conv.imageMap = { ...(conv.imageMap || {}), ...prepared.images };
          else if (prepared.context && prepared.context.images) { conv.imageMap = { ...(conv.imageMap || {}), ...prepared.context.images }; delete prepared.context.images; }
          if (prepared.file) {
            const limit = state.config && state.config.limits ? state.config.limits.maxFileBytes : 20 * 1048576;
            if (prepared.file.size > limit) throw Object.assign(new Error('too-large'), { code: 'LCWAI_FILE_TOO_LARGE' });
            answer.phase = L(`Bağlam dosyası yükleniyor: ${prepared.file.name}`, `Uploading context file: ${prepared.file.name}`);
            renderMessages();
            userMessage.attachments.push(await api.uploadFile(prepared.file));
          }
          userMessage.contexts.push(prepared.context);
        }
      }
      answer.phase = output ? outputPhase({ step: 'generating' }, output) : L('LCW AI düşünüyor…', 'LCW AI is thinking…');
      renderMessages();
      let pendingPaint = 0;
      const paint = () => { if (!pendingPaint) pendingPaint = requestAnimationFrame(() => { pendingPaint = 0; if (state.activeId === conv.id) renderMessages(); }); };
      const result = await api.chat({
        requestId: state.requestId,
        chatId: conv.chatId,
        message: userMessage.text,
        contexts: userMessage.contexts,
        attachments: userMessage.attachments,
        output,
        resolveImages: tokens => resolveImages(conv, tokens, answer),
        onProgress: event => {
          // Dosya modunda ham HTML/JSON akışı gösterilmez; yalnız aşama ve
          // üretilen karakter sayısı görünür.
          if (output) {
            if (event.phase === 'output') answer.phase = outputPhase(event, output) || answer.phase;
            else if (event.phase === 'streaming' && event.chars) answer.phase = `${outputPhase({ step: 'generating', templateLabel: answer.templateLabel }, output)} (${L(`${event.chars} karakter`, `${event.chars} characters`)})`;
            if (event.templateLabel) answer.templateLabel = event.templateLabel;
            paint();
            return;
          }
          if (event.phase !== 'streaming' || !event.delta) return;
          answer.text += event.delta;
          paint();
        },
      });
      conv.chatId = result.chatId || conv.chatId;
      if (output) {
        if (!result.output || !result.output.id) throw Object.assign(new Error('no-output'), { code: 'LCWAI_OUTPUT_RENDER_FAILED' });
        answer.text = String(result.text || '').trim();
        answer.file = result.output;
        notifyFile(result.output, conv);
      } else {
        if (!String(result.text || '').trim()) throw Object.assign(new Error('empty'), { code: 'LCWAI_INVALID_RESPONSE' });
        answer.text = result.text;
      }
      answer.model = result.model && result.model.label;
    } catch (error) {
      answer.error = api.errorText(error);
      answer.login = api.needsLogin(error);
      if (error && error.code === 'LCWAI_CANCELLED') answer.error = L('İstek iptal edildi.', 'The request was cancelled.');
      if (error && error.code === 'LCWAI_QUOTA_EXCEEDED' && error.remoteMessage) answer.error += ` (${error.remoteMessage})`;
    } finally {
      answer.streaming = false;
      setBusy(false);
      persistConversations();
      if (state.activeId === conv.id) renderMessages();
      renderList();
    }
  }

  function retryLast() {
    const conv = activeConversation();
    const lastUser = [...conv.messages].reverse().find(item => item.role === 'user');
    if (!lastUser || state.busy) return;
    const last = conv.messages[conv.messages.length - 1];
    // Boş ya da hatalı cevap yeniden denemede kaldırılır; ekranda yığılmaz.
    if (last && last.role === 'ai' && (last.error || !last.text)) conv.messages.pop();
    send(lastUser.text, { reuse: lastUser });
  }

  async function copyText(text, button) {
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch (_) { ok = false; }
    if (button) { const original = button.textContent; button.textContent = ok ? L('Kopyalandı ✓', 'Copied ✓') : L('Kopyalanamadı', 'Copy failed'); setTimeout(() => { button.textContent = original; }, 1500); }
  }

  /* ---------------- Olaylar ---------------- */
  function onHostClick(event) {
    const el = host();
    if (!el) return;
    // Öğeler her çizimde yenilenir; güncel olanlar her tıklamada okunur.
    const input = $('[data-chat-input]');
    const fileInput = $('[data-chat-file-input]');
    const target = event.target.closest('button');
    if (!target || !el.contains(target)) { if (!event.target.closest('.lcwaiContextWrap')) closeContextMenu(); return; }
    if (target.matches('[data-layout-control]')) { window.BLLayoutControl?.open?.(); return; }
    if (target.matches('[data-chat-new]')) { if (!state.busy) { newConversation(); renderList(); renderMessages(); input.focus(); } return; }
    if (target.matches('[data-chat-open]')) { if (!state.busy) { state.activeId = target.dataset.chatOpen; renderList(); renderMessages(); } return; }
    if (target.matches('[data-chat-file]')) { fileInput.click(); return; }
    if (target.matches('[data-output-format]')) { state.output.format = target.dataset.outputFormat; renderOutputBar(); input.focus(); return; }
    if (target.matches('[data-file-open], [data-file-reveal]')) {
      const api = AI();
      const opening = target.matches('[data-file-open]');
      const id = opening ? target.dataset.fileOpen : target.dataset.fileReveal;
      const file = activeConversation().messages.map(message => message && message.file).find(item => item && String(item.id) === String(id));
      if (api) (opening ? api.openOutput(id, file && file.fileName) : api.revealOutput(id, file && file.fileName)).catch(error => { if (typeof showToast === 'function') showToast(api.errorText(error), { kind: 'error' }); });
      return;
    }
    if (target.matches('[data-chat-context]')) { const menu = $('[data-chat-context-menu]'); if (menu.hidden) openContextMenu(); else closeContextMenu(); return; }
    if (target.matches('[data-context-add]')) {
      if (!state.contexts.some(item => item.id === target.dataset.contextAdd)) state.contexts.push({ id: target.dataset.contextAdd, label: target.dataset.contextLabel });
      closeContextMenu(); renderChips(); return;
    }
    if (target.matches('[data-chip-file]')) { state.files.splice(Number(target.dataset.chipFile), 1); renderChips(); return; }
    if (target.matches('[data-chip-context]')) { state.contexts.splice(Number(target.dataset.chipContext), 1); renderChips(); return; }
    if (target.matches('[data-chat-cancel]')) { AI()?.cancel(state.requestId); return; }
    if (target.matches('[data-chat-login]')) { AI()?.connect().then(status => { state.status = status; renderConnection(); }).catch(() => {}); return; }
    if (target.matches('[data-chat-topic]')) {
      activeTopic = target.dataset.chatTopic;
      if (activeTopic !== 'general') {
        const api = AI();
        const choice = api ? defaultContextFor(activeTopic, api.getAvailableContext({})) : null;
        if (choice && !state.contexts.some(item => item.id === choice.id)) state.contexts.push(choice);
        renderChips();
      }
      renderMessages();
      input.focus();
      return;
    }
    if (target.matches('[data-chat-example]')) { input.value = target.dataset.chatExample; input.focus(); return; }
    if (target.matches('[data-msg-copy]')) { const message = activeConversation().messages[Number(target.dataset.msgCopy)]; if (message) copyText(message.text, target); return; }
    if (target.matches('[data-msg-reuse]')) { const message = activeConversation().messages[Number(target.dataset.msgReuse)]; if (message) { input.value = `${input.value ? `${input.value}\n\n` : ''}${message.text}`; input.focus(); } return; }
    if (target.matches('[data-msg-retry]')) { retryLast(); return; }
    if (target.matches('[data-lcwai-code-copy]')) { const code = target.closest('.lcwaiCode')?.querySelector('code'); if (code) copyText(code.textContent, target); }
  }

  function bind() {
    const el = host();
    const form = $('[data-chat-form]');
    const input = $('[data-chat-input]');
    const fileInput = $('[data-chat-file-input]');
    form.addEventListener('submit', event => { event.preventDefault(); send(input.value); });
    $('[data-output-orientation]').addEventListener('change', event => { state.output.orientation = event.target.value === 'landscape' ? 'landscape' : 'portrait'; });
    $('[data-output-detail]').addEventListener('change', event => { state.output.detail = event.target.value; });
    $('[data-chat-auto]').addEventListener('change', event => {
      state.autoContext = Boolean(event.target.checked);
    });
    input.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); send(input.value); } });
    fileInput.addEventListener('change', () => {
      addFiles(fileInput.files);
      fileInput.value = '';
    });
    // Kapsayıcı (lcwaiChatPage) yeniden çizimlerde kalıcıdır; tıklama
    // dinleyicisi YALNIZ bir kez eklenir. Aksi hâlde sayfaya her girişte
    // çoğalır: "Bağlam Ekle" menüyü aynı tıklamada açıp kapatır, ek/kart
    // silme iki kez çalışır.
    if (!el.__lcwaiClickBound) {
      el.__lcwaiClickBound = true;
      el.addEventListener('click', onHostClick);
    }
    // İşletim sisteminden / Explorer'dan dosyayı doğrudan LCW AI alanına
    // sürükleyip bırakma. Metin/link sürüklemeleri yakalanmaz.
    if (!el.__lcwaiDropBound) {
      el.__lcwaiDropBound = true;
      const hasFiles = event => Array.from(event.dataTransfer && event.dataTransfer.types || []).includes('Files');
      el.addEventListener('dragenter', event => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        el.classList.add('is-file-drag');
      });
      el.addEventListener('dragover', event => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
        el.classList.add('is-file-drag');
      });
      el.addEventListener('dragleave', event => {
        if (event.relatedTarget && el.contains(event.relatedTarget)) return;
        el.classList.remove('is-file-drag');
      });
      el.addEventListener('drop', event => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        el.classList.remove('is-file-drag');
        addFiles(event.dataTransfer && event.dataTransfer.files);
        const currentInput = $('[data-chat-input]');
        currentInput?.focus();
      });
    }
  }

  function applyPendingOpen() {
    const pending = window.BL_LCWAI_PENDING_OPEN;
    if (!pending) return;
    window.BL_LCWAI_PENDING_OPEN = null;
    const api = AI();
    for (const id of pending.contexts || []) {
      const group = api ? api.getAvailableContext({}).flatMap(item => item.options.map(option => ({ ...option, groupLabel: item.label }))).find(option => option.id === id) : null;
      if (group && !state.contexts.some(item => item.id === id)) state.contexts.push({ id, label: `${group.groupLabel} — ${group.label}` });
    }
    renderChips();
    const input = $('[data-chat-input]');
    if (input && pending.prompt) input.value = pending.prompt;
    input?.focus();
  }

  async function initLcwAiChat() {
    const api = AI();
    if (!host()) return;
    if (!state.mounted) {
      state.mounted = true;
      registerDefaultProviders();
      if (api) {
        api.onStatus(status => { state.status = status; renderConnection(); });
        api.loadConfig().then(config => { state.config = config; renderLimits(); }).catch(() => {});
      }
      if (!restoreConversations()) newConversation();
      window.addEventListener('buyerlog:lcwai-open', () => { if (state.mounted) applyPendingOpen(); });
    }
    render();
    applyPendingOpen();
    if (api) api.getStatus().then(status => { state.status = status; renderConnection(); }).catch(() => { state.status = { state: 'disconnected' }; renderConnection(); });
  }

  window.initLcwAiChat = initLcwAiChat;
  window.BLLcwAiChat = { init: initLcwAiChat, _state: state, send, tableContext, contextCsv, contextAsFile, detectScreens, autoContextsFor, emptyStateHtml, resolveImages, addFiles, persistConversations, restoreConversations };
})();
