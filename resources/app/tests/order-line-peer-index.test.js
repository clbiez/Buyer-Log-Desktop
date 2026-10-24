'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const moduleFile=path.join(__dirname,'../public/order-line-peer-index.js'),create=fs.existsSync(moduleFile)?require(moduleFile).create:()=>{throw Error('Canonical peer index API is missing');};
const source=fs.readFileSync(path.join(__dirname,'../public/app-main.js'),'utf8'),context={};vm.createContext(context);vm.runInContext(source.slice(source.indexOf('function turknorm('),source.indexOf('function lineIdentity(')),context);const keyOf=context.lineKeyOfRow;
const row=(id,code='001.234',model=' Kazak Ş ',colour=' Ç1 ' )=>({_id:id,'Order Code':code,'Model Name':model,'C.Code':colour});

test('canonical index matches all model/colour/partial peers with the existing exact normalized predicate',()=>{
 const index=create(keyOf),source=row(1),a=row(9,'1234','KAZAK S','C1'),b={...a,_id:10,_partialViewSourceId:9},otherModel=row(11,'1234','KAZAK B','C1'),otherColour=row(12,'1234','KAZAK S','C2'),empty=row(13,'');
 const rows=[a,b,otherModel,otherColour,empty,null];assert.deepEqual(index.peers(rows,keyOf(source),'buyer'),[a,b]);assert.deepEqual(index.peers(rows,'','buyer'),[]);
});

test('authoritative array replacement with reused display ids returns current objects only',()=>{
 const index=create(keyOf),old=row(1),first=[old];assert.deepEqual(index.peers(first,keyOf(old),'buyer'),[old]);
 const unrelated=row(1,'9999'),current=row(22),fresh=[unrelated,current];assert.deepEqual(index.peers(fresh,keyOf(old),'buyer'),[current]);assert.equal(index.peers(fresh,keyOf(old),'buyer').includes(old),false);
});

test('owner changes discard indexes even when a caller reuses the array reference',()=>{
 const index=create(keyOf),old=row(1),rows=[old];index.peers(rows,keyOf(old),'first');const current=row(1);rows[0]=current;
 assert.deepEqual(index.peers(rows,keyOf(current),'second'),[current]);assert.equal(index.peers(rows,keyOf(current),'second').includes(old),false);
});

test('explicit identity updates move a row between canonical buckets without a projection scan',()=>{
 let reads=0;const index=create(value=>{reads++;return keyOf(value);}),changed=row(1),rows=[changed,...Array.from({length:1000},(_,i)=>row(i+2,String(2000+i)))],before=keyOf(changed);
 index.peers(rows,before,'buyer');reads=0;changed['Model Name']='New Model';index.updateIdentity(rows,changed,'buyer');assert.deepEqual(index.peers(rows,before,'buyer'),[]);assert.deepEqual(index.peers(rows,keyOf(changed),'buyer'),[changed]);assert.ok(reads<5,'identity update must touch the changed row, not all peers');
});

test('warm lookups normalize matching candidates rather than every projection row',()=>{
 let reads=0;const index=create(value=>{reads++;return keyOf(value);}),rows=Array.from({length:1000},(_,i)=>row(i,String(2000+i))),key=keyOf(rows[450]);index.peers(rows,key,'buyer');reads=0;
 for(let i=0;i<100;i++)assert.deepEqual(index.peers(rows,key,'buyer'),[rows[450]]);assert.equal(reads,100);
});

test('membership length changes and explicit same-length invalidation rebuild safely; stale identity candidates never retarget',()=>{
 const index=create(keyOf),a=row(1),rows=[a],key=keyOf(a);index.peers(rows,key,'buyer');const b=row(2);rows.push(b);assert.deepEqual(index.peers(rows,key,'buyer'),[a,b]);
 const c=row(3);rows.splice(0,2,c);index.invalidate(rows);assert.deepEqual(index.peers(rows,key,'buyer'),[c]);
 c['C.Code']='C2';assert.deepEqual(index.peers(rows,key,'buyer'),[]);assert.deepEqual(index.peers(rows,keyOf(c),'buyer'),[c]);
});
