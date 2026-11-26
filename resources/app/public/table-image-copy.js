(function(root,factory){
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root&&root.document)root.BLTableImageCopy=api;
})(typeof window!=='undefined'?window:globalThis,function(root){
  'use strict';

  /* ===================================================================
     GÖRSEL OLARAK KOPYALA (CP / Orders / Koleksiyon)

     Seçili satırlar Buyer Log'da göründüğü gibi tek bir PNG'ye çizilir.

       · Satırlar tablonun KENDİ satır üreticisiyle (renderFullTable buildRow,
         renderKol buildKolRow) yeniden üretilir: sayfalama veya pencereli
         çizim yüzünden ekranda olmayan seçili satırlar da görsele girer;
         hover/seçim boyası taşınmaz.
       · Çizim, uygulamanın stil dosyalarını yükleyen gizli ve aynı kökenli
         bir iframe'de, data-theme="light" ile yapılır. Kullanıcının teması
         değişmez, tablo yeniden çizilmez; görsel her zaman aydınlık temadır
         (Excel/e-posta kopyası ile aynı kural).
       · Rasterleştirme: iframe'in yüklü stil kuralları tek bir <style> olarak,
         fontlar ve model görselleri data URL olarak bir SVG foreignObject'e
         konur ve tuvale çizilir. Satır içi stil kopyalanmaz (2.000 düğümde
         38 MB SVG üretiyordu); pseudo-element'ler de yerel olarak çizilir.
         Yalnız aynı kökenden stil, font ve model görseli okunur; hiçbir şey
         dışarı gönderilmez.
       · Pano en fazla CLIPBOARD_MAX_ROWS satır taşır (Windows panosuna dev
         bitmap yazmak Excel/Outlook'u kilitler). Fazlası PNG dosyası olarak
         kaydedilir (FILE_MAX_ROWS'a kadar).
     =================================================================== */

  const CLIPBOARD_MAX_ROWS=50;
  const FILE_MAX_ROWS=300;
  const MAX_CANVAS_SIDE=16384;
  // RGBA bayt = alan × 4. Pano yolu ~128 MB, dosya yolu ~256 MB tavanla sınırlı.
  const LIMITS={
    clipboard:{maxRows:CLIPBOARD_MAX_ROWS,maxArea:32e6,preferredRatio:2,minRatio:1},
    file:{maxRows:FILE_MAX_ROWS,maxArea:64e6,preferredRatio:2,minRatio:0.75},
  };
  const IMAGE_LOAD_TIMEOUT_MS=8000;
  const TRANSPARENT_PIXEL='data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  const CHROME_SELECTOR='.thFilterBtn,.colResizer,input[type="checkbox"],.kolSyntheticFilterBtn';

  function modeLimits(mode){return LIMITS[mode==='file'?'file':'clipboard'];}

  /* Saf: satır sayısı hangi yola gider? */
  function rowPlan(count,mode='clipboard'){
    const n=Math.max(0,Math.floor(Number(count)||0));
    if(!n)return {ok:false,reason:'empty',count:0};
    const limits=modeLimits(mode);
    if(n>limits.maxRows)return {ok:false,reason:mode==='file'?'tooManyRows':'needsFile',count:n,max:limits.maxRows};
    return {ok:true,count:n,max:limits.maxRows};
  }

  /* Saf: CSS piksel boyutuna göre güvenli pixelRatio. Görsel okunamayacak
     kadar küçülecekse (minRatio altı) reddedilir; sessizce bulanıklaşmaz. */
  function rasterPlan(width,height,mode='clipboard'){
    const w=Math.max(1,Math.ceil(Number(width)||0)),h=Math.max(1,Math.ceil(Number(height)||0));
    const limits=modeLimits(mode);
    const ratio=Math.min(limits.preferredRatio,MAX_CANVAS_SIDE/w,MAX_CANVAS_SIDE/h,Math.sqrt(limits.maxArea/(w*h)));
    const pixelRatio=Math.floor(ratio*100)/100;
    if(!(pixelRatio>=limits.minRatio))return {ok:false,reason:mode==='file'?'tooLarge':'needsFile',width:w,height:h};
    return {ok:true,width:w,height:h,pixelRatio,pixelWidth:Math.round(w*pixelRatio),pixelHeight:Math.round(h*pixelRatio)};
  }

  function fileName(tableKey,date=new Date()){
    const p=n=>String(n).padStart(2,'0');
    const name={cp:'CP',orders:'Orders',koleksiyon:'Collection'}[tableKey]||'Table';
    return `BuyerLog-${name}-${date.getFullYear()}${p(date.getMonth()+1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}.png`;
  }

  function px(value){const n=parseFloat(String(value||''));return Number.isFinite(n)?n:0;}

  /* Çıkarılan hücreler silinmez, gizlenir: :first-child / :nth-child kuralları
     canlı tablodaki konumla eşleşmeye devam eder (onay sütunu silinince ilk
     veri hücresi gutter'ın dolgusuz kuralını alıyordu). */
  const HIDDEN_ATTR='data-bl-image-copy-hidden';
  function hideCell(cell){cell.setAttribute(HIDDEN_ATTR,'');}

  /* Saf (DOM): grup başlık satırının colspan'ları tutulan yaprak sütunlara göre. */
  function adjustGroupRow(tr,keepLeaf){
    Array.from(tr.children).forEach(th=>{
      if(!th.hasAttribute('data-start')){return;}
      const start=Number(th.getAttribute('data-start')),end=Number(th.getAttribute('data-end'));
      let span=0;for(let i=start;i<=end;i++)if(keepLeaf.has(i))span++;
      if(!span)hideCell(th);else th.setAttribute('colspan',String(span));
    });
  }

  function hasCheckColumn(table){
    const last=table.querySelector('thead tr.colRow')||table.querySelector('thead tr:last-child');
    const first=last&&last.firstElementChild;
    return Boolean(first&&first.classList.contains('chkTh'));
  }

  /* Canlı tablonun başlığı/kolonları + yeni üretilmiş satırlardan, etkileşim
     öğeleri ayıklanmış bir anlık görüntü tablosu kurar. keepLeaf verilirse
     yalnız o yaprak sütun indeksleri (onay sütunu hariç, 0'dan) kalır. */
  function buildSnapshotTable({table,rows,keepLeaf=null,doc=root.document}){
    if(!table||!doc)return null;
    const withChk=hasCheckColumn(table);
    const shell=table.cloneNode(false);
    ['role','tabindex','aria-multiselectable','aria-rowcount','aria-colcount','aria-label','aria-activedescendant'].forEach(name=>shell.removeAttribute(name));
    shell.classList.add('blImageCopyTable');
    let total=0;
    const liveColgroup=table.querySelector('colgroup');
    if(liveColgroup){
      const colgroup=liveColgroup.cloneNode(true),cols=Array.from(colgroup.children);
      if(withChk&&cols.length)cols.shift().remove();
      cols.forEach((col,index)=>{
        if(keepLeaf&&!keepLeaf.has(index)){col.remove();return;}
        total+=px(col.style.width);
      });
      shell.appendChild(colgroup);
    }
    const liveHead=table.querySelector('thead');
    if(liveHead){
      const thead=liveHead.cloneNode(true);
      const offset=withChk?1:0;
      Array.from(thead.rows).forEach(tr=>{
        if(withChk&&tr.firstElementChild)hideCell(tr.firstElementChild);
        if(!keepLeaf)return;
        if(tr.classList.contains('groupRow'))adjustGroupRow(tr,keepLeaf);
        else Array.from(tr.children).forEach((th,index)=>{if(index>=offset&&!keepLeaf.has(index-offset))hideCell(th);});
      });
      thead.querySelectorAll(CHROME_SELECTOR).forEach(node=>node.remove());
      // Grup etiketi canlı tabloda yatay kaydırmayı izler (transform/max-width/visibility);
      // anlık görüntü kaydırılmamıştır, etiket CSS'teki varsayılan konumuna döner.
      thead.querySelectorAll('.blGroupFollowLabel').forEach(node=>node.removeAttribute('style'));
      thead.querySelectorAll('[id]').forEach(node=>node.removeAttribute('id'));
      shell.appendChild(thead);
    }
    const tbody=doc.createElement('tbody');
    (rows||[]).forEach(built=>{
      // buildRow, genişletilmiş lojistik detayında bir fragment döndürür: yalnız ana satır.
      const tr=built&&built.nodeType===11?built.querySelector('tr'):built;
      if(!tr||tr.nodeName!=='TR')return;
      const offset=withChk&&tr.firstElementChild&&tr.firstElementChild.nodeName==='TD'?1:0;
      if(offset)hideCell(tr.firstElementChild);
      if(keepLeaf)Array.from(tr.children).forEach((td,index)=>{if(index>=offset&&!keepLeaf.has(index-offset))hideCell(td);});
      ['role','aria-rowindex','aria-selected'].forEach(name=>tr.removeAttribute(name));
      // Satır seçim tonu (:has(.rowChk:checked)) görsele taşınmaz.
      tr.querySelectorAll('input[type="checkbox"]').forEach(input=>{input.removeAttribute('checked');input.checked=false;});
      tr.querySelectorAll('[id]').forEach(node=>node.removeAttribute('id'));
      tr.querySelectorAll('img').forEach(img=>{
        const source=img.getAttribute('data-src')||'';
        if(source&&img.getAttribute('data-has-image')!=='0')img.setAttribute('src',source);
        ['loading','decoding','fetchpriority'].forEach(name=>img.removeAttribute(name));
      });
      tbody.appendChild(tr);
    });
    shell.appendChild(tbody);
    if(total>0){shell.style.width=total+'px';shell.style.minWidth=total+'px';shell.style.maxWidth='none';}
    return {table:shell,rowCount:tbody.rows.length,width:total};
  }

  function escapeAttr(value){return String(value==null?'':value).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');}
  function attrsOf(el,{skip=[],extra={}}={}){
    const out=[];
    Array.from(el?.attributes||[]).forEach(attr=>{
      const name=attr.name;
      if(skip.includes(name))return;
      if(name==='id'||name==='class'||name==='style'||name==='lang'||name.startsWith('data-'))out.push(`${name}="${escapeAttr(attr.value)}"`);
    });
    Object.entries(extra).forEach(([name,value])=>out.push(`${name}="${escapeAttr(value)}"`));
    return out.join(' ');
  }

  // Anlık görüntüye özgü son kurallar. Dondurulmuş sütun ve yapışkan başlık
  // ofsetleri (left/top) onay sütunu çıkarılınca hücreleri kaydırırdı; anlık
  // görüntüde akış konumu esastır.
  // Uygulama kuralları id seçicili !important da olabilir (#kolTable … th{top:22px!important}):
  // :not(#…) zinciri anlık görüntü kuralını id özgüllüğünün üstüne taşır.
  const BOOST='.blImageCopyTable:not(#blImageCopyA):not(#blImageCopyB):not(#blImageCopyC)';
  const SNAPSHOT_CSS=[
    'html,body{margin:0!important;padding:0!important;overflow:visible!important;width:max-content!important;min-width:0!important;height:auto!important;min-height:0!important;max-height:none!important;display:block!important;}',
    '.blImageCopyChain:not(#blImageCopyA):not(#blImageCopyB):not(#blImageCopyC){display:block!important;position:static!important;overflow:visible!important;width:max-content!important;min-width:0!important;max-width:none!important;height:auto!important;min-height:0!important;max-height:none!important;margin:0!important;padding:0!important;transform:none!important;contain:none!important;border:0!important;box-shadow:none!important;}',
    '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important;}',
    `table${BOOST}{margin:0!important;}`,
    `table${BOOST} [data-bl-image-copy-hidden]{display:none!important;}`,
    `table${BOOST} th,table${BOOST} td{position:relative!important;left:auto!important;right:auto!important;top:auto!important;bottom:auto!important;}`,
  ].join('\n');

  /* iframe belgesi: uygulama stilleri (aynı sırayla), ikon sprite'ı ve canlı
     tablonun ata zinciri (id/sınıf/data-* korunur; seçiciler aynen eşleşir).
     iframe yalnız ölçüm ve görsel yükleme içindir; çizim SVG'de yapılır. */
  function snapshotDocumentHtml({table,doc=root.document}){
    const head=[`<meta charset="utf-8"><base href="${escapeAttr(doc.baseURI)}">`];
    doc.querySelectorAll('link[rel~="stylesheet"],style').forEach(node=>{
      if(node.nodeName==='LINK'){if(node.disabled||!node.href)return;head.push(`<link rel="stylesheet" href="${escapeAttr(node.href)}"${node.media?` media="${escapeAttr(node.media)}"`:''}>`);}
      else head.push(`<style${node.media?` media="${escapeAttr(node.media)}"`:''}>${String(node.textContent||'').replace(/<\/style/gi,'<\\/style')}</style>`);
    });
    head.push(`<style data-bl-image-copy-css>${SNAPSHOT_CSS}</style>`);
    const sprites=Array.from(doc.querySelectorAll('svg')).filter(svg=>svg.querySelector('symbol')&&!svg.closest('table')).map(svg=>svg.outerHTML).join('');
    const chain=[];
    for(let node=table.parentElement;node&&node!==doc.body&&node!==doc.documentElement;node=node.parentElement)chain.unshift(node);
    const open=chain.map(node=>{
      // Satır içi stil korunur (CSS değişkenleri taşıyabilir); yerleşimi .blImageCopyChain ezer.
      const cls=`${node.getAttribute('class')||''} blImageCopyChain`.trim();
      return `<${node.nodeName.toLowerCase()} ${attrsOf(node,{skip:['class'],extra:{class:cls}})}>`;
    }).join('');
    const close=chain.slice().reverse().map(node=>`</${node.nodeName.toLowerCase()}>`).join('');
    const htmlAttrs=attrsOf(doc.documentElement,{skip:['data-theme'],extra:{'data-theme':'light'}});
    const bodyAttrs=attrsOf(doc.body);
    return `<!doctype html><html ${htmlAttrs}><head>${head.join('')}</head><body ${bodyAttrs}><div data-bl-image-copy-sprites hidden>${sprites}</div>${open}<div data-bl-image-copy-slot></div>${close}</body></html>`;
  }

  function wait(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
  function withTimeout(promise,ms){return Promise.race([promise,wait(ms)]);}

  function loadFrame(html,width){
    return new Promise((resolve,reject)=>{
      const frame=root.document.createElement('iframe');
      frame.setAttribute('aria-hidden','true');frame.tabIndex=-1;frame.title='';
      frame.style.cssText=`position:fixed;left:-100000px;top:0;width:${Math.max(320,Math.ceil(width)+64)}px;height:400px;border:0;pointer-events:none;opacity:0;`;
      let settled=false;
      const done=(error)=>{if(settled)return;settled=true;clearTimeout(timer);if(error){frame.remove();reject(error);}else resolve(frame);};
      const timer=setTimeout(()=>done(new Error('IMAGE_COPY_FRAME_TIMEOUT')),20000);
      frame.addEventListener('load',()=>done(null),{once:true});
      frame.srcdoc=html;
      root.document.body.appendChild(frame);
    });
  }

  function blobToDataUrl(blob){
    return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result||''));reader.onerror=()=>reject(reader.error);reader.readAsDataURL(blob);});
  }
  async function fetchDataUrl(url,timeoutMs=IMAGE_LOAD_TIMEOUT_MS){
    if(!url||url.startsWith('data:'))return url||'';
    const controller=typeof AbortController==='function'?new AbortController():null;
    const timer=setTimeout(()=>controller?.abort(),timeoutMs);
    try{const response=await fetch(url,{credentials:'same-origin',signal:controller?.signal});if(!response.ok)return '';return await blobToDataUrl(await response.blob());}
    catch(_){return '';}
    finally{clearTimeout(timer);}
  }

  // Font dosyaları oturumda bir kez data URL'e çevrilir (aynı kökenli vendor/fonts).
  const fontDataCache=new Map();
  function fontData(url){if(!fontDataCache.has(url))fontDataCache.set(url,fetchDataUrl(url,10000));return fontDataCache.get(url);}

  /* iframe'in yüklü stil kuralları tek bir CSS metnine. SVG görseli dış kaynak
     yükleyemez: @font-face url()'leri data URL'e çevrilir; diğer göreli url()'ler
     mutlak hâle gelir (yüklenmez, yalnız geçersiz istek üretmez). */
  async function collectCss(doc){
    const parts=[],fontJobs=[];
    const absolute=(value,base)=>{try{return new URL(value,base).href;}catch(_){return value;}};
    const rewrite=(text,base,fonts)=>text.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g,(match,quote,value)=>{
      if(/^(data:|#)/i.test(value))return match;
      const href=absolute(value,base);
      if(!fonts)return `url("${href}")`;
      const token=`__BL_FONT_${fontJobs.length}__`;fontJobs.push(fontData(href).then(data=>[token,data]));
      return `url("${token}")`;
    });
    const visit=(rules,base,out)=>{
      for(const rule of Array.from(rules||[])){
        if(rule.type===3){try{visit(rule.styleSheet.cssRules,rule.styleSheet.href||base,out);}catch(_){}continue;} // @import
        out.push(rewrite(rule.cssText,base,rule.type===5)); // 5: @font-face
      }
    };
    for(const sheet of Array.from(doc.styleSheets||[])){
      if(sheet.disabled)continue;
      let rules;try{rules=sheet.cssRules;}catch(_){continue;}
      const out=[];visit(rules,sheet.href||doc.baseURI,out);
      const media=sheet.media&&sheet.media.mediaText;
      parts.push(media&&media!=='all'?`@media ${media}{${out.join('\n')}}`:out.join('\n'));
    }
    let css=parts.join('\n');
    for(const [token,data] of await Promise.all(fontJobs))css=css.split(token).join(data||'about:invalid');
    return css;
  }

  async function inlineImages(doc){
    const images=Array.from(doc.images||[]);
    await withTimeout(Promise.all(images.map(img=>img.complete?Promise.resolve():new Promise(resolve=>{img.addEventListener('load',resolve,{once:true});img.addEventListener('error',resolve,{once:true});}))),IMAGE_LOAD_TIMEOUT_MS);
    const cache=new Map();
    await Promise.all(images.map(async img=>{
      const source=img.currentSrc||img.src||'';
      if(!img.naturalWidth||!source){img.setAttribute('src',TRANSPARENT_PIXEL);return;}
      if(!cache.has(source))cache.set(source,fetchDataUrl(source));
      img.setAttribute('src',(await cache.get(source))||TRANSPARENT_PIXEL);
      img.removeAttribute('srcset');
    }));
  }

  function cdata(text){return `<![CDATA[${String(text).split(']]>').join(']]]]><![CDATA[>')}]]>`;}
  function xmlAttrs(el,{extra={},skip=[]}={}){
    const out=[];
    Array.from(el?.attributes||[]).forEach(attr=>{if(!skip.includes(attr.name)&&/^[a-zA-Z_][\w.-]*$/.test(attr.name))out.push(`${attr.name}="${escapeAttr(attr.value).replace(/>/g,'&gt;')}"`);});
    Object.entries(extra).forEach(([name,value])=>out.push(`${name}="${escapeAttr(value)}"`));
    return out.join(' ');
  }

  /* Tek SVG: kök <svg> :root kurallarını (token'lar, data-theme=light) taşır ve
     rem tabanı için kökün font-size'ı verilir; foreignObject içinde stil
     kuralları + iframe'in gövdesi aynı seçicilerle yeniden çizilir. */
  function svgDocument({doc,css,width,height}){
    const serializer=new (doc.defaultView.XMLSerializer)();
    const rootStyle=doc.defaultView.getComputedStyle(doc.documentElement);
    const htmlAttrs=xmlAttrs(doc.documentElement,{skip:['xmlns']});
    const body=serializer.serializeToString(doc.body);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" ${xmlAttrs(doc.documentElement,{skip:['xmlns','style','class','id']})} style="font-size:${rootStyle.fontSize};"><foreignObject x="0" y="0" width="${width}" height="${height}"><html xmlns="http://www.w3.org/1999/xhtml" ${htmlAttrs}><head><style>${cdata(css)}</style></head>${body}</html></foreignObject></svg>`;
  }

  function decodeSvg(svg){
    return new Promise((resolve,reject)=>{
      const img=new Image();
      img.onload=()=>resolve(img);img.onerror=()=>reject(new Error('IMAGE_COPY_SVG_DECODE'));
      img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);
    });
  }

  /* Yeni üretilmiş satırlardan PNG blob üretir. Sonuç: {blob,rowCount,width,height,pixelRatio,timings}
     veya {error:'needsFile'|'tooLarge'|'empty'|'failed'}. */
  async function render({table,rows,keepLeaf=null,mode='clipboard'}){
    const snapshot=buildSnapshotTable({table,rows,keepLeaf});
    if(!snapshot||!snapshot.rowCount)return {error:'empty'};
    let frame=null;const now=()=>(root.performance&&root.performance.now?root.performance.now():Date.now()),started=now(),timings={};
    try{
      frame=await loadFrame(snapshotDocumentHtml({table}),snapshot.width);
      const win=frame.contentWindow,doc=frame.contentDocument;
      const node=doc.importNode(snapshot.table,true);
      doc.querySelector('[data-bl-image-copy-slot]').replaceWith(node);
      timings.frame=Math.round(now()-started);
      await withTimeout(doc.fonts?.ready||Promise.resolve(),5000);
      const [css]=await Promise.all([collectCss(doc),inlineImages(doc)]);
      timings.assets=Math.round(now()-started);
      await new Promise(resolve=>win.requestAnimationFrame(()=>resolve()));
      const box=node.getBoundingClientRect();
      const plan=rasterPlan(box.width,box.height,mode);
      if(!plan.ok)return {error:plan.reason};
      const image=await decodeSvg(svgDocument({doc,css,width:plan.width,height:plan.height}));
      timings.decode=Math.round(now()-started);
      const canvas=root.document.createElement('canvas');
      canvas.width=plan.pixelWidth;canvas.height=plan.pixelHeight;
      const context=canvas.getContext('2d');
      const background=win.getComputedStyle(doc.body).backgroundColor;
      context.fillStyle=background&&background!=='rgba(0, 0, 0, 0)'&&background!=='transparent'?background:'#ffffff';
      context.fillRect(0,0,canvas.width,canvas.height);
      context.drawImage(image,0,0,canvas.width,canvas.height);
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
      canvas.width=canvas.height=0;
      if(!blob)return {error:'failed'};
      timings.total=Math.round(now()-started);
      return {blob,rowCount:snapshot.rowCount,width:plan.pixelWidth,height:plan.pixelHeight,pixelRatio:plan.pixelRatio,timings};
    }catch(error){
      return {error:'failed',detail:error&&error.message||String(error)};
    }finally{
      frame?.remove();
    }
  }

  /* Pano yazımı tıklama anında başlar (blob sözü ile); render uzun sürse de
     kullanıcı etkileşimi geçerliliğini yitirmez. */
  async function writeClipboard(blobPromise){
    const Item=root.ClipboardItem,clipboard=root.navigator&&root.navigator.clipboard;
    if(!Item||!clipboard||typeof clipboard.write!=='function')throw new Error('CLIPBOARD_IMAGE_UNSUPPORTED');
    await clipboard.write([new Item({'image/png':blobPromise})]);
    return true;
  }

  function saveFile(blob,name){
    const url=URL.createObjectURL(blob),a=root.document.createElement('a');
    a.href=url;a.download=name;root.document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),30000);
    return name;
  }

  return {CLIPBOARD_MAX_ROWS,FILE_MAX_ROWS,rowPlan,rasterPlan,fileName,buildSnapshotTable,snapshotDocumentHtml,render,writeClipboard,saveFile};
});
