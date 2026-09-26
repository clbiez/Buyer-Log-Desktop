'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

/* Menünün gerçek kapanışını iç içe div sayarak bulur. */
function menuEnd(html, start) {
  const open = html.lastIndexOf('<div', start);
  let depth = 0;
  const tag = /<div\b|<\/div>/g;
  tag.lastIndex = open;
  for (let match = tag.exec(html); match; match = tag.exec(html)) {
    depth += match[0] === '</div>' ? -1 : 1;
    if (depth === 0) return match.index;
  }
  return html.length;
}

// v6.24'te bu komutlar Araçlar menüsündeydi; kullanıcı kararıyla PLM Sync
// menüsüne taşındılar. Sınanan kural aynı: her ekranda TEK bir düğüm olmalı.
test('PLM Sync komutları her ekranda kendi tekil PLM Sync menüsündedir',()=>{
  const html=read('public/index.html');
  for(const page of ['cp','orders','kol']){
    const menuId=`${page}PlmSyncMenu`;
    const start=html.indexOf(`id=\"${menuId}\"`);
    assert.ok(start>=0,`${menuId} bulunamadı`);
    const end=menuEnd(html,start);
    const menu=html.slice(start,end);
    for(const category of ['plm','asas']){
      const marker=`data-plm-sync-category=\"${category}\" data-plm-sync-page=\"${page}\"`;
      assert.match(menu,new RegExp(marker));
      assert.equal((html.match(new RegExp(marker,'g'))||[]).length,1,`${page}/${category} tekil olmalı`);
    }
  }
});

test('v6.25/v6.55 Colour Code hücreleri yalnız Colour Code ile eşleşen QTX akışını başlatıyor',()=>{
  const app=read('public/app-main.js'),css=read('public/app.css'),server=require('./helpers/server-source')();
  assert.match(app,/function bindQtxColourBridge\(tableId\)/);
  // v6.55 — çift tıklama YERİNE sağ tık (contextmenu) menüsü; endpoint de
  // tek /api/qtx/download YERİNE fetch-and-save + saved + file/:colourCode
  // üçlüsüne ayrıldı (kalıcı kayıt için).
  assert.match(app,/addEventListener\('contextmenu',[\s\S]*openQtxContextMenu\(event,tableId,cell\)/);
  assert.match(app,/body:JSON\.stringify\(identity\)/);
  assert.match(app,/\['cpTable','ordersTable','kolTable'\]\.forEach\(bindQtxColourBridge\)/);
  assert.match(app,/data-key="\$\{escapeHtml\(d\.k\)\}"/);
  assert.match(css,/#kolTable td\.qtxSavedColourCell\[data-key="colourCode"\]/);
  assert.match(server,/app\.post\('\/api\/qtx\/fetch-and-save', userAccess\.requireAnyArea\('cp', 'orders', 'koleksiyon'\)/);
  assert.match(server,/downloadUmbrellaQtx\(req\.currentUser\.id,\{colourCode,mode:'fetch'\}\)/);
  assert.doesNotMatch(server,/downloadUmbrellaQtx\(req\.currentUser\.id,\{colourCode,modelName,plmId\}\)/);
});

test('v6.25 Umbrella connector matches only Colour Code and starts only one download',()=>{
  const connector=require('../server/lib/agent-browser-connector');
  const expression=connector.umbrellaQtxDownloadExpression({colourCode:'DWP',modelName:'KK.BDY,MINECRAFT-9-YD',plmId:'2108736'});
  assert.doesNotThrow(()=>new Function(`return ${expression}`));
  assert.match(expression,/logo-lcwaikiki-world\.png/);
  assert.match(expression,/i\.icon\.toggle/);
  assert.match(expression,/i\.fas\.fa-download/);
  assert.match(expression,/matchMode:'colour-code-only'/);
  assert.doesNotMatch(expression,/MINECRAFT|2108736|identityScore|modelCanonical/);
  assert.doesNotMatch(expression,/downloadCurrentPage|totalDownloads|downloaded\.add/);
  const afterClick=expression.indexOf('clickElement(button)');
  const success=expression.indexOf('return {ok:true',afterClick);
  assert.ok(afterClick>=0&&success>afterClick,'the first matched file must return immediately after one download click');
});
