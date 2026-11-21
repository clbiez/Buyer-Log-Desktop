/* Tablo aramasında alan kısayolları.
 *   Dönem : MB=W1, MB=W1-W24, MB=M10-M12, EXF=M3, RT=W34, MB=2027M3, MB=2026M11-2027M2
 *   Sezon : SEZON=S7 / SEASON=S7
 * Satır arama metnine dil bağımsız jetonlar (~mbm03~, ~mbm202703~, ~szs7~) eklenir;
 * sorgu ifadesi aynı jetonların VEYA kümesine çevrilir. Yılsız ifade her yılla
 * eşleşir; kapsam sezonla daraltılır ("SEZON=S7; MB=M3-M5").
 * Hafta/ay ataması LCW Merch takvimini (BLDateDimension) izler; tarih takvime
 * eşlenmemişse takvim ayı ve GLB/ISO haftasına düşülür.
 */
(function(root,factory){
  'use strict';
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.BLTableSearchPeriods=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(root){
  'use strict';

  const FIELD_ALIASES=Object.freeze({mb:'mb',exf:'exf',ex:'exf',exfactory:'exf',rt:'rt',retail:'rt',sezon:'sz',season:'sz'});
  const FIELD_LABELS=Object.freeze({mb:{tr:'MB',en:'MB'},exf:{tr:'Ex-Factory',en:'Ex-Factory'},rt:{tr:'Retail',en:'Retail'},sz:{tr:'Sezon',en:'Season'}});
  // W/M İngilizce, H(afta)/A(y) Türkçe kısaltma.
  const UNIT_ALIASES=Object.freeze({w:'w',h:'w',m:'m',a:'m'});
  const UNIT_MAX=Object.freeze({w:53,m:12});
  const MAX_TOKENS=160;
  const HEAD=/^([a-z][a-z-]*)\s*=\s*(.*)$/;
  const PERIOD=/^(?:(\d{4})\s*)?([a-z])\s*(\d{1,2})(?:\s*-\s*(?:(\d{4})\s*)?([a-z])?\s*(\d{1,2}))?$/;
  const api={used:false};

  const pad2=value=>String(value).padStart(2,'0');
  const token=(field,unit,number,year)=>'~'+field+unit+(year?String(year):'')+pad2(number)+'~';
  const seasonKey=value=>String(value==null?'':value).toLowerCase().replace(/[^a-z0-9]/g,'');
  const seasonToken=value=>'~sz'+seasonKey(value)+'~';

  function invalid(field,reason){return {invalid:true,field,reason};}

  /* null: kısayol değil (düz metin). {invalid}: tanınan alan, geçersiz değer. */
  function parse(text){
    const raw=String(text==null?'':text).trim().toLowerCase();
    if(!raw||raw.indexOf('=')<0)return null;
    const head=HEAD.exec(raw);if(!head)return null;
    const field=FIELD_ALIASES[head[1].replace(/-/g,'')];
    if(!field)return null;
    const value=head[2].trim();
    if(field==='sz'){
      const key=seasonKey(value);
      if(!key)return invalid(field,'season');
      api.used=true;
      return {field,kind:'season',season:value.toUpperCase(),tokens:[seasonToken(value)]};
    }
    const m=PERIOD.exec(value);
    if(!m)return invalid(field,'format');
    const unit=UNIT_ALIASES[m[2]];
    if(!unit||(m[5]&&UNIT_ALIASES[m[5]]!==unit))return invalid(field,'format');
    const max=UNIT_MAX[unit],start=Number(m[3]),end=m[6]?Number(m[6]):start;
    if(start<1||start>max||end<1||end>max)return invalid(field,unit==='m'?'month':'week');
    if(m[4]&&!m[1])return invalid(field,'format');
    const startYear=m[1]?Number(m[1]):0;
    let endYear=m[4]?Number(m[4]):0;
    if(startYear&&!endYear)endYear=end<start?startYear+1:startYear;
    if(startYear&&(endYear<startYear||(endYear===startYear&&end<start)))return invalid(field,'order');
    const items=[];
    // Yılsız aralık yıl sonunu aşabilir: W50-W4 / M11-M2 ileri sarar.
    for(let year=startYear,n=start;items.length<=MAX_TOKENS;){
      items.push({year,n});
      if(n===end&&(!startYear||year===endYear))break;
      if(n===max){n=1;if(startYear)year++;}else n++;
    }
    if(items.length>MAX_TOKENS)return invalid(field,'range');
    api.used=true;
    return {
      field,kind:'period',unit,start,end,startYear,endYear,
      numbers:items.map(item=>item.n),
      tokens:items.map(item=>token(field,unit,item.n,item.year)),
    };
  }

  function dateDimension(){return root&&root.BLDateDimension||null;}

  // Tarihler tabloda çok tekrar eder (30k satırda birkaç yüz farklı gün); dönem tarih başına
  // bir kez hesaplanır. Merch takvimi değişince önbellek boşaltılır.
  let periodMemo=new Map(),periodMemoRevision=null;
  function periodOfDate(value){
    const dim=dateDimension();
    if(!dim||typeof dim.describe!=='function'||value==null||value==='')return null;
    const revision=typeof dim.merchCalendarRevision==='function'?dim.merchCalendarRevision():0;
    if(revision!==periodMemoRevision||periodMemo.size>20000){periodMemo=new Map();periodMemoRevision=revision;}
    const key=value instanceof Date?'d'+value.getTime():typeof value+':'+value;
    if(periodMemo.has(key))return periodMemo.get(key);
    const d=dim.describe(value);
    let result=null;
    if(d&&d.valid){
      result=d.businessValid
        ?{week:d.lcwWeek,weekYear:d.lcwYear,month:d.month,monthYear:d.periodYear}
        :{week:d.isoWeek,weekYear:d.isoWeekYear,month:d.date?d.date.getMonth()+1:null,monthYear:d.date?d.date.getFullYear():null};
    }
    periodMemo.set(key,result);
    return result;
  }

  function weekOfCode(code){
    const m=/^(\d{4})[-/. ]?w?(\d{1,2})$/i.exec(String(code==null?'':code).trim());
    const n=m?Number(m[2]):NaN;
    return n>=1&&n<=UNIT_MAX.w?{week:n,weekYear:Number(m[1])}:null;
  }
  function monthOfCode(code){
    const m=/^(\d{4})(\d{2})$/.exec(String(code==null?'':code).trim());
    const n=m?Number(m[2]):NaN;
    return n>=1&&n<=12?{month:n,monthYear:Number(m[1])}:null;
  }

  /* fields: {mbWeekCode:'2027-07', mbMonthCode:'202707', mbDate, exFactory, retail, season} */
  function rowTokens(fields){
    const f=fields||{},out=[];
    const push=(field,unit,n,year)=>{if(n){out.push(token(field,unit,n));if(year)out.push(token(field,unit,n,year));}};
    const mbDate=periodOfDate(f.mbDate);
    const mbWeek=weekOfCode(f.mbWeekCode)||mbDate,mbMonth=monthOfCode(f.mbMonthCode)||mbDate;
    if(mbWeek)push('mb','w',mbWeek.week,mbWeek.weekYear);
    if(mbMonth)push('mb','m',mbMonth.month,mbMonth.monthYear);
    [['exf',f.exFactory],['rt',f.retail]].forEach(([field,value])=>{
      const p=periodOfDate(value);
      if(p){push(field,'w',p.week,p.weekYear);push(field,'m',p.month,p.monthYear);}
    });
    if(seasonKey(f.season))out.push(seasonToken(f.season));
    return out.join(' ');
  }

  function monthName(n,english){
    const dim=dateDimension(),list=dim&&(english?dim.MONTHS_EN:dim.MONTHS_TR);
    return list&&list[n-1]?list[n-1]:String(n);
  }

  /* Kip etiketi: "MB · Mart–Mayıs 2027", "Ex-Factory · 12–14. hafta", "Sezon · S7". */
  function label(parsed,english){
    if(!parsed||parsed.invalid)return '';
    const fieldLabel=FIELD_LABELS[parsed.field][english?'en':'tr'];
    if(parsed.kind==='season')return fieldLabel+' · '+parsed.season;
    const range=parsed.start!==parsed.end||parsed.startYear!==parsed.endYear;
    let text;
    if(parsed.unit==='m'){
      const a=monthName(parsed.start,english)+(parsed.startYear&&parsed.startYear!==parsed.endYear?' '+parsed.startYear:'');
      const b=monthName(parsed.end,english)+(parsed.endYear?' '+parsed.endYear:'');
      text=range?a+'–'+b:b;
    }else{
      const a=(parsed.startYear&&parsed.startYear!==parsed.endYear?parsed.startYear+' ':'')+parsed.start;
      const b=String(parsed.end);
      const nums=range?a+'–'+b:b;
      text=english?'Week '+nums+(parsed.endYear?' '+parsed.endYear:''):nums+'. hafta'+(parsed.endYear?' '+parsed.endYear:'');
    }
    return fieldLabel+' · '+text;
  }

  function invalidReason(parsed,english){
    const reasons={
      month:['Ay 1–12 arasında olmalı.','Month must be 1–12.'],
      week:['Hafta 1–53 arasında olmalı.','Week must be 1–53.'],
      order:['Aralık başlangıcı bitişten sonra olamaz.','Range start cannot be after its end.'],
      range:['Aralık çok uzun.','Range is too long.'],
      season:['Sezon değeri yazın, örn. SEZON=S7.','Enter a season, e.g. SEASON=S7.'],
      format:['Örnek: MB=M3, MB=W1-W24, MB=2027M3.','Example: MB=M3, MB=W1-W24, MB=2027M3.'],
    };
    const pair=reasons[parsed&&parsed.reason]||reasons.format;
    return english?pair[1]:pair[0];
  }

  /* Öneri listesi için: arama metinlerindeki jetonları sayar. */
  function countTokens(texts,field,unit){
    const counts=new Map();
    const re=field==='sz'?/~sz([a-z0-9]+)~/g:new RegExp('~'+field+unit+'(\\d{2})~','g');
    for(const text of texts||[]){
      if(!text)continue;
      const seen=new Set();let m;re.lastIndex=0;
      while((m=re.exec(text))){if(!seen.has(m[1])){seen.add(m[1]);counts.set(m[1],(counts.get(m[1])||0)+1);}}
    }
    return counts;
  }

  return Object.assign(api,{parse,rowTokens,token,seasonToken,label,invalidReason,countTokens,monthName,FIELD_ALIASES,FIELD_LABELS});
});
