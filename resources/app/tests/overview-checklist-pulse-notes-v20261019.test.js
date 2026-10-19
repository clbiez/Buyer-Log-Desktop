'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const P=require('../public/overview-premium'),L=require('../public/overview-layout');
const read=file=>fs.readFileSync(require('node:path').join(__dirname,'../public',file),'utf8');
const day=Date.UTC(2026,9,19)/86400000;
test('pulse scopes omit empty categories and use exact source rows for every drawer',()=>{
  const orders=[{priority:'CRITICAL',plannedLoadDate:day,qty:5},{priority:'ACTION_TODAY',plannedLoadDate:day+1,qty:3},{priority:'ACTION_THIS_WEEK',plannedLoadDate:null,qty:7},{priority:'ON_TRACK',plannedLoadDate:day+8,qty:10}];
  const scopes=P.pulseScopes({orders},{start:day});
  assert.deepEqual(scopes.map(s=>s.key),['scope','critical','today','week','loading']);
  assert.deepEqual(scopes.map(s=>s.orders.length),[4,1,1,1,2]);
  assert.equal(scopes[2].orders[0],orders[1]);
  assert.deepEqual(P.pulseScopes({orders:[orders[3]]},{start:day}).map(s=>s.key),['scope']);
  assert.deepEqual(P.pulseScopes({orders:[]}),[]);
});
test('saved layouts replace focus with checklist, retire attention and preserve hidden widgets',()=>{
  const known=L.widgets.filter(k=>k!=='checklistRules').concat('productionFocus','attention');
  const saved={version:2,known,pages:[{items:[{key:'productionFocus',x:2,y:8,w:8,h:6},{key:'attention',x:0,y:20,w:6,h:7}]}]};
  const next=L.normalize(saved);
  assert.deepEqual(L.locate(next,'checklistRules').item,{key:'checklistRules',x:2,y:8,w:8,h:6});
  assert.doesNotThrow(()=>L.normalize({...saved,pages:[{items:[null]}]}));
  assert.equal(L.locate(next,'attention'),null);assert.equal(L.spec('productionFocus'),null);assert.equal(L.spec('attention'),null);
  assert.equal(L.locate(L.normalize({...saved,pages:[{items:[]}]}),'checklistRules'),null);
  assert.ok(L.locate(L.normalize({details:{order:['productionFocus','attention']}}),'checklistRules'));
  assert.doesNotMatch(read('index.html'),/data-overview-widget="(?:attention|productionFocus)"/);
});
test('note report routes through shared CP drawer with an isolated per-order delete callback',async()=>{
  const source=read('app-main.js'),start=source.indexOf('async function openOverviewNoteGroupInCp('),end=source.indexOf('function renderOverviewPriorityReminder(',start);
  const one={_id:1,'Order Code':'100',Notes:'same'},two={_id:2,'Order Code':'200',Notes:'same'},calls=[];
  const context={state:{cp:{rows:[one,two]}},appLang:'tr',sameOrderLine:(a,b)=>a['Order Code']===b['Order Code'],overviewNoteCanonical:s=>s,overviewOrderNoteText:r=>r.Notes,clearOverviewNoteOrder:r=>{calls.push(r);r.Notes='';return true;},window:{BLPerf:{ensureFeature:async()=>{}},BLCpAssistant:{openOverviewRows:(...args)=>calls.push(args)}}};
  vm.createContext(context);vm.runInContext(source.slice(start,end),context);
  await context.openOverviewNoteGroupInCp({note:'same',rows:[one,two]});
  const [rows,title,options]=calls.shift();assert.equal(rows[1],two);assert.equal(title,'Notlar · Sipariş detayları');assert.equal(options.notes,true);
  assert.equal(options.deleteNote(one),true);assert.equal(calls[0],one);assert.equal(two.Notes,'same');
  two.Notes='edited';assert.equal(options.deleteNote(two),false);assert.equal(two.Notes,'edited');
  const replacement={...one,_id:2,Notes:'same'},reusedId={...two,_id:1,Notes:'same'};
  context.state.cp.rows=[reusedId,replacement];
  assert.equal(options.deleteNote(one),true);assert.equal(calls.at(-1),replacement);
  assert.equal(reusedId.Notes,'same','a reused display index must not select another order');
  const reminder=source.slice(source.indexOf('function renderOverviewPriorityReminder('),source.indexOf('let _overviewRefreshResult'));
  assert.match(reminder,/<button type="button" class="ovNoteCount"/);assert.doesNotMatch(reminder,/dblclick/);
});
test('own-note deletion respects author and edit rights and never clears another order',()=>{
  const source=read('app-main.js'),start=source.indexOf('function clearOverviewNoteOrder('),end=source.indexOf('function commitCpEditor(',start),calls=[];
  const context={norm:s=>s||'',noteAuthoredByCurrentUser:id=>id==='me',clearRowNote:(id,key)=>calls.push({id,key})};vm.createContext(context);vm.runInContext(source.slice(start,end),context);
  assert.equal(context.clearOverviewNoteOrder({_id:1,Notes:'mine',_notesBy:'me','Ek Not':'other',_ekNotBy:'other'}),true);
  assert.deepEqual(calls,[{id:1,key:'Notes'}]);
  assert.equal(context.clearOverviewNoteOrder({_id:2,_canEdit:false,Notes:'mine',_notesBy:'me'}),false);assert.equal(calls.length,1);
});

test('report row actions bind to displayed rows while a search redraw is pending',()=>{
  const source=read('detail-drawer.js');
  assert.match(source,/active\.renderedRows=shown/);
  assert.match(source,/row=report\.renderedRows\[Number\(rowButton\.dataset\.blDetailRow\)\]/);
  assert.doesNotMatch(source,/row=filteredRows\(\)\[Number\(rowButton/);
});
