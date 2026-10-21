(function(root, factory){
  if(typeof module==='object' && module.exports) module.exports=factory(require('./model-option-stats.js'));
  else root.BLOverviewCollectionSummary=factory(root.BLModelOptionStats);
})(typeof window!=='undefined'?window:globalThis, function(modelOptionStats){
  'use strict';

  const DEFAULT_FIELDS=Object.freeze({
    month:'inStoreMonth',
    status:'durum',
    model:'modelKod',
  });
  const text=value=>String(value==null?'':value).trim();
  const fieldValue=(row,key,fields)=>{
    const actual=fields[key]||key;
    return text(row&&row[actual]);
  };
  const uniqueSorted=values=>[...new Set((values||[]).map(text).filter(Boolean))]
    .sort((a,b)=>a.localeCompare(b,'tr-TR',{numeric:true,sensitivity:'base'}));
  // Collection stores legacy numeric and localized names (e.g. 2027-06,
  // JUNE 2027, HAZİRAN 2027). Parse the complete value, never an arbitrary
  // numeric substring, so unrelated/invalid values cannot become fake dates.
  const MONTH_ALIASES=[
    ['ocak','oca','january','jan'],
    ['subat','sub','february','feb'],
    ['mart','mar','march'],
    ['nisan','nis','april','apr'],
    ['mayis','may','mayis','mayis','may'],
    ['haziran','haz','june','jun'],
    ['temmuz','tem','july','jul'],
    ['agustos','agu','august','aug'],
    ['eylul','eyl','september','sept','sep'],
    ['ekim','eki','october','oct'],
    ['kasim','kas','november','nov'],
    ['aralik','ara','december','dec'],
  ];
  const monthNumber=name=>{
    const token=text(name).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/ı/g,'i').toLowerCase().replace(/\.$/,'');
    const index=MONTH_ALIASES.findIndex(aliases=>aliases.includes(token));
    return index<0?null:index+1;
  };
  const monthParts=value=>{
    const raw=text(value).replace(/\s+/g,' ');
    const valid=(year,month)=>{
      const y=Number(year),m=Number(month);
      return Number.isInteger(y)&&y>=1900&&y<=9999&&Number.isInteger(m)&&m>=1&&m<=12?{year:y,month:m}:null;
    };
    let match=raw.match(/^(\d{4})[-./\s]?(\d{1,2})(?:[-./\s]\d{1,2})?$/);
    if(match)return valid(match[1],match[2]);
    match=raw.match(/^(\d{1,2})[-./\s](\d{4})$/);
    if(match)return valid(match[2],match[1]);
    match=raw.match(/^([^\d]+?)[\s,./-]+(\d{4})$/);
    if(match)return valid(match[2],monthNumber(match[1]));
    match=raw.match(/^(\d{4})[\s,./-]+([^\d]+)$/);
    return match?valid(match[1],monthNumber(match[2])):null;
  };
  const monthDistance=(value,now)=>{
    const parts=monthParts(value);
    if(!parts)return Number.POSITIVE_INFINITY;
    const date=now instanceof Date?now:new Date();
    return Math.abs((parts.year*12+parts.month)-(date.getFullYear()*12+(date.getMonth()+1)));
  };
  const isConfirmed=(row,callback)=>typeof callback==='function'?Boolean(callback(row)):Boolean(row&&row.buyingSampleApproved);
  const pivotFields=(value,fallback)=>{
    const values=Array.isArray(value)?value:[value==null?'':value];
    const normalized=values.map(text).filter(value=>value&&value!=='none');
    return [...new Set(normalized)].length?[...new Set(normalized)]:[fallback];
  };
  const pivotValue=(row,key,fields,valueFor,confirmed)=>{
    if(key==='confirmation')return confirmed?'Confirmed':'Not Confirmed';
    const actual=fields[key]||key;
    return text(valueFor(row,actual))||'—';
  };
  const pathKey=path=>JSON.stringify(path);
  const comparePath=(a,b)=>a.join(' / ').localeCompare(b.join(' / '),'tr-TR',{numeric:true,sensitivity:'base'});
  const modelKeyFor=(row,index,fields)=>typeof modelOptionStats?.modelKey==='function'
    ?modelOptionStats.modelKey(row,index)
    :fieldValue(row,'model',fields);
  const metricValues=models=>{
    let confirmed=0;
    let optionCount=0;
    models.forEach(value=>{if(value.confirmed)confirmed++;optionCount+=Number(value.optionCount)||0;});
    return {modelCount:models.size,optionCount,confirmed,notConfirmed:models.size-confirmed};
  };
  function availableOptions(rows, options={}){
    const fields={...DEFAULT_FIELDS,...(options.fields||{})};
    const allRows=Array.isArray(rows)?rows:[];
    return {
      months:uniqueSorted(allRows.map(row=>fieldValue(row,'month',fields))),
      statuses:uniqueSorted(allRows.map(row=>fieldValue(row,'status',fields))),
    };
  }

  function availableColumns(rows, options={}){
    const allRows=Array.isArray(rows)?rows:[];
    const valueFor=typeof options.valueFor==='function'?options.valueFor:(row,key)=>row&&row[key];
    const seen=new Set();
    return (Array.isArray(options.columns)?options.columns:[]).map(column=>({
      key:text(column&&column.k||column&&column.key),
      label:text(column&&column.label)||text(column&&column.k||column&&column.key),
    })).filter(column=>column.key&&!seen.has(column.key)&&seen.add(column.key)).map(column=>({
      ...column,
      values:uniqueSorted(allRows.map(row=>text(valueFor(row,column.key))).filter(Boolean)),
    }));
  }

  function defaultFilters(rows, options={}){
    const fields={...DEFAULT_FIELDS,...(options.fields||{})};
    const allRows=Array.isArray(rows)?rows:[];
    const available=availableOptions(allRows,{fields});
    const months=available.months,statuses=available.statuses;
    const saved=options.saved&&typeof options.saved==='object'?options.saved:{};
    const savedMonths=(Array.isArray(saved.months)?saved.months:Array.isArray(saved.inStore)?saved.inStore:[])
      .map(text).filter(value=>months.includes(value));
    const selectedMonths=savedMonths.length?uniqueSorted(savedMonths):(
      months.length?[months.slice().sort((a,b)=>monthDistance(a,options.now)-monthDistance(b,options.now)||a.localeCompare(b,'tr-TR',{numeric:true}))[0]]:[]
    );
    const savedStatuses=(Array.isArray(saved.statuses)?saved.statuses:Array.isArray(saved.status)?saved.status:[])
      .map(text).filter(value=>statuses.includes(value));
    const monthRows=allRows.filter(row=>!selectedMonths.length||selectedMonths.includes(fieldValue(row,'month',fields)));
    const statusCounts=new Map();
    monthRows.forEach(row=>{
      const status=fieldValue(row,'status',fields);if(status)statusCounts.set(status,(statusCounts.get(status)||0)+1);
    });
    const selectedStatuses=savedStatuses.length?uniqueSorted(savedStatuses):(
      statuses.length?[(statusCounts.size? [...statusCounts.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],'tr-TR')):[statuses[0]])[0][0]]:[]
    );
    return {months:selectedMonths,statuses:selectedStatuses,confirmation:text(saved.confirmation)||'all'};
  }

  function filterRows(rows, options={}){
    const fields={...DEFAULT_FIELDS,...(options.fields||{})};
    const months=Array.isArray(options.months)?new Set(options.months.map(text).filter(Boolean)):null;
    const statuses=Array.isArray(options.statuses)?new Set(options.statuses.map(text).filter(Boolean)):null;
    const confirmation=text(options.confirmation||'all').toLowerCase();
    const columnFilters=options.columnFilters&&typeof options.columnFilters==='object'?options.columnFilters:{};
    const valueFor=typeof options.columnValue==='function'?options.columnValue:(row,key)=>row&&row[key];
    return (Array.isArray(rows)?rows:[]).filter((row,index)=>{
      const month=fieldValue(row,'month',fields),status=fieldValue(row,'status',fields);
      if(months&&months.size&&!months.has(month))return false;
      if(statuses&&statuses.size&&!statuses.has(status))return false;
      const confirmed=isConfirmed(row,options.isConfirmed);
      if(confirmation==='confirmed'&&!confirmed)return false;
      if((confirmation==='notconfirmed'||confirmation==='not-confirmed'||confirmation==='not_confirmed')&&confirmed)return false;
      const passesColumns=Object.entries(columnFilters).every(([key,values])=>{
        const selected=new Set(Array.isArray(values)?values.map(text).filter(Boolean):[]);
        return !selected.size||selected.has(text(valueFor(row,key)));
      });
      if(!passesColumns)return false;
      return Boolean(modelKeyFor(row,index,fields));
    });
  }

  function build(rows, options={}){
    const fields={...DEFAULT_FIELDS,...(options.fields||{})};
    const valueFor=typeof options.columnValue==='function'?options.columnValue:(row,key)=>row&&row[key];
    const filtered=filterRows(rows,options);
    const modelMap=new Map();
    const statusMap=new Map();
    const statusOptionCounts=new Map();
    const rawPivot=options.pivot&&typeof options.pivot==='object'?options.pivot:null;
    const legacyPivot=!Array.isArray(rawPivot&&rawPivot.rows)&&!Array.isArray(rawPivot&&rawPivot.columns);
    const rowFields=pivotFields(rawPivot&&rawPivot.rows,fields.status);
    const columnFields=Array.isArray(rawPivot&&rawPivot.columns)
      ?pivotFields(rawPivot.columns,'').filter(Boolean)
      :(rawPivot&&rawPivot.columns&&text(rawPivot.columns)!=='none'?[text(rawPivot.columns)]:[]);
    const pivotRowKey=text(rawPivot&&rawPivot.rows)||fields.status;
    const pivotMap=new Map();
    const pivotGroups=new Map();
    const pivotColumnPaths=new Map();
    filtered.forEach((row,index)=>{
      const model=modelKeyFor(row,index,fields),status=fieldValue(row,'status',fields)||'—',confirmed=isConfirmed(row,options.isConfirmed);
      const modelEntry=modelMap.get(model)||{confirmed:false,optionCount:0};modelEntry.confirmed=modelEntry.confirmed||confirmed;modelEntry.optionCount++;modelMap.set(model,modelEntry);
      const statusEntry=statusMap.get(status)||new Map();
      const statusModel=statusEntry.get(model)||{confirmed:false,optionCount:0};
      statusModel.confirmed=statusModel.confirmed||confirmed;statusModel.optionCount++;
      statusEntry.set(model,statusModel);statusMap.set(status,statusEntry);
      statusOptionCounts.set(status,(statusOptionCounts.get(status)||0)+1);
      if(legacyPivot){
        const pivotValue=pivotRowKey==='confirmation'?(confirmed?'Confirmed':'Not Confirmed'):fieldValue(row,pivotRowKey,fields)||'—';
        const pivotEntry=pivotMap.get(pivotValue)||new Map(),pivotModel=pivotEntry.get(model)||{confirmed:false,optionCount:0};
        pivotModel.confirmed=pivotModel.confirmed||confirmed;pivotModel.optionCount++;pivotEntry.set(model,pivotModel);pivotMap.set(pivotValue,pivotEntry);
      }else{
        const rowPath=rowFields.map(key=>pivotValue(row,key,fields,valueFor,confirmed));
        const columnPath=columnFields.map(key=>pivotValue(row,key,fields,valueFor,confirmed));
        const rowKey=pathKey(rowPath),columnKey=pathKey(columnPath);
        const rowEntry=pivotGroups.get(rowKey)||{rowPath,cells:new Map()};
        const cell=rowEntry.cells.get(columnKey)||new Map(),pivotModel=cell.get(model)||{confirmed:false,optionCount:0};
        pivotModel.confirmed=pivotModel.confirmed||confirmed;pivotModel.optionCount++;cell.set(model,pivotModel);
        rowEntry.cells.set(columnKey,cell);pivotGroups.set(rowKey,rowEntry);
        if(!pivotColumnPaths.has(columnKey))pivotColumnPaths.set(columnKey,columnPath);
      }
    });
    const resultRows=[...statusMap.entries()].map(([status,models])=>{
      let confirmed=0;models.forEach(value=>{if(value.confirmed)confirmed++;});
      return {status,modelCount:models.size,optionCount:statusOptionCounts.get(status)||0,confirmed,notConfirmed:models.size-confirmed};
    }).sort((a,b)=>a.status.localeCompare(b.status,'tr-TR',{numeric:true,sensitivity:'base'}));
    let confirmed=0;modelMap.forEach(value=>{if(value.confirmed)confirmed++;});
    const legacyPivotRows=[...pivotMap.entries()].map(([row,models])=>{
      let pivotConfirmed=0,pivotOptions=0;models.forEach(value=>{if(value.confirmed)pivotConfirmed++;pivotOptions+=Number(value.optionCount)||0;});
      return {row,modelCount:models.size,optionCount:pivotOptions,confirmed:pivotConfirmed,notConfirmed:models.size-pivotConfirmed};
    }).sort((a,b)=>a.row.localeCompare(b.row,'tr-TR',{numeric:true,sensitivity:'base'}));
    if(legacyPivot)return {rows:resultRows,pivotRows:legacyPivotRows,kpi:{total:modelMap.size,optionCount:filtered.length,confirmed,notConfirmed:modelMap.size-confirmed}};
    const pivotColumns=[...pivotColumnPaths.entries()].sort(([,a],[,b])=>comparePath(a,b)).map(([key,path])=>({key,path,label:path.join(' / ')}));
    if(!columnFields.length&&!pivotColumns.length)pivotColumns.push({key:pathKey([]),path:[],label:''});
    const pivotRows=[...pivotGroups.values()].sort((a,b)=>comparePath(a.rowPath,b.rowPath)).map(entry=>{
      const cells={};
      pivotColumns.forEach(column=>cells[column.key]=metricValues(entry.cells.get(column.key)||new Map()));
      return {row:entry.rowPath.join(' / '),rowPath:entry.rowPath,cells};
    });
    return {rows:resultRows,pivotRows,pivotColumns,kpi:{total:modelMap.size,optionCount:filtered.length,confirmed,notConfirmed:modelMap.size-confirmed}};
  }

  /* Genel Bakış revolver satırları: kapsam filtresinden geçen satırlar ay
     (fields.month) bazında gruplanır. Adet ve görsel modülün kanonik
     okuyucularından (quantityFor/imageFor) gelir; burada başlık eşlenmez. */
  function monthBuckets(rows, options={}){
    const fields={...DEFAULT_FIELDS,...(options.fields||{})};
    const quantityFor=typeof options.quantityFor==='function'?options.quantityFor:()=>0;
    const imageFor=typeof options.imageFor==='function'?options.imageFor:()=>'';
    const groups=new Map();
    filterRows(rows,options).forEach((row,index)=>{
      const month=fieldValue(row,'month',fields),model=modelKeyFor(row,index,fields),status=fieldValue(row,'status',fields)||'—';
      const group=groups.get(month)||{month,quantity:0,optionCount:0,models:new Map(),statuses:new Map()};
      const quantity=Number(quantityFor(row));
      if(Number.isFinite(quantity)&&quantity>0)group.quantity+=quantity;
      group.optionCount++;
      const entry=group.models.get(model)||{key:model,label:fieldValue(row,'model',fields)||model,image:''};
      if(!entry.image)entry.image=text(imageFor(row));
      group.models.set(model,entry);
      const statusEntry=group.statuses.get(status)||{status,optionCount:0,quantity:0,models:new Set()};
      statusEntry.optionCount++;if(Number.isFinite(quantity)&&quantity>0)statusEntry.quantity+=quantity;statusEntry.models.add(model);group.statuses.set(status,statusEntry);
      groups.set(month,group);
    });
    const order=group=>{const parts=monthParts(group.month);return parts?parts.year*12+parts.month:null;};
    const descending=options.sort==='desc';
    return [...groups.values()].sort((a,b)=>{
      const aMonth=order(a),bMonth=order(b);
      if(aMonth==null)return bMonth==null?a.month.localeCompare(b.month,'tr-TR',{numeric:true}):1;
      if(bMonth==null)return -1;
      return (descending?bMonth-aMonth:aMonth-bMonth)||a.month.localeCompare(b.month,'tr-TR',{numeric:true});
    }).map(group=>{
      const parts=monthParts(group.month);
      const models=[...group.models.values()];
      return {
        month:group.month,
        year:parts?parts.year:null,
        monthNumber:parts?parts.month:null,
        quantity:group.quantity,
        optionCount:group.optionCount,
        modelCount:models.length,
        models:models.filter(model=>model.image).concat(models.filter(model=>!model.image)),
        statuses:[...group.statuses.values()].map(entry=>({status:entry.status,optionCount:entry.optionCount,modelCount:entry.models.size,quantity:entry.quantity}))
          .sort((a,b)=>a.status.localeCompare(b.status,'tr-TR',{numeric:true,sensitivity:'base'})),
      };
    });
  }

  return {build,monthBuckets,monthParts,defaultFilters,availableOptions,availableColumns,fields:DEFAULT_FIELDS};
});
