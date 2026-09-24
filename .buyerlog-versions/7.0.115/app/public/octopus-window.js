(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.BLOctopusWindow=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  /* ===================================================================
     OCTOPUS PENCERESİ — GEOMETRİ

     Çekmece sabit kenara yapışıktı; pencere taşınabilir ve
     boyutlandırılabilir. Bunun bedeli, konumun artık HATIRLANMASI ve
     hatırlanan konumun bir daha GEÇERLİ OLMAYABİLMESİdir:

       · dizüstü dış ekrandan ayrılır, 2560 genişlik 1440'a düşer
       · pencere küçültülür, kayıtlı x ekranın dışında kalır
       · başka bir cihazda aynı hesap açılır

     Hepsinin sonucu aynı: pencere "açılıyor" ama görünmüyor ve kullanıcı
     Octopus'un bozulduğunu sanıyor. Bu yüzden kayıtlı geometri asla olduğu
     gibi uygulanmaz — HER ZAMAN mevcut görünüm alanına kırpılır.

     Kırpma kuralı "biraz görünsün" değil: başlık çubuğunun tamamı ve
     pencerenin anlamlı bir parçası içeride kalmak zorunda, çünkü pencere
     yalnız başlığından taşınabiliyor. Başlık dışarıda kalırsa pencere bir
     daha asla geri getirilemez.
     =================================================================== */

  const MIN_WIDTH=360;
  const MIN_HEIGHT=320;
  const DEFAULT_WIDTH=880;
  const DEFAULT_HEIGHT=620;
  /* Pencerenin görünür kalması gereken en küçük parçası. Başlık çubuğu
     yaklaşık 44 piksel; taşıyabilmek için tamamı erişilebilir olmalı. */
  const KEEP_VISIBLE=64;
  const EDGE_MARGIN=8;

  const SCHEMA=1;

  function num(value,fallback){
    const n=Number(value);
    return Number.isFinite(n)?n:fallback;
  }

  /* Varsayılan konum: sağ alt, kenardan boşluklu. Ekranın ortası, arkadaki
     tabloyu tam da bakılan yerden kapatıyordu. */
  function defaultGeometry(viewport){
    const view=normalizeViewport(viewport);
    const width=Math.min(DEFAULT_WIDTH,Math.max(MIN_WIDTH,view.width-EDGE_MARGIN*2));
    const height=Math.min(DEFAULT_HEIGHT,Math.max(MIN_HEIGHT,view.height-EDGE_MARGIN*2));
    return {
      x:Math.max(EDGE_MARGIN,view.width-width-EDGE_MARGIN*3),
      y:Math.max(EDGE_MARGIN,view.height-height-EDGE_MARGIN*3),
      width,height,minimized:false,
    };
  }

  function normalizeViewport(viewport){
    return {
      width:Math.max(MIN_WIDTH,num(viewport&&viewport.width,DEFAULT_WIDTH)),
      height:Math.max(MIN_HEIGHT,num(viewport&&viewport.height,DEFAULT_HEIGHT)),
    };
  }

  /* Her uygulamadan ÖNCE çağrılır: yükleme, taşıma, boyutlandırma ve pencere
     yeniden boyutlandığında. Tek kapı olması, "bir yolda kırpmayı unutmak"
     ihtimalini ortadan kaldırıyor. */
  function clampGeometry(geometry,viewport){
    const view=normalizeViewport(viewport);
    const base=geometry&&typeof geometry==='object'?geometry:{};

    // Boyut önce: konumun ne kadar kayabileceği boyuta bağlı.
    const width=Math.min(Math.max(num(base.width,DEFAULT_WIDTH),MIN_WIDTH),view.width);
    const height=Math.min(Math.max(num(base.height,DEFAULT_HEIGHT),MIN_HEIGHT),view.height);

    /* Sol/üst sınır NEGATİF olabilir (pencere kenardan biraz taşabilir) ama
       başlık çubuğu her zaman erişilebilir kalır. Üstte taşmaya hiç izin
       verilmez: başlık yukarı çıkarsa tutulacak yer kalmaz. */
    const maxX=view.width-KEEP_VISIBLE;
    const minX=KEEP_VISIBLE-width;
    const maxY=view.height-KEEP_VISIBLE;

    return {
      x:Math.round(Math.min(Math.max(num(base.x,0),minX),maxX)),
      y:Math.round(Math.min(Math.max(num(base.y,0),0),maxY)),
      width:Math.round(width),
      height:Math.round(height),
      minimized:Boolean(base.minimized),
    };
  }

  function safeStorage(storage){
    let memory=null;
    function usable(){
      if(!storage)return false;
      try{ storage.getItem('__octo_probe__'); return true; }catch(_){ return false; }
    }
    return {
      get(key){
        if(memory!==null)return memory;
        if(!usable())return null;
        try{ return storage.getItem(key); }catch(_){ return null; }
      },
      set(key,value){
        if(memory===null&&usable()){
          try{ storage.setItem(key,value); return true; }catch(_){}
        }
        memory=value;
        return false;
      },
    };
  }

  /* Geometri KULLANICIYA GÖRE ayrılır ama cihazda kalır: aynı hesabın
     dizüstü ve masaüstündeki pencere yeri aynı olmak zorunda değil — ekranlar
     farklı. Sunucuya taşımak, küçük ekranda açılan pencerenin büyük ekrandaki
     yerleşimi bozması demekti. */
  function createGeometryStore(options){
    const opts=options||{};
    const userId=String(opts.userId==null?'':opts.userId).trim();
    const store=safeStorage(opts.storage);
    const key='octopus:window:'+(userId||'-');
    const viewportOf=typeof opts.viewport==='function'?opts.viewport:()=>({width:DEFAULT_WIDTH,height:DEFAULT_HEIGHT});

    return {
      read(){
        const view=viewportOf();
        let parsed=null;
        try{
          const raw=store.get(key);
          const value=raw?JSON.parse(raw):null;
          if(value&&typeof value==='object'&&Number(value.schema)===SCHEMA) parsed=value;
        }catch(_){ parsed=null; }
        return clampGeometry(parsed||defaultGeometry(view),view);
      },
      write(geometry){
        const clamped=clampGeometry(geometry,viewportOf());
        store.set(key,JSON.stringify({schema:SCHEMA,...clamped}));
        return clamped;
      },
    };
  }

  return {
    clampGeometry,defaultGeometry,createGeometryStore,
    MIN_WIDTH,MIN_HEIGHT,DEFAULT_WIDTH,DEFAULT_HEIGHT,KEEP_VISIBLE,SCHEMA,
  };
});
