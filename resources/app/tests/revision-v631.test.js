'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');

test('v6.31 quotation records merge atomically into the drop target', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'buyer-log-v631-quotes-'));
  const script = `
    const store=require(${JSON.stringify(path.join(ROOT, 'server/lib/quotations-store.js'))});
    const profile={id:'buyer-1',displayName:'Buyer One',role:'buyer'};
    store.createRequest(profile,{id:'source',source:'collection',note:'Source note',capacityConfirmed:true,
      manufacturers:[{name:'Factory A',email:'a@example.com'}],
      items:[{id:'s1',modelKey:'kol:1',manufacturer:'Factory A',price:'9.50',approved:true},{id:'s2',modelKey:'kol:2',manufacturer:'Factory A',price:'8.00'}]});
    store.createRequest(profile,{id:'target',source:'collection',note:'Target note',
      manufacturers:[{name:'Factory A',email:''},{name:'Factory B',email:'b@example.com'}],
      items:[{id:'t1',modelKey:'kol:1',manufacturer:'Factory A',targetPrice:'10.00',price:''},{id:'t2',modelKey:'kol:1',manufacturer:'Factory B',price:'11.00'}]});
    const merged=store.mergeRequests(profile,'source','target');
    process.stdout.write(JSON.stringify({merged,requests:store.loadStore().requests}));
  `;
  const result = spawnSync(process.execPath, ['-e', script], { cwd: ROOT, env: { ...process.env, BUYER_LOG_SERVER_DATA_ROOT: temp }, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const data = JSON.parse(result.stdout);
  assert.equal(data.merged.removedId, 'source');
  assert.equal(data.requests.length, 2);
  const archivedSource=data.requests.find(item=>item.id==='source');
  assert.equal(archivedSource.archived,true);
  assert.equal(archivedSource.mergedIntoId,'target');
  assert.equal(data.merged.request.id, 'target');
  assert.equal(data.merged.request.items.length, 3);
  assert.equal(data.merged.request.items.find(item => item.modelKey === 'kol:1' && item.manufacturer === 'Factory A').price, '9.50');
  assert.equal(data.merged.request.items.find(item => item.modelKey === 'kol:1' && item.manufacturer === 'Factory A').targetPrice, '10.00');
  assert.equal(data.merged.request.capacityConfirmed, true);
  assert.match(data.merged.request.note, /Target note[\s\S]*Source note/);
});

// v6.31'in Licensor->Manufacturer taşıması v6.33'te BİLEREK geri alındı (db.js:184-191
// yorumu: "License Royalty Calculations tekrar Licensor ile eşleşir"). Kayıtlı kurallar
// artık licensor alanını taşıyor, manufacturer alanı yok. Test bunu doğrular.
//
// NOT (yeni bulgu, düzeltilmedi): frontend eşleştirmesi row.Licensor kullanırken
// (app-main.js:6933) backend calculateSuppFobByRule çağrısı hâlâ o.manufacturer
// (fabrika alanı, distribütör değil) gönderiyor (server/lib/parse.js:1780,1898).
// findSuppFobRule bunu r.manufacturer??r.licensor ile karşılaştırdığı için (parse.js:645)
// tamamen kırık değil, ama iki taraf farklı sipariş alanlarını (Licensor vs Manufacturer)
// karşılaştırıyor olabilir — canlı fiyatlama hesabına dokunmadan burada bırakıldı.
test('v6.33 royalty rules store Licensor again; matching no longer migrates it to Manufacturer', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'buyer-log-v631-rules-'));
  fs.writeFileSync(path.join(temp, 'overrides.json'), JSON.stringify({pricingRules:[{id:'old',manufacturer:'Factory A',license:'Disney',countryGroup:'TR',royalty:10,hologramCost:0}],_revision:0}));
  const script = `const db=require(${JSON.stringify(path.join(ROOT, 'server/db.js'))});process.stdout.write(JSON.stringify(db.loadOverrides().pricingRules));`;
  const result = spawnSync(process.execPath, ['-e', script], { cwd: ROOT, env: { ...process.env, BUYER_LOG_SERVER_DATA_ROOT: temp }, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout)[0].licensor, 'Factory A');
  assert.equal(Object.hasOwn(JSON.parse(result.stdout)[0], 'manufacturer'), false);

  const client = read('public/app-main.js');
  assert.match(client, /pricingRuleMatchesValues\(rule,row\.OPD,row\.Country,row\.Season,row\.Licensor,row\.License\)/);
  assert.match(read('public/index.html'), /License Royalty Calculations/);
});

test('v6.31 keeps Colour Code as text in every principal Excel export path', () => {
  const app = read('public/app-main.js');
  assert.match(app, /\['C\.Code','Colour Code','Color Code','Renk Kod','Renk Kodu'\]\.includes\(column\.k\).*numFmt='@'/);
  assert.match(app, /c\.k==='plmId'\|\|c\.k==='colourCode'/);
  assert.match(app, /directTextHeaders=new Set\(\['Renk Kod','Colour Code','Color Code'/);
  assert.match(read('server/workers/excel-worker.js'), /h === 'Renk Kod' \|\| h === 'Colour Code' \|\| h === 'Color Code'/);
  assert.match(read('public/lfl.js'), /colourCode.*numFmt='@'/s);
});

test('v6.31 removes the PLM Source Folder update feature', () => {
  const server = read('server/server.js');
  const app = read('public/app-main.js');
  const html = read('public/index.html');
  assert.doesNotMatch(server, /app\.get\('\/api\/plm-source-files'/);
  assert.doesNotMatch(server, /resolvePlmSourceFile/);
  assert.doesNotMatch(app, /openPlmSourceFolderPicker/);
  for (const id of ['cpPlmFolderBtn', 'ordersPlmFolderBtn', 'kolPlmFolderBtn']) assert.doesNotMatch(html, new RegExp(`id="${id}"`));
});
