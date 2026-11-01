'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const Engine=require('../public/collection-lfl-engine');

test('reference footer weights by filtered model quantity and compares weighted amounts on matched rows',()=>{
 const result=Engine.summarizeComparisons([{quantity:100,reference:10,price:20},{quantity:300,reference:20,price:10},{quantity:1000000,reference:null,price:5}]);
 assert.equal(result.weightedBefore,17.5);assert.equal(result.arithmeticBefore,15);assert.equal(result.quantity,400);assert.equal(result.usedRows,2);
 assert.equal(result.weightedAfter,12.5);assert.ok(Math.abs(result.percent-(-200/7))<1e-9);
 const missingPrice=Engine.summarizeComparisons([{quantity:100,reference:10,price:null},{quantity:300,reference:20,price:10}]);
 assert.equal(missingPrice.weightedBefore,17.5);assert.equal(missingPrice.percent,-50);assert.equal(missingPrice.pairedRows,1);
 const missingQty=Engine.summarizeComparisons([{quantity:'',reference:10,price:15},{quantity:0,reference:20,price:25}]);
 assert.equal(missingQty.weightedBefore,null);assert.equal(missingQty.arithmeticBefore,15);assert.equal(missingQty.percent,null);
 const empty=Engine.summarizeComparisons([{quantity:100,reference:null,price:10}]);
 assert.equal(empty.weightedBefore,null);assert.equal(empty.arithmeticBefore,null);assert.equal(empty.percent,null);
});

test('footer cells use effective fields, preserve compact folds and summarize independent season simulations',async()=>{
 const orders=['A','B'].flatMap((mag,i)=>[{season:'S6',mag,classification:'K',inStoreMonth:'2026-02',fob:10+i*10,quantity:9000-i*8995,country:'CHINA',orderCode:mag+'-OLD'},{season:'S7',mag,classification:'K',inStoreMonth:'2027-01',fob:10+i*10,quantity:i?500:1000,country:'CHINA',orderCode:mag+'-NEW'}]);
 const references=Engine.buildReferences(orders);let requests=0;
 const context={window:null,appLang:'tr',state:{currentUser:{id:'footer-demo'}},document:{body:{dataset:{activeTab:'overview'}}},BLCollectionLflEngine:Engine,
  escapeHtml:value=>String(value).replace(/[<>&"]/g,'_'),kolFormatMoneyDisplay:value=>Number(value).toFixed(2),kolEffectiveValue:(row,key)=>row.effective?.[key]??row[key],kolSuppFob:row=>Number(row.targetPrice)>0?{price:Number(row.targetPrice),source:'target'}:null,
  fetch:async()=>{requests++;return {ok:true,json:async()=>({references})};}};
 context.window=context;vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/collection-lfl.js'),'utf8'),context);
 const ui=context.BLCollectionLfl;await ui.ensure();
 const rows=[{id:1,season:'S7',mag:'A',urunTipi:'K',inStoreMonth:'FEBRUARY 2027',quantity:100,targetPrice:20},{id:2,season:'S7',mag:'B',urunTipi:'K',inStoreMonth:'FEBRUARY 2027',quantity:300,targetPrice:10}];
 const descriptors=[{kind:'previousSeason',k:'__previousSeason__'},{kind:'lfl',k:'__lfl__'},{kind:'seasonImpact',k:'__seasonImpact__'},{kind:'priceReferences',k:'__referenceSummary__',folds:['__previousSeason__','__lfl__','__seasonImpact__']}];
 const cells=ui.footerCells(rows,descriptors);
 assert.match(cells.get('__previousSeason__'),/17\.50/);assert.match(cells.get('__lfl__'),/17\.50/);
 const summaries=ui.footerSummaries(rows,['impact']),impact=summaries.get('impact');
 assert.equal(impact.weightedBefore,17.5);assert.ok(Math.abs(impact.weightedAfter-((12000/1100)*100+16.25*300)/400)<1e-9);
 assert.match(cells.get('__seasonImpact__'),/→/);assert.match(cells.get('__referenceSummary__'),/Previous Season/);assert.match(cells.get('__referenceSummary__'),/LFL/);
 assert.match(cells.get('__referenceSummary__'),/Sezon Etkisi/);assert.match(cells.get('__referenceSummary__'),/→/);
 assert.match(ui.combinedCell(rows[0],'',['__previousSeason__','__lfl__','__seasonImpact__']),/Sezon Etkisi.*10\.00 → \$10\.91/);
 assert.match(ui.footerCells([{...rows[1],effective:{quantity:100}}],descriptors).get('__lfl__'),/20\.00/);
 assert.match(ui.footerCells([rows[0]],descriptors).get('__lfl__'),/10\.00/);
 assert.ok(!ui.footerCells([{...rows[0],mag:'MISSING'}],descriptors).get('__lfl__').includes('$0.00'));
 context.appLang='en';assert.match(ui.footerCells(rows,descriptors).get('__lfl__'),/W\.Avg/);
 const compactOnly=ui.footerCells(rows,[{kind:'priceReferences',k:'__referenceSummary__',folds:['__lfl__']}]).get('__referenceSummary__');
 assert.match(compactOnly,/LFL/);assert.ok(!compactOnly.includes('Previous Season'));
 context.BLCollectionModelGroups=require('../public/collection-model-groups');
 const parent={...rows[0],modelGroupId:'G',modelGroupRole:'parent',pricing:{SUP:30},confirmedManufacturer:'SUP'};
 const child={...rows[1],modelGroupId:'G',modelGroupRole:'variant'};context.kolRows=[parent,child];
 const grouped=ui.footerSummaries([child],['month']).get('month');assert.equal(grouped.weightedBefore,10);assert.equal(grouped.weightedAfter,30);
 assert.equal(grouped.quantity,300,'use the child colour quantity and the filtered-out parent model fields');
 assert.equal(requests,1,'footer rendering and filtering must not fetch historical orders');
});
