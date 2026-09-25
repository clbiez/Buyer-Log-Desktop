/* Buyer Log — Backlog dynamic quantity/time charts + Excel chart export. */
(function attachBacklogChart(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BLBacklogChart = api;
  if (root && root.document) {
    const boot = () => api.init();
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', boot, { once:true });
    else Promise.resolve().then(boot);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function createBacklogChart(root) {
  'use strict';

  const DATE_DIMENSION = root.BLDateDimension || (typeof require==='function' ? (()=>{try{return require('./date-dimension.js');}catch(_){return null;}})() : null);
  const STORAGE_KEY = 'lcw.backlog.chart.v1';
  const DEFAULT_STATE = Object.freeze({
    enabled:false,
    timeField:'',
    granularity:'week',
    metricField:'__records',
    aggregation:'count',
    seriesField:'',
    chartType:'line',
    seriesLimit:'20',
    title:'',
  });
  const COLORS = ['#2563eb','#7c3aed','#0891b2','#059669','#d97706','#dc2626','#db2777','#4f46e5','#0f766e','#9333ea','#475569','#ca8a04'];
  let state = Object.assign({}, DEFAULT_STATE);
  let initialized = false;
  let cache = { signature:'', headers:[], rows:[] };

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }
  function xml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&apos;');
  }
  function lang() {
    try { return root.BLBacklogChartContext && typeof root.BLBacklogChartContext.language === 'function'
      ? root.BLBacklogChartContext.language() : 'tr'; } catch (_) { return 'tr'; }
  }
  function tr(trText,enText) { return lang() === 'en' ? enText : trText; }
  function notify(message) {
    try {
      if (root.BLBacklogChartContext && typeof root.BLBacklogChartContext.toast === 'function') {
        root.BLBacklogChartContext.toast(message); return;
      }
    } catch (_) {}
    if (root.console) root.console.warn(message);
  }
  function store() {
    try { return root.BLStorage || root.localStorage || null; } catch (_) { return null; }
  }
  function sanitizeState(input) {
    const src = input && typeof input === 'object' ? input : {};
    const gran = ['day','week','month','year'].includes(src.granularity) ? src.granularity : DEFAULT_STATE.granularity;
    const agg = ['count','distinct','sum','avg'].includes(src.aggregation) ? src.aggregation : DEFAULT_STATE.aggregation;
    const chart = ['line','bar'].includes(src.chartType) ? src.chartType : DEFAULT_STATE.chartType;
    const limit = ['5','10','20','50','all'].includes(String(src.seriesLimit)) ? String(src.seriesLimit) : DEFAULT_STATE.seriesLimit;
    return {
      enabled:!!src.enabled,
      timeField:String(src.timeField || ''),
      granularity:gran,
      metricField:String(src.metricField || '__records'),
      aggregation:agg,
      seriesField:String(src.seriesField || ''),
      chartType:chart,
      seriesLimit:limit,
      title:String(src.title || '').slice(0,160),
    };
  }
  function loadState() {
    try {
      const s=store(), raw=s && s.getItem(STORAGE_KEY);
      state = sanitizeState(raw ? JSON.parse(raw) : DEFAULT_STATE);
    } catch (_) { state = Object.assign({}, DEFAULT_STATE); }
    return Object.assign({}, state);
  }
  function saveState(next) {
    state = sanitizeState(next);
    try { const s=store(); if (s) s.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (_) {}
    return Object.assign({}, state);
  }
  function getState() { return Object.assign({}, state); }

  function normalizeHeader(value) {
    const helper = root.BLExcelDates && root.BLExcelDates.normalizedHeader;
    if (typeof helper === 'function') return helper(value);
    const map={'İ':'I','Ş':'S','Ç':'C','Ö':'O','Ü':'U','Ğ':'G'};
    return String(value == null ? '' : value).toUpperCase()
      .replace(/[İŞÇÖÜĞ]/g,ch=>map[ch]||ch)
      .replace(/[^A-Z0-9]+/g,' ').replace(/\s+/g,' ').trim();
  }
  function parseDate(value) {
    try {
      if (DATE_DIMENSION && typeof DATE_DIMENSION.parseDate==='function') {
        const parsed=DATE_DIMENSION.parseDate(value);
        if (parsed instanceof Date && !isNaN(parsed)) return parsed;
      }
      const helper=root.BLExcelDates && root.BLExcelDates.parseDate;
      if (typeof helper === 'function') {
        const parsed=helper(value);
        if (parsed instanceof Date && !isNaN(parsed)) return parsed;
      }
    } catch (_) {}
    if (value instanceof Date && !isNaN(value)) return new Date(value.getFullYear(),value.getMonth(),value.getDate());
    if (value == null || value === '') return null;
    const text=String(value).trim();
    let m=text.match(/^(\\d{4})[-/.](\\d{1,2})[-/.](\\d{1,2})/);
    if (m) { const d=new Date(+m[1],+m[2]-1,+m[3]); return isNaN(d)?null:d; }
    m=text.match(/^(\\d{1,2})[-/.](\\d{1,2})[-/.](\\d{4})/);
    if (m) { const d=new Date(+m[3],+m[2]-1,+m[1]); return isNaN(d)?null:d; }
    const d=new Date(text); return isNaN(d)?null:new Date(d.getFullYear(),d.getMonth(),d.getDate());
  }
  function parseNumber(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (value == null || value === '') return null;
    let s=String(value).trim().replace(/\\s/g,'');
    if (!/[0-9]/.test(s)) return null;
    const comma=s.lastIndexOf(','), dot=s.lastIndexOf('.');
    if (comma>=0 && dot>=0) {
      if (comma>dot) s=s.replace(/\\./g,'').replace(',','.');
      else s=s.replace(/,/g,'');
    } else if (comma>=0) {
      if (/^[+-]?\\d{1,3}(?:,\\d{3})+$/.test(s)) s=s.replace(/,/g,'');
      else s=s.replace(',','.');
    } else if (dot>=0 && /^[+-]?\\d{1,3}(?:\\.\\d{3})+$/.test(s)) {
      s=s.replace(/\\./g,'');
    }
    s=s.replace(/[^0-9+\\-.]/g,'');
    const n=Number(s);
    return Number.isFinite(n)?n:null;
  }
  function isoDate(d) {
    return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  }
  function bucketFor(date,granularity) {
    const d=parseDate(date);
    if(!d)return {key:'',label:''};
    if(DATE_DIMENSION&&typeof DATE_DIMENSION.bucketKey==='function'&&typeof DATE_DIMENSION.bucketLabel==='function'){
      const key=DATE_DIMENSION.bucketKey(d,granularity);
      return {key,label:DATE_DIMENSION.bucketLabel(key,granularity,lang())};
    }
    const key=granularity==='year'?String(d.getFullYear()):granularity==='month'
      ? d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')
      : granularity==='week'?isoDate((()=>{const m=new Date(d);m.setDate(m.getDate()-((m.getDay()+6)%7));return m;})())
      : isoDate(d);
    return {key,label:key};
  }
  function normalizeHeaders(headers, rows) {
    const out=[], seen=new Set();
    function add(v) {
      const h=String(v == null ? '' : v).trim();
      if (!h || seen.has(h) || h[0]==='_') return;
      seen.add(h); out.push(h);
    }
    (Array.isArray(headers)?headers:[]).forEach(add);
    (Array.isArray(rows)?rows.slice(0,80):[]).forEach(row=>{
      if (row && typeof row==='object') Object.keys(row).forEach(add);
    });
    return out;
  }
  function detectDateHeaders(headers,rows) {
    const all=normalizeHeaders(headers,rows);
    return all.filter(header=>{
      try { if (root.BLExcelDates && typeof root.BLExcelDates.isDateHeader==='function' && root.BLExcelDates.isDateHeader(header)) return true; } catch (_) {}
      const vals=[];
      for (const row of (rows||[])) {
        const v=row && row[header];
        if (v!=null && String(v).trim()!=='') vals.push(v);
        if (vals.length>=40) break;
      }
      if (vals.length<3) return false;
      const good=vals.reduce((n,v)=>n+(parseDate(v)?1:0),0);
      return good/vals.length>=0.75;
    });
  }
  function fieldIndex(headers, patterns) {
    for (const re of patterns) {
      const found=headers.find(h=>re.test(normalizeHeader(h)));
      if (found) return found;
    }
    return '';
  }
  function inferState(headers,rows,base) {
    const all=normalizeHeaders(headers,rows), next=sanitizeState(base||state);
    const dates=detectDateHeaders(all,rows);
    if (!all.includes(next.timeField)) next.timeField=fieldIndex(dates,[/ANTREPO GIRIS/,/IN STORE/,/MODEL BUTCE/,/RETAIL/,/SEVK/,/TARIH/,/DATE/]) || dates[0] || '';
    if (next.metricField!=='__records' && !all.includes(next.metricField)) next.metricField='__records';
    if (next.metricField==='__records') {
      const qty=fieldIndex(all,[/^ADET$/,/^QUANTITY$/,/^QTY$/,/KALAN MIKTAR/,/ORDER QTY/]);
      if (qty) { next.metricField=qty; next.aggregation='sum'; }
    }
    if (next.seriesField && !all.includes(next.seriesField)) next.seriesField='';
    if (!next.seriesField) next.seriesField=fieldIndex(all,[/^BUYER$/,/BUYER GRUP|BUYING GROUP/,/^MAG$|MERCH ALT GRUP/,/KLASMAN|CATEGORY/]);
    return next;
  }
  function newAccumulator() { return {rows:0,nonblank:0,sum:0,numeric:0,distinct:new Set()}; }
  function addAccumulator(acc,value,metricField) {
    acc.rows++;
    if (metricField==='__records') { acc.nonblank++; acc.sum++; acc.numeric++; acc.distinct.add('__row__'+acc.rows); return; }
    if (value!=null && String(value).trim()!=='') {
      acc.nonblank++; acc.distinct.add(String(value));
      const n=parseNumber(value); if (n!=null) { acc.sum+=n; acc.numeric++; }
    }
  }
  function accumulatorValue(acc,aggregation,metricField) {
    if (!acc) return 0;
    if (aggregation==='distinct') return acc.distinct.size;
    if (aggregation==='sum') return acc.sum;
    if (aggregation==='avg') return acc.numeric ? acc.sum/acc.numeric : 0;
    return metricField==='__records' ? acc.rows : acc.nonblank;
  }
  function generatedTitle(st) {
    const period={day:tr('Gün','Day'),week:tr('Hafta','Week'),month:tr('Ay','Month'),year:tr('Yıl','Year')}[st.granularity];
    const measure=st.metricField==='__records'?tr('Kayıt Sayısı','Record Count'):st.metricField;
    return measure+' / '+period+(st.seriesField?' · '+st.seriesField:'');
  }
  function buildModel(rows,headers,inputState) {
    const all=normalizeHeaders(headers,rows), st=sanitizeState(inputState||state);
    if (!st.timeField || !all.includes(st.timeField)) return {categories:[],series:[],state:st,reason:'time-field'};
    const buckets=new Map(), labels=new Map(), seriesMaps=new Map();
    let used=0, invalidDates=0;
    for (const row of (Array.isArray(rows)?rows:[])) {
      const d=parseDate(row && row[st.timeField]);
      if (!d) { invalidDates++; continue; }
      const bucket=bucketFor(d,st.granularity);
      buckets.set(bucket.key,true); labels.set(bucket.key,bucket.label);
      const seriesName=st.seriesField ? String(row[st.seriesField]==null||String(row[st.seriesField]).trim()===''?tr('(boş)','(blank)'):row[st.seriesField]) : generatedTitle(st);
      if (!seriesMaps.has(seriesName)) seriesMaps.set(seriesName,new Map());
      const map=seriesMaps.get(seriesName);
      if (!map.has(bucket.key)) map.set(bucket.key,newAccumulator());
      addAccumulator(map.get(bucket.key),st.metricField==='__records'?1:row[st.metricField],st.metricField);
      used++;
    }
    const categoryKeys=[...buckets.keys()].sort();
    let names=[...seriesMaps.keys()];
    const totals=new Map();
    names.forEach(name=>{
      const map=seriesMaps.get(name);
      totals.set(name,categoryKeys.reduce((sum,key)=>sum+accumulatorValue(map.get(key),st.aggregation,st.metricField),0));
    });
    names.sort((a,b)=>(totals.get(b)||0)-(totals.get(a)||0)||String(a).localeCompare(String(b),'tr'));
    const limit=st.seriesLimit==='all'?Infinity:Number(st.seriesLimit)||20;
    const omitted=Math.max(0,names.length-limit);
    if (Number.isFinite(limit)) names=names.slice(0,limit);
    const series=names.map((name,index)=>({
      name,
      color:COLORS[index%COLORS.length],
      values:categoryKeys.map(key=>accumulatorValue(seriesMaps.get(name).get(key),st.aggregation,st.metricField)),
    }));
    return {
      title:st.title.trim()||generatedTitle(st),
      state:st,
      categories:categoryKeys.map(key=>({key,label:labels.get(key)||key})),
      series,
      usedRows:used,
      invalidDates,
      omittedSeriesCount:omitted,
      sourceSeriesCount:seriesMaps.size,
    };
  }
  function formatValue(value) {
    const n=Number(value)||0;
    try { return n.toLocaleString(lang()==='en'?'en-US':'tr-TR',{maximumFractionDigits:2}); } catch (_) { return String(Math.round(n*100)/100); }
  }
  function configSummary(st) {
    const agg={count:tr('Adet','Count'),distinct:tr('Benzersiz adet','Distinct count'),sum:tr('Toplam','Sum'),avg:tr('Ortalama','Average')}[st.aggregation];
    const gran={day:tr('Gün','Day'),week:tr('Hafta','Week'),month:tr('Ay','Month'),year:tr('Yıl','Year')}[st.granularity];
    const metric=st.metricField==='__records'?tr('Kayıtlar','Records'):st.metricField;
    return st.timeField+' · '+gran+' · '+agg+' '+metric+(st.seriesField?' · '+st.seriesField:'');
  }
  function svgChart(model) {
    const width=1080, baseHeight=430, cols=4, legendRows=Math.max(1,Math.ceil(model.series.length/cols));
    const height=baseHeight+legendRows*24, left=72,right=24,top=28,bottom=78+legendRows*22;
    const pw=width-left-right, ph=height-top-bottom;
    const values=model.series.flatMap(s=>s.values).filter(Number.isFinite);
    let max=Math.max(0,...values); if (!(max>0)) max=1;
    const tickCount=5;
    let out='<svg class="backlogChartSvg" viewBox="0 0 '+width+' '+height+'" role="img" aria-label="'+esc(model.title)+'">';
    out+='<rect x="0" y="0" width="'+width+'" height="'+height+'" rx="8" class="backlogChartBg"/>';
    for(let i=0;i<=tickCount;i++){
      const val=max*(tickCount-i)/tickCount, y=top+ph*i/tickCount;
      out+='<line x1="'+left+'" x2="'+(width-right)+'" y1="'+y+'" y2="'+y+'" class="backlogChartGrid"/>';
      out+='<text x="'+(left-10)+'" y="'+(y+4)+'" text-anchor="end" class="backlogChartAxisText">'+esc(formatValue(val))+'</text>';
    }
    const n=Math.max(1,model.categories.length), step=pw/n;
    const labelStep=Math.max(1,Math.ceil(n/12));
    model.categories.forEach((cat,i)=>{
      const x=left+step*(i+.5);
      if(i%labelStep===0||i===model.categories.length-1) out+='<text x="'+x+'" y="'+(top+ph+25)+'" text-anchor="middle" class="backlogChartAxisText">'+esc(cat.label)+'</text>';
    });
    if(model.state.chartType==='bar'){
      const count=Math.max(1,model.series.length), group=step*.78, bw=Math.max(.7,group/count);
      model.series.forEach((serie,si)=>{
        serie.values.forEach((v,i)=>{
          const h=ph*(Number(v)||0)/max, x=left+step*(i+.5)-group/2+si*bw, y=top+ph-h;
          out+='<rect x="'+x.toFixed(2)+'" y="'+y.toFixed(2)+'" width="'+Math.max(.6,bw-1).toFixed(2)+'" height="'+Math.max(0,h).toFixed(2)+'" fill="'+serie.color+'" opacity=".88"><title>'+esc(serie.name+' · '+model.categories[i].label+': '+formatValue(v))+'</title></rect>';
        });
      });
    } else {
      model.series.forEach(serie=>{
        const pts=serie.values.map((v,i)=>{
          const x=left+step*(i+.5), y=top+ph-ph*(Number(v)||0)/max; return x.toFixed(2)+','+y.toFixed(2);
        }).join(' ');
        out+='<polyline points="'+pts+'" fill="none" stroke="'+serie.color+'" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>';
        serie.values.forEach((v,i)=>{
          const x=left+step*(i+.5), y=top+ph-ph*(Number(v)||0)/max;
          out+='<circle cx="'+x.toFixed(2)+'" cy="'+y.toFixed(2)+'" r="3" fill="'+serie.color+'"><title>'+esc(serie.name+' · '+model.categories[i].label+': '+formatValue(v))+'</title></circle>';
        });
      });
    }
    model.series.forEach((serie,i)=>{
      const row=Math.floor(i/cols), col=i%cols, x=left+col*(pw/cols), y=height-bottom+58+row*22;
      out+='<line x1="'+x+'" x2="'+(x+18)+'" y1="'+(y-4)+'" y2="'+(y-4)+'" stroke="'+serie.color+'" stroke-width="3"/>';
      out+='<text x="'+(x+25)+'" y="'+y+'" class="backlogChartLegendText">'+esc(serie.name)+'</text>';
    });
    out+='</svg>'; return out;
  }
  function cacheSignature(params) {
    return Object.keys(params||{}).sort().map(k=>k+'='+String(params[k]==null?'':params[k])).join('&');
  }
  function queryParams() {
    try {
      const ctx=root.BLBacklogChartContext;
      return ctx && typeof ctx.queryParams==='function' ? (ctx.queryParams()||{}) : {};
    } catch (_) { return {}; }
  }
  async function loadDetail(force) {
    try {
      const ctx=root.BLBacklogChartContext;
      if(ctx&&typeof ctx.prepareQuery==='function')await ctx.prepareQuery();
    } catch (_) {}
    const params=queryParams(), sig=cacheSignature(params);
    if (!force && cache.signature===sig && cache.rows.length) return cache;
    const qs=new URLSearchParams(Object.entries(params).filter(([,v])=>v!=null&&v!=='')).toString();
    const res=await root.fetch('/api/backlog-export'+(qs?'?'+qs:''));
    if(!res.ok){ let msg=res.statusText; try{const e=await res.json();msg=e.error||msg;}catch(_){} throw new Error(msg); }
    const data=await res.json();
    cache={signature:sig,headers:normalizeHeaders(data.headers||[],data.rows||[]),rows:Array.isArray(data.rows)?data.rows:[]};
    return cache;
  }
  function invalidate() { cache={signature:'',headers:[],rows:[]}; }

  function panel() { return root.document && root.document.getElementById('backlogChartPanel'); }
  async function render(force,detailOverride) {
    const host=panel(); if(!host || !state.enabled) { if(host)host.hidden=true; return; }
    host.hidden=false;
    host.innerHTML='<div class="backlogChartLoading">'+esc(tr('Grafik hazırlanıyor…','Preparing chart…'))+'</div>';
    try {
      const detail=detailOverride||await loadDetail(!!force);
      const inferred=inferState(detail.headers,detail.rows,state);
      if(!inferred.timeField) throw new Error(tr('Grafik için tarih alanı bulunamadı.','No date field was found for the chart.'));
      if(inferred.timeField!==state.timeField || inferred.metricField!==state.metricField || inferred.seriesField!==state.seriesField) saveState(Object.assign({},state,inferred,{enabled:true}));
      const model=buildModel(detail.rows,detail.headers,state);
      if(!model.categories.length||!model.series.length) throw new Error(tr('Seçili ayarlarla grafikte gösterilecek veri yok.','There is no chart data for the selected settings.'));
      host.innerHTML='<div class="backlogChartHead"><div><strong>'+esc(model.title)+'</strong><small>'+esc(configSummary(model.state))+'</small></div>'
        +'<div class="backlogChartActions"><button type="button" class="tbtn" data-backlog-chart-refresh>'+esc(tr('Yenile','Refresh'))+'</button>'
        +'<button type="button" class="tbtn" data-backlog-chart-edit>'+esc(tr('Ayarlar','Settings'))+'</button>'
        +'<button type="button" class="tbtn" data-backlog-chart-disable aria-label="'+esc(tr('Grafiği kapat','Hide chart'))+'">×</button></div></div>'
        +(model.omittedSeriesCount?'<div class="backlogChartNotice">'+esc(tr('Okunabilirlik için en yüksek '+model.series.length+' seri gösteriliyor; '+model.omittedSeriesCount+' seri gizli. Ayarlardan seri limitini artırabilirsiniz.','Showing the top '+model.series.length+' series; '+model.omittedSeriesCount+' series are hidden. Increase the series limit in settings.'))+'</div>':'')
        +'<div class="backlogChartCanvas">'+svgChart(model)+'</div>';
      host.querySelector('[data-backlog-chart-edit]')?.addEventListener('click',openSettings);
      host.querySelector('[data-backlog-chart-refresh]')?.addEventListener('click',()=>{invalidate();render(true);});
      host.querySelector('[data-backlog-chart-disable]')?.addEventListener('click',()=>{saveState(Object.assign({},state,{enabled:false}));host.hidden=true;});
    } catch(err) {
      host.innerHTML='<div class="backlogChartError">'+esc(tr('Grafik oluşturulamadı: ','Chart could not be created: ')+err.message)+'</div>';
    }
  }

  function optionHtml(values,selected,blankLabel) {
    let html=blankLabel!=null?'<option value="">'+esc(blankLabel)+'</option>':'';
    return html+values.map(v=>'<option value="'+esc(v)+'"'+(v===selected?' selected':'')+'>'+esc(v)+'</option>').join('');
  }
  async function openSettings() {
    if(!root.document)return;
    root.document.getElementById('_backlogChartSettingsModal')?.remove();
    const overlay=root.document.createElement('div');
    overlay.id='_backlogChartSettingsModal'; overlay.className='autoModalOverlay';
    overlay.innerHTML='<div class="autoModal backlogChartSettingsModal"><header><h3>'+esc(tr('Backlog Grafik Ayarları','Backlog Chart Settings'))+'</h3><button type="button" data-chart-close>×</button></header><div class="autoModalBody"><div class="backlogChartLoading">'+esc(tr('Alanlar yükleniyor…','Loading fields…'))+'</div></div></div>';
    root.document.body.appendChild(overlay);
    const close=()=>overlay.remove();
    overlay.querySelector('[data-chart-close]')?.addEventListener('click',close);
    let detail;
    try { detail=await loadDetail(false); }
    catch(err){ overlay.querySelector('.autoModalBody').innerHTML='<div class="backlogChartError">'+esc(err.message)+'</div>'; return; }
    const headers=normalizeHeaders(detail.headers,detail.rows), dates=detectDateHeaders(headers,detail.rows);
    const draft=inferState(headers,detail.rows,state);
    const body=overlay.querySelector('.autoModalBody');
    body.innerHTML='<div class="backlogChartSettingsGrid">'
      +'<label><span>'+esc(tr('Zaman alanı','Time field'))+'</span><select id="backlogChartTime">'+optionHtml(dates,draft.timeField,null)+'</select></label>'
      +'<label><span>'+esc(tr('Zaman kırılımı','Time interval'))+'</span><select id="backlogChartGran"><option value="day">'+esc(tr('Gün','Day'))+'</option><option value="week">'+esc(tr('Hafta','Week'))+'</option><option value="month">'+esc(tr('Ay','Month'))+'</option><option value="year">'+esc(tr('Yıl','Year'))+'</option></select></label>'
      +'<label><span>'+esc(tr('Adet / değer alanı','Quantity / value field'))+'</span><select id="backlogChartMetric"><option value="__records">'+esc(tr('Kayıtlar','Records'))+'</option>'+optionHtml(headers,draft.metricField,null)+'</select></label>'
      +'<label><span>'+esc(tr('Hesaplama','Aggregation'))+'</span><select id="backlogChartAgg"><option value="count">'+esc(tr('Adet','Count'))+'</option><option value="distinct">'+esc(tr('Benzersiz adet','Distinct count'))+'</option><option value="sum">'+esc(tr('Toplam','Sum'))+'</option><option value="avg">'+esc(tr('Ortalama','Average'))+'</option></select></label>'
      +'<label><span>'+esc(tr('Kırılım / seri','Breakdown / series'))+'</span><select id="backlogChartSeries">'+optionHtml(headers,draft.seriesField,tr('Kırılım yok','No breakdown'))+'</select></label>'
      +'<label><span>'+esc(tr('Grafik tipi','Chart type'))+'</span><select id="backlogChartType"><option value="line">'+esc(tr('Çizgi','Line'))+'</option><option value="bar">'+esc(tr('Sütun','Column'))+'</option></select></label>'
      +'<label><span>'+esc(tr('Seri limiti','Series limit'))+'</span><select id="backlogChartLimit"><option value="5">5</option><option value="10">10</option><option value="20">20</option><option value="50">50</option><option value="all">'+esc(tr('Tümü','All'))+'</option></select></label>'
      +'<label class="backlogChartTitleField"><span>'+esc(tr('Başlık (opsiyonel)','Title (optional)'))+'</span><input id="backlogChartTitle" type="text" maxlength="160" value="'+esc(draft.title)+'"></label>'
      +'</div><p class="backlogChartSettingsHint">'+esc(tr('Grafik Backlog filtrelerini aynen kullanır. Excel aktarımında Grafik ve Grafik Verisi sayfaları da oluşturulur.','The chart uses the active Backlog filters. Excel export also creates Chart and Chart Data sheets.'))+'</p>';
    const modal=overlay.querySelector('.autoModal');
    const footer=root.document.createElement('footer');
    footer.innerHTML=(state.enabled?'<button type="button" class="tbtn" data-chart-remove>'+esc(tr('Grafiği kaldır','Remove chart'))+'</button>':'<span></span>')
      +'<button type="button" class="tbtn" data-chart-cancel>'+esc(tr('Vazgeç','Cancel'))+'</button>'
      +'<button type="button" class="tbtn primary" data-chart-save>'+esc(tr('Uygula','Apply'))+'</button>';
    modal.appendChild(footer);
    const set=(id,val)=>{const el=overlay.querySelector('#'+id);if(el)el.value=val;};
    set('backlogChartGran',draft.granularity); set('backlogChartAgg',draft.aggregation); set('backlogChartType',draft.chartType); set('backlogChartLimit',draft.seriesLimit);
    overlay.querySelector('[data-chart-cancel]')?.addEventListener('click',close);
    overlay.querySelector('[data-chart-remove]')?.addEventListener('click',()=>{saveState(Object.assign({},state,{enabled:false}));const p=panel();if(p)p.hidden=true;close();});
    overlay.querySelector('[data-chart-save]')?.addEventListener('click',()=>{
      const next=sanitizeState({
        enabled:true,
        timeField:overlay.querySelector('#backlogChartTime')?.value,
        granularity:overlay.querySelector('#backlogChartGran')?.value,
        metricField:overlay.querySelector('#backlogChartMetric')?.value,
        aggregation:overlay.querySelector('#backlogChartAgg')?.value,
        seriesField:overlay.querySelector('#backlogChartSeries')?.value,
        chartType:overlay.querySelector('#backlogChartType')?.value,
        seriesLimit:overlay.querySelector('#backlogChartLimit')?.value,
        title:overlay.querySelector('#backlogChartTitle')?.value,
      });
      if(!next.timeField){notify(tr('Grafik için bir tarih alanı seçin.','Select a date field for the chart.'));return;}
      if(next.metricField==='__records')next.aggregation='count';
      const model=buildModel(detail.rows,detail.headers,next);
      if(!model.categories.length){notify(tr('Seçili tarih alanında grafiğe uygun veri yok.','The selected date field has no chartable data.'));return;}
      saveState(next); close(); render(false,detail);
    });
    overlay.addEventListener('mousedown',e=>{if(e.target===overlay)close();});
  }

  function uniqueSheetName(wb,base) {
    const used=new Set((wb.SheetNames||[]).map(String));
    if(!used.has(base))return base;
    for(let i=2;i<100;i++){const n=(base+' '+i).slice(0,31);if(!used.has(n))return n;}
    return (base.slice(0,27)+' '+Date.now().toString().slice(-3)).slice(0,31);
  }
  function excelColumn(index) {
    let n=index+1,out=''; while(n>0){const r=(n-1)%26;out=String.fromCharCode(65+r)+out;n=Math.floor((n-1)/26);} return out;
  }
  function quoteSheet(name) { return "'"+String(name).replace(/'/g,"''")+"'"; }
  function appendWorkbookSheets(wb,rows,headers,options) {
    const opts=options||{}, XLSX=opts.XLSX||root.XLSX, st=sanitizeState(opts.state||state);
    if(!st.enabled||!st.timeField||!XLSX||!XLSX.utils||!wb)return null;
    const model=buildModel(rows,headers,st);
    if(!model.categories.length||!model.series.length)return null;
    const chartName=uniqueSheetName(wb,tr('Grafik','Chart'));
    const dataName=uniqueSheetName(wb,tr('Grafik Verisi','Chart Data'));
    const chartWs=XLSX.utils.aoa_to_sheet([[model.title],[configSummary(st)],[]]);
    chartWs['!cols']=[{wch:24},{wch:18},{wch:18},{wch:18},{wch:18},{wch:18},{wch:18},{wch:18},{wch:18},{wch:18},{wch:18},{wch:18}];
    XLSX.utils.book_append_sheet(wb,chartWs,chartName);
    const matrix=[[tr('Zaman','Time'),...model.series.map(s=>s.name)]];
    model.categories.forEach((cat,i)=>matrix.push([cat.label,...model.series.map(s=>s.values[i])]));
    const dataWs=XLSX.utils.aoa_to_sheet(matrix);
    dataWs['!cols']=[{wch:20},...model.series.map(()=>({wch:18}))];
    XLSX.utils.book_append_sheet(wb,dataWs,dataName);
    const first=2,last=model.categories.length+1,categories=quoteSheet(dataName)+'!$A$'+first+':$A$'+last;
    const series=model.series.map((s,i)=>({name:s.name,valuesFormula:quoteSheet(dataName)+'!$'+excelColumn(i+1)+'$'+first+':$'+excelColumn(i+1)+'$'+last}));
    return {model,charts:[{
      sheetPath:'xl/worksheets/sheet'+((wb.SheetNames||[]).indexOf(chartName)+1)+'.xml',
      chartType:st.chartType,title:model.title,categoriesFormula:categories,series,
      anchor:{fromCol:0,fromRow:3,toCol:15,toRow:27},
    }],chartSheetName:chartName,dataSheetName:dataName};
  }

  function titleXml(title) {
    return '<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="'+(lang()==='en'?'en-US':'tr-TR')+'"/><a:t>'+xml(title)+'</a:t></a:r><a:endParaRPr lang="'+(lang()==='en'?'en-US':'tr-TR')+'"/></a:p></c:rich></c:tx><c:layout/><c:overlay val="0"/></c:title>';
  }
  function chartXml(spec,index) {
    const catAx=100000+index*2,valAx=catAx+1;
    const series=(spec.series||[]).map((s,i)=>{
      return '<c:ser><c:idx val="'+i+'"/><c:order val="'+i+'"/><c:tx><c:v>'+xml(s.name)+'</c:v></c:tx>'
        +(spec.chartType==='line'?'<c:marker><c:symbol val="circle"/><c:size val="5"/></c:marker>':'')
        +'<c:cat><c:strRef><c:f>'+xml(spec.categoriesFormula)+'</c:f></c:strRef></c:cat>'
        +'<c:val><c:numRef><c:f>'+xml(s.valuesFormula)+'</c:f></c:numRef></c:val>'
        +(spec.chartType==='line'?'<c:smooth val="0"/>':'')+'</c:ser>';
    }).join('');
    const chartBody=spec.chartType==='bar'
      ? '<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>'+series+'<c:axId val="'+catAx+'"/><c:axId val="'+valAx+'"/></c:barChart>'
      : '<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>'+series+'<c:marker val="1"/><c:smooth val="0"/><c:axId val="'+catAx+'"/><c:axId val="'+valAx+'"/></c:lineChart>';
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      +'<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
      +'<c:date1904 val="0"/><c:lang val="'+(lang()==='en'?'en-US':'tr-TR')+'"/><c:chart>'+titleXml(spec.title||'')
      +'<c:autoTitleDeleted val="0"/><c:plotArea><c:layout/>'+chartBody
      +'<c:catAx><c:axId val="'+catAx+'"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:tickLblPos val="nextTo"/><c:crossAx val="'+valAx+'"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/></c:catAx>'
      +'<c:valAx><c:axId val="'+valAx+'"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:majorGridlines/><c:numFmt formatCode="#,##0.00" sourceLinked="0"/><c:tickLblPos val="nextTo"/><c:crossAx val="'+catAx+'"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx>'
      +'</c:plotArea><c:legend><c:legendPos val="b"/><c:layout/><c:overlay val="0"/></c:legend><c:plotVisOnly val="1"/><c:dispBlanksAs val="zero"/><c:showDLblsOverMax val="0"/></c:chart>'
      +'<c:printSettings><c:headerFooter/><c:pageMargins b="0.75" l="0.7" r="0.7" t="0.75" header="0.3" footer="0.3"/><c:pageSetup/></c:printSettings></c:chartSpace>';
  }
  function drawingXml(chartRelId,spec,index) {
    const a=spec.anchor||{},fc=Number.isFinite(+a.fromCol)?+a.fromCol:0,fr=Number.isFinite(+a.fromRow)?+a.fromRow:2,tc=Number.isFinite(+a.toCol)?+a.toCol:15,trr=Number.isFinite(+a.toRow)?+a.toRow:27;
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      +'<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">'
      +'<xdr:twoCellAnchor><xdr:from><xdr:col>'+fc+'</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>'+fr+'</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>'
      +'<xdr:to><xdr:col>'+tc+'</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>'+trr+'</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>'
      +'<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="'+(index+2)+'" name="Buyer Log Chart '+(index+1)+'"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm/>'
      +'<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="'+chartRelId+'"/></a:graphicData></a:graphic>'
      +'</xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor></xdr:wsDr>';
  }
  function relsXml(items) {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+items.join('')+'</Relationships>';
  }
  function nextRid(source) {
    let max=0; String(source||'').replace(/Id="rId(\d+)"/g,(_,n)=>{max=Math.max(max,+n);return _;}); return 'rId'+(max+1);
  }
  function addRelationship(source,id,type,target) {
    const rel='<Relationship Id="'+id+'" Type="'+type+'" Target="'+xml(target)+'"/>';
    if(!source)return relsXml([rel]);
    return String(source).replace(/<\/Relationships>\s*$/i,rel+'</Relationships>');
  }
  function addDrawingToWorksheet(source,rid) {
    let xmlText=String(source||'');
    xmlText=xmlText.replace(/<worksheet\b([^>]*)>/i,(whole,attrs)=>{
      return /xmlns:r=/.test(attrs)?whole:'<worksheet'+attrs+' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">';
    });
    const node='<drawing r:id="'+rid+'"/>';
    const marker=/<(?:legacyDrawing|legacyDrawingHF|picture|oleObjects|controls|webPublishItems|tableParts|extLst)\b/i.exec(xmlText);
    const at=marker?marker.index:xmlText.lastIndexOf('</worksheet>');
    if(at<0)throw new Error('Worksheet closing tag was not found for chart export.');
    return xmlText.slice(0,at)+node+xmlText.slice(at);
  }
  function addContentOverride(source,partName,contentType) {
    if(String(source).includes('PartName="'+partName+'"'))return source;
    const item='<Override PartName="'+partName+'" ContentType="'+contentType+'"/>';
    return String(source).replace(/<\/Types>\s*$/i,item+'</Types>');
  }
  function nextPartNumber(zip,prefix,re) {
    let max=0;
    Object.keys(zip.files||{}).forEach(name=>{const m=name.match(re);if(m)max=Math.max(max,+m[1]);});
    return max+1;
  }
  async function applyExcelCharts(data,specs,JSZipCtor,outputType) {
    const Zip=JSZipCtor || root.JSZip;
    if(!Zip||typeof Zip.loadAsync!=='function')throw new Error('JSZip is required for Excel charts.');
    const list=Array.isArray(specs)?specs.filter(Boolean):[];
    if(!list.length)return data;
    const zip=await Zip.loadAsync(data);
    const typesEntry=zip.file('[Content_Types].xml');
    if(!typesEntry)throw new Error('Excel content types file was not found.');
    let contentTypes=await typesEntry.async('string');
    let chartNo=nextPartNumber(zip,'xl/charts',/^xl\/charts\/chart(\d+)\.xml$/i);
    let drawingNo=nextPartNumber(zip,'xl/drawings',/^xl\/drawings\/drawing(\d+)\.xml$/i);
    for(let i=0;i<list.length;i++,chartNo++,drawingNo++){
      const spec=list[i],sheetPath=String(spec.sheetPath||'');
      const sheetEntry=zip.file(sheetPath); if(!sheetEntry)throw new Error('Excel chart worksheet was not found: '+sheetPath);
      let sheetXml=await sheetEntry.async('string');
      const fileName=sheetPath.split('/').pop();
      const relPath=sheetPath.replace(/\/[^/]+$/, '/_rels/'+fileName+'.rels');
      const relEntry=zip.file(relPath);
      let sheetRels=relEntry?await relEntry.async('string'):'';
      const drawingRid=nextRid(sheetRels);
      sheetRels=addRelationship(sheetRels,drawingRid,'http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing','../drawings/drawing'+drawingNo+'.xml');
      sheetXml=addDrawingToWorksheet(sheetXml,drawingRid);
      zip.file(sheetPath,sheetXml); zip.file(relPath,sheetRels);
      const chartPath='xl/charts/chart'+chartNo+'.xml',drawingPath='xl/drawings/drawing'+drawingNo+'.xml',drawingRelPath='xl/drawings/_rels/drawing'+drawingNo+'.xml.rels';
      zip.file(chartPath,chartXml(spec,i));
      zip.file(drawingPath,drawingXml('rId1',spec,i));
      zip.file(drawingRelPath,relsXml(['<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart'+chartNo+'.xml"/>']));
      contentTypes=addContentOverride(contentTypes,'/'+chartPath,'application/vnd.openxmlformats-officedocument.drawingml.chart+xml');
      contentTypes=addContentOverride(contentTypes,'/'+drawingPath,'application/vnd.openxmlformats-officedocument.drawing+xml');
    }
    zip.file('[Content_Types].xml',contentTypes);
    return zip.generateAsync({type:outputType||'uint8array',compression:'DEFLATE',compressionOptions:{level:6}});
  }

  function init() {
    if(initialized||!root.document)return; initialized=true; loadState();
    root.document.getElementById('backlogChartBtn')?.addEventListener('click',openSettings);
    const host=panel(); if(host&&state.enabled)host.hidden=false;
  }
  function onBacklogRendered(data) {
    invalidate();
    if(data&&state.enabled)render(true);
  }

  return Object.freeze({
    init,onBacklogRendered,openSettings,render,invalidate,
    getState,saveState,sanitizeState,normalizeHeaders,detectDateHeaders,inferState,
    parseDate,parseNumber,bucketFor,buildModel,appendWorkbookSheets,
    chartXml,drawingXml,applyExcelCharts,
  });
});
