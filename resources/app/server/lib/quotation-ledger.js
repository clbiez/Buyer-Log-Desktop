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
   Talep alanları (not, durum, kapasite, sıra) daha yeni updatedAt taşıyan
   kopyadan gelir. Ortak satırlarda satırın kendi updatedAt'i daha yeni olan
   kopyanın fiyat/onay/drop durumu kazanır ve iki defter birleşir.
   Satır kümesi kimlikle BİRLEŞİR: istemcide satır silen akış yoktur (drop bir
   işarettir), bu yüzden yalnız diğer kopyada olan satır başka cihazın eşzamanlı
   eklemesidir ve korunur; üreticisi de listede kalır. Pazarlık turları her
   zaman birleşir. Birleşim değişmeli, birleşmeli (satır/üretici görüntü sırası
   hariç) ve tekrarlanabilirdir. */
function newerRequest(a, b) {
  const at = String(a && a.updatedAt || ''), bt = String(b && b.updatedAt || '');
  if (at !== bt) return at > bt ? a : b;
  return JSON.stringify(a) >= JSON.stringify(b) ? a : b;
}
const manufacturerKey = value => clean(value, 240).toLocaleUpperCase('tr-TR').replace(/\s+/g, ' ');
// Alternatif fiyat / etiket de durumdur (defterlenmez; düşerse kaybolur).
function lineHasState(item) {
  return Boolean(clean(item && item.price, 120) || (item && item.approved) || (item && item.dropped) || (Array.isArray(item && item.history) && item.history.length)
    || (Array.isArray(item && item.options) && item.options.length) || clean(item && item.priceLabel, 120) || clean(item && item.priceNote, 500));
}
const sameLineState = (a, b) => a.updatedBy === b.updatedBy && a.price === b.price && Boolean(a.approved) === Boolean(b.approved) && Boolean(a.dropped) === Boolean(b.dropped) && a.priceLabel === b.priceLabel && a.priceNote === b.priceNote;
// Aynı zaman damgalı iki satır kopyasında seçim içerikten yapılır; hangi talep kopyasının "yeni" sayıldığından bağımsızdır.
function lineStateKey(item) {
  return JSON.stringify([clean(item.updatedAt, 80), clean(item.updatedBy, 160), clean(item.price, 120), Boolean(item.approved), Boolean(item.dropped), clean(item.priceLabel, 120), clean(item.priceNote, 500)]);
}
/* Aynı model × üretici hücresinde birden çok satır yalnız iki cihazda aynı
   üreticinin eşzamanlı eklenmesinden doğar. Durumu (fiyat/onay/drop/defter)
   olmayan kopya fazlalıktır: hücrede durumlu satır varsa yalnız durumlular,
   yoksa en küçük kimlikli satır kalır; durumlu satır hiçbir zaman düşmez.
   Yalnız birleşimin yeni getirdiği satırların modelleri incelenir (sıcak yolda
   ek maliyet yok); seçim birleşik kümenin fonksiyonudur, sıradan bağımsızdır. */
function withoutRedundantLines(items, modelKeys) {
  const keyOf = new Map(), cellOf = item => {
    const name = item.manufacturer;
    if (!keyOf.has(name)) keyOf.set(name, manufacturerKey(name));
    return `${item.modelKey}\u0000${keyOf.get(name)}`;
  };
  const inScope = item => item && modelKeys.has(item.modelKey) && clean(item.modelKey, 300) && clean(item.manufacturer, 240);
  const stateful = new Set(), keep = new Map();
  for (const item of items) {
    if (!inScope(item)) continue;
    const cell = cellOf(item);
    if (lineHasState(item)) stateful.add(cell);
    else if (!keep.has(cell) || String(item.id) < keep.get(cell)) keep.set(cell, String(item.id));
  }
  const out = items.filter(item => {
    if (!inScope(item) || lineHasState(item)) return true;
    const cell = cellOf(item);
    return !stateful.has(cell) && keep.get(cell) === String(item.id);
  });
  return out.length === items.length ? items : out;
}
// Aynı tur numarası iki cihazda eşzamanlı açıldıysa ilk açılış kalır (sıradan bağımsız seçim).
const roundKey = round => JSON.stringify([clean(round && round.at, 80), clean(round && round.by, 160), clean(round && round.byName, 240), clean(round && round.note, 1000)]);
function mergeRounds(a, b) {
  return normalizeRounds([...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])].sort((x, y) => (Number(x && x.n) || 0) - (Number(y && y.n) || 0) || roundKey(x).localeCompare(roundKey(y))));
}
function mergeRequestCopies(a, b) {
  if (!a || typeof a !== 'object') return b;
  if (!b || typeof b !== 'object') return a;
  let newer = newerRequest(a, b);
  const other = newer === a ? b : a;
  /* Üreticisiz talebin bekleyen modelleri (request.models) yeni sürüm alanıdır.
     Alanı tanımayan eski sürüm kopyası (anahtar hiç yok) seçilirse modeller
     kaybolmasın: diğer kopyadakiler, satırı açılmamış olanlarla taşınır. */
  if (!Array.isArray(newer.models) && Array.isArray(other.models) && other.models.length) {
    const lined = new Set((Array.isArray(newer.items) ? newer.items : []).map(item => item && item.modelKey));
    newer = { ...newer, models: other.models.filter(model => model && !lined.has(model.modelKey)) };
  }
  const otherItems = new Map((Array.isArray(other.items) ? other.items : []).filter(item => item && item.id).map(item => [String(item.id), item]));
  const newerItems = Array.isArray(newer.items) ? newer.items : [];
  let changed = false, twins = 0;
  let items = newerItems.map(item => {
    const twin = item && otherItems.get(String(item.id));
    if (!twin) return item;
    twins++;
    const itemAt = String(item.updatedAt || ''), twinAt = String(twin.updatedAt || '');
    const winner = twinAt !== itemAt ? (twinAt > itemAt ? twin : item) : (sameLineState(item, twin) || lineStateKey(twin) <= lineStateKey(item) ? item : twin);
    const history = unionHistory(item.history, twin.history);
    const rev = Math.max(positiveInt(item.rev, 0), positiveInt(twin.rev, 0));
    const merged = { ...item, price: winner.price, approved: winner.approved, dropped: winner.dropped, updatedAt: winner.updatedAt, updatedBy: winner.updatedBy, history, rev };
    // Ana fiyatın etiketi/notu fiyatla birlikte taşınır (alternatifle yer değiştirme).
    if (winner !== item && winner.priceLabel !== undefined) { merged.priceLabel = winner.priceLabel; merged.priceNote = winner.priceNote; }
    if (winner !== item || history.length !== (Array.isArray(item.history) ? item.history.length : 0) || rev !== positiveInt(item.rev, 0)) changed = true;
    return merged;
  });
  // Yalnız diğer kopyada olan satır, başka cihazın eşzamanlı eklemesidir.
  if (twins < otherItems.size) {
    const known = new Set(newerItems.filter(item => item && item.id).map(item => String(item.id)));
    const added = [];
    for (const [id, item] of otherItems) if (!known.has(id)) added.push(item);
    items = items.concat(added);
    changed = true;
    items = withoutRedundantLines(items, new Set(added.map(item => item.modelKey)));
  }
  // Diğer kopyadaki üretici yalnız bir satır onu hâlâ kullanıyorsa eklenir (yeniden adlandırılan eski ad geri gelmez).
  const listed = new Set((Array.isArray(newer.manufacturers) ? newer.manufacturers : []).map(item => manufacturerKey(item && item.name)));
  let extraManufacturers = (Array.isArray(other.manufacturers) ? other.manufacturers : []).filter(item => { const key = manufacturerKey(item && item.name); return key && !listed.has(key); });
  if (extraManufacturers.length) {
    const used = new Set([...new Set(items.map(item => item && item.manufacturer))].map(manufacturerKey));
    extraManufacturers = extraManufacturers.filter(item => { const key = manufacturerKey(item.name); if (listed.has(key) || !used.has(key)) return false; listed.add(key); return true; });
  }
  const round = Math.max(positiveInt(newer.round, 1), positiveInt(other.round, 1));
  const otherRounds = Array.isArray(other.rounds) ? other.rounds : [];
  const rounds = otherRounds.length ? mergeRounds(newer.rounds, otherRounds) : normalizeRounds(newer.rounds);
  const roundsChanged = round !== positiveInt(newer.round, 1) || (otherRounds.length > 0 && JSON.stringify(rounds) !== JSON.stringify(normalizeRounds(newer.rounds)));
  // Bekleyen model yalnız azalır: birleşik kümede satırı açılan model listeden düşer.
  let models = newer.models;
  if (Array.isArray(newer.models) && newer.models.length) {
    const lined = new Set(items.map(item => item && item.modelKey));
    models = newer.models.filter(model => !(model && lined.has(model.modelKey)));
  }
  const modelsChanged = Array.isArray(newer.models) && models.length !== newer.models.length;
  if (!changed && !extraManufacturers.length && !roundsChanged && !modelsChanged) return newer;
  const out = { ...newer, items, round, rounds };
  if (extraManufacturers.length) out.manufacturers = [...(Array.isArray(newer.manufacturers) ? newer.manufacturers : []), ...extraManufacturers];
  if (Array.isArray(newer.models)) out.models = models;
  return out;
}

module.exports = {
  MAX_HISTORY, MAX_ROUNDS, EVENT_TYPES,
  priceNumber, samePrice, normalizeEvent, normalizeHistory, unionHistory, normalizeRounds,
  makeEvent, lineEvents, applyLineChange, effectiveHistory, mergeRequestCopies, newerRequest,
};
