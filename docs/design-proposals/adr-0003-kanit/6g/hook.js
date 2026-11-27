'use strict';
/* Ölçüm/arıza enjeksiyonu kancası (repo dışı; NODE_OPTIONS=-r ile). Ürün kodunu değiştirmez.
   HOOK_CTL: denetim JSON dosyası {clockOffsetMs, recordThrow, settleCorrupt, settleFail}
   HOOK_LOG: satır satır JSON günlük (havuz tahmini / işçi heap ölçümü / enjeksiyonlar). */
const fs=require('fs'),Module=require('module'),wt=require('worker_threads');
const CTL=process.env.HOOK_CTL,LOG=process.env.HOOK_LOG;
let ctl={};const readCtl=()=>{try{ctl=JSON.parse(fs.readFileSync(CTL,'utf8'));}catch(_){}};readCtl();
setInterval(readCtl,200).unref();
const log=o=>{if(LOG)try{fs.appendFileSync(LOG,JSON.stringify({t:Date.now(),th:wt.threadId,...o})+'\n');}catch(_){}};
// Saat: aynı yapıcı üstünde kaydırma (barındırıcılar kurulmadan önce yerleşir).
const RealDate=Date,realNow=RealDate.now;
class ShiftedDate extends RealDate{constructor(...a){if(a.length)super(...a);else super(realNow()+(Number(ctl.clockOffsetMs)||0));}static now(){return realNow()+(Number(ctl.clockOffsetMs)||0);}}
global.Date=ShiftedDate;
// Havuz: her işin bellek tahmini ve işçinin bildirdiği gerçek heap (retainedBytes = heapUsed + arrayBuffers).
if(wt.isMainThread){
  const Real=wt.Worker;
  wt.Worker=class extends Real{constructor(file,opts){super(file,opts);this.__file=String(file);this.on('message',m=>{if(m&&m.type==='result'&&/read-model-worker/.test(this.__file))log({ev:'result',id:m.id,ok:m.ok,code:m.error&&m.error.code,retainedBytes:m.metrics&&m.metrics.retainedBytes,outputBytes:m.metrics&&m.metrics.outputBytes,ms:m.metrics&&Math.round(m.metrics.executionMs)});});}
    postMessage(m,t){if(m&&m.type==='run'&&/read-model-worker/.test(this.__file)){const p=m.payload||{};log({ev:'run',id:m.id,task:m.task,warmOnly:Boolean(p.warmOnly),buffer:Boolean(p.dataset&&p.dataset.buffer),virtual:Boolean(p.dataset&&p.dataset.virtual),inputBytes:p.dataset&&p.dataset.buffer?p.dataset.buffer.byteLength:0});}return super.postMessage(m,t);}};
}
const origLoad=Module._load;
Module._load=function(request,parent,isMain){
  const out=origLoad.apply(this,arguments);
  if(/read-model-pool$/.test(request)&&out&&out.getReadModelPool&&!out.__hooked){
    const get=out.getReadModelPool;out.__hooked=true;
    out.getReadModelPool=()=>{const pool=get();if(!pool.__hooked){pool.__hooked=true;const run=pool.run.bind(pool);
      pool.run=(task,payload,options={})=>{const s=pool.stats();log({ev:'estimate',task,estimatedBytes:options.estimatedBytes,inputBytes:options.inputBytes||0,budget:s.memoryBudgetBytes,retainedWorkerBytes:s.retainedWorkerBytes,reserved:s.reservedBytes,workers:s.workerCount});
        return run(task,payload,options).catch(e=>{log({ev:'reject',task,code:e&&e.code});throw e;});};}return pool;};
  }
  if(/cp-row-patch-log$/.test(request)&&out&&out.createCpRowPatchLog&&!out.__hooked){
    const create=out.createCpRowPatchLog;out.__hooked=true;
    out.createCpRowPatchLog=(...a)=>{const logx=create(...a);const record=logx.record,settle=logx.settle;
      logx.record=args=>{if(ctl.recordThrow){log({ev:'inject',what:'recordThrow'});throw Error('injected record failure');}const e=record(args);log({ev:'record',ok:Boolean(e),items:args&&args.items&&args.items.length});return e;};
      logx.settle=(entry,res)=>{if(res&&res.ok&&ctl.settleCorrupt&&typeof res.rowsJson==='string'){const rows=JSON.parse(res.rowsJson);if(rows[0]){rows[0]['Supp. FOB']=Number(rows[0]['Supp. FOB']||0)+0.01;}log({ev:'inject',what:'settleCorrupt'});res={...res,rowsJson:JSON.stringify(rows)};}
        if(res&&ctl.settleFail){log({ev:'inject',what:'settleFail'});res={ok:false};}log({ev:'settle',ok:Boolean(res&&res.ok)});return settle(entry,res);};
      return logx;};
  }
  return out;
};
