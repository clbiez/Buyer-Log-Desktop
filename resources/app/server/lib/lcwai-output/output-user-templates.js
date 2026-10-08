'use strict';

/*
 * Kullanıcı çıktı şablonları (kaydedilebilir, ekiple paylaşılabilir).
 *
 * Bir şablon İŞ VERİSİ TAŞIMAZ; yalnız dosyanın YAPISINI tutar: biçim,
 * sayfa yönü, detay, bölüm/slayt/sayfa sırası, başlıklar, tablo sütunları,
 * kısaltılmaması gereken alanlar ve kullanıcının ek talimatı. Ekip
 * şablonu başka kullanıcılara açıldığı için satır/hücre değerleri, grafik
 * rakamları ve model görselleri iskelete hiç girmez.
 *
 * Kullanımda şablon, çıktı sözleşmesinin sonuna "KULLANICI ŞABLONU"
 * bölümü olarak eklenir; LCW AI yapıya uyar, içeriği güncel veriyle doldurur.
 */
const { LAYOUTS, FORMATS, COLUMN_TYPES } = require('./output-contracts');
const { TEMPLATES } = require('./output-templates');
const BLOutputLayout = require('../../../public/lcwai-output-layout');

const LIMITS = Object.freeze({ name: 80, instructions: 3000, keepFull: 30, keepFullChars: 80, structure: 40, title: 140, columns: 40, columnChars: 80 });
const DETAILS = ['summary', 'standard', 'detailed'];
const SHEET_KINDS = ['sheet', 'summary'];
const SECTION_KIND = 'section';
const PARTS = ['text', 'kpis', 'table', 'bars', 'rings', 'cards', 'timeline', 'steps', 'callout', 'images'];

const clean = (value, max) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
const isObject = value => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const asArray = value => (Array.isArray(value) ? value : []);

function kindsFor(format) {
  if (format === 'pptx') return LAYOUTS;
  if (format === 'xlsx') return SHEET_KINDS;
  return [SECTION_KIND];
}

function normalizeColumns(list, format) {
  return asArray(list).slice(0, LIMITS.columns).map(column => {
    const name = clean(isObject(column) ? (column.name || column.header) : column, LIMITS.columnChars);
    if (!name) return null;
    const type = String(isObject(column) && column.type || '').toLowerCase();
    return format === 'xlsx' && COLUMN_TYPES.includes(type) && type !== 'text' ? { name, type } : { name };
  }).filter(Boolean);
}

function normalizeStructure(list, format) {
  const kinds = kindsFor(format);
  return asArray(list).filter(isObject).slice(0, LIMITS.structure).map(item => {
    const kind = kinds.includes(String(item.kind || '').toLowerCase()) ? String(item.kind).toLowerCase() : kinds[0] === 'title' ? 'bullets' : kinds[0];
    const out = { kind, title: clean(item.title, LIMITS.title) };
    const columns = normalizeColumns(item.columns, format);
    if (columns.length) out.columns = columns;
    const parts = asArray(item.parts).map(part => String(part || '').toLowerCase()).filter(part => PARTS.includes(part));
    if (format !== 'pptx' && format !== 'xlsx' && parts.length) out.parts = [...new Set(parts)];
    return out;
  }).filter(item => item.title || (item.columns && item.columns.length) || item.kind !== 'bullets');
}

/* Kaydedilen / kullanılan şablon tanımı. Biçim zorunludur. */
function normalizeDefinition(raw = {}) {
  const source = isObject(raw) ? raw : {};
  const format = FORMATS.includes(String(source.format || '').toLowerCase()) ? String(source.format).toLowerCase() : null;
  if (!format) return null;
  const base = TEMPLATES[source.base] && TEMPLATES[source.base].formats.includes(format) ? source.base : '';
  return {
    format,
    orientation: source.orientation === 'landscape' ? 'landscape' : 'portrait',
    detail: DETAILS.includes(source.detail) ? source.detail : 'standard',
    base,
    instructions: String(source.instructions == null ? '' : source.instructions).replace(/\r\n?/g, '\n').trim().slice(0, LIMITS.instructions),
    keepFull: [...new Set(asArray(source.keepFull).map(item => clean(item, LIMITS.keepFullChars)).filter(Boolean))].slice(0, LIMITS.keepFull),
    structure: normalizeStructure(source.structure, format),
    // Görsel yerleşim (başlık bandı, yazı boyutları, model ızgarası…); veri değildir.
    layout: source.layout && typeof source.layout === 'object' ? BLOutputLayout.normalizeLayout(format, source.layout) : null,
  };
}

const textOfHtml = html => String(html || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();

/* HTML bölümündeki bileşen türleri (sınıf adlarından). */
function partsOfHtml(html) {
  const parts = [];
  const has = re => re.test(html);
  if (has(/\bbl-kpis\b/)) parts.push('kpis');
  if (has(/<table\b/i)) parts.push('table');
  if (has(/\bbl-bars\b/)) parts.push('bars');
  if (has(/\bbl-rings\b/)) parts.push('rings');
  if (has(/\bbl-grid\b/)) parts.push('cards');
  if (has(/\bbl-timeline\b/)) parts.push('timeline');
  if (has(/\bbl-steps\b/)) parts.push('steps');
  if (has(/\bbl-callout\b/)) parts.push('callout');
  if (has(/data-bl-image=/)) parts.push('images');
  if (!parts.length || has(/<p\b|<ul\b/i)) parts.unshift('text');
  return parts;
}
function tableColumnsOfHtml(html) {
  const head = /<thead\b[^>]*>([\s\S]*?)<\/thead>/i.exec(html) || /<tr\b[^>]*>([\s\S]*?)<\/tr>/i.exec(html);
  if (!head) return [];
  const cells = [];
  const re = /<th\b[^>]*>([\s\S]*?)<\/th>/gi;
  let match;
  while ((match = re.exec(head[1]))) cells.push(textOfHtml(match[1]));
  return cells.filter(Boolean);
}

/* Taslaktan (normalize edilmiş dosya yapısı) veri taşımayan iskelet. */
function skeletonFromData(format, data) {
  const value = isObject(data) ? data : {};
  if (format === 'pptx') {
    return normalizeStructure(asArray(value.slides).filter(slide => isObject(slide) && slide.layout !== 'title').map(slide => ({
      kind: slide.layout,
      title: slide.title,
      columns: slide.layout === 'table' && isObject(slide.table) ? slide.table.columns : [],
    })), format);
  }
  if (format === 'xlsx') {
    const items = [];
    if (asArray(value.kpis).length || asArray(value.notes).length) items.push({ kind: 'summary', title: '' });
    for (const sheet of asArray(value.sheets)) items.push({ kind: 'sheet', title: sheet && sheet.name, columns: asArray(sheet && sheet.columns).map(column => ({ name: column.header, type: column.type })) });
    return normalizeStructure(items, format);
  }
  const body = String(value.body || '');
  const sections = [];
  const re = /<section\b[^>]*>([\s\S]*?)<\/section>/gi;
  let match;
  while ((match = re.exec(body))) {
    const inner = match[1];
    const heading = /<h2\b[^>]*>([\s\S]*?)<\/h2>/i.exec(inner) || /<h3\b[^>]*>([\s\S]*?)<\/h3>/i.exec(inner);
    sections.push({ kind: SECTION_KIND, title: heading ? textOfHtml(heading[1]) : '', parts: partsOfHtml(inner), columns: /<table\b/i.test(inner) ? tableColumnsOfHtml(inner) : [] });
  }
  if (!sections.length) {
    const headings = body.match(/<h2\b[^>]*>[\s\S]*?<\/h2>/gi) || [];
    for (const heading of headings) sections.push({ kind: SECTION_KIND, title: textOfHtml(heading), parts: [] });
  }
  return normalizeStructure(sections, format);
}

const KIND_LABEL = {
  tr: { title: 'Başlık', section: 'Bölüm', bullets: 'Maddeler', kpis: 'KPI kartları', table: 'Tablo', chart: 'Grafik', comparison: 'Karşılaştırma', summary: 'Özet', gallery: 'Galeri', sheet: 'Sayfa' },
  en: { title: 'Title', section: 'Section', bullets: 'Bullets', kpis: 'KPI cards', table: 'Table', chart: 'Chart', comparison: 'Comparison', summary: 'Summary', gallery: 'Gallery', sheet: 'Sheet' },
};
const PART_LABEL = {
  tr: { text: 'metin', kpis: 'KPI', table: 'tablo', bars: 'bar grafik', rings: 'halka', cards: 'kartlar', timeline: 'zaman çizelgesi', steps: 'aksiyon listesi', callout: 'not kutusu', images: 'model görselleri' },
  en: { text: 'text', kpis: 'KPIs', table: 'table', bars: 'bar chart', rings: 'rings', cards: 'cards', timeline: 'timeline', steps: 'action list', callout: 'callout', images: 'model images' },
};

/* Çıktı sözleşmesinin sonuna eklenen KULLANICI ŞABLONU bölümü. */
function templateInstruction(definition, { name = '', lang = 'tr' } = {}) {
  const def = normalizeDefinition(definition);
  if (!def) return '';
  const english = lang === 'en';
  const key = english ? 'en' : 'tr';
  const lines = [english ? `=== USER TEMPLATE: “${clean(name, LIMITS.name) || 'Template'}” ===` : `=== KULLANICI ŞABLONU: «${clean(name, LIMITS.name) || 'Şablon'}» ===`];
  if (def.structure.length) {
    lines.push(english
      ? `Follow the user's saved template exactly: keep this ${def.format === 'pptx' ? 'slide' : def.format === 'xlsx' ? 'sheet' : 'section'} order, these titles and these table columns (in this order). Fill the content with the CURRENT data; never copy old values. If data for an item is missing, keep the item and say so in it.`
      : `Kullanıcının kayıtlı şablonuna birebir uy: ${def.format === 'pptx' ? 'slayt' : def.format === 'xlsx' ? 'sayfa' : 'bölüm'} sırası, başlıklar ve tablo sütunları (bu sırayla) aşağıdaki gibi olsun. İçeriği GÜNCEL veriyle doldur; eski değer kopyalama. Bir öğenin verisi yoksa öğeyi koru ve bunu içinde belirt.`);
    def.structure.forEach((item, index) => {
      const columns = item.columns && item.columns.length ? ` — ${english ? 'columns' : 'sütunlar'}: ${item.columns.map(column => column.type ? `${column.name} (${column.type})` : column.name).join(' | ')}` : '';
      const parts = item.parts && item.parts.length ? ` — ${english ? 'components' : 'bileşenler'}: ${item.parts.map(part => PART_LABEL[key][part] || part).join(', ')}` : '';
      const layout = def.format === 'pptx' ? ` (layout: ${item.kind})` : '';
      lines.push(`${index + 1}. ${KIND_LABEL[key][item.kind] || item.kind}${layout}: ${item.title || (english ? '(untitled)' : '(başlıksız)')}${columns}${parts}`);
    });
  }
  if (def.keepFull.length) {
    lines.push(english
      ? `Never shorten, summarise or paraphrase these fields; write their values exactly and completely as in the source data: ${def.keepFull.join(', ')}.`
      : `Şu alanları asla kısaltma, özetleme ya da yeniden yazma; değerlerini kaynak verideki gibi TAM yaz: ${def.keepFull.join(', ')}.`);
  }
  if (def.layout && def.format !== 'xlsx') {
    const grid = `${def.layout.columns} × ${def.layout.rows}`;
    lines.push(english
      ? `Layout: model cards are placed ${grid} (${BLOutputLayout.perPage(def.layout)} per ${def.format === 'pptx' ? 'slide' : 'page'}) by Buyer Log. Put all model cards in ${def.format === 'pptx' ? 'ONE "gallery" slide (items carry "group"/"subgroup")' : 'consecutive <div class="bl-gallery" data-bl-group="…" data-bl-subgroup="…"> blocks'}; do not split them into pages yourself.`
      : `Yerleşim: model kartlarını Buyer Log ${grid} ızgarasına (${def.format === 'pptx' ? 'slayt' : 'sayfa'} başına ${BLOutputLayout.perPage(def.layout)}) dizer. Tüm model kartlarını ${def.format === 'pptx' ? 'TEK "gallery" slaytına (öğelerde "group"/"subgroup")' : 'ardışık <div class="bl-gallery" data-bl-group="…" data-bl-subgroup="…"> bloklarına'} koy; sayfalara kendin bölme.`);
  }
  if (def.instructions) lines.push(`${english ? 'Additional instructions from the user' : 'Kullanıcının ek talimatı'}:\n${def.instructions}`);
  return lines.join('\n');
}

module.exports = { LIMITS, PARTS, kindsFor, normalizeDefinition, normalizeStructure, skeletonFromData, templateInstruction };
