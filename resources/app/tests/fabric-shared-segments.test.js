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
});
