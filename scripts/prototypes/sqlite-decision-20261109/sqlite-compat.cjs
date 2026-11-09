'use strict';
// Isolated compatibility slice, not a product backend or migration adapter.
const { DatabaseSync } = require('node:sqlite');
const crypto = require('node:crypto');
const { DEVICE, CLOCK } = require('./workload.cjs');
const { transitions, emptyState, normalizeState, clone, eventId, recordId,
  receiptFirstSequence, pruneResolvedConflict } = require('./compat-transitions.cjs');

function sqlite(file) {
  const db = new DatabaseSync(file);
  // Identical durability/cache/timeout settings to the archived prototype.
  try { db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
    PRAGMA cache_size=-8192; PRAGMA wal_autocheckpoint=256;
    CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY, body TEXT NOT NULL, kind TEXT, state TEXT, owner TEXT);
    CREATE INDEX IF NOT EXISTS records_filter ON records(kind,state,owner,id);
    CREATE TABLE IF NOT EXISTS events(event_id TEXT PRIMARY KEY, sequence INTEGER,
      uploaded INTEGER NOT NULL DEFAULT 0, acknowledged INTEGER NOT NULL DEFAULT 0,
      synced INTEGER NOT NULL DEFAULT 0, body TEXT, receipt TEXT);
    CREATE INDEX IF NOT EXISTS pending_events ON events(uploaded,sequence);`);
    if (db.prepare('PRAGMA table_info(events)').all().length !== 7) {
      throw Error('Archived prototype schema is unsupported; use a fresh synthetic SQLite file. No migration is performed.');
    }
  } catch (error) { db.close(); throw error; }
  const logic=transitions({clock:()=>CLOCK});
  let closed=false;
  function assertOpen(){if(closed)throw Error('SQLite store is closed');}
  function read() {
    assertOpen();
    // Full envelope is reconstructed from SQL, never another engine/cache.
    // One read transaction prevents mixed generations across SQL tables.
    const owned=!db.isTransaction;if(owned)db.exec('BEGIN');
    try {
      const row=db.prepare("SELECT value FROM meta WHERE key='envelope'").get();
      const state=normalizeState(row?JSON.parse(row.value):emptyState(DEVICE),DEVICE);
      state.records=Object.fromEntries(db.prepare('SELECT id,body FROM records ORDER BY rowid').all().map(r=>[r.id,JSON.parse(r.body)]));
      state.events=Object.fromEntries(db.prepare('SELECT event_id,receipt FROM events WHERE receipt IS NOT NULL ORDER BY rowid').all().map(r=>[r.event_id,JSON.parse(r.receipt)]));
      state.journal=db.prepare('SELECT body FROM events WHERE body IS NOT NULL ORDER BY sequence').all().map(r=>JSON.parse(r.body));
      if(owned)db.exec('COMMIT');return state;
    }catch(e){if(owned&&db.isTransaction)db.exec('ROLLBACK');throw e;}
  }
  function save(state) {
    // Small correctness prototype: replace rows atomically. No large-data
    // performance claim; historical benchmark measurements are not reused.
    db.exec('DELETE FROM records; DELETE FROM events');
    const put=db.prepare('INSERT INTO records VALUES(?,?,?,?,?)');
    for(const [id,record] of Object.entries(state.records))put.run(id,JSON.stringify(record),record.kind??null,record.state??null,record.owner??null);
    const journals=new Map(state.journal.map(e=>[e.eventId,e]));
    const ids=new Set([...Object.keys(state.events),...journals.keys(),...Object.keys(state.syncLedger.eventIds)]);
    const eventPut=db.prepare('INSERT INTO events VALUES(?,?,?,?,?,?,?)');
    for(const id of ids) {
      const e=journals.get(id);
      const seq=e?.localSequence??state.syncLedger.eventIds[id]??null;
      const compactedAck=Boolean(state.syncLedger.acknowledgedEventIds[id]) ||
        (seq!=null && seq<=state.syncLedger.acknowledgedThrough);
      eventPut.run(id,seq,Number(e?.uploaded??true),
        Number(e?.acknowledged??compactedAck),Number(e?.synced??true),
        e?JSON.stringify(e):null,state.events[id]?JSON.stringify(state.events[id]):null);
    }
    const {records,events,journal,...envelope}=state;
    db.prepare("INSERT INTO meta VALUES('envelope',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(envelope));
  }
  function transaction(fn) {
    assertOpen();db.exec('BEGIN IMMEDIATE');
    try {
      const state=read();const result=fn(state);save(state);db.exec('COMMIT');return result;
    }catch(e){if(db.isTransaction)db.exec('ROLLBACK');throw e;}
  }
  function operation(state,op,payload,apply) {
    logic.stampOperation(state,{op,payload});return apply(state,payload);
  }
  function prepare(item) {
    // Retained archived prototype input restriction used by the original
    // batch rollback regression. Direct underscore-field writes are outside
    // this seven-contract slice; no product schema/API change is implied.
    if(Object.keys(item?.patch||{}).some(k=>k.startsWith('_')))throw Error('Prototype accepts business fields only');
    return logic.resolvePatch(clone(item||{}));
  }
  function queuePatch(item={}) {
    const payload=prepare(item);
    return transaction(s=>operation(s,'patch',payload,logic.applyLocalPatch));
  }
  function queuePatches(items=[],{assertCurrent}={}) {
    const list=(Array.isArray(items)?items:[]).filter(i=>i&&recordId(i.id)).map(prepare);
    if(!list.length)return {count:0,results:[]};
    return transaction(s=>{
      if(assertCurrent)assertCurrent(clone(s));
      const results=list.map(p=>operation(s,'patch',p,logic.applyLocalPatch));
      return {count:results.filter(r=>!r.duplicate).length,results};
    });
  }
  function tombstone(item={}) {
    const payload=logic.resolvePatch(clone(item));
    return transaction(s=>operation(s,'tombstone',payload,logic.applyLocalTombstone));
  }
  function applyDelta(delta={}, {receiptOnly=false}={}) {
    delta=clone(delta);receiptFirstSequence(delta);
    const key=recordId(delta.id);if(!key)throw Error('Delta record id is required.');
    if(delta.sha256&&crypto.createHash('sha256').update(JSON.stringify({...delta,sha256:undefined})).digest('hex')!==String(delta.sha256))throw Error('Delta checksum doğrulanamadı.');
    logic.validateTransportClocks(delta);
    // resolvePatch computes the current owner policy, but local denial must
    // not reject a remote event: the remote transition records receipt-only.
    const owner=ownerOf(key,delta.userId);
    const payload={delta,receiptOnly,owner,eventId:eventId(delta.eventId)||crypto.createHash('sha256').update(JSON.stringify(delta)).digest('hex'),
      at:new Date().toISOString(),conflictIds:Array.from({length:Object.keys(delta.patch||delta.value||{}).length+1},()=>crypto.randomUUID())};
    return transaction(s=>operation(s,'delta',payload,logic.applyRemoteDelta));
  }
  let resolver=null;
  function ownerOf(id,user) {return String(id).startsWith('cp-order:')&&resolver?resolver(id,user):{allowed:true,known:false};}
  function setSharedOwnerResolver(fn) {resolver=typeof fn==='function'?fn:null;logic.setSharedOwnerResolver(resolver);}
  function mark(ids,apply) {
    const normalized=[...new Set(ids.map(eventId).filter(Boolean))];if(!normalized.length)return {marked:0};
    return transaction(s=>apply(s,{ids:normalized,at:new Date().toISOString()}));
  }
  function markAcknowledgedThrough(lastSequence) {
    const limit=Math.max(0,Number(lastSequence)||0);if(!limit)return {marked:0};
    return transaction(s=>logic.applyMarkAcknowledgedThrough(s,{lastSequence:limit,at:new Date().toISOString()}));
  }
  function resolveConflict(conflictId,choice='current',customValue) {
    return transaction(state=>{
      const id=eventId(conflictId),conflict=state.conflicts.find(c=>c.conflictId===id&&!c.resolved);
      if(!conflict)throw Error('Çakışma bulunamadı veya zaten çözüldü.');
      const incomingRevision=Number(state.events[conflict.eventId]?.revision)||0;
      const baseRevision=Math.max(Number(conflict.currentRevision)||0,incomingRevision);
      if(conflict.type==='field'&&(choice==='current'||choice==='incoming')) {
        const record=state.records[conflict.id];
        const kept=record&&Object.hasOwn(record,conflict.field)?record[conflict.field]:conflict.current;
        const value=choice==='incoming'?(customValue===undefined?conflict.incoming:customValue):(kept===undefined?null:clone(kept));
        operation(state,'patch',prepare({id:conflict.id,patch:{[conflict.field]:value},baseRevision,origin:'conflict-resolution'}),logic.applyLocalPatch);
      }else if(choice==='incoming'&&conflict.type==='delete') {
        operation(state,'tombstone',logic.resolvePatch({id:conflict.id,baseRevision:conflict.currentRevision,origin:'conflict-resolution'}),logic.applyLocalTombstone);
      }else if(choice!=='current'&&choice!=='incoming')throw Error('Çakışma seçimi geçersiz.');
      conflict.resolved=true;conflict.resolvedAt=new Date().toISOString();conflict.resolution=choice;pruneResolvedConflict(conflict);
      return clone(conflict);
    });
  }
  function compact() {
    const result=transaction(state=>{
      const journal=state.journal,keep=new Set(journal.map((e,i)=>e.uploaded?i:-1).filter(i=>i>=0).slice(-1000));
      const next=[],ledger=state.syncLedger;let count=0,first=0,last=0;
      for(let i=0;i<journal.length;i++) {
        const e=journal[i];if(!e.uploaded||keep.has(i)){next.push(e);continue;}
        const seq=Number(e.localSequence)||0;ledger.eventIds[e.eventId]=seq;delete state.events[e.eventId];count++;
        if(!first||(seq&&seq<first))first=seq;if(seq>last)last=seq;
      }
      if(count){ledger.compactedEvents+=count;ledger.compactedThrough=Math.max(ledger.compactedThrough,last);
        ledger.ranges.push({firstSequence:first,lastSequence:last,count,compactedAt:new Date().toISOString()});ledger.ranges=ledger.ranges.slice(-200);}
      state.journal=next;return {compacted:count,keepUploadedTail:1000};
    });
    db.exec('PRAGMA wal_checkpoint(TRUNCATE); VACUUM; PRAGMA wal_checkpoint(TRUNCATE)');return result;
  }
  return {
    db,read,ensure:read,initialize:()=>transaction(s=>{s.deviceId=DEVICE;}),queuePatch,queuePatches,tombstone,
    applyDelta,setSharedOwnerResolver,listConflicts:(limit=200)=>read().conflicts.filter(c=>!c.resolved).slice(0,Math.max(1,Number(limit)||200)),resolveConflict,
    pending:(limit=1000)=>read().journal.filter(e=>!e.uploaded).slice(0,Math.max(1,Number(limit)||1000)),
    pendingCount:()=>read().journal.filter(e=>!e.uploaded).length,
    unacknowledgedCount:()=>{const s=read();return s.journal.filter(e=>!e.acknowledged).length+logic.compactedPendingAckCount(s);},
    markSynced:(ids=[])=>mark(ids,logic.applyMarkSynced),markAcknowledged:(ids=[])=>mark(ids,logic.applyMarkAcknowledged),markAcknowledgedThrough,
    get:id=>read().records[id]||null,
    filter:q=>db.prepare('SELECT id,body FROM records WHERE kind=? AND state=? AND owner=? ORDER BY id LIMIT ?').all(q.kind,q.state,q.owner,q.limit).map(r=>({id:r.id,record:JSON.parse(r.body)})),
    records:()=>read().records,
    counts:()=>{const s=read();return {records:Object.keys(s.records).length,events:Object.keys(s.events).length,journal:s.journal.length,ledger:Object.keys(s.syncLedger.eventIds).length,sequence:s.localSequence};},
    eventIds:()=>{const s=read();return [...Object.keys(s.events),...Object.keys(s.syncLedger.eventIds)].sort();},compact,
    close:()=>{if(!closed){db.close();closed=true;}},
  };
}
module.exports={sqlite};
