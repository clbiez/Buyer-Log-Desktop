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
function similarity(left, right) {
  const a = comparable(left), b = comparable(right), names = new Set([...Object.keys(a), ...Object.keys(b)]);
  let score = 0;
  for (const name of names) if ((a[name] || '') === (b[name] || '')) score += 1;
  return score;
}
function rowsOf(map) {
  return Object.values(map && typeof map === 'object' ? map : {}).filter(row => row && typeof row === 'object' && !Array.isArray(row));
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
  // v7.15: similarity(i, j) kalan satırlar değişse de sabittir; eskiden her seçim
  // turunda baştan hesaplanıyordu (kova başına O(k³) similarity çağrısı ve her
  // çağrıda iki nesne kurulumu). Matris bir kez kurulur, turlar yalnız sayı
  // karşılaştırır. Seçim sırası ve sonuç birebir aynıdır: eşit puanda ilk
  // bulunan (en küçük oi, sonra en küçük ni) yine kazanır.
  {
    const scores = oldLeft.map(oldRow => newLeft.map(newRow => similarity(oldRow, newRow)));
    const oldAlive = oldLeft.map(() => true), newAlive = newLeft.map(() => true);
    let remaining = Math.min(oldLeft.length, newLeft.length);
    const chosen = [];
    while (remaining > 0) {
      let bestOld = -1, bestNew = -1, bestScore = -1;
      for (let oi = 0; oi < oldLeft.length; oi += 1) {
        if (!oldAlive[oi]) continue;
        const row = scores[oi];
        for (let ni = 0; ni < newLeft.length; ni += 1) {
          if (!newAlive[ni]) continue;
          if (row[ni] > bestScore) { bestScore = row[ni]; bestOld = oi; bestNew = ni; }
        }
      }
      if (bestOld < 0) break;
      oldAlive[bestOld] = false; newAlive[bestNew] = false; remaining -= 1;
      chosen.push({ oldRow: oldLeft[bestOld], newRow: newLeft[bestNew] });
    }
    for (const item of chosen) pairs.push({ oldRow: item.oldRow, newRow: item.newRow, kind: 'changed' });
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
