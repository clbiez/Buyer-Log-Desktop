'use strict';

/* FİYAT DEFTERİ (Price Ledger) — quotation satırlarının değişmez olay kaydı.

   Bir teklif satırının fiyatı, onayı ve drop işareti artık yalnız "son hâl"
   olarak saklanmaz: her değişiklik satırın `history` listesine bir olay olarak
   eklenir (offer · approve · unapprove · drop · undrop). Böylece:
     · pazarlık turları kaybolmaz (yeni fiyat eskisinin üstüne yazılmaz),
     · Fiyat Geçmişi gerçek tarih/kişi/tur bilgisini gösterir,
     · iki kişi aynı talepte farklı satırları düzenlediğinde satır bazında
       birleşim yapılabilir (`rev` + `updatedAt`).

   Defter sunucu tarafından yazılır: istemcinin gönderdiği `history` asla
   olduğu gibi kabul edilmez; sunucu mevcut defteri korur ve yalnız gerçekten
   değişen alan için yeni olay ekler. Bu modül saf yardımcıdır; dosya/kilit
   işi quotations-store.js'tedir. */

const MAX_HISTORY = 200;
const MAX_ROUNDS = 50;
const EVENT_TYPES = new Set(['offer', 'approve', 'unapprove', 'drop', 'undrop']);
const EVENT_SOURCES = new Set(['manual', 'matrix', 'paste', 'import', 'bulk', 'exclusive', 'merge', 'legacy', 'ai', 'collection', 'undo']);

function clean(value, max = 500) { return String(value == null ? '' : value).trim().slice(0, max); }
function cleanId(value) { return clean(value, 160).replace(/[^A-Za-z0-9_.:-]/g, '_'); }
function now() { return new Date().toISOString(); }
/* Aynı milisaniyede yazılan olaylar (ör. fiyat silinip onayın düşmesi) zamana
   göre eşit olur; sıralama kimliğe düşer. Sayaç, aynı süreçteki yazım sırasını
   kimlikte korur. */
let eventSeq = 0;
function eventId() {
  eventSeq = (eventSeq + 1) % 1679616;
  return `qe-${Date.now().toString(36)}-${eventSeq.toString(36).padStart(4, '0')}-${Math.random().toString(36).slice(2, 7)}`;
}
function positiveInt(value, fallback = 0) {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/* Para metnini sayıya çevirir (9,45 · 9.45 · $9.45 · 1.234,50). Defter
   karşılaştırması yalnız "fiyat gerçekten değişti mi?" sorusu içindir; görünen
   metin satırda olduğu gibi kalır. */
function priceNumber(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null;
  let text = clean(value, 120).replace(/\s+/g, '').replace(/[$€£₺]/g, '');
  if (!text) return null;
  if (text.includes(',') && text.includes('.')) {
    if (text.lastIndexOf(',') > text.lastIndexOf('.')) text = text.replace(/\./g, '').replace(',', '.');
    else text = text.replace(/,/g, '');
  } else if (text.includes(',')) {
    const parts = text.split(',');
    text = parts.length === 2 && parts[1].length <= 3 ? `${parts[0].replace(/\./g, '')}.${parts[1]}` : text.replace(/,/g, '');
  } else if (/^\d{1,3}(?:\.\d{3})+$/.test(text)) text = text.replace(/\./g, '');
  const n = Number(text);
  return Number.isFinite(n) && n > 0 ? n : null;
}
function samePrice(a, b) {
  const x = priceNumber(a), y = priceNumber(b);
  if (x != null || y != null) return x != null && y != null && Math.round(x * 10000) === Math.round(y * 10000);
  return clean(a, 120) === clean(b, 120);
}

function normalizeEvent(value) {
  const src = value && typeof value === 'object' ? value : {};
  const type = clean(src.type, 20);
  if (!EVENT_TYPES.has(type)) return null;
  const at = clean(src.at, 80);
  if (!at || !Number.isFinite(Date.parse(at))) return null;
  const event = { id: cleanId(src.id) || eventId(), type, at, by: cleanId(src.by), byName: clean(src.byName, 240), round: Math.max(1, positiveInt(src.round, 1)) };
  const source = clean(src.source, 20);
  event.source = EVENT_SOURCES.has(source) ? source : 'manual';
  if (type === 'offer') event.price = clean(src.price, 120);
  return event;
}
function sortEvents(list) {
  return list.sort((a, b) => String(a.at).localeCompare(String(b.at)) || String(a.id).localeCompare(String(b.id)));
}
function normalizeHistory(value) {
  const seen = new Set(), out = [];
  for (const raw of Array.isArray(value) ? value : []) {
    const event = normalizeEvent(raw);
    if (!event || seen.has(event.id)) continue;
    seen.add(event.id); out.push(event);
  }
  return sortEvents(out).slice(-MAX_HISTORY);
}
function unionHistory(a, b) { return normalizeHistory([...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])]); }

function normalizeRounds(value) {
  const out = [];
  for (const raw of Array.isArray(value) ? value : []) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const n = positiveInt(src.n, 0), at = clean(src.at, 80);
    if (n < 2 || !at) continue;
    out.push({ n, at, by: cleanId(src.by), byName: clean(src.byName, 240), note: clean(src.note, 1000) });
  }
  const unique = new Map();
  out.forEach(round => { if (!unique.has(round.n)) unique.set(round.n, round); });
  return [...unique.values()].sort((a, b) => a.n - b.n).slice(-MAX_ROUNDS);
}

function actor(profile) {
  return { by: cleanId(profile && profile.id), byName: clean(profile && (profile.displayName || profile.username || profile.id), 240) };
}
function makeEvent(type, profile, { price, round = 1, source = 'manual', at = now() } = {}) {
  return normalizeEvent({ id: eventId(), type, at, ...actor(profile), round, source, ...(type === 'offer' ? { price } : {}) });
}

/* Bir satırın eski hâlinden yeni hâline geçişin olayları. Satır nesnesine
   dokunmaz; çağıran olayları ekler ve rev/updatedAt'i ilerletir. */
function lineEvents(before, after, profile, { round = 1, source = 'manual', at = now() } = {}) {
  const prev = before || {}, next = after || {}, events = [];
  // Fiyatın silinmesi de bir olaydır (boş teklif = geri çekildi); defterde iz kalır.
  if (!samePrice(prev.price, next.price) && (clean(next.price, 120) || clean(prev.price, 120))) events.push(makeEvent('offer', profile, { price: clean(next.price, 120), round, source, at }));
  if (Boolean(prev.dropped) !== Boolean(next.dropped)) events.push(makeEvent(next.dropped ? 'drop' : 'undrop', profile, { round, source, at }));
  if (Boolean(prev.approved) !== Boolean(next.approved)) events.push(makeEvent(next.approved ? 'approve' : 'unapprove', profile, { round, source, at }));
  return events.filter(Boolean);
}

/* Satır durumunu olaylarla birlikte uygular. Değişiklik yoksa satır aynen
   döner (rev artmaz, gereksiz kayıt/senkron olmaz). */
function applyLineChange(line, patch, profile, options = {}) {
  const current = line || {};
  const next = { ...current };
  if (Object.prototype.hasOwnProperty.call(patch, 'price')) next.price = clean(patch.price, 120);
  if (Object.prototype.hasOwnProperty.call(patch, 'dropped')) next.dropped = Boolean(patch.dropped);
  if (Object.prototype.hasOwnProperty.call(patch, 'approved')) next.approved = Boolean(patch.approved);
  // Geçerli fiyatı olmayan satır onaylı kalamaz (istemcideki qApplyPrice ile aynı kural).
  if (next.approved && priceNumber(next.price) == null) next.approved = false;
  const at = options.at || now();
  const events = lineEvents(current, next, profile, { ...options, at });
  if (!events.length) return { line: current, events, changed: false };
  next.history = normalizeHistory([...(current.history || []), ...events]);
  next.rev = positiveInt(current.rev, 0) + 1;
  next.updatedAt = at;
  next.updatedBy = actor(profile).by;
  return { line: next, events, changed: true };
}

/* Eski kayıtların defteri yoktur. Okuyan taraf, satırın son hâlinden tek bir
   "legacy" teklif olayı türetir (talep tarihinde, 1. tur). Diske yazılmaz. */
function effectiveHistory(line, request) {
  const history = normalizeHistory(line && line.history);
  if (history.some(event => event.type === 'offer')) return history;
  const synthetic = [];
  const price = clean(line && line.price, 120);
  const createdAt = clean(request && request.createdAt, 80) || clean(request && request.updatedAt, 80);
  if (price && priceNumber(price) != null && createdAt) synthetic.push({ id: `legacy-offer-${cleanId(line.id)}`, type: 'offer', price, at: createdAt, by: cleanId(request && request.ownerId), byName: clean(request && request.ownerName, 240), round: 1, source: 'legacy' });
  if (line && line.approved && !history.some(event => event.type === 'approve')) {
    const at = clean(request && (request.updatedAt || request.createdAt), 80);
    if (at) synthetic.push({ id: `legacy-approve-${cleanId(line.id)}`, type: 'approve', at, by: cleanId(request && request.ownerId), byName: clean(request && request.ownerName, 240), round: 1, source: 'legacy' });
  }
  return sortEvents([...synthetic, ...history]);
}

/* İKİ CİHAZDAN GELEN AYNI TALEBİN BİRLEŞİMİ.
   Talep alanları (not, durum, üreticiler, satır kümesi) daha yeni updatedAt
   taşıyan kopyadan gelir — eski davranış. Ortak satırlarda ise satırın kendi
   updatedAt'i daha yeni olan kopyanın fiyat/onay/drop durumu kazanır ve iki
   defter birleşir. Böylece A satır 1'i, B satır 2'yi düzenlediğinde ikisi de
   korunur. Birleşim değişmeli ve tekrarlanabilirdir. */
function newerRequest(a, b) {
  const at = String(a && a.updatedAt || ''), bt = String(b && b.updatedAt || '');
  if (at !== bt) return at > bt ? a : b;
  return JSON.stringify(a) >= JSON.stringify(b) ? a : b;
}
function mergeRequestCopies(a, b) {
  if (!a || typeof a !== 'object') return b;
  if (!b || typeof b !== 'object') return a;
  const newer = newerRequest(a, b), other = newer === a ? b : a;
  const otherItems = new Map((Array.isArray(other.items) ? other.items : []).filter(item => item && item.id).map(item => [String(item.id), item]));
  if (!otherItems.size || !Array.isArray(newer.items)) return newer;
  let changed = false;
  const items = newer.items.map(item => {
    const twin = item && otherItems.get(String(item.id));
    if (!twin) return item;
    const itemAt = String(item.updatedAt || ''), twinAt = String(twin.updatedAt || '');
    const winner = twinAt > itemAt ? twin : item;
    const history = unionHistory(item.history, twin.history);
    const rev = Math.max(positiveInt(item.rev, 0), positiveInt(twin.rev, 0));
    const merged = { ...item, price: winner.price, approved: winner.approved, dropped: winner.dropped, updatedAt: winner.updatedAt, updatedBy: winner.updatedBy, history, rev };
    if (winner !== item || history.length !== (Array.isArray(item.history) ? item.history.length : 0) || rev !== positiveInt(item.rev, 0)) changed = true;
    return merged;
  });
  if (!changed) return newer;
  const round = Math.max(positiveInt(newer.round, 1), positiveInt(other.round, 1));
  return { ...newer, items, round, rounds: normalizeRounds([...(newer.rounds || []), ...(other.rounds || [])]) };
}

module.exports = {
  MAX_HISTORY, MAX_ROUNDS, EVENT_TYPES,
  priceNumber, samePrice, normalizeEvent, normalizeHistory, unionHistory, normalizeRounds,
  makeEvent, lineEvents, applyLineChange, effectiveHistory, mergeRequestCopies, newerRequest,
};
