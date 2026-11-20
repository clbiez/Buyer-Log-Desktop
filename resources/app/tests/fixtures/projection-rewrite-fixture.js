'use strict';
// Sentetik projeksiyon nesli + kayıt adımları (#1078 takip / WS7b parite testleri). İş verisi yok.
function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const pad = n => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

function buildFixture({ rows = 200, seed = 7 } = {}) {
  const random = rng(seed), cp = [], orders = [], summary = [], overview = [];
  for (let i = 0; i < rows; i++) {
    const code = 1000000 + Math.floor(i / 2), line = i % 2;
    const ex = iso(2026, 1 + (i % 12), 1 + (i % 27));
    const row = {
      'Order Code': code, 'Model Name': `MDL ${code % 997}`, 'C.Code': `C${line}`, Line: ['Kadın', 'Erkek', 'Çocuk'][i % 3], Season: ['26SS', '26AW'][i % 2], // i18n-ignore
      Notes: random() < 0.2 ? `not ${i}` : '', 'Ek Not': '', 'Del. Type': ['SEA', 'AIR', 'TRUCK'][i % 3],
      'Ex-factory': ex, 'Retail Date': iso(2026, 1 + ((i + 2) % 12), 5), 'In-Store (Model Budget)': iso(2026, 1 + ((i + 3) % 12), 9),
      OPD: iso(2025, 1 + (i % 12), 3), 'Buying Son Onay Tarihi': i % 5 === 0 ? iso(2026, 1 + (i % 12), 20) : '',
      'Supp. FOB': Math.round(random() * 1000) / 100, Qty: 100 + i, Priority: 'ON_TRACK', 'Ex→Retail': '', LT: '',
    };
    cp.push(row);
    orders.push({ ...row, 'Order Status': 'Üretimde' }); // i18n-ignore
    delete orders[orders.length - 1].Priority;
    summary.push({ 'Order Code': code, 'Model Name': row['Model Name'], 'C.Code': row['C.Code'], 'Del. Type': row['Del. Type'], 'Ex-factory': ex, Notes: row.Notes, OPD: row.OPD, Line: row.Line, Season: row.Season });
    if (i % 4 === 0) overview.push({ key: `k${i}`, value: i });
  }
  return {
    projections: {
      cp: { rows: cp, meta: { count: cp.length } }, orders: { rows: orders, totals: { qty: orders.length } },
      'order-summary': { orderSummary: summary }, overview: { rows: overview, kpis: { total: rows } }, 'collection-catalog': { values: ['A', 'B'] },
    },
  };
}

/* count kayıt; her adımda tek satır, karışık alan. Override nesnesi gerçek kayıttaki gibi büyür
   (notesmap'e yazar/tarih damgası; ilgisiz siparişlerin kayıtları da vardır). */
function buildSteps(fixture, { count = 1, twoTabs = false } = {}) {
  const rows = fixture.projections.cp.rows, steps = [];
  const overrides = { notesmap: { '1999999': { NotesHtml: 'ilgisiz' } }, importancemap: {}, importanceSettings: null, noteColumnDefs: [{ id: 'nc_extra', label: 'Ek' }], transitRules: [], delmap: {} };
  for (let i = 0; i < count; i++) {
    // İki sekme: A ve B aynı satırlara sırayla farklı alan yazar.
    const row = rows[twoTabs ? (Math.floor(i / 2) * 7) % rows.length : (i * 7) % rows.length];
    const orderCode = row['Order Code'], model = row['Model Name'], ccode = row['C.Code'], key = require('../../server/lib/parse').orderLineKey(orderCode, model, ccode);
    const kind = twoTabs ? (i % 2 ? ['delType', 'exFactory'][Math.floor(i / 2) % 2] : ['notes', 'retail'][Math.floor(i / 2) % 2]) : ['notes', 'delType', 'exFactory', 'retail', 'noteColumns', 'importance', 'suppFob'][i % 7];
    const patch = { model, ccode };
    if (kind === 'notes') {
      patch.notes = { Notes: `kayıt ${i}`, EkNot: i % 2 ? `ek ${i}` : '' };
      overrides.notesmap = { ...overrides.notesmap, [key]: { Notes: patch.notes.Notes, NotesHtml: `<p>kayıt ${i}</p>`, NotesAt: `2026-11-20T10:${pad(i)}:00.000Z`, NotesBy: 'u1', NotesByName: 'Kullanıcı' } };
    } else if (kind === 'delType') patch.delType = ['AIR', 'SEA', 'TRUCK'][i % 3];
    else if (kind === 'exFactory') patch.dates = { exFactory: iso(2027, 1 + (i % 12), 2 + i) };
    else if (kind === 'retail') patch.dates = { retailDate: iso(2027, 1 + (i % 12), 10), inStoreDate: iso(2027, 1 + (i % 12), 12) };
    else if (kind === 'noteColumns') patch.noteColumns = { nc_extra: `değer ${i}`, unknown: 'yok sayılır' };
    else if (kind === 'importance') { patch.importance = 'BTS'; overrides.importancemap = { ...overrides.importancemap, [key]: 'BTS' }; }
    else if (kind === 'suppFob') { patch.suppFob = 4.25 + i; patch.suppFobMeta = { source: 'manual' }; }
    steps.push({ items: [{ orderCode, patch }], overrides: JSON.parse(JSON.stringify(overrides)) });
  }
  return steps;
}

module.exports = { buildFixture, buildSteps };
