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
