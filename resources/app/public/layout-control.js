'use strict';

(function (root) {
  if (!root || root.BLLayoutControl) return;

  const HISTORY_KEY='lcw.layoutControl.history.v1';
  const HISTORY_MAX=30;
  const E=()=>root.BLLayoutControlEngine;
  const AI=()=>root.BuyerLogAI;
  const isEn=()=>String(root.appLang||document.documentElement.lang||'tr').toLowerCase().startsWith('en');
  const L=(tr,en)=>isEn()?en:tr;
  const esc=value=>String(value==null?'':value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const arr=value=>Array.isArray(value)?value:[];
  let modal=null, currentFile=null, currentReport=null, busy=false, filter='attention';

  const GUIDE=[
    'You are the visual extraction and QA layer for Buyer Log Layout Control.',
    'Analyse only the attached PDF. Do not invent CP/reference values.',
    'documentType must be CARE_LABEL, PRICE_TAG or UNKNOWN.',
    'Extract only values clearly visible in the PDF. Keep model/style codes exactly as printed.',
    'For CARE_LABEL extract colour code/name, country, composition percentages, care instructions and warnings.',
    'For PRICE_TAG inspect every page and extract model, order number, size, barcode digits if visibly readable, product class/fit and prices.',
    'pageVariants entries must use: page=<n>|size=<value>|barcode=<value>|order=<value> when visible.',
    'visualFindings: only visible layout/semantic concerns such as clipping, overlap, unreadable QR/barcode, duplicated block, inconsistent country/composition/language or suspicious page variation.',
    'Do not call a business field wrong unless the PDF itself proves the inconsistency. Reference comparison is performed deterministically by Buyer Log.',
    'confidence must be EXACT, HIGH, MEDIUM or LOW. Use EXACT/HIGH only for clearly legible fields.',
    'Never invent missing text, barcode digits, prices or translations.'
  ].join('\n');

  function ensureStyle(){
    if(document.querySelector('link[data-layout-control-style]')) return;
    const link=document.createElement('link');
    link.rel='stylesheet'; link.href='layout-control.css'; link.dataset.layoutControlStyle='1';
    document.head.appendChild(link);
  }
  function storage(){
    return root.BLStorage&&typeof root.BLStorage.getItem==='function'&&typeof root.BLStorage.setItem==='function'?root.BLStorage:null;
  }
  function loadHistory(){
    try{
      const store=storage(); if(!store) return [];
      const parsed=JSON.parse(store.getItem(HISTORY_KEY)||'[]');
      return Array.isArray(parsed)?parsed.slice(0,HISTORY_MAX):[];
    }catch(_){return [];}
  }
  function saveHistory(report,fileName){
    try{
      const store=storage(); if(!store||!report) return;
      const ex=report.extraction||{};
      const item={
        id:'lc-'+Date.now().toString(36),
        at:new Date().toISOString(),
        fileName:String(fileName||'').slice(0,180),
        documentType:report.documentType,
        summary:report.summary,
        modelCodes:arr(ex.modelCodes).slice(0,5),
        colourCodes:arr(ex.colourCodes).slice(0,5),
        checks:arr(report.checks).slice(0,80).map(check=>({
          rule:check.rule,category:check.category,status:check.status,
          expected:arr(check.expected).slice(0,12),actual:arr(check.actual).slice(0,12),
          detail:String(check.detail||'').slice(0,500),source:String(check.source||'').slice(0,80)
        }))
      };
      const next=[item,...loadHistory().filter(old=>old&&old.id!==item.id)].slice(0,HISTORY_MAX);
      store.setItem(HISTORY_KEY,JSON.stringify(next));
    }catch(_){}
  }
  function clearHistory(){
    try{const store=storage(); if(store) store.removeItem(HISTORY_KEY);}catch(_){}
  }
  function statusText(status){
    return {
      MATCH:L('Geçti','Passed'),
      MISMATCH:L('Hata','Error'),
      REVIEW:L('İncele','Review'),
      NOT_CHECKED:L('Kontrol edilmedi','Not checked')
    }[status]||status;
  }
  function docText(type){
    if(type==='CARE_LABEL') return L('Yıkama Talimatı','Care Label');
    if(type==='PRICE_TAG') return L('Karton Etiket','Price Tag');
    return L('Bilinmeyen Layout','Unknown Layout');
  }
  function valueHtml(values){
    const list=arr(values).filter(value=>String(value||'').trim());
    return list.length?list.map(value=>'<span class="layoutValue">'+esc(value)+'</span>').join(''):'<span class="layoutMuted">—</span>';
  }
  function selectedChecks(){
    const checks=arr(currentReport&&currentReport.checks);
    if(filter==='all') return checks;
    if(filter==='errors') return checks.filter(c=>c.status==='MISMATCH');
    if(filter==='review') return checks.filter(c=>c.status==='REVIEW');
    if(filter==='notchecked') return checks.filter(c=>c.status==='NOT_CHECKED');
    return checks.filter(c=>c.status==='MISMATCH'||c.status==='REVIEW');
  }
  function summaryHtml(summary){
    const s=summary||{passed:0,review:0,errors:0,notChecked:0,status:'REVIEW'};
    return [
      '<div class="layoutSummary">',
      '<div class="layoutMetric is-ok"><b>'+Number(s.passed||0)+'</b><span>'+esc(L('Geçti','Passed'))+'</span></div>',
      '<div class="layoutMetric is-review"><b>'+Number(s.review||0)+'</b><span>'+esc(L('İncele','Review'))+'</span></div>',
      '<div class="layoutMetric is-error"><b>'+Number(s.errors||0)+'</b><span>'+esc(L('Hata','Error'))+'</span></div>',
      '<div class="layoutMetric is-na"><b>'+Number(s.notChecked||0)+'</b><span>'+esc(L('Kontrol edilmedi','Not checked'))+'</span></div>',
      '</div>'
    ].join('');
  }
  function reportHtml(){
    if(!currentReport) return '';
    const s=currentReport.summary||{};
    const ex=currentReport.extraction||{};
    const statusClass=s.status==='ERROR'?'is-error':(s.status==='REVIEW'?'is-review':'is-ok');
    const checks=selectedChecks();
    return [
      '<section class="layoutReport">',
      '<div class="layoutReportTop">',
      '<div><span class="layoutEyebrow">'+esc(docText(currentReport.documentType))+'</span>',
      '<h3>'+esc(arr(ex.modelCodes)[0]||L('Model doğrulanamadı','Model not verified'))+'</h3>',
      '<p>'+esc([arr(ex.colourCodes)[0],arr(ex.colours)[0]].filter(Boolean).join(' · ')||L('PDF ↔ CP otomatik kontrol','Automatic PDF ↔ CP verification'))+'</p></div>',
      '<span class="layoutFinal '+statusClass+'">'+esc(s.status==='ERROR'?L('HATA','ERROR'):(s.status==='REVIEW'?L('İNCELE','REVIEW'):L('ONAYLI','APPROVED')))+'</span>',
      '</div>',
      summaryHtml(s),
      '<div class="layoutFilters" role="group" aria-label="'+esc(L('Sonuç filtresi','Result filter'))+'">',
      [['attention',L('Hata + İncele','Errors + Review')],['all',L('Tümü','All')],['errors',L('Hatalar','Errors')],['review',L('İncele','Review')],['notchecked',L('Kontrol edilmedi','Not checked')]].map(item=>'<button type="button" data-layout-filter="'+item[0]+'" class="'+(filter===item[0]?'is-active':'')+'">'+esc(item[1])+'</button>').join(''),
      '</div>',
      '<div class="layoutChecks">',
      checks.length?checks.map(check=>[
        '<article class="layoutCheck is-'+String(check.status||'').toLowerCase()+'">',
        '<div class="layoutCheckHead"><span class="layoutStatus">'+esc(statusText(check.status))+'</span><b>'+esc(check.rule)+'</b><span class="layoutCategory">'+esc(check.category||'')+'</span></div>',
        '<div class="layoutCompare"><div><small>'+esc(L('CP / Beklenen','CP / Expected'))+'</small>'+valueHtml(check.expected)+'</div><div><small>'+esc(L('Layout / Bulunan','Layout / Found'))+'</small>'+valueHtml(check.actual)+'</div></div>',
        check.detail?'<p>'+esc(check.detail)+'</p>':'',
        '<footer>'+esc(check.source||'CP ↔ Layout')+'</footer>',
        '</article>'
      ].join('')).join(''):'<div class="layoutEmpty">'+esc(L('Bu filtrede sonuç yok.','No results in this filter.'))+'</div>',
      '</div>',
      '</section>'
    ].join('');
  }
  function historyHtml(){
    const history=loadHistory();
    if(!history.length) return '<div class="layoutEmpty">'+esc(L('Henüz kayıtlı kontrol yok.','No saved checks yet.'))+'</div>';
    return history.slice(0,12).map(item=>{
      const s=item.summary||{};
      const cls=s.status==='ERROR'?'is-error':(s.status==='REVIEW'?'is-review':'is-ok');
      return [
        '<button type="button" class="layoutHistoryItem" data-layout-history="'+esc(item.id)+'">',
        '<span class="layoutHistoryMain"><b>'+esc((arr(item.modelCodes)[0]||item.fileName||'Layout'))+'</b><small>'+esc(docText(item.documentType))+' · '+esc(new Date(item.at).toLocaleString())+'</small></span>',
        '<span class="layoutFinal '+cls+'">'+esc(s.status||'REVIEW')+'</span>',
        '</button>'
      ].join('');
    }).join('');
  }
  function paint(){
    if(!modal) return;
    const result=modal.querySelector('[data-layout-result]');
    if(result) result.innerHTML=reportHtml();
    const history=modal.querySelector('[data-layout-history-list]');
    if(history) history.innerHTML=historyHtml();
    const rerun=modal.querySelector('[data-layout-rerun]');
    if(rerun) rerun.disabled=!currentFile||busy;
  }
  function setStage(text,kind){
    if(!modal) return;
    const el=modal.querySelector('[data-layout-stage]');
    if(!el) return;
    el.textContent=text||'';
    el.className='layoutStage'+(kind?' is-'+kind:'');
  }
  function setBusy(next){
    busy=Boolean(next);
    if(!modal) return;
    modal.classList.toggle('is-busy',busy);
    modal.querySelectorAll('[data-layout-file],[data-layout-rerun]').forEach(button=>button.disabled=busy);
  }
  async function fetchCpRows(){
    const response=await fetch('/api/data/cp',{credentials:'same-origin',cache:'no-store'});
    if(!response.ok) throw new Error('CP_REFERENCE_UNAVAILABLE');
    const data=await response.json();
    return Array.isArray(data&&data.rows)?data.rows:[];
  }
  async function nativePdfText(file,onPage){
    try{
      if(!root.BLPerf||typeof root.BLPerf.ensureLibrary!=='function') return {text:'',pages:0,error:'PDF_LIBRARY_UNAVAILABLE'};
      await root.BLPerf.ensureLibrary('pdf');
      if(!root.pdfjsLib) return {text:'',pages:0,error:'PDF_LIBRARY_UNAVAILABLE'};
      const bytes=new Uint8Array(await file.arrayBuffer());
      const task=root.pdfjsLib.getDocument({data:bytes});
      const pdf=await task.promise;
      const chunks=[];
      const total=Math.min(Number(pdf.numPages)||0,80);
      for(let pageNo=1;pageNo<=total;pageNo++){
        const page=await pdf.getPage(pageNo);
        const content=await page.getTextContent();
        const text=arr(content&&content.items).map(item=>item&&item.str||'').join(' ').replace(/\s+/g,' ').trim();
        chunks.push('[[PAGE '+pageNo+']] '+text);
        if(onPage) onPage(pageNo,total);
      }
      return {text:chunks.join('\n'),pages:total,error:''};
    }catch(_){return {text:'',pages:0,error:'PDF_TEXT_EXTRACTION_FAILED'};}
  }
  function aiTask(){
    return L(
      'Ekli layout PDF dosyasını eksiksiz incele. Belge türünü otomatik belirle, görünür ürün/model/renk/sipariş/ülke/kompozisyon/bakım/beden/barkod/fiyat alanlarını yapılandırılmış olarak çıkar ve yalnız görünür kanıta dayanan görsel/semantik REVIEW bulgularını listele. CP doğruluğu hakkında tahmin yapma.',
      'Inspect the attached layout PDF completely. Detect the document type, extract visible product/model/colour/order/country/composition/care/size/barcode/price fields in structured form, and list only visual/semantic REVIEW findings supported by visible evidence. Do not guess CP correctness.'
    );
  }
  async function askAi(file,nativeInfo,onProgress){
    const api=AI();
    if(!api||typeof api.askWithFiles!=='function') throw new Error('LCWAI_UNAVAILABLE');
    const result=await api.askWithFiles({
      source:'layout-control',
      task:aiTask(),
      context:{
        fileName:String(file.name||'').slice(0,180),
        pdfPages:Number(nativeInfo&&nativeInfo.pages)||null,
        nativeTextAvailable:Boolean(nativeInfo&&nativeInfo.text),
        workflow:'PDF extraction + visual QA only; Buyer Log performs CP comparison separately'
      },
      guide:GUIDE,
      files:[file],
      onProgress
    });
    return result;
  }
  function usefulAiData(result){
    if(result&&result.data&&typeof result.data==='object') return result.data;
    if(result&&result.structured&&result.structured.partial&&typeof result.structured.partial==='object') return result.structured.partial;
    return {};
  }
  function phaseText(event){
    if(!event) return L('LCW AI inceliyor…','LCW AI is reviewing…');
    if(event.phase==='uploading') return L('PDF LCW AI’a yükleniyor…','Uploading PDF to LCW AI…');
    if(event.phase==='sending') return L('LCW AI görsel kontrolü başladı…','LCW AI visual review started…');
    if(event.phase==='streaming') return L('LCW AI layout’u inceliyor…','LCW AI is inspecting the layout…');
    return L('LCW AI inceliyor…','LCW AI is reviewing…');
  }
  async function run(file){
    if(busy) return;
    if(!file||String(file.type||'').toLowerCase()!=='application/pdf'&&!/\.pdf$/i.test(file.name||'')){
      setStage(L('Lütfen bir PDF dosyası seçin.','Please select a PDF file.'),'error'); return;
    }
    currentFile=file; currentReport=null; filter='attention'; setBusy(true); paint();
    let cpRows=[], nativeInfo={text:'',pages:0,error:''}, local={}, aiData={}, aiUnavailable=false;
    try{
      setStage(L('PDF hazırlanıyor…','Preparing PDF…'),'busy');
      const cpPromise=fetchCpRows().catch(()=>[]);
      nativeInfo=await nativePdfText(file,(page,total)=>setStage(L('PDF okunuyor: '+page+'/'+total,'Reading PDF: '+page+'/'+total),'busy'));
      cpRows=await cpPromise;
      local=E().deriveLocalExtraction(nativeInfo.text,cpRows);
      setStage(cpRows.length?L('CP referansı hazır. LCW AI görsel kontrol yapıyor…','CP reference ready. LCW AI is running visual QA…'):L('CP referansı alınamadı; LCW AI görsel kontrol yapıyor…','CP reference unavailable; LCW AI is running visual QA…'),'busy');
      try{
        const aiResult=await askAi(file,nativeInfo,event=>setStage(phaseText(event),'busy'));
        aiData=usefulAiData(aiResult);
      }catch(error){
        aiUnavailable=true;
        if(!nativeInfo.text) throw error;
      }
      const extraction=E().mergeExtraction(local,aiData);
      currentReport=E().compare(extraction,cpRows,{aiUnavailable});
      if(!cpRows.length){
        currentReport.checks.unshift({
          rule:'CP_REFERENCE',category:'REFERENCE',status:'REVIEW',expected:[],actual:[],
          detail:L('CP verisi alınamadığı için reference karşılaştırmaları tamamlanamadı.','CP data could not be loaded, so reference comparisons are incomplete.'),
          source:'CP'
        });
        currentReport.summary=E().summarize(currentReport.checks);
      }
      saveHistory(currentReport,file.name);
      setStage(
        currentReport.summary.status==='ERROR'?L('Kontrol tamamlandı: hata bulundu.','Check complete: errors found.'):
          (currentReport.summary.status==='REVIEW'?L('Kontrol tamamlandı: inceleme gerekiyor.','Check complete: review required.'):L('Kontrol tamamlandı.','Check complete.')),
        currentReport.summary.status==='ERROR'?'error':(currentReport.summary.status==='REVIEW'?'review':'ok')
      );
    }catch(error){
      const api=AI();
      const message=api&&typeof api.errorText==='function'&&error&&error.lcwai?api.errorText(error):L('Layout kontrolü tamamlanamadı. CP/LCW AI bağlantısını kontrol edip tekrar deneyin.','Layout check could not be completed. Check CP/LCW AI connectivity and try again.');
      setStage(message,'error');
    }finally{
      setBusy(false); paint();
    }
  }
  function openHistory(id){
    const item=loadHistory().find(entry=>entry&&entry.id===id);
    if(!item) return;
    currentFile=null;
    currentReport={
      documentType:item.documentType,
      summary:item.summary,
      extraction:{modelCodes:item.modelCodes||[],colourCodes:item.colourCodes||[]},
      checks:item.checks||[]
    };
    filter='attention'; paint();
    setStage(L('Geçmiş kontrol görüntüleniyor. Yeniden kontrol için PDF’i tekrar yükleyin.','Viewing a previous check. Upload the PDF again to recheck.'),'');
  }
  function bind(){
    if(!modal) return;
    const input=modal.querySelector('[data-layout-file-input]');
    const drop=modal.querySelector('[data-layout-drop]');
    modal.addEventListener('click',event=>{
      const button=event.target.closest('button');
      if(!button) return;
      if(button.matches('[data-layout-close]')){close();return;}
      if(button.matches('[data-layout-file]')){input.click();return;}
      if(button.matches('[data-layout-rerun]')){if(currentFile)run(currentFile);return;}
      if(button.matches('[data-layout-filter]')){filter=button.dataset.layoutFilter;paint();return;}
      if(button.matches('[data-layout-history]')){openHistory(button.dataset.layoutHistory);return;}
      if(button.matches('[data-layout-history-clear]')){clearHistory();paint();return;}
    });
    input.addEventListener('change',()=>{const file=input.files&&input.files[0];input.value='';if(file)run(file);});
    ['dragenter','dragover'].forEach(type=>drop.addEventListener(type,event=>{event.preventDefault();drop.classList.add('is-drag');if(event.dataTransfer)event.dataTransfer.dropEffect='copy';}));
    drop.addEventListener('dragleave',event=>{if(event.relatedTarget&&drop.contains(event.relatedTarget))return;drop.classList.remove('is-drag');});
    drop.addEventListener('drop',event=>{event.preventDefault();drop.classList.remove('is-drag');const file=event.dataTransfer&&event.dataTransfer.files&&event.dataTransfer.files[0];if(file)run(file);});
  }
  function open(){
    ensureStyle();
    if(modal){modal.remove();modal=null;}
    currentFile=null;currentReport=null;busy=false;filter='attention';
    modal=document.createElement('div');
    modal.className='layoutControlOverlay';
    modal.innerHTML=[
      '<div class="layoutControlModal" role="dialog" aria-modal="true" aria-labelledby="layoutControlTitle">',
      '<header class="layoutControlHead"><div><span class="layoutEyebrow">LCW AI</span><h2 id="layoutControlTitle">'+esc(L('Layout Kontrolü','Layout Control'))+'</h2><p>'+esc(L('PDF’i yükle; Buyer Log modeli bulsun, CP ile karşılaştırsın ve LCW AI görsel kalite kontrolü yapsın.','Upload the PDF; Buyer Log finds the model, compares it with CP and runs LCW AI visual QA.'))+'</p></div><button type="button" class="layoutIconBtn" data-layout-close aria-label="'+esc(L('Kapat','Close'))+'">×</button></header>',
      '<div class="layoutControlBody">',
      '<section class="layoutUploadCard" data-layout-drop><div class="layoutDropIcon">PDF</div><div><b>'+esc(L('Layout PDF’ini buraya sürükle','Drop the layout PDF here'))+'</b><p>'+esc(L('Care Label ve Price Tag otomatik tanınır. Model bilgisi manuel girilmez.','Care Label and Price Tag are detected automatically. No manual model entry.'))+'</p></div><button type="button" class="lcwaiBtn is-primary" data-layout-file>'+esc(L('PDF Seç','Choose PDF'))+'</button><input type="file" accept="application/pdf,.pdf" data-layout-file-input hidden></section>',
      '<div class="layoutStage" data-layout-stage>'+esc(L('PDF bekleniyor.','Waiting for PDF.'))+'</div>',
      '<div data-layout-result></div>',
      '<section class="layoutHistory"><div class="layoutHistoryHead"><div><b>'+esc(L('Layout Geçmişi','Layout History'))+'</b><small>'+esc(L('Bu kullanıcı ve cihazda son kontroller','Recent checks for this user and device'))+'</small></div><div><button type="button" class="lcwaiBtn" data-layout-rerun disabled>'+esc(L('Yeniden Kontrol','Recheck'))+'</button><button type="button" class="lcwaiBtn" data-layout-history-clear>'+esc(L('Geçmişi Temizle','Clear History'))+'</button></div></div><div data-layout-history-list></div></section>',
      '</div>',
      '<footer class="layoutControlFoot"><span>'+esc(L('CP = kaynak veri · Buyer Log = deterministik kontrol · LCW AI = görsel/semantik REVIEW','CP = reference · Buyer Log = deterministic verification · LCW AI = visual/semantic REVIEW'))+'</span><button type="button" class="lcwaiBtn" data-layout-close>'+esc(L('Kapat','Close'))+'</button></footer>',
      '</div>'
    ].join('');
    document.body.appendChild(modal);
    bind();paint();
    modal.addEventListener('click',event=>{if(event.target===modal)close();});
    return true;
  }
  function close(){
    if(!modal) return;
    if(busy&&AI()) AI().cancel();
    modal.remove();modal=null;currentFile=null;currentReport=null;busy=false;
  }

  root.BLLayoutControl={open,close,run,_loadHistory:loadHistory,_clearHistory:clearHistory};
})(typeof window!=='undefined'?window:null);
