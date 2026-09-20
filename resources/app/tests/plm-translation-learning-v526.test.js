'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const APP=fs.readFileSync(path.join(__dirname,'..','public','app-main.js'),'utf8');
const SERVER=fs.readFileSync(path.join(__dirname,'..','server','server.js'),'utf8');
function between(source,start,end){const a=source.indexOf(start),b=source.indexOf(end,a+start.length);assert.ok(a>=0,start+' missing');assert.ok(b>a,end+' missing');return source.slice(a,b);}
function norm(v){return String(v==null?'':v).trim();}
function turknorm(v){return norm(v).toUpperCase().replace(/[İI]/g,'I').replace(/Ş/g,'S').replace(/Ç/g,'C').replace(/Ö/g,'O').replace(/Ü/g,'U').replace(/Ğ/g,'G').replace(/\s+/g,' ').trim();}

test('v5.26 unseen PLM values are reviewed against the live ASAS catalog before Collection planning',()=>{
  const importer=between(APP,'async function importKolPlmExcelFile','function kolImportStyleRowId');
  const loadAt=importer.indexOf('await kolPlmLoadApprovedTranslations()');
  const applyAt=importer.indexOf('kolPlmApplyAsasTranslations(parsed.rows,inferredTranslations)');
  const questionsAt=importer.indexOf('kolPlmTranslationQuestions(parsed.rows)');
  const reviewAt=importer.indexOf('await showKolPlmTranslationReview(translationQuestions)');
  const reviewedAt=importer.indexOf('kolPlmApplyReviewedMappings(parsed.rows,translationReview.mappings,translationInfo)');
  const planAt=importer.indexOf('kolBuildPlmImportPlan(parsed.rows)');
  assert.ok(loadAt>=0&&applyAt>loadAt&&questionsAt>applyAt&&reviewAt>questionsAt&&reviewedAt>reviewAt&&planAt>reviewedAt);
  assert.match(APP,/kolCatalogValues\(meta\.catalog\)/,'candidate vocabulary must come from ASAS-backed Collection catalogs');
  assert.match(APP,/kolPlmRankAsasCandidates\(field,source,5\)/,'five nearest ASAS candidates should be ranked');
});

test('v5.26 category similarity understands the confirmed PLM→ASAS vocabulary transformations',()=>{
  const block=between(APP,'const KOL_PLM_SIMILARITY_PHRASES','function kolPlmAsasCatalogForField');
  const api=new Function('norm','turknorm',`${block}\nreturn {score:kolPlmSimilarityScore,signature:kolPlmSimilarityText};`)(norm,turknorm);
  const pairs=[
    ['2639 - KEY JERSEY BODY SHORT SLEEVED-LICENSE','KEY ORME BODY K.KOL-LİSANS'],
    ['2642 - KEY JERSEY SET-LICENSE','KEY ORME TAKIM-LİSANS'],
    ['2637 - KEY JERSEY SWEATSHIRT-LICENSE','KEY ORME SWEAT-LİSANS'],
    ['2638 - KEY JERSEY BODY LONG SLEEVED-LICENSE','KEY ORME BODY U.KOL-LİSANS'],
  ];
  pairs.forEach(([plm,asas])=>assert.equal(api.score('category',plm,asas),100,`${plm} should rank its ASAS equivalent first`));
});

test('v5.26 unseen Category ranks the closest value from the ASAS catalog',()=>{
  const block=between(APP,'const KOL_PLM_TRANSLATION_FIELD_META','function kolPlmTranslationQuestions');
  const catalog={category:['KEY ORME TAKIM-LİSANS','KEY ORME BODY K.KOL-LİSANS','KEY DOKUMA GÖMLEK-LİSANS'],line:[],license:[]};
  const unique=values=>[...new Set(values)];
  const api=new Function('norm','turknorm','kolUniqueCatalogValues','kolCatalogValues',`${block}\nreturn {rank:kolPlmRankAsasCandidates};`)(norm,turknorm,unique,kind=>catalog[kind]||[]);
  const ranked=api.rank('category','2639 - KEY JERSEY BODY SHORT SLEEVED-LICENSE',5);
  assert.equal(ranked[0].target,'KEY ORME BODY K.KOL-LİSANS');
  assert.equal(ranked[0].score,100);
  assert.ok(ranked.length<=5);
});

test('v5.26 candidate suggestion is never silently applied and user may leave it unresolved',()=>{
  const review=between(APP,'function showKolPlmTranslationReview','function kolPlmApplyReviewedMappings');
  assert.match(review,/Nothing is applied automatically/);
  assert.match(review,/leave blank/);
  assert.match(review,/const exact=item\.catalog\.find/,'approval must resolve to an exact current ASAS catalog value');
  assert.match(review,/if\(!typed\)continue/,'blank selection must remain unresolved');
  const apply=between(APP,'function kolPlmApplyReviewedMappings','function kolPlmUniqueAsasValues');
  assert.match(apply,/\['unresolved','conflict'\]\.includes\(tr\.mode\)/,'review must not overwrite exact/approved translations');
  assert.match(apply,/mode:'user-approved-pending'/);
});

test('v5.26 approved mappings are persisted only after import decisions succeed and reused later',()=>{
  const importer=between(APP,'async function importKolPlmExcelFile','function kolImportStyleRowId');
  const decisionAt=importer.indexOf('await kolResolvePlmExistingDecisions(plan.existing)');
  const saveRowsAt=importer.indexOf('saveKolRows()');
  const saveRulesAt=importer.indexOf('await kolPlmSaveApprovedTranslations(translationReview.mappings)');
  assert.ok(decisionAt>=0&&saveRowsAt>decisionAt&&saveRulesAt>saveRowsAt,'translation rules must not be persisted before the user completes the import');
  assert.match(APP,/kolPlmApprovedTranslationRules\[field\].*\.get\(key\)/s,'saved rules should be checked before static fallback');
  assert.match(SERVER,/app\.get\('\/api\/plm-translations'/);
  assert.match(SERVER,/app\.post\('\/api\/plm-translations'/);
  assert.match(SERVER,/PLM_TRANSLATION_APPROVE/);
});

test('v5.26 shared PLM translation store normalizes source keys and preserves approvals',()=>{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'buyer-log-plm-map-'));
  const old=process.env.BUYER_LOG_SERVER_DATA_ROOT;
  process.env.BUYER_LOG_SERVER_DATA_ROOT=tmp;
  const userDataPath=require.resolve('../server/user-data');
  const storePath=require.resolve('../server/lib/plm-translations');
  delete require.cache[userDataPath];delete require.cache[storePath];
  const store=require('../server/lib/plm-translations');
  const saved=store.upsertPlmTranslations([{field:'category',source:'New Jersey Style - Licence',target:'KEY ORME BODY K.KOL-LİSANS'}],{id:'u1',displayName:'Test User'});
  assert.equal(saved.updated,1);assert.equal(saved.revision,1);
  const loaded=store.publicRules(store.loadPlmTranslations());
  assert.equal(loaded.rules.category.length,1);
  assert.equal(loaded.rules.category[0].target,'KEY ORME BODY K.KOL-LİSANS');
  assert.equal(store.keyOf('new jersey style - licence'),store.keyOf('NEW JERSEY STYLE - LICENCE'));
  fs.rmSync(tmp,{recursive:true,force:true});
  if(old==null)delete process.env.BUYER_LOG_SERVER_DATA_ROOT;else process.env.BUYER_LOG_SERVER_DATA_ROOT=old;
});
