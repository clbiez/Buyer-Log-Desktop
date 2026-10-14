(function(root){
 'use strict';
 // Small global notifier. The scene, editor and AI client remain lazy-loaded.
 let owner='',generation=0,pending=false,baseline=false,started=false;const seen=new Set();
 const english=()=>String(document.documentElement.lang||root.appLang||'tr').startsWith('en');
 function identity(){const next=String(root.BL_USER_CONTEXT?.id||'');if(next!==owner){owner=next;generation++;seen.clear();baseline=false;root.buyerLogDesktop?.agentBackground?.set(false,english()?'en':'tr').catch(()=>{});}return owner;}
 async function poll(){if(!started||pending||!identity())return;pending=true;const token=generation;
  try{const response=await fetch('/api/agent-office/notifications?'+new URLSearchParams({timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone}),{credentials:'same-origin',cache:'no-store'});if(!response.ok)return;const data=await response.json();if(token!==generation||identity()!==data.ownerId)return;
   const nav=document.querySelector('button[data-tab="agentoffice"]');if(nav){nav.dataset.agentAlerts=String(data.alerts.length);nav.title=data.alerts.length?(english()?'Agent alerts':'Agent uyarıları')+' · '+data.alerts.length:'';}
   const fresh=data.alerts.filter(a=>!seen.has(a.id));for(const alert of data.alerts)seen.add(alert.id);if(seen.size>1000){seen.clear();for(const alert of data.alerts)seen.add(alert.id);}
   const native=root.buyerLogDesktop?.agentBackground;
   if(native){const setting=await native.set(data.assistant?.enabled!==false&&data.assistant?.desktopBackground===true,english()?'en':'tr');if(token!==generation||identity()!==data.ownerId)return;if(setting?.ok===false)root.showToast?.(english()?'Background monitoring could not start. Keep Buyer Log open.':'Arka plan takibi başlatılamadı. Buyer Log’u açık tutun.');}
   if(fresh.length){const title=english()?fresh[0].title?.en:fresh[0].title?.tr;root.showToast?.((title||'Buyer Log')+' · '+(english()?'Agent Office › Actions & alerts':'Agent Ofisi › İşler ve uyarılar'));if(baseline||document.hidden)await native?.notify(english()?'en':'tr');}baseline=true;
  }catch(_){}finally{pending=false;}
 }
 root.addEventListener('bl:user-access-applied',()=>{identity();void poll();});
 // No source work, timer or notification request belongs to the login path.
 root.addEventListener('bl:startup-complete',()=>{if(started)return;started=true;void poll();setInterval(()=>{void poll();},60000);});
 root.BLAgentNotifications={refresh:poll};
})(window);
