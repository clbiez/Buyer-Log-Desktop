/* ===================================================================
   Buyer Log — ÜRETİCİ KARTI MOTORU (saf, tarayıcı + Node.js)

   Kullanıcı talebi (özet): E-Mail Grupları, e-postalar ve ASAS'taki
   üreticiler TEK üretici kartında eşlenmeli; kartın analizi Orders / LFL /
   Price & Supplier Analysis'in ortak sipariş verisinden gelmeli. Kurallar ve
   otomasyonlar sipariş bazında bu kartlara göre çalışmalı.

   KARARLAR
   1) SORUMLU ÜRETİCİ TEK YERDE. Lisanslı Non-DTR siparişte Manufacturer
      alanında lisansörün adı yazar; işin sorumlusu Sub-Manufacturer'dır.
      DTR veya lisanssız siparişte sorumlu Manufacturer'dır. Non-DTR siparişte
      Sub-Manufacturer boşsa lisansöre ASLA düşülmez: sipariş "Alt Üretici
      eksik" olarak raporlanır (lisansöre e-posta gitmesi bu zincirin en pahalı
      hatasıdır).
   2) AD EŞLEŞMESİ KATIDIR. Ad yalnız büyük/küçük harf, Türkçe karakter,
      noktalama ve boşluk farkından arındırılır. Benzer adlar ÖNERİ olarak
      sunulur, kendiliğinden eşlenmez: üretici adının tam ve doğru yazılması
      kullanıcının açık şartıdır. Eski yazımlar kartta "alternatif ad" olarak
      tutulur.
   3) TERMİN PERFORMANSI. Initial Inspection tarihi ilk sözdür (PO açılırken
      verilen ex-factory). Ex-Factory revize edilince güncellenir; ilk sözden
      farklıysa onaylanmış bir revize talebidir. Yükleme Onay Tarihi (Buying Son
      Onay Tarihi) gerçek gecikmeyi verir. Initial Inspection kaynağı yoksa
      ASAS'ın ilk ex-factory değeri (_asasExFactory) temel alınır ve bu açıkça
      işaretlenir.
   =================================================================== */
(function attachManufacturerCards(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BLManufacturerCards = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createManufacturerCards() {
  'use strict';

  const DAY = 86400000;
  /* Satır anahtarları: Orders/CP (EN başlık), Backlog/ASAS (TR başlık) ve ham
     model alanları. Hepsi veri anahtarıdır, arayüz metni değildir. */
  const KEYS = Object.freeze({
    manufacturer: ['Manufacturer', 'Üretici', 'manufacturer', 'Supplier'], // i18n-ignore
    subManufacturer: ['Sub-Manufacturer', 'Sub Manufacturer', 'Alt Üretici', 'subManufacturer', 'Sub Mfr', '_subManufacturer'], // i18n-ignore
    licensor: ['Licensor', 'Lisansör', 'licensor'], // i18n-ignore
    license: ['License', 'Lisans', 'license'],
    dtrClass: ['DTR/Non-DTR', 'dtrClass'],
    country: ['Country', 'Ülke', 'Siparişin Üretildiği Ülke', 'country'], // i18n-ignore
    mag: ['Merch Alt Grup Kod', 'MAG', 'mag', 'merch'],
    orderQuantity: ['Order Quantity', 'Net Alım Sipariş Miktarı', 'Sipariş Adedi', 'qty'], // i18n-ignore
    shipmentQuantity: ['Shipment Quantity', 'Received', 'Yükleme Adedi'], // i18n-ignore
    remaining: ['Remaining Units', 'Remaining', 'Kalan Adet', 'kalan'],
    fob: ['FOB ($)', 'FOB', 'FOB Fiyatı', 'fob'], // i18n-ignore
    exFactory: ['Ex-factory', 'Ex-Factory', 'exFactory', 'ex'],
    asasExFactory: ['_asasExFactory', 'Orijinal Exfactory Merch Tarih'], // i18n-ignore
    initialInspection: ['Initial Inspection', '_initialInspection', 'Initial Inspection Tarih', 'initialInspection'],
    loadingApproval: ['Buying Son Onay Tarihi', 'Yükleme Onayı', 'shipConfirmationDate', 'shipConf'], // i18n-ignore
    orderCode: ['Order Code', 'Sipariş Kod', 'ocode'], // i18n-ignore
    modelName: ['Model Name', 'Model Adı', 'model'], // i18n-ignore
    colourCode: ['C.Code', 'Renk Kod', 'ccode'],
    season: ['Season', 'Sezon', 'season'],
    fabricCategory: ['Kumaş Kategorisi', 'fabricCategory'], // i18n-ignore
    active: ['_isActive', 'Active/Inactive'],
  });
  const MANUFACTURER_FIELD_KEYS = ['manufacturer', 'uretici', 'supplier', 'tedarikci', 'sorumlu uretici', 'responsible manufacturer'];
  /* Benzerlik önerisinde ayırt edici olmayan hukuki/sektörel ekler. */
  const NOISE_WORDS = new Set(['TEKSTIL', 'TEXTILE', 'TEXTILES', 'SAN', 'SANAYI', 'VE', 'TIC', 'TICARET', 'AS', 'A', 'S', 'LTD', 'STI', 'SIRKETI', 'CO', 'COMPANY', 'LIMITED', 'INC', 'GARMENT', 'GARMENTS', 'APPAREL', 'KONFEKSIYON', 'IC', 'DIS', 'PVT', 'LLC', 'GMBH', 'SRL', 'THE', 'AND', 'INDUSTRY', 'INDUSTRIES', 'IND']);
  const TR_FOLD = { 'ı': 'I', 'i': 'I', 'İ': 'I', 'I': 'I', 'ş': 'S', 'Ş': 'S', 'ğ': 'G', 'Ğ': 'G', 'ü': 'U', 'Ü': 'U', 'ö': 'O', 'Ö': 'O', 'ç': 'C', 'Ç': 'C' };

  function clean(value) { return String(value == null ? '' : value).trim(); }
  function nameKey(value) {
    return clean(value)
      .replace(/[ıiİIşŞğĞüÜöÖçÇ]/g, ch => TR_FOLD[ch])
      .normalize('NFKD').replace(/[̀-ͯ]/g, '')
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, ' ')
      .trim();
  }
  function pick(row, keys) {
    if (!row || typeof row !== 'object') return undefined;
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(row, key)) {
        const value = row[key];
        if (value != null && clean(value) !== '') return value;
      }
    }
    return undefined;
  }
  function text(row, keys) { const value = pick(row, keys); return value == null ? '' : clean(value); }
  function number(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    const parsed = Number(clean(value).replace(/\s/g, '').replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  function dayValue(value) {
    if (value == null || value === '') return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : Date.UTC(value.getFullYear(), value.getMonth(), value.getDate());
    if (typeof value === 'number' && Number.isFinite(value)) {
      if (value > 20000 && value < 80000) return Date.UTC(1899, 11, 30) + Math.round(value) * DAY; // Excel seri günü
      return null;
    }
    const raw = clean(value);
    // Saat taşıyan ISO değer (JSON'a çevrilmiş Date) YEREL güne indirgenir;
    // ilk 10 karakteri okumak UTC+3'te bir gün geri kaydırırdı.
    if (/^\d{4}-\d{2}-\d{2}T/.test(raw)) {
      const parsed = new Date(raw);
      return Number.isNaN(parsed.getTime()) ? null : Date.UTC(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
    }
    let match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(raw);
    if (match) return Date.UTC(+match[1], +match[2] - 1, +match[3]);
    match = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/.exec(raw);
    if (match) return Date.UTC(+match[3], +match[2] - 1, +match[1]);
    match = /^(\d{4})(\d{2})(\d{2})$/.exec(raw);
    if (match) return Date.UTC(+match[1], +match[2] - 1, +match[3]);
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : Date.UTC(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
  }
  function monthKey(day) { const date = new Date(day); return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`; }
  function isActiveRow(row) {
    const flag = pick(row, ['_isActive']);
    if (typeof flag === 'boolean') return flag;
    const state = text(row, ['Active/Inactive']);
    if (state) return /^active$/i.test(state);
    return number(pick(row, KEYS.remaining)) > 0;
  }

  /* Alıcıyı belirleyen alan "üretici" mi? (Manufacturer / Üretici / Supplier
     / kanonik manufacturer kimliği). Alt Üretici açıkça seçilirse o alan
     olduğu gibi kullanılır. */
  function isManufacturerField(field) {
    const key = nameKey(field).toLowerCase();
    return MANUFACTURER_FIELD_KEYS.includes(key);
  }

  function dtrClassOf(row) {
    const explicit = nameKey(text(row, KEYS.dtrClass));
    if (explicit === 'NON DTR' || explicit === 'NONDTR') return 'non-dtr';
    if (explicit === 'DTR') return 'dtr';
    const licensor = nameKey(text(row, KEYS.licensor));
    if (licensor === 'DTR') return 'dtr';
    return licensor ? 'non-dtr' : '';
  }

  /* Sipariş satırının SORUMLU üreticisi. */
  function responsibleManufacturer(row) {
    const manufacturer = text(row, KEYS.manufacturer);
    const sub = text(row, KEYS.subManufacturer);
    const license = text(row, KEYS.license);
    const licensed = Boolean(license);
    const dtr = dtrClassOf(row);
    if (!licensed || dtr === 'dtr') {
      return { name: manufacturer, source: 'manufacturer', licensed, dtrClass: licensed ? 'dtr' : '', licensor: '', issue: manufacturer ? '' : 'manufacturer_missing' };
    }
    // Lisanslı ve DTR değil (ya da lisansör çözülemedi): sorumlu Alt Üretici.
    if (sub) return { name: sub, source: 'subManufacturer', licensed, dtrClass: 'non-dtr', licensor: manufacturer, issue: '' };
    return { name: '', source: 'subManufacturer', licensed, dtrClass: 'non-dtr', licensor: manufacturer, issue: 'sub_manufacturer_missing' };
  }

  /* Rehber kayıtlarından ad/alternatif ad → kayıt dizini. */
  function recordNames(record) {
    const names = [clean(record && record.manufacturer)].concat(Array.isArray(record && record.aliases) ? record.aliases.map(clean) : []);
    return names.filter(Boolean);
  }
  function buildDirectoryIndex(records) {
    const index = new Map();
    for (const record of Array.isArray(records) ? records : []) {
      for (const name of recordNames(record)) {
        const key = nameKey(name);
        if (key && !index.has(key)) index.set(key, record);
      }
    }
    return index;
  }

  function parseRecipients(value) {
    const parts = String(value == null ? '' : value).replace(/\r/g, '\n').split(/[;,\n]+/).map(clean).filter(Boolean);
    const out = [], seen = new Set();
    for (const part of parts) {
      const angle = part.match(/^\s*([^<>]*)<\s*([^<>\s]+@[^<>\s]+)\s*>\s*$/);
      const email = clean(angle ? angle[2] : part).toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || seen.has(email)) continue;
      seen.add(email);
      out.push({ name: clean(angle ? angle[1] : ''), email });
    }
    return out;
  }

  /* ---------------- benzerlik önerisi ---------------- */
  function coreKey(value) {
    const words = nameKey(value).split(' ').filter(word => word && !NOISE_WORDS.has(word));
    return words.length ? words.join(' ') : nameKey(value);
  }
  function bigrams(value) {
    const s = ` ${value} `, out = new Map();
    for (let i = 0; i < s.length - 1; i += 1) { const gram = s.slice(i, i + 2); out.set(gram, (out.get(gram) || 0) + 1); }
    return out;
  }
  function similarity(a, b) {
    const left = coreKey(a), right = coreKey(b);
    if (!left || !right) return 0;
    if (left === right) return 1;
    if ((left.length >= 4 && right.startsWith(left + ' ')) || (right.length >= 4 && left.startsWith(right + ' '))) return 0.9;
    const x = bigrams(left), y = bigrams(right);
    let overlap = 0, total = 0;
    for (const [gram, count] of x) { overlap += Math.min(count, y.get(gram) || 0); total += count; }
    for (const count of y.values()) total += count;
    return total ? (2 * overlap) / total : 0;
  }
  function suggestMatches(name, candidates, limit = 3, threshold = 0.62) {
    return (Array.isArray(candidates) ? candidates : [])
      .map(candidate => ({ name: candidate, score: similarity(name, candidate) }))
      .filter(item => item.score >= threshold && nameKey(item.name) !== nameKey(name))
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'tr'))
      .slice(0, limit);
  }

  /* ---------------- termin performansı ---------------- */
  function rowDelivery(row, today) {
    const inspection = dayValue(pick(row, KEYS.initialInspection));
    const asasEx = dayValue(pick(row, KEYS.asasExFactory));
    const exFactory = dayValue(pick(row, KEYS.exFactory));
    const approval = dayValue(pick(row, KEYS.loadingApproval));
    const initial = inspection != null ? inspection : (asasEx != null ? asasEx : null);
    const baseline = inspection != null ? 'initialInspection' : (asasEx != null ? 'asasExFactory' : '');
    const out = { initial, exFactory, approval, baseline, revised: false, pulledForward: false, revisionDays: 0, delayDays: null, delayVsExFactory: null, openOverdueDays: null };
    /* Yalnız İLERİ kayma (onaylanmış erteleme talebi) revize sayılır. Tarihin
       öne çekilmesi üreticinin erken yükleme sözüdür; cezalandırılmaz, ayrıca
       sayılır (kullanıcı kararı). */
    if (initial != null && exFactory != null && exFactory !== initial) {
      out.revisionDays = Math.round((exFactory - initial) / DAY);
      if (out.revisionDays > 0) out.revised = true; else out.pulledForward = true;
    }
    if (approval != null) {
      if (initial != null) out.delayDays = Math.round((approval - initial) / DAY);
      if (exFactory != null) out.delayVsExFactory = Math.round((approval - exFactory) / DAY);
    } else if (isActiveRow(row) && exFactory != null && exFactory < today) {
      out.openOverdueDays = Math.round((today - exFactory) / DAY);
    }
    return out;
  }
  function emptyPerformance() {
    return { measured: 0, revised: 0, pulledForward: 0, revisionDaysTotal: 0, loaded: 0, onTime: 0, delayDaysTotal: 0, lateVsExFactory: 0, openOverdue: 0, openOverdueDaysTotal: 0, baselines: { initialInspection: 0, asasExFactory: 0 } };
  }
  function addPerformance(perf, delivery) {
    if (delivery.initial != null) {
      perf.measured += 1;
      perf.baselines[delivery.baseline] = (perf.baselines[delivery.baseline] || 0) + 1;
      if (delivery.revised) { perf.revised += 1; perf.revisionDaysTotal += delivery.revisionDays; }
      if (delivery.pulledForward) perf.pulledForward += 1;
    }
    if (delivery.delayDays != null) {
      perf.loaded += 1;
      if (delivery.delayDays <= 0) perf.onTime += 1;
      else perf.delayDaysTotal += delivery.delayDays;
    }
    if (delivery.delayVsExFactory != null && delivery.delayVsExFactory > 0) perf.lateVsExFactory += 1;
    if (delivery.openOverdueDays != null) { perf.openOverdue += 1; perf.openOverdueDaysTotal += delivery.openOverdueDays; }
  }
  function finishPerformance(perf) {
    const ratio = (a, b) => (b ? a / b : null);
    const onTimeRate = ratio(perf.onTime, perf.loaded);
    const revisionRate = ratio(perf.revised, perf.measured);
    const lateCount = perf.loaded - perf.onTime;
    const out = {
      measured: perf.measured, revised: perf.revised, pulledForward: perf.pulledForward, loaded: perf.loaded, onTime: perf.onTime,
      lateVsExFactory: perf.lateVsExFactory, openOverdue: perf.openOverdue,
      onTimeRate, revisionRate,
      avgRevisionDays: perf.revised ? Math.round(perf.revisionDaysTotal / perf.revised) : 0,
      avgDelayDays: lateCount ? Math.round(perf.delayDaysTotal / lateCount) : 0,
      avgOpenOverdueDays: perf.openOverdue ? Math.round(perf.openOverdueDaysTotal / perf.openOverdue) : 0,
      baseline: perf.baselines.initialInspection >= perf.baselines.asasExFactory && perf.baselines.initialInspection ? 'initialInspection' : (perf.baselines.asasExFactory ? 'asasExFactory' : ''),
      score: null, grade: '',
    };
    /* Not: zamanında yükleme %60, ilk söze sadakat %40. Az örnekle not
       verilmez — üç siparişlik bir üreticiye "D" demek yanıltıcı olurdu. */
    if (perf.loaded + perf.measured >= 3 && (onTimeRate != null || revisionRate != null)) {
      const onTime = onTimeRate != null ? onTimeRate : 1 - (revisionRate || 0);
      const promise = revisionRate != null ? 1 - revisionRate : onTime;
      const overduePenalty = Math.min(0.2, perf.openOverdue / Math.max(1, perf.measured + perf.openOverdue) * 0.4);
      const score = Math.max(0, Math.round((0.6 * onTime + 0.4 * promise - overduePenalty) * 100));
      out.score = score;
      out.grade = score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 50 ? 'C' : 'D';
    }
    return out;
  }

  function topEntries(map, total, limit) {
    return [...map.entries()].map(([name, qty]) => ({ name, qty, share: total ? qty / total : 0 }))
      .sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name, 'tr')).slice(0, limit);
  }
  function monthWindow(today, before = 6, after = 5) {
    const date = new Date(today), out = [];
    for (let offset = -before; offset <= after; offset += 1) {
      const day = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offset, 1);
      out.push(monthKey(day));
    }
    return out;
  }

  /* ---------------- kart üretimi ---------------- */
  function buildCards(rows, records, options = {}) {
    const today = dayValue(options.today == null ? new Date() : options.today);
    const directory = buildDirectoryIndex(records);
    const months = monthWindow(today);
    const currentMonth = monthKey(today);
    const cards = new Map();
    // Inventory every Orders Manufacturer label independently of routing:
    // licensed Non-DTR orders are still owned by Sub-Manufacturer.
    const sourceNames = new Map();
    const unassigned = { rows: 0, quantity: 0, orders: [], licensors: new Map() };
    let totalRows = 0;
    const cardFor = (name, key) => {
      if (!cards.has(key)) {
        cards.set(key, {
          key, name, spellings: new Map(), record: null, status: 'missing_card', inAsas: true,
          sourceOnly: false, sourceRows: 0,
          orders: 0, activeOrders: 0, quantity: 0, activeQuantity: 0, remaining: 0, shipped: 0, fobValue: 0,
          countries: new Map(), mags: new Map(), fabric: new Map(), seasons: new Set(), licensors: new Map(),
          monthly: new Map(months.map(month => [month, { month, planned: 0, loaded: 0 }])), loadedByMonth: new Map(),
          perf: emptyPerformance(), licensedOrders: 0,
        });
      }
      return cards.get(key);
    };
    for (const row of Array.isArray(rows) ? rows : []) {
      if (!row || typeof row !== 'object') continue;
      totalRows += 1;
      const sourceName = text(row, KEYS.manufacturer);
      const sourceKey = nameKey(sourceName);
      if (sourceKey) {
        let source = sourceNames.get(sourceKey);
        if (!source) {
          source = { rows: 0, spellings: new Map() };
          sourceNames.set(sourceKey, source);
        }
        source.rows += 1;
        source.spellings.set(sourceName, (source.spellings.get(sourceName) || 0) + 1);
      }
      const responsible = responsibleManufacturer(row);
      const qty = number(pick(row, KEYS.orderQuantity));
      if (!responsible.name) {
        unassigned.rows += 1; unassigned.quantity += qty;
        const code = text(row, KEYS.orderCode);
        if (code && unassigned.orders.length < 50 && !unassigned.orders.includes(code)) unassigned.orders.push(code);
        if (responsible.licensor) unassigned.licensors.set(responsible.licensor, (unassigned.licensors.get(responsible.licensor) || 0) + 1);
        continue;
      }
      const key = nameKey(responsible.name);
      const card = cardFor(responsible.name, key);
      card.spellings.set(responsible.name, (card.spellings.get(responsible.name) || 0) + 1);
      const active = isActiveRow(row);
      const remaining = number(pick(row, KEYS.remaining));
      const shipped = number(pick(row, KEYS.shipmentQuantity));
      const fob = number(pick(row, KEYS.fob));
      card.orders += 1; card.quantity += qty; card.remaining += remaining; card.shipped += shipped;
      if (fob > 0) card.fobValue += fob * qty;
      if (active) { card.activeOrders += 1; card.activeQuantity += qty; }
      const country = text(row, KEYS.country); if (country) card.countries.set(country, (card.countries.get(country) || 0) + qty);
      const mag = text(row, KEYS.mag); if (mag) card.mags.set(mag, (card.mags.get(mag) || 0) + qty);
      const fabric = text(row, KEYS.fabricCategory); if (fabric) card.fabric.set(fabric, (card.fabric.get(fabric) || 0) + qty);
      const season = text(row, KEYS.season); if (season) card.seasons.add(season);
      if (responsible.source === 'subManufacturer') {
        card.licensedOrders += 1;
        if (responsible.licensor) card.licensors.set(responsible.licensor, (card.licensors.get(responsible.licensor) || 0) + 1);
      }
      const delivery = rowDelivery(row, today);
      addPerformance(card.perf, delivery);
      if (delivery.exFactory != null) {
        const bucket = card.monthly.get(monthKey(delivery.exFactory));
        if (bucket) bucket.planned += qty;
      }
      if (delivery.approval != null) {
        const month = monthKey(delivery.approval);
        const loadedQty = shipped > 0 ? shipped : qty;
        const bucket = card.monthly.get(month);
        if (bucket) bucket.loaded += loadedQty;
        card.loadedByMonth.set(month, (card.loadedByMonth.get(month) || 0) + loadedQty);
      }
    }

    // Orders Manufacturer labels must be searchable even when they only occur
    // on Non-DTR rows. Their reference-only cards have zero responsible orders:
    // delivery statistics and email recipients remain assigned to the actual
    // Sub-Manufacturer, not to the source label (which can be a licensor).
    for (const [key, source] of sourceNames) {
      let card = cards.get(key);
      if (!card) {
        const name = [...source.spellings.entries()]
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'tr'))[0][0];
        card = cardFor(name, key);
        card.sourceOnly = true;
        card.spellings = new Map(source.spellings);
      }
      card.sourceRows = source.rows;
    }

    const asasNames = [];
    const out = [];
    for (const card of cards.values()) {
      // En sık geçen yazım kartın ASAS adıdır.
      card.name = [...card.spellings.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'tr'))[0][0];
      asasNames.push(card.name);
      card.record = directory.get(card.key) || null;
      card.status = card.record ? 'linked' : 'missing_card';
    }
    const usedRecords = new Set();
    for (const card of cards.values()) if (card.record) usedRecords.add(card.record.id || card.record);
    const pastMonths = months.filter(month => month < currentMonth).slice(-6);
    for (const card of cards.values()) {
      const loadedPast = pastMonths.reduce((sum, month) => sum + (card.loadedByMonth.get(month) || 0), 0);
      out.push(finishCard(card, { avgMonthlyLoaded: pastMonths.length ? Math.round(loadedPast / pastMonths.length) : 0 }));
    }
    // ASAS'ta karşılığı olmayan rehber kayıtları da kart olarak görünür.
    for (const record of Array.isArray(records) ? records : []) {
      if (!record || usedRecords.has(record.id || record)) continue;
      const name = clean(record.manufacturer);
      out.push({
        key: nameKey(name) || `record:${record.id}`, name, record, status: 'not_in_asas', inAsas: false,
        sourceOnly: false, sourceRows: 0,
        orders: 0, activeOrders: 0, quantity: 0, activeQuantity: 0, remaining: 0, shipped: 0, fobValue: 0,
        countries: [], mags: [], fabric: [], seasons: [], licensors: [], licensedOrders: 0,
        monthly: months.map(month => ({ month, planned: 0, loaded: 0 })), avgMonthlyLoaded: 0,
        performance: finishPerformance(emptyPerformance()),
        recipients: parseRecipients(record.email),
        suggestions: suggestMatches(name, asasNames),
      });
    }
    out.sort((a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name, 'tr'));
    const stats = {
      rows: totalRows,
      asasManufacturers: cards.size,
      linked: out.filter(card => card.status === 'linked').length,
      missingCard: out.filter(card => card.status === 'missing_card').length,
      notInAsas: out.filter(card => card.status === 'not_in_asas').length,
      missingEmail: out.filter(card => card.record && !card.recipients.length).length,
    };
    return {
      cards: out, stats, months, asasNames: asasNames.sort((a, b) => a.localeCompare(b, 'tr')),
      unassigned: { rows: unassigned.rows, quantity: unassigned.quantity, orders: unassigned.orders, licensors: topEntries(unassigned.licensors, unassigned.rows, 10).map(item => ({ name: item.name, orders: item.qty })) },
    };
  }

  function finishCard(card, extra) {
    return {
      key: card.key, name: card.name, record: card.record, status: card.status, inAsas: true,
      sourceOnly: card.sourceOnly, sourceRows: card.sourceRows,
      spellings: [...card.spellings.keys()],
      orders: card.orders, activeOrders: card.activeOrders, quantity: card.quantity, activeQuantity: card.activeQuantity,
      remaining: card.remaining, shipped: card.shipped, fobValue: Math.round(card.fobValue),
      countries: topEntries(card.countries, card.quantity, 5),
      mags: topEntries(card.mags, card.quantity, 30),
      fabric: topEntries(card.fabric, card.quantity, 5),
      seasons: [...card.seasons].sort(),
      licensors: topEntries(card.licensors, card.licensedOrders, 5).map(item => ({ name: item.name, orders: item.qty })),
      licensedOrders: card.licensedOrders,
      monthly: [...card.monthly.values()],
      avgMonthlyLoaded: extra.avgMonthlyLoaded,
      performance: finishPerformance(card.perf),
      recipients: card.record ? parseRecipients(card.record.email) : [],
      suggestions: [],
    };
  }

  /* Otomasyon: satırları sorumlu üreticiye göre kova kovaya ayırır ve her
     kovayı rehberdeki karta bağlar. Çözülemeyenler sebebiyle döner. */
  function splitRowsByResponsibleManufacturer(rows, book) {
    const index = new Map();
    for (const entry of Array.isArray(book) ? book : []) {
      for (const name of [entry && entry.name].concat(entry && Array.isArray(entry.aliases) ? entry.aliases : [])) {
        const key = nameKey(name);
        if (key && !index.has(key)) index.set(key, entry);
      }
    }
    const buckets = new Map(), missingSub = { rows: 0, orders: [] };
    for (const row of Array.isArray(rows) ? rows : []) {
      const responsible = responsibleManufacturer(row);
      if (!responsible.name) {
        missingSub.rows += 1;
        const code = text(row, KEYS.orderCode);
        if (code && missingSub.orders.length < 20 && !missingSub.orders.includes(code)) missingSub.orders.push(code);
        continue;
      }
      const key = nameKey(responsible.name);
      if (!buckets.has(key)) buckets.set(key, { value: responsible.name, rows: [] });
      buckets.get(key).rows.push(row);
    }
    // Aynı karta çıkan farklı yazımlar (alternatif adlar) TEK e-postada birleşir.
    const byEntry = new Map(), unresolved = [];
    for (const [key, bucket] of buckets) {
      const entry = index.get(key) || null;
      if (entry && Array.isArray(entry.to) && entry.to.length) {
        if (!byEntry.has(entry)) byEntry.set(entry, { value: entry.name || bucket.value, group: entry, rows: [] });
        byEntry.get(entry).rows.push(...bucket.rows);
      } else unresolved.push({ value: bucket.value, rows: bucket.rows.length, reason: entry ? 'no_email' : 'no_card' });
    }
    const resolved = [...byEntry.values()];
    if (missingSub.rows) unresolved.push({ value: '(Sub-Manufacturer)', rows: missingSub.rows, reason: 'sub_manufacturer_missing', orders: missingSub.orders });
    resolved.sort((a, b) => a.value.localeCompare(b.value, 'tr', { sensitivity: 'base' }));
    return { resolved, unresolved };
  }

  return Object.freeze({
    KEYS, nameKey, coreKey, similarity, suggestMatches, dayValue, parseRecipients,
    isManufacturerField, dtrClassOf, responsibleManufacturer, buildDirectoryIndex,
    rowDelivery, buildCards, splitRowsByResponsibleManufacturer,
  });
});
