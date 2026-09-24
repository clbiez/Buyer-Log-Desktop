(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.BLOctopusJobs=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  /* ===================================================================
     OCTOPUS İŞ KUYRUĞU

     Bugüne kadar `ask()` tek uçuşluydu: `if(busy)return;`. Yani bir cevap
     beklenirken sorulan ikinci soru SESSİZCE DÜŞÜYORDU — kullanıcı yazıyor,
     gönderiyor, hiçbir şey olmuyor ve neden olmadığını da öğrenemiyor. Bu bir
     eksik özellik değil, bir kusurdu.

     NEDEN SERİ. Eşzamanlılık varsayılan olarak 1. Model bu makinede yerel
     çalışıyor ve tek GPU'yu paylaşıyor; iki isteği aynı anda koşturmak ikisini
     birden yavaşlatır, büyük modelde ise yükleme hatası verir (bkz. v9.27).
     Kuyruk paralellik için değil, KAYBETMEMEK için var: sıradaki soru
     bekletilir, düşürülmez.

     İŞ, KONUŞMASINI TAŞIR. Cevap, sorunun sorulduğu konuşmaya yazılır —
     kullanıcı beklerken başka bir konuşmaya geçse bile. Aktif konuşmaya
     yazmak, cevabı yanlış yere koymak olurdu.

     BİTEN İŞ HEMEN UNUTULMAZ: kısa bir geçmiş tutulur ki başarısız bir işin
     sebebi ekranda kalabilsin. Sınırsız değil — kapaksız bir liste uzun
     oturumda sessizce büyür.
     =================================================================== */

  const STATUS={QUEUED:'queued',RUNNING:'running',DONE:'done',FAILED:'failed',CANCELLED:'cancelled'};
  const DEFAULT_HISTORY=20;
  const ACTIVE=new Set([STATUS.QUEUED,STATUS.RUNNING]);

  function newId(){
    return 'job-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,7);
  }

  function createJobQueue(options){
    const opts=options||{};
    const run=typeof opts.run==='function'?opts.run:null;
    const concurrency=Number(opts.concurrency)>0?Math.trunc(Number(opts.concurrency)):1;
    const maxHistory=Number(opts.maxHistory)>0?Math.trunc(Number(opts.maxHistory)):DEFAULT_HISTORY;
    const now=typeof opts.now==='function'?opts.now:()=>new Date().toISOString();
    const onChange=typeof opts.onChange==='function'?opts.onChange:()=>{};
    const makeId=typeof opts.newId==='function'?opts.newId:newId;

    const jobs=[];
    let draining=false;

    function publicJob(job){
      return {
        id:job.id,question:job.question,conversationId:job.conversationId,
        status:job.status,at:job.at,startedAt:job.startedAt||null,endedAt:job.endedAt||null,
        error:job.error||null,
      };
    }

    function activeJobs(){ return jobs.filter(job=>ACTIVE.has(job.status)); }

    function changed(){
      /* Dinleyicinin hatası kuyruğu DURDURAMAZ: çizim başarısız olduğu için
         bir işin çalışmaması, hatayı kullanıcının işine yıkmak olurdu. */
      try{ onChange(stats()); }catch(_){}
    }

    /* Biten işler kırpılır; çalışan ve bekleyen ASLA kırpılmaz — kapağa
       çarptı diye bir işi listeden düşürmek onu görünmez yapardı. */
    function trim(){
      const finished=jobs.filter(job=>!ACTIVE.has(job.status));
      const excess=finished.length-maxHistory;
      for(let i=0;i<excess;i+=1){
        const index=jobs.indexOf(finished[i]);
        if(index>=0)jobs.splice(index,1);
      }
    }

    function stats(){
      const running=jobs.filter(job=>job.status===STATUS.RUNNING).length;
      const queued=jobs.filter(job=>job.status===STATUS.QUEUED).length;
      return {running,queued,active:running+queued,total:jobs.length};
    }

    async function execute(job){
      job.status=STATUS.RUNNING;
      job.startedAt=now();
      changed();
      try{
        const result=await run(job,{signal:job.controller?job.controller.signal:undefined});
        /* Koşarken iptal edilmiş olabilir. Sonucu yine de yazmak, kullanıcının
           "vazgeç" dediği bir cevabı ekrana koymak olurdu. */
        if(job.status===STATUS.CANCELLED)return;
        job.result=result;
        job.status=STATUS.DONE;
      }catch(error){
        if(job.status===STATUS.CANCELLED)return;
        job.status=STATUS.FAILED;
        job.error=error&&error.message?String(error.message):String(error||'bilinmeyen hata');
      }finally{
        job.endedAt=now();
        trim();
        changed();
      }
    }

    /* Tek boşaltıcı. İkinci bir çağrı boşa döner, yoksa aynı iş iki kez
       koşabilirdi. */
    async function drain(){
      if(draining)return;
      draining=true;
      try{
        for(;;){
          const running=jobs.filter(job=>job.status===STATUS.RUNNING).length;
          if(running>=concurrency)break;
          const next=jobs.find(job=>job.status===STATUS.QUEUED);
          if(!next)break;
          /* await BURADA: eşzamanlılık 1 olduğunda işler gerçekten sıra
             beklemeli. Beklemeden döngüye devam etmek hepsini aynı anda
             başlatırdı. */
          await execute(next);
        }
      }finally{
        draining=false;
        // Koşarken yeni iş eklendiyse döngü yeniden başlar.
        if(jobs.some(job=>job.status===STATUS.QUEUED)&&
           jobs.filter(job=>job.status===STATUS.RUNNING).length<concurrency)void drain();
      }
    }

    return {
      STATUS,

      enqueue(input){
        if(!run)throw new Error('İş kuyruğu bir çalıştırıcı olmadan kullanılamaz.');
        const job={
          id:makeId(),
          question:String(input&&input.question||''),
          conversationId:input&&input.conversationId!=null?String(input.conversationId):null,
          status:STATUS.QUEUED,at:now(),
          controller:typeof AbortController==='function'?new AbortController():null,
        };
        jobs.push(job);
        trim();
        changed();
        void drain();
        return publicJob(job);
      },

      /* Bekleyen iş hiç koşmaz; koşan işin sonucu yok sayılır ve isteği
         iptal edilir. İkisi de "vazgeçtim"in doğru karşılığı. */
      cancel(id){
        const job=jobs.find(item=>item.id===String(id));
        if(!job||!ACTIVE.has(job.status))return false;
        job.status=STATUS.CANCELLED;
        job.endedAt=now();
        if(job.controller){try{job.controller.abort();}catch(_){}}
        trim();
        changed();
        void drain();
        return true;
      },

      list(){ return jobs.slice().reverse().map(publicJob); },
      active(){ return activeJobs().map(publicJob); },
      get(id){ const job=jobs.find(item=>item.id===String(id)); return job?publicJob(job):null; },
      resultOf(id){ const job=jobs.find(item=>item.id===String(id)); return job?job.result:undefined; },
      stats,
      /* Testler ve kapanış için: bekleyen işlerin bitmesini bekler. */
      async idle(){ while(activeJobs().length){ await new Promise(resolve=>setTimeout(resolve,0)); } },
      clearFinished(){
        for(let i=jobs.length-1;i>=0;i-=1)if(!ACTIVE.has(jobs[i].status))jobs.splice(i,1);
        changed();
      },
    };
  }

  return {createJobQueue,STATUS,DEFAULT_HISTORY};
});
