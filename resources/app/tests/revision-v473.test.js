'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const parse = require(path.join(ROOT, 'server', 'lib', 'parse.js'));
const db = require(path.join(ROOT, 'server', 'db.js'));
const access = require(path.join(ROOT, 'server', 'lib', 'user-access.js'));
const INDEX = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const APP_SOURCE = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const APP_AND_INDEX = INDEX + '\n' + APP_SOURCE;
const CSS = fs.readFileSync(path.join(ROOT, 'public', 'app.css'), 'utf8');
// v7.26: genel arama (global-search.js) kullanıcı talebiyle programdan
// kaldırıldı. Dosya yoksa boş metin okunur; aşağıdaki "Approvals kalmadı"
// kontrolleri anlamını korur (olmayan dosyada Approvals izi de yoktur).
const GLOBAL_SEARCH_PATH = path.join(ROOT, 'public', 'global-search.js');
const GLOBAL_SEARCH = fs.existsSync(GLOBAL_SEARCH_PATH) ? fs.readFileSync(GLOBAL_SEARCH_PATH, 'utf8') : '';
const USER_STORAGE = fs.readFileSync(path.join(ROOT, 'public', 'user-storage.js'), 'utf8');
const DB_SOURCE = fs.readFileSync(path.join(ROOT, 'server', 'db.js'), 'utf8');
const ACCESS_SOURCE = fs.readFileSync(path.join(ROOT, 'server', 'lib', 'user-access.js'), 'utf8');

function order({license, manufacturer='MAIN FACTORY', code=1001, model='MODEL A', colour='C01'}={}) {
  return {
    ocode: code, model, ccode: colour, colour: 'BLACK', license,
    manufacturer, season: 'W7', countryRaw: 'TURKIYE', category: 'TSHIRT',
    qty: 100, kalan: 100, fob: 5, antrepo: 0, merkezSevkeHazirKalan: 0,
    opd: new Date(2026,0,1), ex: new Date(2026,6,1), retail: new Date(2026,7,1), mb: new Date(2026,7,15),
  };
}

function overrides(extra={}) {
  return {...db.defaultOverrides(), pricingRules:[], transitRules:[], ...extra};
}

test('v4.73 Fit Column Width düğmesi CP, Orders ve Koleksiyon More menülerinde Freeze ile yan yanadır', () => {
  const buttonAt = INDEX.indexOf('id=\"navFitColumnsBtn\"');
  const freezeAt = INDEX.indexOf('id=\"navFreezeBtn\"');
  assert.ok(buttonAt >= 0 && buttonAt < freezeAt);
  assert.match(APP_SOURCE, /appendSharedTableActions\('cpMoreMenu',\['navFitColumnsBtn','navFreezeBtn'\]\)/);
  assert.match(APP_SOURCE, /appendSharedTableActions\('ordersMoreMenu',\['navFitColumnsBtn','navFreezeBtn'\]\)/);
  assert.match(APP_SOURCE, /appendSharedTableActions\('kolMoreMenu',\['navFitColumnsBtn','navFreezeBtn'\]\)/);
  assert.match(APP_SOURCE, /function fitActiveTableColumns\(\)/);
  assert.match(APP_SOURCE, /kolColWidths\[col\.k\]=kolColMinWidth\(col\)/);
});

test('v4.73 DTR Sub-Mfr Manufacturer ile aynıdır; Non-DTR kayıt yoksa boş, giriş varsa kullanıcı değeridir', () => {
  const dtr = order({license:'Marvel', manufacturer:'DTR FACTORY', code:1001});
  const nonDtrBlank = order({license:'Minecraft', manufacturer:'NON DTR FACTORY', code:1002, model:'MODEL B'});
  const nonDtrFilled = order({license:'Minecraft', manufacturer:'NON DTR FACTORY', code:1003, model:'MODEL C'});
  const staleDtrKey = parse.orderLineKey(dtr.ocode,dtr.model,dtr.ccode);
  const nonDtrKey = parse.orderLineKey(nonDtrFilled.ocode,nonDtrFilled.model,nonDtrFilled.ccode);
  const ov = overrides({submap:{[staleDtrKey]:'OLD WRONG SUB',[nonDtrKey]:'USER SUB'}});
  const cp = parse.buildCPRowsFromASAS([dtr,nonDtrBlank,nonDtrFilled],{},ov);
  assert.equal(cp[0].Licensor,'DTR');
  assert.equal(cp[0]['Sub-Manufacturer'],'DTR FACTORY');
  assert.equal(cp[1].Licensor,'FASHION UK');
  assert.equal(cp[1]['Sub-Manufacturer'],'');
  assert.equal(cp[2]['Sub-Manufacturer'],'USER SUB');
  const orders = parse.buildOrdersRowsFromASAS([dtr,nonDtrBlank,nonDtrFilled],{},ov);
  assert.equal(orders[0]['Sub-Manufacturer'],'DTR FACTORY');
  assert.equal(orders[1]['Sub-Manufacturer'],'');
  assert.equal(orders[2]['Sub-Manufacturer'],'USER SUB');
});

test('v4.73 boş Non-DTR Sub-Mfr kalıcı olarak yazılabilir', () => {
  assert.match(DB_SOURCE, /if \(patch\.subManufacturer != null\) ov\.submap\[oc\] = patch\.subManufacturer/);
  assert.match(APP_SOURCE, /if\(turknorm\(row\.Licensor\)!=='DTR'\)body\.subManufacturer=norm\(row\['Sub-Manufacturer'\]\)/);
});

test('v4.73 Approvals sayfası, çalışma kodu ve erişim alanı kaldırılmıştır', () => {
  assert.doesNotMatch(APP_AND_INDEX, /data-tab="appr"|id="view-appr"|id="apprTable"|approval-rules\.js|approval-excel\.js|APPR_KEYS|APPR_COLS|renderAppr/);
  assert.doesNotMatch(CSS, /#apprTable|apprDimFilterGroup|data-active-tab="appr"/);
  assert.equal(fs.existsSync(path.join(ROOT,'public','approval-rules.js')),false);
  assert.equal(fs.existsSync(path.join(ROOT,'public','approval-excel.js')),false);
  assert.doesNotMatch(GLOBAL_SEARCH, /apprSearch|page:'appr'|apprTable/);
  assert.doesNotMatch(ACCESS_SOURCE, /'appr'/);
  assert.ok(access.ACCESS_AREA_KEYS.includes('orders'));
  assert.ok(!access.ACCESS_AREA_KEYS.includes('appr'));
});

test('v4.73 eski Approvals verileri temizlenirken yalnız CP notları korunur', () => {
  assert.deepEqual(db.defaultOverrides().notesmap,{});
  assert.equal(Object.prototype.hasOwnProperty.call(db.defaultOverrides(),'apprmap'),false);
  assert.match(DB_SOURCE, /legacyApprovals/);
  assert.match(DB_SOURCE, /next\.Notes = rec\.Notes/);
  assert.match(DB_SOURCE, /next\.EkNot = rec\.EkNot/);
  assert.match(DB_SOURCE, /delete merged\.apprmap/);
    assert.match(USER_STORAGE, /removedApprovalSuffixes/);
  assert.match(USER_STORAGE, /delete parsed\.appr/);
});

test('v4.73 Orders genel aramada gerçek bir sayfa ve satır kaynağıdır', () => {
  // v7.26: genel arama kaldırıldı. Test SİLİNMEZ; amacı "Siparişler aramada
  // birinci sınıf bir sayfadır" idi. Özellik varken eski beklentiler aynen
  // korunur, kaldırıldığında ise sayfanın kendi arama kutusuyla erişilebilir
  // olması sınanır — kullanıcı Siparişler'de arama yapabilmeye devam eder.
  if (GLOBAL_SEARCH) {
    assert.match(GLOBAL_SEARCH, /orders:\{tr:'Siparişler',en:'Orders'/);
    assert.match(GLOBAL_SEARCH, /const rows=state\?\.orders\?\.rows\|\|\[\]/);
    assert.match(GLOBAL_SEARCH, /rec\.page==='cp'\|\|rec\.page==='orders'/);
    assert.match(GLOBAL_SEARCH, /rec\.page==='cp'\?'cpSearch':'ordersSearch'/);
    return;
  }
  assert.match(APP_AND_INDEX, /id="ordersSearch"/);
  assert.match(APP_AND_INDEX, /id="cpSearch"/);
});

test('v4.73 eski kullanıcı profillerinde Orders erişimi CP erişiminden güvenle devralınır', () => {
  const oldProfile=access.normalizeAccessAreas({overview:true,cp:true,koleksiyon:false},false);
  assert.equal(oldProfile.orders,true);
  const explicit=access.normalizeAccessAreas({overview:true,cp:true,orders:false},false);
  assert.equal(explicit.orders,false);
});
