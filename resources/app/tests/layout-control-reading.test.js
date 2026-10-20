'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const engine=require('../public/layout-control-engine');
const template=require('../public/layout-control-template');
const cp=[{'Order Code':1382024,'Model Name':'MINECRAFT-9-YD','Special Code':'S7Y487Z4','C.Code':'QXM',Colour:'BLUE',Country:'India',Category:'T-Shirt','Karışım':'100% Cotton','Peşin Satış Fiyatı':499.99}];
const text='BEDEN/SIZE 8y-9y Sip No: 1382024 KK.BDY,MINECRAFT-9-YD / S7Y487Z4 / QXM S7-CU17 / CU4E Üretim Yeri: T-Shirt: HİNDİSTAN Peşin Fiyat ₺499,99 Taksitli Fiyat ₺549,99';
test('printed price tag fields are read without borrowing expected CP values',()=>{
 const ex=engine.deriveLocalExtraction(text,[]);
 assert.equal(ex.documentType,'PRICE_TAG');assert.deepEqual(ex.orderNumbers,['1382024']);assert.deepEqual(ex.countries,['INDIA']);assert.deepEqual(ex.cashPrices,['₺499,99']);assert.deepEqual(ex.instalmentPrices,['₺549,99']);
 assert.ok(ex.modelCodes.includes('MINECRAFT-9-YD'));assert.ok(ex.specialCodes.includes('S7Y487Z4'));
});
test('empty PDF text markers cannot mask the actual visual identity band',()=>{
 const ex=engine.mergeExtraction(engine.deriveLocalExtraction('[[PAGE 1]] [[PAGE 2]]',[]),{documentType:'PRICE_TAG',identityText:text,modelCodes:['MINECRAFT-9-YD'],orderNumbers:['1382024'],cashPrices:['₺499,99'],confidence:'HIGH'});
 assert.match(ex.identityText,/1382024/);const report=engine.assess(ex,cp);
 assert.equal(report.reference.status,'MATCH');assert.equal(report.checks.find(c=>c.rule==='MODEL_MATCH').status,'MATCH');assert.equal(report.checks.find(c=>c.rule==='PRICE_MATCH').status,'MATCH');
});
test('exact order anchors the comparison and wrong country/model are retained as conflicts',()=>{
 const ex=engine.deriveLocalExtraction(text.replace('MINECRAFT-9-YD','WRONG-9-YD').replace('HİNDİSTAN','BANGLADEŞ'),[]);
 const report=engine.assess(ex,cp);assert.equal(report.reference.status,'MATCH');
 assert.equal(report.checks.find(c=>c.rule==='MODEL_MATCH').status,'MISMATCH');assert.equal(report.checks.find(c=>c.rule==='COUNTRY_MATCH').status,'MISMATCH');
 const missing=engine.assess(engine.deriveLocalExtraction(text.replace('1382024','1999999'),[]),cp);assert.equal(missing.reference.status,'NONE');assert.equal(missing.referenceRows.length,0);
});
test('care review uses only relevant content and compliant AI assessments do not force Review',()=>{
 const findings=['CARE_LANG','CARE_TRANSLATIONS','CARE_CONTACT'].map(ruleId=>JSON.stringify({ruleId,verdict:'PASS',page:1,actual:'Visible evidence',comment:'Consistent'}));
 const checks=template.focusedChecks('CARE_LABEL',findings,1,'en',{extraction:{languageCodes:template.LANGUAGES,languageTexts:template.LANGUAGES.map(code=>JSON.stringify({code,composition:'100% Cotton'}))},referenceRows:[],complete:true});
 assert.ok(checks.filter(c=>c.ruleId!=='CARE_FIRE').every(c=>c.status==='MATCH'));assert.ok(!checks.some(c=>/SATIN|SMALL|HOME|INNER|QR|PRODUCTION/.test(c.ruleId)));
 assert.ok(checks.every(c=>c.decision==='PENDING'));
});
test('cash selling price never uses instalment or FOB as its CP reference',()=>{
 const ex=engine.deriveLocalExtraction(text,[]);
 const report=engine.assess(ex,[{...cp[0],'Peşin Satış Fiyatı':undefined,'FOB ($)':499.99}]);
 const price=report.checks.find(c=>c.rule==='PRICE_MATCH');assert.equal(price.status,'NOT_CHECKED');assert.deepEqual(price.actual,['₺499,99']);
});
test('lining does not overwrite the main-fabric composition with a combined blend',()=>{
 const local=engine.deriveLocalExtraction('KK.BDY,MINECRAFT-9-YD MAIN FABRIC / 100% COTTON / LINING / 100% POLYESTER / MADE IN INDIA',cp);
 const ex=engine.mergeExtraction(local,{documentType:'CARE_LABEL',composition:['100% COTTON']});ex.documentType='CARE_LABEL';
 assert.equal(engine.compositionKey(ex.composition),'COTTON:100');assert.equal(engine.assess(ex,cp).checks.find(c=>c.rule==='COMPOSITION_MATCH').status,'MATCH');
});
test('unread pages or unresolved CP/core fields block final approval; invalid prices never pass',()=>{
 for(const rule of ['LAYOUT_PAGE_COVERAGE','CP_ORDER_LINK','MODEL_MATCH'])assert.equal(template.reviewStatus([{rule:'STD_PRICE_CASH',category:'STANDARD',status:'MATCH',decision:'APPROVED'},{rule,category:'REFERENCE',status:'REVIEW'}]),'PENDING');
 const ex=engine.mergeExtraction({},{documentType:'PRICE_TAG',modelCodes:['MINECRAFT-9-YD'],orderNumbers:['1382024'],cashPrices:['N/A']});
 assert.equal(engine.assess(ex,[{...cp[0],'Peşin Satış Fiyatı':'N/A'}]).checks.find(c=>c.rule==='PRICE_MATCH').status,'REVIEW');
});
test('core-field markers use validated page evidence and reject invented coordinates',()=>{
 const ex=engine.mergeExtraction(engine.deriveLocalExtraction(text,[]),{fieldEvidence:[JSON.stringify({field:'cashPrices',page:2,bbox:[.1,.6,.7,.1],text:'Peşin ₺499,99'}),JSON.stringify({field:'countries',page:5,bbox:[.1,.2,.3,.1],text:'INDIA'}),JSON.stringify({field:'modelCodes',page:1,bbox:[.9,.2,.5,.1],text:'MINECRAFT-9-YD'})]});
 const report=engine.assess(ex,cp,{reading:{totalPages:2,readPages:[1,2],failedPages:[]}});
 assert.deepEqual(report.checks.find(c=>c.rule==='PRICE_MATCH').bbox,[.1,.6,.7,.1]);assert.equal(report.checks.find(c=>c.rule==='PRICE_MATCH').page,2);
 assert.equal(report.checks.find(c=>c.rule==='COUNTRY_MATCH').bbox,undefined);assert.equal(report.checks.find(c=>c.rule==='MODEL_MATCH').bbox,undefined);
});
test('fire applicability follows child wearables and BU/BG nightwear instead of every adult garment',()=>{
 assert.equal(engine.fireRequirement(cp),true);
 assert.equal(engine.fireRequirement([{'Special Code':'DEMO00Z8',Category:'T-Shirt',MMYG:'ADULT'}]),false);
 assert.equal(engine.fireRequirement([{'Special Code':'DEMO00Z8',Category:'Pyjamas',MMYG:'BU'}]),true);
 assert.equal(engine.fireRequirement([{'Special Code':'DEMO00Z8',Category:'Pyjamas'}]),null);
 assert.equal(engine.fireRequirement([]),null);
});
test('a conflicting translated composition cannot pass even when AI suggested PASS',()=>{
 const findings=[JSON.stringify({ruleId:'CARE_TRANSLATIONS',verdict:'PASS',page:1,actual:'100% Cotton'})];
 const check=template.focusedChecks('CARE_LABEL',findings,1,'en',{complete:true,compositionKey:engine.compositionKey,extraction:{composition:['100% Cotton'],languageCodes:template.LANGUAGES,languageTexts:template.LANGUAGES.map(code=>JSON.stringify({code,composition:code==='EN'?'100% Polyester':'100% Cotton'}))}}).find(c=>c.ruleId==='CARE_TRANSLATIONS');
 assert.equal(check.status,'MISMATCH');assert.match(check.actual[0],/EN/);
});
test('native text from one page cannot hide a conflicting scanned-page value',()=>{
 const local=engine.deriveLocalExtraction(text,[]);
 const ex=engine.mergeExtraction(local,{documentType:'PRICE_TAG',countries:['BANGLADESH'],cashPrices:['₺599,99']});
 const report=engine.assess(ex,cp);
 assert.deepEqual(report.extraction.countries,['INDIA','BANGLADESH']);
 assert.equal(report.checks.find(c=>c.rule==='COUNTRY_MATCH').status,'REVIEW');assert.equal(report.checks.find(c=>c.rule==='PRICE_MATCH').status,'REVIEW');
 const bad=engine.assess(engine.mergeExtraction(engine.deriveLocalExtraction(text.replace('HİNDİSTAN','BANGLADEŞ'),[]),{countries:['INDIA']}),cp);
 assert.equal(bad.checks.find(c=>c.rule==='COUNTRY_MATCH').status,'MISMATCH');
});
test('complete language coverage does not erase a concrete language-section issue',()=>{
 const checks=template.focusedChecks('CARE_LABEL',[JSON.stringify({ruleId:'CARE_LANG',verdict:'ISSUE',page:1,actual:'TR/EN sections reversed',comment:'Wrong printed sequence'})],1,'en',{complete:true,extraction:{languageCodes:template.LANGUAGES}});
 assert.equal(checks.find(c=>c.ruleId==='CARE_LANG').status,'MISMATCH');assert.match(checks.find(c=>c.ruleId==='CARE_LANG').detail,/Wrong printed sequence/);
});
