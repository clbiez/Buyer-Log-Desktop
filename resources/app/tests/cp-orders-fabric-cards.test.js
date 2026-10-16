'use strict';
// CP / Orders "Fabric (PLM)" sütunu Koleksiyon Kumaş sütunuyla AYNI katmanı kullanır:
// aynı hücre görünümü, aynı çift tık Kumaş Kartı penceresi, aynı değer filtresi
// içindeki kumaş kartı alan süzgeçleri. Ayrı bir DOM yaması (eski
// cp-orders-fabric-cards.js) tabloyu sonradan değiştirmemeli.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ROOT=path.join(__dirname,'..');
const APP=fs.readFileSync(path.join(ROOT,'public','app-main.js'),'utf8');
const HTML=fs.readFileSync(path.join(ROOT,'public','index.html'),'utf8');
const CSS=fs.readFileSync(path.join(ROOT,'public','collection-spreadsheet.css'),'utf8');

test('the separate DOM-patching CP/Orders fabric layer is gone',()=>{
  assert.equal(fs.existsSync(path.join(ROOT,'public','cp-orders-fabric-cards.js')),false);
  assert.doesNotMatch(HTML,/cp-orders-fabric-cards\.js/);
  assert.doesNotMatch(APP,/BLCPOrdersFabricCards|blCpFabric/);
});

test('CP and Orders render Fabric (PLM) with the Collection fabric-card cell and dialog',()=>{
  assert.match(APP,/if\(\(tableKey==='cp'\|\|tableKey==='orders'\)&&c\.k===CP_FABRIC_PLM_KEY\) return cpFabricCellHtml\(r\);/);
  const shared=APP.slice(APP.indexOf('function fabricCardCellParts('),APP.indexOf('function kolFabricSourceLabel('));
  assert.match(shared,/function kolFabricCellHtml\(row,val,rc\)\{\n\s*const cell=fabricCardCellParts\(val\);/);
  assert.match(shared,/function cpFabricCellHtml\(row\)\{\n\s*kolFabricCardsEnsureLoaded\(\);[\s\S]*?const cell=fabricCardCellParts\(raw\);/);
  assert.match(shared,/#cpTable td\.cpFabricTd\[data-cp-fabric\],#ordersTable td\.cpFabricTd\[data-cp-fabric\]/);
  assert.match(shared,/openFabricCardDialog\(raw,\{trigger:cell\}\)/);
  // Koleksiyon aynı pencereyi kullanır; kart kaydı/silinmesi üç tabloyu da yeniler.
  assert.match(APP,/openFabricCardDialog\(String\(kolEffectiveValue\(row,'fabric'\)\?\?''\),\{trigger,code,collection:true\}\)/);
  assert.match(APP,/await kolFabricCardsSave\(\[card\]\);close\(\);fabricCardsRepaintTables\(\);/);
  assert.match(APP,/await kolFabricCardDelete\(code\);close\(\);fabricCardsRepaintTables\(\);/);
  assert.match(APP,/function fabricCardsRepaintTables\(\)\{[\s\S]{0,160}if\(currentActiveTab\(\)==='koleksiyon'\)renderKol\(\);else kolFabricRepaintPending=true;\n\s*if\(state\.cp\)renderCP\(\);\n\s*if\(state\.orders\)renderOrders\(\);/);
  assert.match(APP,/if\(tab==='koleksiyon'&&kolFabricRepaintPending\)\{kolFabricRepaintPending=false;/);
  // Görünüm stili Koleksiyon'la aynı kuraldır.
  assert.match(CSS,/:is\(#kolTable,#cpTable,#ordersTable\) tbody \.kolFabricCell\{/);
  assert.match(CSS,/\.colFilterPanel:has\(\.kolFabricFacetPanel\)/);
});

test('CP and Orders Fabric (PLM) filter shows card summaries and the same fabric-card detail facets',()=>{
  // Değer listesi, kopyala ve Excel görünen özeti kullanır (Koleksiyon gibi).
  assert.match(APP,/if\(c\.k==='Fabric \(PLM\)'\) return typeof kolFabricDisplay==='function'\?kolFabricDisplay\(v\):norm\(v\);/);
  // Aynı facet bölümü Koleksiyon ve CP/Orders için tek yerden üretilir.
  assert.match(APP,/function kolFabricDetailPanel\(panel\)\{\n\s*const read=fabricCardFacetSection\(panel,/);
  assert.match(APP,/if\(isCpFabricFilterKey\(tableKey,key\)\) wireFabricFacets\(\);/);
  assert.match(APP,/const read=fabricCardFacetSection\(panel,\{\n\s*current,\n\s*detailsForKey:field=>universe\.filter\(list=>fabricCardDetailsMatch\(list,current,field\)\)\.flat\(\)/);
  // Alan süzgeci değer seçimiyle birlikte saklanır ve tüm filtre yollarında uygulanır.
  assert.match(APP,/fabricDetails:Object\.fromEntries\(Object\.entries\(details\)\.map/);
  assert.match(APP,/const fabricKey=\(tableKey==='cp'\|\|tableKey==='orders'\)&&key==='Fabric \(PLM\)';\n\s*if\(fabricKey\)kolFabricCardsEnsureLoaded\(\);\n\s*if\(fabricKey&&entry\.fabricDetails\)\{/);
  assert.match(APP,/if\(prepared\.kind==='fabric-card'\)\{\n\s*if\(prepared\.base&&!preparedColFilterPasses\(prepared\.base,key,row\)\)return false;\n\s*return fabricCardDetailsMatch\(fabricCardDetailsForRaw\(row\?row\[key\]:''\),prepared\.details\);/);
  // Uygula yalnız değer listesini okur; alan süzgeci kutuları değer kümesine karışmaz.
  assert.match(APP,/const boxes = \[\.\.\.bodyEl\.querySelectorAll\('\.cfpList input\[type=checkbox\]'\)\];/);
  // Otomatik sayfa filtresi kaydı (yeniden açılış) alan süzgecini korur.
  assert.match(APP,/\.\.\.\(entry\.fabricDetails\?\{fabricDetails:entry\.fabricDetails,hasValues:!!entry\.values\}:\{\}\)/);
  assert.match(APP,/if\(entry\.fabricDetails&&typeof entry\.fabricDetails==='object'\)\{out\[key\]\.fabricDetails=entry\.fabricDetails;if\(entry\.hasValues===false\)delete out\[key\]\.values;\}/);
  // Sütun gizliyken de kayıtlı kumaş filtresi kart sözlüğünü yükletir.
    // Kayıtlı filtre profili: yalnız alan süzgeci varsa boş değer kümesi satır elemez.
  assert.match(APP,/if\(v\.fabricDetails&&typeof v\.fabricDetails==='object'\)\{out\[k\]\.fabricDetails=v\.fabricDetails;if\(v\.hasValues===false\)delete out\[k\]\.values;\}/);
});

test('CP/Orders fabric code never writes the PLM fabric text back to the row',()=>{
  const shared=APP.slice(APP.indexOf('function cpFabricCellHtml('),APP.indexOf('function kolFabricSourceLabel('));
  assert.doesNotMatch(shared,/\[CP_FABRIC_PLM_KEY\]\s*=(?!=)/);
  assert.doesNotMatch(shared,/\['Fabric \(PLM\)'\]\s*=(?!=)/);
});
