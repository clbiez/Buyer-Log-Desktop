'use strict';

// Antrepo haritasının __ias_row_N anahtarı yalnız o sorgudaki satır sırasıdır;
// yenilemeler arasında kimlik olarak kullanılamaz. Bu modül satırları iş
// alanlarıyla çoklu-küme olarak eşleştirir, aynı kimlikteki parsiyelleri önce
// birebir içerikle, sonra en çok ortak alana göre çiftler.

// v7.15 — SIRALAMA KARŞILAŞTIRICILARI BİR KEZ KURULUR.
// String.prototype.localeCompare(x, locale, options) her çağrıda yeni bir
// karşılaştırıcı kuruyor. Bu dosyada sıralama satır başına ~165 karşılaştırma
// yapıyordu; gerçek Antrepo verisinde imza üretimi satır başına 763 µs sürüyordu.
// Aynı ayarlarla önceden kurulmuş Intl.Collator ile bu 26 µs'ye iniyor ve
// karşılaştırma semantiği birebir korunur.
const FIELD_COLLATOR = new Intl.Collator('tr', { sensitivity: 'base' });
const FIELD_COLLATOR_NUMERIC = new Intl.Collator('tr', { numeric: true, sensitivity: 'base' });
const DEFAULT_COLLATOR = new Intl.Collator();

function clean(value) { return String(value == null ? '' : value).trim(); }
function valueText(value) {
  if (value == null || value === '') return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    try { return JSON.stringify(value); } catch (_) { return clean(value); }
  }
  return clean(value);
}
function sourceFields(row) {
  const raw = row && row._sourceFields && typeof row._sourceFields === 'object' ? row._sourceFields : null;
  if (raw && Object.keys(raw).length) {
    return Object.fromEntries(Object.entries(raw).filter(([name]) => name && !/^__(CPX|MATCH)_/i.test(name) && name !== '__BLRowGuard'));
  }
  const labels = {
    ocode:'Sipariş Kod',model:'Model Adı / Ürün Adı',ccode:'Renk Kod',colour:'Renk Tanımı',
    importFile:'İthalat Dosya No',containerNo:'Konteyner No',statu:'Supplier Portal Statü',
    arr:'Tahmini Antrepo Giriş Tarihi',handover:'Handover Tarihi',vasita:'Vasıta',
    loadedQty:'Yükleme Toplam Adet',iasOrderQty:'IAS Sipariş Adedi',
  };
  const fields = {};
  for (const [key, label] of Object.entries(labels)) if (row && Object.prototype.hasOwnProperty.call(row, key)) fields[label] = row[key];
  return fields;
}
// v7.15 — ÖNBELLEKLİ TÜRETME.
// comparable() ve signature() aynı satır nesnesi için defalarca çağrılıyordu:
// pairBucket'ta her eski satır için bir kez, ardından aday listesindeki HER yeni
// satır için tekrar. Her çağrı 33 alanı kopyalıyor ve tr-locale ile sıralıyordu;
// gerçek Antrepo verisinde çağrı başına ~0,78 ms, toplamda 4.494 satır için
// 7 saniye. Satır nesneleri bu tur boyunca değişmediği için sonuç WeakMap'te
// tutulur — davranış aynı, maliyet satır başına bir kez.
const comparableCache = new WeakMap();
const signatureCache = new WeakMap();
function comparable(row) {
  if (!row || typeof row !== 'object') return Object.fromEntries(Object.entries(sourceFields(row)).map(([name, value]) => [name, valueText(value)]));
  const cached = comparableCache.get(row);
  if (cached) return cached;
  const value = Object.fromEntries(Object.entries(sourceFields(row)).map(([name, item]) => [name, valueText(item)]));
  comparableCache.set(row, value);
  return value;
}
function signature(row) {
  if (!row || typeof row !== 'object') return JSON.stringify(Object.entries(comparable(row)).sort(([a],[b]) => FIELD_COLLATOR.compare(a, b)));
  const cached = signatureCache.get(row);
  if (cached !== undefined) return cached;
  const value = JSON.stringify(Object.entries(comparable(row)).sort(([a],[b]) => FIELD_COLLATOR.compare(a, b)));
  signatureCache.set(row, value);
  return value;
}
function identity(row) {
  const match = row && row._matchValues && typeof row._matchValues === 'object'
    ? Object.entries(row._matchValues).filter(([,value]) => clean(value)).sort(([a],[b]) => DEFAULT_COLLATOR.compare(a, b)).map(([key,value]) => `${key}:${clean(value).toLocaleUpperCase('tr-TR')}`)
    : [];
  const line = match.length ? match : [
    `order:${clean(row && (row._matchOcode || row.ocode)).toLocaleUpperCase('tr-TR')}`,
    `model:${clean(row && row.model).toLocaleUpperCase('tr-TR')}`,
    `colour:${clean(row && row.ccode).toLocaleUpperCase('tr-TR')}`,
  ];
  // İthalat dosyası / konteyner aynı model satırındaki gerçek parsiyeli ayırır.
  // İkisi de boşsa aynı iş kimliğindeki çoğul kayıtlar aşağıda multiset olarak eşleşir.
  line.push(`import:${clean(row && row.importFile).toLocaleUpperCase('tr-TR')}`);
  line.push(`container:${clean(row && row.containerNo).toLocaleUpperCase('tr-TR')}`);
  return line.join('|');
}
function rowsOf(map) {
  return Object.values(map && typeof map === 'object' ? map : {}).filter(row => row && typeof row === 'object' && !Array.isArray(row));
}
// Benzerlik eşleştirmesi k² puan üretir. Bu sınırın üstündeki (gerçek veride
// görülmeyen, bozuk/boş kimlikli) kovalarda satırlar kaynak sırasıyla eşlenir;
// bu yalnız yenileme geçmişindeki fark satırlarının eşini etkiler, iş verisini
// etkilemez ve yenilemenin sunucuyu kilitlemesini önler.
const MAX_SIMILARITY_BUCKET = 1500;
function pairInSourceOrder(oldCount, newCount) {
  const out = [];
  for (let index = 0; index < Math.min(oldCount, newCount); index += 1) out.push([index, index]);
  return out;
}
// Benzerlik puanı: iki satırdan en az birinde bulunan her alan için
// (eksik alan '' sayılır) değer eşitse +1. Alan adları kova başına bir kez
// dizilir; satır başına değerler aynı sırada tutulur (eksik = undefined).
function pairBySimilarity(oldRows, newRows) {
  const names = [], nameIndex = new Map();
  const vectorOf = row => {
    const values = comparable(row), vector = [];
    for (const name of Object.keys(values)) {
      let index = nameIndex.get(name);
      if (index === undefined) { index = names.length; names.push(name); nameIndex.set(name, index); }
      vector[index] = values[name];
    }
    return vector;
  };
  const oldVectors = oldRows.map(vectorOf), newVectors = newRows.map(vectorOf);
  const width = names.length, oldCount = oldRows.length, newCount = newRows.length;
  const scores = new Uint16Array(oldCount * newCount), counts = new Uint32Array(width + 2);
  for (let oi = 0; oi < oldCount; oi += 1) {
    const a = oldVectors[oi];
    for (let ni = 0; ni < newCount; ni += 1) {
      const b = newVectors[ni];
      let score = 0;
      for (let field = 0; field < width; field += 1) {
        const left = a[field], right = b[field];
        if (left === undefined && right === undefined) continue;
        if ((left || '') === (right || '')) score += 1;
      }
      scores[oi * newCount + ni] = score;
      counts[score] += 1;
    }
  }
  // Puan kovaları yüksekten düşüğe; her kova içinde (oi, ni) artan sırada.
  const starts = new Uint32Array(width + 2);
  for (let score = width, offset = 0; score >= 0; score -= 1) { starts[score] = offset; offset += counts[score]; }
  const order = new Uint32Array(oldCount * newCount);
  for (let cell = 0; cell < scores.length; cell += 1) order[starts[scores[cell]]++] = cell;
  const oldTaken = new Uint8Array(oldCount), newTaken = new Uint8Array(newCount), chosen = [];
  let remaining = Math.min(oldCount, newCount);
  for (let position = 0; position < order.length && remaining > 0; position += 1) {
    const cell = order[position], oi = Math.floor(cell / newCount), ni = cell - oi * newCount;
    if (oldTaken[oi] || newTaken[ni]) continue;
    oldTaken[oi] = 1; newTaken[ni] = 1; remaining -= 1;
    chosen.push([oi, ni]);
  }
  return chosen;
}
function pairBucket(oldRows, newRows) {
  const oldLeft = oldRows.slice(), newLeft = newRows.slice(), pairs = [];
  // Önce değişmemiş kayıtları eşleştir: yalnız sıra değişikliği sahte fark üretmez.
  // v7.15: eskiden bu adım her eski satır için newLeft'i baştan tarayıp aday başına
  // signature() hesaplıyordu (kova başına O(k²) imza üretimi). Artık imzadan yeni
  // satır sırasına bir Map kurulur ve eşleşme hash ile bulunur. Semantik korunur:
  // eski satırlar sondan başa taranır ve her imza için newLeft'teki EN KÜÇÜK
  // indeks seçilir — findIndex'in döndürdüğü ilk eşleşmenin aynısı.
  const newBySignature = new Map();
  for (let ni = 0; ni < newLeft.length; ni += 1) {
    const key = signature(newLeft[ni]);
    if (!newBySignature.has(key)) newBySignature.set(key, []);
    newBySignature.get(key).push(ni);
  }
  const matched = [];              // { oldIndex, newIndex } — açık eşleme
  const takenNew = new Set();
  for (let oi = oldLeft.length - 1; oi >= 0; oi -= 1) {
    const queue = newBySignature.get(signature(oldLeft[oi]));
    if (!queue || !queue.length) continue;
    const ni = queue.shift();
    matched.push({ oldIndex: oi, newIndex: ni });
    takenNew.add(ni);
  }
  for (const { oldIndex, newIndex } of matched) {
    pairs.push({ oldRow: oldLeft[oldIndex], newRow: newLeft[newIndex], kind: 'same' });
  }
  // Eşleşenleri listelerden çıkar: indeksler kaymasın diye büyükten küçüğe sil.
  for (const { oldIndex } of [...matched].sort((a, b) => b.oldIndex - a.oldIndex)) oldLeft.splice(oldIndex, 1);
  for (const newIndex of [...takenNew].sort((a, b) => b - a)) newLeft.splice(newIndex, 1);
  // Kalan parsiyelleri en çok ortak sütuna göre eşleştir.
  // v7.0.252 — Eski açgözlü döngü her seçim turunda tüm puan matrisini yeniden
  // tarıyordu: kova başına O(k³) ve tamamı senkron. 1.500 parsiyelli tek kova
  // ~10 sn, birkaç bin parsiyel dakikalarca sürüyor; sunucu bu sürede hiçbir
  // isteğe (yenileme durumu dahil) cevap veremediği için ilerleme penceresi
  // "Denetleme ve Kaydetme" adımında donuyordu. Artık çiftler puan kovalarına
  // bir kez dağıtılır (sayma sıralaması) ve tek geçişte seçilir. Seçim sırası
  // ve sonuç birebir aynıdır: en yüksek puan, eşit puanda en küçük oi, sonra
  // en küçük ni kazanır.
  const chosen = oldLeft.length && newLeft.length
    ? (Math.max(oldLeft.length, newLeft.length) > MAX_SIMILARITY_BUCKET
      ? pairInSourceOrder(oldLeft.length, newLeft.length)
      : pairBySimilarity(oldLeft, newLeft))
    : [];
  const oldAlive = oldLeft.map(() => true), newAlive = newLeft.map(() => true);
  for (const [oi, ni] of chosen) {
    oldAlive[oi] = false; newAlive[ni] = false;
    pairs.push({ oldRow: oldLeft[oi], newRow: newLeft[ni], kind: 'changed' });
  }
  {
    const restOld = oldLeft.filter((_, index) => oldAlive[index]);
    const restNew = newLeft.filter((_, index) => newAlive[index]);
    oldLeft.length = 0; oldLeft.push(...restOld);
    newLeft.length = 0; newLeft.push(...restNew);
  }
  oldLeft.forEach(oldRow => pairs.push({ oldRow, newRow:null, kind:'removed' }));
  newLeft.forEach(newRow => pairs.push({ oldRow:null, newRow, kind:'added' }));
  return pairs;
}
function pairAntrepoRows(oldMap, newMap) {
  const oldGroups = new Map(), newGroups = new Map();
  for (const row of rowsOf(oldMap)) { const key = identity(row); if (!oldGroups.has(key)) oldGroups.set(key, []); oldGroups.get(key).push(row); }
  for (const row of rowsOf(newMap)) { const key = identity(row); if (!newGroups.has(key)) newGroups.set(key, []); newGroups.get(key).push(row); }
  const pairs = [];
  for (const key of new Set([...oldGroups.keys(), ...newGroups.keys()])) pairs.push(...pairBucket(oldGroups.get(key) || [], newGroups.get(key) || []));
  return pairs;
}
function fieldChanges(oldRow, newRow) {
  const before = comparable(oldRow), after = comparable(newRow), names = [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .sort((a,b) => FIELD_COLLATOR_NUMERIC.compare(a, b));
  return names.filter(name => (before[name] || '') !== (after[name] || '')).map(name => ({ field:name, before:before[name] || '', after:after[name] || '' }));
}

module.exports = { valueText, sourceFields, comparable, signature, identity, pairAntrepoRows, fieldChanges };
