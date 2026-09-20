'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ROOT=path.join(__dirname,'..');
const INDEX=fs.readFileSync(path.join(ROOT,'public','index.html'),'utf8');
const APP=fs.readFileSync(path.join(ROOT,'public','app-main.js'),'utf8');
const VIEW=fs.readFileSync(path.join(ROOT,'public','cp-overview-assistant.js'),'utf8');
const CSS=fs.readFileSync(path.join(ROOT,'public','app.css'),'utf8');
const CPA_CSS=fs.readFileSync(path.join(ROOT,'public','cp-overview-assistant.css'),'utf8');
const layout=require('../public/overview-layout.js');

const DETAIL_KEYS=['productionFocus','attention','dataCoverage','country','subManufacturer','season','buyingGroup'];

test('v9.58 CP Overview detay modülleri merkezi Edit Layout registry içinde ayrı ayrı bulunur',()=>{
  assert.deepEqual(layout.detailWidgets,DETAIL_KEYS);
  const state=layout.normalize(null);
  assert.deepEqual(state.details.order,DETAIL_KEYS);
  assert.deepEqual(state.details.hidden,[]);
  assert.equal(state.details.widths.country,'half');
  assert.equal(state.details.widths.subManufacturer,'half');
  assert.equal(state.details.widths.productionFocus,'full');
  for(const key of DETAIL_KEYS)assert.match(INDEX,new RegExp(`data-overview-detail-widget="${key}"`));
});

test('v9.58 eski Overview layout kaydı yeni detay varsayılanlarına güvenle yükselir',()=>{
  const state=layout.normalize({order:['oab','overviewContent'],hidden:['notes']});
  assert.deepEqual(state.details.order,DETAIL_KEYS);
  assert.deepEqual(state.details.hidden,[]);
  const custom=layout.normalize({details:{order:['season','country'],hidden:['attention','bad'],widths:{country:'third',season:'bad'}}});
  assert.equal(custom.details.order[0],'season');
  assert.equal(custom.details.order[1],'country');
  assert.deepEqual(custom.details.hidden,['attention']);
  assert.equal(custom.details.widths.country,'third');
  assert.equal(custom.details.widths.season,'full');
});

test('v9.58 Today Production Focus, Attention ve Data Coverage bağımsız hostlara çizilir',()=>{
  assert.match(INDEX,/id="cpAssistant"/);
  assert.match(INDEX,/id="cpAssistantAttention"/);
  assert.match(INDEX,/id="cpAssistantCoverage"/);
  assert.match(VIEW,/function attentionHost\(\)/);
  assert.match(VIEW,/function coverageHost\(\)/);
  assert.match(VIEW,/attention\.innerHTML = attentionCard\(\)/);
  assert.doesNotMatch(VIEW,/state\.perspective === 'manager'/);
  assert.match(VIEW,/coverage\.innerHTML = coverageCard\(\)/);
});

test('v9.58 Priorities ve Checklist masaüstünde iki eşit sütun, tek kartta tam genişlik kullanır',()=>{
  assert.match(CPA_CSS,/\.cpaGrid\{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(CPA_CSS,/\.cpaGrid\.is-single\{[^}]*grid-template-columns:minmax\(0,1fr\)/);
  assert.match(CPA_CSS,/@media\(max-width:1100px\)\{\.cpaGrid\{grid-template-columns:1fr\}/);
});

test('v9.58 dört breakdown başlığı kendi collapse kontrolüne sahiptir',()=>{
  for(const key of ['country','subManufacturer','season','buyingGroup']){
    assert.match(INDEX,new RegExp(`data-ov-detail-collapse="${key}"`));
  }
  assert.match(APP,/next\.details\.collapsed\[key\]=!next\.details\.collapsed\[key\]/);
  assert.match(CSS,/\.ovDetailWidget\.ovDetailWidgetCollapsed>\.ovDetailWidgetBody\{display:none!important;\}/);
});

test('v9.58 Edit Layout detay modüllerini gizler, ekler, sıralar ve genişliklerini saklar',()=>{
  assert.match(APP,/overviewLayoutBucket\(state,scope\)/);
  assert.match(APP,/data-overview-detail-widget/);
  assert.match(APP,/detailWidgets\.filter\(key=>state\.details\.hidden\.includes\(key\)\)/);
  assert.match(APP,/bucket\.hidden=bucket\.hidden\.filter\(item=>item!==key\)/);
  assert.match(APP,/bucket\.order=\[\.\.\.container\.children\]/);
  assert.match(CSS,/\.ovDetailGrid\{[^}]*repeat\(12,minmax\(0,1fr\)\)/);
  assert.match(CSS,/data-ov-detail-width="half"[^}]*grid-column:span 6/);
});
