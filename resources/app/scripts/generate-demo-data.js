'use strict';

/*
 * Buyer Log demo veri üreticisi.
 *
 * Gerçek şirket verisi olmadan arayüzü dolu ekranlarla denemek, ekran görüntüsü
 * almak veya eğitim vermek için sahte (ama gerçekçi dağılımlı) kaynak Excel'leri
 * üretir. Üretim yoluna hiç dokunmaz: çıktı, Veri Yönetimi'nde "Kaynak Klasör"
 * olarak seçilebilecek sıradan bir klasördür.
 *
 *   node scripts/generate-demo-data.js <hedef-klasör> [--rows 220] [--seed 7]
 *
 * Üretilen dosyalar ASAS/Antrepo/LFL ayrıştırıcılarının GERÇEK başlıklarını
 * kullanır (server/lib/parse.js, server/lib/lfl.js). Değerler deterministik bir
 * PRNG'den gelir; aynı tohum her zaman aynı çalışma kitaplarını üretir.
 */

const fs = require('node:fs');
const path = require('node:path');
const XLSX = require('xlsx');

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index > 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CATALOG = {
  seasons: ['6W26', '6S27'],
  countries: [['MISIR', 0.3], ['TURKIYE', 0.25], ['BANGLADES', 0.2], ['CIN', 0.1], ['Georgia', 0.08], ['FAS', 0.07]],
  manufacturers: {
    MISIR: ['NILE KNIT', 'DELTA TEXTILE'], TURKIYE: ['ANADOLU TRIKO', 'EGE ORME', 'MARMARA KNIT'],
    BANGLADES: ['DHAKA APPAREL', 'CHITTAGONG KNIT'], CIN: ['NINGBO KNITWEAR'], Georgia: ['KUTAISI TEXTILE'], FAS: ['ATLAS KNIT'],
  },
  licenses: [['DISNEY', 'Disney'], ['MARVEL', 'Disney'], ['HARRY POTTER', 'Warner Bros'], ['NASA', 'NASA'],
    ['POKEMON', 'Pokemon'], ['FCB', 'FC Barcelona'], ['LOONEY TUNES', 'Warner Bros'], ['BARBIE', 'Mattel'], ['STAR WARS', 'Disney']],
  groups: [
    { buyerGroup: 'KIDS BOY', mag: 'KB', buyers: ['Ayşe K.', 'Mert Y.'], lines: ['Kids Boy Knit'] },
    { buyerGroup: 'KIDS GIRL', mag: 'KG', buyers: ['Deniz A.', 'Selin T.'], lines: ['Kids Girl Knit'] },
    { buyerGroup: 'TEEN', mag: 'TN', buyers: ['Burak E.'], lines: ['Teen Knit'] },
    { buyerGroup: 'MEN', mag: 'MN', buyers: ['Can D.', 'Emre S.'], lines: ['Men Licence'] },
    { buyerGroup: 'WOMEN', mag: 'WM', buyers: ['Ece B.'], lines: ['Women Licence'] },
  ],
  categories: [['KAZAK', 'A1'], ['SWEATSHIRT', 'B2'], ['HIRKA', 'A3'], ['T-SHIRT', 'C1'], ['PIJAMA', 'D4']],
  colours: [['SIYAH', 'S01'], ['LACIVERT', 'L02'], ['KIRMIZI', 'K01'], ['GRI MELANJ', 'G05'], ['EKRU', 'E03'],
    ['HAKI', 'H04'], ['PEMBE', 'P06'], ['MAVI', 'M01'], ['BORDO', 'B07']],
  motifs: ['Logo', 'Hero', 'Galaxy', 'Retro', 'Varsity', 'Stripe', 'Glitter', 'Crew', 'Classic', 'Neon', 'Pixel', 'Team'],
  fabrics: [['%100 PAMUK', '30/1', '180', 'Süprem'], ['%80 PAMUK %20 POLYESTER', '20/1', '280', 'İki İplik'],
    ['%50 YÜN %50 AKRİLİK', '2/28', '320', 'Triko'], ['%100 PAMUK', '24/1', '220', 'Ribana']],
  antrepoStatus: [['Depoda', 0.35], ['Yolda', 0.25], ['Üretimde', 0.3], ['Yüklemede', 0.1]],
  vehicles: ['GEMI', 'TIR', 'UCAK'],
};

function build({ rows = 220, seed = 7, today = new Date() } = {}) {
  const rand = mulberry32(seed);
  const pick = list => list[Math.floor(rand() * list.length)];
  const weighted = list => { let r = rand(), acc = 0; for (const [value, w] of list) { acc += w; if (r <= acc) return value; } return list[list.length - 1][0]; };
  const int = (min, max) => Math.floor(min + rand() * (max - min + 1));
  const iso = date => date.toISOString().slice(0, 10);
  const shift = days => { const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())); d.setUTCDate(d.getUTCDate() + days); return d; };

  const asasHeader = ['Sipariş Kod', 'Renk', 'Renk Kod', 'Net Alım Sipariş Miktarı', 'Kalan Alım Sipariş Miktarı',
    'Antrepoya Giren Miktar', 'FOB Fiyatı', 'Plm Kod', 'Özel Kod 1', 'Üretici', 'Sezon', 'Ürün Klasman',
    'Merch Alt Grup Kod', 'Merch Marka Yaş Grup Kod', 'Buyer Grup (TR)', 'Siparişin Üretildiği Ülke', 'Lisans',
    'Model Adı', 'Ürün Ana Tanım', 'Orijinal Exfactory Merch Tarih', 'Retail Depo Tarih Yıl Ay Gün',
    'Model Bütçe Tarih Yıl Ay Gün', 'Sipariş Yerleştirme MerchTarih', 'Buying Son Onay Tarihi', 'Buyer', 'Line',
    'Ana Kumaş Mı', 'Kumaş Kategorisi', 'Kumaşçı Ülkesi', 'Kumaşçı', 'Kumaş Tipi', 'İplik No', 'Gramaj', 'Karışım'];
  const antrepoHeader = ['Sipariş Kod', 'Model Adı', 'Renk Kod', 'Renk Tanım', 'Supplier Portal Statü',
    'Tahmini Antrepo Giriş Tarihi', 'Vasita Tanim', 'HANDOVER Tarihi', 'Yükleme Toplam Adet', 'Net Alım Sipariş Miktarı'];
  const lflHeader = ['Sipariş Kod', 'Model Adı', 'MAG', 'MMYG', 'Klasman', 'Sezon', 'IN-STORE (MODEL BUDGET)',
    'FOB Fiyatı', 'Net Alım Sipariş Miktarı', 'Üretici', 'Country', 'Buyer Grup (TR)', 'Buyer'];

  const asas = [['BUYER LOG DEMO — ASAS Sipariş Raporu (sahte veri)'], [], asasHeader];
  const antrepo = [antrepoHeader];
  const lfl = [['BUYER LOG DEMO — LFL (sahte veri)'], lflHeader];
  const models = new Map();
  let orderCode = 4100000;

  for (let i = 0; i < rows; i++) {
    const group = pick(CATALOG.groups);
    const [license] = pick(CATALOG.licenses);
    const [category, mmyg] = pick(CATALOG.categories);
    const modelKey = `${license}|${category}|${i % 70}`;
    if (!models.has(modelKey)) {
      models.set(modelKey, {
        name: `${license.split(' ')[0]} ${pick(CATALOG.motifs)} ${category.charAt(0)}${category.slice(1).toLowerCase()}`,
        plm: 880000 + models.size * 7,
        fob: Math.round((4.2 + rand() * 9.5) * 100) / 100,
      });
    }
    const model = models.get(modelKey);
    const country = weighted(CATALOG.countries);
    const manufacturer = pick(CATALOG.manufacturers[country]);
    const season = rand() < 0.65 ? CATALOG.seasons[0] : CATALOG.seasons[1];
    const [colour, ccode] = pick(CATALOG.colours);
    const qty = int(6, 60) * 100;
    const exDays = int(-45, 120);
    const shipped = exDays < -10 ? (rand() < 0.8 ? 1 : 0.6) : exDays < 15 ? rand() * 0.7 : 0;
    const received = Math.round(qty * shipped / 10) * 10;
    const kalan = Math.max(0, qty - received);
    const fabric = pick(CATALOG.fabrics);
    const ex = shift(exDays);
    const code = orderCode++;
    const buyer = pick(group.buyers);
    asas.push([
      code, colour, ccode, qty, kalan, received, Math.round((model.fob + (rand() - 0.5) * 0.6) * 100) / 100,
      model.plm, rand() < 0.15 ? 'ECO' : '', manufacturer, season, category, mmyg, group.mag, group.buyerGroup, country,
      license, model.name, `${category} ${license}`, iso(ex), iso(shift(exDays + int(20, 40))),
      iso(shift(exDays + int(35, 60))), iso(shift(exDays - int(90, 150))), iso(shift(exDays - int(20, 45))),
      buyer, pick(group.lines), 1, 'Örme', country === 'TURKIYE' ? 'Türkiye' : 'Türkiye', 'DEMO KUMAŞ A.Ş.',
      fabric[3], fabric[1], fabric[2], fabric[0],
    ]);
    if (received > 0 || exDays < 25) {
      const status = received >= qty ? 'Depoda' : weighted(CATALOG.antrepoStatus);
      const loaded = status === 'Üretimde' ? 0 : (received || Math.round(qty * (0.4 + rand() * 0.5) / 10) * 10);
      antrepo.push([code, model.name, ccode, colour, status, iso(shift(exDays + int(10, 28))), pick(CATALOG.vehicles),
        status === 'Depoda' ? iso(shift(exDays + int(3, 9))) : '', loaded, qty]);
    }
    // LFL: aynı modelin geçen yılki karşılığı (kıyas sezonu) ve bu sezon satırı.
    const lastYear = season.replace(/\d\d$/, yy => String(Number(yy) - 1).padStart(2, '0'));
    lfl.push([code, model.name, mmyg, group.mag, category, season, iso(shift(exDays + 45)), model.fob, qty, manufacturer, country, group.buyerGroup, buyer]);
    if (rand() < 0.8) {
      lfl.push([code - 900000, model.name, mmyg, group.mag, category, lastYear, iso(shift(exDays + 45 - 365)),
        Math.round(model.fob * (0.88 + rand() * 0.18) * 100) / 100, Math.round(qty * (0.7 + rand() * 0.6) / 100) * 100,
        manufacturer, country, group.buyerGroup, buyer]);
    }
  }
  return { asas, antrepo, lfl };
}

function writeBook(file, sheetName, aoa) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), sheetName);
  XLSX.writeFile(wb, file, { bookType: 'xlsx' });
}

function main() {
  const target = process.argv[2];
  if (!target || target.startsWith('--')) {
    console.error('Kullanım: node scripts/generate-demo-data.js <hedef-klasör> [--rows 220] [--seed 7]');
    process.exit(2);
  }
  const out = path.resolve(target);
  fs.mkdirSync(out, { recursive: true });
  const data = build({ rows: Number(argValue('--rows', 220)) || 220, seed: Number(argValue('--seed', 7)) || 7 });
  writeBook(path.join(out, 'ASAS - Demo.xlsx'), 'ASAS', data.asas);
  writeBook(path.join(out, 'Antrepo - Demo.xlsx'), 'Antrepo Raporu', data.antrepo);
  writeBook(path.join(out, 'LFL - Demo.xlsx'), 'LFL', data.lfl);
  console.log(`Demo kaynakları yazıldı: ${out}\n  ASAS ${data.asas.length - 3} satır · Antrepo ${data.antrepo.length - 1} · LFL ${data.lfl.length - 2}`);
}

if (require.main === module) main();
module.exports = { build };
