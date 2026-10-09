'use strict';

/* Sentetik Endeksmatik USD-model çalışma kitabı üretir.
 * Gerçek ülke dosyaları şirket verisidir ve depoya girmez; bu üretici aynı
 * sayfa adları, başlık yapısı, pivot hiyerarşisi (aşağı doldurulmamış üst
 * seviye etiketleri, "Toplam X" ara toplamları, "Genel Toplam") ve ENDEKSMATİK
 * formül mantığıyla küçük bir kitap kurar. Değerler uydurmadır. */

const XLSX = require('xlsx');

const MONTHS = ['202411', '202501', '202507', '202602', '202607', '202702'];
const COMPONENT_SHEETS = ['KLASMAN KUMAŞ PİVOT', 'KLASMAN CMT PİVOT', 'KLASMAN AKSESUAR PİVOT', 'KLASMAN EK İŞLEM PİVOT'];
const CLASSES = [
  { dims: ['CUW4', 'CU4E', 'ÖRME', 'LİSANS', 'KEY ORME BODY'], weights: [0.5, 0.3, 0.15, 0.05], base: [10, 20, 5, 2], growth: [0.10, 0.20, 0.05, -0.02] },
  { dims: ['CUW4', 'CU4E', 'ÖRME', 'LİSANS', 'SWEATSHIRT'], weights: [0.4, 0.4, 0.1, 0.1], base: [12, 18, 4, 3], growth: [0.08, 0.12, 0.00, 0.04] },
  { dims: ['CUW4', 'CU4E', 'DOKUMA', 'LİSANS', 'SWEATSHIRT'], weights: [0.6, 0.25, 0.1, 0.05], base: [9, 25, 6, 1], growth: [0.02, 0.30, 0.10, 0.00] },
  { dims: ['KZE1', 'KZ1A', 'ÖRME', 'BASIC', 'TSHIRT'], weights: [0.55, 0.3, 0.1, 0.05], base: [7, 15, 3, 2], growth: [0.15, 0.05, 0.02, 0.01] },
];

// Aylar boyunca doğrusal büyüme: P(ay) = base × (1 + growth × adım)
function seriesFor(cls, component) { return MONTHS.map((_, i) => cls.base[component] * (1 + cls.growth[component] * i / (MONTHS.length - 1))); }
function avg(list) { return list.reduce((a, b) => a + b, 0) / list.length; }
function groupRows(level) {
  const groups = new Map();
  CLASSES.forEach(cls => { const key = cls.dims.slice(0, level).join('|'); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(cls); });
  return groups;
}
function groupSeries(members, component) { return MONTHS.map((_, m) => avg(members.map(cls => seriesFor(cls, component)[m]))); }
function groupWeights(members) { return [0, 1, 2, 3].map(c => avg(members.map(cls => cls.weights[c]))); }

/* Hiyerarşiyi pivot tablo düzeninde yazar: detay satırlarında üst seviye
   etiketler yalnız grubun ilk satırında; her grubun altında "Toplam X". */
/* repeatLabels: gerçek ülke dosyalarındaki "öğe etiketlerini yinele" düzeni —
   her satırda üst seviye etiketler de yazılıdır, ara toplam satırı da
   ("CUW4 | Toplam CU4E | ∅ …"). */
function hierarchyRows(valueOf, { totalStyle = 'prefix', repeatLabels = false } = {}) {
  const out = [];
  const label = name => (totalStyle === 'suffix' ? `${name} Toplam` : `Toplam ${name}`);
  const walk = (members, level, prefix) => {
    const byNext = new Map();
    members.forEach(cls => { const k = cls.dims[level]; if (!byNext.has(k)) byNext.set(k, []); byNext.get(k).push(cls); });
    let first = true;
    for (const [name, group] of byNext) {
      if (level === 4) {
        const dims = ['', '', '', '', '']; dims[4] = name;
        if (first || repeatLabels) for (let j = 0; j < 4; j++) dims[j] = prefix[j];
        out.push([...dims, ...valueOf(group, 5)]);
      } else {
        const start = out.length;
        walk(group, level + 1, [...prefix, name]);
        // Grubun ilk satırı üst seviye etiketlerini taşır (aşağı doldurma testi).
        if (first) for (let j = 0; j < level; j++) out[start][j] = prefix[j];
        out[start][level] = name;
        const total = ['', '', '', '', '']; for (let j = 0; j < level; j++) total[j] = repeatLabels ? prefix[j] : ''; total[level] = label(name);
        out.push([...total, ...valueOf(group, level + 1)]);
      }
      first = false;
    }
  };
  walk(CLASSES, 0, []);
  out.push(['Genel Toplam', '', '', '', '', ...valueOf(CLASSES, 0)]);
  return out;
}
const DIM_HEADER = ['Merch Marka Yaş Grup', 'Merch Alt Grup', 'Tedarik Grup', 'Buyer Grup', 'Klasman'];

function pivotSheet(component, opts) {
  const aoa = [['KLASMAN PİVOT'], [], [], [], [], [null, ...DIM_HEADER, ...MONTHS.map(m => `Toplam ${m}`)]];
  hierarchyRows(members => groupSeries(members, component), opts).forEach(row => aoa.push([null, ...row]));
  return XLSX.utils.aoa_to_sheet(aoa);
}
function summarySheet(opts) {
  // 'klasmanCodeFirst': "Klasman Kodu" sütunu "Klasman"dan ÖNCE gelir (önek tuzağı).
  // 'summaryMismatch': özetteki klasman adları pivotlardan farklıdır.
  const code = Boolean(opts.klasmanCodeFirst);
  const aoa = [['KLASMAN LİSTESİ ÖZET'], [], [], [], [], [null, ...(code ? ['Klasman Kodu'] : []), ...DIM_HEADER, 'Kumaş Pay', 'CMT Pay', 'Aksesuar Pay', 'Ek İşlem Pay', 'Adet']];
  hierarchyRows(members => [...groupWeights(members), members.length * 100], opts).forEach(row => {
    const dims = row.slice(0, 5);
    if (opts.summaryMismatch && dims[4] && !/toplam/i.test(dims[4])) dims[4] = `${dims[4]} X`;
    aoa.push([null, ...(code ? [dims[4] ? `K-${dims[4].length}` : ''] : []), ...dims, ...row.slice(5)]);
  });
  return XLSX.utils.aoa_to_sheet(aoa);
}
function fxSheet() {
  const ws = XLSX.utils.aoa_to_sheet([[]]);
  const put = (addr, v) => { ws[addr] = typeof v === 'number' ? { t: 'n', v } : { t: 's', v }; };
  put('X1', 'Ay'); put('Y1', 'TAKA'); put('CW1', 'Ay'); put('CX1', 'DOLAR');
  MONTHS.forEach((m, i) => { put(`X${i + 2}`, Number(m)); put(`Y${i + 2}`, 110 + i); put(`CW${i + 2}`, Number(m)); put(`CX${i + 2}`, 30 + i * 2); });
  ws['!ref'] = `A1:CX${MONTHS.length + 1}`;
  return ws;
}
function selectionSeries(selection, level, component) {
  const members = CLASSES.filter(cls => selection.slice(0, level).every((v, i) => !v && i === 2 ? true : cls.dims[i] === v));
  return level === 5 ? seriesFor(members[0], component) : groupSeries(members, component);
}
function selectionWeights(selection, level) {
  const members = CLASSES.filter(cls => selection.slice(0, level).every((v, i) => cls.dims[i] === v));
  return level === 5 ? members[0].weights : groupWeights(members);
}
/* Excel'in kendi hesabını (önbellekli sonuç) motordan BAĞIMSIZ kurar. */
function excelResults({ selection, previousOrderMonth, orderMonth, adjustment }) {
  const grand = selection[0] === 'Genel Toplam';
  const level = grand ? 0 : selection.findIndex(v => !v) < 0 ? 5 : selection.findIndex(v => !v);
  const pi = MONTHS.indexOf(previousOrderMonth), ci = MONTHS.indexOf(orderMonth);
  const deltas = [0, 1, 2, 3].map(c => { const s = selectionSeries(selection, level, c); return s[ci] / s[pi] - 1; });
  const weights = selectionWeights(selection, level);
  const total = deltas.reduce((sum, d, i) => sum + d * weights[i], 0);
  const targets = deltas.map(d => (1 + d) * (1 - adjustment) - 1);
  return { deltas, weights, total, targets };
}
/* ENDEKSMATİK ekranı — gerçek ülke dosyalarının yerleşimi (v7.0.270):
   C15..C18 Δ (pivot A sütunundaki birleşik anahtarla VLOOKUP, ay sütunu
   Seçimler'den), E15..E18 maliyet payları (ÖZET'ten VLOOKUP), C19 = Σ C·E,
   B21 düzeltme, C22..C25 hedefler. */
function screenSheet({ selection, previousOrderMonth, orderMonth, adjustment, breakFormula, cacheOffset, grandTotal }) {
  const ws = XLSX.utils.aoa_to_sheet([[]]);
  const put = (addr, v, f) => { ws[addr] = typeof v === 'number' ? { t: 'n', v } : { t: 's', v: v == null ? '' : v }; if (f) ws[addr].f = f; };
  put('B2', 'SEZON :'); put('C2', 'SS27');
  put('B3', 'SON GÜNCELLEME TARİHİ :'); put('C3', 46181);
  ['MMYG', 'MAG', 'TEDARİK GRUP', 'BUYER GRUP', 'KLASMAN'].forEach((l, i) => {
    put(`B${4 + i}`, l);
    if (grandTotal) { if (i === 0) put('C4', 'Genel Toplam'); }
    else put(`C${4 + i}`, selection[i] || '(Tümü)');
  });
  put('B9', 'GEÇEN YIL SİPARİŞ YERLEŞTİRME'); put('C9', Number(previousOrderMonth));
  put('B10', 'GEÇEN YIL ANTREPO AY'); put('C10', 202602);
  put('B11', 'BU YIL SİPARİŞ YERLEŞTİRME'); put('C11', Number(orderMonth));
  put('B12', 'BU YIL ANTREPO AY'); put('C12', 202702);
  put('B21', adjustment);
  const r = excelResults({ selection: grandTotal ? ['Genel Toplam', '', '', '', ''] : selection, previousOrderMonth, orderMonth, adjustment });
  const key = 'C4&"_"&C5&"_"&C6&"_"&C7&"_"&C8';
  const look = (sheet, month) => `VLOOKUP(${key},'${sheet}'!$A:$AF,VLOOKUP("Toplam "&${month},Seçimler!$AT$1:$AU$116,2,FALSE),FALSE)`;
  const labels = ['KUMAŞ', 'CMT', 'AKSESUAR', 'EK İŞLEM'];
  COMPONENT_SHEETS.forEach((sheet, i) => {
    const current = breakFormula === 'depot' && i === 1 ? 'C12' : 'C11';
    const other = breakFormula === 'crossPivot' && i === 0 ? COMPONENT_SHEETS[1] : sheet;
    put(`B${15 + i}`, `${labels[i]} ENDEKSİ`);
    put(`C${15 + i}`, r.deltas[i] + (cacheOffset && i === 0 ? cacheOffset : 0), `IFERROR(${look(other, current)}/${look(other, 'C9')}-1,"-")`);
    put(`E${15 + i}`, r.weights[i], `VLOOKUP(${key},'KLASMAN LİSTESİ ÖZET'!$A:$J,${7 + i},FALSE)`);
    put(`B${22 + i}`, `${labels[i]} HEDEFİ`);
    // 'targetsElsewhere': hedef hücreleri B21/C'ye bağlı değil (uyarı, red değil).
    if (breakFormula === 'targetsElsewhere') put(`C${22 + i}`, 0.5 + i, `E${15 + i}*2`);
    else if (breakFormula === 'noAdjustment') put(`C${22 + i}`, r.deltas[i], `C${15 + i}`);
    else put(`C${22 + i}`, r.targets[i], `(1+C${15 + i})*(1-$B$21)-1`);
  });
  put('B19', 'TOPLAM ENDEKS');
  put('C19', r.total, 'IFERROR(C15*$E$15+C16*$E$16+C17*$E$17+C18*$E$18,"-")');
  ws['!ref'] = 'A1:F25';
  return ws;
}

function buildEndeksmatikWorkbook(options = {}) {
  const opts = {
    selection: ['CUW4', 'CU4E', 'ÖRME', 'LİSANS', 'KEY ORME BODY'], previousOrderMonth: '202507', orderMonth: '202607', adjustment: 0.03,
    ...options,
  };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, screenSheet(opts), 'ENDEKSMATİK');
  XLSX.utils.book_append_sheet(wb, summarySheet(opts), 'KLASMAN LİSTESİ ÖZET');
  COMPONENT_SHEETS.forEach((name, i) => XLSX.utils.book_append_sheet(wb, pivotSheet(i, opts), name));
  if (!opts.withoutFx) XLSX.utils.book_append_sheet(wb, fxSheet(), 'Değişimler');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Bütçe Çalışma']]), 'Bütçe Çalışma');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = { MONTHS, CLASSES, seriesFor, groupSeries, groupWeights, excelResults, buildEndeksmatikWorkbook };
