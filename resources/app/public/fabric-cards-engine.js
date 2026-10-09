/* ===================================================================
   KOLEKSİYON — KUMAŞ KARTLARI (saf motor)

   PLM "Main Fabric Information" metni uzun ve karmaşıktır. Bu veri
   KAYBOLMAZ: satırdaki `fabric` alanı PLM'den geldiği gibi kalır. Buyer
   Log kumaş koduna (metnin başındaki "3859-" kalıbı) bir KUMAŞ KARTI bağlar;
   tablo kartın kısa özetini gösterir, çift tık ayrıntıyı açar.

   Kurallar:
   - Kumaş kodu server/lib/plm-fabric-info.js ile aynı kalıptan okunur.
   - Kod için kart varsa LCW AI'a TEKRAR sorulmaz; aynı kodlu her yeni model
     mevcut kartı kullanır.
   - LCW AI önerisi YETKİ DEĞİLDİR: istenmeyen kod reddedilir, özet ve
     ayrıntılardaki her sayı kaynak PLM metninde geçmek zorundadır; geçmezse
     o değer atılır (uydurma gramaj/karışım karta giremez). Geçerli özet
     yoksa deterministik kural özeti kullanılır.
   - Kart yalnız kullanıcı önizleyip onayladıktan sonra kaydedilir.

   Bu dosya DOM'a dokunmaz; app-main.js'teki akış onu çağırır.
   =================================================================== */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BLFabricCards = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var SUMMARY_MAX = 80;
  var DETAIL_MAX = 200;
  var AI_BATCH_SIZE = 20;
  var RAW_CONTEXT_MAX = 700;
  var DETAIL_FIELDS = Object.freeze(['category', 'type', 'yarn', 'weight', 'composition', 'finish', 'sustainability']);
  var DETAIL_LABELS = Object.freeze({
    category: { tr: 'Kategori', en: 'Category' },
    type: { tr: 'Kumaş tipi', en: 'Fabric type' },
    yarn: { tr: 'İplik', en: 'Yarn' },
    weight: { tr: 'Gramaj', en: 'Weight' },
    composition: { tr: 'Karışım', en: 'Composition' },
    finish: { tr: 'Boya / apre', en: 'Dye / finish' },
    sustainability: { tr: 'Sürdürülebilirlik', en: 'Sustainability' },
  });

  function clean(value) { return String(value == null ? '' : value).replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim(); }
  function limit(value, max) { var text = clean(value); return text.length > max ? text.slice(0, max - 1).trim() + '…' : text; }

  /* server/lib/plm-fabric-info.js "Kumaş kodu" kalıbı: yalnız metnin
     başındaki "1234-" (3–8 hane). */
  function codeOf(raw) {
    var match = /^\s*(\d{3,8})\s*-\s*\S/.exec(String(raw == null ? '' : raw));
    return match ? match[1] : '';
  }
  function normalizeCode(value) {
    var text = clean(value);
    return /^\d{3,8}$/.test(text) ? text : '';
  }
  function bodyOf(raw) { return clean(raw).replace(/^\s*\d{3,8}\s*-\s*/, ''); }

  /* Kaynak metindeki sayılar ("30/1", "150", "%100" → 30, 1, 150, 100). */
  function numberSet(text) {
    var out = new Set();
    (String(text == null ? '' : text).match(/\d+(?:[.,]\d+)?/g) || []).forEach(function (item) {
      out.add(item.replace(',', '.'));
      String(item).split(/[.,]/).forEach(function (part) { if (part) out.add(part.replace(/^0+(?=\d)/, '')); });
    });
    return out;
  }
  function numbersSupported(value, present) {
    var found = String(value == null ? '' : value).match(/\d+(?:[.,]\d+)?/g) || [];
    return found.every(function (item) {
      var normal = item.replace(',', '.');
      return present.has(normal) || present.has(normal.replace(/^0+(?=\d)/, ''));
    });
  }

  var WEIGHT_RX = /(\d{2,4}(?:[.,]\d+)?)\s*(?:gsm|g\s*\/\s*m2|gr\s*\/\s*m2|gr\/m²|g\/m²)/i;
  var YARN_RX = /(\d{1,3}\s*\/\s*\d{1,2}\s*(?:Ne|Nm)|(?:Ne|Nm)\s*\d{1,3}(?:\s*\/\s*\d{1,2})?|\d{1,3}\s*,?\s*(?:Ne|Nm)\b|\d{2,4}\s*,?\s*(?:Denye|Denier|Den|dtex|D)\b)/i; // i18n-ignore
  var COMPOSITION_RX = /(?:%\s*\d{1,3}(?:[.,]\d+)?\s*[A-Za-zÇĞİÖŞÜçğıöşü]+|\d{1,3}(?:[.,]\d+)?\s*%\s*[A-Za-zÇĞİÖŞÜçğıöşü]+)/g; // i18n-ignore
  var TYPE_RX = /^(?:s[üu]prem|single jersey|jersey|interlo[ck]k?|ribana|rib|kaşkorse|kaskorse|pike|pique|lacoste|iki iplik|[üu][çc] iplik|two thread|three thread|polar|fleece|french terry|havlu|waffle|petek|scuba|dal[gğ][ıi][çc]|mesh|file|kadife|velvet|velour|triko|denim|poplin|twill|g[ao]bardin|keten)$/i; // i18n-ignore
  var CATEGORY_RX = /^(?:[öo]rme|knit|knitted|dokuma|woven|triko|sweater|denim)$/i; // i18n-ignore
  var FINISH_RX = /(reaktif|reactive|dispers|pigment|bask[ıi]|print|boya|dyed|enzim|enzyme|silikon|silicone|apre|finish|y[ıi]kama|wash|sardon|brushed|melanj|melange)/i; // i18n-ignore
  var SUSTAIN_RX = /(s[üu]rd[üu]r[üu]lebilir|sustainab|organi[ck]|recycled|geri d[öo]n[üu][şs][üu]ml[üu]|bci)/i; // i18n-ignore

  /* Deterministik kural kartı: LCW AI erişilemezse ya da önerisi
     doğrulanamazsa kullanılır. Değer uydurmaz; bulamadığını boş bırakır. */
  function ruleCard(raw) {
    var body = bodyOf(raw);
    var tokens = body.split(',').map(clean).filter(Boolean);
    var details = { category: '', type: '', yarn: '', weight: '', composition: '', finish: '', sustainability: '' };
    var first = tokens[0] || '', second = tokens[1] || '';
    if (CATEGORY_RX.test(first)) details.category = first;
    if (TYPE_RX.test(first)) details.type = first;
    else if (second && TYPE_RX.test(second)) details.type = second;
    else if (details.category && second && /^[^\d%]+$/.test(second) && second.length <= 30) details.type = second;
    var weight = WEIGHT_RX.exec(body);
    if (weight) details.weight = weight[1].replace(',', '.') + ' gsm';
    var yarn = YARN_RX.exec(body);
    if (yarn) details.yarn = clean(yarn[1]).replace(/\s*\/\s*/g, '/').replace(/\s*,\s*/g, ' ');
    var parts = [], seen = new Set();
    (body.match(COMPOSITION_RX) || []).forEach(function (item) {
      var text = clean(item).replace(/%\s*/g, '%').replace(/(\d)\s*%/g, '$1%');
      var key = text.toLocaleUpperCase('tr-TR');
      if (seen.has(key)) return;
      seen.add(key); parts.push(text);
    });
    details.composition = parts.join(' ');
    details.finish = tokens.filter(function (token) { return FINISH_RX.test(token) && !SUSTAIN_RX.test(token); }).join(', ');
    details.sustainability = tokens.filter(function (token) { return SUSTAIN_RX.test(token); }).join(', ');
    DETAIL_FIELDS.forEach(function (key) { details[key] = limit(details[key], DETAIL_MAX); });
    var summary = [details.type || details.category, details.yarn, details.weight, details.composition].filter(Boolean).join(' · ');
    if (!summary) summary = tokens.slice(0, 3).join(', ');
    return { code: codeOf(raw), summary: limit(summary, SUMMARY_MAX), details: details, summarySource: 'rule' };
  }

  /* LCW AI bağlamı: her kod için kaynak PLM metni (boyut sınırlı). */
  function aiContext(items) {
    var seen = new Set(), list = [];
    (Array.isArray(items) ? items : []).forEach(function (item) {
      var code = normalizeCode(item && item.code), text = clean(item && item.raw);
      if (!code || !text || seen.has(code)) return;
      seen.add(code);
      list.push(code + ' :: ' + text.slice(0, RAW_CONTEXT_MAX));
    });
    return { fabrics: list };
  }
  function chunk(items, size) {
    var list = Array.isArray(items) ? items : [], out = [], step = Math.max(1, Number(size) || AI_BATCH_SIZE);
    for (var index = 0; index < list.length; index += step) out.push(list.slice(index, index + step));
    return out;
  }

  /* "code=3859|summary=…|type=…|…" satırı → nesne. */
  function parseLine(line) {
    var out = {};
    String(line == null ? '' : line).split('|').forEach(function (part) {
      var index = part.indexOf('=');
      if (index <= 0) return;
      var key = clean(part.slice(0, index)).toLowerCase(), value = clean(part.slice(index + 1));
      if (key && !Object.prototype.hasOwnProperty.call(out, key)) out[key] = value;
    });
    return out;
  }

  /* LCW AI önerisini deterministik olarak doğrular.
     requested: [{code, raw}]  →  { cards:{code:card}, rejected:[{code,reason}] }
     Geçerli AI özeti olmayan her istenen kod kural kartına düşer. */
  function validateAiCards(lines, requested) {
    var wanted = new Map();
    (Array.isArray(requested) ? requested : []).forEach(function (item) {
      var code = normalizeCode(item && item.code);
      if (code && !wanted.has(code)) wanted.set(code, clean(item.raw));
    });
    var cards = {}, rejected = [];
    (Array.isArray(lines) ? lines : []).forEach(function (line) {
      var parsed = parseLine(line), code = normalizeCode(parsed.code);
      if (!code || !wanted.has(code)) { rejected.push({ code: clean(parsed.code), reason: 'unknown-code' }); return; }
      if (cards[code]) return;
      var raw = wanted.get(code), present = numberSet(raw);
      var summary = clean(parsed.summary);
      if (!summary) { rejected.push({ code: code, reason: 'empty-summary' }); return; }
      if (!numbersSupported(summary, present)) { rejected.push({ code: code, reason: 'unsupported-number' }); return; }
      var details = {};
      DETAIL_FIELDS.forEach(function (key) {
        var value = clean(parsed[key]);
        details[key] = value && numbersSupported(value, present) ? limit(value, DETAIL_MAX) : '';
      });
      cards[code] = { code: code, summary: limit(summary, SUMMARY_MAX), details: details, summarySource: 'ai', raw: raw };
    });
    wanted.forEach(function (raw, code) {
      if (!cards[code]) cards[code] = Object.assign(ruleCard(raw), { code: code, raw: raw });
    });
    return { cards: cards, rejected: rejected };
  }

  /* Kullanıcının düzenlediği kart (önizleme / ayrıntı penceresi). */
  function normalizeCard(input) {
    var source = input && typeof input === 'object' ? input : {};
    var code = normalizeCode(source.code);
    if (!code) return null;
    var details = {};
    DETAIL_FIELDS.forEach(function (key) { details[key] = limit(source.details && source.details[key], DETAIL_MAX); });
    var summary = limit(source.summary, SUMMARY_MAX);
    if (!summary) return null;
    var origin = clean(source.summarySource);
    return {
      code: code,
      summary: summary,
      details: details,
      summarySource: origin === 'ai' || origin === 'rule' || origin === 'manual' ? origin : 'manual',
      raw: clean(source.raw).slice(0, 4000),
    };
  }

  /* Tabloda görünen metin: kart varsa özet, yoksa PLM metninin kendisi. */
  function displayText(raw, cards) {
    var code = codeOf(raw);
    var card = code && cards && typeof cards.get === 'function' ? cards.get(code) : (code && cards ? cards[code] : null);
    return card && card.summary ? card.summary : clean(raw);
  }

  /* Satırlardan kartı olmayan kodları toplar (kod başına ilk PLM metni). */
  function missingCodes(rows, cards) {
    var out = [], seen = new Set();
    (Array.isArray(rows) ? rows : []).forEach(function (row) {
      var raw = row && row.fabric, code = codeOf(raw);
      if (!code || seen.has(code)) return;
      seen.add(code);
      var has = cards && typeof cards.has === 'function' ? cards.has(code) : Boolean(cards && cards[code]);
      if (!has) out.push({ code: code, raw: clean(raw) });
    });
    return out;
  }

  return Object.freeze({
    SUMMARY_MAX: SUMMARY_MAX,
    DETAIL_MAX: DETAIL_MAX,
    AI_BATCH_SIZE: AI_BATCH_SIZE,
    DETAIL_FIELDS: DETAIL_FIELDS,
    DETAIL_LABELS: DETAIL_LABELS,
    codeOf: codeOf,
    normalizeCode: normalizeCode,
    ruleCard: ruleCard,
    aiContext: aiContext,
    chunk: chunk,
    parseLine: parseLine,
    validateAiCards: validateAiCards,
    normalizeCard: normalizeCard,
    displayText: displayText,
    missingCodes: missingCodes,
  });
}));
