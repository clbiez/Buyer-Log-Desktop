(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.BLCopilotActions=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  /* ===================================================================
     COPILOT — OKUMA TAM, YAZMA ONAYLI

     OKUMA. Copilot istemcide çalıştığı için gördüğü veri, sunucunun o kullanıcı
     için zaten süzüp gönderdiği veridir. Moderatör her şeyi görür, dolayısıyla
     Copilot da görür; kısıtlı bir kullanıcı kendi kapsamını görür, Copilot da
     onu görür. Yetki ayrı bir katmanda yeniden uygulanmaz — veri yolunun kendisi
     yetkilendirilmiştir. Bu, "kullanıcının göremediğini AI da göremez" kuralını
     bir kontrole değil mimariye bağlar.

     YAZMA. Copilot'a KENDİ yazma yolu verilmez. Ürettiği şey bir ÖNERİdir:
     ne değişecek, hangi kayıtta, eski ve yeni değer nedir. Uygulamayı Buyer
     Log'un mevcut kayıt fonksiyonları yapar — yani revizyon kontrolü (409),
     yetki kontrolü ve audit kaydı olduğu gibi çalışmaya devam eder.

     Bunun neden böyle olduğu önemli: iş verisi içindeki metin (tedarikçi maili,
     not, içe aktarılan Excel) untrusted içeriktir. Modelin bir talimatı yanlışlıkla
     izlemesi hâlinde üretebileceği en kötü şey, kullanıcının ekranda görüp
     reddedeceği bir öneridir. Enjekte edilmiş bir cümle veri silemez, çünkü
     silme yeteneği hiçbir zaman modelde değildir.
     =================================================================== */

  const STATUS=Object.freeze({
    PROPOSED:'PROPOSED',     // öneri üretildi, kullanıcı görmedi
    PREVIEWED:'PREVIEWED',   // kullanıcıya gösterildi
    CONFIRMED:'CONFIRMED',   // kullanıcı açıkça onayladı
    APPLIED:'APPLIED',       // Buyer Log kayıt yolu uyguladı
    REJECTED:'REJECTED',
    FAILED:'FAILED',
  });

  /* Copilot'ın önerebileceği eylemler. Liste kapalıdır: burada olmayan bir eylem
     önerilemez, dolayısıyla modelin "yeni bir yetenek uydurması" mümkün değil. */
  const ACTIONS=Object.freeze({
    'order.note.set':{label:'Sipariş notu güncelle',area:'cp',fields:['orderCode','note']},
    'order.supplier.set':{label:'Sipariş üreticisi ata',area:'orders',fields:['orderCode','manufacturer']},
    'collection.row.patch':{label:'Koleksiyon satırı güncelle',area:'koleksiyon',fields:['rowId','changes']},
    /* Otomasyon tarifi. Yeni bir otomasyon motoru DEĞİL: mevcut
       POST /api/automations/recipes'e kaydedilir, dolayısıyla zamanlayıcı,
       gecikmiş tetik koruması ve audit olduğu gibi çalışır. Otomasyon ekranı
       kullanıcılar için zor olduğu için burada yalnız daha kolay bir giriş
       kapısı açılıyor. */
    'automation.recipe.create':{label:'Otomasyon oluştur',area:'automations',
      fields:['name','source','emailGroupId','weekday','time']},
  });

  const text=value=>String(value==null?'':value).trim();

  function fail(reason,extra={}){return {ok:false,reason,...extra};}

  /* Öneriyi doğrular ve önizlenebilir hâle getirir. HİÇBİR ŞEY YAZMAZ. */
  function propose(request={},context={}){
    const type=text(request.type);
    const definition=ACTIONS[type];
    if(!definition)return fail(`Bilinmeyen eylem: ${type||'(boş)'}. Copilot yalnız tanımlı eylemleri önerebilir.`);

    // Yetki, öneri aşamasında da kontrol edilir: kullanıcının yapamayacağı bir
    // değişikliği önermek, uygulanamayacak bir şeyi vaat etmektir.
    const can=typeof context.hasArea==='function'?context.hasArea(definition.area):true;
    if(!can)return fail(`Bu değişiklik için ${definition.area} yetkiniz yok.`,{area:definition.area});

    const missing=definition.fields.filter(field=>{
      const value=request.payload&&request.payload[field];
      return value==null||text(value)==='';
    });
    if(missing.length)return fail(`Öneri eksik alan içeriyor: ${missing.join(', ')}.`,{missing});

    /* Önizleme, kullanıcının onaylamadan önce görmesi gereken şeydir: neyin
       değiştiği, ESKİ değerle birlikte. Eski değeri göstermeden onay istemek,
       kullanıcıya kör imza attırmaktır. */
    const before=typeof context.readCurrent==='function'?context.readCurrent(type,request.payload):null;
    return {
      ok:true,
      status:STATUS.PROPOSED,
      type,
      label:definition.label,
      area:definition.area,
      payload:request.payload,
      preview:{before,after:request.payload,reason:text(request.reason)||null},
      /* Öneri tek kullanımlıktır: onay bu kimliğe verilir, böylece kullanıcının
         gördüğü önizleme ile uygulanan değişiklik aynı şey olur. */
      proposalId:`copilot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`,
    };
  }

  /* Kullanıcı onayından SONRA çağrılır. Yazmayı kendisi yapmaz; Buyer Log'un
     mevcut kayıt fonksiyonunu çağırır ki revizyon, yetki ve audit yolları
     olduğu gibi işlesin. */
  async function apply(proposal,confirmation={},context={}){
    if(!proposal||!proposal.ok)return fail('Uygulanacak geçerli bir öneri yok.');
    if(confirmation.proposalId!==proposal.proposalId){
      // Onay, kullanıcının GÖRDÜĞÜ öneriye verilmiş olmalı. Aksi hâlde önizleme
      // ile uygulanan değişiklik ayrışabilirdi.
      return fail('Onay bu öneriye ait değil; değişiklik uygulanmadı.',{status:STATUS.REJECTED});
    }
    if(confirmation.confirmed!==true){
      return {ok:false,status:STATUS.REJECTED,reason:'Kullanıcı onaylamadı.'};
    }
    const writer=context.writers&&context.writers[proposal.type];
    if(typeof writer!=='function'){
      return fail(`${proposal.type} için Buyer Log kayıt yolu bağlanmamış.`,{status:STATUS.FAILED});
    }
    try{
      const result=await writer(proposal.payload);
      // Audit: kimin, neyi, hangi öneriyle değiştirdiği izlenebilir olmalı.
      if(typeof context.audit==='function'){
        context.audit({proposalId:proposal.proposalId,type:proposal.type,payload:proposal.payload,at:new Date().toISOString()});
      }
      return {ok:true,status:STATUS.APPLIED,result,proposalId:proposal.proposalId};
    }catch(error){
      // Revizyon çakışması (409) dâhil her hata olduğu gibi yüzeye çıkar;
      // Copilot bunu "başardım" diye yorumlayamaz.
      return {ok:false,status:STATUS.FAILED,reason:error&&error.message||String(error),code:error&&error.code||null};
    }
  }

  return {STATUS,ACTIONS,propose,apply};
});
