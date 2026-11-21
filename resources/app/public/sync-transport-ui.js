(function(global){
  'use strict';
  /* Sync durumu › OneDrive aktarım uyarısı.
     Sunucu (sync-transport-guard.js) uçtan uca kanıtla "yayınım eşlere
     ulaşmadı" veya "eşin yayını bana inmedi" dediğinde gösterilir. Buyer Log
     OneDrive kuyruğunu doğrudan yönetemez; yalnız kullanıcı onaylı, geri
     alınabilir iki işlem sunar: dosyaları cihazda tutmak ve OneDrive'ı
     yeniden başlatmak. Hiçbir işlem kendiliğinden çalışmaz. */
  const ERRORS={
    ONEDRIVE_UNSUPPORTED_PLATFORM:['Bu işlem yalnız Windows\'ta kullanılabilir.','This action is only available on Windows.'],
    SYNC_NOT_CONFIGURED:['Ortak klasör ayarlı değil.','The shared folder is not configured.'],
    ONEDRIVE_NOT_MANAGED:['Ortak klasör bir OneDrive klasörü olarak doğrulanamadı.','The shared folder could not be verified as a OneDrive folder.'],
    ONEDRIVE_BUSY:['Başka bir OneDrive işlemi sürüyor.','Another OneDrive action is in progress.'],
    ONEDRIVE_PIN_FAILED:['"Bu cihazda tut" ayarı uygulanamadı.','"Keep on this device" could not be applied.'],
    ONEDRIVE_RESTART_COOLDOWN:['OneDrive kısa süre önce yeniden başlatıldı; birkaç dakika bekleyin.','OneDrive was restarted recently; wait a few minutes.'],
    ONEDRIVE_NOT_FOUND:['OneDrive uygulaması bulunamadı.','The OneDrive app was not found.'],
    ONEDRIVE_SHUTDOWN_TIMEOUT:['OneDrive kapanmadı; yeniden başlatma yapılmadı.','OneDrive did not close; it was not restarted.'],
    SYNC_IN_PROGRESS:['Sync sürerken OneDrive yeniden başlatılmaz; sync bitince tekrar deneyin.','OneDrive is not restarted while a sync is running; try again when it finishes.'],
    ONEDRIVE_LOCAL_ONLY:['Bu işlem yalnız Buyer Log\'un çalıştığı bilgisayardan yapılabilir.','This action can only be run on the computer where Buyer Log is running.'],
  };
  function render(host,transport,ctx){
    const {tx,escapeHtml,fetchJSON,syncStatusTime,showToast,syncNow}=ctx;
    const key=`${transport.key||''}|${tx('tr','en')}`;
    if(host.dataset.key===key&&!host.hidden)return;
    host.dataset.key=key;host.hidden=false;
    host.className='syncConflictPanel blMotionEnter';
    const outbound=transport.outbound&&transport.outbound.status==='stalled';
    const inbound=transport.inbound&&transport.inbound.status==='stalled';
    const peerCount=(outbound?transport.outbound.peers:transport.inbound.peers||[]).length;
    const since=outbound?transport.outbound.since:transport.inbound.since;
    const title=outbound&&inbound?tx('OneDrive yükleme ve indirmesi takılmış olabilir','OneDrive upload and download may be stuck')
      :outbound?tx('Değişiklikleriniz diğer cihazlara ulaşmıyor','Your changes are not reaching other devices')
      :tx('Diğer cihazların değişiklikleri bu bilgisayara inmiyor','Changes from other devices are not arriving on this computer');
    const evidence=outbound
      ?tx(`Bu yayından sonra ${peerCount} cihaz sync yaptı ama hiçbiri yayını görmedi.`,`${peerCount} device(s) synced after this publication, but none of them received it.`)
      :tx(`Bu değişiklikleri başka bir cihaz aldı; bu bilgisayar ${peerCount} cihazın yayınını hâlâ görmüyor.`,`Another device already received these changes; this computer still does not see publications from ${peerCount} device(s).`);
    host.innerHTML=`<div class="syncConflictHead"><b>${escapeHtml(title)}</b><span>${tx('Başlangıç','Since')}: ${syncStatusTime(since)} · ${escapeHtml(evidence)}</span>`+
      `<span>${escapeHtml(tx('Buyer Log değişiklikleri ortak klasöre yazdı; buluta yükleme ve buluttan indirme OneDrive uygulamasının işidir. Önce görev çubuğundaki OneDrive simgesinden oturumun açık ve eşitlemenin duraklatılmamış olduğunu kontrol edin. Sorun sürerse aşağıdaki güvenli işlemleri kullanın; hiçbiri dosya silmez.','Buyer Log has written the changes to the shared folder; uploading to and downloading from the cloud is the OneDrive app\'s job. First check the OneDrive icon in the taskbar: you must be signed in and syncing must not be paused. If the problem continues, use the safe actions below; none of them deletes files.'))}</span>`+
      `<span data-transport-onedrive>${escapeHtml(tx('OneDrive durumu kontrol ediliyor…','Checking OneDrive status…'))}</span></div>`+
      `<div class="syncStatusActions"><button type="button" class="tbtn" data-transport-sync>${escapeHtml(tx('Şimdi senkronla','Sync now'))}</button>`+
      `<button type="button" class="tbtn" data-transport-pin disabled title="${escapeHtml(tx('Senkron klasörlerini (görseller ve yedekler hariç) "Bu cihazda her zaman tut" olarak işaretler; OneDrive dosyaları önceden indirir.','Marks the sync folders (excluding images and backups) as "Always keep on this device"; OneDrive downloads the files in advance.'))}">${escapeHtml(tx('Dosyaları bu cihazda tut','Keep files on this device'))}</button>`+
      `<button type="button" class="tbtn primary" data-transport-restart disabled>${escapeHtml(tx('OneDrive\'ı yeniden başlat','Restart OneDrive'))}</button></div>`;
    const status=host.querySelector('[data-transport-onedrive]'),pin=host.querySelector('[data-transport-pin]'),restart=host.querySelector('[data-transport-restart]');
    const fail=error=>{const pair=ERRORS[error&&error.code];showToast(pair?tx(pair[0],pair[1]):String(error&&error.message||error),{kind:'error'});};
    host.querySelector('[data-transport-sync]').onclick=()=>syncNow();
    let running=null;
    fetchJSON('/api/sync-transport/onedrive').then(result=>{
      if(!host.isConnected||host.dataset.key!==key)return;
      const info=result.onedrive||{};running=info.running;
      if(!info.supported){status.textContent=tx('OneDrive işlemleri yalnız Windows\'ta kullanılabilir.','OneDrive actions are only available on Windows.');return;}
      if(!info.managed){status.textContent=tx('Ortak klasör bir OneDrive klasörü olarak doğrulanamadı; OneDrive işlemleri kapalı.','The shared folder could not be verified as a OneDrive folder; OneDrive actions are disabled.');return;}
      status.textContent=info.running===false?tx('OneDrive şu anda çalışmıyor. Başlatmak eşitlemeyi sürdürür.','OneDrive is not running right now. Starting it resumes syncing.')
        :tx('OneDrive çalışıyor ama bu klasörde aktarım ilerlemiyor.','OneDrive is running, but transfers in this folder are not progressing.');
      pin.disabled=false;restart.disabled=!info.executable;
      if(info.running===false)restart.textContent=tx('OneDrive\'ı başlat','Start OneDrive');
    }).catch(error=>{if(host.isConnected)status.textContent=tx('OneDrive durumu okunamadı.','OneDrive status could not be read.')+' '+String(error.message||error);});
    pin.onclick=async()=>{
      pin.disabled=true;
      try{
        const result=await fetchJSON('/api/sync-transport/onedrive/keep-local',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
        const pinned=(result.result&&result.result.pinned||[]).length;
        showToast(tx(`${pinned} klasör "Bu cihazda her zaman tut" olarak işaretlendi. OneDrive dosyaları arka planda indirecek.`,`${pinned} folder(s) marked "Always keep on this device". OneDrive will download the files in the background.`),{kind:'success'});
      }catch(error){fail(error);}finally{if(host.isConnected)pin.disabled=false;}
    };
    restart.onclick=async()=>{
      const message=running===false
        ?tx('OneDrive başlatılsın mı?','Start OneDrive?')
        :tx('OneDrive kapatılıp yeniden açılacak. Bu bilgisayardaki tüm OneDrive eşitlemesi birkaç saniye durur; bekleyen yüklemeler kaybolmaz, OneDrive açılınca kaldığı yerden sürer. Devam edilsin mi?','OneDrive will be closed and reopened. All OneDrive syncing on this computer pauses for a few seconds; pending uploads are not lost and resume when OneDrive reopens. Continue?');
      if(!global.confirm(message))return;
      restart.disabled=true;
      try{
        const result=await fetchJSON('/api/sync-transport/onedrive/restart',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirm:true})});
        showToast(result.result&&result.result.restarted
          ?tx('OneDrive yeniden başlatıldı. Birkaç dakika sonra "Şimdi senkronla" ile kontrol edin.','OneDrive was restarted. Check again with "Sync now" in a few minutes.')
          :tx('OneDrive başlatıldı. Birkaç dakika sonra "Şimdi senkronla" ile kontrol edin.','OneDrive was started. Check again with "Sync now" in a few minutes.'),{kind:'success'});
      }catch(error){fail(error);if(host.isConnected)restart.disabled=false;}
    };
  }
  global.BLSyncTransportUI={render};
})(window);
