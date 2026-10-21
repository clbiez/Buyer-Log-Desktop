'use strict';

(function (root) {
  if (!root || root.BLLayoutControl) return;

  const HISTORY_MAX=30;
  const E=()=>root.BLLayoutControlEngine;
  const AI=()=>root.BuyerLogAI;
  const template=()=>root.BLLayoutTemplate;
  const reader=()=>root.BLLayoutReader;
  const reviewApi=()=>root.BLLayoutAIReview;
  const isEn=()=>String(root.appLang||document.documentElement.lang||'tr').toLowerCase().startsWith('en');
  const L=(tr,en)=>isEn()?en:tr;
  const esc=value=>String(value==null?'':value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const arr=value=>Array.isArray(value)?value:[];
  let modal=null, currentFile=null, currentReport=null, busy=false, filter='attention', activeAbort=null, activeRequestId='', historyCache=[], historyLoaded=false;
  let pdfDocument=null,pageNumber=1,pageCount=0,selectedRule='',renderToken=0,renderedPage='',annotationMode=false,reviewSaving=false,queuedFiles=[],sessions=new Map();
  let onCloseCallback=null;
  const identitySessions=new Map();
  let epoch=0;
  const commentDrafts=new Map();
  const expandedChecks=new Set();
  const expansionKey=rule=>String(currentReport&&currentReport.id||'')+'|'+rule;

  function ensureStyle(){
    if(document.querySelector('link[data-layout-control-style]')) return;
    const link=document.createElement('link');
    link.rel='stylesheet'; link.href='layout-control.css?rev=2'; link.dataset.layoutControlStyle='1';
    document.head.appendChild(link);
  }
  function loadHistory(){
    return historyLoaded?historyCache:[];
  }
  async function refreshHistory(){
    try{
      const response=await fetch('/api/lcwai/layout-control/history?limit='+HISTORY_MAX,{credentials:'same-origin',cache:'no-store'});
      if(!response.ok) throw new Error('LAYOUT_HISTORY_UNAVAILABLE');
      const data=await response.json();
      historyCache=arr(data&&data.runs).slice(0,HISTORY_MAX);
      historyLoaded=true;
    }catch(_){
      if(!historyLoaded){historyCache=[];historyLoaded=true;}
    }
    paint();
    return historyCache;
  }
  function historyPayload(report,fileName){
    const ex=report&&report.extraction||{};
    return {
      fileName:String(fileName||'').slice(0,180),
      documentType:report&&report.documentType||'UNKNOWN',mode:report.mode,aiSummary:report.aiSummary,
      summary:report&&report.summary||{},
      extraction:Object.fromEntries(['modelCodes','specialCodes','colourCodes','colours','orderNumbers','countries','composition','cashPrices','instalmentPrices'].map(f=>[f,arr(ex[f])])),reference:report.reference,reading:report.reading,
      modelCodes:arr(ex.modelCodes).slice(0,5),
      colourCodes:arr(ex.colourCodes).slice(0,5),
      referenceRowCount:arr(report&&report.referenceRows).length,
      templateVersion:report.templateVersion||template().VERSION,
      fileHash:report.fileHash||'',
      checks:arr(report&&report.checks).slice(0,240).map(check=>({
        ...check,
        rule:check.rule,category:check.category,status:check.status,
        expected:arr(check.expected).slice(0,20),actual:arr(check.actual).slice(0,20),
        detail:String(check.detail||'').slice(0,1200),source:String(check.source||'').slice(0,120)
      }))
    };
  }
  async function saveHistory(report,fileName){
    if(!report) return;
    const payload=historyPayload(report,fileName);
    const response=await fetch('/api/lcwai/layout-control/history',{
      method:'POST',credentials:'same-origin',cache:'no-store',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(payload)
    });
    if(!response.ok)throw new Error('LAYOUT_HISTORY_SAVE_FAILED');
    const data=await response.json();
    report.id=data.run.id;
    historyCache=[data.run,...loadHistory().filter(r=>r.id!==data.run.id)].slice(0,HISTORY_MAX);historyLoaded=true;paint();
  }
  function clearHistory(){
    historyCache=[];historyLoaded=true;
    paint();
    fetch('/api/lcwai/layout-control/history',{method:'DELETE',credentials:'same-origin',cache:'no-store'}).catch(()=>{});
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
    if(type==='INNER_BARCODE')return L('İç barkod etiketi','Inner barcode label');
    if(type==='MIXED')return L('Bakım / İç barkod / Fiyat etiketi','Care / Inner barcode / Price tag');
    return L('Bilinmeyen Layout','Unknown Layout');
  }
  function ruleText(rule){
    const finding=arr(currentReport&&currentReport.checks).find(c=>c.rule===rule);if(finding&&finding.title)return finding.title;
    const entry=template().rules.find(r=>r.id===String(rule||'').replace(/^STD_/,'').replace(/_\d+$/,''));
    if(entry)return entry.title[isEn()?'en':'tr'];
    if(String(rule||'').startsWith('MANUAL_'))return L('Buyer işareti','Buyer annotation');
    const map={
      MODEL_MATCH:L('Model Adı','Model Name'),
      ORDER_MATCH:L('Sipariş No','Order No'),
      SPECIAL_CODE_MATCH:'Special Code',
      COLOR_CODE_MATCH:L('Renk Kodu','Colour Code'),
      COLOR_NAME_MATCH:L('Renk Adı','Colour Name'),
      SEASON_MATCH:L('Sezon Kodu','Season Code'),
      MAG_MATCH:L('MAG Kodu','MAG Code'),
      MMYG_MATCH:L('MMYG Kodu','MMYG Code'),
      LINE_MATCH:L('Line Kodu','Line Code'),
      COUNTRY_MATCH:L('Üretim Yeri','Country of Origin'),
      PRODUCT_MAIN_DEFINITION_MATCH:'Product Main Definition',
      COMPOSITION_MATCH:L('Kumaş Karışımı','Composition'),
      CARE_INSTRUCTION_MATCH:L('Yıkama Talimatı','Care Instruction'),
      WARNING_MATCH:L('Uyarılar','Warnings'),
      SIZE_RANGE_MATCH:L('Beden Aralığı','Size Range'),
      BARCODE_MATCH:L('Barkod','Barcode'),
      BARCODE_READABLE:L('Barkod Okunabilirliği','Barcode Readability'),
      BARCODE_SIZE_MATCH:L('Barkod / Beden','Barcode / Size'),
      QR_MATCH:'QR',
      QR_READABLE:L('QR Okunabilirliği','QR Readability'),
      PRICE_MATCH:L('Fiyat','Price'),
      PRODUCT_CLASS_MATCH:L('Ürün Sınıfı','Product Class'),
      FIT_MATCH:L('Kalıp / Fit','Fit')
    };
    return map[rule]||String(rule||'');
  }
  function valueHtml(values){
    const list=arr(values).filter(value=>String(value||'').trim());
    return list.length?list.map(value=>'<span class="layoutValue">'+esc(value)+'</span>').join(''):'<span class="layoutMuted">—</span>';
  }
  function standardLink(check){
    const source=template().SOURCES[check.standardType];
    if(!source||check.category==='AI_REVIEW'&&!check.standardPage)return '';
    const page=check.standardPage||1;
    return '<p><a href="'+esc(source.url)+'#page='+page+'" target="_blank" rel="noopener">'+esc(source.code+' rev.'+source.revision+' · PDF '+L('sayfa ','page ')+page)+'</a> <button type="button" class="lcwaiBtn" data-layout-standard="'+esc(check.rule)+'">'+esc(L('Şablon görseli','Template image'))+'</button></p><div data-layout-reference="'+esc(check.rule)+'" hidden></div>';
  }
  function expectedValues(check){const rule=template().rules.find(r=>r.id===check.ruleId);return rule?[rule.expected[isEn()?'en':'tr']]:check.expected;}
  function reviewHtml(check){
    return '<div class="layoutReviewActions">'+[['APPROVED',L('Onay','Approve')],['REJECTED',L('Hata','Error')],['NOT_APPLICABLE',L('Kapsam dışı','Not applicable')],['PENDING',L('Onay bekliyor','Pending approval')]].map(([value,label])=>'<button type="button" class="lcwaiBtn '+(check.decision===value?'is-primary':'')+'" data-layout-decision="'+value+'" data-rule="'+esc(check.rule)+'" '+(reviewSaving||!currentReport.id?'disabled':'')+'>'+esc(label)+'</button>').join('')+
      '<label>'+esc(L('Yorum','Comment'))+'<textarea maxlength="1200" data-layout-comment="'+esc(check.rule)+'">'+esc(commentDrafts.get(currentReport.id+'|'+check.rule)??check.comment??'')+'</textarea></label><button type="button" class="lcwaiBtn" data-layout-save-comment="'+esc(check.rule)+'" '+(reviewSaving||!currentReport.id?'disabled':'')+'>'+esc(L('Yorumu Kaydet','Save Comment'))+'</button>'+
      (check.comment?'<p>'+esc(check.comment)+'</p>':'')+'</div>';
  }
  async function persistReview(check,decision){
    if(reviewSaving||!currentReport||!currentReport.id)return;
    const report=currentReport;
    const reviewEpoch=epoch;
    const field=modal.querySelector('[data-layout-comment="'+check.rule+'"]');
    const comment=field?field.value:check.comment||'';
    reviewSaving=true;
    try{
      const response=await fetch('/api/lcwai/layout-control/history/'+encodeURIComponent(report.id),{method:'PATCH',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({check:{...check,comment,decision:decision||check.decision||'PENDING'}})});
      if(!response.ok)throw new Error('LAYOUT_REVIEW_SAVE_FAILED');
      const data=await response.json();
      report.checks=data.run.checks;report.summary=data.run.summary;
      historyCache=[data.run,...loadHistory().filter(r=>r.id!==data.run.id)].slice(0,HISTORY_MAX);
      if(epoch===reviewEpoch)setStage(L('Layout yorumu/kararı kaydedildi. CP değiştirilmedi.','Layout comment/decision saved. CP was not changed.'),'ok');
    }catch(_){if(epoch===reviewEpoch)setStage(L('Karar kaydedilemedi; tekrar deneyin.','Decision could not be saved; try again.'),'error');}
    finally{if(epoch===reviewEpoch){reviewSaving=false;paint();}}
  }
  function paintDocument(){
    if(!modal)return;
    const host=modal.querySelector('[data-layout-document]');
    if(!host)return;
    if(!pdfDocument){host.innerHTML='<div class="layoutEmpty">'+esc(currentFile?L('PDF önizlemesi hazırlanıyor…','Preparing PDF preview…'):L('Belgeyi yükleyin. İşaretler belge üzerinde, yorumlar yanında görünür.','Upload a document. Markers appear on the document, comments alongside.'))+'</div>';renderedPage='';return;}
    const key=currentFile.name+'|'+currentFile.lastModified+'|'+pageNumber;
    if(renderedPage!==key){
      renderedPage=key;
      host.innerHTML='<div class="layoutPageTools"><button type="button" class="lcwaiBtn" data-layout-prev '+(pageNumber<=1?'disabled':'')+'>←</button><span>'+esc(currentFile.name)+' · '+pageNumber+'/'+pageCount+'</span><button type="button" class="lcwaiBtn" data-layout-next '+(pageNumber>=pageCount?'disabled':'')+'>→</button><button type="button" class="lcwaiBtn" data-layout-annotate>'+esc(L('Belgeye işaret ekle','Add marker'))+'</button></div><p class="layoutMuted">'+esc(L('AI kutuları yaklaşık konum önerileridir. İşarete tıklayın; yorumu ve şablonu yanında görün.','AI boxes suggest approximate locations. Click a marker to see its comment and template alongside.'))+'</p><div class="layoutPage"><canvas aria-label="'+esc(L('Layout sayfası','Layout page'))+'"></canvas><div class="layoutMarkers"></div></div>';
      renderPage(pdfDocument,pageNumber,host.querySelector('canvas'));
    }
    const button=host.querySelector('[data-layout-annotate]');
    if(button){button.classList.toggle('is-primary',annotationMode);button.disabled=busy||reviewSaving||!currentReport||!currentReport.id;}
    const layer=host.querySelector('.layoutMarkers');
    if(layer){
      layer.classList.toggle('is-annotating',annotationMode);
      layer.innerHTML=arr(currentReport&&currentReport.checks).filter(c=>c.page===pageNumber&&c.bbox).map(c=>{
        const [x,y,w,h]=c.bbox;
        return '<button type="button" class="layoutMarker is-'+String(c.status).toLowerCase()+(c.rule===selectedRule?' is-selected':'')+'" data-layout-locate="'+esc(c.rule)+'" style="left:'+(x*100)+'%;top:'+(y*100)+'%;width:'+(w*100)+'%;height:'+(h*100)+'%" aria-label="'+esc(ruleText(c.rule)+' · '+statusText(c.status))+'"><span>'+esc(statusText(c.status))+'</span></button>';
      }).join('');
    }
  }
  async function renderPage(pdf,page,canvas){
    const token=++renderToken;
    try{
      const p=await pdf.getPage(page),base=p.getViewport({scale:1});
      const viewport=p.getViewport({scale:Math.min(2,1400/base.width,2200/base.height)});
      if(token!==renderToken||!canvas.isConnected)return;
      canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
      await p.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
    }catch(_){setStage(L('Sayfa önizlemesi açılamadı.','Page preview could not be opened.'),'review');}
  }
  async function showStandard(check){
    const source=template().SOURCES[check.standardType],host=modal&&Array.from(modal.querySelectorAll('[data-layout-reference]')).find(el=>el.dataset.layoutReference===check.rule);
    if(!source||!host)return;
    host.hidden=false;
    host.innerHTML='<h4>'+esc(L('Olması gereken şablon · ','Expected template · ')+source.code+' · PDF '+check.standardPage)+'</h4><p>'+esc(arr(expectedValues(check)).join(' '))+'</p><canvas></canvas>';
    const canvas=host.querySelector('canvas');
    try{
      const pdf=await root.pdfjsLib.getDocument(source.url).promise;
      const p=await pdf.getPage(check.standardPage||1),base=p.getViewport({scale:1}),viewport=p.getViewport({scale:Math.min(2,1000/base.width)});
      if(!canvas.isConnected){pdf.destroy();return;}
      canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
      await p.render({canvasContext:canvas.getContext('2d'),viewport}).promise;await pdf.destroy();
    }catch(_){host.textContent=L('Kaynak şablon görseli açılamadı. Standart bağlantısını kullanın.','Source template image could not be opened. Use the standard link.');}
  }
  function locate(rule){
    const check=arr(currentReport&&currentReport.checks).find(c=>c.rule===rule);if(!check)return;
    selectedRule=rule;expandedChecks.add(expansionKey(rule));if(check.page&&check.page<=pageCount)pageNumber=check.page;filter='all';paint();
    const card=modal.querySelector('[data-layout-check="'+rule+'"]');if(card)card.scrollIntoView({block:'nearest'});
    if(check.standardType)showStandard(check);
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
    const decision=template().reviewStatus(currentReport.checks);
    return [
      '<div class="layoutReport">',
      '<div class="layoutReportTop">',
      '<div><span class="layoutEyebrow">'+esc(docText(currentReport.documentType))+'</span>',
      '<h3>'+esc(arr(ex.modelCodes)[0]||L('Model okunamadı','Model unreadable'))+'</h3>',
      '<p>'+esc([arr(ex.colourCodes)[0],arr(ex.colours)[0]].filter(Boolean).join(' · ')||L('PDF ↔ CP otomatik kontrol','Automatic PDF ↔ CP verification'))+'</p></div>',
      '<span class="layoutFinal '+(decision==='APPROVED'?'is-ok':decision==='REJECTED'?'is-error':'is-review')+'">'+esc(decision==='APPROVED'?L('LAYOUT ONAYLI','LAYOUT APPROVED'):decision==='REJECTED'?L('HATA / RED','ERROR / REJECTED'):L('ONAY BEKLİYOR','PENDING APPROVAL'))+'</span>',
      '</div>',
      summaryHtml(s),
      extractionHtml(),
      '<div class="layoutFilters" role="group" aria-label="'+esc(L('Sonuç filtresi','Result filter'))+'">',
      [['attention',L('Hata + İncele','Errors + Review')],['all',L('Tümü','All')],['errors',L('Hatalar','Errors')],['review',L('İncele','Review')],['notchecked',L('Kontrol edilmedi','Not checked')]].map(item=>'<button type="button" data-layout-filter="'+item[0]+'" class="'+(filter===item[0]?'is-active':'')+'">'+esc(item[1])+'</button>').join(''),
      '</div>',
      '<div class="layoutChecks">',
      checks.length?'<div class="layoutCheckColumns" aria-hidden="true"><span>'+esc(L('Kontrol / Karar','Check / Decision'))+'</span><span>'+esc(L('Bulunan','Found'))+'</span><span>'+esc(L('Olması gereken','Expected'))+'</span><span>'+esc(L('LCW AI yorumu','LCW AI comment'))+'</span></div>'+checks.map(check=>[
        '<details data-layout-check="'+esc(check.rule)+'" class="layoutCheck is-'+String(check.status||'').toLowerCase()+(check.rule===selectedRule?' is-selected':'')+'" '+(expandedChecks.has(expansionKey(check.rule))?'open':'')+'>',
        '<summary class="layoutCheckRow">',
        '<span class="layoutRowIdentity"><span class="layoutCheckHead"><span class="layoutStatus">'+esc(statusText(check.status))+'</span>'+(check.severity==='CRITICAL'?'<strong class="layoutCritical">'+esc(L('KRİTİK','CRITICAL'))+'</strong>':'')+'</span><b>'+esc(ruleText(check.rule))+'</b><small>'+esc([check.section?(check.section==='DOCUMENT'?L('Belge','Document'):docText(check.section)):'',check.orderCode,check.page?L('s. ','p. ')+check.page:''].filter(Boolean).join(' · '))+'</small><small class="layoutBuyerDecision">'+esc(L('Buyer: ','Buyer: ')+({APPROVED:L('Onaylı','Approved'),REJECTED:L('Hata / Red','Error / Rejected'),NOT_APPLICABLE:L('Kapsam dışı','Not applicable')}[check.decision]||L('Onay bekliyor','Pending approval')))+'</small></span>',
        '<span class="layoutRowCell" data-label="'+esc(L('Bulunan','Found'))+'"><span class="layoutRowPreview">'+valueHtml(check.actual)+'</span></span>',
        '<span class="layoutRowCell" data-label="'+esc(L('Olması gereken','Expected'))+'"><span class="layoutRowPreview">'+valueHtml(expectedValues(check))+'</span></span>',
        '<span class="layoutRowCell layoutRowComment" data-label="'+esc(L('LCW AI yorumu','LCW AI comment'))+'"><span class="layoutRowPreview">'+esc(check.detail||check.correction||'—')+'</span><span class="layoutRowExpand">'+esc(L('Ayrıntı / Onay / Yorum','Details / Approve / Comment'))+' <span aria-hidden="true">⌄</span></span></span>',
        '</summary><div class="layoutCheckDetail">',
        check.page?'<button type="button" class="lcwaiBtn" data-layout-locate="'+esc(check.rule)+'">'+esc(L('Sayfada göster: ','Show on page: ')+check.page)+'</button>':'',
        '<div class="layoutCompare"><div><small>'+esc(L('Layout / Bulunan','Layout / Found'))+'</small>'+valueHtml(check.actual)+'</div><div><small>'+esc(L('Olması gereken / Şablon','Expected / Template'))+'</small>'+valueHtml(expectedValues(check))+'</div></div>',
        check.detail?'<p>'+esc(check.detail)+'</p>':'',
        check.correction?'<p><b>'+esc(L('Düzeltme: ','Correction: '))+'</b>'+esc(check.correction)+'</p>':'',
        check.source==='LCW AI'&&['STANDARD','AI_REVIEW'].includes(check.category)?'<p class="layoutMuted">'+esc(L('AI önerisi: ','AI suggestion: ')+({MATCH:L('Eşleşiyor','Matches'),ERROR:L('Hata','Error'),REVIEW:L('Teyit gerekli','Needs confirmation'),NOT_VISIBLE:L('PDF’de görülemiyor','Not visible in PDF'),NOT_APPLICABLE:L('Kapsam dışı','Not applicable'),PASS:L('Uygun görünüyor','Appears compliant'),ISSUE:L('Sorun tespit edildi','Issue detected'),NA:L('Uygulanmıyor önerisi','Not applicable suggested'),UNCERTAIN:L('Kanıt yetersiz','Insufficient evidence')}[check.aiVerdict]||''))+'</p>':'',
        ['STANDARD','ANNOTATION','AI_REVIEW'].includes(check.category)?reviewHtml(check):'',
        standardLink(check),
        '<footer>'+esc(check.source||'CP ↔ Layout')+'</footer>',
        '</div></details>'
      ].join('')).join(''):'<div class="layoutEmpty">'+esc(L('Bu filtrede sonuç yok.','No results in this filter.'))+'</div>',
      '</div>',
      '</div>'
    ].join('');
  }
  function extractionHtml(){
    const ex=currentReport.extraction||{},reference=currentReport.reference||{};
    if(currentReport.mode==='LCW_AI')return '<div class="layoutExtraction"><b>'+esc(L('LCW AI değerlendirmesi','LCW AI assessment'))+'</b><p>'+esc(L('Aktarılan CP siparişleri: ','Transferred CP orders: ')+(arr(reference.orderCodes).join(', ')||'—'))+'</p>'+(arr(reference.unmatchedOrderCodes).length?'<p>'+esc(L('CP kaydı bulunamayan siparişler: ','Orders without a CP record: ')+reference.unmatchedOrderCodes.join(', '))+'</p>':'')+(reference.status==='AMBIGUOUS'?'<p>'+esc(L('Birden fazla CP adayı LCW AI’a iletildi.','Multiple CP candidates were supplied to LCW AI.'))+'</p>':'')+'<div class="layoutAiSummary">'+esc(currentReport.aiSummary||'').replace(/\n/g,'<br>')+'</div></div>';

    const fields=[['MODEL_MATCH',L('Model adı','Model name'),'modelCodes'],['ORDER_MATCH',L('Sipariş','Order'),'orderNumbers'],['SPECIAL_CODE_MATCH',L('Özel kod','Special code'),'specialCodes'],['COLOR_CODE_MATCH',L('Renk kodu','Colour code'),'colourCodes'],['COLOR_NAME_MATCH',L('Renk adı','Colour name'),'colours'],['COUNTRY_MATCH',L('Üretim yeri','Origin'),'countries'],currentReport.documentType==='CARE_LABEL'?['COMPOSITION_MATCH',L('Ana kumaş','Main fabric'),'composition']:['PRICE_MATCH',L('Peşin satış fiyatı','Cash retail price'),'cashPrices']];
    return '<div class="layoutExtraction"><b>'+esc(L('Okunan alanlar ve CP karşılaştırması','Extracted fields and CP comparison'))+'</b><p>'+esc(reference.status==='MATCH'?L('Eşleşen CP siparişi: ','Matched CP order: ')+arr(reference.orderCodes).join(', '):reference.status==='AMBIGUOUS'?L('Birden fazla CP adayı var.','Multiple CP candidates.'):L('CP siparişi eşleştirilemedi.','CP order not matched.'))+'</p><table><thead><tr><th>'+esc(L('Alan','Field'))+'</th><th>Layout</th><th>CP</th><th>'+esc(L('Sonuç','Result'))+'</th></tr></thead><tbody>'+fields.map(([rule,label,field])=>{
      const check=arr(currentReport.checks).find(c=>c.rule===rule);
      if(!check&&!arr(ex[field]).length)return '';
      return '<tr><th>'+esc(label)+'</th><td>'+valueHtml(ex[field])+'</td><td>'+valueHtml(check&&check.expected)+'</td><td>'+esc(check?statusText(check.status):L('Okundu','Read'))+'</td></tr>';
    }).join('')+'</tbody></table>'+ (arr(ex.instalmentPrices).length?'<p>'+esc(L('Taksitli fiyat (ayrı): ','Instalment price (separate): ')+ex.instalmentPrices.join(', '))+'</p>':'')+'</div>';
  }
  function historyHtml(){
    const history=loadHistory();
    if(!history.length) return '<div class="layoutEmpty">'+esc(L('Henüz kayıtlı kontrol yok.','No saved checks yet.'))+'</div>';
    return history.slice(0,12).map(item=>{
      const s=item.summary||{};
      const cls=item.reviewStatus==='REJECTED'?'is-error':item.reviewStatus==='APPROVED'?'is-ok':'is-review';
      return [
        '<button type="button" class="layoutHistoryItem" data-layout-history="'+esc(item.id)+'">',
        '<span class="layoutHistoryMain"><b>'+esc((arr(item.modelCodes)[0]||item.fileName||'Layout'))+'</b><small>'+esc(docText(item.documentType))+' · '+esc(new Date(item.at).toLocaleString())+'</small></span>',
        '<span class="layoutFinal '+cls+'">'+esc(item.reviewStatus==='APPROVED'?L('LAYOUT ONAYLI','LAYOUT APPROVED'):item.reviewStatus==='REJECTED'?L('HATA / RED','ERROR / REJECTED'):L('ONAY BEKLİYOR','PENDING APPROVAL'))+'</span>',
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
    const queue=modal.querySelector('[data-layout-queue]');if(queue){queue.disabled=busy;if(currentFile&&queuedFiles.includes(currentFile))queue.value=String(queuedFiles.indexOf(currentFile));}
    const attach=modal.querySelector('[data-layout-reattach]');if(attach){attach.hidden=Boolean(currentFile)||!currentReport||!currentReport.id;attach.disabled=busy;}
    paintDocument();
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
    modal.querySelectorAll('[data-layout-file],[data-layout-rerun],[data-layout-queue]').forEach(button=>button.disabled=busy);
  }
  async function fetchCpRows(){
    const response=await fetch('/api/data/cp',{credentials:'same-origin',cache:'no-store'});
    if(!response.ok) throw new Error('CP_REFERENCE_UNAVAILABLE');
    const data=await response.json();
    return Array.isArray(data&&data.rows)?data.rows:[];
  }
  async function nativePdfText(file,onPage){
    try{const info=await reader().readPdf(file,{signal:activeAbort&&activeAbort.signal});if(onPage)onPage(info.pages,info.pages);return info;}
    catch(error){return {text:'',pages:0,error:error.message};}
  }
  function identityEvidence(file,info,cpRows,signal,requestId){
    if(!identitySessions.has(file))identitySessions.set(file,(async()=>{
      const native=info||await reader().readPdf(file,{signal});
      const result=await reader().analyse(file,native,{signal,requestId,onProgress:event=>setStage(phaseText(event),'busy'),language:isEn()?'en':'tr'});
      if(result.error||result.data._reading.failedPages.length)throw new Error('LAYOUT_IDENTITY_INCOMPLETE');
      return {extraction:E().mergeExtraction(E().deriveLocalExtraction(native.text,cpRows),result.data),reading:result.data._reading,pages:native.pages,error:Boolean(result.error)};
    })().catch(error=>{identitySessions.delete(file);throw error;}));
    return identitySessions.get(file);
  }
  async function relatedEvidence(file,cpRows,signal,requestId){
    const related=[];
    for(let i=0;i<queuedFiles.length;i++){
      const peer=queuedFiles[i];if(peer===file)continue;
      try{
        const info=await identityEvidence(peer,null,cpRows,signal,requestId+'-peer-'+i),linked=reviewApi().linkOrders(info.extraction,cpRows);
        related.push({fileName:peer.name,pages:info.pages,identity:Object.fromEntries(['orderNumbers','modelCodes','specialCodes','colourCodes','jobNumbers','pageVariants'].map(key=>[key,arr(info.extraction[key])])),reading:info.reading,extractionIncomplete:info.error,cpOrders:reviewApi().projectRows(linked.referenceRows)});
      }catch(error){throw error;}
    }
    return related;
  }
  function phaseText(event){
    if(!event) return L('LCW AI inceliyor…','LCW AI is reviewing…');
    if(event.phase==='references')return L('Standartlar ve CP siparişleri LCW AI incelemesine hazırlanıyor…','Preparing standards and CP orders for LCW AI review…');
    if(event.phase==='rendering')return L('Sayfalar görsel okumaya hazırlanıyor: ','Preparing pages for visual reading: ')+arr(event.pages).join(', ');
    if(event.phase==='uploading') return L('Sayfa görselleri LCW AI’a yükleniyor…','Uploading page images to LCW AI…');
    if(event.phase==='sending') return L('LCW AI görsel kontrolü başladı…','LCW AI visual review started…');
    if(event.phase==='streaming') return L('LCW AI layout’u inceliyor…','LCW AI is inspecting the layout…');
    return L('LCW AI inceliyor…','LCW AI is reviewing…');
  }
  async function run(file){
    if(busy) return;
    if(!file||String(file.type||'').toLowerCase()!=='application/pdf'&&!/\.pdf$/i.test(file.name||'')){
      setStage(L('Lütfen bir PDF dosyası seçin.','Please select a PDF file.'),'error'); return;
    }
    if(file.size>20*1024*1024){setStage(L('Layout PDF’i en fazla 20 MB olabilir.','Layout PDF must be 20 MB or smaller.'),'error');return;}
    const cached=sessions.get(file);
    if(cached){currentFile=file;currentReport=cached.report;pdfDocument=cached.pdf;pageCount=pdfDocument.numPages;pageNumber=1;renderedPage='';paint();return;}
    const runEpoch=++epoch;
    currentFile=file; currentReport=null;pdfDocument=null;pageNumber=1;pageCount=0;renderedPage='';selectedRule='';annotationMode=false; filter='attention'; activeAbort=new AbortController(); activeRequestId='layout-'+Date.now().toString(36); setBusy(true); paint();
    let cpRows=[],cpAvailable=true,nativeInfo={text:'',pages:0,error:''};
    try{
      setStage(L('PDF hazırlanıyor…','Preparing PDF…'),'busy');
      const cpPromise=fetchCpRows().catch(()=>{cpAvailable=false;return [];});
      nativeInfo=await nativePdfText(file,(page,total)=>setStage(L('PDF okunuyor: '+page+'/'+total,'Reading PDF: '+page+'/'+total),'busy'));
      if(epoch!==runEpoch){reader().release(file);return;}
      if(!nativeInfo.pdf)throw new Error(nativeInfo.error||'PDF_PREVIEW_UNAVAILABLE');
      pdfDocument=nativeInfo.pdf;pageCount=nativeInfo.pages;paint();
      cpRows=await cpPromise;
      if(epoch!==runEpoch)return;
      setStage(L('LCW AI sipariş kimliğini okuyor…','LCW AI is reading order identities…'),'busy');
      const identityResult=await identityEvidence(file,nativeInfo,cpRows,activeAbort.signal,activeRequestId);
      const extraction=identityResult.extraction;
      const linked=reviewApi().linkOrders(extraction,cpRows);
      if(epoch!==runEpoch)return;
      const relatedLayouts=await relatedEvidence(file,cpRows,activeAbort.signal,activeRequestId);
      const reviewed=await reader().review(file,nativeInfo,{cpOrders:reviewApi().projectRows(linked.referenceRows),reference:linked.reference,cpAvailable,relatedLayouts,signal:activeAbort.signal,requestId:activeRequestId,onProgress:event=>setStage(phaseText(event),'busy'),language:isEn()?'en':'tr'});
      if(epoch!==runEpoch)return;
      currentReport=reviewApi().report(reviewed,{extraction,...linked},isEn()?'en':'tr');
      currentReport.fileHash=await fingerprint(file);
      if(epoch!==runEpoch)return;
      currentReport.templateVersion=template().VERSION;
      sessions.set(file,{report:currentReport,pdf:pdfDocument});
      if(sessions.size>10){const first=sessions.keys().next().value;reader().release(first);sessions.delete(first);}
      await saveHistory(currentReport,file.name);
      if(epoch!==runEpoch)return;
      const incomplete=currentReport.checks.some(c=>c.rule==='LCW_REVIEW_INCOMPLETE');
      setStage(incomplete?L('LCW AI incelemesi tamamlanamadı; yeniden deneyin.','LCW AI review was incomplete; please retry.'):L('LCW AI yorumları hazır. Buyer onayı bekleniyor.','LCW AI comments are ready. Awaiting buyer approval.'),incomplete?'review':'ok');
    }catch(error){
      if(epoch!==runEpoch)return;
      const api=AI();
      const message=error.message==='LAYOUT_IDENTITY_INCOMPLETE'?L('LCW AI tüm belgelerin sipariş kimliğini okuyamadı. Eksik eşleştirmeyle inceleme başlatılmadı; Yeniden Kontrol seçin.','LCW AI could not read all document identities. Review did not start with incomplete matching; select Recheck.'):error.message==='LAYOUT_PAGE_LIMIT'?L('Layout en fazla 80 sayfa olabilir. Belge bölünerek tekrar yüklenmelidir.','Layout may contain up to 80 pages. Split the document and upload again.'):api&&typeof api.errorText==='function'&&error&&error.lcwai?api.errorText(error):L('Layout kontrolü/kaydı tamamlanamadı. Bağlantıyı kontrol edip Yeniden Kontrol seçin.','Layout check/save could not be completed. Check connectivity and select Recheck.');
      setStage(message,'error');
    }finally{
      if(epoch===runEpoch){activeAbort=null; activeRequestId=''; setBusy(false); paint();}
    }
  }
  function openHistory(id){
    if(busy||reviewSaving)return;
    const item=loadHistory().find(entry=>entry&&entry.id===id);
    if(!item) return;
    const cached=Array.from(sessions.entries()).find(([,s])=>s.report.id===id);
    if(cached){currentFile=cached[0];currentReport=cached[1].report;pdfDocument=cached[1].pdf;pageCount=pdfDocument.numPages;pageNumber=1;renderedPage='';paint();return;}
    currentFile=null;pdfDocument=null;pageCount=0;
    currentReport={
      documentType:item.documentType,mode:item.mode,aiSummary:item.aiSummary,
      summary:item.summary,
      extraction:item.extraction||{modelCodes:item.modelCodes||[],colourCodes:item.colourCodes||[]},reference:item.reference,reading:item.reading,
      checks:item.checks||[]
    };
    currentReport.id=item.id;currentReport.templateVersion=item.templateVersion;
    currentReport.fileHash=item.fileHash||'';
    filter='attention'; paint();
    setStage(L('Geçmiş kontrol: kayıtlı işaretleri görmek için Orijinal PDF’i Aç seçin.','Previous check: select Open Original PDF to see saved markers.'),'');
  }
  async function fingerprint(file){return Array.from(new Uint8Array(await root.crypto.subtle.digest('SHA-256',await file.arrayBuffer()))).map(v=>v.toString(16).padStart(2,'0')).join('');}
  async function reattach(file){
    if(busy||!file||!currentReport)return;
    const report=currentReport,attachEpoch=epoch;setBusy(true);
    try{
      if(!report.fileHash)throw new Error('LAYOUT_LEGACY');
      if(await fingerprint(file)!==report.fileHash)throw new Error('LAYOUT_DIFFERENT');
      await root.BLPerf.ensureLibrary('pdf');
      const pdf=(await reader().readPdf(file)).pdf;
      if(epoch!==attachEpoch){reader().release(file);return;}
      currentFile=file;pdfDocument=pdf;pageCount=pdf.numPages;pageNumber=1;renderedPage='';sessions.set(file,{report,pdf});
      setStage(L('Orijinal belge doğrulandı; kayıtlı işaretler açıldı.','Original document verified; saved markers restored.'),'ok');
    }catch(error){setStage(error.message==='LAYOUT_LEGACY'?L('Eski kaydın belge parmak izi yok. PDF’i yeni kontrol olarak yükleyin.','This older record has no document fingerprint. Upload the PDF as a new check.'):L('PDF kayıtlı belgeyle eşleşmedi veya açılamadı; orijinal dosyayı seçin.','PDF did not match the saved document or could not be opened; choose the original file.'),'error');}
    finally{if(epoch===attachEpoch){setBusy(false);paint();}}
  }
  function bind(){
    if(!modal) return;
    const input=modal.querySelector('[data-layout-file-input]');
    const drop=modal.querySelector('[data-layout-drop]');
    modal.addEventListener('click',event=>{
      const button=event.target.closest('button');
      if(!button) return;
      if(button.matches('[data-layout-close]')){close();return;}
      if(button.matches('[data-layout-prev],[data-layout-next]')){pageNumber+=button.hasAttribute('data-layout-prev')?-1:1;pageNumber=Math.max(1,Math.min(pageCount,pageNumber));paintDocument();return;}
      if(button.matches('[data-layout-annotate]')){annotationMode=!annotationMode;paintDocument();return;}
      if(button.matches('[data-layout-locate]')){locate(button.dataset.layoutLocate);return;}
      if(button.matches('[data-layout-standard]')){const check=currentReport.checks.find(c=>c.rule===button.dataset.layoutStandard);if(check)showStandard(check);return;}
      if(button.matches('[data-layout-decision],[data-layout-save-comment]')){const check=currentReport.checks.find(c=>c.rule===(button.dataset.rule||button.dataset.layoutSaveComment));if(check)persistReview(check,button.dataset.layoutDecision);return;}
      if(button.matches('[data-layout-file]')){input.click();return;}
      if(button.matches('[data-layout-reattach]')){modal.querySelector('[data-layout-reattach-input]').click();return;}
      if(button.matches('[data-layout-rerun]')){if(currentFile){const file=currentFile;sessions.delete(file);identitySessions.delete(file);reader().release(file).then(()=>run(file));}return;}
      if(button.matches('[data-layout-filter]')){filter=button.dataset.layoutFilter;paint();return;}
      if(button.matches('[data-layout-history]')){openHistory(button.dataset.layoutHistory);return;}
      if(button.matches('[data-layout-history-clear]')){clearHistory();paint();return;}
    });
    modal.addEventListener('toggle',event=>{
      const row=event.target;
      if(!row.isConnected||!row.matches('details[data-layout-check]'))return;
      const key=expansionKey(row.dataset.layoutCheck);
      if(row.open)expandedChecks.add(key);else expandedChecks.delete(key);
    },true);
    modal.addEventListener('input',event=>{if(event.target.matches('[data-layout-comment]')&&currentReport)commentDrafts.set(currentReport.id+'|'+event.target.dataset.layoutComment,event.target.value);});
    modal.addEventListener('click',event=>{
      if(!annotationMode||!event.target.matches('.layoutMarkers')||busy||reviewSaving)return;
      const rect=event.target.getBoundingClientRect();
      const x=Math.max(0,Math.min(.94,(event.clientX-rect.left)/rect.width)),y=Math.max(0,Math.min(.96,(event.clientY-rect.top)/rect.height));
      const check={rule:'MANUAL_'+Date.now().toString(36),category:'ANNOTATION',status:'REVIEW',decision:'PENDING',severity:'COMMENT',page:pageNumber,bbox:[x,y,.06,.04],comment:'',expected:[],actual:[],source:'Buyer'};
      annotationMode=false;selectedRule=check.rule;expandedChecks.add(expansionKey(check.rule));filter='all';persistReview(check);
    });
    modal.querySelector('[data-layout-queue]').addEventListener('change',event=>{if(!busy)run(queuedFiles[Number(event.target.value)]);});
    input.addEventListener('change',()=>{const files=Array.from(input.files||[]);input.value='';receiveFiles(files);});
    modal.querySelector('[data-layout-reattach-input]').addEventListener('change',event=>{const file=event.target.files[0];event.target.value='';reattach(file);});
    ['dragenter','dragover'].forEach(type=>drop.addEventListener(type,event=>{event.preventDefault();drop.classList.add('is-drag');if(event.dataTransfer)event.dataTransfer.dropEffect='copy';}));
    drop.addEventListener('dragleave',event=>{if(event.relatedTarget&&drop.contains(event.relatedTarget))return;drop.classList.remove('is-drag');});
    drop.addEventListener('drop',event=>{event.preventDefault();event.stopPropagation();drop.classList.remove('is-drag');receiveFiles(Array.from(event.dataTransfer&&event.dataTransfer.files||[]));});
  }
  function receiveFiles(files){
    if(busy)return;
    const all=Array.from(files||[]);
    const valid=all.filter(f=>/\.pdf$/i.test(f.name||''));
    if(valid.length!==all.length||!valid.length||valid.length>10){setStage(L('Bir seferde 1–10 PDF layout seçin.','Choose 1–10 PDF layouts at a time.'),'error');return;}
    queuedFiles=valid;
    const select=modal.querySelector('[data-layout-queue]');select.innerHTML=valid.map((f,i)=>'<option value="'+i+'">'+esc(f.name)+'</option>').join('');select.hidden=valid.length<2;
    run(valid[0]);
  }
  function open(files,options={}){
    ensureStyle();
    if(modal)close();
    onCloseCallback=typeof options.onClose==='function'?options.onClose:null;
    currentFile=null;currentReport=null;busy=false;filter='attention';
    mount();
    if(files&&files.length)receiveFiles(files);
    return true;
  }
  function mount(){
    modal=document.createElement('div');
    modal.className='layoutControlOverlay';
    modal.innerHTML=[
      '<div class="layoutControlModal" role="dialog" aria-modal="true" aria-labelledby="layoutControlTitle">',
      '<header class="layoutControlHead"><div><span class="layoutEyebrow">LCW AI · '+template().VERSION+'</span><h2 id="layoutControlTitle">'+esc(L('Layout Kontrolü','Layout Control'))+'</h2><p>'+esc(L('Buyer Log siparişleri eşler; LCW AI standartlar ve CP bilgileriyle yorumlar. Onay buyer’a aittir; sonuçlar CP’ye yazılmaz.','Buyer Log links orders; LCW AI reviews with the standards and CP facts. Approval belongs to the buyer; results are not written to CP.'))+'</p></div><button type="button" class="layoutIconBtn" data-layout-close aria-label="'+esc(L('Kapat','Close'))+'">×</button></header>',
      '<div class="layoutControlBody">',
      '<section class="layoutUploadCard" data-layout-drop><div class="layoutDropIcon">PDF</div><div><b>'+esc(L('Layout PDF’ini buraya sürükle','Drop the layout PDF here'))+'</b><p>'+esc(L('Care Label / Price Tag · En fazla 80 sayfa/belge, 10 belge. Her belgeyi listeden seçerek kontrol edin.','Care Label / Price Tag · Up to 80 pages/document, 10 documents. Select each document from the list to review.'))+'</p></div><button type="button" class="lcwaiBtn is-primary" data-layout-file>'+esc(L('PDF Seç','Choose PDF'))+'</button><input type="file" accept="application/pdf,.pdf" multiple data-layout-file-input hidden></section>',
      '<label>'+esc(L('Layout belgesi','Layout document'))+' <select data-layout-queue aria-label="'+esc(L('Layout belgesi','Layout document'))+'" hidden></select></label>',
      '<details class="layoutTemplateGuide"><summary>'+esc(L('LCW AI’a aktarılan standartlar ve kapsam','Standards and scope supplied to LCW AI'))+'</summary><p>'+esc(L('LCW AI bakım talimatı, iç barkod ve fiyat etiketi bölümlerini ayırır; görünen alanları CP siparişleri ve orijinal standartlara göre yorumlar. Buyer Log ek kontrol yorumu üretmez.','LCW AI separates care instructions, inner barcodes and price tags, then reviews visible fields against CP orders and original standards. Buyer Log adds no label-control judgments.'))+'</p>'+Object.entries(template().SOURCES).map(([type,s])=>'<p><a href="'+esc(s.url)+'" target="_blank" rel="noopener">'+esc(docText(type)+' · '+s.code+' rev.'+s.revision+' · '+s.date)+'</a></p>').join('')+'</details>',
      '<div class="layoutStage" data-layout-stage>'+esc(L('PDF bekleniyor.','Waiting for PDF.'))+'</div>',
      '<button type="button" class="lcwaiBtn" data-layout-reattach hidden>'+esc(L('Orijinal PDF’i Aç','Open Original PDF'))+'</button><input type="file" accept="application/pdf,.pdf" data-layout-reattach-input hidden>',
      '<div class="layoutWorkspace"><div class="layoutDocument" data-layout-document></div><div class="layoutResult" data-layout-result></div></div>',
      '<div class="layoutHistory"><div class="layoutHistoryHead"><div><b>'+esc(L('Layout Geçmişi','Layout History'))+'</b><small>'+esc(L('Bu kullanıcı ve cihazda son kontroller','Recent checks for this user and device'))+'</small></div><div><button type="button" class="lcwaiBtn" data-layout-rerun disabled>'+esc(L('Yeniden Kontrol','Recheck'))+'</button><button type="button" class="lcwaiBtn" data-layout-history-clear>'+esc(L('Geçmişi Temizle','Clear History'))+'</button></div></div><div data-layout-history-list></div></div>',
      '</div>',
      '<footer class="layoutControlFoot"><span>'+esc(L('AI önerileri kullanıcı onayı bekler · Kararlar yalnız Layout Geçmişi’ne kaydedilir · PDF orijinali değiştirilmez','AI suggestions await buyer approval · Decisions saved only to Layout History · Original PDF preserved'))+'</span><button type="button" class="lcwaiBtn" data-layout-close>'+esc(L('Kapat','Close'))+'</button></footer>',
      '</div>'
    ].join('');
    document.body.appendChild(modal);
    bind();paint();refreshHistory();
    modal.addEventListener('click',event=>{if(event.target===modal)close();});
    return true;
  }
  function refreshLanguage(){
    if(!modal)return;
    modal.remove();modal=null;renderedPage='';mount();
    const select=modal.querySelector('[data-layout-queue]');select.innerHTML=queuedFiles.map((f,i)=>'<option value="'+i+'">'+esc(f.name)+'</option>').join('');select.hidden=queuedFiles.length<2;
    setBusy(busy);paint();
    setStage(busy?L('Kontrol sürüyor…','Review in progress…'):L('Layout kontrolü · CP’ye yazılmaz','Layout review · no CP writes'),busy?'busy':'');
  }
  function close(){
    if(!modal) return;
    epoch++;renderToken++;
    if(activeAbort) activeAbort.abort();
    if(activeRequestId&&AI()) AI().cancel(activeRequestId);
    new Set([...sessions.keys(),...identitySessions.keys(),...queuedFiles,currentFile].filter(Boolean)).forEach(file=>reader().release(file));sessions.clear();identitySessions.clear();commentDrafts.clear();expandedChecks.clear();queuedFiles=[];pdfDocument=null;renderedPage='';reviewSaving=false;
    activeAbort=null;activeRequestId='';modal.remove();modal=null;currentFile=null;currentReport=null;busy=false;
    const callback=onCloseCallback;onCloseCallback=null;if(callback)Promise.resolve().then(callback);
  }

  root.BLLayoutControl={open,close,run,refreshLanguage,_loadHistory:loadHistory,_clearHistory:clearHistory};
})(typeof window!=='undefined'?window:null);
