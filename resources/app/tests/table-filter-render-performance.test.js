'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const ROOT=path.join(__dirname,'..');
const APP=fs.readFileSync(path.join(ROOT,'public','app-main.js'),'utf8');
const LFL=fs.readFileSync(path.join(ROOT,'public','lfl.js'),'utf8');

function block(source,start,end){
  const from=source.indexOf(start);
  assert.notEqual(from,-1,`Başlangıç bulunamadı: ${start}`);
  const to=source.indexOf(end,from+start.length);
  assert.notEqual(to,-1,`Bitiş bulunamadı: ${end}`);
  return source.slice(from,to);
}

test('LUNA 3 ortak tablo büyük veri setlerinde pencerelemeyi etkinleştirir',()=>{
  const framework=block(APP,'window.BLTableFramework={','  renderColumnPanel');
  assert.match(APP,/const VIRTUALIZE_ROW_THRESHOLD\s*=\s*300/);
  assert.match(APP,/setupVirtualizedBody\(tbody, table, rows/);
  assert.match(framework,/virtualize:config\.virtualize !== false/);
  assert.match(framework,/hasExpandedRows:config\.hasExpandedRows === true/);
});

test('LUNA 3 pencere içindeki LFL drill-down davranışını korur',()=>{
  const render=block(LFL,'function renderCpTable','    LFL_TABLE_EXPORTS.set');
  assert.match(render,/rowPostBuildFn:drillColumnIndex>=0/);
  assert.match(render,/virtualize:true/);
  assert.match(APP,/typeof opts\.rowPostBuildFn==='function'/);
});

test('LUNA 3 Collection araması debounce ve satır arama cache kullanır',()=>{
  const collectionSearch=block(APP,"['kolSearch'].forEach",'// Excel\'e aktarılacak satırları belirler');
  assert.match(APP,/const renderKolDebounced = debounce\(renderKol, 180\)/);
  assert.match(collectionSearch,/renderKolDebounced/);
  assert.match(APP,/const _kolSearchCache=new WeakMap\(\)/);
  assert.match(APP,/function kolSearchHaystack\(row\)/);
  assert.match(APP,/tableSearchMatches\(kolSearchHaystack\(r\),q,\{plainMode:'contains'\}\)/);
});
