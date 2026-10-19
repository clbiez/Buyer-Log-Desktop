'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const parse = require(path.join(ROOT, 'server', 'lib', 'parse.js'));
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const DB = fs.readFileSync(path.join(ROOT, 'server', 'db.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'public', 'app.css'), 'utf8');

function asasOrder(extra={}){
  return {
    ocode:1234567, model:'MODEL-A', ccode:'BLK', colour:'SIYAH', season:'S7', countryRaw:'INDIA',
    manufacturer:'MFR', license:'MINECRAFT', category:'TOP', qty:100, kalan:100, fob:1.2,
    opd:new Date(2026,7,1), ex:new Date(2026,8,1), retail:new Date(2026,9,1), mb:new Date(2026,9,1),
    merkezSevkeHazirKalan:0, ...extra,
  };
}
function overrides(extra={}){
  return {notesmap:{},submap:{},suppfobmap:{},suppfobmetamap:{},delmap:{},licensormap:{},datemap:{},pricingRules:[],transitRules:[],...extra};
}

test('v5.11 CP rows carry persisted Notes / Additional Notes timestamps for Overview',()=>{
  const key=parse.orderLineKey(1234567,'MODEL-A','BLK');
  const [row]=parse.buildCPRowsFromASAS([asasOrder()],{},overrides({notesmap:{[key]:{
    Notes:'Kapasite kontrolü',NotesAt:'2026-08-07T10:20:30.000Z',EkNot:'Ek takip',EkNotAt:'2026-08-08T10:20:30.000Z'
  }}}));
  assert.equal(row.Notes,'Kapasite kontrolü');
  assert.equal(row._notesAt,'2026-08-07T10:20:30.000Z');
  assert.equal(row._ekNotAt,'2026-08-08T10:20:30.000Z');
});

/* v7.29'da GÜNCELLENDİ (silinmedi). Bu test not damgalamayı KAYNAK METNİNDE
   arıyordu: stampNoteField('Notes', 'NotesAt') gibi birebir çağrı biçimleri.
   v7.29 not YAZARINI da eklediği için imza değişti ve düzenli ifadeler tutmaz
   oldu. Testin asıl amacı aynı: not değiştiğinde zaman damgası atılmalı,
   silindiğinde temizlenmeli, değişmediğinde dokunulmamalı. Metin eşleştirmesi
   yerine GERÇEK DAVRANIŞ sınanıyor — kaynak biçimine değil sonuca baktığı için
   daha güçlü bir kontrol. */
test('v5.11 order override writes stamp note changes and clear the timestamp when note is removed',()=>{
  const root=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'bl-notes-v511-'));
  const previous={server:process.env.BUYER_LOG_SERVER_DATA_ROOT,app:process.env.BUYER_LOG_DATA_ROOT,local:process.env.BUYER_LOG_LOCAL_DATA_ROOT,config:process.env.BUYER_LOG_CONFIG_PATH};
  process.env.BUYER_LOG_SERVER_DATA_ROOT=path.join(root,'server-data');
  process.env.BUYER_LOG_DATA_ROOT=path.join(root,'app-data');
  process.env.BUYER_LOG_LOCAL_DATA_ROOT=path.join(root,'local-data');
  process.env.BUYER_LOG_CONFIG_PATH=path.join(root,'config.json');
  const dbPath=require.resolve(path.join(ROOT,'server','db.js'));
  delete require.cache[dbPath];
  const db=require(dbPath);
  try{
    db.patchOrderOverride(1234567,{notes:{Notes:'Kapasite kontrolü',EkNot:''}});
    const afterWrite=db.loadOverrides().notesmap[1234567];
    assert.equal(afterWrite.Notes,'Kapasite kontrolü');
    assert.ok(Date.parse(afterWrite.NotesAt)>0,'not yazılınca zaman damgası atılmalı');
    assert.equal(afterWrite.EkNotAt||'','','boş not zaman damgası almaz');

    // Değişmeyen not yeniden damgalanmaz: aksi hâlde her kayıtta "yeni not"
    // gibi görünür ve Genel Bakış sıralaması bozulurdu.
    const stamp=afterWrite.NotesAt;
    db.patchOrderOverride(1234567,{notes:{Notes:'Kapasite kontrolü'}});
    assert.equal(db.loadOverrides().notesmap[1234567].NotesAt,stamp);

    db.patchOrderOverride(1234567,{notes:{Notes:''}});
    const afterClear=db.loadOverrides().notesmap[1234567];
    assert.equal(afterClear.Notes,'');
    assert.equal(afterClear.NotesAt,'','not silinince zaman damgası temizlenmeli');
  } finally {
    delete require.cache[dbPath];
    for(const [key,value] of [['BUYER_LOG_SERVER_DATA_ROOT',previous.server],['BUYER_LOG_DATA_ROOT',previous.app],['BUYER_LOG_LOCAL_DATA_ROOT',previous.local],['BUYER_LOG_CONFIG_PATH',previous.config]]){
      if(value==null)delete process.env[key];else process.env[key]=value;
    }
    fs.rmSync(root,{recursive:true,force:true});
  }
});

test('v5.11 Notes Reminder renders note text followed by a four-digit registration date',()=>{
  assert.match(APP,/function overviewNoteDateText\(timestamp\)/);
  assert.match(APP,/\$\{pad\(d\.getDate\(\)\)\}\.\$\{pad\(d\.getMonth\(\)\+1\)\}\.\$\{d\.getFullYear\(\)\}/);
  assert.match(APP,/class="ovNoteDate">- \$\{escapeHtml\(noteDate\)\}/);
  assert.match(CSS,/\.ovNoteDate\{/);
});

test('v5.11 legacy notes without timestamp are not assigned a fake historical date',()=>{
  const key=parse.orderLineKey(1234567,'MODEL-A','BLK');
  const [row]=parse.buildCPRowsFromASAS([asasOrder()],{},overrides({notesmap:{[key]:{Notes:'Eski not'}}}));
  assert.equal(row.Notes,'Eski not');
  assert.equal(row._notesAt,'');
});

// PR #604 removed inline order summaries. The same per-order deletion must
// remain available through the note-count side report, including its stale-note guard.
test('Overview note count opens order details and preserves guarded per-order note deletion',async()=>{
  const vm=require('node:vm'),current={_id:42,Notes:'Follow up'},deleted=[];let detail;
  const context=vm.createContext({appLang:'en',state:{cp:{rows:[current]}},
    window:{BLPerf:{ensureFeature:async()=>{}},BLCpAssistant:{openOverviewRows:(rows,title,options)=>{detail={rows,title,options};}}},
    sameOrderLine:(a,b)=>a._id===b._id,overviewOrderNoteText:row=>row.Notes,
    overviewNoteCanonical:value=>String(value||'').trim(),clearOverviewNoteOrder:row=>{deleted.push(row);return true;}});
  const start=APP.indexOf('async function openOverviewNoteGroupInCp('),end=APP.indexOf('function renderOverviewPriorityReminder(',start);
  vm.runInContext(APP.slice(start,end),context);
  await context.openOverviewNoteGroupInCp({rows:[{_id:42}],note:'Follow up'});
  assert.equal(detail.title,'Notes · Order details');assert.equal(detail.options.notes,true);assert.equal(detail.options.note,'Follow up');
  assert.equal(detail.options.deleteNote({_id:42}),true);assert.deepEqual(deleted,[current]);
  current.Notes='Newer note';assert.equal(detail.options.deleteNote({_id:42}),false);assert.equal(deleted.length,1);
  assert.equal(detail.options.deleteNote({_id:999}),false);
  const render=APP.slice(end,APP.indexOf('function ',end+20));
  assert.match(render,/data-note-group-count/);assert.match(render,/openOverviewNoteGroupInCp\(groups/);
  assert.doesNotMatch(render,/class="ovNoteOrderOpen"|class="noteCellDelete ovNoteOrderDelete"/);
  assert.match(APP,/clearRowNote\(Number\(row\._id\),key\)/);
});
