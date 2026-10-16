'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ROOT=path.join(__dirname,'..');
const helper=fs.readFileSync(path.join(ROOT,'public','cp-orders-fabric-cards.js'),'utf8');
const html=fs.readFileSync(path.join(ROOT,'public','index.html'),'utf8');
const engine=require('../public/fabric-cards-engine.js');
test('CP and Orders load shared fabric cards without changing PLM data or update pipeline',()=>{
  assert.match(html,/cp-orders-fabric-cards\.js\?v=__BL_ASSET_VERSION__/);
  assert.match(helper,/global\.BLFabricCards/);
  assert.match(helper,/dataset\.blFabricRaw/);
  assert.match(helper,/sustainability/);
  assert.match(helper,/data-fabric-filter/);
  assert.match(helper,/row\.style\.display=pass\?'':'none'/);
  assert.doesNotMatch(helper,/fetch\(|localStorage|sessionStorage/);
});
test('CP and Orders card summaries and facets use the Collection card engine',()=>{
  const raw='3859-Örme,Süprem,30/1 Ne,Compact Penye,Pamuk,150 gsm,100% Pamuk,Reaktif,Silikon + Dikiş Kolaylığı Apresi,Enzim,32,28,Sürdürülebilir İçerik Yok';
  const card=engine.ruleCard(raw);
  assert.equal(card.code,'3859');
  assert.equal(card.summary,'Süprem · 30/1 Ne · 150 gsm · 100% Pamuk');
  assert.equal(card.details.weight,'150 gsm');
  assert.match(helper,/\['composition','Karışım','Composition'\]/);
  assert.match(helper,/\['finish','Apre \/ işlem','Finish'\]/);
});
