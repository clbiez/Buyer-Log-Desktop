'use strict';

/* v9.58'de CP Overview detay modülleri ayrı bir iç ızgarada yönetiliyordu.
   Ana ekran (v2) modelinde her modül doğrudan bir widget'tır; dört kırılım
   tek "Aktif Sipariş Kırılımı" widget'ında birleşti, CP Öncelik Radarı
   Üretim Odağı'ndaki öncelik dağılım çubuğuna katıldı. Bu dosya o geçişin
   kullanıcı kaydını kaybetmediğini korur. */
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ROOT=path.join(__dirname,'..');
const INDEX=fs.readFileSync(path.join(ROOT,'public','index.html'),'utf8');
const VIEW=fs.readFileSync(path.join(ROOT,'public','cp-overview-assistant.js'),'utf8');
const CPA_CSS=fs.readFileSync(path.join(ROOT,'public','cp-overview-assistant.css'),'utf8');
const layout=require('../public/overview-layout.js');

test('CP modülleri ana ekranda bağımsız widget olarak bulunur',()=>{
  for(const key of ['checklistRules','dataCoverage','breakdown']){
    assert.ok(layout.widgets.includes(key),key);
    assert.match(INDEX,new RegExp(`data-overview-widget="${key}"`));
  }
  assert.doesNotMatch(INDEX,/data-overview-detail-widget|id="ovDetailGrid"|id="ovContent"/);
  assert.ok(!layout.widgets.includes('priorityRadar'));
});

test('v1 detay kaydı ana ekrana taşınır: gizlenenler gizli kalır, dört kırılım tek widget olur',()=>{
  const migrated=layout.normalize({order:['oab','overviewContent'],hidden:['notes'],details:{order:['season','country','attention'],hidden:['dataCoverage','priorityRadar'],widths:{country:'third'}}});
  assert.equal(migrated.version,2);
  const placed=migrated.pages.flatMap(page=>page.items.map(item=>item.key));
  assert.ok(placed.includes('breakdown'));
  assert.ok(!placed.includes('notes'),'v1 gizli modül gizli kalır');
  assert.ok(!placed.includes('dataCoverage'),'v1 gizli detay modülü gizli kalır');
  assert.equal(placed.filter(key=>key==='breakdown').length,1);
  assert.ok(placed.indexOf('oab')<placed.indexOf('breakdown'),'v1 sırası korunur');
  const allHidden=layout.normalize({details:{hidden:['country','subManufacturer','season','buyingGroup']}});
  assert.ok(!allHidden.pages.some(page=>page.items.some(item=>item.key==='breakdown')),'dört kırılım da gizliyse birleşik widget da gizli');
});

test('Kontrol listesi ve Veri Kapsamı bağımsız hostlara çizilir',()=>{
  assert.match(INDEX,/id="cpAssistant"/);
  assert.doesNotMatch(INDEX,/id="cpAssistantAttention"/);
  assert.match(INDEX,/id="cpAssistantCoverage"/);
  assert.match(VIEW,/function attentionHost\(\)/);
  assert.match(VIEW,/function coverageHost\(\)/);
  assert.doesNotMatch(VIEW,/attention\.innerHTML = attentionCard\(\)/);
  assert.match(VIEW,/cpaChecklistOverview/);
  assert.doesNotMatch(VIEW,/state\.perspective === 'manager'/);
  assert.match(VIEW,/coverage\.innerHTML = coverageCard\(\)/);
});

test('v9.58 Priorities ve Checklist iki eşit sütun, tek kartta tam genişlik kullanır',()=>{
  assert.match(CPA_CSS,/\.cpaGrid\{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(CPA_CSS,/\.cpaGrid\.is-single\{[^}]*grid-template-columns:minmax\(0,1fr\)/);
});

test('CP Öncelik Radarı yerine Öncelikler kartında tıklanabilir dağılım çubuğu vardır',()=>{
  assert.match(VIEW,/class="cpaMix"/);
  assert.match(VIEW,/class="cpaMixSeg tone-\$\{tone\[key\]\}"[^`]*data-cpa-priority="\$\{key\}"/);
  assert.match(CPA_CSS,/\.cpaMix\{/);
  assert.doesNotMatch(INDEX,/id="ovPriorityRadar"/);
});
