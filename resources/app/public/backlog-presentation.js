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
  let fontCache=null,overlay=null,current=null,busy=false;

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
    return root.BLBacklogPresentationReport.build(items,{lang:isEn()?'en':'tr',theme,fonts:fontList,createdLabel:dateLabel(),scope:L('Aktif Backlog filtresi','Active Backlog filter')});
  }
  function download(blob,name){
    const url=URL.createObjectURL(blob),a=doc.createElement('a');
    a.href=url;a.download=name;doc.body.appendChild(a);a.click();a.remove();
    root.setTimeout(()=>URL.revokeObjectURL(url),4000);
  }

  function ensureOverlay(){
    if(overlay)return overlay;
    overlay=doc.createElement('div');overlay.className='blpOverlay';overlay.hidden=true;
    overlay.innerHTML='<div class="blpDialog" role="dialog" aria-modal="true" aria-labelledby="blpTitle"><header class="blpHead"><div class="blpTitleBox"><h2 id="blpTitle"></h2><span class="blpMeta" id="blpMeta"></span></div><div class="blpActions"><button type="button" class="tbtn" data-blp="html"><svg class="ic"><use href="#i-download"/></svg><span></span></button><button type="button" class="tbtn" data-blp="pdf"><svg class="ic"><use href="#i-file-export"/></svg><span></span></button><button type="button" class="tbtn" data-blp="excel"><svg class="ic"><use href="#i-chart-bar"/></svg><span></span></button><button type="button" class="tbtn blpClose" data-blp="close"><svg class="ic"><use href="#i-x"/></svg><span></span></button></div></header><div class="blpBody"><iframe class="blpFrame" sandbox="allow-scripts" referrerpolicy="no-referrer"></iframe><div class="blpState" hidden></div></div></div>';
    doc.body.appendChild(overlay);
    overlay.addEventListener('click',event=>{const b=event.target.closest('[data-blp]');if(b)void action(b.dataset.blp);});
    return overlay;
  }
  function localize(){
    overlay.querySelector('#blpTitle').textContent=L('Backlog sunum raporu','Backlog presentation report');
    const set=(key,tr,en)=>{const b=overlay.querySelector(`[data-blp="${key}"]`);b.querySelector('span').textContent=L(tr,en);b.title=L(tr,en);};
    set('html','HTML indir','Download HTML');set('pdf','PDF indir','Download PDF');set('excel','Excel Backlog V3','Excel Backlog V3');set('close','Kapat','Close');
  }
  function setState(text){const st=overlay.querySelector('.blpState');st.hidden=!text;st.textContent=text||'';overlay.querySelector('.blpFrame').hidden=Boolean(text);}

  async function open(trigger){
    if(busy)return;busy=true;
    ensureOverlay();localize();setState(L('Backlog satırları toplanıyor…','Collecting Backlog rows…'));
    overlay.hidden=false;
    root.BLLayerSystem?.openDialog?.(overlay,{onClose:close,trigger,initialFocus:'.blpClose'});
    try{
      const [items,fontList]=await Promise.all([loadItems(),fonts()]);
      if(!items.length){setState(L('Aktif filtrede Backlog satırı yok.','No Backlog rows in the active filter.'));return;}
      const theme=doc.documentElement.getAttribute('data-theme')==='dark'?'dark':'light';
      current={items,fontList};
      overlay.querySelector('#blpMeta').textContent=L(`${items.length.toLocaleString('tr-TR')} satır · ${dateLabel()}`,`${items.length.toLocaleString('en-US')} rows · ${dateLabel()}`);
      overlay.querySelector('.blpFrame').srcdoc=buildHtml(items,theme,fontList);
      setState('');
    }catch(error){setState(String(error&&error.message||error));}
    finally{busy=false;}
  }
  function close(){
    if(!overlay||overlay.hidden)return;
    overlay.hidden=true;overlay.querySelector('.blpFrame').srcdoc='';current=null;
    root.BLLayerSystem?.closeDialog?.(overlay);
  }
  async function action(name){
    if(name==='close')return close();
    if(name==='excel'){close();doc.getElementById('backlogExportV3Btn')?.click();return;}
    if(!current)return;
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
      finally{btn.disabled=false;}
    }
  }
  doc.addEventListener('click',event=>{const btn=event.target.closest?.('#backlogPresentBtn');if(btn){event.preventDefault();void open(btn);}});
  root.BLBacklogPresentation={open,close};
})(typeof window!=='undefined'?window:globalThis);
