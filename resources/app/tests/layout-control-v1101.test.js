'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const engine=require('../public/layout-control-engine.js');
const prompts=require('../server/lib/lcwai/lcwai-prompt.js');

const CP=[
  {
    'Model Name':'FORTNITE-4-YD','C.Code':'GDA','Colour':'DULL GREEN','Order Code':1381184,
    Country:'India','Karışım':'%100 PAMUK','Category':'T-Shirt','Ürün Tanım':'T-Shirt'
  },
  {
    'Model Name':'FORTNITE-4-YD','C.Code':'BLK','Colour':'BLACK','Order Code':1381185,
    Country:'India','Karışım':'100% COTTON','Category':'T-Shirt','Ürün Tanım':'T-Shirt'
  }
];

test('layout type: care label and price tag are distinguished deterministically',()=>{
  assert.equal(engine.classifyDocument('ANA KUMAŞ %100 PAMUK WASH WITH SIMILAR COLOURS MADE IN INDIA'),engine.DOC.CARE_LABEL);
  assert.equal(engine.classifyDocument('BEDEN/SIZE 8y-9y SİP NO 1381178 PEŞİN FİYAT 499,99'),engine.DOC.PRICE_TAG);
  assert.equal(engine.classifyDocument('FORTNITE'),engine.DOC.UNKNOWN);
});

test('native text uses exact CP identities without manual model input',()=>{
  const extraction=engine.deriveLocalExtraction(
    'TÜMÜ --> S7IE69-KK.BDY,FORTNITE-4-YD-(GDA-DULL GREEN) ANA KUMAŞ / %100 PAMUK / HİNDİSTAN’DA ÜRETİLMİŞTİR',
    CP
  );
  assert.deepEqual(extraction.modelCodes,['FORTNITE-4-YD']);
  assert.deepEqual(extraction.colourCodes,['GDA']);
  assert.deepEqual(extraction.colours,['DULL GREEN']);
  assert.deepEqual(extraction.countries,['INDIA']);
  assert.equal(engine.compositionKey(extraction.composition),'COTTON:100');
  assert.equal(extraction.confidence,'EXACT');
});

test('composition normalization treats multilingual cotton forms as equivalent',()=>{
  for(const value of ['%100 PAMUK','100% COTTON','100% COTON','100% BAUMWOLLE']){
    assert.equal(engine.compositionKey(value),'COTTON:100',value);
  }
  assert.equal(engine.compositionKey('95% Cotton / 5% Elastane'),'COTTON:95|ELASTANE:5');
});

test('CP is source of truth: supported fields match, absent references are NOT_CHECKED',()=>{
  const local=engine.deriveLocalExtraction(
    'FORTNITE-4-YD GDA DULL GREEN 1381184 ANA KUMAŞ %100 PAMUK MADE IN INDIA KEEP AWAY FROM FIRE',
    CP
  );
  const report=engine.compare(local,CP);
  const byRule=Object.fromEntries(report.checks.map(check=>[check.rule,check]));
  assert.equal(byRule.MODEL_MATCH.status,'MATCH');
  assert.equal(byRule.COLOR_CODE_MATCH.status,'MATCH');
  assert.equal(byRule.ORDER_MATCH.status,'MATCH');
  assert.equal(byRule.COUNTRY_MATCH.status,'MATCH');
  assert.equal(byRule.COMPOSITION_MATCH.status,'MATCH');
  assert.equal(byRule.CARE_INSTRUCTION_MATCH.status,'NOT_CHECKED');
  assert.equal(byRule.BARCODE_MATCH.status,'NOT_CHECKED');
  assert.equal(byRule.PRICE_MATCH.status,'NOT_CHECKED');
});

test('objective composition conflict becomes MISMATCH',()=>{
  const extraction=engine.mergeExtraction(
    engine.deriveLocalExtraction('FORTNITE-4-YD GDA 95% COTTON 5% ELASTANE MADE IN INDIA',CP),
    {}
  );
  const report=engine.compare(extraction,CP);
  assert.equal(report.checks.find(check=>check.rule==='COMPOSITION_MATCH').status,'MISMATCH');
  assert.equal(report.summary.status,'ERROR');
});

test('AI visual finding stays REVIEW and never becomes deterministic ERROR by itself',()=>{
  const local=engine.deriveLocalExtraction('FORTNITE-4-YD GDA 100% COTTON MADE IN INDIA',CP);
  const extraction=engine.mergeExtraction(local,{visualFindings:['Page 2 text may be clipped'],confidence:'HIGH'});
  const report=engine.compare(extraction,CP);
  const visual=report.checks.find(check=>check.rule==='AI_VISUAL_1');
  assert.equal(visual.status,'REVIEW');
  assert.equal(visual.source,'LCW AI');
});

test('LCW AI layout-control contract keeps multi-page arrays beyond legacy ten-item cap',()=>{
  const payload={
    documentType:'PRICE_TAG',
    modelCodes:['FORTNITE-3-YD'],
    sizes:Array.from({length:14},(_,i)=>(i+1)+'y-'+(i+2)+'y'),
    barcodes:Array.from({length:14},(_,i)=>String(8685000000000+i)),
    pageVariants:Array.from({length:14},(_,i)=>'page='+(i+1)+'|size='+(i+1)+'y-'+(i+2)+'y|barcode='+(8685000000000+i)),
    confidence:'HIGH',
    explanation:'Clearly visible'
  };
  const parsed=prompts.parseStructured(JSON.stringify(payload),'layout-control');
  assert.equal(parsed.ok,true);
  assert.equal(parsed.data.sizes.length,14);
  assert.equal(parsed.data.barcodes.length,14);
  assert.equal(parsed.data.pageVariants.length,14);
  assert.equal(parsed.data.documentType,'PRICE_TAG');
});

test('layout-control wiring reuses central BuyerLogAI and exposes LCW AI workspace entry',()=>{
  const publicRoot=path.join(__dirname,'..','public');
  const ui=fs.readFileSync(path.join(publicRoot,'layout-control.js'),'utf8');
  const chat=fs.readFileSync(path.join(publicRoot,'lcwai-chat.js'),'utf8');
  const perf=fs.readFileSync(path.join(publicRoot,'perf-runtime.js'),'utf8');
  assert.match(ui,/BuyerLogAI/);
  assert.match(ui,/askWithFiles/);
  assert.match(ui,/\/api\/data\/cp/);
  assert.doesNotMatch(ui,/mym\.prod\.lcwaikiki\.com|Authorization|access_token/);
  assert.match(chat,/data-layout-control/);
  assert.match(perf,/layout-control-engine\.js/);
  assert.match(perf,/layout-control\.js/);
});
