'use strict';

/*
 * Sentetik Koleksiyon çalışma alanı (#1079 WS6a). WS0 fixture'ında Koleksiyon boş
 * olduğundan modül hazırlığı gerçek veriyle ölçülemiyordu. Bu üretici belirlenimci
 * (seed) satırlar üretir; yalnız sentetik değerler içerir, iş verisi yoktur.
 */

function rng(seed) {
  let s = (Number(seed) >>> 0) || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
const pick = (r, list) => list[Math.floor(r() * list.length)];

const SEASONS = ['24SS', '24AW', '25SS', '25AW', '26SS', '26AW'];
const COUNTRIES = ['Turkey', 'China', 'Bangladesh', 'Egypt', 'India', 'Vietnam']; // i18n-ignore — sentetik veri
const CATEGORIES = ['Sweater', 'Cardigan', 'Vest', 'Pullover', 'Tunic']; // i18n-ignore — sentetik veri
const LICENSES = ['', '', 'LIC-A', 'LIC-B', 'LIC-C'];
const LICENSORS = { 'LIC-A': 'Licensor A', 'LIC-B': 'Licensor B', 'LIC-C': 'Licensor C' }; // i18n-ignore — sentetik veri
const STATUSES = ['Pending File', 'Sample Requested', 'Approved', 'Cancelled']; // i18n-ignore — sentetik veri
const MANUFACTURERS = ['MFR-01', 'MFR-02', 'MFR-03', 'MFR-04', 'MFR-05'];
const LINES = ['Basic', 'Trend', 'Premium']; // i18n-ignore — sentetik veri
const COLOURS = ['Navy', 'Ecru', 'Black', 'Grey Melange', 'Bordeaux', 'Khaki']; // i18n-ignore — sentetik veri

function pad(n, width) { return String(n).padStart(width, '0'); }
function isoDate(base, offsetDays) { return new Date(base + offsetDays * 86400000).toISOString().slice(0, 10); }

function buildCollectionRows(count, seed = 7) {
  const r = rng(seed), base = Date.UTC(2026, 0, 5), rows = [];
  for (let i = 0; i < count; i++) {
    const lisans = pick(r, LICENSES), manufacturer = pick(r, MANUFACTURERS), ex = Math.floor(r() * 300);
    const pricing = {};
    for (const m of MANUFACTURERS) if (r() < 0.4 || m === manufacturer) pricing[m] = (3 + r() * 9).toFixed(2);
    rows.push({
      id: i + 1,
      mag: 'MAG-' + pad(1 + Math.floor(r() * 40), 2), mmyg: 'MMYG-' + pad(1 + Math.floor(r() * 12), 2),
      buyingGroup: 'BG-' + pad(1 + Math.floor(r() * 6), 1), buyer: 'Buyer ' + pad(1 + Math.floor(r() * 9), 1), // i18n-ignore — sentetik veri
      season: pick(r, SEASONS), durum: pick(r, STATUSES), productMainDefinition: pick(r, CATEGORIES), urunTipi: pick(r, CATEGORIES),
      plmId: String(2100000 + i), modelKod: 'MODEL-' + pad(i + 1, 6), colourCode: pad(Math.floor(r() * 999), 3), colour: pick(r, COLOURS),
      specialCode: '', line: pick(r, LINES), fabric: 'Fabric ' + pad(Math.floor(r() * 50), 2), assortment: '', fit: '', // i18n-ignore — sentetik veri
      quantity: String(500 + Math.floor(r() * 9500)), not: '',
      lisans, licensor: LICENSORS[lisans] || '', country: pick(r, COUNTRIES), delType: 'Gemi', // i18n-ignore — kanonik değer
      exFactory: isoDate(base, ex), retail: isoDate(base, ex + 45), inStore: isoDate(base, ex + 60),
      targetPrice: (4 + r() * 8).toFixed(2), buyingSampleApproved: r() < 0.3,
      pricing, selectedManufacturer: manufacturer,
    });
  }
  return rows;
}

function buildCollectionWorkspace(count, seed = 7) {
  const rows = buildCollectionRows(count, seed);
  return { schemaVersion: 1, initialized: true, rows, manufacturers: MANUFACTURERS.map(name => ({ name })), customColumns: [], nextId: rows.length + 1 };
}

module.exports = { buildCollectionRows, buildCollectionWorkspace };
