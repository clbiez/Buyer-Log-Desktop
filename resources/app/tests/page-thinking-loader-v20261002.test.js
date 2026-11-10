const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const ROOT=path.join(__dirname,'..');
const APP=fs.readFileSync(path.join(ROOT,'public','app-main.js'),'utf8');
const INDEX=fs.readFileSync(path.join(ROOT,'public','index.html'),'utf8');

function block(start,end){
  const a=APP.indexOf(start),b=APP.indexOf(end,a);
  assert.ok(a>=0&&b>a,`block not found: ${start}`);
  return APP.slice(a,b);
}

test('core page loading states use the shared status marker loader',()=>{
  const helper=block('function renderCorePageLoadingState','function ensureUnifiedPrioritiesForTable');
  assert.match(helper,/BLUI\.renderState\(empty,\{kind:'loading',title\}\)/);
  assert.match(helper,/class="uiStateSpinner blOrb uiStateOrb" data-state="thinking"/);
  assert.doesNotMatch(helper,/empty\.textContent=.*Preparing unified priorities/);

  const orders=block('function setOrdersLoadingState','async function ensureOrdersLoaded');
  assert.match(orders,/renderCorePageLoadingState\('orders',message\)/);

  const cp=block('async function ensureCpLoaded','async function ensureCollectionCatalogLoaded');
  assert.match(cp,/currentActiveTab\(\)==='cp'\)renderCorePageLoadingState\('cp'\)/);
});

test('core page loading labels are concise for CP and Orders in TR and EN',()=>{
  const vm=require('node:vm');
  const helper=block('function renderCorePageLoadingState','function renderCpLoadError');
  const cases=[
    ['cp','tr','CP yükleniyor…'],
    ['cp','en','Loading CP…'],
    ['orders','tr','Siparişler yükleniyor…'],
    ['orders','en','Loading Orders…'],
  ];
  for(const [tableKey,appLang,expected] of cases){
    const empty={style:{}},content={style:{}};
    let rendered;
    const context={
      appLang,
      document:{getElementById(id){
        if(id===(tableKey==='cp'?'cpEmpty':'ordersEmpty'))return empty;
        if(id===(tableKey==='cp'?'cpContent':'ordersContent'))return content;
        return null;
      }},
      window:{BLUI:{renderState(node,options){rendered={node,...options};}}},
    };
    vm.runInNewContext(helper+`\nrenderCorePageLoadingState('${tableKey}');`,context);
    assert.equal(rendered?.node,empty);
    assert.equal(rendered?.kind,'loading');
    assert.equal(rendered?.title,expected);
    assert.equal(empty.style.display,'flex');
    assert.equal(content.style.display,'none');
  }
});

test('Orders failure stops the loading animation and renders an error state',()=>{
  const orders=block('async function ensureOrdersLoaded','window.BLEnsureOrdersLoaded');
  assert.match(orders,/setOrdersLoadingState\(false,message\)/);
});

test('Data Management first paint uses the same status marker visual',()=>{
  const start=INDEX.indexOf('<section id="view-source"');
  const end=INDEX.indexOf('</section>',start);
  const source=INDEX.slice(start,end);
  assert.match(source,/dataMgmtBooting empty/);
  assert.match(source,/class="uiState uiState--loading"/);
  assert.match(source,/class="uiStateSpinner blOrb uiStateOrb" data-state="thinking"/);
});
