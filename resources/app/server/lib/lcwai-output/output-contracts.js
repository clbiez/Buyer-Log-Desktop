'use strict';

/*
 * Çıktı sözleşmeleri: LCW AI'a verilen biçim talimatı + dönen cevabın
 * ayrıştırılması, doğrulanması ve normalize edilmesi.
 *
 *   html / pdf  → HTML belge (Buyer Log rapor sınıflarıyla)
 *   xlsx        → WORKBOOK JSON
 *   pptx        → PRESENTATION JSON
 *
 * parseOutput() döner: { ok, data, explanation, errors[], warnings[] }.
 * ok=false ise errors onarım (repair) mesajına girer; küçük kusurlar
 * (fazla satır, bilinmeyen düzen…) sessizce düzeltilir ve warnings'e yazılır.
 */
const { extractHtml, sanitizeHtml, sanitizeStyleSheet, visibleText } = require('./output-html');
const { extractJsonObject } = require('../lcwai/lcwai-prompt');
const BLOutputLayout = require('../../../public/lcwai-output-layout');
// Yerleşim (Yerleşim aracı): verilmişse sınır içine alınır, yoksa null → varsayılan.
const layoutOf = (format, raw) => (raw && typeof raw === 'object' && !Array.isArray(raw) ? BLOutputLayout.normalizeLayout(format, raw) : null);

const FORMATS = Object.freeze(['pdf', 'xlsx', 'pptx', 'html']);
const FORMAT_LABEL = Object.freeze({ pdf: 'PDF', xlsx: 'Excel', pptx: 'PowerPoint', html: 'HTML' });
/* Tablo satırı/hücresi eskiden 12 satır × 80 karakterle kesiliyordu; kumaş
   ve kompozisyon gibi uzun alanlar sessizce kısalıyordu. Uzun tablo artık
   PPTX'te devam slaytlarına bölünür (output-pptx), hücre metni korunur. */
const LIMITS = Object.freeze({
  slides: 40, bullets: 8, bulletChars: 400, kpis: 6, tableCols: 8, tableRows: 60, tableCellChars: 400, tableHeaderChars: 80, chartCategories: 12, chartSeries: 3,
  sheets: 10, sheetCols: 40, sheetRows: 5000, titleChars: 140,
});
const COLUMN_TYPES = ['text', 'integer', 'number', 'percent', 'currency', 'date', 'image'];
const LAYOUTS = ['title', 'section', 'bullets', 'kpis', 'table', 'chart', 'comparison', 'summary', 'gallery'];
// Galeri slaytı Yerleşim ızgarasına göre devam slaytlarına bölünür (output-pptx).
const GALLERY_ITEMS = 60;
// Model görseli anahtarı (bağlam CSV'sindeki "BL Image" sütunu): KOL-3, CP-12…
const IMAGE_TOKEN = /^[A-Z]{2,4}-\d{1,6}$/;
const imageToken = value => { const token = String(value == null ? '' : value).trim().toUpperCase(); return IMAGE_TOKEN.test(token) ? token : ''; };

/* Model görselleri: LCW AI görseli görmez; bağlamdaki anahtarı yer tutucu
   olarak yazar, Buyer Log gerçek görseli kendi yerel deposundan gömer. */
function imageInstruction(format, english) {
  const head = english
    ? 'MODEL IMAGES: if the Buyer Log context (CSV) has a "BL Image" column, each value (e.g. KOL-3) is the key of that record\'s real product image held by Buyer Log. You cannot see the images; never write "image not available" for a record that has a key. '
    : 'MODEL GÖRSELLERİ: Buyer Log bağlamında (CSV) "BL Image" sütunu varsa her değer (ör. KOL-3) o kaydın Buyer Log’daki gerçek ürün görselinin anahtarıdır. Görselleri göremezsin; anahtarı olan kayıt için asla "görsel yok" yazma. ';
  const how = {
    html: english ? 'Place it with <img class="bl-model-img" data-bl-image="KOL-3" alt="model name"> (no src); Buyer Log inserts the real picture. Model cards: <div class="bl-gallery"><div class="bl-card"><img class="bl-model-img" data-bl-image="…" alt="…"><h3>…</h3>…</div></div>.' : 'Görseli <img class="bl-model-img" data-bl-image="KOL-3" alt="model adı"> ile koy (src yazma); gerçek resmi Buyer Log ekler. Model kartları: <div class="bl-gallery"><div class="bl-card"><img class="bl-model-img" data-bl-image="…" alt="…"><h3>…</h3>…</div></div>.',
    pptx: english ? 'For model visuals use the "gallery" layout: {"layout":"gallery","title":"…","items":[{"title":"model","subtitle":"…","note":"…","image":"KOL-3","tone":"ok|warn|risk|info"}]} (put all models of a group in ONE gallery slide, up to 60 items; Buyer Log places them on the user’s layout grid and continues on extra slides). A "bullets" slide may also take "image":"KOL-3".' : 'Model görselleri için "gallery" düzenini kullan: {"layout":"gallery","title":"…","items":[{"title":"model","subtitle":"…","note":"…","image":"KOL-3","tone":"ok|warn|risk|info"}]} (bir grubun tüm modellerini TEK gallery slaytına koy, en fazla 60 öğe; Buyer Log onları kullanıcının yerleşim ızgarasına dizer ve devam slaytlarına böler). "bullets" slaytı da "image":"KOL-3" alabilir.',
    xlsx: english ? 'To show pictures add a column {"header":"Image","type":"image"} whose cells hold the key (e.g. "KOL-3"); Buyer Log embeds the picture in the cell.' : 'Resim göstermek için {"header":"Görsel","type":"image"} sütunu ekle; hücrelerine anahtarı (ör. "KOL-3") yaz, Buyer Log resmi hücreye gömer.',
  };
  return head + (format === 'pptx' ? how.pptx : format === 'xlsx' ? how.xlsx : how.html);
}
const TONES = ['ok', 'warn', 'risk', 'info'];

const clean = (value, max = 4000) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
const isObject = value => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const asArray = value => (Array.isArray(value) ? value : []);

function normalizeFormat(value) {
  const key = String(value || '').toLowerCase().replace(/^\./, '');
  if (key === 'excel' || key === 'xls') return 'xlsx';
  if (key === 'powerpoint' || key === 'ppt' || key === 'slides') return 'pptx';
  if (key === 'htm') return 'html';
  return FORMATS.includes(key) ? key : null;
}

/* ---------------- Talimat (prompt) ---------------- */
const DETAIL = {
  summary: { tr: 'Kısa: PDF/HTML için 1–2 sayfa; sunum için 5–7 slayt.', en: 'Brief: 1–2 pages for PDF/HTML; 5–7 slides for a deck.' },
  standard: { tr: 'Standart: PDF/HTML için 2–4 sayfa; sunum için 8–12 slayt.', en: 'Standard: 2–4 pages for PDF/HTML; 8–12 slides for a deck.' },
  detailed: { tr: 'Detaylı: kapsamlı; sunum için 12–18 slayt.', en: 'Detailed: comprehensive; 12–18 slides for a deck.' },
};

function htmlInstruction({ format, english, orientation }) {
  const lines = english ? [
    `Return ONE complete HTML document inside a single \`\`\`html code block. Buyer Log will turn it into ${format === 'pdf' ? `an A4 ${orientation} PDF` : 'an HTML file'}; anything outside the code block is shown to the user as a short note.`,
    'Write only the content inside <body>; Buyer Log adds its own theme, header, fonts and colours. Do NOT write <script>, event handlers, <iframe>, <form>, external links to CSS/fonts/images, or remote images. Inline <svg> charts are allowed. Avoid custom CSS; if needed keep it to small layout tweaks in one <style>.',
    'Use these Buyer Log classes: <h1> title, <p class="bl-lead"> intro; <section class="bl-section"> per section with <h2>; KPIs: <div class="bl-kpis"><div class="bl-kpi ok|warn|risk"><span class="bl-kpi-label">…</span><span class="bl-kpi-value">…</span><span class="bl-kpi-note">…</span></div></div>; cards: <div class="bl-grid"><div class="bl-card"><h3>…</h3>…</div></div>; notes: <div class="bl-callout ok|warn|risk">…</div>; tables: <div class="bl-table-wrap"><table><thead>…</thead><tbody>…</tbody></table></div> with <td class="num"> for numbers; status: <span class="bl-badge ok|warn|risk|info">…</span>; bar charts: <div class="bl-bars"><div class="bl-bar warn"><span>Label</span><span class="bl-bar-track"><span class="bl-bar-fill" style="width:62%"></span></span><span>62</span></div></div>.',
    'More components: progress rings <div class="bl-rings"><div class="bl-ring-card"><div class="bl-ring ok|warn|risk" style="--bl-p:72">72%</div><div class="bl-ring-label">…</div></div></div>; progress bar <div class="bl-progress"><span class="bl-progress-fill" style="width:40%"></span></div>; timeline <ol class="bl-timeline"><li class="ok|warn|risk"><time>…</time>…</li></ol>; numbered actions <ol class="bl-steps"><li><div>…</div></li></ol>; trend <span class="bl-trend up|down">▲ 4%</span>; tone cards <div class="bl-card ok|warn|risk">.',
    'Make it visual and lively, not a wall of text: lead with KPIs, show comparisons as bars/rings, use cards, timelines and tone colours (ok/warn/risk) to guide the eye; keep paragraphs short.',
    format === 'pdf' ? 'The document is printed: no interactive elements, keep tables narrow enough for the page, prefer several short tables over one very wide table.' : 'The file is opened in a browser offline; keep it self-contained. Entrance animations (sections, KPIs, bars, rings) are added automatically; you may add small extra CSS @keyframes animations or <details class="bl-details"> folds, but never JavaScript.',
  ] : [
    `Tek bir \`\`\`html kod bloğu içinde TEK ve tam bir HTML belge döndür. Buyer Log bunu ${format === 'pdf' ? `A4 ${orientation === 'landscape' ? 'yatay' : 'dikey'} PDF'e` : 'HTML dosyasına'} çevirecek; kod bloğu dışındaki metin kullanıcıya kısa not olarak gösterilir.`,
    'Yalnız <body> içeriğini yaz; tema, üst bilgi, yazı tipi ve renkleri Buyer Log ekler. <script>, olay öznitelikleri, <iframe>, <form>, dış CSS/yazı tipi/görsel bağlantısı ve uzak görsel KULLANMA. Satır içi <svg> grafik serbesttir. Özel CSS yazma; gerekirse tek bir <style> içinde küçük yerleşim ayarları yap.',
    'Buyer Log sınıflarını kullan: <h1> başlık, <p class="bl-lead"> giriş; her bölüm için <section class="bl-section"> ve <h2>; KPI: <div class="bl-kpis"><div class="bl-kpi ok|warn|risk"><span class="bl-kpi-label">…</span><span class="bl-kpi-value">…</span><span class="bl-kpi-note">…</span></div></div>; kartlar: <div class="bl-grid"><div class="bl-card"><h3>…</h3>…</div></div>; not: <div class="bl-callout ok|warn|risk">…</div>; tablo: <div class="bl-table-wrap"><table><thead>…</thead><tbody>…</tbody></table></div>, sayılar için <td class="num">; durum: <span class="bl-badge ok|warn|risk|info">…</span>; bar grafik: <div class="bl-bars"><div class="bl-bar warn"><span>Etiket</span><span class="bl-bar-track"><span class="bl-bar-fill" style="width:62%"></span></span><span>62</span></div></div>.',
    'Diğer bileşenler: ilerleme halkası <div class="bl-rings"><div class="bl-ring-card"><div class="bl-ring ok|warn|risk" style="--bl-p:72">%72</div><div class="bl-ring-label">…</div></div></div>; ilerleme çubuğu <div class="bl-progress"><span class="bl-progress-fill" style="width:40%"></span></div>; zaman çizelgesi <ol class="bl-timeline"><li class="ok|warn|risk"><time>…</time>…</li></ol>; numaralı aksiyonlar <ol class="bl-steps"><li><div>…</div></li></ol>; eğilim <span class="bl-trend up|down">▲ %4</span>; tonlu kart <div class="bl-card ok|warn|risk">.',
    'Raporu görsel ve canlı yap, düz metin yığını olmasın: KPI ile başla, karşılaştırmaları bar/halka ile göster, kart, zaman çizelgesi ve ton renkleriyle (ok/warn/risk) gözü yönlendir; paragrafları kısa tut.',
    format === 'pdf' ? 'Belge basılacak: etkileşimli öğe koyma, tabloları sayfaya sığacak genişlikte tut, çok geniş tek tablo yerine birkaç kısa tablo tercih et.' : 'Dosya tarayıcıda çevrimdışı açılır; kendi içinde eksiksiz olsun. Giriş animasyonları (bölüm, KPI, bar, halka) otomatik eklenir; istersen küçük ek CSS @keyframes animasyonları ya da <details class="bl-details"> açılır bölümler ekleyebilirsin, JavaScript asla.',
  ];
  return lines.join('\n');
}

function workbookInstruction(english) {
  return english ? [
    'Return ONLY one JSON object (no Markdown) in this WORKBOOK shape; Buyer Log builds the .xlsx with its own styling:',
    '{"title":"…","subtitle":"…","currency":"TRY|USD|EUR","kpis":[{"label":"…","value":123,"note":"…"}],"notes":["…"],"sheets":[{"name":"…","columns":[{"header":"…","type":"text|integer|number|percent|currency|date|image"}],"rows":[["…",12,0.25,"2026-10-05"]]}]}',
    'Rules: each row has exactly as many cells as columns; numbers are JSON numbers (no thousands separators); percent values are fractions (0.25 = 25%); dates are "YYYY-MM-DD"; sheet names ≤ 31 characters; formulas may be given as {"f":"SUM(B2:B10)"} (no external references). kpis/notes go to a Summary sheet and are optional.',
  ].join('\n') : [
    'YALNIZ tek bir JSON nesnesi döndür (Markdown yok), şu WORKBOOK biçiminde; .xlsx dosyasını kendi stiliyle Buyer Log oluşturur:',
    '{"title":"…","subtitle":"…","currency":"TRY|USD|EUR","kpis":[{"label":"…","value":123,"note":"…"}],"notes":["…"],"sheets":[{"name":"…","columns":[{"header":"…","type":"text|integer|number|percent|currency|date|image"}],"rows":[["…",12,0.25,"2026-10-05"]]}]}',
    'Kurallar: her satırda sütun sayısı kadar hücre; sayılar JSON sayısı (binlik ayırıcı yok); yüzdeler oran (0.25 = %25); tarihler "YYYY-MM-DD"; sayfa adı ≤ 31 karakter; formül {"f":"SUM(B2:B10)"} biçiminde verilebilir (dış başvuru yok). kpis/notes Özet sayfasına gider, isteğe bağlıdır.',
  ].join('\n');
}

function presentationInstruction(english, template) {
  return english ? [
    'Return ONLY one JSON object (no Markdown) in this PRESENTATION shape; Buyer Log designs the 16:9 .pptx itself (colours, fonts, positions):',
    '{"title":"…","subtitle":"…","slides":[{"layout":"title|section|bullets|kpis|table|chart|comparison|summary|gallery","title":"…","subtitle":"…","bullets":["…"],"kpis":[{"label":"…","value":"…","note":"…","tone":"ok|warn|risk|info"}],"table":{"columns":["…"],"rows":[["…"]]},"chart":{"categories":["…"],"series":[{"name":"…","values":[1,2]}],"unit":"%"},"left":{"title":"…","bullets":["…"]},"right":{"title":"…","bullets":["…"]},"callout":{"text":"…","tone":"ok|warn|risk|info"}}]}',
    `Rules: use only the fields the layout needs; at most ${LIMITS.bullets} bullets per slide, ${LIMITS.kpis} KPIs, ${LIMITS.tableRows} table rows × ${LIMITS.tableCols} columns, ${LIMITS.chartCategories} chart categories; chart values are numbers. Do not cut long tables: Buyer Log splits them into continuation slides itself. Suggested flow: ${template.slides || 'title → content → summary'}.`,
  ].join('\n') : [
    'YALNIZ tek bir JSON nesnesi döndür (Markdown yok), şu PRESENTATION biçiminde; 16:9 .pptx tasarımını (renk, yazı tipi, yerleşim) Buyer Log yapar:',
    '{"title":"…","subtitle":"…","slides":[{"layout":"title|section|bullets|kpis|table|chart|comparison|summary|gallery","title":"…","subtitle":"…","bullets":["…"],"kpis":[{"label":"…","value":"…","note":"…","tone":"ok|warn|risk|info"}],"table":{"columns":["…"],"rows":[["…"]]},"chart":{"categories":["…"],"series":[{"name":"…","values":[1,2]}],"unit":"%"},"left":{"title":"…","bullets":["…"]},"right":{"title":"…","bullets":["…"]},"callout":{"text":"…","tone":"ok|warn|risk|info"}}]}',
    `Kurallar: her düzende yalnız gereken alanları kullan; slayt başına en fazla ${LIMITS.bullets} madde, ${LIMITS.kpis} KPI, ${LIMITS.tableRows} satır × ${LIMITS.tableCols} sütun tablo, ${LIMITS.chartCategories} grafik kategorisi; grafik değerleri sayıdır. Uzun tabloyu kesme: Buyer Log onu devam slaytlarına kendisi böler. Önerilen akış: ${template.slides || 'title → içerik → summary'}.`,
  ].join('\n');
}

/* Kullanıcı mesajının ardına eklenen ÇIKTI SÖZLEŞMESİ bölümü. */
function buildInstruction({ format, template, orientation = 'portrait', detail = 'standard', lang = 'tr' } = {}) {
  const english = lang === 'en';
  const langKey = english ? 'en' : 'tr';
  const head = english
    ? `=== OUTPUT CONTRACT: ${FORMAT_LABEL[format]} file ===\nThe user wants the answer as a ${FORMAT_LABEL[format]} file. Use the data in the conversation, attached files and Buyer Log context; never invent figures — if data is missing, say so in the file. Copy text values from the source data (fabric, composition, description, codes, names) exactly and completely; never shorten, summarise or paraphrase them. Write the content in English.`
    : `=== ÇIKTI SÖZLEŞMESİ: ${FORMAT_LABEL[format]} dosyası ===\nKullanıcı cevabı ${FORMAT_LABEL[format]} dosyası olarak istiyor. Sohbetteki veriyi, ekli dosyaları ve Buyer Log bağlamını kullan; rakam uydurma — veri eksikse dosyada bunu belirt. Kaynak verideki metin değerlerini (kumaş, kompozisyon, açıklama, kod, isim) olduğu gibi ve TAM aktar; kısaltma, özetleme ya da yeniden yazma. İçeriği Türkçe yaz.`;
  const body = format === 'xlsx' ? workbookInstruction(english)
    : format === 'pptx' ? presentationInstruction(english, template)
      : htmlInstruction({ format, english, orientation });
  return [head, `${english ? 'Template' : 'Şablon'}: ${template.label[langKey]} — ${template.guide[langKey]}`, `${english ? 'Length' : 'Uzunluk'}: ${(DETAIL[detail] || DETAIL.standard)[langKey]}`, body, imageInstruction(format, english)].join('\n');
}

/* Geçersiz cevap sonrası aynı sohbete gönderilen düzeltme isteği. */
function repairMessage({ format, errors = [], lang = 'tr' } = {}) {
  const english = lang === 'en';
  const list = errors.slice(0, 6).map(item => `- ${item}`).join('\n');
  if (format === 'xlsx' || format === 'pptx') {
    const shape = format === 'xlsx' ? 'WORKBOOK' : 'PRESENTATION';
    return english
      ? `Your previous answer could not be turned into the ${FORMAT_LABEL[format]} file:\n${list}\nReturn the SAME content again as ONLY one valid JSON object in the ${shape} shape described before (no Markdown, no explanation, no trailing commas).`
      : `Önceki cevabın ${FORMAT_LABEL[format]} dosyasına çevrilemedi:\n${list}\nAynı içeriği, daha önce tarif edilen ${shape} biçiminde YALNIZ tek bir geçerli JSON nesnesi olarak tekrar döndür (Markdown, açıklama, sondaki virgül yok).`;
  }
  return english
    ? `Your previous answer could not be turned into the ${FORMAT_LABEL[format]} file:\n${list}\nReturn the SAME content again as ONE complete HTML document inside a single \`\`\`html code block, using the Buyer Log classes described before.`
    : `Önceki cevabın ${FORMAT_LABEL[format]} dosyasına çevrilemedi:\n${list}\nAynı içeriği, daha önce tarif edilen Buyer Log sınıflarıyla, tek bir \`\`\`html kod bloğunda TEK ve tam bir HTML belge olarak tekrar döndür.`;
}

/* ---------------- JSON ayrıştırma ---------------- */
function parseJson(text) {
  const source = String(text == null ? '' : text);
  const fence = /```(?:json)?\s*\n?([\s\S]*?)(?:```|$)/i.exec(source);
  const explanation = fence ? (source.slice(0, fence.index) + source.slice(fence.index + fence[0].length)).trim() : '';
  const candidates = [];
  if (fence) candidates.push(fence[1].trim());
  const first = source.indexOf('{');
  const last = source.lastIndexOf('}');
  if (first >= 0 && last > first) candidates.push(source.slice(first, last + 1));
  for (const candidate of candidates) {
    for (const attempt of [candidate, candidate.replace(/,\s*([}\]])/g, '$1')]) {
      try { const value = JSON.parse(attempt); if (isObject(value)) return { value, explanation: fence ? explanation : (first > 0 ? source.slice(0, first).trim() : '') }; } catch (_) {}
    }
  }
  if (source.length <= 60000) {
    const value = extractJsonObject(source);
    if (value) return { value, explanation: '' };
  }
  return { value: null, explanation: source.trim().slice(0, 2000) };
}

function toNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  let text = value.replace(/[\s₺$€£%]/g, '').replace(/(TRY|TL|USD|EUR)$/i, '');
  if (!text || !/^[-+]?[\d.,]+$/.test(text)) return null;
  if (/,\d{1,2}$/.test(text) || (text.includes('.') && text.includes(',') && text.lastIndexOf(',') > text.lastIndexOf('.'))) text = text.replace(/\./g, '').replace(',', '.');
  else text = text.replace(/,/g, '');
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

/* Formüller izin listesiyle doğrulanır: yalnız bilinen İngilizce işlev
   adları, virgül ayırıcı (Türkçe ";" Excel'de dosyayı bozar), dış başvuru
   ([...]), DDE (|) ve uzak veri çeken işlevler (IMAGE, WEBSERVICE…) yok.
   Uymayan formül hücresi boş bırakılır. */
const FORMULA_FUNCTIONS = new Set(['SUM', 'SUMIF', 'SUMIFS', 'SUMPRODUCT', 'AVERAGE', 'AVERAGEIF', 'AVERAGEIFS', 'COUNT', 'COUNTA', 'COUNTBLANK', 'COUNTIF', 'COUNTIFS', 'MIN', 'MAX', 'MINIFS', 'MAXIFS', 'MEDIAN', 'MODE', 'STDEV', 'STDEV.S', 'STDEV.P', 'VAR', 'PERCENTILE', 'QUARTILE', 'RANK', 'RANK.EQ', 'LARGE', 'SMALL', 'PRODUCT', 'ROUND', 'ROUNDUP', 'ROUNDDOWN', 'INT', 'MOD', 'ABS', 'POWER', 'SQRT', 'IF', 'IFS', 'IFERROR', 'IFNA', 'AND', 'OR', 'NOT', 'ISBLANK', 'ISNUMBER', 'ISTEXT', 'ISERROR', 'VLOOKUP', 'HLOOKUP', 'XLOOKUP', 'INDEX', 'MATCH', 'XMATCH', 'CHOOSE', 'TODAY', 'DATE', 'YEAR', 'MONTH', 'DAY', 'WEEKDAY', 'WEEKNUM', 'EDATE', 'EOMONTH', 'NETWORKDAYS', 'WORKDAY', 'DATEDIF', 'DAYS', 'TEXT', 'VALUE', 'LEFT', 'RIGHT', 'MID', 'LEN', 'UPPER', 'LOWER', 'PROPER', 'TRIM', 'CONCAT', 'CONCATENATE', 'TEXTJOIN', 'SUBSTITUTE', 'FIND', 'SEARCH', 'ROWS', 'COLUMNS']);
function safeFormula(value) {
  const formula = String(value || '').trim().replace(/^=/, '').slice(0, 2000);
  if (!formula || /[{}\\]/.test(formula) || /https?:|:\/\//i.test(formula)) return null;
  const outside = formula.replace(/"[^"]*"/g, '""');
  if (/[;\[\]|]/.test(outside)) return null;
  const names = outside.match(/[A-Za-z_][A-Za-z0-9_.]*\s*\(/g) || [];
  if (names.some(name => !FORMULA_FUNCTIONS.has(name.replace(/\s*\($/, '').toUpperCase()))) return null;
  let depth = 0;
  for (const char of outside) { if (char === '(') depth++; else if (char === ')' && --depth < 0) return null; }
  return depth === 0 ? formula : null;
}

function sheetName(value, index, english) {
  const name = clean(String(value == null ? '' : value).replace(/[\[\]:*?/\\]/g, ' '), 31).replace(/^'+|'+$/g, '').trim();
  // "History" Excel'in ayrılmış sayfa adıdır.
  return name && name.toLowerCase() !== 'history' ? name : `${english ? 'Sheet' : 'Sayfa'} ${index + 1}`;
}

function normalizeWorkbook(raw, { lang = 'tr', date } = {}) {
  const english = lang === 'en';
  const errors = [];
  const warnings = [];
  if (!isObject(raw)) return { ok: false, errors: [english ? 'No JSON object was found.' : 'JSON nesnesi bulunamadı.'], warnings };
  const sheetsRaw = asArray(raw.sheets).filter(isObject);
  if (!sheetsRaw.length) errors.push(english ? '"sheets" must contain at least one sheet.' : '"sheets" en az bir sayfa içermeli.');
  const sheets = [];
  sheetsRaw.slice(0, LIMITS.sheets).forEach((sheet, index) => {
    let columns = asArray(sheet.columns).slice(0, LIMITS.sheetCols).map((column, i) => {
      if (typeof column === 'string') return { header: clean(column, 120) || `${english ? 'Column' : 'Sütun'} ${i + 1}`, type: 'text' };
      const type = String(column && column.type || 'text').toLowerCase();
      return { header: clean(column && (column.header || column.name || column.label), 120) || `${english ? 'Column' : 'Sütun'} ${i + 1}`, type: COLUMN_TYPES.includes(type) ? type : 'text' };
    });
    let rows = asArray(sheet.rows);
    // Satırlar nesne olarak geldiyse ({Başlık: değer}) sütunlara çevrilir.
    if (rows.length && rows.every(isObject)) {
      if (!columns.length) columns = Object.keys(rows[0]).slice(0, LIMITS.sheetCols).map(key => ({ header: clean(key, 120), type: 'text' }));
      const keys = columns.map(column => column.header);
      rows = rows.map(row => keys.map(key => row[key]));
    }
    if (!columns.length) { errors.push(english ? `Sheet ${index + 1} has no columns.` : `${index + 1}. sayfada sütun yok.`); return; }
    if (rows.length > LIMITS.sheetRows) warnings.push(`rows-trimmed:${rows.length}`);
    const percentText = new Set(); // "%30" / "30%" gibi metinden gelen yüzde hücreleri
    rows = rows.slice(0, LIMITS.sheetRows).filter(Array.isArray).map((row, rowIndex) => columns.map((column, i) => {
      const value = row[i];
      if (isObject(value) && typeof value.f === 'string') {
        const formula = safeFormula(value.f);
        if (!formula) warnings.push('formula-dropped');
        return formula ? { f: formula } : null;
      }
      if (value == null) return null;
      if (column.type === 'image') return imageToken(value) || null;
      if (['integer', 'number', 'currency', 'percent'].includes(column.type)) {
        const number = toNumber(value);
        if (number != null && column.type === 'percent' && typeof value === 'string' && value.includes('%')) { percentText.add(`${rowIndex}:${i}`); return number / 100; }
        if (number != null) return number;
      }
      if (typeof value === 'number' || typeof value === 'boolean') return value;
      return String(value).slice(0, 32000);
    }));
    // Yüzde sütunu oran yerine 0–100 geldiyse (ör. 25 → 0.25) düzelt.
    columns.forEach((column, i) => {
      if (column.type !== 'percent') return;
      const plain = rows.map((row, r) => (typeof row[i] === 'number' && !percentText.has(`${r}:${i}`) ? r : -1)).filter(r => r >= 0);
      const values = plain.map(r => rows[r][i]);
      if (values.length && values.every(value => Math.abs(value) <= 100) && values.some(value => Math.abs(value) > 1.5)) plain.forEach(r => { rows[r][i] /= 100; });
    });
    sheets.push({ name: sheetName(sheet.name || sheet.title, index, english), columns, rows });
  });
  const title = clean(raw.title, LIMITS.titleChars) || (english ? 'LCW AI Workbook' : 'LCW AI Çalışma Kitabı');
  const workbook = {
    title,
    subtitle: clean(raw.subtitle, 240),
    currency: /^(TRY|USD|EUR|GBP)$/i.test(String(raw.currency || '')) ? String(raw.currency).toUpperCase() : '',
    kpis: asArray(raw.kpis).filter(isObject).slice(0, 20).map(kpi => ({ label: clean(kpi.label, 120), value: typeof kpi.value === 'number' ? kpi.value : clean(kpi.value, 120), note: clean(kpi.note, 400) })).filter(kpi => kpi.label),
    notes: asArray(raw.notes).map(note => clean(note, 1000)).filter(Boolean).slice(0, 30),
    sheets,
    date: date || new Date().toISOString().slice(0, 10),
    layout: layoutOf('xlsx', raw.layout),
  };
  if (!sheets.length && !errors.length) errors.push(english ? 'No usable sheet was found.' : 'Kullanılabilir sayfa bulunamadı.');
  return { ok: errors.length === 0, data: workbook, errors, warnings };
}

function bulletsOf(value) {
  return asArray(value).map(item => clean(isObject(item) ? (item.text || item.title || '') : item, LIMITS.bulletChars)).filter(Boolean).slice(0, LIMITS.bullets);
}
const tone = value => (TONES.includes(String(value || '').toLowerCase()) ? String(value).toLowerCase() : 'info');

function normalizeSlide(slide, index, english, warnings) {
  const title = clean(slide.title, LIMITS.titleChars);
  let layout = String(slide.layout || slide.type || '').toLowerCase();
  if (!LAYOUTS.includes(layout)) {
    layout = slide.chart ? 'chart' : slide.table ? 'table' : asArray(slide.kpis).length ? 'kpis' : (slide.left || slide.right) ? 'comparison' : 'bullets';
    warnings.push(`layout-inferred:${index + 1}`);
  }
  const base = { layout, title: title || (english ? `Slide ${index + 1}` : `Slayt ${index + 1}`), subtitle: clean(slide.subtitle, 240), bullets: bulletsOf(slide.bullets || slide.points || slide.items), callout: null };
  if (isObject(slide.callout) && clean(slide.callout.text)) base.callout = { text: clean(slide.callout.text, 300), tone: tone(slide.callout.tone) };
  else if (typeof slide.callout === 'string' && clean(slide.callout)) base.callout = { text: clean(slide.callout, 300), tone: 'info' };
  if (layout === 'kpis') {
    base.kpis = asArray(slide.kpis).filter(isObject).slice(0, LIMITS.kpis).map(kpi => ({ label: clean(kpi.label, 60), value: clean(kpi.value, 30), note: clean(kpi.note, 140), tone: tone(kpi.tone) })).filter(kpi => kpi.label || kpi.value);
    if (!base.kpis.length) return { error: english ? `Slide ${index + 1} (kpis) has no KPI.` : `${index + 1}. slayt (kpis) KPI içermiyor.` };
  }
  if (layout === 'table') {
    const table = isObject(slide.table) ? slide.table : {};
    const columns = asArray(table.columns).slice(0, LIMITS.tableCols).map(column => clean(isObject(column) ? (column.header || column.name) : column, LIMITS.tableHeaderChars));
    if (!columns.length) return { error: english ? `Slide ${index + 1} (table) has no columns.` : `${index + 1}. slayt (table) sütun içermiyor.` };
    const rows = asArray(table.rows).filter(Array.isArray);
    base.table = { columns, rows: rows.slice(0, LIMITS.tableRows).map(row => columns.map((_, i) => (typeof row[i] === 'number' ? row[i] : clean(row[i], LIMITS.tableCellChars)))), omitted: Math.max(0, rows.length - LIMITS.tableRows) + (Number(table.omitted) > 0 ? Math.floor(Number(table.omitted)) : 0) };
  }
  if (layout === 'chart') {
    const chart = isObject(slide.chart) ? slide.chart : {};
    const categories = asArray(chart.categories || chart.labels).slice(0, LIMITS.chartCategories).map(item => clean(item, 40));
    let series = asArray(chart.series).filter(isObject);
    if (!series.length && Array.isArray(chart.values)) series = [{ name: base.title, values: chart.values }];
    series = series.slice(0, LIMITS.chartSeries).map(item => ({ name: clean(item.name, 40), values: categories.map((_, i) => toNumber(asArray(item.values)[i]) || 0) }));
    if (!categories.length || !series.length) return { error: english ? `Slide ${index + 1} (chart) needs categories and numeric series.` : `${index + 1}. slayt (chart) kategori ve sayısal seri içermeli.` };
    base.chart = { categories, series, unit: clean(chart.unit, 8) };
  }
  if (layout === 'comparison') {
    const side = (value, fallback) => ({ title: clean(isObject(value) ? value.title : '', 60) || fallback, bullets: bulletsOf(isObject(value) ? value.bullets : value) });
    base.left = side(slide.left, 'A');
    base.right = side(slide.right, 'B');
    if (!base.left.bullets.length && !base.right.bullets.length) return { error: english ? `Slide ${index + 1} (comparison) has empty columns.` : `${index + 1}. slayt (comparison) boş.` };
  }
  if (layout === 'gallery') {
    base.bullets = [];
    base.items = asArray(slide.items || slide.cards || slide.models).filter(isObject).slice(0, GALLERY_ITEMS).map(item => ({
      title: clean(item.title || item.name || item.model, 60), subtitle: clean(item.subtitle, 80), note: clean(item.note || item.text, 140), image: imageToken(item.image), tone: tone(item.tone),
    })).filter(item => item.title || item.image);
    if (!base.items.length) return { error: english ? `Slide ${index + 1} (gallery) has no items.` : `${index + 1}. slayt (gallery) öğe içermiyor.` };
    return { slide: base };
  }
  if (layout === 'bullets' && slide.image) base.image = imageToken(slide.image);
  if ((layout === 'bullets' || layout === 'summary') && !base.bullets.length) {
    if (base.callout) base.bullets = [base.callout.text];
    else return { error: english ? `Slide ${index + 1} (${layout}) has no bullets.` : `${index + 1}. slayt (${layout}) madde içermiyor.` };
  }
  return { slide: base };
}

function normalizePresentation(raw, { lang = 'tr', date } = {}) {
  const english = lang === 'en';
  const errors = [];
  const warnings = [];
  if (!isObject(raw)) return { ok: false, errors: [english ? 'No JSON object was found.' : 'JSON nesnesi bulunamadı.'], warnings };
  const list = asArray(raw.slides).filter(isObject);
  if (!list.length) return { ok: false, errors: [english ? '"slides" must contain at least one slide.' : '"slides" en az bir slayt içermeli.'], warnings };
  if (list.length > LIMITS.slides) warnings.push(`slides-trimmed:${list.length}`);
  const slides = [];
  list.slice(0, LIMITS.slides).forEach((slide, index) => {
    const result = normalizeSlide(slide, index, english, warnings);
    if (result.error) errors.push(result.error); else slides.push(result.slide);
  });
  const title = clean(raw.title, LIMITS.titleChars) || (slides[0] && slides[0].title) || (english ? 'LCW AI Presentation' : 'LCW AI Sunumu');
  if (slides.length && slides[0].layout !== 'title') slides.unshift({ layout: 'title', title, subtitle: clean(raw.subtitle, 240), bullets: [], callout: null });
  // Tek tük bozuk slayt sunumu düşürmez; yarıdan fazlası bozuksa onarım istenir.
  const fatal = !slides.length || errors.length > Math.max(1, Math.floor(list.length / 2));
  if (!fatal && errors.length) { warnings.push(...errors.map(error => `slide-dropped:${error}`)); errors.length = 0; }
  return { ok: !fatal && slides.length > 0, data: { title, subtitle: clean(raw.subtitle, 240), date: date || new Date().toISOString().slice(0, 10), slides, layout: layoutOf('pptx', raw.layout) }, errors: fatal ? errors : [], warnings };
}

function normalizeHtmlOutput(text, { lang = 'tr' } = {}) {
  const english = lang === 'en';
  const extracted = extractHtml(text);
  if (!extracted.ok) return { ok: false, errors: [english ? 'No HTML document or ```html code block was found.' : 'HTML belge ya da ```html kod bloğu bulunamadı.'], warnings: [], explanation: extracted.explanation };
  const clean_ = sanitizeHtml(extracted.html);
  const textContent = visibleText(clean_.body);
  const errors = [];
  if (textContent.length < 60) errors.push(english ? 'The HTML has almost no visible content.' : 'HTML neredeyse hiç görünür içerik içermiyor.');
  const heading = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(clean_.body);
  const title = clean_.title || (heading ? visibleText(heading[1]).slice(0, LIMITS.titleChars) : '');
  return {
    ok: errors.length === 0,
    data: { body: clean_.body, styles: clean_.styles, title, removed: clean_.removed, mode: extracted.mode },
    explanation: extracted.explanation.replace(/```[\s\S]*?```/g, '').trim().slice(0, 2000),
    errors,
    warnings: clean_.removed ? [`sanitized:${clean_.removed}`] : [],
  };
}

/* AI Çıktı Düzenleyici: kullanıcının düzenlediği rapor gövdesi aynı
   temizleyiciden geçer (AI HTML'i ile aynı güven düzeyi). */
function normalizeHtmlDraft({ body, styles = [], layout = null } = {}, { lang = 'tr' } = {}) {
  const english = lang === 'en';
  // Önizlemedeki galeri sayfa parçaları tek galeride saklanır (oluştururken yeniden bölünür).
  const clean_ = sanitizeHtml(BLOutputLayout.paginateGallery(String(body == null ? '' : body), null, { pages: false }));
  const textContent = visibleText(clean_.body);
  const errors = textContent.length ? [] : [english ? 'The report has no visible content.' : 'Raporda görünür içerik yok.'];
  const heading = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(clean_.body);
  const kept = asArray(styles).map(css => sanitizeStyleSheet(String(css || '')));
  return {
    ok: errors.length === 0,
    data: { body: clean_.body, styles: [...kept, ...clean_.styles].filter(Boolean).slice(0, 8), title: heading ? visibleText(heading[1]).slice(0, LIMITS.titleChars) : '', removed: clean_.removed, mode: 'edited', layout: layoutOf('pdf', layout) },
    errors,
    warnings: clean_.removed ? [`sanitized:${clean_.removed}`] : [],
  };
}

/* Tek giriş noktası. */
function parseOutput(format, text, options = {}) {
  if (format === 'pdf' || format === 'html') return normalizeHtmlOutput(text, options);
  const parsed = parseJson(text);
  const english = options.lang === 'en';
  if (!parsed.value) return { ok: false, errors: [english ? 'The answer is not valid JSON.' : 'Cevap geçerli bir JSON değil.'], warnings: [], explanation: parsed.explanation };
  const result = format === 'xlsx' ? normalizeWorkbook(parsed.value, options) : normalizePresentation(parsed.value, options);
  return { ...result, explanation: parsed.explanation };
}

module.exports = {
  safeFormula, FORMATS, FORMAT_LABEL, LIMITS, COLUMN_TYPES, LAYOUTS,
  normalizeFormat, buildInstruction, repairMessage, parseOutput, parseJson,
  normalizeWorkbook, normalizePresentation, normalizeHtmlOutput, normalizeHtmlDraft, toNumber,
};
