/* Buyer Log shared date dimension.
 * One source of truth for Collection-style week/month assignment:
 * a week belongs to the month containing its Sunday.
 */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.BLDateDimension=api;
}(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const MONTHS_TR=['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'];
  const MONTHS_EN=['January','February','March','April','May','June','July','August','September','October','November','December'];
  const pad2=value=>String(value).padStart(2,'0');
  function dateParts(year,month,day){
    const d=new Date(Number(year),Number(month)-1,Number(day));
    if(!Number.isFinite(d.getTime())||d.getFullYear()!==Number(year)||d.getMonth()!==Number(month)-1||d.getDate()!==Number(day))return null;
    d.setHours(0,0,0,0);return d;
  }
  function parseDate(value){
    if(value instanceof Date)return Number.isNaN(value.getTime())?null:new Date(value.getFullYear(),value.getMonth(),value.getDate());
    if(value==null||value==='')return null;
    if(typeof value==='number'&&Number.isFinite(value)){
      const text=String(Math.trunc(value));
      if(/^\d{8}$/.test(text))return dateParts(text.slice(0,4),text.slice(4,6),text.slice(6,8));
      return null;
    }
    const text=String(value).trim();
    if(!text)return null;
    let m=/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:$|[T\s])/.exec(text);
    if(m)return dateParts(m[1],m[2],m[3]);
    m=/^(\d{4})(\d{2})(\d{2})$/.exec(text);
    if(m)return dateParts(m[1],m[2],m[3]);
    m=/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(text);
    if(m)return dateParts(m[3],m[2],m[1]);
    return null;
  }
  function toISO(value){
    const d=parseDate(value);return d?d.getFullYear()+'-'+pad2(d.getMonth()+1)+'-'+pad2(d.getDate()):'';
  }
  function mondayOf(value){
    const d=parseDate(value);if(!d)return null;
    d.setDate(d.getDate()-((d.getDay()+6)%7));return d;
  }
  function sundayOf(value){
    const monday=mondayOf(value);if(!monday)return null;
    const sunday=new Date(monday);sunday.setDate(monday.getDate()+6);return sunday;
  }
  function isoWeekYear(value){
    const d=parseDate(value);if(!d)return null;
    d.setDate(d.getDate()-((d.getDay()+6)%7)+3);return d.getFullYear();
  }
  function isoWeekNumber(value){
    const d=parseDate(value);if(!d)return null;
    d.setDate(d.getDate()-((d.getDay()+6)%7)+3);
    const firstThursday=new Date(d.getFullYear(),0,4);
    firstThursday.setDate(firstThursday.getDate()-((firstThursday.getDay()+6)%7)+3);
    return 1+Math.round((d-firstThursday)/(7*86400000));
  }
  function mondayFromIsoWeek(year,week){
    year=Number(year);week=Number(week);
    if(!Number.isInteger(year)||!Number.isInteger(week)||week<1||week>53)return null;
    const jan4=new Date(year,0,4);
    jan4.setHours(0,0,0,0);
    const week1=mondayOf(jan4);if(!week1)return null;
    const monday=new Date(week1);monday.setDate(week1.getDate()+(week-1)*7);
    if(isoWeekYear(monday)!==year||isoWeekNumber(monday)!==week)return null;
    return monday;
  }
  function describe(value){
    const date=parseDate(value);
    if(!date)return {
      valid:false,date:null,monday:null,sunday:null,dateKey:'',periodYear:null,month:null,monthKey:'',monthCode:'',
      monthNameTr:'',monthNameEn:'',monthLabelTr:'',monthLabelEn:'',isoWeekYear:null,isoWeek:null,weekKey:'',weekLabelTr:'',weekLabelEn:''
    };
    const monday=mondayOf(date),sunday=sundayOf(date);
    const periodYear=sunday.getFullYear(),month=sunday.getMonth()+1;
    const isoYear=isoWeekYear(date),week=isoWeekNumber(date);
    const monthNameTr=MONTHS_TR[month-1],monthNameEn=MONTHS_EN[month-1];
    const monthLabelTr=monthNameTr+' '+periodYear,monthLabelEn=monthNameEn+' '+periodYear;
    return {
      valid:true,date,monday,sunday,dateKey:toISO(date),periodYear,month,
      monthKey:periodYear+'-'+pad2(month),monthCode:String(periodYear)+pad2(month),
      monthNameTr,monthNameEn,monthLabelTr,monthLabelEn,
      isoWeekYear:isoYear,isoWeek:week,weekKey:String(isoYear)+'-W'+pad2(week),
      weekLabelTr:String(week)+'. Hafta '+monthLabelTr,
      weekLabelEn:'Week '+String(week)+' '+monthLabelEn
    };
  }
  function bucketKey(value,granularity){
    const d=describe(value);if(!d.valid)return '';
    if(granularity==='year')return String(d.periodYear);
    if(granularity==='month')return d.monthKey;
    if(granularity==='week')return d.weekKey;
    return d.dateKey;
  }
  function describeBucket(key,granularity){
    const raw=String(key==null?'':key).trim();if(!raw)return null;
    if(granularity==='year'){
      const year=Number(raw);return Number.isInteger(year)?{year}:null;
    }
    if(granularity==='month'){
      const m=/^(\d{4})-(\d{2})$/.exec(raw);if(!m)return null;
      const year=Number(m[1]),month=Number(m[2]);
      if(month<1||month>12)return null;
      return {year,month,monthKey:raw,monthNameTr:MONTHS_TR[month-1],monthNameEn:MONTHS_EN[month-1]};
    }
    if(granularity==='week'){
      let m=/^(\d{4})-W(\d{2})$/i.exec(raw);
      if(!m){
        const legacy=/^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
        if(legacy){
          const p=describe(dateParts(legacy[1],legacy[2],legacy[3]));
          return p.valid?p:null;
        }
        return null;
      }
      const monday=mondayFromIsoWeek(Number(m[1]),Number(m[2]));return monday?describe(monday):null;
    }
    const p=describe(raw);return p.valid?p:null;
  }
  function bucketLabel(key,granularity,language){
    const lang=String(language||'tr').toLowerCase().startsWith('en')?'en':'tr';
    if(key==null||key==='')return lang==='en'?'(blank)':'(boş)';
    if(granularity==='year')return String(key);
    const d=describeBucket(key,granularity);
    if(!d)return String(key);
    if(granularity==='month')return (lang==='en'?d.monthNameEn:d.monthNameTr)+' '+d.year;
    if(granularity==='week')return lang==='en'?d.weekLabelEn:d.weekLabelTr;
    const parsed=d.date||parseDate(key);
    if(!parsed)return String(key);
    return pad2(parsed.getDate())+'.'+pad2(parsed.getMonth()+1)+'.'+String(parsed.getFullYear()).slice(-2);
  }
  function monthLabel(value,language){
    const d=describe(value);if(!d.valid)return '';
    return String(language||'tr').toLowerCase().startsWith('en')?d.monthLabelEn:d.monthLabelTr;
  }
  function weekLabel(value,language){
    const d=describe(value);if(!d.valid)return '';
    return String(language||'tr').toLowerCase().startsWith('en')?d.weekLabelEn:d.weekLabelTr;
  }
  return {
    MONTHS_TR,MONTHS_EN,parseDate,toISO,mondayOf,sundayOf,isoWeekYear,isoWeekNumber,mondayFromIsoWeek,
    describe,bucketKey,bucketLabel,monthLabel,weekLabel
  };
}));
