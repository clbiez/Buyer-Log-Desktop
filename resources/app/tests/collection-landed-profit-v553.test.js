'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const APP=fs.readFileSync(path.join(__dirname,'..','public','app-main.js'),'utf8');
const CSS=require('./helpers/manifest-css')(['ui-tokens.css','app.css','design.css','experience.css','ui-components.css'] );
function between(source,start,end){const a=source.indexOf(start),b=source.indexOf(end,a+start.length);assert.ok(a>=0,start+' missing');assert.ok(b>a,end+' missing');return source.slice(a,b);}

test('v5.53 Overseas Landed fiyat avantajı yüzdesi tekrar görünür',()=>{
  const yd=between(APP,"}else if(c.ydLanded){","}else if(c.buyingSample){");
  const tr=between(APP,"}else if(c.trLanded){","}else if(c.ydLanded){");
  assert.match(yd,/const profit=k\.profitPct==null\?null:\(Math\.round\(k\.profitPct\*10\)\/10\)/);
  assert.match(yd,/class="kolProfit \$\{profitCls\}"/);
  assert.match(yd,/\(TR Landed − Overseas Landed\) \/ TR Landed/);
  assert.doesNotMatch(tr,/class="kolProfit/,'TR Landed hücresinde yüzde rozeti gösterilmemeli');
});

test('v5.62 yüzde avantajı sade metin olarak Endeksmatik yüksekliğindeki Landed kartta kalır',()=>{
  assert.match(CSS,/\.kolProfit\{[\s\S]*?line-height:18px[\s\S]*?padding:0;[\s\S]*?background:transparent/);
  assert.match(CSS,/\.kolProfit\.isGood/);
  assert.match(CSS,/\.kolProfit\.isBad/);
  assert.match(CSS,/\.kolLandedCard\{[\s\S]*?min-height:38px/);
});

test('v5.53 kaldırılan tekrar çarpan rozetleri geri gelmez',()=>{
  const yd=between(APP,"}else if(c.ydLanded){","}else if(c.buyingSample){");
  const tr=between(APP,"}else if(c.trLanded){","}else if(c.ydLanded){");
  assert.doesNotMatch(yd,/kolLandedMiniMult/);
  assert.doesNotMatch(yd,/kolLandedBadge/);
  assert.doesNotMatch(tr,/kolLandedBadge/);
});
