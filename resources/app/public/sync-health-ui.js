(function(global){
  'use strict';
  const mounted=new WeakMap();
  async function mount(details,{tx,escapeHtml,fetchJSON,syncStatusTime}){
    if(mounted.has(details))return mounted.get(details);
    const host=details.querySelector('[data-sync-health-content]');
    const labels={same:()=>tx('Aynı','In sync'),diverged:()=>tx('Farklı','Diverged'),syncing:()=>tx('Eşitleniyor','Syncing'),
      stale:()=>tx('Kayıp','Stale'),'old-version':()=>tx('Eski sürüm','Old version'),indeterminate:()=>tx('Doğrulanamadı','Unverified')};
    const diff=async deviceId=>{
      const target=host.querySelector('[data-health-diff]');
      target.hidden=false;target.textContent=tx('Ayrışan kayıtlar yükleniyor…','Loading diverged records…');
      try{
        const value=await fetchJSON(`/api/sync-health/diff?deviceId=${encodeURIComponent(deviceId)}`);
        if(!details.isConnected)return;
        if(!value.detailsAvailable){target.textContent=tx('Bu cihaz için kayıt ayrıntısı yok.','Record details are unavailable for this device.');return;}
        const groups=[[tx('Farklı','Different'),value.different],[tx('Yalnız o cihazda','Only on that device'),value.onlyThere],[tx('Yalnız bu cihazda','Only on this device'),value.onlyHere]];
        target.innerHTML=groups.map(([label,ids])=>`<div><b>${escapeHtml(label)} · ${(ids||[]).length}</b><pre>${escapeHtml((ids||[]).join('\n')||'—')}</pre></div>`).join('')+
          (value.truncated?`<p>${tx('İlk 200 kayıt gösteriliyor.','Showing the first 200 records.')}</p>`:'');
      }catch(error){target.textContent=tx('Ayrışan kayıtlar okunamadı.','Diverged records could not be read.')+' '+String(error.message||error);}
    };
    const refresh=async()=>{
      host.textContent=tx('Cihazlar yükleniyor…','Loading devices…');
      try{
        const result=await fetchJSON('/api/sync-health');
        if(!details.isConnected)return;
        const devices=result.devices||[];
        host.innerHTML=`<div class="syncConflictHead"><b>${tx('Cihazların ortak veri durumu','Shared data status across devices')}</b><button class="tbtn" type="button" data-health-refresh>${tx('Yenile','Refresh')}</button></div>`+
          (devices.length?`<ol class="syncConflictList">${devices.map(device=>`<li class="syncConflictItem"><div class="syncConflictHead"><b>${escapeHtml(device.displayName||device.userId||device.deviceId)}</b><span class="syncConflictType">${escapeHtml((labels[device.status]||labels.indeterminate)())}</span></div><div class="syncAdvancedGrid"><div><span>${tx('Cihaz · Sürüm','Device · Version')}</span><b title="${escapeHtml(device.deviceId)}">${escapeHtml(String(device.deviceId||'').slice(0,12))} · ${escapeHtml(device.appVersion||'—')}</b></div><div><span>${tx('Son sync','Last sync')}</span><b>${syncStatusTime(device.lastSyncAt||device.updatedAt)}</b></div><div><span>${tx('Bekleyen · Çakışma','Pending · Conflicts')}</span><b>${Number(device.pendingUpload)||0} · ${Number(device.openConflicts)||0}</b></div><div><span>${tx('Kurallar','Rules')}</span><b>v${Number(device.masterRevisionApplied)||0}</b></div></div>${device.status==='diverged'?`<button type="button" class="tbtn" data-health-device="${escapeHtml(device.deviceId)}">${tx('Ayrışan kayıtlar','Diverged records')}</button>`:''}</li>`).join('')}</ol>`:`<p class="syncConflictEmpty">${tx('Henüz cihaz raporu yok.','No device reports yet.')}</p>`)+
          (result.indeterminate?`<p>${tx('Eşitlenmiş cihazlar arasında çoğunluk belirlenemedi.','No majority could be determined among settled devices.')}</p>`:'')+
          '<div class="syncConflictPanel" data-health-diff hidden></div>';
        host.querySelector('[data-health-refresh]').onclick=()=>void refresh();
        host.querySelectorAll('[data-health-device]').forEach(button=>{button.onclick=()=>void diff(button.dataset.healthDevice);});
      }catch(error){if(details.isConnected)host.textContent=tx('Cihazlar okunamadı.','Devices could not be read.')+' '+String(error.message||error);}
    };
    const operation=refresh().finally(()=>mounted.delete(details));mounted.set(details,operation);return operation;
  }
  global.BLSyncHealthUI={mount};
})(window);
