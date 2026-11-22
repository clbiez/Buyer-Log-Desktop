'use strict';
/* WS5 (#1078) alt PR 3: CP satır kaydı — alan bazlı karşılaştırmalı yazma (db.patchOrderOverrideRows).
   Global `_revisions.orders` sayacı yerine alanın düzenleme öncesi değeri karşılaştırılır:
   başka satır / aynı satırın başka alanı reddettirmez ve ezilmez; aynı alanda eski base
   çakışmadır. Çok süreçli test: gerçek dosya kilidi altında iki/dört Node süreci aynı belgeye
   yazar; kayıp güncelleme olmaz. Mevcut global revizyon testleri (final-phase, excel-import,
   delta-store) değişmeden geçer. */
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawn}=require('node:child_process');

const root=fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-cp-row-save-'));
const env={BUYER_LOG_SERVER_DATA_ROOT:path.join(root,'server-data'),BUYER_LOG_DATA_ROOT:path.join(root,'app-data'),
  BUYER_LOG_LOCAL_DATA_ROOT:path.join(root,'local-data'),BUYER_LOG_CONFIG_PATH:path.join(root,'config.json')};
Object.assign(process.env,env);
const db=require('../server/db');
test.after(()=>fs.rmSync(root,{recursive:true,force:true}));

const line=(orderCode,model='M1',ccode='C1')=>({orderCode,model,ccode});
const save=(items,actor={id:'u1',name:'User 1'})=>db.patchOrderOverrideRows(items,{actor});
const item=(orderCode,patch,base,model='M1',ccode='C1')=>({orderCode,patch:{model,ccode,...patch},base});

test('different rows never conflict through the global revision (R1); unchanged fields are not re-written (R3)',()=>{
  const a=save([item(5001,{delType:'Gemi'},{delType:''})]);
  assert.deepEqual(a.conflicts,[]);assert.equal(a.updated,1);
  // Başka bir yazma global sayacı ilerletir; satır kaydı bundan etkilenmez.
  db.patchOrderOverride(5002,{subManufacturer:'X'},a.revision);
  const b=save([item(5003,{delType:'Uçak'},{delType:''})]);
  assert.equal(b.updated,1);assert.deepEqual(b.conflicts,[]);
  // Aynı satır, farklı alan: kullanıcı A notu, kullanıcı B teslimat tipini (eski notla) yazar.
  save([item(5001,{notes:{Notes:'A notu',NotesHtml:''}},{notes:{Notes:'',NotesHtml:''}})],{id:'a',name:'A'});
  const merged=save([item(5001,{delType:'Kamyon',notes:{Notes:'',NotesHtml:''}},{delType:'Gemi',notes:{Notes:'',NotesHtml:''}})],{id:'b',name:'B'});
  assert.deepEqual(merged.conflicts,[]);
  const ov=db.loadOverrides(),key=db.overrideWriteKey(5001,line(5001));
  assert.equal(ov.delmap[key],'Kamyon');
  assert.equal(ov.notesmap[key].Notes,'A notu','B notu değiştirmedi: A notu ezilmedi');
  assert.equal(ov.notesmap[key].NotesBy,'a','yazar damgası korunur');
});

test('same field with a stale base is a row conflict with the current values; nothing of that row is written',()=>{
  save([item(5101,{delType:'Gemi'},{delType:''})]);
  const stale=save([item(5101,{delType:'Uçak',licensor:'DTR'},{delType:'',licensor:''})]);
  assert.equal(stale.updated,0);assert.equal(stale.conflicts.length,1);
  assert.deepEqual(stale.conflicts[0].fields,['delType']);
  assert.equal(stale.conflicts[0].current.delType,'Gemi');
  const key=db.overrideWriteKey(5101,line(5101)),ov=db.loadOverrides();
  assert.equal(ov.delmap[key],'Gemi');assert.equal(ov.licensormap[key],undefined,'satır atomik: diğer alan da yazılmadı');
  // Aynı değere eşzamanlı yazma (idempotent) çakışma değildir.
  const same=save([item(5101,{delType:'Gemi'},{delType:''})]);
  assert.deepEqual(same.conflicts,[]);assert.equal(same.applied[0].noop,true);
  // Kısmi başarı: aynı istekte bir satır çakışır, diğeri yazılır.
  const partial=save([item(5101,{delType:'Tren'},{delType:'Uçak'}),item(5102,{delType:'Tren'},{delType:''})]);
  assert.equal(partial.conflicts.length,1);assert.equal(partial.applied.length,1);assert.equal(partial.applied[0].orderCode,5102);
});

test('dates per subfield (set / clear), note columns per id, order-level seed is the stored base',()=>{
  const r1=save([item(5201,{dates:{exFactory:'2026-12-01'}},{dates:{exFactory:null}})]);
  assert.equal(r1.updated,1);
  // Başka alt alan (retail) eski exFactory base'iyle yazılabilir; exFactory'ye dokunmaz.
  const r2=save([item(5201,{dates:{retailDate:'2027-01-05',exFactory:null}},{dates:{retailDate:null,exFactory:null}})]);
  assert.deepEqual(r2.conflicts,[]);
  const key=db.overrideWriteKey(5201,line(5201));
  assert.deepEqual(db.loadOverrides().datemap[key],{ex:'2026-12-01',retail:'2027-01-05'});
  // Revizyonu kaldırma (null) doğru base ile.
  save([item(5201,{dates:{exFactory:null}},{dates:{exFactory:'2026-12-01'}})]);
  assert.deepEqual(db.loadOverrides().datemap[key],{retail:'2027-01-05'});
  // Sipariş düzeyindeki eski kayıt satırın kayıtlı değeridir (okuma tarafıyla aynı tohum).
  db.patchOrderOverride(5202,{delType:'Gemi'});
  const seeded=save([item(5202,{delType:'Uçak'},{delType:''})]);
  assert.equal(seeded.conflicts.length,1,'sipariş düzeyi kayıt base olarak görülür');
  assert.equal(save([item(5202,{delType:'Uçak'},{delType:'Gemi'})]).updated,1);
});

test('an all no-op save (value already stored by another writer) still returns the stored current values',()=>{
  save([item(5401,{delType:'Uçak',notes:{Notes:'ortak',NotesHtml:''}},{delType:'',notes:{Notes:'',NotesHtml:''}})]);
  const before=db.loadOverrides()._revisions.orders;
  // İkinci yazar aynı değerleri (başka base ile) ister: hiçbir şey yazılmaz.
  const out=save([item(5401,{delType:'Uçak'},{delType:'Gemi'})]);
  assert.equal(out.updated,0);assert.equal(out.applied.length,1);assert.equal(out.applied[0].noop,true);
  assert.equal(db.loadOverrides()._revisions.orders,before,'yazma yok, revizyon ilerlemez');
  assert.ok(out.applied[0].current,'no-op onayı da kayıtlı değerleri döner (istemci bekleyen düzenlemenin base\'ini buna taşır)');
  assert.equal(out.applied[0].current.delType,'Uçak');assert.equal(out.applied[0].current.notes.Notes,'ortak');
});

test('notes keep server-side authorship; HTML stays paired with its text',()=>{
  const r=save([item(5301,{notes:{Notes:'metin',NotesHtml:'<b>metin</b>',EkNot:'',EkNotHtml:''}},{notes:{Notes:'',NotesHtml:'',EkNot:'',EkNotHtml:''}})],{id:'n1',name:'Not Yazarı'});
  assert.equal(r.updated,1);
  const rec=db.loadOverrides().notesmap[db.overrideWriteKey(5301,line(5301))];
  assert.equal(rec.Notes,'metin');assert.equal(rec.NotesHtml,'<b>metin</b>');assert.equal(rec.NotesBy,'n1');assert.ok(rec.NotesAt);
  assert.equal(r.applied[0].current.notes.Notes,'metin');
});

/* Kayıp güncelleme yok: N süreç aynı satırın aynı alanına okuma→karşılaştırmalı yazma döngüsüyle
   K ekleme yapar (çakışmada yeniden okur). Son metin tam N×K ek içerir. Ayrıca her süreç kendi
   satırına ve aynı satırın kendi not sütununa yazar: hepsi kalır. */
test('multi-process: no lost update under real file leases (same field CAS loop, own rows, same-row other fields)',{timeout:180000},async()=>{
  const PROCS=4,ITER=12,code=6000;
  db.replaceNoteColumnDefs([{id:'nc_a',label:'A'},{id:'nc_b',label:'B'},{id:'nc_c',label:'C'},{id:'nc_d',label:'D'}]);
  const defs=db.loadOverrides().noteColumnDefs||[];assert.equal(defs.length,PROCS);
  const script=`
    const db=require(${JSON.stringify(path.join(__dirname,'..','server','db'))});
    const [me,iter,code,colId]=process.argv.slice(1);const base={model:'M1',ccode:'C1'};
    const key=db.overrideWriteKey(+code,base);let conflicts=0,busy=0;
    // SHARED_WRITE_BUSY (409) ürün sözleşmesinde "yeniden dene" demektir: yavaş CI diskinde
    // 4 süreçli yarışta kilit beklemesi 3 sn'yi aşabilir. Yeniden deneme kayıp güncelleme
    // denetimini gevşetmez; yalnız beklenen meşgul yanıtını sözleşmeye uygun karşılar.
    const patch=(rows,opts)=>{for(;;){try{return db.patchOrderOverrideRows(rows,opts);}catch(error){if(!error||error.code!=='SHARED_WRITE_BUSY'||error.recoveryRequired||++busy>200)throw error;}}};
    for(let i=0;i<+iter;i++){
      for(;;){
        const cur=(db.loadOverrides().notesmap||{})[key]||{};const text=cur.Notes||'';
        const out=patch([{orderCode:+code,patch:{...base,notes:{Notes:text+me,NotesHtml:''}},base:{notes:{Notes:text,NotesHtml:''}}}],{actor:{id:me,name:me}});
        if(out.updated===1)break;conflicts++;
      }
      patch([{orderCode:+code+1+(+process.argv[5]),patch:{...base,delType:'D'+i},base:{delType:i?'D'+(i-1):''}}],{actor:{id:me,name:me}});
    }
    if(colId)patch([{orderCode:+code,patch:{...base,noteColumns:{[colId]:'v-'+me}},base:{noteColumns:{[colId]:''}}}],{actor:{id:me,name:me}});
    process.stdout.write(JSON.stringify({conflicts}));`;
  const run=index=>new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,['-e',script,String.fromCharCode(97+index),String(ITER),String(code),defs[index]?defs[index].id:'',String(index)],{env:{...process.env,...env},stdio:['ignore','pipe','pipe']});
    let out='',err='';child.stdout.on('data',d=>out+=d);child.stderr.on('data',d=>err+=d);
    child.on('exit',status=>status===0?resolve(JSON.parse(out)):reject(new Error(`child ${index} exited ${status}: ${err.slice(-2000)}`)));
  });
  const results=await Promise.all(Array.from({length:PROCS},(_,i)=>run(i)));
  const ov=db.loadOverrides(),key=db.overrideWriteKey(code,line(code));
  const text=ov.notesmap[key].Notes;
  assert.equal(text.length,PROCS*ITER,`kayıp ek yok (${text.length}/${PROCS*ITER}; çakışmalar ${results.map(r=>r.conflicts).join(',')})`);
  for(let i=0;i<PROCS;i++)assert.equal(text.split(String.fromCharCode(97+i)).length-1,ITER);
  for(let i=0;i<PROCS;i++)assert.equal(ov.delmap[db.overrideWriteKey(code+1+i,line(code+1+i))],'D'+(ITER-1),`süreç ${i} kendi satırı`);
  for(let i=0;i<PROCS;i++)assert.equal(ov.noteColumnValues[key][defs[i].id],'v-'+String.fromCharCode(97+i),'aynı satırın farklı not sütunları hepsi kalır');
  assert.ok(results.some(r=>r.conflicts>0),'yarış gerçekten oluştu (en az bir çakışma yeniden denendi)');
});
