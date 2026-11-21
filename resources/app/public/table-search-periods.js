/* Tablo aramasında dönem kısayolları: MB=W1, MB=W1-W24, EXF=M3, RT=M10-M12 …
 * Satır arama metnine dil bağımsız jetonlar (~mbm03~, ~exfw12~) eklenir; sorgu
 * ifadesi aynı jetonların VEYA kümesine çevrilir. Yıl bilinçli olarak yoktur:
 * kapsam kullanıcının yazdığı sezonla daraltılır ("S7; MB=M3-M5").
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

  const FIELD_ALIASES=Object.freeze({mb:'mb',exf:'exf',ex:'exf',exfactory:'exf',rt:'rt',retail:'rt'});
  // W/M İngilizce, H(afta)/A(y) Türkçe kısaltma.
  const UNIT_ALIASES=Object.freeze({w:'w',h:'w',m:'m',a:'m'});
  const UNIT_MAX=Object.freeze({w:53,m:12});
  const PATTERN=/^([a-z][a-z-]*)\s*=\s*([a-z])\s*(\d{1,2})(?:\s*-\s*([a-z])?\s*(\d{1,2}))?$/;

  const pad2=value=>String(value).padStart(2,'0');
  const token=(field,unit,number)=>'~'+field+unit+pad2(number)+'~';

  function parse(text){
    const raw=String(text==null?'':text).trim().toLowerCase();
    if(!raw||raw.indexOf('=')<0)return null;
    const m=PATTERN.exec(raw);if(!m)return null;
    const field=FIELD_ALIASES[m[1].replace(/-/g,'')];
    const unit=UNIT_ALIASES[m[2]];
    if(!field||!unit)return null;
    if(m[4]&&UNIT_ALIASES[m[4]]!==unit)return null;
    const max=UNIT_MAX[unit],start=Number(m[3]),end=m[5]?Number(m[5]):start;
    if(start<1||start>max||end<1||end>max)return null;
    const numbers=[];
    // Sezon yıl sonunu aşabilir: W50-W4 / M11-M2 ileri sarar.
    for(let n=start,guard=0;guard<=max;guard++){
      numbers.push(n);
      if(n===end)break;
      n=n===max?1:n+1;
    }
    return {field,unit,numbers,tokens:numbers.map(n=>token(field,unit,n))};
  }

  function dateDimension(){return root&&root.BLDateDimension||null;}

  function periodOfDate(value){
    const dim=dateDimension();
    if(!dim||typeof dim.describe!=='function'||value==null||value==='')return null;
    const d=dim.describe(value);
    if(!d||!d.valid)return null;
    if(d.businessValid)return {week:d.lcwWeek,month:d.month};
    return {week:d.isoWeek,month:d.date?d.date.getMonth()+1:null};
  }

  function weekNumber(code){
    const m=/^(\d{4})[-/. ]?w?(\d{1,2})$/i.exec(String(code==null?'':code).trim());
    const n=m?Number(m[2]):NaN;
    return n>=1&&n<=UNIT_MAX.w?n:null;
  }
  function monthNumber(code){
    const m=/^\d{4}(\d{2})$/.exec(String(code==null?'':code).trim());
    const n=m?Number(m[1]):NaN;
    return n>=1&&n<=12?n:null;
  }

  /* fields: {mbWeekCode:'2027-07', mbMonthCode:'202707', mbDate, exFactory, retail} */
  function rowTokens(fields){
    const f=fields||{},out=[];
    const push=(field,unit,n)=>{if(n)out.push(token(field,unit,n));};
    const mbDate=periodOfDate(f.mbDate);
    push('mb','w',weekNumber(f.mbWeekCode)||(mbDate&&mbDate.week));
    push('mb','m',monthNumber(f.mbMonthCode)||(mbDate&&mbDate.month));
    [['exf',f.exFactory],['rt',f.retail]].forEach(([field,value])=>{
      const p=periodOfDate(value);
      if(p){push(field,'w',p.week);push(field,'m',p.month);}
    });
    return out.join(' ');
  }

  return {parse,rowTokens,token};
});
