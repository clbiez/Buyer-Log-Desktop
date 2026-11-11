/* ===================================================================
   LCW AI — Genel çalışma alanı (sol menü › LCW AI, üst çubuk › LCW AI)

   Buyer Log'un her yerinden açılan ortak kurumsal çalışma alanı.
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
  const contextCellValue = (row, col) => cellValue(typeof col.readValue === 'function' ? col.readValue(row) : row && row[col.key]);
  /* Model görseli anahtarları: CSV'ye kısa anahtar (ör. KOL-3) yazılır;
     görsellerin kendisi bu anahtarlarla etiketli paftalar hâlinde LCW AI'a
     eklenir (uploadModelImageSheets). Çıktı anahtarı kullanırsa Buyer Log
     görseli yerel depodan alıp dosyaya gömer. */
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
  /* records: anahtar → kaynak satır ([[sütun, değer], …]). Model kartına
     kullanıcının Yerleşim'de seçtiği bilgiler buradan, birebir yazılır
     (LCW AI'ın yeniden yazdığı değer değil). Yalnız bellekte tutulur.
     full: { columns, row(index) } — kayıt satırı tablodaki gizli sütunları da
     taşır; değeri boş sütun da kalır ki Yerleşim'deki kart bilgisi seçicisi
     tüm başlıkları (ör. Target Price) sunsun. LCW AI'a giden CSV değişmez. */
  function withImageKeys(tab, rows, columns, values, full = null) {
    const screenData = window.BLAIScreenData;
    if (!screenData || typeof screenData.rowImage !== 'function' || !IMAGE_PREFIX[tab]) return { columns, values, images: null, records: null };
    const images = {};
    const records = {};
    const keys = rows.map((row, index) => {
      const identity = screenData.rowImage(tab, row);
      if (!identity) return '';
      const key = imageKeyFor(tab, identity);
      images[key] = identity;
      const labels = full ? full.columns : columns;
      const cells = full ? full.row(index) : values[index];
      records[key] = labels.map((label, c) => [label, cells[c] == null ? '' : cells[c]]);
      return key;
    });
    if (!Object.keys(images).length) return { columns, values, images: null, records: null };
    return { columns: [IMAGE_COLUMN, ...columns], values: values.map((row, index) => [keys[index], ...row]), images, records };
  }
  function tableContext(tab, mode) {
    const data = window.BLAIScreenData && window.BLAIScreenData.table(tab, { all: mode === 'all' });
    if (!data) return null;
    const columns = data.columns;
    const selected = new Set((data.selectedIds || []).map(String));
    const source = mode === 'selected' ? data.rows.filter(row => {
      const id = typeof data.rowId === 'function' ? data.rowId(row) : row && row._id;
      return id != null && selected.has(String(id));
    }) : data.rows;
    const title = window.BLAIScreenData.pageTitle(tab);
    // Kart bilgisi kaynağı: görünür sütunlarla sınırlı değil, tablonun tüm sütunları.
    const every = mode === 'filters' || mode === 'all' ? null : window.BLAIScreenData.table(tab, { all: true, columnsOnly: true });
    const recordCols = every && Array.isArray(every.columns) && every.columns.length > columns.length ? every.columns : null;
    // Değerler yalnız görseli olan (karta girecek) satır için okunur.
    const full = recordCols ? { columns: recordCols.map(col => col.label), row: index => recordCols.map(col => contextCellValue(source[index], col)) } : null;
    const keyed = mode === 'filters' ? null : withImageKeys(tab, source, columns.map(col => col.label), source.map(row => columns.map(col => contextCellValue(row, col))), full);
    return {
      images: keyed && keyed.images,
      records: keyed && keyed.records,
      label: mode === 'all' ? L(`${title} — tüm kayıtlar`, `${title} — all records`) : mode === 'selected' ? L(`${title} — seçili kayıtlar`, `${title} — selected records`) : mode === 'filters' ? L(`${title} — filtreler ve özet`, `${title} — filters and summary`) : L(`${title} — görünen kayıtlar`, `${title} — visible records`),
      screen: tab,
      summary: mode === 'all' ? L(`${source.length} kayıt (sayfa filtreleri uygulanmadan, tüm sütunlarla).`, `${source.length} records (without page filters, all columns).`) : L(`${source.length} kayıt (tablodaki filtreler uygulanmış).`, `${source.length} records (table filters applied).`),
      filters: data.filters,
      columns: keyed ? keyed.columns : [],
      rows: keyed ? keyed.values : [],
      totalRows: source.length,
    };
  }
  /* Hesaplanmış LİSTE sonucu dosyaya/sohbete bağlam olurken her satıra kaydın
     "BL Image" anahtarı eklenir ve görsel/kart haritası sohbete yazılır; böylece
     çıktı anahtarı kullanırsa Buyer Log gerçek model görselini gömer. Sohbette
     gösterilen tablo değişmez. Yalnız bağlama girecek ilk satırlar işlenir. */
  function queryImageTable(conv, dataset, computed, maxRows) {
    const screenData = window.BLAIScreenData;
    const tab = dataset && dataset.screen;
    const sources = computed && computed.kind === 'list' && Array.isArray(computed.sourceRows) ? computed.sourceRows : null;
    if (!sources || !IMAGE_PREFIX[tab] || !screenData || typeof screenData.rowImage !== 'function') return null;
    const count = Math.min(sources.length, maxRows);
    const images = {}, records = {};
    const keys = sources.slice(0, count).map(row => {
      const identity = screenData.rowImage(tab, row);
      if (!identity) return null;
      const key = imageKeyFor(tab, identity);
      images[key] = identity;
      records[key] = dataset.fields.map(field => { let value = ''; try { value = contextCellValue(row, field.col || {}); } catch (_) { value = ''; } return [field.label, value]; });
      return key;
    });
    if (!Object.keys(images).length) return null;
    conv.imageMap = { ...(conv.imageMap || {}), ...images };
    conv.recordMap = { ...(conv.recordMap || {}), ...records };
    return { ...computed, total: null, columns: [{ label: IMAGE_COLUMN, kind: 'text' }, ...computed.columns], rows: computed.rows.slice(0, count).map((row, index) => [keys[index], ...row]) };
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
  /* Tablo taşıyan bağlamı dosyaya çevirir: { context (yalnız özet), file }.
     Tamamen boş sütunlar dosyaya girmez. maxBytes verilirse ve dosya sınırı
     aşarsa istek başarısız olmaz: ilk N satır gider ve bu, hem modele hem
     kullanıcıya açıkça yazılır (truncated: { sent, total }). */
  function contextAsFile(context, { maxBytes = 0 } = {}) {
    if (!context || !Array.isArray(context.columns) || !context.columns.length || !Array.isArray(context.rows) || !context.rows.length) return { context, file: null };
    const name = contextFileName(context);
    const { rows: allRows, columns: allColumns, images, records, ...rest } = context;
    const keep = allColumns.map((_, index) => allRows.some(row => Array.isArray(row) && row[index] != null && row[index] !== ''));
    const columns = allColumns.filter((_, index) => keep[index]);
    const rows = allRows.map(row => (Array.isArray(row) ? row.filter((_, index) => keep[index]) : []));
    let sent = rows.length;
    let file = new File([contextCsv({ columns, rows })], name, { type: 'text/csv' });
    for (let attempt = 0; maxBytes > 0 && file.size > maxBytes && attempt < 6 && sent > 1; attempt++) {
      sent = Math.max(1, Math.floor(sent * (maxBytes / file.size) * 0.97));
      file = new File([contextCsv({ columns, rows: rows.slice(0, sent) })], name, { type: 'text/csv' });
    }
    const truncated = sent < rows.length ? { sent, total: rows.length } : null;
    const scope = truncated
      ? L(`Dosya boyut sınırı nedeniyle tablonun yalnız ilk ${sent} / ${rows.length} satırı ekli “${name}” dosyasında; toplam, sayım veya tüm kayıtlar hakkında kesin sonuç bu dosyadan çıkarılamaz, bunu cevabında belirt. ${columns.length} sütun (${columns.join(', ')}).`, `Because of the file size limit, only the first ${sent} of ${rows.length} rows are in the attached “${name}” file; totals, counts or statements about all records cannot be derived from it, say so in your answer. ${columns.length} columns (${columns.join(', ')}).`)
      : L(`Tablonun tamamı ekli “${name}” dosyasında: ${rows.length} satır, ${columns.length} sütun (${columns.join(', ')}).`, `The full table is in the attached “${name}” file: ${rows.length} rows, ${columns.length} columns (${columns.join(', ')}).`);
    return {
      records: records || null,
      file,
      truncated,
      context: { ...rest, text: scope + (images ? L(` “${IMAGE_COLUMN}” sütunu kaydın Buyer Log’daki gerçek model görselinin anahtarıdır.`, ` The “${IMAGE_COLUMN}” column is the key of the record’s real model image in Buyer Log.`) : '') },
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
          const options = [{ id: 'all', label: { tr: `Tüm kayıtlar (${full.rows.length})`, en: `All records (${full.rows.length})` }, detail: { tr: `Sayfa filtreleri olmadan, ${full.columns.length} sütun · CSV dosyası olarak`, en: `Without page filters, ${full.columns.length} columns · as a CSV file` } }];
          if (data && data.rows.length !== full.rows.length) options.push({ id: 'visible', label: { tr: `Yalnız filtrelenmiş kayıtlar (${data.rows.length})`, en: `Filtered records only (${data.rows.length})` }, detail: { tr: 'Sayfadaki filtreler uygulanmış', en: 'Page filters applied' } });
          if (data && data.selectedIds && data.selectedIds.length) options.push({ id: 'selected', label: { tr: `Seçili kayıtlar (${data.selectedIds.length})`, en: `Selected records (${data.selectedIds.length})` } });
          if (data) options.push({ id: 'filters', label: { tr: 'Aktif filtreler ve özet', en: 'Active filters and summary' } });
          return options;
        },
        // Koleksiyon ekranı hiç açılmamış olsa da PLM'den gelen Artwork Detayı
        // bağlama girsin diye BOM projeksiyonu önce tazelenir.
        async build(mode) {
          if (tab === 'koleksiyon' && window.BLCollectionArtworkDetail && window.BLCollectionArtworkDetail.ensureFresh) {
            try { await window.BLCollectionArtworkDetail.ensureFresh(); } catch (_) {}
          }
          return tableContext(tab, mode);
        },
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
        const columns = window.BLAIScreenData.cpColumns({ all: mode !== 'cp' });
        const keyed = withImageKeys('overview', rows, columns.map(col => col.label), rows.map(row => columns.map(col => contextCellValue(row, col))));
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
    for (const [id, label] of [['lfl', { tr: 'LFL Analizi', en: 'LFL Analysis' }], ['quotations', { tr: 'Üretici teklifleri', en: 'Supplier quotations' }]]) {
      api.registerContextProvider({ id, screen: id, label,
        getOptions: () => [{ id: 'all', label: { tr: 'Tüm kayıtlar', en: 'All records' } }],
        async build() {
          const datasets = await queryDatasets([`${id}:all`], '');
          const ds = datasets[0];
          if (!ds) return { screen: id, label: L(label.tr, label.en), summary: L('Veri bulunamadı.', 'No data found.'), columns: [], rows: [] };
          return { screen: id, label: ds.label, columns: ds.fields.map(f => f.label), rows: ds.rows.map(row => ds.fields.map(f => DQ().read(f, row))), totalRows: ds.rows.length };
        },
      });
    }
  }

  /* ---------------- Durum ---------------- */
  const state = {
    conversations: [], activeId: '', files: [], contexts: [], busy: false, requestId: '', config: null, status: null, mounted: false,
    // Yanıt biçimi: '' = sohbet; pdf/pptx/xlsx/html = AI Çıktı Oluşturma.
    output: { format: '', orientation: 'portrait', detail: 'standard', template: '' },
    // Çıktı şablonları: hazır (sunucu) + kişisel + ekip (/api/lcwai/output-templates).
    templates: { builtIn: [], personal: [], shared: [] },
    viewingOutputs: false, outputFiles: [], outputsLoading: false, outputsError: false,
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
      // Düzenleyici taslağının kimliği (içerik değil); "Düzenle" bununla açılır.
      draftId: /^[a-f0-9]{24}$/.test(String(file.draftId || '')) ? String(file.draftId) : '', edited: Boolean(file.edited),
    };
  }
  const historyContextIds = list => (Array.isArray(list) ? list : []).slice(0, 12).map(value => String(value).slice(0, 120)).filter(Boolean);
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
      // Eski upload URL/context nesneleri kalıcı depoya taşınmaz. Yalnız bağlam
      // kimliği (ör. "orders:all") ve mesajın LCW AI'a ulaşıp ulaşmadığı yazılır:
      // ulaşmadıysa yeniden denemede bağlam yerelden yeniden kurulur.
      item.contextIds = historyContextIds(message.contextIds);
      item.delivered = Boolean(message.delivered);
    }
    if (message.role === 'ai') {
      if (message.warning) item.warning = cleanHistoryText(message.warning).slice(0, 600);
      if (Array.isArray(message.options) && message.options.length) item.options = message.options.slice(0, 6).map(value => String(value).slice(0, 160));
      const query = historyQuery(message.query);
      if (query) item.query = query;
    }
    const file = historyFile(message.file);
    if (file) item.file = file;
    return item;
  }
  /* Sorgu cevabının yalnız yorumu ve planı saklanır (veri satırı değil);
     "Excel olarak indir" planı güncel veride yeniden çalıştırır. */
  function historyQuery(query) {
    if (!query || typeof query !== 'object') return null;
    const list = (value, max, chars) => (Array.isArray(value) ? value : []).slice(0, max).map(item => String(item == null ? '' : item).slice(0, chars));
    return {
      title: String(query.title || '').slice(0, 140), lines: list(query.lines, 10, 400), notes: list(query.notes, 12, 400),
      dataset: String(query.dataset || '').slice(0, 40), scope: String(query.scope || '').slice(0, 20), contextIds: historyContextIds(query.contextIds),
      spec: String(query.spec || '').slice(0, 12000), matched: Number(query.matched) || 0, rows: Number(query.rows) || 0,
    };
  }
  function historyQueryState(value) {
    if (!value || typeof value !== 'object') return null;
    return { request: String(value.request || '').slice(0, 600), question: String(value.question || '').slice(0, 600), specJson: String(value.specJson || '').slice(0, QUERY_STATE_CHARS) };
  }
  function persistConversations() {
    const store = historyStore();
    if (!store) return;
    let list = state.conversations.filter(conv => conv && Array.isArray(conv.messages) && conv.messages.some(message => !message.streaming)).slice(0, HISTORY_MAX_CONVERSATIONS).map(conv => ({
      id: String(conv.id || '').slice(0, 80),
      chatId: conv.chatId == null ? null : String(conv.chatId).slice(0, 180),
      title: String(conv.title || '').slice(0, 120),
      queryState: historyQueryState(conv.queryState),
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
            item.contextIds = historyContextIds(message.contextIds);
            // Bu alan öncesi kayıtlar: sohbet kimliği varsa eski davranış (upstream geçmiş).
            item.delivered = 'delivered' in message ? Boolean(message.delivered) : Boolean(raw.chatId);
            // LCW AI'a ulaşmış mesajın bağlamı/ekleri upstream sohbet geçmişindedir;
            // ulaşmamış mesajınki yeniden denemede yerelden yeniden hazırlanır.
            item.attachments = item.delivered ? [] : null;
            item.contexts = item.delivered ? [] : null;
          }
          if (message.role === 'ai') {
            if (message.warning) item.warning = cleanHistoryText(message.warning).slice(0, 600);
            if (Array.isArray(message.options)) item.options = message.options.slice(0, 6).map(String);
            const query = historyQuery(message.query);
            if (query) item.query = query;
          }
          if (message.file && message.file.id && message.file.fileName) item.file = historyFile(message.file);
          return item;
        }).filter(Boolean);
        if (!messages.length) return null;
        return {
          id: String(raw.id || `c${Date.now().toString(36)}${(++seq).toString(36)}`).slice(0, 80),
          chatId: raw.chatId == null ? null : String(raw.chatId).slice(0, 180),
          title: String(raw.title || '').slice(0, 120),
          queryState: historyQueryState(raw.queryState),
          messages,
        };
      }).filter(Boolean);
      if (!restored.length) return false;
      state.conversations = restored;
      state.activeId = restored[0].id;
      return true;
    } catch (_) { return false; }
  }

  function deleteConversation(id) {
    if (state.busy || !state.conversations.some(conv => conv.id === id)) return false;
    state.conversations = state.conversations.filter(conv => conv.id !== id);
    if (state.activeId === id) {
      state.activeId = state.conversations[0]?.id || '';
      if (!state.activeId) newConversation();
    }
    persistConversations();
    renderList(); renderMessages();
    return true;
  }

  async function loadOutputs() {
    const api = AI();
    if (!api || !api.listOutputs || state.outputsLoading) return;
    state.outputsLoading = true;
    state.outputsError = false;
    renderMessages();
    try { state.outputFiles = await api.listOutputs(); }
    catch (_) { state.outputsError = true; }
    finally { state.outputsLoading = false; if (state.viewingOutputs) renderMessages(); }
  }

  /* ---------------- Otomatik bağlam ----------------
     Kullanıcı "Backlog'da…", "CP'deki…", "bu ekranda…" dediğinde ve elle
     bağlam eklemediyse ilgili ekranın verisi otomatik eklenir. Konu
     kartları ve otomatik seçim aynı ekran listesini kullanır. */
  const SCREEN_HINTS = [
    ['lfl', /\blfl\b|like.for.like/i],
    ['quotations', /teklif|fiyat veren|quotations?|quoted|price offers?/i], // i18n-ignore
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
    // Türkçe karaktersiz/hatalı yazım ("sıparıs", "sıparıslerden") da ekranı bulsun.
    if (window.BLDataQuery) screens.push(...window.BLDataQuery.screensIn(value).filter(screen => SCREEN_HINTS.some(([key]) => key === screen)));
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
          <header class="lcwaiChatHead"><div><b>LCW AI</b> <small class="lcwaiModel" data-chat-model>${esc(AI() ? AI().modelLabel : 'GPT-6 Sol')}</small></div><div class="lcwaiChatHeadActions"><button type="button" class="lcwaiBtn" data-chat-outputs aria-pressed="false">${esc(L('Dosyalarım', 'My files'))}</button><button type="button" class="lcwaiBtn lcwaiLayoutControlBtn" data-layout-control>✓ ${esc(L('Layout Kontrol', 'Layout Control'))}</button><div class="lcwaiChatConn" data-chat-conn></div></div></header>
          <div class="lcwaiChatMessages" data-chat-messages role="log" aria-live="polite"></div>
          <form class="lcwaiComposer" data-chat-form>
            <div class="lcwaiOutputBar" data-chat-output>
              <span class="lcwaiOutputLabel">${esc(L('Yanıt biçimi', 'Answer as'))}</span>
              <div class="lcwaiSeg" role="radiogroup" aria-label="${esc(L('Yanıt biçimi', 'Answer as'))}">${OUTPUT_FORMATS().map(item => `<button type="button" role="radio" data-output-format="${esc(item.key)}">${esc(item.label)}</button>`).join('')}</div>
              <span class="lcwaiOutputOptions" data-output-options hidden>
                <select data-output-template data-no-i18n aria-label="${esc(L('Çıktı şablonu', 'Output template'))}"></select>
                <select data-output-orientation aria-label="${esc(L('Sayfa yönü', 'Page orientation'))}"><option value="portrait">${esc(L('Dikey', 'Portrait'))}</option><option value="landscape">${esc(L('Yatay', 'Landscape'))}</option></select>
                <select data-output-detail aria-label="${esc(L('Detay seviyesi', 'Level of detail'))}"><option value="summary">${esc(L('Kısa', 'Brief'))}</option><option value="standard">${esc(L('Standart', 'Standard'))}</option><option value="detailed">${esc(L('Detaylı', 'Detailed'))}</option></select>
              </span>
              <span style="flex:1"></span>
              <button type="button" class="lcwaiBtn is-link" data-output-templates title="${esc(L('Kayıtlı ve ekip şablonlarını yönet', 'Manage saved and team templates'))}">${esc(L('Şablonlarım', 'My templates'))}</button>
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
    renderTemplateSelect();
    const input = $('[data-chat-input]');
    if (input) {
      input.placeholder = format
        ? L(`${formatLabel(format)} dosyasında ne olmasını istediğinizi yazın… (Buyer Log dosyayı LCW AI içeriğiyle oluşturur)`, `Describe what the ${formatLabel(format)} file should contain… (Buyer Log builds the file from LCW AI content)`)
        : L('Mesajınızı yazın… (Enter gönderir, Shift+Enter yeni satır)', 'Type your message… (Enter sends, Shift+Enter new line)');
    }
    const sendButton = $('[data-chat-send]');
    if (sendButton) sendButton.textContent = format ? L(`${formatLabel(format)} Oluştur`, `Create ${formatLabel(format)}`) : L('Gönder', 'Send');
  }

  /* Şablon seçici: Otomatik · hazır şablonlar (seçili biçim için) ·
     Şablonlarım · Ekip şablonları. Kullanıcı şablonu biçimi de belirler. */
  const templateValue = (kind, id) => `${kind}:${id}`;
  function selectedTemplate() {
    const [kind, ...rest] = String(state.output.template || '').split(':');
    const id = rest.join(':');
    if (kind === 'builtin') return { kind, key: id };
    const list = kind === 'mine' ? state.templates.personal : kind === 'team' ? state.templates.shared : [];
    const item = list.find(entry => entry.id === id);
    return item ? { kind, item } : null;
  }
  function renderTemplateSelect() {
    const box = $('[data-output-template]');
    if (!box) return;
    const format = state.output.format;
    const lang = isEn() ? 'en' : 'tr';
    const builtIn = format ? state.templates.builtIn.filter(item => (item.formats || []).includes(format)) : [];
    const line = item => `${item.name} · ${formatLabel(item.definition.format)}${item.shared && item.ownerName ? ` · ${item.ownerName}` : ''}`;
    const group = (label, list, kind) => (list.length ? `<optgroup label="${esc(label)}">${list.map(item => `<option value="${esc(templateValue(kind, item.id))}">${esc(line(item))}</option>`).join('')}</optgroup>` : '');
    box.innerHTML = `<option value="">${esc(L('Şablon: Otomatik', 'Template: Automatic'))}</option>`
      + (builtIn.length ? `<optgroup label="${esc(L('Hazır şablonlar', 'Built-in templates'))}">${builtIn.map(item => `<option value="${esc(templateValue('builtin', item.key))}">${esc(item.label && item.label[lang] || item.key)}</option>`).join('')}</optgroup>` : '')
      + group(L('Şablonlarım', 'My templates'), state.templates.personal, 'mine')
      + group(L('Ekip şablonları', 'Team templates'), state.templates.shared, 'team');
    if (state.output.template && !selectedTemplate()) state.output.template = '';
    box.value = state.output.template || '';
  }
  function applyUserTemplate(kind, item) {
    const def = item.definition;
    state.output = { ...state.output, format: def.format, orientation: def.orientation || 'portrait', detail: def.detail || 'standard', template: templateValue(kind, item.id) };
    renderOutputBar();
  }
  async function loadTemplates() {
    const api = AI();
    if (!api || !api.outputTemplates) return;
    try { setTemplates(await api.outputTemplates.list()); } catch (_) { /* şablonlar isteğe bağlıdır; sohbet etkilenmez */ }
  }
  function setTemplates(lists) {
    if (!lists) return;
    state.templates = { builtIn: lists.builtIn || state.templates.builtIn, personal: lists.personal || [], shared: lists.shared || [] };
    renderTemplateSelect();
  }
  /* Gönderilen çıktı isteği: hazır şablon anahtarı ya da kullanıcı şablonu
     kimliği. Şablon tanımı sunucuda depodan okunur. */
  function outputRequest() {
    if (!state.output.format) return null;
    const request = { format: state.output.format, orientation: state.output.orientation, detail: state.output.detail };
    const chosen = selectedTemplate();
    if (chosen && chosen.kind === 'builtin') request.template = chosen.key;
    if (chosen && chosen.item) { request.userTemplate = { id: chosen.item.id, shared: chosen.kind === 'team' }; request.templateName = chosen.item.name; }
    return request;
  }

  /* Çıktı Düzenleyici tembel yüklenir (BLPerf özelliği); ilk açılışta indirilir. */
  async function withEditor(run) {
    try {
      if (!window.BLOutputEditor && window.BLPerf && typeof window.BLPerf.ensureFeature === 'function') await window.BLPerf.ensureFeature('lcwaiOutputEditor');
      if (!window.BLOutputEditor) throw new Error('editor');
      run(window.BLOutputEditor);
    } catch (_) { if (typeof showToast === 'function') showToast(L('Çıktı düzenleyici yüklenemedi.', 'The output editor could not be loaded.'), { kind: 'error' }); }
  }
  function openEditor(file, conv) {
    withEditor(editor => editor.open({
      draftId: file.draftId,
      onTemplatesChanged: setTemplates,
      onRendered: record => {
        if (!conv || !state.conversations.includes(conv)) { loadOutputs(); return; }
        // Düzenlenmiş dosya aynı sohbete yeni bir kart olarak eklenir.
        conv.messages.push({ role: 'ai', text: L('Düzenlenmiş dosya oluşturuldu.', 'The edited file was created.'), file: { ...record, draftId: record.draftId || file.draftId } });
        persistConversations();
        if (state.activeId === conv.id) renderMessages();
      },
    }));
  }
  function openTemplateManager() {
    withEditor(editor => editor.openTemplates({
      onChanged: setTemplates,
      onUse: item => { applyUserTemplate(item.shared ? 'team' : 'mine', item); $('[data-chat-input]')?.focus(); },
    }));
  }

  const formatBytesSafe = bytes => (Number(bytes) > 0 ? formatBytes(Number(bytes)) : '');
  function fileCardHtml(file) {
    const format = String(file.format || '').toLowerCase();
    const details = [file.edited ? L('Düzenlendi', 'Edited') : '', file.templateLabel, formatBytesSafe(file.bytes), file.attempts > 1 ? L(`${file.attempts - 1} otomatik düzeltme`, `${file.attempts - 1} automatic repair(s)`) : ''].filter(Boolean).join(' · ');
    const fallback = file.fallback === 'html'
      ? `<p class="lcwaiNote">${esc(L('PDF basımı bu ortamda yapılamadı; rapor HTML olarak kaydedildi. Açıp Yazdır → PDF olarak kaydet ile PDF alabilirsiniz.', 'PDF printing is not available here; the report was saved as HTML. Open it and use Print → Save as PDF.'))}</p>`
      : '';
    return `<div class="lcwaiFile" data-file-card="${esc(file.id)}"><span class="lcwaiFileIcon is-${esc(format)}">${esc(format === 'pptx' ? 'PPT' : format.toUpperCase())}</span><div class="lcwaiFileInfo"><b title="${esc(file.path || file.fileName)}">${esc(file.fileName)}</b><small>${esc(details)}</small></div><div class="lcwaiFileActions">${file.draftId ? `<button type="button" class="lcwaiBtn" data-file-edit="${esc(file.id)}" title="${esc(L('Dosyayı Buyer Log’da düzenleyip yeniden oluşturun', 'Edit the file in Buyer Log and create it again'))}">✎ ${esc(L('Düzenle', 'Edit'))}</button>` : ''}<button type="button" class="lcwaiBtn is-primary" data-file-open="${esc(file.id)}">${esc(L('Aç', 'Open'))}</button><button type="button" class="lcwaiBtn" data-file-reveal="${esc(file.id)}">${esc(L('Klasörde Göster', 'Show in folder'))}</button></div></div>${fallback}`;
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
  /* Model görselleri LCW AI'a PAFTA olarak gider: her karenin altında kaydın
     BL Image anahtarı yazılıdır, böylece LCW AI görseli CSV satırıyla eşler.
     İstek başına ek sayısı sınırlı (maxFilesPerRequest) olduğundan görseller
     tek tek değil, pafta başına SHEET_COLUMNS × SHEET_ROWS kare yüklenir. */
  const SHEET_COLUMNS = 4, SHEET_ROWS = 4, SHEET_TILE = 280, SHEET_LABEL = 30, MAX_SHEETS = 3;
  function modelImageSheetPlan(keys, slots) {
    const list = [...new Set((keys || []).filter(Boolean))];
    const perSheet = SHEET_COLUMNS * SHEET_ROWS;
    const count = Math.max(0, Math.min(MAX_SHEETS, Math.floor(Number(slots) || 0), Math.ceil(list.length / perSheet)));
    const sheets = [];
    for (let index = 0; index < count; index++) sheets.push({ fileName: `BuyerLog-model-images-${index + 1}.jpg`, keys: list.slice(index * perSheet, (index + 1) * perSheet) });
    return { sheets, omitted: list.slice(count * perSheet) };
  }
  function modelImageSheetsContext(fileNames, sentCount, skippedCount) {
    const names = fileNames.map(name => `“${name}”`).join(', ');
    const sent = sentCount ? L(`Ekli ${names} paftalarında ${sentCount} model görseli var; her karenin altında kaydın “${IMAGE_COLUMN}” anahtarı yazılı. Tasarımları anlatmak, kıyaslamak veya gruplamak için görsellere bakabilirsin.`, `The attached ${names} contact sheets hold ${sentCount} model images; each tile is labelled with the record’s “${IMAGE_COLUMN}” key. Look at the images to describe, compare or group the designs.`) : '';
    const skipped = skippedCount ? L(`${skippedCount} model görseli ek sınırı nedeniyle ya da okunamadığı için eklenmedi.`, `${skippedCount} model images were not attached (attachment limit or unreadable image).`) : '';
    const text = [sent, skipped].filter(Boolean).join(' ');
    return text ? { label: L('Model görselleri', 'Model images'), text } : null;
  }
  async function drawModelImageSheet(keys, map) {
    const screenData = window.BLAIScreenData;
    const canvas = document.createElement('canvas');
    canvas.width = SHEET_COLUMNS * SHEET_TILE;
    canvas.height = Math.ceil(keys.length / SHEET_COLUMNS) * (SHEET_TILE + SHEET_LABEL);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const drawn = [];
    for (let index = 0; index < keys.length; index++) {
      const key = keys[index];
      let bitmap = null;
      try {
        const raw = screenData && typeof screenData.imageDataUrl === 'function' ? await screenData.imageDataUrl(map[key]) : '';
        if (raw) { bitmap = new Image(); bitmap.src = raw; await bitmap.decode(); }
      } catch (_) { bitmap = null; }
      if (!bitmap || !bitmap.naturalWidth) continue;
      const x = (drawn.length % SHEET_COLUMNS) * SHEET_TILE;
      const y = Math.floor(drawn.length / SHEET_COLUMNS) * (SHEET_TILE + SHEET_LABEL);
      const scale = Math.min((SHEET_TILE - 12) / bitmap.naturalWidth, (SHEET_TILE - 12) / bitmap.naturalHeight);
      const w = Math.max(1, Math.round(bitmap.naturalWidth * scale));
      const h = Math.max(1, Math.round(bitmap.naturalHeight * scale));
      ctx.drawImage(bitmap, x + Math.round((SHEET_TILE - w) / 2), y + Math.round((SHEET_TILE - h) / 2), w, h);
      ctx.fillStyle = '#111111';
      ctx.font = '600 20px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(key, x + SHEET_TILE / 2, y + SHEET_TILE + SHEET_LABEL / 2);
      ctx.strokeStyle = '#cccccc';
      ctx.strokeRect(x + 0.5, y + 0.5, SHEET_TILE - 1, SHEET_TILE + SHEET_LABEL - 1);
      drawn.push(key);
    }
    if (!drawn.length) return { blob: null, drawn };
    // Okunamayan görsel atlandıysa boş kalan alt satırlar kırpılır.
    const used = document.createElement('canvas');
    used.width = canvas.width;
    used.height = Math.ceil(drawn.length / SHEET_COLUMNS) * (SHEET_TILE + SHEET_LABEL);
    used.getContext('2d').drawImage(canvas, 0, 0);
    const blob = await new Promise(resolve => used.toBlob(resolve, 'image/jpeg', 0.86));
    return { blob, drawn };
  }
  /* images: { anahtar: görsel kimliği } → { attachments, context }. */
  async function uploadModelImageSheets(images, slots, onPhase) {
    const api = AI();
    const keys = Object.keys(images || {});
    const plan = modelImageSheetPlan(keys, slots);
    const attachments = [];
    const fileNames = [];
    let sent = 0;
    for (let index = 0; index < plan.sheets.length; index++) {
      const sheet = plan.sheets[index];
      onPhase(L(`Model görselleri LCW AI’a ekleniyor (${index + 1}/${plan.sheets.length})…`, `Attaching model images for LCW AI (${index + 1}/${plan.sheets.length})…`));
      const { blob, drawn } = await drawModelImageSheet(sheet.keys, images);
      if (!blob) continue;
      // Görsel ek yardımcıdır: yüklenemezse mesaj yine gider, görseller "eklenmedi" sayılır.
      try { attachments.push(await api.uploadFile(new File([blob], sheet.fileName, { type: 'image/jpeg' }))); }
      catch (error) { if (error && error.code === 'LCWAI_CANCELLED') throw error; continue; }
      fileNames.push(sheet.fileName);
      sent += drawn.length;
    }
    return { attachments, context: modelImageSheetsContext(fileNames, sent, keys.length - sent) };
  }
  function resolveRecords(conv, tokens) {
    const map = conv.recordMap || {};
    const out = {};
    for (const token of tokens || []) if (Array.isArray(map[token])) out[token] = map[token];
    return out;
  }
  async function resolveImages(conv, tokens, answer) {
    const map = conv.imageMap || {};
    const screenData = window.BLAIScreenData;
    const list = (tokens || []).filter(token => map[token]);
    const images = {};
    let done = 0;
    setProgress(answer, 'images');
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

  /* Dosya (PDF/PowerPoint/Excel/HTML) üretim ilerlemesi. Buyer Log tabloyu
     cevaba yazdıktan sonra da dosya aşamaları görünür kalır: hangi adımın
     bittiği, hangisinin sürdüğü ve geçen süre. Yalnız akış sürerken çizilir. */
  const PROGRESS_STEPS = ['data', 'generating', 'rendering', 'images', 'pdf'];
  function startProgress(answer, output) {
    if (!output || !output.format) return;
    answer.progress = { format: output.format, current: 'data', images: false, startedAt: Date.now() };
  }
  function setProgress(answer, step) {
    const progress = answer && answer.progress;
    if (!progress) return;
    const id = step === 'repairing' ? 'generating' : step;
    if (!PROGRESS_STEPS.includes(id)) return;
    if (id === 'images') progress.images = true;
    progress.current = id;
  }
  function progressStepLabel(id, progress) {
    const name = formatLabel(progress.format);
    if (id === 'data') return progress.query ? L('Buyer Log verileri hesapladı', 'Buyer Log calculated the data') : L('Buyer Log verisi ve bağlamı hazırlanıyor', 'Preparing Buyer Log data and context');
    if (id === 'generating') return L(`LCW AI ${name} içeriğini yazıyor`, `LCW AI is writing the ${name} content`);
    if (id === 'rendering') return L('Buyer Log sayfa düzenini kuruyor', 'Buyer Log is laying out the pages');
    if (id === 'images') return L('Model görselleri ekleniyor', 'Adding model images');
    if (id === 'pdf') return L('PDF basılıyor', 'Printing the PDF');
    return '';
  }
  const elapsedText = startedAt => {
    const seconds = Math.max(0, Math.round((Date.now() - Number(startedAt || Date.now())) / 1000));
    const text = seconds < 60 ? `${seconds}` : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    return seconds < 60 ? L(`${text} sn`, `${text} s`) : L(`${text} dk`, `${text} min`);
  };
  function progressHtml(message) {
    const progress = message && message.streaming ? message.progress : null;
    if (!progress) return '';
    // Görsel adımı yalnız çıktı model görseli kullanıyorsa ortaya çıkar; PDF baskısı yalnız PDF'te.
    const steps = PROGRESS_STEPS.filter(id => (id !== 'images' || progress.images) && (id !== 'pdf' || progress.format === 'pdf') && (id !== 'rendering' || progress.format !== 'xlsx' || progress.current === 'rendering'));
    const current = Math.max(0, steps.indexOf(progress.current));
    // Sayfa düzeni ve PDF baskısında aşama metni etiketi tekrarlar; yalnız ek bilgi (sayaç, düzeltme turu) gösterilir.
    const detail = ['rendering', 'pdf'].includes(progress.current) ? '' : String(message.phase || '').trim();
    const items = steps.map((id, index) => {
      const status = index < current ? 'is-done' : index === current ? 'is-active' : 'is-pending';
      const mark = index < current ? '✓' : index === current ? '●' : '○';
      const extra = index === current && detail ? `<small class="lcwaiProgressDetail">${esc(detail)}</small>` : '';
      return `<li class="lcwaiProgressStep ${status}"${index === current ? ' aria-current="step"' : ''}><span class="lcwaiProgressMark" aria-hidden="true">${mark}</span>${esc(progressStepLabel(id, progress))}${extra}</li>`;
    }).join('');
    return `<div class="lcwaiProgress blMotionEnter" role="status" aria-live="polite"><div class="lcwaiProgressHead"><b>${esc(L(`${formatLabel(progress.format)} dosyası hazırlanıyor`, `Preparing the ${formatLabel(progress.format)} file`))}</b><span>${esc(L(`Adım ${current + 1} / ${steps.length}`, `Step ${current + 1} / ${steps.length}`))} · <span data-lcwai-elapsed="${Number(progress.startedAt) || 0}">${esc(elapsedText(progress.startedAt))}</span></span></div><ol class="lcwaiProgressSteps">${items}</ol><p class="lcwaiNote">${esc(L('Dosya hazır olduğunda bu mesajda görünür. Bu sırada başka bir modüle geçerseniz hazır olduğunda bildirim alırsınız.', 'The file appears in this message when ready. If you switch to another module meanwhile, you are notified when it is ready.'))}</p></div>`;
  }
  let elapsedTimer = 0;
  function tickElapsed() {
    const el = host();
    const nodes = el ? el.querySelectorAll('[data-lcwai-elapsed]') : [];
    nodes.forEach(node => { node.textContent = elapsedText(node.getAttribute('data-lcwai-elapsed')); });
  }
  function startElapsedTimer() { if (!elapsedTimer && typeof setInterval === 'function') elapsedTimer = setInterval(tickElapsed, 1000); }
  function stopElapsedTimer() { if (elapsedTimer) { clearInterval(elapsedTimer); elapsedTimer = 0; } }

  function renderList() {
    const list = $('[data-chat-list]');
    if (!list) return;
    list.innerHTML = state.conversations.filter(conv => conv.messages.length).map(conv => `<div class="lcwaiChatRow"><button type="button" class="lcwaiChatItem${conv.id === state.activeId && !state.viewingOutputs ? ' is-active' : ''}" data-chat-open="${esc(conv.id)}" title="${esc(conv.title)}">${esc(conv.title || L('Yeni sohbet', 'New chat'))}</button><button type="button" class="lcwaiBtn is-link" data-chat-delete="${esc(conv.id)}" aria-label="${esc(L(`Sohbeti sil: ${conv.title || 'Yeni sohbet'}`, `Delete chat: ${conv.title || 'New chat'}`))}" title="${esc(L('Sohbeti sil', 'Delete chat'))}"${state.busy ? ' disabled' : ''}>×</button></div>`).join('')
      || `<p class="lcwaiNote">${esc(L('Henüz sohbet yok.', 'No chats yet.'))}</p>`;
  }

  function messageHtml(message, index, conv) {
    if (message.role === 'user') {
      const meta = [...(message.contextLabels || []).map(label => `◆ ${label}`), ...(message.fileNames || []).map(name => `${L('Dosya', 'File')}: ${name}`), ...(message.output && message.output.format ? [`⇩ ${formatLabel(message.output.format)}${message.output.templateName ? ` · ${message.output.templateName}` : ''}`] : [])];
      return `<div class="lcwaiMsg is-user"><div class="lcwaiMsgWho">${esc(L('Siz', 'You'))}</div><div class="lcwaiMsgBody">${esc(message.text).replace(/\n/g, '<br>')}</div>${meta.length ? `<div class="lcwaiMsgMeta">${meta.map(esc).join(' · ')}</div>` : ''}</div>`;
    }
    const last = index === conv.messages.length - 1;
    const warning = message.warning ? `<p class="lcwaiMsgWarning">${esc(message.warning)}</p>` : '';
    const progress = message.error ? '' : progressHtml(message);
    const content = message.error
      ? `<div class="lcwaiMsgError">${esc(message.error)}${message.login ? ` <button type="button" class="lcwaiBtn is-link" data-chat-login>${esc(L('LCW AI Girişi Yap', 'Sign in to LCW AI'))}</button>` : ''}</div>`
      : message.file ? `${message.text ? md(message.text) : ''}${fileCardHtml(message.file)}`
        : (message.text ? md(message.text) : progress ? '' : `<p class="lcwaiNote">${esc(message.phase || L('LCW AI düşünüyor…', 'LCW AI is thinking…'))}</p>`);
    const options = !message.streaming && last && Array.isArray(message.options) && message.options.length
      ? `<div class="lcwaiOptions">${message.options.map((option, i) => `<button type="button" class="lcwaiBtn" data-msg-option="${index}:${i}">${esc(option)}</button>`).join('')}</div>` : '';
    const body = `${warning}${message.query && !message.error ? queryHtml(message.query) : ''}${content}${progress}${options}`;
    const excel = message.query && message.query.matched && !message.file && !message.error
      ? `<button type="button" class="lcwaiBtn is-link" data-msg-excel="${index}"${message.exporting || state.busy ? ' disabled' : ''}>${esc(message.exporting ? L('Excel hazırlanıyor…', 'Preparing Excel…') : L('Excel olarak indir', 'Download as Excel'))}</button>` : '';
    const actions = message.streaming ? '' : `<div class="lcwaiMsgActions">${excel}${message.text ? `<button type="button" class="lcwaiBtn is-link" data-msg-copy="${index}">${esc(L('Kopyala', 'Copy'))}</button><button type="button" class="lcwaiBtn is-link" data-msg-reuse="${index}">${esc(L('Yeni mesajda kullan', 'Use in new message'))}</button>` : ''}${last ? `<button type="button" class="lcwaiBtn is-link" data-msg-retry>${esc(message.error ? L('Tekrar Dene', 'Try Again') : L('Yeniden üret', 'Regenerate'))}</button>` : ''}</div>`;
    return `<div class="lcwaiMsg is-ai${message.streaming ? ' is-streaming' : ''}${progress ? ' has-progress' : ''}"><div class="lcwaiMsgWho">LCW AI${message.model ? ` · ${esc(message.model)}` : ''}</div><div class="lcwaiMsgBody lcwaiMd">${body}</div>${actions}</div>`;
  }

  /* "Nasıl anladım": rakamları Buyer Log'un hesapladığı ve yorumun ne olduğu
     tek bakışta görünür; kullanıcı yanlış yorumu bir cümleyle düzeltir. */
  function queryHtml(query) {
    const lines = (query.lines || []).map(line => `<li>${esc(line)}</li>`).join('');
    const notes = (query.notes || []).length ? `<details class="lcwaiQueryNotes" open><summary>${esc(L('Varsayımlar ve eşleştirmeler', 'Assumptions and matches'))}</summary><ul>${query.notes.map(note => `<li>${esc(note)}</li>`).join('')}</ul></details>` : '';
    return `<div class="lcwaiQuery blMotionEnter"><div class="lcwaiQueryHead"><b>${esc(L('Buyer Log hesapladı', 'Calculated by Buyer Log'))}</b><small>${esc(L('LCW AI isteği yorumladı; rakamlar tüm kayıtlar üzerinde Buyer Log tarafından hesaplandı.', 'LCW AI interpreted the request; Buyer Log calculated the figures on all records.'))}</small></div><ul class="lcwaiQueryLines">${lines}</ul>${notes}<p class="lcwaiNote">${esc(L('Yanlış anladıysam düzeltmeyi yazmanız yeterli (ör. “adet yerine PO sayısı”, “Mısır da hariç”).', 'If I misunderstood, just write the correction (e.g. “PO count instead of quantity”, “exclude Egypt too”).'))}</p></div>`;
  }

  let messageView = null;
  function renderMessages(activeMessage) {
    const box = $('[data-chat-messages]');
    if (!box) return;
    const composer = $('[data-chat-form]'), outputs = $('[data-chat-outputs]');
    if (composer) composer.hidden = state.viewingOutputs;
    if (outputs) {
      outputs.textContent = state.viewingOutputs ? L('Sohbete dön', 'Back to chat') : L('Dosyalarım', 'My files');
      outputs.setAttribute('aria-pressed', String(state.viewingOutputs));
    }
    if (state.viewingOutputs) {
      messageView = null;
      box.innerHTML = `<div class="blMotionEnter"><b>${esc(L('Dosyalarım · Son 60 gün', 'My files · Last 60 days'))}</b><p class="lcwaiNote">${esc(L('Dosyalar ve düzenlenebilir taslaklar bu cihazda 60 gün saklanır. Sohbeti silmek dosyaları silmez. Düzenlediğinizde taslağın 60 günlük süresi yenilenir.', 'Files and editable drafts are kept on this device for 60 days. Deleting a chat keeps its files. Editing renews the draft’s 60-day period.'))}</p><button type="button" class="lcwaiBtn" data-outputs-refresh${state.outputsLoading ? ' disabled' : ''}>${esc(L('Yenile', 'Refresh'))}</button></div>${state.outputsLoading ? `<p class="lcwaiNote">${esc(L('Dosyalar yükleniyor…', 'Loading files…'))}</p>` : state.outputsError ? `<p class="lcwaiMsgError">${esc(L('Dosyalar yüklenemedi. Yeniden deneyin.', 'Files could not be loaded. Try again.'))}</p>` : state.outputFiles.length ? state.outputFiles.map(file => fileCardHtml(file)).join('') : `<p class="lcwaiNote">${esc(L('Son 60 günde oluşturulmuş dosya yok.', 'No files created in the last 60 days.'))}</p>`}`;
      return;
    }
    const conv = activeConversation();
    const sameView = messageView && messageView.box === box && messageView.conv === conv;
    const follow = !sameView || box.scrollHeight - box.clientHeight - box.scrollTop < 48;
    const top = box.scrollTop;
    if (!conv.messages.length) {
      messageView = null;
      box.innerHTML = emptyStateHtml();
      return;
    }
    const index = conv.messages.length - 1;
    // Akış yalnız kendi yanıtını değiştirir; tamamlanan mesajları ve seçimleri
    // yerinde tut. Markdown aynı güvenli mesaj çiziminden geçmeye devam eder.
    if (activeMessage && sameView && messageView.lang === isEn()
      && messageView.message === activeMessage && conv.messages[index] === activeMessage
      && messageView.index === index && messageView.node?.parentNode === box) {
      messageView.node.outerHTML = messageHtml(activeMessage, index, conv);
      messageView.node = box.lastElementChild;
      box.scrollTop = follow ? box.scrollHeight : top;
      return;
    }
    box.innerHTML = conv.messages.map((message, index) => messageHtml(message, index, conv)).join('');
    messageView = { box, conv, index, message: conv.messages[index], node: box.lastElementChild, lang: isEn() };
    box.scrollTop = follow ? box.scrollHeight : top;
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
    renderList();
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

  /* ---------------- Doğal dil veri sorgusu ----------------
     Veri isteğinde LCW AI yalnız isteği yorumlayıp bir sorgu planı yazar
     (source: data-query). Buyer Log planı doğrular, değerleri gerçek veride
     eşleştirir ve TÜM kayıtlar üzerinde kendisi hesaplar (BLDataQuery).
     Böylece on binlerce satırlık tablo LCW AI'a yüklenmez ve rakamlar
     modelden gelmez. Belirsizlikte tahmin edilmez, kullanıcıya sorulur. */
  const DQ = () => window.BLDataQuery || null;
  const QUERY_SCREENS = ['orders', 'cp', 'koleksiyon', 'shipping', 'backlog', 'lfl', 'quotations'];
  const QUERY_STATE_CHARS = 12000;
  const answerResults = new WeakMap(); // cevap → { computed, title, lines, notes } (yalnız bellekte)
  const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  /* Bağlam kimlikleri ("orders:all", "overview:cp") → sorgulanacak tablolar.
     Bağlam yoksa mesajda adı geçen ekran, o da yoksa yüklü tüm tablolar. */
  function queryTargets(contextIds, text) {
    const targets = [];
    let other = false;
    for (const id of contextIds || []) {
      const [provider, mode = 'all'] = String(id || '').split(':');
      if (provider === 'overview') targets.push({ screen: 'cp', scope: mode === 'cp' ? 'overview' : 'all' });
      else if (QUERY_SCREENS.includes(provider)) targets.push({ screen: provider, scope: mode === 'visible' || mode === 'filters' || mode === 'rows' ? 'visible' : mode === 'selected' ? 'selected' : 'all' });
      else other = true;
    }
    // Açıkça istenen tarihçe/teklif kaynağı, otomatik CP/Orders bağlamında kaybolmaz.
    for (const screen of ['lfl', 'quotations', 'backlog']) if (SCREEN_HINTS.find(([id]) => id === screen)?.[1].test(text) && !targets.some(t => t.screen === screen)) targets.push({ screen, scope: 'all' });
    if (targets.length || other) return { targets, named: true };
    const named = (DQ() ? DQ().screensIn(text) : []).filter(screen => QUERY_SCREENS.includes(screen));
    return { targets: (named.length ? named : ['orders', 'cp', 'koleksiyon', 'shipping']).map(screen => ({ screen, scope: 'all' })), named: named.length > 0 };
  }
  /* Görünmeyen modül çizilmez: veri gerekiyorsa yalnız yüklenir (deferRender). */
  async function ensureQueryData(screen) {
    const loader = screen === 'orders' ? window.BLEnsureOrdersLoaded : screen === 'cp' ? window.BLEnsureCpLoaded : null;
    if (typeof loader === 'function') { try { await loader({ deferRender: true, reason: 'lcwai' }); } catch (_) { /* yüklenemezse o tablo sorguya girmez */ } }
  }
  async function queryDatasets(contextIds, text) {
    const engine = DQ(), data = window.BLAIScreenData;
    if (!engine || !data || typeof data.table !== 'function') return [];
    const { targets, named } = queryTargets(contextIds, text);
    const out = [], seen = new Set();
    for (const target of targets) {
      const key = `${target.screen}:${target.scope}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (target.screen === 'backlog') {
        const query = target.scope === 'all' ? { format: 'json' } : data.backlogQuery();
        const rows = window.BLBacklogRows ? await window.BLBacklogRows.load(query) : await data.backlogRows(query);
        out.push(engine.datasetFromRecords({ id: 'backlog', label: 'Backlog', rows, lang: isEn() ? 'en' : 'tr', scope: target.scope }));
        continue;
      }
      if (target.screen === 'lfl') {
        const rows = await data.lflRows();
        out.push(engine.datasetFromRecords({ id: 'lfl', label: L('LFL tarihçesi', 'LFL history'), rows, lang: isEn() ? 'en' : 'tr' }));
        continue;
      }
      if (target.screen === 'quotations') {
        if (!window.BLPriceSupplierInsights && window.BLPerf?._loadScript) await window.BLPerf._loadScript('price-supplier-insights-engine.js');
        if (!window.BLCollectionAnalyticsEngine && window.BLPerf?._loadScript) await window.BLPerf._loadScript('collection-analytics-engine.js');
        const source = await window.BLPriceSupplierAnalysisBridge.get('collection', 'all', 'quotation');
        if (source.priceType !== 'quotation') throw new Error(L('Üretici teklif verisi bulunamadı; sipariş fiyatları teklif yerine kullanılamaz.', 'Supplier quotation data is unavailable; order prices cannot replace quotations.'));
        const rows = (source.observations || []).map(o => ({ manufacturer: o.manufacturer, country: o.country, mag: o.mag, mmyg: o.mmyg, buyingGroup: o.buyingGroup, buyer: o.buyer, season: o.season, classification: o.classification, productDescription: o.productMainDefinition, modelName: o.model, fob: o.price, currency: o.currency, quantity: o.quantity }));
        out.push(engine.datasetFromRecords({ id: 'quotations', module: 'lfl', label: L('Üretici teklifleri (sipariş fiyatı değildir)', 'Supplier quotations (not order prices)'), rows, lang: isEn() ? 'en' : 'tr' }));
        continue;
      }
      // Ad verilmediyse yalnız Siparişler yüklenir; diğer tablolar yüklüyse sorguya girer.
      if (named || target.screen === 'orders') await ensureQueryData(target.screen);
      let rows = null, columns = null;
      if (target.scope === 'overview') { rows = data.overviewCpRows(); columns = data.cpColumns(); }
      else {
        const table = data.table(target.screen, { all: target.scope === 'all' });
        if (!table) continue;
        rows = table.rows;
        columns = table.columns;
        if (target.scope === 'selected') {
          const selected = new Set((table.selectedIds || []).map(String));
          rows = rows.filter(row => { const id = typeof table.rowId === 'function' ? table.rowId(row) : row && row._id; return id != null && selected.has(String(id)); });
        }
      }
      if (!Array.isArray(rows) || !rows.length || !Array.isArray(columns) || !columns.length) continue;
      out.push(engine.createDataset({ id: target.screen, label: data.pageTitle(target.screen), screen: target.screen, rows, columns, scope: target.scope === 'overview' ? 'visible' : target.scope }));
    }
    return out;
  }
  /* Dönemler LCW Merch Calendar'a göre hesaplanır: takvim açılışta yüklenir
     (merch-calendar-runtime.js); sorgu yüklenmesini bekler. */
  async function merchCalendarReady() {
    const ready = window.BLMerchCalendarReady;
    if (ready && typeof ready.then === 'function') { try { await ready; } catch (_) { /* takvim yoksa geçici düzen + uyarı */ } }
  }
  function wantsDataQuery(conv, userMessage) {
    const engine = DQ();
    const text = String(userMessage.text || '');
    if (!engine || !text.trim() || (userMessage.fileNames || []).length) return false;
    const tableContext = (userMessage.contextIds || []).some(id => { const provider = String(id || '').split(':')[0]; return provider === 'overview' || QUERY_SCREENS.includes(provider); });
    // Önceki sorgunun düzeltmesi ("Mısır da hariç") veri sözcüğü içermeyebilir.
    return tableContext || Boolean(conv.queryState) || engine.looksLikeDataRequest(text) || engine.screensIn(text).length > 0;
  }
  function planContext(conv) {
    const previous = conv.queryState && typeof conv.queryState === 'object' ? conv.queryState : null;
    return {
      today: localToday(),
      previous: previous ? { request: String(previous.request || '').slice(0, 600), question: String(previous.question || '').slice(0, 600), specJson: String(previous.specJson || '').slice(0, QUERY_STATE_CHARS) } : null,
    };
  }
  const planOf = result => {
    const data = result && (result.data || (result.structured && result.structured.partial));
    return data && typeof data === 'object' && data.mode ? data : null;
  };
  const planMode = plan => String(plan && plan.mode || '').trim().toLowerCase();
  function askPlan(api, task, guide, context) {
    return api.ask({ requestId: state.requestId, source: 'data-query', task, guide, context, lang: isEn() ? 'en' : 'tr' });
  }
  function askClarification(conv, answer, base, question, options, specJson) {
    const text = String(question || '').trim();
    if (!text) return 'chat';
    answer.text = text;
    answer.options = (Array.isArray(options) ? options : []).map(item => String(item == null ? '' : item).trim()).filter(Boolean).slice(0, 6);
    conv.queryState = { request: String(base || '').slice(0, 600), question: text.slice(0, 600), specJson: String(specJson || '').slice(0, QUERY_STATE_CHARS) };
    return 'done';
  }
  /* Dönüş: 'done' (cevap hazır) · 'chat' (sohbet yoluna devam) ·
     { contexts } (PDF/PowerPoint/HTML: hesaplanmış tablo bağlam olarak gider). */
  async function runDataQuery({ api, conv, userMessage, answer, output }) {
    const engine = DQ();
    const lang = isEn() ? 'en' : 'tr';
    const assertActive = () => { if (state.queryCancelled) throw Object.assign(new Error('cancelled'), { code: 'LCWAI_CANCELLED' }); };
    answer.phase = L('Buyer Log verisi hazırlanıyor…', 'Preparing Buyer Log data…');
    renderMessages();
    const newAnalysis = /\b(?:AGIRLIKLI|WEIGHTED|LFL|BACKLOG|TEKLIF\w*|QUOT\w*)\b|FIYAT VER/.test(engine.token(userMessage.text)) || /weighted_avg|"comparison"|"queries"/.test(conv.queryState?.specJson || '');
    if (newAnalysis) await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
    assertActive();
    await merchCalendarReady();
    const datasets = await queryDatasets(userMessage.contextIds, userMessage.text);
    assertActive();
    if (!datasets.length) return 'chat';
    answer.phase = L('İstek yorumlanıyor…', 'Interpreting the request…');
    renderMessages();
    const guide = newAnalysis ? await engine.schemaTextAsync(datasets, { lang, cancelled: () => state.queryCancelled }) : engine.schemaText(datasets, { lang });
    const context = planContext(conv);
    const base = context.previous && context.previous.question ? `${context.previous.request} → ${userMessage.text}` : userMessage.text;
    let result = await askPlan(api, userMessage.text, guide, context);
    assertActive();
    let plan = planOf(result);
    if (result && result.model && result.model.label) answer.model = result.model.label;
    const requestTokens = engine.token(base);
    const calculationRequired = /\b(?:LFL|AGIRLIKLI|WEIGHTED|BACKLOG|TEKLIF\w*|QUOT\w*)\b/.test(requestTokens) && /\b(?:ANALIZ\w*|ANALYS\w*|TOPLAM\w*|TOTAL|HESAPLA\w*|CALCULATE|CIKAR\w*|GOSTER\w*|SHOW|KAC|HOW MANY)\b/.test(requestTokens) && !/\b(?:NEDIR|ACIKLA\w*|EXPLAIN|WHAT IS)\b/.test(requestTokens);
    const invalidMode = !plan || !['query', 'clarify'].includes(planMode(plan));
    if (invalidMode && !calculationRequired) return 'chat';
    if (planMode(plan) === 'clarify') return askClarification(conv, answer, base, plan.question, plan.options, context.previous && context.previous.specJson);
    let norm = invalidMode ? { ok: false, errors: ['query-required:requested-calculation-cannot-use-chat'], clarify: null } : engine.normalizeSpec(plan.specJson, datasets, { lang, request: base, deferCurrencyCheck: true });
    if (!norm.ok && !norm.clarify) {
      // Yapı veya eksik ölçüt: LCW AI'dan bir kez tam plan düzeltmesi istenir.
      answer.phase = L('Sorgu planı düzeltiliyor…', 'Correcting the query plan…');
      renderMessages();
      result = await askPlan(api, userMessage.text, guide, { ...context, invalidPlan: String(plan?.specJson || '').slice(0, QUERY_STATE_CHARS), errors: norm.errors.slice(0, 12) });
      const repaired = planOf(result);
      if (repaired && planMode(repaired) === 'clarify') return askClarification(conv, answer, base, repaired.question, repaired.options, plan?.specJson);
      if (repaired && planMode(repaired) === 'query') { plan = repaired; norm = engine.normalizeSpec(plan.specJson, datasets, { lang, request: base, deferCurrencyCheck: true }); }
    }
    if (norm.clarify) return askClarification(conv, answer, base, norm.clarify.question, norm.clarify.options, plan.specJson);
    if (!norm.ok) {
      // Tahmini bir rakam göstermektense durulur.
      answer.error = norm.errors.every(error => error.startsWith('missing-requested-measure:'))
        ? L('Sorgu planı, istediğiniz ölçütlerin tamamını içermiyor. Düzeltme denemesi de eksik kaldığı için kısmi sonuç göstermedim. İstediğiniz ölçütleri birlikte belirterek yeniden deneyebilirsiniz.', 'The query plan does not include all the measures you requested. The repair was also incomplete, so I did not show a partial result. You can retry by naming the requested measures together.')
        : L('Bu isteği Buyer Log verisinde güvenle hesaplayamadım; tahmini bir rakam göstermemek için durdum. Hangi alana göre istediğinizi (ör. Sezon, MB ayı, Buying Group, sipariş adedi) ekleyerek tekrar yazar mısınız?', 'I could not calculate this request safely on Buyer Log data, so I stopped instead of showing an estimate. Could you rewrite it naming the fields you mean (e.g. season, MB month, buying group, order quantity)?');
      return 'done';
    }
    const dataset = norm.dataset;
    answer.phase = L('Buyer Log hesaplıyor…', 'Buyer Log is calculating…');
    renderMessages();
    const cooperative = norm.spec.comparison || norm.spec.queries || norm.spec.measures.some(m => m.agg === 'weighted_avg');
    if (cooperative) await new Promise(resolve => setTimeout(resolve, 0));
    const computed = cooperative
      ? await engine.executeAsync(norm.spec, dataset, { lang, reference: norm.reference, datasets, cancelled: () => state.queryCancelled })
      : engine.execute(norm.spec, dataset, { lang });
    if (computed.currencyConflict || computed.results?.some(r => r.computed.currencyConflict)) return askClarification(conv, answer, base,
      L('Fiyatlar farklı para birimlerinde. Hangi kapsamda karşılaştırayım?', 'Prices use different currencies. How should I compare them?'),
      [L('Ülke veya para birimi bazında göster', 'Group by country or currency'), L('Yalnız USD', 'USD only'), L('Yalnız TRY', 'TRY only')], JSON.stringify(norm.spec));
    const lines = engine.describe(norm.spec, dataset, computed, lang);
    const notes = [...(Array.isArray(plan.assumptions) ? plan.assumptions : []).map(item => String(item == null ? '' : item).trim()), ...norm.notes].filter(Boolean);
    if (computed.truncatedColumns) notes.push(L(`${computed.truncatedColumns} sütun değeri sığmadığı için en sık geçen değerler sütun olarak gösterildi; Toplam sütunu tüm değerleri içerir.`, `${computed.truncatedColumns} column values did not fit, so the most frequent ones are shown as columns; the Total column includes all values.`));
    const title = norm.spec.title || L('Veri sorgusu', 'Data query');
    const specJson = JSON.stringify(norm.spec);
    conv.queryState = { request: base.slice(0, 600), question: '', specJson: specJson.slice(0, QUERY_STATE_CHARS) };
    answer.query = { title, lines, notes: notes.slice(0, 12), dataset: dataset.id, scope: dataset.scope, contextIds: (userMessage.contextIds || []).slice(0, 12), spec: specJson.slice(0, 12000), matched: computed.matched, rows: computed.rows.length };
    answerResults.set(answer, { computed, title, lines, notes });
    if (answer.progress) answer.progress.query = true;
    const shown = Math.min(computed.rows.length, engine.LIMITS.chatRows);
    const table = engine.toMarkdown(computed, { lang });
    answer.text = computed.kind === 'lfl' && !computed.rows.length
      ? L('Bu iki dönem arasında aynı kırılım ve para biriminde karşılaştırılabilir kayıt bulunamadı. Fiyat değişimi hesaplanmadı; dönem ve filtreleri kontrol edebilirsiniz.', 'No comparable records with matching breakdowns and currencies were found between these periods. Price change was not calculated; you can check the periods and filters.')
      : computed.matched
      ? `**${title}**\n\n${table}${computed.rows.length > shown ? `\n\n${L(`İlk ${shown} / ${computed.rows.length} satır gösteriliyor; tamamı için Excel olarak indirin.`, `Showing the first ${shown} of ${computed.rows.length} rows; download as Excel for all of them.`)}` : ''}`
      : L('Bu filtrelere uyan kayıt yok. Yorumu aşağıda kontrol edip düzeltmeyi yazabilirsiniz.', 'No records match these filters. Check the interpretation below and write a correction.');
    // Sonraki sohbet mesajı ("bunu yorumla", "bundan mail yaz") hesaplanmış tabloyu görsün.
    const imageTable = computed.matched ? queryImageTable(conv, dataset, computed, engine.LIMITS.chatRows) : null;
    const contextTable = imageTable ? engine.toMarkdown(imageTable, { lang }) : table;
    const imageNote = imageTable ? ` ${L(`“${IMAGE_COLUMN}” sütunu kaydın Buyer Log’daki gerçek model görselinin anahtarıdır.`, `The “${IMAGE_COLUMN}” column is the key of the record’s real model image in Buyer Log.`)}` : '';
    conv.lastQueryContext = { label: L(`Buyer Log hesaplanmış sonuç — ${title}`, `Buyer Log computed result — ${title}`), screen: dataset.screen, summary: lines.join(' · ').slice(0, 1800), text: `${L('Bu tablo Buyer Log tarafından tüm kayıtlar üzerinde hesaplandı. Rakamları aynen kullan; yeniden hesaplama veya tahmin etme.', 'Buyer Log calculated this table on all records. Use the figures exactly; do not recalculate or estimate.')}${imageNote}\n${contextTable}`.slice(0, 18000) };
    if (output && output.format === 'xlsx' && computed.matched) {
      answer.phase = L('Excel oluşturuluyor…', 'Creating Excel…');
      setProgress(answer, 'rendering');
      renderMessages();
      answer.file = await api.createTableOutput(engine.toWorkbook(computed, { title, lines, notes, lang }), lang);
      notifyFile(answer.file, conv);
      return 'done';
    }
    if (output && output.format && computed.matched) {
      const context = conv.lastQueryContext;
      conv.lastQueryContext = null;
      return { contexts: [context] };
    }
    return 'done';
  }
  /* Sorgu cevabını Excel'e aktarır. Sonuç bellekte yoksa (uygulama yeniden
     açıldı) aynı plan güncel veride yeniden çalıştırılır. */
  async function exportQuery(index) {
    const api = AI(), engine = DQ();
    const conv = activeConversation();
    const message = conv.messages[index];
    if (!api || !engine || !message || !message.query || state.busy) return;
    const lang = isEn() ? 'en' : 'tr';
    setBusy(true);
    message.exporting = true;
    renderMessages();
    try {
      let memo = answerResults.get(message);
      if (!memo) {
        await merchCalendarReady();
        const savedSpec = engine.parseSpec(message.query.spec);
        const ids = [...new Set([...(savedSpec?.queries || [savedSpec]).flatMap(q => [q?.dataset, q?.comparison?.referenceDataset])].filter(Boolean))].map(id => `${id}:all`);
        const contexts = [...(message.query.contextIds || [])];
        for (const id of ids) if (!contexts.some(c => c.split(':')[0] === id.split(':')[0])) contexts.push(id.split(':')[0] === message.query.dataset ? `${message.query.dataset}:${message.query.scope || 'all'}` : id);
        const datasets = await queryDatasets(contexts, '');
        const norm = engine.normalizeSpec(message.query.spec, datasets, { lang });
        if (!norm.ok || norm.clarify) throw Object.assign(new Error('stale'), { code: 'LCWAI_OUTPUT_RENDER_FAILED' });
        const computed = await engine.executeAsync(norm.spec, norm.dataset, { lang, reference: norm.reference, datasets });
        memo = { computed, title: message.query.title, lines: engine.describe(norm.spec, norm.dataset, computed, lang), notes: message.query.notes || [] };
      }
      message.file = await api.createTableOutput(engine.toWorkbook(memo.computed, { title: memo.title, lines: memo.lines, notes: memo.notes, lang }), lang);
      notifyFile(message.file, conv);
    } catch (error) {
      if (window.BLUI && typeof window.BLUI.notify === 'function') window.BLUI.notify({ kind: 'error', message: api.errorText(error) });
    } finally {
      message.exporting = false;
      setBusy(false);
      persistConversations();
      renderMessages();
    }
  }

  /* ---------------- Gönderme ---------------- */
  async function send(text, { reuse = null } = {}) {
    const api = AI();
    if (!api || state.busy) return;
    state.queryCancelled = false;
    const conv = activeConversation();
    const message = String(text || '').trim();
    const files = reuse ? [] : state.files.filter(item => !item.error).map(item => item.file);
    // Elle bağlam eklenmediyse mesajdaki ekran adına göre otomatik bağlam.
    const auto = reuse || state.contexts.length ? [] : autoContextsFor(text);
    if (!message && !files.length && !reuse) return;
    /* contextIds/files mesajda tutulur (files yalnız bellekte): bağlam ya da
       dosya yüklemesi yarıda kalırsa "Tekrar Dene" aynı bağlamı yeniden kurar.
       Eskiden tekrar deneme bağlamsız ve eksiz gidiyor, model "veri yok" diyordu. */
    const userMessage = reuse || { role: 'user', text: message, contextLabels: [...state.contexts.map(item => item.label), ...auto.map(item => `${item.label} · ${L('otomatik', 'automatic')}`)], fileNames: files.map(file => file.name), contextIds: [...state.contexts.map(item => item.id), ...auto.map(item => item.id)], files, contexts: null, attachments: null, output: outputRequest() };
    const output = userMessage.output || null;
    if (!reuse) conv.messages.push(userMessage);
    if (!conv.title) conv.title = (message || files.map(file => file.name).join(', ')).slice(0, 60);
    const answer = { role: 'ai', text: '', streaming: true, phase: '' };
    startProgress(answer, output);
    if (answer.progress) startElapsedTimer();
    let pendingPaint = 0;
    conv.messages.push(answer);
    if (!reuse) { state.files = []; state.contexts = []; const input = $('[data-chat-input]'); if (input) input.value = ''; }
    renderChips(); renderList(); renderMessages(); setBusy(true);
    // Kullanıcı mesajını hemen kaydet; uygulama cevap beklerken kapanırsa istem
    // geçmişten kaybolmasın. Streaming AI placeholder geçmişe yazılmaz.
    persistConversations();
    state.requestId = `bl${Date.now().toString(36)}${(++seq).toString(36)}`;
    try {
      // Veri isteği: Buyer Log hesaplar; LCW AI yalnız planlar (bkz. runDataQuery).
      const routed = wantsDataQuery(conv, userMessage) ? await runDataQuery({ api, conv, userMessage, answer, output }) : 'chat';
      if (routed === 'done') return;
      const computedContexts = routed && routed.contexts ? routed.contexts : null;
      /* Hazırlık tamamlanana kadar mesaja yazılmaz: yarım kalan hazırlık bir
         sonraki denemede baştan yapılır, boş liste "hazır" sanılmaz. */
      if (!computedContexts && (!userMessage.attachments || !userMessage.contexts)) {
        const pendingFiles = Array.isArray(userMessage.files) ? userMessage.files : [];
        const missing = (userMessage.fileNames || []).filter(name => !pendingFiles.some(file => file.name === name));
        if (missing.length) {
          answer.error = L(`Ekli dosyalar artık mevcut değil (${missing.join(', ')}). Dosyaları yeniden ekleyip mesajı tekrar gönderin.`, `The attached files are no longer available (${missing.join(', ')}). Add the files again and resend the message.`);
          return;
        }
        const attachments = [];
        for (let index = 0; index < pendingFiles.length; index++) {
          answer.phase = L(`Dosya yükleniyor (${index + 1}/${pendingFiles.length}): ${pendingFiles[index].name}`, `Uploading file (${index + 1}/${pendingFiles.length}): ${pendingFiles[index].name}`);
          renderMessages();
          attachments.push(await api.uploadFile(pendingFiles[index]));
        }
        const contexts = [];
        const contextImages = {};
        for (const id of userMessage.contextIds || []) {
          answer.phase = L('Buyer Log bağlamı hazırlanıyor…', 'Preparing Buyer Log context…');
          renderMessages();
          const fileLimit = state.config && state.config.limits ? state.config.limits.maxFileBytes : 20 * 1048576;
          // Dosya sınırı aşılırsa istek başarısız olmaz: satırlar sınıra göre kısaltılır ve bu açıkça yazılır.
          const prepared = contextAsFile(await api.buildContext(id), { maxBytes: Math.max(1024, fileLimit - 65536) });
          Object.assign(contextImages, prepared.images || (prepared.context && prepared.context.images) || {});
          if (prepared.images) conv.imageMap = { ...(conv.imageMap || {}), ...prepared.images };
          else if (prepared.context && prepared.context.images) { conv.imageMap = { ...(conv.imageMap || {}), ...prepared.context.images }; delete prepared.context.images; }
          // Kart bilgisi kaynak satırları: yalnız bellekte, LCW AI'a giden bağlama girmez.
          const records = prepared.records || (prepared.context && prepared.context.records);
          if (prepared.context) delete prepared.context.records;
          if (records) conv.recordMap = { ...(conv.recordMap || {}), ...records };
          if (prepared.truncated) answer.warning = L(`“${prepared.context.label}” LCW AI dosya sınırını aştığı için ilk ${prepared.truncated.sent} / ${prepared.truncated.total} satırı gönderildi. Toplam ve sayım için isteği doğrudan yazın; Buyer Log tüm kayıtlar üzerinde hesaplar.`, `“${prepared.context.label}” exceeded the LCW AI file limit, so only the first ${prepared.truncated.sent} of ${prepared.truncated.total} rows were sent. For totals and counts, just ask directly; Buyer Log calculates them on all records.`);
          if (prepared.file) {
            answer.phase = L(`Bağlam dosyası yükleniyor: ${prepared.file.name}`, `Uploading context file: ${prepared.file.name}`);
            renderMessages();
            attachments.push(await api.uploadFile(prepared.file));
          }
          contexts.push(prepared.context);
        }
        if (Object.keys(contextImages).length) {
          const maxFiles = state.config && state.config.limits ? state.config.limits.maxFilesPerRequest : 5;
          const sheets = await uploadModelImageSheets(contextImages, maxFiles - attachments.length, phase => { answer.phase = phase; renderMessages(); });
          attachments.push(...sheets.attachments);
          // Sunucu ilk bağlamları tutar; görsel açıklaması paftalarla birlikte kalsın diye başa eklenir.
          if (sheets.context) contexts.unshift(sheets.context);
        }
        userMessage.attachments = attachments;
        userMessage.contexts = contexts;
      }
      // Son sorgu sonucu bir sonraki sohbet mesajına bir kez eklenir; LCW AI geçmişi sonrasını taşır.
      const followUp = !computedContexts && conv.lastQueryContext ? [conv.lastQueryContext] : [];
      const sendContexts = computedContexts || [...(userMessage.contexts || []), ...followUp];
      answer.phase = output ? outputPhase({ step: 'generating' }, output) : L('LCW AI düşünüyor…', 'LCW AI is thinking…');
      setProgress(answer, 'generating');
      renderMessages();
      const paint = () => { if (!pendingPaint) pendingPaint = requestAnimationFrame(() => { pendingPaint = 0; if (state.activeId === conv.id) renderMessages(answer); }); };
      const result = await api.chat({
        requestId: state.requestId,
        chatId: conv.chatId,
        message: userMessage.text,
        contexts: sendContexts,
        attachments: computedContexts ? [] : userMessage.attachments,
        output,
        resolveImages: tokens => resolveImages(conv, tokens, answer),
        resolveRecords: tokens => resolveRecords(conv, tokens),
        onProgress: event => {
          // Dosya modunda ham HTML/JSON akışı gösterilmez; yalnız aşama ve
          // üretilen karakter sayısı görünür.
          if (output) {
            if (event.phase === 'output') { answer.phase = outputPhase(event, output) || answer.phase; setProgress(answer, event.step); }
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
      userMessage.delivered = true;
      if (followUp.length) conv.lastQueryContext = null;
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
      if (pendingPaint) cancelAnimationFrame(pendingPaint);
      answer.streaming = false;
      delete answer.progress;
      if (!state.conversations.some(c => c.messages.some(m => m.streaming && m.progress))) stopElapsedTimer();
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
    return send(lastUser.text, { reuse: lastUser });
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
    if (target.matches('[data-layout-control]')) {
      const openLayout=()=>window.BLLayoutControl?.open?.();
      if (window.BLLayoutControl) openLayout();
      else if (window.BLPerf?.ensureFeature) window.BLPerf.ensureFeature('layoutControl').then(openLayout).catch(() => { if (typeof showToast === 'function') showToast(L('Layout Kontrol modülü yüklenemedi.','Layout Control module could not be loaded.'), { kind: 'error' }); });
      return;
    }
    if (target.matches('[data-chat-new]')) { if (!state.busy) { state.viewingOutputs = false; newConversation(); renderList(); renderMessages(); input.focus(); } return; }
    if (target.matches('[data-chat-open]')) { if (!state.busy) { state.viewingOutputs = false; state.activeId = target.dataset.chatOpen; renderList(); renderMessages(); } return; }
    if (target.matches('[data-chat-delete]')) {
      const conv = state.conversations.find(item => item.id === target.dataset.chatDelete);
      if (!state.busy && conv && window.confirm(L('Bu cihazdaki sohbet silinsin mi? Oluşturulan dosyalar Dosyalarım’da kalır.', 'Delete this chat from this device? Created files stay in My files.'))) {
        deleteConversation(conv.id);
        ($('[data-chat-open]') || $('[data-chat-new]'))?.focus();
      }
      return;
    }
    if (target.matches('[data-chat-outputs]')) {
      state.viewingOutputs = !state.viewingOutputs;
      renderList(); renderMessages();
      if (state.viewingOutputs) loadOutputs();
      return;
    }
    if (target.matches('[data-outputs-refresh]')) { loadOutputs(); return; }
    if (target.matches('[data-chat-file]')) { fileInput.click(); return; }
    if (target.matches('[data-output-format]')) {
      state.output.format = target.dataset.outputFormat;
      // Kullanıcı şablonu biçime bağlıdır; başka biçim seçilirse şablon bırakılır.
      const chosen = selectedTemplate();
      if (chosen && chosen.item && chosen.item.definition.format !== state.output.format) state.output.template = '';
      if (chosen && chosen.kind === 'builtin') state.output.template = '';
      renderOutputBar(); input.focus(); return;
    }
    if (target.matches('[data-output-templates]')) { openTemplateManager(); return; }
    if (target.matches('[data-file-edit]')) {
      const conv = state.viewingOutputs ? null : activeConversation();
      const files = conv ? conv.messages.map(message => message && message.file) : state.outputFiles;
      const file = files.find(item => item && String(item.id) === String(target.dataset.fileEdit));
      if (file && file.draftId) openEditor(file, conv);
      return;
    }
    if (target.matches('[data-file-open], [data-file-reveal]')) {
      const api = AI();
      const opening = target.matches('[data-file-open]');
      const id = opening ? target.dataset.fileOpen : target.dataset.fileReveal;
      const files = state.viewingOutputs ? state.outputFiles : activeConversation().messages.map(message => message && message.file);
      const file = files.find(item => item && String(item.id) === String(id));
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
    if (target.matches('[data-chat-cancel]')) { state.queryCancelled = true; AI()?.cancel(state.requestId); return; }
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
    if (target.matches('[data-msg-excel]')) { exportQuery(Number(target.dataset.msgExcel)); return; }
    if (target.matches('[data-msg-option]')) {
      const [messageIndex, optionIndex] = String(target.dataset.msgOption).split(':').map(Number);
      const option = activeConversation().messages[messageIndex]?.options?.[optionIndex];
      if (option && !state.busy) send(option);
      return;
    }
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
    $('[data-output-template]').addEventListener('change', event => {
      state.output.template = event.target.value;
      const chosen = selectedTemplate();
      if (chosen && chosen.item) applyUserTemplate(chosen.kind, chosen.item);
      else renderOutputBar();
    });
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
        loadTemplates();
      }
      if (!restoreConversations()) newConversation();
      window.addEventListener('buyerlog:lcwai-open', () => { if (state.mounted) applyPendingOpen(); });
    }
    render();
    applyPendingOpen();
    if (api) api.getStatus().then(status => { state.status = status; renderConnection(); }).catch(() => { state.status = { state: 'disconnected' }; renderConnection(); });
  }

  function refreshLanguage() {
    if (state.mounted) { renderList(); renderMessages(); }
  }

  window.initLcwAiChat = initLcwAiChat;
  window.BLLcwAiChat = { init: initLcwAiChat, _state: state, send, messageHtml, progressHtml, openEditor, openTemplateManager, loadTemplates, retryLast, runDataQuery, exportQuery, queryTargets, tableContext, contextCsv, contextAsFile, detectScreens, autoContextsFor, emptyStateHtml, resolveImages, resolveRecords, modelImageSheetPlan, modelImageSheetsContext, uploadModelImageSheets, addFiles, persistConversations, restoreConversations, deleteConversation, refreshLanguage };
})();
