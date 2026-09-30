'use strict';
// Koleksiyon'a model eklerken PLM → ASAS eşleme ekranı, daha önce onaylanan
// seçimleri (Category / License) işaretli getirir; kullanıcı yine değiştirebilir.
// Line bu ekrana hiç girmez (PLM doğru kabul edilir).
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const APP=fs.readFileSync(path.join(__dirname,'..','public','app-main.js'),'utf8');
const DRAG=fs.readFileSync(path.join(__dirname,'..','public','collection-plm-drag-import.js'),'utf8');
function between(source,start,end){const a=source.indexOf(start),b=source.indexOf(end,a+start.length);assert.ok(a>=0,start+' missing');assert.ok(b>a,end+' missing');return source.slice(a,b);}
function norm(v){return String(v==null?'':v).trim();}
function turknorm(v){return norm(v).toUpperCase().replace(/[İI]/g,'I').replace(/Ş/g,'S').replace(/Ç/g,'C').replace(/Ö/g,'O').replace(/Ü/g,'U').replace(/Ğ/g,'G').replace(/\s+/g,' ').trim();}

function questionsApi(remembered){
  const block=between(APP,'const KOL_PLM_TRANSLATION_FIELD_META','function kolPlmConfidenceLabel');
  const catalog={category:['KEY BASIC','KEY ORME TAKIM-LİSANS','KEY DOKUMA GÖMLEK-LİSANS'],line:['ASAS LINE'],license:['MARVEL','DISNEY']};
  const unique=values=>[...new Set(values)];
  const choice=(field,source)=>remembered[`${field}|${turknorm(source)}`]||null;
  return new Function('norm','turknorm','kolUniqueCatalogValues','kolCatalogValues','kolPlmIsDirectField','kolPlmRememberedChoice',`${block}\nreturn kolPlmTranslationQuestions;`)(
    norm,turknorm,unique,kind=>catalog[kind]||[],field=>field==='line',choice);
}
function row(categoryRaw,brandToken,modes,targets={}){
  return {_plmSource:{categoryRaw,brandToken,lineRaw:'L1'},_plmTranslations:{
    category:{source:categoryRaw,target:targets.category||'',mode:modes.category},
    license:{source:brandToken,target:targets.license||'',mode:modes.license},
    line:{source:'L1',target:'L1',mode:'plm-direct'},
  }};
}

test('remembered Category choice is offered again, preselected and ranked first; Line is never asked',()=>{
  const ask=questionsApi({'category|1234 - KEY ORME BASIC':{keepAsIs:false,target:'Key Basic'}});
  const questions=ask([row('1234 - Key Orme Basic','',{category:'approved-rule'},{category:'KEY BASIC'})]);
  assert.equal(questions.length,1);
  const [item]=questions;
  assert.equal(item.field,'category');
  assert.deepEqual(item.remembered,{keepAsIs:false,target:'KEY BASIC'},'remembered target resolves to the exact current ASAS spelling');
  assert.equal(item.candidates[0].target,'KEY BASIC','remembered target is the first candidate');
  assert.ok(!questions.some(q=>q.field==='line'));
});

test('remembered choices can be excluded (PLM sync) and unknown ASAS targets are not preselected',()=>{
  const ask=questionsApi({'category|C1':{keepAsIs:false,target:'KEY BASIC'},'category|C2':{keepAsIs:false,target:'REMOVED FROM ASAS'}});
  const rows=[row('C1','',{category:'approved-rule'},{category:'KEY BASIC'}),row('C2','',{category:'approved-rule'},{category:'REMOVED FROM ASAS'})];
  assert.equal(ask(rows,{includeRemembered:false}).length,0,'sync keeps silently applying approved rules');
  const shown=ask(rows);
  assert.deepEqual(shown.map(q=>q.source),['C1'],'a rule whose target left the ASAS catalog is applied as before, not shown');
});

test('remembered “Keep as is” and conflicting ASAS values come preselected too',()=>{
  const ask=questionsApi({'license|B1':{keepAsIs:true,target:'B1'},'category|C9':{keepAsIs:false,target:'KEY BASIC'}});
  const questions=ask([row('C9','B1',{category:'conflict',license:'unresolved'})]);
  const byField=Object.fromEntries(questions.map(q=>[q.field,q]));
  assert.deepEqual(byField.license.remembered,{keepAsIs:true,target:'B1'});
  assert.equal(byField.category.conflict,true);
  assert.equal(byField.category.remembered.target,'KEY BASIC');
});

test('new unresolved values are listed before remembered ones',()=>{
  const ask=questionsApi({'category|A OLD':{keepAsIs:false,target:'KEY BASIC'}});
  const questions=ask([row('A OLD','',{category:'approved-rule'},{category:'KEY BASIC'}),row('Z NEW','',{category:'unresolved'})]);
  assert.deepEqual(questions.map(q=>q.source),['Z NEW','A OLD']);
});

test('reviewed mapping may change or clear a remembered rule but never touches Line or exact ASAS values',()=>{
  const block=between(APP,'function kolPlmApplyReviewedMappings','function kolPlmUniqueAsasValues');
  const apply=new Function('norm','turknorm','kolPlmIsDirectField',`${block}\nreturn kolPlmApplyReviewedMappings;`)(norm,turknorm,field=>field==='line');
  const make=(category,mode)=>({urunTipi:'KEY BASIC',line:'L1',_plmSource:{categoryRaw:category,lineRaw:'L1'},_plmTranslations:{category:{source:category,target:'KEY BASIC',mode},line:{source:'L1',target:'L1',mode:'plm-direct'}}});
  const changed=make('C1','approved-rule'),cleared=make('C2','approved-rule'),exact=make('C1','exact-plm');
  const info={};
  apply([changed,cleared,exact],[
    {field:'category',source:'C1',target:'KEY ORME TAKIM-LİSANS',keepAsIs:false},
    {field:'category',source:'C2',clear:true},
    {field:'line',source:'L1',target:'OTHER',keepAsIs:false},
  ],info);
  assert.equal(changed.urunTipi,'KEY ORME TAKIM-LİSANS');
  assert.equal(cleared.urunTipi,'');
  assert.equal(cleared._plmTranslations.category.mode,'unresolved');
  assert.equal(exact.urunTipi,'KEY BASIC');
  assert.equal(changed.line,'L1');
  assert.deepEqual(info.reviewedMappings.map(m=>m.source),['C1','L1'],'cleared rows are not saved as choices');
});

test('review dialog preselects remembered choices and every add flow saves Keep as is as the last choice',()=>{
  const review=between(APP,'function showKolPlmTranslationReview','function kolPlmApplyReviewedMappings');
  assert.match(review,/item\.remembered/);
  assert.match(review,/setChoiceMode\(index,'keep'\)/);
  assert.match(review,/clear:true/);
  assert.match(review,/plmRememberedTag/);
  // toggle(cls, undefined) sınıfı çevirir; aday işaretliyken "Olduğu gibi taşı" da işaretli görünüyordu.
  assert.match(review,/:!!\(btn\.dataset\.plmCandidateValue&&/);
  const normalize=between(APP,'async function kolPlmNormalizeAndTranslate','function kolBuildPlmImportPlan');
  assert.match(normalize,/includeRemembered:reviewRemembered/);
  assert.match(APP,/kolPlmNormalizeAndTranslate\(fetchResult\.records,\{reviewRemembered:false\}\)/,'PLM sync of existing models keeps applying approved rules silently');
  assert.doesNotMatch(APP,/reviewedMappings\|\|\[\]\)\.filter\(item=>!item\.keepAsIs\)/);
  assert.doesNotMatch(DRAG,/filter\(item => !item\.keepAsIs\)/);
  const setter=between(APP,'function kolPlmSetApprovedTranslationRules','async function kolPlmLoadApprovedTranslations');
  assert.match(setter,/keepAsIs/);
});

test('server store remembers Keep as is without turning it into a translation rule target',()=>{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'buyer-log-plm-keep-'));
  const old=process.env.BUYER_LOG_SERVER_DATA_ROOT;
  process.env.BUYER_LOG_SERVER_DATA_ROOT=tmp;
  const userDataPath=require.resolve('../server/user-data');
  const storePath=require.resolve('../server/lib/plm-translations');
  delete require.cache[userDataPath];delete require.cache[storePath];
  try{
    const store=require('../server/lib/plm-translations');
    let saved=store.upsertPlmTranslations([{field:'license',source:'Marvl',target:'MARVEL'}],{id:'u1'});
    assert.equal(saved.updated,1);
    saved=store.upsertPlmTranslations([{field:'license',source:'Marvl',target:'ignored',keepAsIs:true}],{id:'u1'},saved.revision);
    assert.equal(saved.updated,1,'switching a rule to Keep as is overwrites it');
    const rule=store.publicRules(store.loadPlmTranslations()).rules.license[0];
    assert.equal(rule.keepAsIs,true);
    assert.equal(rule.target,'Marvl');
    saved=store.upsertPlmTranslations([{field:'license',source:'Marvl',target:'Marvl',keepAsIs:true}],{id:'u1'},saved.revision);
    assert.equal(saved.updated,0,'unchanged Keep as is is a no-op');
  }finally{
    delete require.cache[userDataPath];delete require.cache[storePath];
    fs.rmSync(tmp,{recursive:true,force:true});
    if(old==null)delete process.env.BUYER_LOG_SERVER_DATA_ROOT;else process.env.BUYER_LOG_SERVER_DATA_ROOT=old;
  }
});
