'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const E=require('../public/pricing-desk-engine'),source=fs.readFileSync(path.join(__dirname,'../public/pricing-desk.js'),'utf8');
function desk(canEdit=true,thumb=''){const window={BLPricingDeskEngine:E,BL_QUOTATIONS:{desk:{canEdit:()=>canEdit,findRow:()=>null,itemCategory:()=> 'Demo Knit',itemTarget:()=>10,itemFabric:()=>'',ownerLabel:()=>'',imageSrc:()=>'',thumb:()=>thumb}}},c={window,document:{addEventListener(){},getElementById:()=>null},BLStorage:{getItem:()=>null,setItem(){}},appLang:'tr'};vm.createContext(c);vm.runInContext(source,c);return window.BLPricingDesk._test;}
function request(){return {id:'window',source:'collection',manufacturers:[{name:'A'},{name:'B'}],items:Array.from({length:150},(_,m)=>[{id:'a'+m,modelKey:'m'+m,modelCode:'MODEL-'+m,manufacturer:'A',price:m?'9':'',options:m?[]:[{id:'opt',price:'8'}]},{id:'b'+m,modelKey:'m'+m,modelCode:'MODEL-'+m,manufacturer:'B',price:'11',dropped:m===60}]).flat()};}
test('full model copy includes every row, empty input placeholder and native option label order',()=>{
 const api=desk(),req=request(),layout=E.supplierLayout(E.supplierScorecards(req),true),matrix={...E.requestMatrix(req),manufacturers:layout.visible.map(s=>s.name)},text=api.matrixClipboardText(req,{matrix,layout,canEdit:true});
 assert.match(text,/MODEL-0\n/);assert.match(text,/MODEL-149\n/);assert.match(text,/—\n\nOPS 1\n/);assert.equal((text.match(/MODEL-\d+\n/g)||[]).length,150);
 assert.equal(req.items[0].price,'');
});
test('model copy collapses HTML whitespace, preserves NBSP and keeps readonly missing-cell separators',()=>{
 const api=desk(false),req={id:'readonly',source:'collection',manufacturers:[{name:'A'},{name:'B'}],items:[{id:'a',modelKey:'m',modelCode:'MODEL  X',manufacturer:'A',price:'9'}]},layout=E.supplierLayout(E.supplierScorecards(req),true),matrix={...E.requestMatrix(req),manufacturers:['A','B']};
 const text=api.matrixClipboardText(req,{matrix,layout,canEdit:false});assert.match(text,/MODEL X\n/);assert.match(text,/9,00\n\n—\n$/);
 req.items[0].modelCode='MODEL\u00a0X';assert.match(desk(false).matrixClipboardText(req,{matrix,layout,canEdit:false}),/MODEL\u00a0X\n/);
});
test('folded supplier header keeps the native tab before the manufacturer control',()=>{
 const api=desk(),manufacturers=Array.from({length:20},(_,i)=>({name:'Factory '+i})),req={id:'folded',source:'collection',manufacturers,items:manufacturers.map((m,i)=>({id:String(i),modelKey:'m',manufacturer:m.name,price:String(8+i/10)}))},layout=E.supplierLayout(E.supplierScorecards(req)),matrix={...E.requestMatrix(req),manufacturers:layout.visible.map(card=>card.name)};
 assert.equal(layout.other.length,12);assert.match(api.matrixClipboardText(req,{matrix,layout,canEdit:true}),/Diğer \(12\)\tÜretici\n/);
});
test('paste planning uses logical coordinates beyond the rendered window and skips dropped/missing cells',()=>{
 const api=desk(),req=request(),matrix={...E.requestMatrix(req),manufacturers:['A','B']};
 const plan=api.matrixPasteTargets(req,matrix,59,0,'7\t8\n6\t5\n4\t3');
 assert.deepEqual(Array.from(plan,p=>[p.line.id,p.value]),[['a59','7'],['b59','8'],['a60','6'],['a61','4'],['b61','3']]);
 assert.equal(req.items.find(line=>line.id==='a60').price,'9');assert.equal(desk(false).matrixPasteTargets(req,matrix,59,0,'7\t8').length,0);
});
test('a row window reaches both endpoints with bounded overscan and handles small matrices',()=>{
 const api=desk(),first=api.matrixWindow(1500,0,800,42),last=api.matrixWindow(1500,1500*42,800,42);
 assert.equal(first.start,0);assert.ok(first.end<=40);assert.equal(last.end,1500);assert.ok(last.start>=1460);
 assert.deepEqual(JSON.parse(JSON.stringify(api.matrixWindow(5,0,800,42))),{start:0,end:5});
});
test('Tab finds the next logical focusable row across dropped rows, including missing editable cells',()=>{
 const api=desk(),req=request();req.items.filter(line=>line.modelKey==='m60').forEach(line=>line.dropped=true);
 const matrix={...E.requestMatrix(req),manufacturers:['A','B']},ctx={matrix,canEdit:true,other:[]};
 assert.equal(api.matrixNextFocusRow(ctx,59,1),61);assert.equal(api.matrixNextFocusRow(ctx,61,-1),59);
 req.items=req.items.filter(line=>line.id!=='a60');matrix.models=E.requestMatrix(req).models;assert.equal(api.matrixNextFocusRow(ctx,59,1),60);
 assert.equal(api.matrixNextFocusRow({...ctx,canEdit:false},59,1),-1);
});

test('model clipboard can omit nonselectable headers and preserves an image placeholder line break',()=>{
 const api=desk(true,'<img class="pdThumb" alt="">'),req=request(),layout=E.supplierLayout(E.supplierScorecards(req),true),matrix={...E.requestMatrix(req),manufacturers:layout.visible.map(card=>card.name)};
 const text=api.matrixClipboardText(req,{matrix,layout,canEdit:true},{headers:false});assert.ok(text.startsWith('\nMODEL-0\n'));assert.equal((text.match(/\nMODEL-\d+\n/g)||[]).length,150);assert.equal(text.includes('En iyi / Onaylı'),false);
});
test('server acknowledgements replace item objects without leaving the view on stale prices or paste targets',()=>{
 const api=desk(),req=request(),matrix={...E.requestMatrix(req),manufacturers:['A','B']},view={req,items:req.items,matrix};
 req.items=req.items.map(line=>({...line,price:line.id==='a60'?'4.25':line.price})).reverse();
 const current=api.matrixCurrent(view);assert.equal(current.models[60].modelKey,'m60');assert.equal(current.models[60].cell('A').price,'4.25');
 assert.equal(api.matrixPasteTargets(req,current,60,0,'7\t8')[0].line,req.items.find(line=>line.id==='a60'));
 assert.equal(api.matrixCurrent(view),current,'unchanged item arrays reuse the current grouping');
});
