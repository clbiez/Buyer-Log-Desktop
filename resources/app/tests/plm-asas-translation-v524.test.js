'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const APP=fs.readFileSync(path.join(__dirname,'..','public','app-main.js'),'utf8');
const INDEX=fs.readFileSync(path.join(__dirname,'..','public','index.html'),'utf8');
function between(source,start,end){const a=source.indexOf(start),b=source.indexOf(end,a+start.length);assert.ok(a>=0,start+' missing');assert.ok(b>a,end+' missing');return source.slice(a,b);}

test('v5.24 PLM Category and Line are translated before the import plan is built',()=>{
  const importer=between(APP,'async function importKolPlmExcelFile','function kolImportStyleRowId');
  const applyAt=importer.indexOf('kolPlmApplyAsasTranslations(parsed.rows,inferredTranslations)');
  const planAt=importer.indexOf('kolBuildPlmImportPlan(parsed.rows)');
  assert.ok(applyAt>=0 && planAt>applyAt,'ASAS translation must happen before duplicate/update planning');
  assert.match(APP,/category:\{source:'categoryRaw',target:'urunTipi',asas:'category'\}/);
  assert.match(APP,/line:\{source:'lineRaw',target:'line',asas:'line'\}/);
});

test('v5.25 PLM translation prefers exact ASAS, then approved PLM→ASAS rule, then learned map',()=>{
  const block=between(APP,'function kolPlmUniqueAsasValues','function kolPlmResolveZipPath');
  const norm=v=>String(v==null?'':v).trim();
  const turknorm=v=>norm(v).toLocaleUpperCase('tr-TR');
  const exactMap=new Map([
    ['1',[{line:'ASAS LINE 1',category:'ASAS CAT 1',license:'ASAS LIC 1'}]],
  ]);
  const modelMap=new Map([
    ['STYLE TWO',[{line:'ASAS LINE 2',category:'ASAS CAT 2',license:'ASAS LIC 2'}]],
  ]);
  const approved={category:new Map([['C4','APPROVED CAT']]),line:new Map(),license:new Map()};
  const translate=(field,value)=>approved[field]?.get(turknorm(value))||'';
  // line, kullanıcı kararıyla çeviri zincirinin DIŞINDADIR (bkz. KOL_PLM_DIRECT_FIELDS).
  const kolPlmIsDirectField=field=>field==='line';
  const fn=new Function('norm','turknorm','kolPlmNormalizeId','kolPlmAsasIndex','kolPlmAsasModelIndex','kolPlmInferTranslationSuggestions','kolPlmTranslate','kolPlmIsDirectField',`${block}\nreturn kolPlmApplyAsasTranslations;`)(
    norm,turknorm,v=>norm(v),()=>exactMap,()=>modelMap,()=>({matchedPlm:1,matchedModel:1,suggestions:[]}),translate,kolPlmIsDirectField
  );
  const rows=[
    {plmId:'1',modelKod:'STYLE ONE',_plmSource:{lineRaw:'L1',categoryRaw:'C1',brandToken:'B1'}},
    {plmId:'2',modelKod:'STYLE TWO',_plmSource:{lineRaw:'L2',categoryRaw:'C2',brandToken:'B2'}},
    {plmId:'3',modelKod:'STYLE THREE',_plmSource:{lineRaw:'L3',categoryRaw:'C3',brandToken:'B3'}},
    {plmId:'4',modelKod:'STYLE FOUR',_plmSource:{lineRaw:'L4',categoryRaw:'C4',brandToken:'B4'}},
  ];
  const info={matchedPlm:1,matchedModel:1,suggestions:[
    {field:'line',source:'L3',target:'LEARNED LINE',conflict:false},
    {field:'category',source:'C3',target:'LEARNED CAT',conflict:false},
    {field:'license',source:'B3',target:'LEARNED LIC',conflict:false},
  ]};
  fn(rows,info);
  // Category: öncelik zinciri (exact-plm → exact-model → learned → approved-rule).
  assert.equal(rows[0].urunTipi,'ASAS CAT 1');
  assert.equal(rows[1].urunTipi,'ASAS CAT 2');
  assert.equal(rows[2].urunTipi,'LEARNED CAT');
  assert.equal(rows[3].urunTipi,'APPROVED CAT');
  // Line: kullanıcı kararı — PLM DOĞRU kabul edilir. ASAS'ta birebir bir kayıt
  // (ASAS LINE 1/2) veya öğrenilmiş bir kural (LEARNED LINE) OLSA BİLE
  // bunların hiçbiri uygulanmaz; PLM metni olduğu gibi yazılır.
  assert.equal(rows[0].line,'L1');
  assert.equal(rows[1].line,'L2');
  assert.equal(rows[2].line,'L3');
  assert.equal(rows[0]._plmTranslations.line.mode,'plm-direct');
});

test('v5.24 conflicting ASAS translations are never guessed',()=>{
  const apply=between(APP,'function kolPlmApplyAsasTranslations','function kolPlmResolveZipPath');
  assert.match(apply,/if\(!item\|\|item\.conflict\|\|!item\.target/);
  assert.match(apply,/exact\.length>1\|\|modelExact\.length>1/);
});

test('v5.24 Fit is a fixed visible Collection column and PLM Label Fit Name fills it',()=>{
  const cols=between(APP,'const KOL_COLS = [','let kolCustomCols');
  assert.match(cols,/\{k:'fit', label:'Fit'/);
  /* v7.0.229 — Buying Sample sütunu kaldırıldı; Model Detayları sırası
     Kumaş · Assortment · Kalıp · Adet şeklindedir. */
  assert.ok(cols.indexOf("{k:'fit'")>cols.indexOf("{k:'fabric'") && cols.indexOf("{k:'fit'")<cols.indexOf("{k:'quantity'"));
  assert.match(APP,/add\('fit','Label Fit Name','Fit'\)/);
  assert.match(APP,/fit:norm\(raw\.fit\)/);
  assert.match(APP,/kolHiddenCols\.delete\('fit'\)/);
});

test('blank Model Budget Month renders as a truly blank cell',()=>{
  assert.match(APP,/c\.k==='inStoreMonth'[\s\S]*?class="editCell kolMonthCell"[\s\S]*?placeholder=""/);
});

// v6.30: "Seçilenler" grubu araç çubuğu sadeleştirmesinde kaldırıldı; MB Listesi dışa
// aktarımı "İçe / Dışa Aktar" açılır menüsüne taşındı. Düğmenin Koleksiyon araç çubuğunda
// bir açılır menü içinde bulunması sınanmaya devam ediyor.
/* v7.81 — Import/Export menüsü kaldırıldı; MB List export artık Araçlar
   menüsünde (bkz. mb-list-v520.test.js). */
test('v5.24 MB List export sits in the Collection toolbar Excel drawer (7.0.319)',()=>{
  const actions=INDEX.slice(INDEX.indexOf('id="kolTableActions"'),INDEX.indexOf('id="kolCount"'));
  assert.match(actions,/id="kolExcelMenu"[\s\S]*?id="kolMbExportBtn"/);
});

test('v5.24 Collection picture uses the same anchored right-click delete confirmation as CP',()=>{
  const render=between(APP,'tbody.querySelectorAll(\'.kolPictureCell\').forEach(cell=>','// Görsel sütunu başlığı');
  assert.match(render,/img\.addEventListener\('contextmenu',event=>\{/);
  assert.match(render,/openImageDeleteConfirm\(img,\{message:appLang==='en'\?'Remove this Collection image\?'/);
  assert.match(render,/onConfirm:\(\)=>kolRemoveRowImage\(row\)/);
});
