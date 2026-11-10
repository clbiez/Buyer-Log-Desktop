'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
process.env.BUYER_LOG_SERVER_DATA_ROOT=fs.mkdtempSync(path.join(os.tmpdir(),'bl-fabric-shared-'));
const seg=require('../public/fabric-card-segments');
const cards=require('../server/lib/fabric-cards');
const sync=require('../server/lib/shared-sync-policy');
const prompt=require('../server/lib/lcwai/lcwai-prompt');

const tr=['Üç İplik Şardonlu','30/70/14','260 gsm','65% Pamuk 35% Polyester'];
const en=['Brushed Three Thread','30/70/14','260 gsm','65% Cotton 35% Poliester'];
const actor={id:'buyer-1',displayName:'Buyer One'};
function item(code='214233',extra={}){
  return {code,summary:seg.compose(tr),summaryEn:seg.compose(en),
    summarySegments:{tr:[...tr],en:[...en]},translationOverrides:{en:[false,false,false,true],tr:[false,false,false,false]},
    summarySource:'manual',raw:code+'-Örme,Üç İplik,260 gsm,%65 Pamuk,%35 Poliester',details:{yarn:'30/70/14'},...extra};
}

test('02/B fixed separators, glossary and technical tokens are deterministic in both languages',()=>{
  assert.equal(seg.compose(tr).split(' · ').length,4);
  assert.equal(seg.compose(['X|Y',...tr.slice(1)]),'');
  assert.equal(seg.compose(['X · Y',...tr.slice(1)]),'');
  assert.equal(seg.parse('A / B · 30/1 · 260 gsm · 100% Pamuk')?.length,4);
  assert.equal(seg.parse('A | 30/1 | 260 gsm | 100% Pamuk'),null);
  assert.equal(seg.translateKnown('3 iplik şardonlu','type','tr').value,'Brushed Three Thread');
  assert.equal(seg.translateKnown('30/70/14','yarn','en').value,'30/70/14');
  assert.equal(seg.translateKnown('30/1 Ne Penye','yarn','tr').value,'30/1 Ne Combed');
  assert.equal(seg.translateKnown('260 gr','weight','tr').value,'260 gsm');
  assert.equal(seg.translateKnown('65% Pamuk 35% Polyester','composition','tr').value,'65% Cotton 35% Poliester');
  assert.equal(seg.translateKnown('65% Cotton 35% Poliester','composition','en').value,'65% Pamuk 35% Polyester');
  assert.equal(seg.validatePair(tr,en).ok,true);
  assert.equal(seg.validatePair(tr,['Brushed Three Thread','30/80/14',...en.slice(2)]).ok,false);
  assert.equal(seg.fromCard({summary:'Unstructured legacy text',summaryEn:'Legacy text'}).legacy,true);
});

test('shared policy includes only validated per-code fabric records, not full local JSON',()=>{
  assert.equal(sync.classifyRecordId('fabric-card:214233'),'SHARED_BUSINESS');
  assert.equal(sync.peerChannelAllows('fabric-card:214233'),true);
  assert.equal(sync.peerChannelAllows('store:fabric-cards.json'),false);
  assert.equal(sync.peerChannelAllows('fabric-card:../unsafe'),false);
  const valid=sync.sanitizeDelta({id:'fabric-card:214233',deviceId:'device-a',userId:'buyer-1',patch:{card:item(),deleted:false,revisionId:'rev-a'}});
  assert.ok(valid);
  assert.equal(valid.patch.card.code,'214233');
  assert.equal(sync.sanitizeDelta({id:'fabric-card:214233',patch:{card:item(),secretKey:'x'}}),null);
  assert.equal(sync.sanitizeDelta({id:'fabric-card:214233',patch:{card:item('999999')}}),null);
});

test('server rejects invalid segment structure and preserves PLM and manual override metadata',()=>{
  assert.throws(()=>cards.normalizeCard({...item(),summarySegments:{tr:['X · Y',...tr.slice(1)],en}},'',{strictSegments:true}),error=>error.code==='FABRIC_SEGMENTS_INVALID');
  assert.throws(()=>cards.normalizeCard({...item(),summarySegments:{tr,en:['Brushed Three Thread','30/70/15','260 gsm','65% Cotton 35% Poliester']}},'',{strictSegments:true}),error=>error.code==='FABRIC_TECHNICAL_MISMATCH');
  const normalized=cards.normalizeCard(item());
  assert.equal(normalized.summary.split(' · ').length,4);
  assert.equal(normalized.summarySegments.en[3],en[3]);
  assert.equal(normalized.translationOverrides.en[3],true);
  assert.match(normalized.raw,/214233-Örme/);
});

test('independent delta records, durable offline outbox and revision-safe conflict choices',async()=>{
  let online=false;
  const shared={};
  const fake={
    readAllSync:()=>Object.keys(shared).length?shared:null,
    async mirror(_collection,changes){
      if(!online)return {ok:false};
      for(const [code,record]of Object.entries(changes))shared[code]={...record};
      return {ok:true};
    },
    async seedMissing(_collection,changes){
      for(const [code,record]of Object.entries(changes))if(!Object.hasOwn(shared,code))shared[code]=record;
      return {seeded:Object.keys(changes).length};
    }
  };
  cards.attachDeltaStore(fake);
  try{
    const first=await cards.upsertFabricCards([item()],actor);
    assert.equal(first.updated,1);
    assert.equal(first.pendingCodes.includes('214233'),true);
    assert.equal((await cards.flushOutbox()).pending,true);
    online=true;
    const published=await cards.flushOutbox();
    assert.equal(published.published,1);
    assert.equal(Object.hasOwn(shared,'214233'),true);
    assert.equal((await cards.loadFabricCardsAsync())._pending['214233'],undefined);
    const baseline=cards.publicCards().cards.find(x=>x.code==='214233').revisionId;
    const other=await cards.upsertFabricCards([item('214234')],{id:'buyer-2',displayName:'Buyer Two'});
    await cards.flushOutbox();
    assert.equal(other.updated,1);
    assert.equal(Object.hasOwn(shared,'214234'),true);
    assert.equal(shared['214233'].revisionId,baseline,'editing another code does not touch this record');
    await assert.rejects(cards.upsertFabricCards([item('214233',{expectedRevisionId:'obsolete'})],actor),error=>error.code==='FABRIC_CARD_CONFLICT');
    await assert.rejects(cards.upsertFabricCards([item('214233',{summarySegments:null})],actor),error=>error.code==='FABRIC_SEGMENTS_REQUIRED');
    const changed=await cards.upsertFabricCards([item('214233',{expectedRevisionId:baseline,details:{weight:'300 gsm'}})],actor);
    assert.equal(changed.updated,1);
    shared['214233']={card:{...shared['214233'].card,revisionId:'peer-b'},deleted:false,revisionId:'peer-b'};
    const blocked=await cards.flushOutbox();
    assert.equal(blocked.published,0);
    assert.equal(blocked.conflicts[0].remoteRevisionId,'peer-b');
    await assert.rejects(cards.resolveFabricConflict('214233','mine','outdated',actor),error=>error.code==='FABRIC_CARD_CONFLICT');
    const accepted=await cards.resolveFabricConflict('214233','mine','peer-b',actor);
    assert.equal(accepted.resolved,true);
    assert.equal((await cards.flushOutbox()).published,1);
    const own=cards.publicCards().cards.find(x=>x.code==='214233');
    assert.equal(own.details.weight,'300 gsm');
    assert.equal(own.translationOverrides.en[3],true);
    const queued=await cards.upsertFabricCards([item('214233',{expectedRevisionId:own.revisionId,details:{weight:'320 gsm'}})],actor);
    assert.equal(queued.updated,1);
    shared['214233']={card:{...shared['214233'].card,revisionId:'peer-c'},deleted:false,revisionId:'peer-c'};
    const restored=await cards.resolveFabricConflict('214233','remote','peer-c',actor);
    assert.equal(restored.resolved,true);
    assert.equal((await cards.loadFabricCardsAsync())._pending['214233'],undefined);
    assert.equal(cards.publicCards().cards.find(x=>x.code==='214233').revisionId,'peer-c');
  }finally{cards.attachDeltaStore(null);}
});

test('internal LCW AI translation contract never needs a third-party service',()=>{
  assert.ok(prompt.contractFor('fabric-segment-translation'));
  const p=prompt.buildPrompt({source:'fabric-segment-translation',task:'Translate a textile fragment',context:{
    text:'Üç İplik Şardonlu',sourceLanguage:'tr',targetLanguage:'en',field:'type'
  },lang:'en'});
  assert.match(p.prompt,/Preserve every technical yarn count/);
  const parsed=prompt.parseStructured('{"translation":"Brushed Three Thread"}','fabric-segment-translation');
  assert.equal(parsed.ok,true);
  assert.equal(parsed.data.translation,'Brushed Three Thread');
});

test('real card dialog and application shell load 02/B without a parallel overlay',()=>{
  const app=fs.readFileSync(path.join(__dirname,'..','public','app-main.js'),'utf8');
  const html=fs.readFileSync(path.join(__dirname,'..','public','index.html'),'utf8');
  assert.ok(html.includes('fabric-card-segments.js')&&html.includes('fabric-card-segment-ui.js'));
  assert.ok(html.indexOf('fabric-card-segment-ui.js')<html.indexOf('app-main.js'));
  assert.ok(app.includes('data-fabric-segments')&&app.includes('BLFabricSegmentUI?.mount'));
  assert.ok(app.includes('kolFabricShowRemoteComparison')&&app.includes('kolFabricCardsRefresh'));
  assert.ok(!app.includes("modal.querySelector('#_kolFabricSummary')"));
  assert.match(app,/sourceLanguage:en\?'en':'tr',uiLanguage:en\?'en':'tr'/);
});

test('repeated pending saves preserve shared ancestry, survive reload and still detect real peer edits',async()=>{
  const shared={};let online=true;
  cards.attachDeltaStore({readAllSync:()=>shared,async mirror(_collection,changes){
    if(!online)return {ok:false};Object.assign(shared,changes);return {ok:true};
  }});
  const code='214240';
  try{
    await cards.upsertFabricCards([item(code)],actor);await cards.flushOutbox();
    const baseline=shared[code].revisionId;online=false;
    for(const finish of ['first pending edit','second pending edit','third pending edit']){
      const current=cards.publicCards().cards.find(c=>c.code===code);
      await cards.upsertFabricCards([item(code,{expectedRevisionId:current.revisionId,details:{finish}})],actor);
      assert.equal((await cards.loadFabricCardsAsync())._pending[code].baseRevisionId,baseline);
    }
    online=true;const result=await cards.flushOutbox();
    assert.equal(result.published,1);assert.deepEqual(result.conflicts,[]);
    assert.equal(shared[code].card.details.finish,'third pending edit');
    online=false;
    for(const finish of ['fourth pending edit','fifth pending edit']){
      const current=cards.publicCards().cards.find(c=>c.code===code);
      await cards.upsertFabricCards([item(code,{expectedRevisionId:current.revisionId,details:{finish}})],actor);
    }
    shared[code]={...shared[code],revisionId:'real-peer-update',card:{...shared[code].card,revisionId:'real-peer-update'}};
    online=true;const conflict=await cards.flushOutbox();
    assert.equal(conflict.published,0);assert.equal(conflict.conflicts[0].remoteRevisionId,'real-peer-update');
    await cards.resolveFabricConflict(code,'remote','real-peer-update',actor);
  }finally{cards.attachDeltaStore(null);}
});

test('deleting a pending edit retains its original shared base',async()=>{
  const shared={};let online=true;
  cards.attachDeltaStore({readAllSync:()=>shared,async mirror(_collection,changes){
    if(!online)return {ok:false};Object.assign(shared,changes);return {ok:true};
  }});
  const code='214241';
  try{
    await cards.upsertFabricCards([item(code)],actor);await cards.flushOutbox();
    const base=shared[code].revisionId;online=false;
    await cards.upsertFabricCards([item(code,{expectedRevisionId:base,details:{finish:'pending'}})],actor);
    const edited=cards.publicCards().cards.find(c=>c.code===code);
    await cards.deleteFabricCard(code,actor,null,{expectedRevisionId:edited.revisionId});
    assert.equal((await cards.loadFabricCardsAsync())._pending[code].baseRevisionId,base);
    online=true;assert.equal((await cards.flushOutbox()).published,1);
    assert.equal(shared[code].deleted,true);
  }finally{cards.attachDeltaStore(null);}
});

test('saving again during publication uses the acknowledged local revision as its base',async()=>{
  const shared={};let release,entered;
  const waiting=new Promise(resolve=>{entered=resolve;});
  let hold=false;
  cards.attachDeltaStore({readAllSync:()=>shared,async mirror(_collection,changes){
    Object.assign(shared,changes);
    if(hold){hold=false;entered();await new Promise(resolve=>{release=resolve;});}
    return {ok:true};
  }});
  const code='214242';
  try{
    await cards.upsertFabricCards([item(code)],actor);await cards.flushOutbox();
    const baseline=shared[code].revisionId;
    await cards.upsertFabricCards([item(code,{expectedRevisionId:shared[code].revisionId,details:{finish:'first'}})],actor);
    hold=true;const flushing=cards.flushOutbox();await waiting;
    const current=cards.publicCards().cards.find(c=>c.code===code);
    await cards.upsertFabricCards([item(code,{expectedRevisionId:current.revisionId,details:{finish:'second'}})],actor);
    assert.equal((await cards.loadFabricCardsAsync())._pending[code].baseRevisionId,baseline,'optimistically staged memory is not a durable acknowledgment');
    release();await flushing;
    assert.equal((await cards.loadFabricCardsAsync())._pending[code].baseRevisionId,shared[code].revisionId,'advance the next pending save after confirmed publication');
    assert.equal((await cards.flushOutbox()).published,1);
    assert.equal(shared[code].card.details.finish,'second');
  }finally{release?.();cards.attachDeltaStore(null);}
});

test('a failed in-flight mirror never becomes the base of a later pending save',async()=>{
  const shared={};let release,entered,failNext=false;
  const waiting=new Promise(resolve=>{entered=resolve;});
  cards.attachDeltaStore({readAllSync:()=>shared,async mirror(_collection,changes){
    const before={...shared};Object.assign(shared,changes);
    if(failNext){failNext=false;entered();await new Promise(resolve=>{release=resolve;});Object.assign(shared,before);return {ok:false};}
    return {ok:true};
  }});
  const code='214244';
  try{
    await cards.upsertFabricCards([item(code)],actor);await cards.flushOutbox();
    const baseline=shared[code].revisionId;
    await cards.upsertFabricCards([item(code,{expectedRevisionId:baseline,details:{finish:'first'}})],actor);
    failNext=true;const flushing=cards.flushOutbox();await waiting;
    const current=cards.publicCards().cards.find(c=>c.code===code);
    await cards.upsertFabricCards([item(code,{expectedRevisionId:current.revisionId,details:{finish:'second'}})],actor);
    release();await flushing;
    assert.equal((await cards.loadFabricCardsAsync())._pending[code].baseRevisionId,baseline);
    const retry=await cards.flushOutbox();assert.equal(retry.published,1);assert.deepEqual(retry.conflicts,[]);
    assert.equal(shared[code].card.details.finish,'second');
  }finally{release?.();cards.attachDeltaStore(null);}
});

// Exercise the actual editor event handlers without a browser dependency in CI.
// DOM stubs store controls and listeners; no translation/state logic is mocked.
function editorHarness(options={}){
  const vm=require('node:vm'),controls=new Map(),listeners=new Map(),timers=new Map();let nextTimer=0;
  const container={innerHTML:'',contains:()=>true,
    querySelector(selector){if(!controls.has(selector))controls.set(selector,{value:'',dataset:{},focus(){}});return controls.get(selector);},
    addEventListener:(type,listener)=>listeners.set(type,listener),removeEventListener:type=>listeners.delete(type)};
  const context={BLFabricSegments:seg,document:{activeElement:null},
    setTimeout(fn){const id=++nextTimer;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id),...options.globals};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','public','fabric-card-segment-ui.js'),'utf8'),context);
  const editor=context.BLFabricSegmentUI.mount(container,{card:item('214243',{translationOverrides:{}}),sourceLanguage:'tr',uiLanguage:'en',...options});
  return {editor,container,context,timers,
    input(lang,index,value){const input=container.querySelector(`[data-part="${lang}:${index}"]`);input.value=value;input.dataset.part=lang+':'+index;input.closest=()=>input;listeners.get('input')({target:input});},
    language(value){listeners.get('change')({target:{value,matches:()=>true}});},
    action(action,index){const button={dataset:{segmentAction:action+':'+index}};listeners.get('click')({target:{closest:()=>button}});},
    async runTimers(){const scheduled=[...timers.values()];timers.clear();for(const run of scheduled)run();await new Promise(resolve=>setImmediate(resolve));}
  };
}

test('source switches never accept an untranslated pair after debounce cancellation or failed translation',async()=>{
  for(const failFirst of [false,true]){
    const h=editorHarness({globals:{BuyerLogAI:{ask:async()=>{throw Error('synthetic translation failure');}}}});
    h.input('tr',0,'Yeni Kumaş Türü');
    if(failFirst)await h.runTimers();
    assert.equal(h.editor.result().ok,false);
    h.language('en');assert.equal(h.editor.result().ok,false);
    h.language('tr');assert.equal(h.editor.result().ok,false);
    h.action('edit',0);h.input('en',0,'New Fabric Type');
    const result=h.editor.result();assert.equal(result.ok,true);
    assert.equal(result.summarySegments.tr[0],'Yeni Kumaş Türü');
    assert.equal(result.summarySegments.en[0],'New Fabric Type');h.editor.dispose();
  }
});

test('late AI replies after a source switch or dispose cannot replace the draft',async()=>{
  for(const finish of ['switch','dispose']){
    let resolve;const h=editorHarness({globals:{BuyerLogAI:{ask:()=>new Promise(done=>{resolve=done;})}}});
    h.input('tr',0,'Yeni Kumaş Türü');await h.runTimers();
    if(finish==='switch')h.language('en');else h.editor.dispose();
    assert.equal(h.editor.result().ok,false);
    resolve({data:{translation:'New Fabric Type'}});await new Promise(done=>setImmediate(done));
    assert.equal(h.editor.result().ok,false);
    assert.equal(h.container.querySelector('[data-part="tr:0"]').value,'Yeni Kumaş Türü');
    assert.equal(h.container.querySelector('[data-part="en:0"]').value,en[0]);
    h.editor.dispose();assert.equal(h.timers.size,0);
  }
});

test('valid pairs and reviewed manual translations survive language switching, with English UI labels',()=>{
  const h=editorHarness();assert.match(h.container.innerHTML,/Segmented summary/);
  assert.match(h.container.innerHTML,/<span data-no-i18n>TR<\/span><span data-no-i18n>EN<\/span>/);
  assert.match(h.container.innerHTML,/<p data-no-i18n><small>TR<\/small> <output data-preview="tr">/);
  assert.equal(h.editor.result().ok,true);h.language('en');assert.equal(h.editor.result().ok,true);
  h.language('tr');h.action('edit',0);h.input('en',0,'Custom Three Thread');h.input('tr',0,'Üç İplik Şardonsuz');
  assert.equal(h.editor.result().ok,false);h.language('en');assert.equal(h.editor.result().ok,false);
  h.language('tr');h.action('confirm',0);assert.equal(h.editor.result().ok,true);
  assert.equal(h.editor.result().summarySegments.en[0],'Custom Three Thread');h.editor.dispose();
});
