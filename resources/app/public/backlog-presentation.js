/* Backlog sunum raporu — uygulama içi önizleme ve indirme.
   Satırlar Backlog Genel Bakış ile aynı önbellekten (BLBacklogRows) ve aynı aktif
   filtreyle gelir; rapor BLBacklogPresentationReport ile üretilir. Rapor HTML'i
   ana DOM'a eklenmez: yalnız betik izni olan, kökeni ayrık (allow-same-origin
   yok) bir iframe'de gösterilir. PDF masaüstünde JS kapalı gizli pencerede basılır. */
(function(root){
  'use strict';
  const doc=root.document;
  if(!doc)return;
  const isEn=()=>String(doc.documentElement.lang||'tr').toLowerCase().startsWith('en');
  const L=(tr,en)=>isEn()?en:tr;
  const FONT_FILES=[['Barlow',400,'barlow-400-latin'],['Barlow',400,'barlow-400-latin-ext'],['Barlow',500,'barlow-500-latin'],['Barlow',500,'barlow-500-latin-ext'],['Barlow',700,'barlow-700-latin'],['Barlow',700,'barlow-700-latin-ext']];
  let fontCache=null,overlay=null,current=null,busy=false,renderTimer=0;

  function toast(text){if(typeof root.showToast==='function')root.showToast(text);else console.info('[backlog-presentation]',text);}
  async function fonts(){
    if(fontCache)return fontCache;
    const toDataUrl=blob=>new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(blob);});
    const out=[];
    for(const [family,weight,file] of FONT_FILES){
      try{const res=await fetch('vendor/fonts/'+file+'.woff2',{credentials:'same-origin'});if(res.ok)out.push({family,weight,dataUrl:await toDataUrl(await res.blob())});}catch(_){/* yazı tipi yoksa sistem yazısı kullanılır */}
    }
    fontCache=out;return out;
  }
  async function loadItems(){
    if(root.BLPerf?.ensureFeature)await root.BLPerf.ensureFeature('backlogAnalysis').catch(()=>null);
    const params=typeof root.backlogExportQueryParams==='function'?root.backlogExportQueryParams():null;
    if(!params)throw new Error(L('Backlog filtresi okunamadı. Önce Backlog raporunu oluşturun.','The Backlog filter could not be read. Build the Backlog report first.'));
    if(!root.BLBacklogRows?.load||!root.BLBacklogV3Report)throw new Error(L('Backlog V3 rapor motoru yüklenemedi.','Backlog V3 report engine could not be loaded.'));
    const rows=await root.BLBacklogRows.load(params);
    return root.BLBacklogV3Report.normalizeRows(rows);
  }
  function dateLabel(){const d=new Date();return d.toLocaleDateString(isEn()?'en-GB':'tr-TR',{day:'2-digit',month:'2-digit',year:'numeric'})+' '+d.toLocaleTimeString(isEn()?'en-GB':'tr-TR',{hour:'2-digit',minute:'2-digit'});}
  function fileStem(){const d=new Date(),p=n=>String(n).padStart(2,'0');return (isEn()?'Backlog_Presentation_':'Backlog_Sunum_')+d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate());}
  function buildHtml(items,theme,fontList){
    const scope=L('Aktif Backlog filtresi','Active Backlog filter')+(current?.scope?' · '+current.scope:'');
    return root.BLBacklogPresentationReport.build(items,{lang:isEn()?'en':'tr',theme,fonts:fontList,createdLabel:dateLabel(),scope});
  }
  function download(blob,name){
    const url=URL.createObjectURL(blob),a=doc.createElement('a');
    a.href=url;a.download=name;doc.body.appendChild(a);a.click();a.remove();
    root.setTimeout(()=>URL.revokeObjectURL(url),4000);
  }

  function ensureOverlay(){
    if(overlay)return overlay;
    overlay=doc.createElement('div');overlay.className='blpOverlay';overlay.dataset.uiMigrated='presentation';overlay.hidden=true;
    overlay.innerHTML='<div class="blpDialog" role="dialog" aria-modal="true" aria-labelledby="blpTitle"><header class="blpHead"><div class="blpTitleBox"><h2 id="blpTitle"></h2><span class="blpMeta" id="blpMeta"></span></div><div class="blpActions"><button type="button" class="tbtn" data-blp="html"><svg class="ic"><use href="#i-download"/></svg><span></span></button><button type="button" class="tbtn" data-blp="pdf"><svg class="ic"><use href="#i-file-export"/></svg><span></span></button><button type="button" class="tbtn" data-blp="excel"><svg class="ic"><use href="#i-chart-bar"/></svg><span></span></button><button type="button" class="tbtn blpClose" data-blp="close"><svg class="ic"><use href="#i-x"/></svg><span></span></button></div></header><div class="blpBody"><iframe class="blpFrame" sandbox="allow-scripts" referrerpolicy="no-referrer"></iframe><div class="blpState" hidden></div></div></div>';
    doc.body.appendChild(overlay);
    const time=doc.createElement('div');time.className='blpTime';time.hidden=true;
    time.innerHTML='<select class="blpTimeField"><option value="inStore">MB</option><option value="retail">Retail</option><option value="exFactory">Ex-Factory</option></select><select class="blpTimeUnit"><option value="week"></option><option value="month"></option><option value="date"></option></select><div class="blpTimeRange"><div class="blpTimeTrack"><i></i><input type="range" class="blpTimeStart" min="0" step="1"><input type="range" class="blpTimeEnd" min="0" step="1"></div><div class="blpTimeLabels"><output class="blpTimeFrom"></output><span class="blpTimeNote"></span><output class="blpTimeTo"></output></div></div><button type="button" class="tbtn" data-blp="reset"></button>';
    overlay.querySelector('.blpHead').after(time);
    time.querySelectorAll('select').forEach(el=>el.addEventListener('change',()=>configureRange()));
    time.querySelectorAll('input').forEach(el=>el.addEventListener('input',()=>{
      if(!current)return;
      const start=time.querySelector('.blpTimeStart'),end=time.querySelector('.blpTimeEnd');
      if(el===start)start.value=Math.min(Number(start.value),Number(end.value));
      else end.value=Math.max(Number(start.value),Number(end.value));
      updateRange(true);
    }));
    overlay.addEventListener('click',event=>{const b=event.target.closest('[data-blp]');if(b)void action(b.dataset.blp);});
    return overlay;
  }
  function localize(){
    overlay.querySelector('#blpTitle').textContent=L('Backlog sunum raporu','Backlog presentation report');
    const set=(key,tr,en)=>{const b=overlay.querySelector(`[data-blp="${key}"]`);b.querySelector('span').textContent=L(tr,en);b.title=L(tr,en);};
    set('html','HTML indir','Download HTML');set('pdf','PDF indir','Download PDF');set('excel','Excel Backlog V3','Excel Backlog V3');set('close','Kapat','Close');
    const time=overlay.querySelector('.blpTime');
    time.setAttribute('role','group');time.setAttribute('aria-label',L('Rapor zaman aralığı','Report time range'));
    const name=(selector,tr,en)=>{const el=time.querySelector(selector);el.setAttribute('aria-label',L(tr,en));el.title=L(tr,en);};
    name('.blpTimeField','Tarih alanı · MB: Model Bütçe Tarihi','Date field · MB: Model Budget Date');
    name('.blpTimeUnit','Zaman birimi','Time unit');
    name('.blpTimeStart','Aralık başlangıcı','Range start');name('.blpTimeEnd','Aralık bitişi','Range end');
    const unit=time.querySelector('.blpTimeUnit');
    [['week','Hafta','Week'],['month','Ay','Month'],['date','Tarih','Date']].forEach(([key,tr,en])=>{unit.querySelector(`[value="${key}"]`).textContent=L(tr,en);});
    const reset=time.querySelector('[data-blp="reset"]');reset.textContent=L('Tümü','All');
    reset.title=L('Tüm aralık · tarihsiz satırlar dahil','Full range · includes undated rows');
  }
  function setState(text){const st=overlay.querySelector('.blpState');st.hidden=!text;st.textContent=text||'';overlay.querySelector('.blpFrame').hidden=Boolean(text);}

  function periodLabel(iso,unit){
    const date=new Date(iso+'T00:00:00Z'),locale=isEn()?'en-GB':'tr-TR';
    if(unit==='month')return date.toLocaleDateString(locale,{month:'short',year:'numeric',timeZone:'UTC'});
    const day=date.toLocaleDateString(locale,{day:'2-digit',month:'2-digit',year:'numeric',timeZone:'UTC'});
    date.setUTCDate(date.getUTCDate()-((date.getUTCDay()+6)%7));
    return unit==='week'?L('H','W')+root.BLBacklogV3Report.isoWeekNo(date.toISOString().slice(0,10))+' · '+day:day;
  }
  function configureRange(){
    if(!current)return;
    const time=overlay.querySelector('.blpTime');
    current.domain=root.BLBacklogPresentationReport.timeDomain(current.sourceItems,time.querySelector('.blpTimeField').value,time.querySelector('.blpTimeUnit').value);
    const domain=current.domain,start=time.querySelector('.blpTimeStart'),end=time.querySelector('.blpTimeEnd');
    for(const input of [start,end]){input.max=Math.max(1,domain.count-1);input.disabled=domain.count<2;}
    start.value=0;end.value=Math.max(0,domain.count-1);
    updateRange();
  }
  function updateRange(defer){
    if(!current)return;
    root.clearTimeout(renderTimer);
    const time=overlay.querySelector('.blpTime'),domain=current.domain;
    const lo=Number(time.querySelector('.blpTimeStart').value),hi=Number(time.querySelector('.blpTimeEnd').value);
    const bounds=root.BLBacklogPresentationReport.timeBounds(domain,lo,hi);
    const all=!bounds||(lo===0&&hi===domain.count-1);
    current.items=root.BLBacklogPresentationReport.filterTimeRange(current.sourceItems,{field:domain.field,...bounds,all});
    const label=domain.field==='inStore'?'MB':domain.field==='retail'?'Retail':'Ex-Factory';
    current.scope=all?'':label+' · '+periodLabel(bounds.start,'date')+' – '+periodLabel(bounds.end,'date');
    time.querySelector('.blpTimeFrom').textContent=bounds?periodLabel(bounds.start,domain.unit):'–';
    time.querySelector('.blpTimeTo').textContent=bounds?periodLabel(bounds.end,domain.unit):'–';
    const note=time.querySelector('.blpTimeNote');
    note.textContent=!bounds?L('Bu alanda tarih yok','No dates in this field'):domain.missing?L(`${domain.missing} tarihsiz${all?'':' · hariç'}`,`${domain.missing} undated${all?'':' · excluded'}`):'';
    for(const [selector,value] of [['.blpTimeStart',bounds?.start],['.blpTimeEnd',bounds?.end]])time.querySelector(selector).setAttribute('aria-valuetext',value?periodLabel(value,'date'):L('Tarih yok','No date'));
    const max=Math.max(1,domain.count-1),track=time.querySelector('.blpTimeTrack');
    track.style.setProperty('--blp-from',(lo/max*100)+'%');track.style.setProperty('--blp-to',(hi/max*100)+'%');
    time.querySelector('.blpTimeStart').style.zIndex=lo===domain.count-1?'3':'1';
    time.querySelector('[data-blp="reset"]').disabled=all;
    const count=current.items.length.toLocaleString(isEn()?'en-US':'tr-TR'),total=current.sourceItems.length.toLocaleString(isEn()?'en-US':'tr-TR');
    overlay.querySelector('#blpMeta').textContent=L(`${count} / ${total} satır · ${current.created}`,`${count} / ${total} rows · ${current.created}`);
    overlay.querySelectorAll('[data-blp="html"],[data-blp="pdf"]').forEach(btn=>{btn.disabled=!current.items.length;});
    const render=()=>{
      if(!current||overlay.hidden)return;
      if(!current.items.length){setState(L('Seçilen zaman aralığında Backlog satırı yok.','No Backlog rows in the selected time range.'));return;}
      const theme=doc.documentElement.getAttribute('data-theme')==='dark'?'dark':'light';
      const html=buildHtml(current.items,theme,current.fontList);
      const frame=overlay.querySelector('.blpFrame'),wasHidden=frame.hidden;
      setState('');
      // Chromium gizliyken yüklenen iframe'i sıfır boyutla tutabilir.
      if(wasHidden)void frame.offsetWidth;
      frame.srcdoc=html;
    };
    if(defer)renderTimer=root.setTimeout(render,140);else render();
  }

  async function open(trigger){
    if(busy)return;busy=true;
    ensureOverlay();localize();setState(L('Backlog satırları toplanıyor…','Collecting Backlog rows…'));
    overlay.querySelector('.blpTime').hidden=true;
    overlay.querySelector('#blpMeta').textContent='';
    overlay.querySelectorAll('[data-blp="html"],[data-blp="pdf"]').forEach(btn=>{btn.disabled=true;});
    overlay.hidden=false;
    root.BLLayerSystem?.openDialog?.(overlay,{onClose:close,trigger,initialFocus:'.blpClose'});
    try{
      const [items,fontList]=await Promise.all([loadItems(),fonts()]);
      if(overlay.hidden)return;
      if(!items.length){setState(L('Aktif filtrede Backlog satırı yok.','No Backlog rows in the active filter.'));return;}
      current={sourceItems:items,items,fontList,created:dateLabel()};
      overlay.querySelector('.blpTime').hidden=false;
      configureRange();
    }catch(error){setState(String(error&&error.message||error));}
    finally{busy=false;}
  }
  function close(){
    if(!overlay||overlay.hidden)return;
    root.clearTimeout(renderTimer);
    overlay.hidden=true;overlay.querySelector('.blpFrame').srcdoc='';current=null;
    root.BLLayerSystem?.closeDialog?.(overlay);
  }
  async function action(name){
    if(name==='close')return close();
    if(name==='reset'){configureRange();return;}
    if(name==='excel'){close();doc.getElementById('backlogExportV3Btn')?.click();return;}
    if(!current||!current.items.length)return;
    if(name==='html'){download(new Blob([buildHtml(current.items,'light',current.fontList)],{type:'text/html;charset=utf-8'}),fileStem()+'.html');toast(L('Sunum raporu HTML olarak indirildi.','Presentation report downloaded as HTML.'));return;}
    if(name==='pdf'){
      const desktop=root.buyerLogDesktop;
      if(!desktop||typeof desktop.renderPdf!=='function'){
        download(new Blob([buildHtml(current.items,'light',current.fontList)],{type:'text/html;charset=utf-8'}),fileStem()+'.html');
        toast(L('PDF masaüstü uygulamasında üretilir. HTML indirildi; açıp Yazdır → PDF ile kaydedebilirsiniz.','PDF is produced in the desktop app. HTML was downloaded; open it and use Print → PDF.'));
        return;
      }
      const btn=overlay.querySelector('[data-blp="pdf"]');btn.disabled=true;
      try{
        const result=await desktop.renderPdf(buildHtml(current.items,'light',current.fontList),{landscape:true});
        if(!result||!result.ok||!result.data)throw new Error(result&&result.error||'render-failed');
        download(new Blob([result.data],{type:'application/pdf'}),fileStem()+'.pdf');
        toast(L('Sunum raporu PDF olarak indirildi.','Presentation report downloaded as PDF.'));
      }catch(error){toast(L('PDF oluşturulamadı: ','PDF could not be created: ')+String(error&&error.message||error));}
      finally{btn.disabled=!current?.items.length;}
    }
  }
  doc.addEventListener('click',event=>{const btn=event.target.closest?.('#backlogPresentBtn');if(btn){event.preventDefault();void open(btn);}});
  doc.addEventListener('bl:language-changed',()=>{if(overlay&&!overlay.hidden){localize();if(current)updateRange();}});
  root.BLBacklogPresentation={open,close};
})(typeof window!=='undefined'?window:globalThis);
