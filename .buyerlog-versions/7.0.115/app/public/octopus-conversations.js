(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.BLOctopusConversations=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  /* ===================================================================
     OCTOPUS — KONUŞMA DEPOSU

     Bugüne kadar sohbet bağlamı bellekte tek bir diziydi (son 12 mesaj) ve
     panel kapanınca kayboluyordu. Kullanıcı "dün sorduğum şeyi" bulamıyor,
     yarım kalan bir analize geri dönemiyordu.

     NEDEN CİHAZDA, SUNUCUDA DEĞİL
     Konuşmalar iş verisi İÇERİR (sipariş kodu, üretici, fiyat) ama iş
     verisinin KENDİSİ değildir — kaynak her zaman override store'u ve
     sipariş verisidir. Sunucuya taşımak yeni bir store, revizyon yönetimi,
     senkron ve yedekleme yüzeyi açardı; taşıdığı bilgi ise zaten başka bir
     yerde duruyor. Cihazda tutmak ayrıca konuşmaların cihazlar arasında
     dolaşmamasını sağlar.

     KULLANICIYA GÖRE AYRILIR. Anahtar kullanıcı kimliğini taşır; aynı
     bilgisayarda kullanıcı değiştiğinde bir öncekinin konuşmaları görünmez.
     Kimlik yoksa konuşma YAZILMAZ — anonim bir kovaya yazmak, bir sonraki
     kullanıcıya sızdırmak olurdu.

     SINIRLAR GERÇEK. localStorage ~5 MB ve dolduğunda YAZMA HATA VERİR;
     sessizce büyüyen bir depo, bir gün panelin hiçbir şey kaydedememesi
     demektir. Bu yüzden üç kapak var: konuşma sayısı, konuşma başına mesaj
     ve toplam bayt. Kapağa çarpınca EN ESKİ konuşma düşer.
     =================================================================== */

  const MAX_CONVERSATIONS=30;
  const MAX_MESSAGES=120;
  /* ~600 KB: localStorage kotasının küçük bir dilimi. Octopus, uygulamanın
     depolama bütçesinin tamamını tek başına harcayamaz. */
  const MAX_BYTES=600*1024;
  const MODEL_HISTORY=12;     // modele giden bağlam (eski davranışla aynı)
  const TITLE_LIMIT=52;

  const SCHEMA=1;

  function clampText(value,limit){
    const text=String(value==null?'':value).replace(/\s+/g,' ').trim();
    return text.length>limit?text.slice(0,limit-1).trimEnd()+'…':text;
  }

  /* Başlık İLK KULLANICI MESAJINDAN türer ve bir daha değişmez. Her mesajda
     yeniden hesaplansaydı liste kullanıcının altında kayardı; bir konuşmayı
     gözle takip edebilmek için adının sabit kalması gerekir. */
  function titleFrom(messages){
    const first=(messages||[]).find(item=>item&&item.role==='user');
    return first?clampText(first.content,TITLE_LIMIT):'';
  }

  function newId(){
    return 'oc-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8);
  }

  /* Bozuk ya da eski şemalı veri ATILIR, onarılmaya çalışılmaz: yarı okunmuş
     bir konuşma listesini kullanıcıya göstermek, hiç göstermemekten kötüdür
     ve hangi mesajın kaybolduğunu kimse bilemez. */
  function parseState(raw){
    if(!raw)return null;
    try{
      const parsed=JSON.parse(raw);
      if(!parsed||typeof parsed!=='object')return null;
      if(Number(parsed.schema)!==SCHEMA)return null;
      if(!Array.isArray(parsed.items))return null;
      return {
        schema:SCHEMA,
        activeId:parsed.activeId==null?null:String(parsed.activeId),
        items:parsed.items.filter(item=>item&&typeof item==='object'&&item.id).map(item=>({
          id:String(item.id),
          title:String(item.title||''),
          createdAt:String(item.createdAt||''),
          updatedAt:String(item.updatedAt||''),
          messages:(Array.isArray(item.messages)?item.messages:[])
            .filter(msg=>msg&&(msg.role==='user'||msg.role==='assistant'))
            .map(msg=>({role:msg.role,content:String(msg.content==null?'':msg.content),at:String(msg.at||'')})),
        })),
      };
    }catch(_){return null;}
  }

  /* Depolama HER ZAMAN patlayabilir: gizli sekme, kota, kapatılmış site
     verisi. Erişimin kendisi bile fırlatır. Bu yüzden her çağrı sarılır ve
     başarısızlıkta bellek içi bir yedeğe düşülür — panel çalışmaya devam
     eder, yalnız hatırlamaz. */
  function safeStorage(storage){
    let memory=null;
    function usable(){
      if(!storage)return false;
      try{ storage.getItem('__octo_probe__'); return true; }catch(_){ return false; }
    }
    return {
      get(key){
        if(memory)return memory;
        if(!usable())return null;
        try{ return storage.getItem(key); }catch(_){ return null; }
      },
      set(key,value){
        if(!memory&&usable()){
          try{ storage.setItem(key,value); return true; }catch(_){ /* kota — belleğe düş */ }
        }
        memory=value;
        return false;
      },
      remove(key){
        memory=null;
        if(!usable())return;
        try{ storage.removeItem(key); }catch(_){}
      },
      get degraded(){ return memory!==null; },
    };
  }

  function createConversationStore(options){
    const opts=options||{};
    const userId=String(opts.userId==null?'':opts.userId).trim();
    const now=typeof opts.now==='function'?opts.now:()=>new Date().toISOString();
    const store=safeStorage(opts.storage);
    const key='octopus:conversations:'+(userId||'-');
    const limits={
      conversations:Number(opts.maxConversations)>0?Number(opts.maxConversations):MAX_CONVERSATIONS,
      messages:Number(opts.maxMessages)>0?Number(opts.maxMessages):MAX_MESSAGES,
      bytes:Number(opts.maxBytes)>0?Number(opts.maxBytes):MAX_BYTES,
    };

    /* Kimliksiz oturumda hiçbir şey YAZILMAZ. Panel yine çalışır; tek fark,
       konuşmanın kalıcı olmamasıdır. Anonim bir kovaya yazmak, bir sonraki
       kullanıcıya sızdırmak demekti. */
    const persistent=Boolean(userId);

    let state=persistent?(parseState(store.get(key))||emptyState()):emptyState();

    function emptyState(){ return {schema:SCHEMA,activeId:null,items:[]}; }

    function byNewest(){
      return state.items.slice().sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)));
    }

    /* Kapaklar YAZMADAN ÖNCE uygulanır. Sonra uygulamak, kotayı zaten aşmış
       bir yazmayı denemek demekti. */
    function enforce(){
      state.items.forEach(item=>{
        if(item.messages.length>limits.messages) item.messages=item.messages.slice(-limits.messages);
      });
      if(state.items.length>limits.conversations){
        const keep=new Set(byNewest().slice(0,limits.conversations).map(item=>item.id));
        state.items=state.items.filter(item=>keep.has(item.id));
      }
      // Bayt kapağı: en eskiden başlayarak düşür.
      let guard=state.items.length;
      while(guard-- > 0 && JSON.stringify(state).length>limits.bytes && state.items.length>1){
        const oldest=byNewest()[state.items.length-1];
        state.items=state.items.filter(item=>item.id!==oldest.id);
      }
      if(state.activeId&&!state.items.some(item=>item.id===state.activeId)) state.activeId=null;
    }

    function persist(){
      if(!persistent)return false;
      enforce();
      return store.set(key,JSON.stringify(state));
    }

    function find(id){ return state.items.find(item=>item.id===String(id))||null; }

    function summary(item){
      return {
        id:item.id,
        title:item.title||'',
        createdAt:item.createdAt,
        updatedAt:item.updatedAt,
        messageCount:item.messages.length,
        active:item.id===state.activeId,
      };
    }

    return {
      get persistent(){ return persistent; },
      get degraded(){ return store.degraded; },
      limits,

      list(){ return byNewest().map(summary); },

      get(id){ const item=find(id); return item?JSON.parse(JSON.stringify(item)):null; },

      /* Aktif konuşma. Panel her açıldığında yenisini yaratmaz — "kaldığın
         yerden devam" davranışı budur; yeni konuşma AÇIK bir eylemdir. */
      active(){
        const existing=find(state.activeId);
        if(existing)return summary(existing);
        const newest=byNewest()[0];
        if(newest){ state.activeId=newest.id; persist(); return summary(newest); }
        return this.create();
      },

      /* BOŞ konuşma tekrar tekrar üretilmez: kullanıcı "Yeni konuşma"ya üst
         üste basınca liste boş kabuklarla dolardı. */
      create(){
        const current=find(state.activeId);
        if(current&&!current.messages.length){ return summary(current); }
        const at=now();
        const item={id:newId(),title:'',createdAt:at,updatedAt:at,messages:[]};
        state.items.push(item);
        state.activeId=item.id;
        persist();
        return summary(item);
      },

      setActive(id){
        const item=find(id);
        if(!item)return null;
        state.activeId=item.id;
        persist();
        return summary(item);
      },

      append(id,message){
        const item=find(id);
        if(!item)return null;
        const role=message&&message.role==='assistant'?'assistant':'user';
        item.messages.push({role,content:String(message&&message.content||''),at:now()});
        if(!item.title) item.title=titleFrom(item.messages);
        item.updatedAt=now();
        persist();
        return summary(item);
      },

      /* Modele giden bağlam. Eski davranışla aynı pencere (son 12) ve aynı
         biçim; kalıcılık modelin gördüğü şeyi DEĞİŞTİRMEZ. */
      history(id,limit){
        const item=find(id);
        if(!item)return [];
        const size=Number(limit)>0?Number(limit):MODEL_HISTORY;
        return item.messages.slice(-size).map(msg=>({role:msg.role,content:msg.content}));
      },

      remove(id){
        const before=state.items.length;
        state.items=state.items.filter(item=>item.id!==String(id));
        if(state.activeId===String(id)) state.activeId=null;
        persist();
        return state.items.length<before;
      },

      clear(){
        state=emptyState();
        if(persistent) store.remove(key);
        return true;
      },
    };
  }

  return {createConversationStore,titleFrom,MAX_CONVERSATIONS,MAX_MESSAGES,MAX_BYTES,MODEL_HISTORY,SCHEMA};
});
