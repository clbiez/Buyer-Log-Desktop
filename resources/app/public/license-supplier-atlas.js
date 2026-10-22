/* Buyer Log — supplier license atlas file.
   Pure builder (browser + Node): selected cards → a standalone, read-only HTML guide in
   the Buyer Log visual language. Privacy is decided by BLLicenseAtlasEngine.project():
   commercial terms, internal notes and anything not shared with suppliers never leave. */
(function(root,factory){
  const api=factory(typeof module==='object'&&module.exports?require('./license-atlas-engine'):root.BLLicenseAtlasEngine);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.BLLicenseSupplierAtlas=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(A){
  'use strict';
  const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const copy=v=>JSON.parse(JSON.stringify(v));

  // Sharing defaults are those of the editor: a license, its steps, routes and addresses
  // are shared unless switched off; the portal and free-text notes are private by default.
  function prepare(atlas){
    const a=copy(atlas),l=a.license||{};
    if(typeof l.manufacturerVisible!=='boolean')l.manufacturerVisible=true;
    if(typeof l.supplierShowRequirements!=='boolean')l.supplierShowRequirements=true;
    l.portal=l.portal||{url:'',notes:''};if(typeof l.portal.manufacturerVisible!=='boolean')l.portal.manufacturerVisible=false;
    for(const ad of [...(l.addresses||[]),...(a.sharedAddresses||[])])if(typeof ad.manufacturerVisible!=='boolean')ad.manufacturerVisible=true;
    for(const st of l.stages||[]){
      for(const k of ['manufacturerVisible','supplierShowApprovalNotes'])if(typeof st[k]!=='boolean')st[k]=true;
      if(typeof st.supplierShowSourceNote!=='boolean')st.supplierShowSourceNote=typeof st.supplierShowNotes==='boolean'?st.supplierShowNotes:true;
      delete st.supplierShowNotes;
      for(const r of st.submissions||[]){if(typeof r.manufacturerVisible!=='boolean')r.manufacturerVisible=true;if(typeof r.supplierShowNotes!=='boolean')r.supplierShowNotes=false;}
    }
    a.license=l;return a;
  }

  // Cards without a map still export as a plain entry (name, licensor, image).
  function project(cards,lang='tr'){
    const licenses=[],skipped=[];
    for(const card of Array.isArray(cards)?cards:[]){
      if(!card.processAtlas){licenses.push({id:card.id,name:card.license,agency:card.licensor||'',cover:'',requirements:'',stages:[],addresses:[],portal:{url:'',notes:''},visualLibrary:[],customSelectOptions:{}});continue;}
      const projected=A.project({...card,processAtlas:prepare(card.processAtlas)},lang);
      if(projected)licenses.push(projected);else skipped.push(card.license);
    }
    return {licenses,skipped};
  }

  const LABELS={
    method:{physical:['Fiziki numune','Physical sample'],email:['E-posta / fotoğraf','Email / photo'],both:['E-posta + fiziki','Email + physical'],portal:['Portal','Portal'],internal:['LCW / dahili','LCW / internal'],linked:['Bağlantılı süreç','Linked process']},
    approver:{LCW:['LCW','LCW'],licensor:['Lisansör','Licensor'],agency:['Acente / aracı','Agency'],mixed:['LCW + Lisansör','LCW + Licensor'],unknown:['Teyit edilecek','To be confirmed']},
    recipientType:{LCW:['LCW','LCW'],licensor:['Lisansör','Licensor'],both:['LCW + Lisansör','LCW + Licensor'],other:['Diğer','Other'],unknown:['Belirtilmedi','Not specified']},
    timing:{approval:['Onay için','For approval'],after:['Onay sonrası','After approval']},
  };
  function label(l,kind,value,en){
    const custom=(l.customSelectOptions&&l.customSelectOptions[kind]||[]).find(o=>o.value===value);
    if(custom)return custom.label||value;
    const known=LABELS[kind]&&LABELS[kind][value];return known?known[en?1:0]:value||'';
  }
  const initials=name=>String(name||'?').trim().split(/\s+/).slice(0,2).map(w=>w[0]||'').join('').toUpperCase()||'?';
  const text=v=>v?`<p class="tx">${esc(v)}</p>`:'';

  // Buyer Log design.css palette; standalone files cannot read the app's live tokens.
  const STYLE=`
:root{color-scheme:light dark;--paper:#f2f2f3;--card:#f8f8f9;--card2:#ececef;--ink:#1d1f20;--ink2:#5d5d60;--muted:#7a7a7d;--line:#d4d4d7;--acc:#3f6488;--acc-bg:#e6edf4;--acc-ink:#2c455d;--on-acc:#f2f2f3;--green:#177a4c;--green-bg:#e3ede6;--orange:#8c6a1f;--orange-bg:#f2ead6}
@media (prefers-color-scheme:dark){:root{--paper:#23262a;--card:#292d32;--card2:#31353b;--ink:#e9eaec;--ink2:#a9adb3;--muted:#82868c;--line:#3a3f46;--acc:#8fb4d8;--acc-bg:#2b3f53;--acc-ink:#cfe2f4;--on-acc:#1b1e21;--green:#93c7a8;--green-bg:#24352c;--orange:#d9ba7e;--orange-bg:#3a3324}}
*{box-sizing:border-box}html{scroll-behavior:smooth}
body{margin:0;background:var(--paper);color:var(--ink);font:400 13px/1.5 "Barlow","Segoe UI",Arial,sans-serif}
h1,h2,h3{font-family:"Barlow Condensed","Barlow",sans-serif;font-weight:600;letter-spacing:.01em;margin:0}
a{color:var(--acc)}
.wrap{max-width:1180px;margin:0 auto;padding:20px 18px 40px}
header{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;border-bottom:1px solid var(--line);padding-bottom:12px;margin-bottom:14px}
.eyebrow{font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
header h1{font-size:24px;margin-top:2px}header p{margin:2px 0 0;color:var(--ink2)}
.meta{color:var(--muted);font-size:11.5px;text-align:right}
.hint{margin:0 0 8px;color:var(--muted);font-size:11.5px}
.list{border:1px solid var(--line);background:var(--card);margin-bottom:22px}
.lic{border-top:1px solid var(--line);animation:in .3s cubic-bezier(.2,.75,.25,1) both}.lic:first-child{border-top:0}
.lic>summary{display:grid;grid-template-columns:72px minmax(0,1.4fr) minmax(0,1fr) 72px 16px;gap:12px;align-items:center;padding:6px 12px;cursor:pointer;list-style:none;color:var(--ink);transition:background-color .15s}
.lic>summary::-webkit-details-marker{display:none}
.lic>summary:hover{background:var(--card2)}.lic>summary:focus-visible{outline:2px solid var(--acc);outline-offset:-2px}
.lic[open]>summary{background:var(--acc-bg);border-bottom:1px solid var(--line)}
.lic>summary b{font-family:"Barlow Condensed",sans-serif;font-size:15px;font-weight:600;overflow-wrap:anywhere}.lic>summary span{color:var(--ink2);overflow-wrap:anywhere}.lic>summary small{color:var(--muted);text-align:right;white-space:nowrap}
.chev{width:8px;height:8px;border-right:1.5px solid var(--ink2);border-bottom:1.5px solid var(--ink2);transform:translateY(-2px) rotate(45deg);transition:transform .25s cubic-bezier(.2,.75,.25,1);justify-self:center}
.lic[open] .chev{transform:translateY(2px) rotate(225deg)}
:root{interpolate-size:allow-keywords}
.lic::details-content{block-size:0;overflow:hidden;transition:block-size .3s cubic-bezier(.2,.75,.25,1),content-visibility .3s allow-discrete}
.lic[open]::details-content{block-size:auto}
.thumb{width:72px;height:40px;display:grid;place-items:center;background:var(--card2);border:1px solid var(--line);overflow:hidden;color:var(--acc-ink);font:600 13px "Barlow Condensed",sans-serif}
.thumb img{width:100%;height:100%;object-fit:cover}
.panel{display:grid;grid-template-columns:200px minmax(0,1fr);gap:16px;padding:12px 14px 14px;background:var(--card)}
.panel>.thumb{width:200px;height:112px;font-size:24px}
.steps{list-style:none;margin:0;padding:0;position:relative}
.steps:before{content:"";position:absolute;left:13px;top:6px;bottom:6px;width:1px;background:var(--line)}
.step{position:relative;display:grid;grid-template-columns:28px minmax(0,1fr);gap:10px;padding:6px 0}
.dot{width:27px;height:27px;display:grid;place-items:center;border:1px solid var(--acc);background:var(--card);color:var(--acc-ink);font:600 12px "Barlow",sans-serif;position:relative}
.step h3{font-size:15px;display:flex;flex-wrap:wrap;align-items:center;gap:6px;min-height:27px}
.chip{display:inline-flex;align-items:center;height:19px;padding:0 6px;border:1px solid var(--line);font:600 10.5px "Barlow",sans-serif;color:var(--ink2);background:var(--card);white-space:nowrap}
.chip.acc{border-color:var(--acc);background:var(--acc-bg);color:var(--acc-ink)}.chip.test{border-color:var(--orange);background:var(--orange-bg);color:var(--orange)}
.routes{display:grid;gap:0;margin:6px 0;border:1px solid var(--line);background:var(--paper)}
.route{display:grid;grid-template-columns:180px minmax(0,1fr) 200px;column-gap:12px;align-items:start;padding:6px 10px;border-top:1px solid var(--line);text-align:left}
.route:first-child{border-top:0}
.route>div{min-width:0}.route b{font-weight:600}.route small{display:block;color:var(--muted);overflow-wrap:anywhere}
.route .tags{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:4px}
.route .note{grid-column:1/-1}
.tx{white-space:pre-wrap;overflow-wrap:anywhere;margin:4px 0;color:var(--ink2)}
.vg{margin-top:6px}.vg>summary{cursor:pointer;color:var(--acc);font-weight:600}
.guide{display:block;max-width:100%;max-height:420px;object-fit:contain;margin-top:6px;border:1px solid var(--line);background:#fff}
.extra{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px;margin-top:10px}
.box{border:1px solid var(--line);padding:8px 10px;background:var(--paper)}.box h3{font-size:14px;margin-bottom:4px}
.empty{color:var(--muted);margin:4px 0}
footer{color:var(--muted);font-size:11.5px;margin-top:20px}
@keyframes in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.lic{animation:none}.lic::details-content,.chev{transition:none}}
@media (max-width:760px){.panel{grid-template-columns:1fr}.panel>.thumb{width:100%;height:auto;aspect-ratio:16/9}.route{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}.route .tags{grid-column:1/-1;justify-content:flex-start}}
@media (max-width:640px){.lic>summary{grid-template-columns:56px minmax(0,1fr) 16px}.lic>summary .thumb{width:56px;grid-row:span 3}.lic>summary span,.lic>summary small{grid-column:2;text-align:left}.lic>summary .chev{grid-column:3;grid-row:1/span 3}.route{grid-template-columns:1fr}header{flex-direction:column;align-items:flex-start}.meta{text-align:left}}
@media print{body{background:#fff;color:#000}.lic{break-inside:avoid-page;animation:none}.lic::details-content{block-size:auto;content-visibility:visible}.chev,.hint{display:none}}`;

  function thumb(l){return `<span class="thumb">${l.cover?`<img src="${esc(l.cover)}" alt="">`:esc(initials(l.name))}</span>`;}
  function stepHtml(l,s,i,en){
    const T=(tr,e)=>en?e:tr;
    const routes=s.submissions.map(r=>{const address=r.addressId?l.addresses.find(a=>a.id===r.addressId):null;
      return `<div class="route"><div><b>${esc(label(l,'method',r.method,en))}</b>${r.label?`<small>${esc(r.label)}</small>`:''}</div><div><b>${esc(label(l,'recipientType',r.recipientType,en)||r.recipient)}</b>${r.recipient?`<small>${esc(r.recipient)}</small>`:''}${address?`<small>${esc(address.label?address.label+' · ':'')}${esc(address.text)}</small>`:''}</div><div class="tags">${r.qty?`<span class="chip">${esc(r.qty)}</span>`:''}${r.timing?`<span class="chip">${esc(label(l,'timing',r.timing,en))}</span>`:''}</div>${r.supplierInstructions||r.note?`<div class="note">${text(r.supplierInstructions)}${text(r.note)}</div>`:''}</div>`;}).join('');
    const guide=l.visualLibrary.find(v=>v.id===s.visualGuideId);
    return `<li class="step"><span class="dot">${i+1}</span><div><h3>${esc(s.title||T('Adım','Step')+' '+(i+1))}<span class="chip acc">${esc(label(l,'approver',s.approver||'unknown',en))}</span>${s.testRequired?`<span class="chip test">${esc(T('Test','Test'))}${s.testQty?' · '+esc(s.testQty):''}</span>`:''}</h3>${text(s.supplierInstructions)}${text(s.note)}${text(s.approvalNotes)}${s.testRequired?text(s.testNotes):''}${routes?`<div class="routes">${routes}</div>`:''}${guide?`<details class="vg"><summary>${esc(T('Görsel kılavuz','Visual guide'))}</summary><img class="guide" src="${esc(guide.data)}" alt="${esc(guide.name)}"></details>`:''}</div></li>`;
  }
  function buildHTML(licenses,{lang='tr',fonts='',generatedAt=new Date()}={}){
    const en=lang==='en',T=(tr,e)=>en?e:tr,day=new Date(generatedAt).toISOString().slice(0,10);
    // Each license is a native drawer: the row toggles its own map open/closed in place.
    const items=licenses.map((l,i)=>{
      const portal=l.portal&&l.portal.url?`<div class="box"><h3>Portal</h3><a href="${esc(l.portal.url)}" rel="noopener noreferrer">${esc(l.portal.url)}</a>${text(l.portal.notes)}</div>`:'';
      const addresses=l.addresses.length?`<div class="box"><h3>${esc(T('Gönderim adresleri','Shipping addresses'))}</h3>${l.addresses.map(a=>`<p class="tx"><b>${esc(a.label)}</b>\n${esc(a.text)}</p>`).join('')}</div>`:'';
      const requirements=l.requirements?`<div class="box"><h3>${esc(T('Genel gereksinimler','General requirements'))}</h3>${text(l.requirements)}</div>`:'';
      return `<details class="lic" id="l${i}" style="animation-delay:${Math.min(i,20)*25}ms"><summary>${thumb(l)}<b>${esc(l.name)}</b><span>${esc(l.agency||T('Lisansör belirtilmedi','Licensor not specified'))}</span><small>${l.stages.length} ${esc(T('adım','steps'))}</small><i class="chev" aria-hidden="true"></i></summary><div class="panel">${thumb(l)}<div>${l.stages.length?`<ol class="steps">${l.stages.map((s,n)=>stepHtml(l,s,n,en)).join('')}</ol>`:`<p class="empty">${esc(T('Bu lisans için onay adımı tanımlanmadı.','No approval steps are defined for this license.'))}</p>`}${portal||addresses||requirements?`<div class="extra">${requirements}${addresses}${portal}</div>`:''}</div></div></details>`;
    }).join('');
    return `<!doctype html><html lang="${en?'en':'tr'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${esc(T('Lisans Atlası · Üretici Rehberi','License Atlas · Supplier Guide'))}</title><style>${fonts}${STYLE}</style></head><body><div class="wrap"><header><div><div class="eyebrow">Buyer Log · ${esc(T('Üretici süreç rehberi','Supplier process guide'))}</div><h1>${esc(T('Lisans onay haritaları','License approval maps'))}</h1><p>${esc(T('Onay adımları, gönderim yöntemleri ve üretim talimatları.','Approval steps, submission methods and production instructions.'))}</p></div><div class="meta">${esc(day)}<br>${licenses.length} ${esc(T('lisans','licenses'))} · ${esc(T('salt okunur','read only'))}</div></header><p class="hint">${esc(T('Haritasını görmek için bir lisansa tıklayın; tekrar tıklayınca kapanır.','Click a license to show its map; click again to hide it.'))}</p><div class="list">${items}</div><footer>${esc(T('Salt okunur üretici kopyası. Tarayıcıdan yazdırabilir veya PDF olarak kaydedebilirsiniz.','Read-only supplier copy. Print it or save it as PDF from your browser.'))}</footer></div></body></html>`;
  }

  // Browser only: Buyer Log's own Barlow faces (design.css) inlined as data: URLs.
  let fontsPending=null;
  function loadFonts(){
    if(typeof document==='undefined')return Promise.resolve('');
    if(!fontsPending)fontsPending=(async()=>{
      const faces=[];
      for(const sheet of document.styleSheets){let rules;try{rules=sheet.cssRules;}catch(_){continue;}
        for(const rule of rules||[])if(rule.type===CSSRule.FONT_FACE_RULE&&/Barlow/.test(rule.style.getPropertyValue('font-family')))faces.push(rule);}
      const css=await Promise.all(faces.map(async rule=>{
        const url=(rule.style.getPropertyValue('src').match(/url\(["']?([^"')]+)["']?\)/)||[])[1];if(!url)return '';
        const response=await fetch(new URL(url,rule.parentStyleSheet.href||location.href),{credentials:'same-origin'});if(!response.ok)return '';
        const blob=new Blob([await response.arrayBuffer()],{type:'font/woff2'}),data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob);});
        const range=rule.style.getPropertyValue('unicode-range');
        return `@font-face{font-family:${rule.style.getPropertyValue('font-family')};font-weight:${rule.style.getPropertyValue('font-weight')||400};font-display:swap;src:url("${data}") format("woff2");${range?`unicode-range:${range};`:''}}`;
      }));
      return css.join('');
    })().catch(()=>{fontsPending=null;return '';});
    return fontsPending;
  }
  return Object.freeze({prepare,project,buildHTML,loadFonts,LABELS,label});
});
