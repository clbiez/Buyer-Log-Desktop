'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ROOT=path.join(__dirname,'..');
const UI=fs.readFileSync(path.join(ROOT,'public','automations.js'),'utf8');
const CSS=fs.readFileSync(path.join(ROOT,'public','app.css'),'utf8');
const SERVER=fs.readFileSync(path.join(ROOT,'server','server.js'),'utf8');
const PLATFORM=fs.readFileSync(path.join(ROOT,'server','lib','platform.js'),'utf8');
const MAIL=fs.readFileSync(path.join(ROOT,'server','lib','automation-email.js'),'utf8');
const store=require('../server/lib/automation-recipe-store');

test('v5.65 condition builder is searchable, supports field value suggestions and change triggers',()=>{
  assert.match(UI,/data-filter-field list=/);
  assert.match(UI,/type="search" data-filter-field/);
  assert.match(UI,/data-filter-value list=/);
  assert.match(UI,/Listeden seç veya yaz/);
  assert.match(UI,/\['changed',tr\('Değiştiğinde','When changed'\)\]/);
  const recipe=store.normalizeRecipe({source:'cp',filters:[{field:'Ex-factory',operator:'changed',value:'ignored'}]},'u1');
  assert.equal(recipe.filters[0].operator,'changed');
  assert.match(SERVER,/automationBuildChangeBaseline/);
  assert.match(SERVER,/automationNextChangeBaseline/);
  assert.match(fs.readFileSync(path.join(ROOT,'server','lib','automation-execution-service.js'),'utf8'),/baseline_created/);
  assert.match(fs.readFileSync(path.join(ROOT,'server','lib','automation-execution-service.js'),'utf8'),/no_change/);
});

test('v5.65 automation field discovery hides internal keys and exposes raw ASAS and IAS database sources',()=>{
  assert.match(UI,/SOURCES=\['cp','orders','backlog','lfl','collection','asas','ias'\]/);
  assert.match(UI,/ASAS · Database/);
  assert.match(UI,/IAS · Database/);
  assert.match(SERVER,/normalized === 'asas'/);
  assert.match(SERVER,/normalized === 'ias'/);
  assert.match(SERVER,/_sourceFields/);
  assert.match(SERVER,/function automationPublicFieldName/);
  assert.match(SERVER,/!text\.startsWith\('_'\)/);
  assert.match(SERVER,/\/api\/automations\/dataset-values/);
});

test('v5.65 Prepare E-Mail recipients are merged into automation groups without becoming editable copies',()=>{
  assert.match(SERVER,/automationPrepareEmailGroups/);
  assert.match(SERVER,/workspace&&workspace\.manufacturers/);
  /* v6.36: adres defteri artık İKİ kaynağın birleşimi — çalışma alanındaki
     üretici e-postaları ve lcw.prodstatus.mails.* tercihindeki diğer adresler
     (ör. ihracat ekipleri). İkincisi eskiden okunmuyordu; oraya kurulan planlı
     otomasyon alıcıyı bulamayıp sessizce boş kalıyordu. Kayıtlar hâlâ salt
     okunur işaretleniyor, yalnız üretim satırı tek yerde toplandı. */
  assert.match(SERVER,/source:'prepare_email',origin,readOnly:true/);
  assert.match(SERVER,/lcw\.prodstatus\.mails\./);
  assert.match(SERVER,/function automationAddressBookEntries/);
  assert.match(UI,/Prepare E-Mail grupları/);
  assert.match(UI,/editableGroups=groups\(\)\.filter\(g=>g\.source!==\'prepare_email\'\)/);
  assert.match(UI,/prepareGroups=groups\(\)\.filter\(g=>g\.source===\'prepare_email\'\)/);
  assert.match(UI,/#autoGroupRows \.autoGroupRow/);
});

test('v5.65 report field chooser has search and keeps checked fields first',()=>{
  assert.match(UI,/data-email-field-search/);
  assert.match(UI,/refreshReportFieldChoices/);
  assert.match(UI,/const ac=a\.querySelector\('input'\)\.checked\?0:1,bc=b\.querySelector\('input'\)\.checked\?0:1/);
  assert.match(UI,/Seçili alanlar listenin en üstünde tutulur/);
  assert.match(CSS,/autoFieldChoices label:has\(input:checked\)/);
});

test('v5.65 manual automation reuses the confirmed preview snapshot and opens draft email asynchronously',()=>{
  assert.match(SERVER,/automationPreviewCachePut/);
  assert.match(SERVER,/automationPreviewCacheTake/);
  assert.match(SERVER,/expiresAt:now\+120000/);
  assert.match(UI,/previewToken:pre\.previewToken/);
  assert.match(MAIL,/openPathExternallyAsync/);
  assert.match(PLATFORM,/function openPathExternallyAsync/);
  assert.match(PLATFORM,/child\.on\('error'/);
});
