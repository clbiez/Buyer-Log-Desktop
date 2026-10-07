/* Buyer Log shared date dimension.
 * LCW business periods come from the uploaded Merch Calendar when configured.
 * Gregorian dates and ISO/GLB week numbers remain available as technical dimensions.
 */
(function(root,factory){
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.BLDateDimension=api;
}(typeof globalThis!=='undefined'?globalThis:this,function(root){
  'use strict';
  const DAY_MS=86400000;
  const MONTHS_TR=['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'];
  const MONTHS_EN=['January','February','March','April','May','June','July','August','September','October','November','December'];
  const pad2=value=>String(value).padStart(2,'0');
  let merch={active:false,weeks:[],byDate:new Map(),byWeek:new Map(),meta:null};

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
  function addDays(value,count){
    const d=parseDate(value);if(!d)return null;
    d.setDate(d.getDate()+Number(count||0));return d;
  }
  function mondayOf(value){
    const d=parseDate(value);if(!d)return null;
    d.setDate(d.getDate()-((d.getDay()+6)%7));return d;
  }
  function sundayOf(value){
    const monday=mondayOf(value);if(!monday)return null;
    const sunday=new Date(monday);sunday.setDate(monday.getDate()+6);return sunday;
  }

  /* GLB = standard ISO-8601 week. This is deliberately separate from LCW. */
  function isoWeekYear(value){
    const d=parseDate(value);if(!d)return null;
    d.setDate(d.getDate()-((d.getDay()+6)%7)+3);return d.getFullYear();
  }
  function isoWeekNumber(value){
    const d=parseDate(value);if(!d)return null;
    d.setDate(d.getDate()-((d.getDay()+6)%7)+3);
    const firstThursday=new Date(d.getFullYear(),0,4);
    firstThursday.setDate(firstThursday.getDate()-((firstThursday.getDay()+6)%7)+3);
    return 1+Math.round((d-firstThursday)/(7*DAY_MS));
  }
  function mondayFromIsoWeek(year,week){
    year=Number(year);week=Number(week);
    if(!Number.isInteger(year)||!Number.isInteger(week)||week<1||week>53)return null;
    const jan4=new Date(year,0,4);jan4.setHours(0,0,0,0);
    const week1=mondayOf(jan4);if(!week1)return null;
    const monday=new Date(week1);monday.setDate(week1.getDate()+(week-1)*7);
    if(isoWeekYear(monday)!==year||isoWeekNumber(monday)!==week)return null;
    return monday;
  }

  function emptyMerch(){return {active:false,weeks:[],byDate:new Map(),byWeek:new Map(),meta:null};}
  function normalizeWeek(raw){
    const year=Number(raw && (raw.lcwYear ?? raw.year));
    const week=Number(raw && (raw.lcwWeek ?? raw.week));
    const month=Number(raw && (raw.lcwMonth ?? raw.month));
    const monthWeek=Number(raw && (raw.lcwMonthWeek ?? raw.monthWeek));
    const start=toISO(raw&&(raw.start||raw.weekStart));
    const end=toISO(raw&&(raw.end||raw.weekEnd))||toISO(addDays(start,6));
    if(!Number.isInteger(year)||year<1900||year>2200||!Number.isInteger(week)||week<1||week>52||
       !Number.isInteger(month)||month<1||month>12||!Number.isInteger(monthWeek)||monthWeek<1||monthWeek>6||
       !start||!end)return null;
    return {year,week,month,monthWeek,start,end};
  }
  function setMerchCalendar(payload){
    const input=payload&&payload.calendar?payload.calendar:payload;
    const weeks=Array.isArray(input&&input.weeks)?input.weeks.map(normalizeWeek).filter(Boolean):[];
    if(!weeks.length){merch=emptyMerch();return false;}
    weeks.sort((a,b)=>a.start.localeCompare(b.start)||a.year-b.year||a.week-b.week);
    const byDate=new Map(),byWeek=new Map();
    for(const item of weeks){
      const key=String(item.year)+'-W'+pad2(item.week);
      if(byWeek.has(key))continue;
      byWeek.set(key,item);
      const start=parseDate(item.start);
      for(let i=0;i<7;i++){
        const d=new Date(start);d.setDate(start.getDate()+i);
        byDate.set(toISO(d),item);
      }
    }
    merch={
      active:true,weeks:[...byWeek.values()],byDate,byWeek,
      meta:(input&&input.meta)||{
        sourceName:String(input&&input.sourceName||''),
        uploadedAt:String(input&&input.uploadedAt||''),
        minDate:weeks[0].start,maxDate:weeks[weeks.length-1].end,
      }
    };
    return true;
  }
  function clearMerchCalendar(){merch=emptyMerch();}
  function merchCalendarMeta(){
    return merch.active?{active:true,weeks:merch.weeks.length,...(merch.meta||{})}:{active:false,weeks:0};
  }
  function hasMerchCalendar(){return merch.active;}

  function legacyPeriod(date){
    const sunday=sundayOf(date),periodYear=sunday.getFullYear(),month=sunday.getMonth()+1;
    const week=isoWeekNumber(date),weekYear=isoWeekYear(date);
    return {periodYear,month,week,weekYear,monthWeek:null,source:'legacy'};
  }
  function merchPeriod(date){
    if(!merch.active)return legacyPeriod(date);
    const hit=merch.byDate.get(toISO(date));
    if(!hit)return null;
    return {periodYear:hit.year,month:hit.month,week:hit.week,weekYear:hit.year,monthWeek:hit.monthWeek,source:'lcw',weekStart:hit.start,weekEnd:hit.end};
  }

  function invalidDescription(){
    return {
      valid:false,businessValid:false,date:null,monday:null,sunday:null,dateKey:'',periodYear:null,month:null,monthKey:'',monthCode:'',
      monthNameTr:'',monthNameEn:'',monthLabelTr:'',monthLabelEn:'',isoWeekYear:null,isoWeek:null,globalWeekYear:null,globalWeek:null,
      globalWeekKey:'',lcwYear:null,lcwWeek:null,lcwMonth:null,lcwMonthWeek:null,lcwWeekKey:'',lcwMonthKey:'',weekKey:'',
      weekLabelTr:'',weekLabelEn:'',periodSource:'none'
    };
  }
  function describe(value){
    const date=parseDate(value);if(!date)return invalidDescription();
    const monday=mondayOf(date),sunday=sundayOf(date),dateKey=toISO(date);
    const glbYear=isoWeekYear(date),glbWeek=isoWeekNumber(date);
    const period=merchPeriod(date);
    if(!period){
      return {
        ...invalidDescription(),valid:true,businessValid:false,date,monday,sunday,dateKey,
        isoWeekYear:glbYear,isoWeek:glbWeek,globalWeekYear:glbYear,globalWeek:glbWeek,
        globalWeekKey:String(glbYear)+'-W'+pad2(glbWeek),periodSource:'unmapped'
      };
    }
    const periodYear=period.periodYear,month=period.month,week=period.week,weekYear=period.weekYear;
    const monthNameTr=MONTHS_TR[month-1],monthNameEn=MONTHS_EN[month-1];
    const monthLabelTr=monthNameTr+' '+periodYear,monthLabelEn=monthNameEn+' '+periodYear;
    const weekKey=String(weekYear)+'-W'+pad2(week),monthKey=String(periodYear)+'-'+pad2(month);
    return {
      valid:true,businessValid:true,date,monday,sunday,dateKey,periodYear,month,
      monthKey,monthCode:String(periodYear)+pad2(month),monthNameTr,monthNameEn,monthLabelTr,monthLabelEn,
      isoWeekYear:glbYear,isoWeek:glbWeek,globalWeekYear:glbYear,globalWeek:glbWeek,
      globalWeekKey:String(glbYear)+'-W'+pad2(glbWeek),
      lcwYear:weekYear,lcwWeek:week,lcwMonth:month,lcwMonthWeek:period.monthWeek,
      lcwWeekKey:weekKey,lcwMonthKey:monthKey,
      weekKey,weekLabelTr:String(week)+'. Hafta '+monthLabelTr,weekLabelEn:'Week '+String(week)+' '+monthLabelEn,
      weekStart:period.weekStart||toISO(monday),weekEnd:period.weekEnd||toISO(sunday),periodSource:period.source
    };
  }

  function mondayFromBusinessWeek(year,week){
    year=Number(year);week=Number(week);
    if(merch.active){
      const hit=merch.byWeek.get(String(year)+'-W'+pad2(week));
      return hit?parseDate(hit.start):null;
    }
    return mondayFromIsoWeek(year,week);
  }
  function bucketKey(value,granularity){
    const d=describe(value);if(!d.valid)return '';
    if(granularity==='year')return d.businessValid?String(d.periodYear):'';
    if(granularity==='month')return d.monthKey||'';
    if(granularity==='week')return d.weekKey||'';
    return d.dateKey;
  }
  function describeBucket(key,granularity){
    const raw=String(key==null?'':key).trim();if(!raw)return null;
    if(granularity==='year'){
      const year=Number(raw);return Number.isInteger(year)?{year}:null;
    }
    if(granularity==='month'){
      const m=/^(\d{4})-(\d{2})$/.exec(raw);if(!m)return null;
      const year=Number(m[1]),month=Number(m[2]);if(month<1||month>12)return null;
      return {year,month,monthKey:raw,monthNameTr:MONTHS_TR[month-1],monthNameEn:MONTHS_EN[month-1]};
    }
    if(granularity==='week'){
      let m=/^(\d{4})-W(\d{2})$/i.exec(raw);
      if(!m){
        const legacy=/^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
        if(legacy){const p=describe(dateParts(legacy[1],legacy[2],legacy[3]));return p.valid?p:null;}
        return null;
      }
      const monday=mondayFromBusinessWeek(Number(m[1]),Number(m[2]));return monday?describe(monday):null;
    }
    const p=describe(raw);return p.valid?p:null;
  }
  function bucketLabel(key,granularity,language){
    const lang=String(language||'tr').toLowerCase().startsWith('en')?'en':'tr';
    if(key==null||key==='')return lang==='en'?'(blank)':'(boş)';
    if(granularity==='year')return String(key);
    const d=describeBucket(key,granularity);if(!d)return String(key);
    if(granularity==='month')return (lang==='en'?d.monthNameEn:d.monthNameTr)+' '+d.year;
    if(granularity==='week')return lang==='en'?d.weekLabelEn:d.weekLabelTr;
    const parsed=d.date||parseDate(key);if(!parsed)return String(key);
    return pad2(parsed.getDate())+'.'+pad2(parsed.getMonth()+1)+'.'+String(parsed.getFullYear()).slice(-2);
  }
  function monthLabel(value,language){
    const d=describe(value);if(!d.valid||!d.businessValid)return '';
    return String(language||'tr').toLowerCase().startsWith('en')?d.monthLabelEn:d.monthLabelTr;
  }
  function weekLabel(value,language){
    const d=describe(value);if(!d.valid||!d.businessValid)return '';
    return String(language||'tr').toLowerCase().startsWith('en')?d.weekLabelEn:d.weekLabelTr;
  }

  /* Node/server path: make the persisted calendar immediately available to
     server-side parsers without coupling those parsers to the HTTP layer. */
  try{
    if(typeof module==='object'&&module.exports&&typeof process!=='undefined'&&process.env&&process.env.BL_DATA_DIR){
      const fs=require('fs'),path=require('path'),file=path.join(process.env.BL_DATA_DIR,'merch-calendar.json');
      if(fs.existsSync(file))setMerchCalendar(JSON.parse(fs.readFileSync(file,'utf8')));
    }
  }catch(_){/* A corrupt optional calendar must not stop Buyer Log boot. The route reports it. */}

  return {
    MONTHS_TR,MONTHS_EN,parseDate,toISO,mondayOf,sundayOf,isoWeekYear,isoWeekNumber,mondayFromIsoWeek,mondayFromBusinessWeek,
    setMerchCalendar,clearMerchCalendar,hasMerchCalendar,merchCalendarMeta,
    describe,bucketKey,bucketLabel,monthLabel,weekLabel
  };
}));
