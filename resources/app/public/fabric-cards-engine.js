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

  var SUMMARY_MAX = Infinity; // No arbitrary character limit on user-edited card fields.
  var DETAIL_MAX = Infinity;
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
  function limit(value, max) { var text = clean(value); return Number.isFinite(max) && text.length > max ? text.slice(0, max) : text; }

  /* Kumaş kodu: kumaş metninin başındaki "1234-" ya da "100000627-"
     (3–12 hane). Çok kumaşlı hücrede her kumaş "A - 3859-…", "B - 361819-…"
     biçiminde harfle başlar; her biri ayrı karttır. */
  var PART_RX = /(^|[\s;,|/])([A-Z])\s*[-–:]\s*(?=\d{3,12}\s*-\s*\S)/g;
  var LEAD_RX = /^\s*(\d{3,12})\s*-\s*\S/;
  function parts(raw) {
    var text = String(raw == null ? '' : raw).replace(/\r/g, '');
    var marks = [], match;
    PART_RX.lastIndex = 0;
    while ((match = PART_RX.exec(text))) marks.push({ label: match[2], start: match.index + match[1].length, body: match.index + match[0].length });
    var segments = marks.length
      ? marks.map(function (mark, index) { return { label: mark.label, text: text.slice(mark.body, index + 1 < marks.length ? marks[index + 1].start : text.length) }; })
      : [{ label: '', text: text }];
    var out = [];
    segments.forEach(function (segment) {
      var lead = LEAD_RX.exec(segment.text);
      // "A - 3859-… / B - 2832-…" yazımında ayırıcı bir önceki kumaşa ait değildir.
      if (lead) out.push({ label: segment.label, code: lead[1], raw: clean(segment.text).replace(/\s*[\/;,|]$/, '') });
    });
    return out;
  }
  function codeOf(raw) { var list = parts(raw); return list.length ? list[0].code : ''; }
  function normalizeCode(value) {
    var text = clean(value);
    return /^\d{3,12}$/.test(text) ? text : '';
  }
  function bodyOf(raw) { return clean(raw).replace(/^\s*\d{3,12}\s*-\s*/, ''); }

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

  /* Kural kartının iki dilli özeti için kumaş terimleri sözlüğü.
     [Türkçe, İngilizce]; uzun terim önce eşleşir. */
  var TERMS = [
    ['Geri Dönüşümlü Pamuk', 'Recycled Cotton'], ['Geri Dönüşümlü Polyester', 'Recycled Polyester'], ['Geri Dönüşümlü Polyester', 'Recycled Poliester'], ['Organik Pamuk', 'Organic Cotton'], // i18n-ignore
    ['İki İplik', 'Two Thread', 'type'], ['Üç İplik', 'Three Thread', 'type'], ['Süprem', 'Single Jersey', 'type'], ['Ribana', 'Rib', 'type'], ['Kaşkorse', 'Rib', 'type'], // i18n-ignore
    ['Interlok', 'Interlock', 'type'], ['Pike', 'Pique', 'type'], ['Polar', 'Fleece', 'type'], ['Havlu', 'Terry', 'type'], ['Petek', 'Waffle', 'type'], ['Dalgıç', 'Scuba', 'type'], // i18n-ignore
    ['Kadife', 'Velvet', 'type'], ['Triko', 'Knitwear', 'type'], ['Örme', 'Knit'], ['Dokuma', 'Woven'], ['Pamuk', 'Cotton'], ['Polyester', 'Poliester'], // i18n-ignore
    ['Elastan', 'Elastane'], ['Viskon', 'Viscose'], ['Viskoz', 'Viscose'], ['Keten', 'Linen'], ['Yün', 'Wool'], ['Akrilik', 'Acrylic'], // i18n-ignore
    ['Poliamid', 'Polyamide'], ['Organik', 'Organic'], ['Penye', 'Combed'], ['Karde', 'Carded'], ['Denye', 'Denier'], // i18n-ignore
  ];
  function escapeRx(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  /* Fabric Card summaries follow the product's TR/EN spelling convention.
     Correct old/manual/AI summaries at the boundary, without mutating the
     original PLM text or non-summary details. Match whole fibre names only. */
  function normalizeSummaryPolyester(value, lang) {
    var canonical = lang === 'en' ? 'Poliester' : 'Polyester';
    return String(value == null ? '' : value).replace(/(^|[^A-Za-zÇĞİÖŞÜçğıöşü])(polyester|poliester)(?=$|[^A-Za-zÇĞİÖŞÜçğıöşü])/gi, function (_match, lead, word) {
      var replacement = word === word.toUpperCase() ? canonical.toUpperCase() : word[0] === word[0].toLowerCase() ? canonical.toLowerCase() : canonical;
      return lead + replacement;
    });
  }
  function translateTerms(text, lang) {
    var from = lang === 'en' ? 0 : 1, to = lang === 'en' ? 1 : 0;
    var pairs = TERMS.slice().sort(function (a, b) { return b[from].length - a[from].length; });
    var out = String(text == null ? '' : text);
    var marks = [];
    pairs.forEach(function (pair) {
      if (pair[0] === pair[1]) return;
      // Türkçe özette kumaş tipi adı PLM'de yazıldığı gibi kalır (Scuba ≠ Dalgıç).
      if (lang !== 'en' && pair[2] === 'type') return;
      var rx = new RegExp('(^|[^A-Za-zÇĞİÖŞÜçğıöşü])(' + escapeRx(pair[from]) + ')(?![A-Za-zÇĞİÖŞÜçğıöşü])', 'gi'); // i18n-ignore
      out = out.replace(rx, function (all, lead) { marks.push(pair[to]); return lead + '\u0001' + (marks.length - 1) + '\u0002'; });
    });
    out = out.replace(/\u0001(\d+)\u0002/g, function (_, index) { return marks[Number(index)]; });
    // Both Turkish and English use 100% Cotton / 100% Pamuk notation.
    return normalizeSummaryPolyester(normalizeComposition(out.replace(/%\s*(\d{1,3}(?:[.,]\d+)?)\s*/g, '$1% ')), lang);
  }
  /* Canonical blend formatter: percentages on the right in both languages,
     fibres ordered by descending percentage. Works with saved/legacy/manual/AI
     cards; only recognized percentage+fibre tokens are reordered. */
  var FIBRE_NAMES = [
    'Geri Dönüşümlü Polyester','Geri Dönüşümlü Pamuk','Recycled Polyester','Recycled Cotton',
    'Organik Pamuk','Organic Cotton','Poliester','Polyester','Poliamid','Polyamide',
    'Viskon','Viskoz','Viscose','Akrilik','Acrylic','Elastan','Elastane','Lycra',
    'Pamuk','Cotton','Yün','Wool','Keten','Linen','Modal','Lyocell','Tencel',
    'Naylon','Nylon','Bambu','Bamboo','Asetat','Acetate','Kaşmir','Cashmere','İpek','Silk'
  ].sort(function(a,b){return b.length-a.length;});
  var FIBRE_RX = new RegExp('(%\\s*\\d{1,3}(?:[.,]\\d+)?|\\d{1,3}(?:[.,]\\d+)?\\s*%)\\s*('+
    FIBRE_NAMES.map(escapeRx).join('|')+')(?=$|[^A-Za-zÇĞİÖŞÜçğıöşü])','gi'); // i18n-ignore
  function formatPercentage(value){return String(value).replace(/^%\s*/,'').replace(/\s*%$/,'').trim()+'%';}
  function normalizeComposition(value){
    var src=clean(value),matches=[],hit;
    FIBRE_RX.lastIndex=0;
    while((hit=FIBRE_RX.exec(src))!==null){
      var amount=Number(hit[1].replace(/[%\s]/g,'').replace(',','.'));
      if(!Number.isFinite(amount))continue;
      matches.push({start:hit.index,end:FIBRE_RX.lastIndex,text:formatPercentage(hit[1])+' '+hit[2],amount:amount});
    }
    if(!matches.length)return src;
    var out='',cursor=0,i=0;
    while(i<matches.length){
      var j=i+1;
      while(j<matches.length && /^\s*(?:[,;/]\s*)?$/.test(src.slice(matches[j-1].end,matches[j].start)))j++;
      out+=src.slice(cursor,matches[i].start);
      out+=matches.slice(i,j).sort(function(a,b){return b.amount-a.amount||a.start-b.start;}).map(function(e){return e.text;}).join(' ');
      cursor=matches[j-1].end;i=j;
    }
    return out+src.slice(cursor);
  }
  function languageSummary(summary, lang) { return limit(normalizeComposition(translateTerms(summary, lang).replace(/\\s+·/g, ' ·')), SUMMARY_MAX); }

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
    details.composition = normalizeComposition(parts.join(' '));
    details.finish = tokens.filter(function (token) { return FINISH_RX.test(token) && !SUSTAIN_RX.test(token); }).join(', ');
    details.sustainability = tokens.filter(function (token) { return SUSTAIN_RX.test(token); }).join(', ');
    DETAIL_FIELDS.forEach(function (key) { details[key] = limit(details[key], DETAIL_MAX); });
    var summary = [details.type || details.category, details.yarn, details.weight, details.composition].filter(Boolean).join(' · ');
    if (!summary) summary = tokens.slice(0, 3).join(', ');
    var lead = LEAD_RX.exec(clean(raw));
    return { code: lead ? lead[1] : '', summary: languageSummary(summary, 'tr'), summaryEn: languageSummary(summary, 'en'), details: details, summarySource: 'rule' };
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
      var summaryEn = clean(parsed.summaryen || parsed.summary_en);
      if (!summary) { rejected.push({ code: code, reason: 'empty-summary' }); return; }
      if (!numbersSupported(summary, present)) { rejected.push({ code: code, reason: 'unsupported-number' }); return; }
      // İngilizce özet doğrulanamazsa Türkçe özetin sözlük çevirisi kullanılır.
      if (!summaryEn || !numbersSupported(summaryEn, present)) summaryEn = translateTerms(summary, 'en');
      var details = {};
      DETAIL_FIELDS.forEach(function (key) {
        var value = clean(parsed[key]);
        details[key] = value && numbersSupported(value, present) ? (key === 'composition' ? normalizeComposition(value) : limit(value, DETAIL_MAX)) : '';
      });
      cards[code] = { code: code, summary: normalizeSummaryPolyester(normalizeComposition(summary), 'tr'), summaryEn: normalizeSummaryPolyester(normalizeComposition(summaryEn), 'en'), details: details, summarySource: 'ai', raw: raw };
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
    DETAIL_FIELDS.forEach(function (key) { var value=limit(source.details && source.details[key], DETAIL_MAX); details[key]=key==='composition'?normalizeComposition(value):value; });
    var summary = normalizeSummaryPolyester(normalizeComposition(limit(source.summary, SUMMARY_MAX)), 'tr');
    if (!summary) return null;
    var summaryEn = normalizeSummaryPolyester(normalizeComposition(limit(source.summaryEn, SUMMARY_MAX)), 'en') || languageSummary(summary, 'en');
    var origin = clean(source.summarySource);
    return {
      code: code,
      summary: summary,
      summaryEn: summaryEn,
      details: details,
      summarySource: origin === 'ai' || origin === 'rule' || origin === 'manual' ? origin : 'manual',
      raw: clean(source.raw).slice(0, 4000),
    };
  }

  /* Kartın aktif dildeki özeti (EN yoksa TR). */
  function summaryFor(card, lang) {
    if (!card) return '';
    // Eski (yalnız TR özetli) kartta EN görünüm sözlük çevirisine düşer.
    return normalizeSummaryPolyester(normalizeComposition(lang === 'en' ? clean(card.summaryEn) || (card.summary ? languageSummary(card.summary, 'en') : '') : clean(card.summary) || clean(card.summaryEn)), lang);
  }
  /* Tabloda görünen metin: kart varsa aktif dildeki özet, yoksa PLM metni. */
  function cardOf(cards, code) {
    return code && cards ? (typeof cards.get === 'function' ? cards.get(code) : cards[code]) || null : null;
  }
  function displayText(raw, cards, lang) {
    var list = parts(raw);
    if (!list.length) return clean(raw);
    if (list.length === 1 && !list[0].label) return summaryFor(cardOf(cards, list[0].code), lang) || clean(raw);
    return list.map(function (part) {
      var summary = summaryFor(cardOf(cards, part.code), lang);
      return (part.label ? part.label + ' · ' : '') + (summary ? part.code + ' · ' + summary : part.raw);
    }).join(' / ');
  }

  /* Yapıştırılan/yazılan kumaş metnini kanonik PLM biçimine çevirir
     ("3859-…", takımda "A - 3859-… / B - 2832-…"); böylece hücre kart
     görünümüne geçer. Tanınanlar:
     - PLM metni → olduğu gibi.
     - CP/Orders/Koleksiyon panosundaki görünen biçim: "3859 · özet",
       "A · 3859 · özet / B - 2832 · özet". Kodun kartı varsa kartın PLM
       metni, yoksa "kod-özet" yazılır (çift tıkla kart oluşturulur).
     - Kodsuz özet ya da PLM ayrıntısı: yalnız TEK bir kartın özetine/PLM
       metnine birebir uyuyorsa o karta bağlanır; tahmin yapılmaz.
     Tanınmayan metin değişmeden kalır. */
  var DISPLAY_SEG_RX = /^\s*(?:([A-Z])\s*[-–:·]\s*)?(\d{3,12})\s*([·|:\-–]|\s)\s*(\S[\s\S]*)$/;
  function eachCard(cards, fn) {
    if (!cards) return;
    if (typeof cards.forEach === 'function' && typeof cards.get === 'function') cards.forEach(function (card) { fn(card); });
    else Object.keys(cards).forEach(function (key) { fn(cards[key]); });
  }
  function rawForCode(code, fallback, cards) {
    var raw = clean(cardOf(cards, code) && cardOf(cards, code).raw).replace(/\s*[\/;,|]\s*$/, '');
    var lead = LEAD_RX.exec(raw);
    return lead && lead[1] === code ? raw : code + '-' + clean(fallback).replace(/\s*·\s*/g, ', ');
  }
  function displaySegment(text, cards) {
    var match = DISPLAY_SEG_RX.exec(text);
    if (!match) return null;
    var code = match[2], rest = clean(match[4]);
    // "150 gsm …" gibi boşlukla ayrılmış sayı yalnız kartı olan bir kodsa kumaş kodudur.
    if (!rest || (/\s/.test(match[3]) && !cardOf(cards, code))) return null;
    return { label: match[1] || '', raw: rawForCode(code, rest, cards) };
  }
  function matchKey(value) { return normalizeComposition(clean(value)).toLocaleLowerCase('tr-TR').replace(/[\s·,;]+/g, ' ').trim(); }
  function matchCard(text, cards) {
    var key = matchKey(text), found = null, ambiguous = false;
    if (!key) return null;
    eachCard(cards, function (card) {
      var code = normalizeCode(card && card.code);
      if (!code || ambiguous) return;
      var raw = clean(card.raw);
      var keys = [card.summary, card.summaryEn, summaryFor(card, 'tr'), summaryFor(card, 'en'), raw, bodyOf(raw)].map(matchKey);
      if (keys.indexOf(key) < 0) return;
      if (found && found !== code) ambiguous = true;
      else found = code;
    });
    return ambiguous ? null : found;
  }
  function resolveInput(value, cards) {
    var original = String(value == null ? '' : value), text = original.replace(/\r/g, '').trim();
    if (!text || parts(text).length) return original;
    var pieces = text.split(/\s+\/\s+|\n+/).map(clean).filter(Boolean);
    var segments = pieces.map(function (piece) { return displaySegment(piece, cards); });
    if (segments.length && segments.every(Boolean)) {
      if (segments.length === 1) return (segments[0].label ? segments[0].label + ' - ' : '') + segments[0].raw;
      // Tek satır: yapıştırma/yazma editörü (input) satır sonunu siler.
      return segments.map(function (segment, index) { return (segment.label || String.fromCharCode(65 + index)) + ' - ' + segment.raw; }).join(' / ');
    }
    var code = matchCard(text, cards);
    return code ? rawForCode(code, bodyOf(text), cards) : original;
  }

  /* Satırlardan kartı olmayan kodları toplar (kod başına ilk PLM metni). */
  function missingCodes(rows, cards) {
    var out = [], seen = new Set();
    (Array.isArray(rows) ? rows : []).forEach(function (row) {
      parts(row && row.fabric).forEach(function (part) {
        if (seen.has(part.code)) return;
        seen.add(part.code);
        if (!cardOf(cards, part.code)) out.push({ code: part.code, raw: part.raw });
      });
    });
    return out;
  }

  return Object.freeze({
    SUMMARY_MAX: SUMMARY_MAX,
    DETAIL_MAX: DETAIL_MAX,
    AI_BATCH_SIZE: AI_BATCH_SIZE,
    DETAIL_FIELDS: DETAIL_FIELDS,
    DETAIL_LABELS: DETAIL_LABELS,
    parts: parts,
    codeOf: codeOf,
    normalizeCode: normalizeCode,
    ruleCard: ruleCard,
    aiContext: aiContext,
    chunk: chunk,
    parseLine: parseLine,
    validateAiCards: validateAiCards,
    normalizeCard: normalizeCard,
    translateTerms: translateTerms,
    normalizeSummaryPolyester: normalizeSummaryPolyester,
    normalizeComposition: normalizeComposition,
    summaryFor: summaryFor,
    displayText: displayText,
    missingCodes: missingCodes,
    resolveInput: resolveInput,
    rawForCode: rawForCode,
  });
}));
