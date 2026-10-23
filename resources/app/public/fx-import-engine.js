/* Shared FX import: layout detection and cell extraction are identical in Node and the browser. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.BLFxImportEngine=factory();})(typeof window!=='undefined'?window:globalThis,function(){
'use strict';
const MONTH_JUMP_THRESHOLD=.25,CURRENT_DIFFERENCE_THRESHOLD=.15;
const EXPECTED_CURRENCIES=Object.freeze(['EUR','GBP','CHF','CNY','TRY']);
const DIRECTIONS=Object.freeze(['per_usd','usd_per_unit']),SCALES=Object.freeze([1,100,1000]);
const HEADER_SEARCH_ROWS=21,MIN_CURRENCIES=3,MAX_GRID_CELLS=2000000;
const FX_LAYOUT_GUIDE=Object.freeze({base:'USD',storedDirection:'per_usd',monthFormat:'YYYY-MM',codeColumn:'B',firstMonthColumn:'C',headerSearchRows:HEADER_SEARCH_ROWS,directions:DIRECTIONS,scales:SCALES});
const validMonth=value=>/^\d{4}-(0[1-9]|1[0-2])$/.test(String(value||''));
function numberValue(value){
 if(typeof value==='number')return Number.isFinite(value)?value:null;
 const text=String(value==null?'':value).trim().replace(/\s+/g,'');if(!text)return null;
 let normalized=text;
 if(text.includes(',')&&text.includes('.'))normalized=text.lastIndexOf(',')>text.lastIndexOf('.')?text.replace(/\./g,'').replace(',','.'):text.replace(/,/g,'');
 else if(text.includes(','))normalized=text.replace(',','.');
 const n=Number(normalized);return Number.isFinite(n)?n:null;
}
function monthFromValue(value){
 if(typeof value==='number'){
  if(value<=25000||value>=80000)return null;
  // Compatibility for unformatted Excel serial headers. Actual date cells arrive as ISO text.
  value=new Date(Date.UTC(1899,11,30)+Math.floor(value)*86400000).toISOString().slice(0,10);
 }
 const text=String(value==null?'':value).trim();let m=text.match(/^(\d{4})[-/.](\d{1,2})(?:[-/.]\d{1,2})?$/);
 let year,month;
 if(m){year=+m[1];month=+m[2];}else{
  m=text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/);
  if(m){year=+m[3];if(year<100)year+=year>=70?1900:2000;month=+m[2];}
  else{m=text.match(/^(\d{1,2})[-/.](\d{4})$/);if(m){year=+m[2];month=+m[1];}
   else{const date=new Date(text);if(!text||!Number.isFinite(date.getTime()))return null;year=date.getUTCFullYear();month=date.getUTCMonth()+1;}}
 }
 const key=String(year).padStart(4,'0')+'-'+String(month).padStart(2,'0');return validMonth(key)?key:null;
}
function columnName(index){let out='';for(let n=index+1;n>0;n=Math.floor((n-1)/26))out=String.fromCharCode(65+(n-1)%26)+out;return out;}
function columnIndex(name){if(!/^[A-Z]{1,3}$/.test(String(name||'')))return -1;let n=0;for(const c of name)n=n*26+c.charCodeAt(0)-64;return n<=16384?n-1:-1;}
function detectLayout(grid){
 if(!grid||!Array.isArray(grid.rows))return null;
 const start=Number(grid.startRow)||0,startCol=Number(grid.startColumn)||0;
 for(let r=start;r<Math.min(grid.rows.length,start+HEADER_SEARCH_ROWS);r++){
  const row=grid.rows[r]||[],seen=new Set(),monthColumns=[];
  for(let c=Math.max(startCol+2,2);c<row.length;c++){const month=monthFromValue(row[c]);if(month&&!seen.has(month)){monthColumns.push({col:columnName(c),month});seen.add(month);}}
  if(!monthColumns.length)continue;
  const layout={sheetName:grid.sheetName,headerRow:r+1,monthColumns,codeColumn:'B',firstDataRow:r+2,lastDataRow:grid.rows.length,direction:'per_usd',scale:1,confidence:1,warnings:[],legacyCodeFallback:true};
  // A dated heading without a currency row is not a usable deterministic table.
  if(grid.rows.slice(r+1).some(row=>[1,0,2].some(c=>/^[A-Z]{3,4}$/.test(String((row||[])[c]||'').trim().toUpperCase()))))return layout;
 }
 return null;
}
function normalizeLayout(input){
 if(!input||typeof input!=='object')throw new Error('Invalid FX layout');
 let columns=input.monthColumns;if(typeof columns==='string'){try{columns=JSON.parse(columns);}catch(_){throw new Error('Invalid FX layout monthColumns');}}
 const layout={sheetName:input.sheetName,headerRow:Number(input.headerRow),monthColumns:columns,codeColumn:input.codeColumn,firstDataRow:Number(input.firstDataRow),lastDataRow:Number(input.lastDataRow),direction:input.direction,scale:Number(input.scale),confidence:Number(input.confidence),warnings:input.warnings};
 if(typeof layout.sheetName!=='string'||!layout.sheetName||layout.sheetName.length>200||
  ![layout.headerRow,layout.firstDataRow,layout.lastDataRow].every(n=>Number.isInteger(n)&&n>=1&&n<=1048576)||
  layout.firstDataRow<=layout.headerRow||layout.lastDataRow<layout.firstDataRow||columnIndex(layout.codeColumn)<0||
  !Array.isArray(columns)||!columns.length||columns.length>240||columns.some(c=>!c||columnIndex(c.col)<0||!validMonth(c.month))||
  !DIRECTIONS.includes(layout.direction)||!SCALES.includes(layout.scale)||!Number.isFinite(layout.confidence)||layout.confidence<0||layout.confidence>1||
  !Array.isArray(layout.warnings)||layout.warnings.length>30||layout.warnings.some(w=>typeof w!=='string'||w.length>500))throw new Error('Invalid FX layout');
 layout.monthColumns=columns.map(c=>({col:c.col,month:c.month}));return layout;
}
function extractWithLayout(grid,input){
 const layout=normalizeLayout(input);
 if(!grid||layout.sheetName!==grid.sheetName||layout.lastDataRow>grid.rows.length||layout.lastDataRow*layout.monthColumns.length>MAX_GRID_CELLS)throw new Error('Invalid FX layout range');
 const maxColumns=grid.rows.reduce((n,row)=>Math.max(n,(row||[]).length),0);
 if(columnIndex(layout.codeColumn)>=maxColumns||layout.monthColumns.some(c=>columnIndex(c.col)>=maxColumns))throw new Error('Invalid FX layout columns');
 const months={},currencies=new Set(),conflicts=[],invalidCells=[];let valueCount=0;
 const codes=input.legacyCodeFallback?[1,0,2]:[columnIndex(layout.codeColumn)];
 for(let r=layout.firstDataRow-1;r<layout.lastDataRow;r++){
  const row=grid.rows[r]||[];let code='';
  for(const c of codes){const candidate=String(row[c]==null?'':row[c]).trim().toUpperCase();if(input.legacyCodeFallback?!/^[A-Z]{3,4}$/.test(candidate):!candidate)continue;code=candidate;break;}
  if(!code)continue;
  for(const column of layout.monthColumns){
   const raw=row[columnIndex(column.col)];if(raw==null||String(raw).trim()==='')continue;
   const n=numberValue(raw),value=n==null?NaN:layout.direction==='usd_per_unit'?layout.scale/n:n/layout.scale;
   const cell={sheetName:grid.sheetName,address:column.col+(r+1),code,month:column.month};
   if(!Number.isFinite(value)||value<=0){invalidCells.push({...cell,code:'invalid-value',currency:code});continue;}
   if(!months[column.month])months[column.month]={};
   if(Object.hasOwn(months[column.month],code)&&months[column.month][code]!==value)conflicts.push(cell);
   months[column.month][code]=value;currencies.add(code);valueCount++;
  }
 }
 const keys=Object.keys(months).sort();
 return {months,currencies:[...currencies].sort(),reportMonth:layout.monthColumns.map(c=>c.month).sort()[0]||null,conflicts,invalidCells,layout,
  stats:{sheetCount:1,latestSheet:grid.sheetName,currencyCount:currencies.size,monthCount:keys.length,valueCount,firstMonth:keys[0]||null,lastMonth:keys[keys.length-1]||null}};
}
function combineParsed(parts){
 const months={},conflicts=[],invalidCells=[];let valueCount=0;
 for(const parsed of parts){conflicts.push(...parsed.conflicts||[]);invalidCells.push(...parsed.invalidCells||[]);valueCount+=parsed.stats?.valueCount||0;
  for(const [month,rates] of Object.entries(parsed.months||{})){if(!months[month])months[month]={};for(const [code,value] of Object.entries(rates)){if(Object.hasOwn(months[month],code)&&months[month][code]!==value)conflicts.push({month,code});months[month][code]=value;}}
 }
 const keys=Object.keys(months).sort(),currencies=[...new Set(Object.values(months).flatMap(Object.keys))].sort();
 return {months,currencies,reportMonth:parts.map(p=>p.reportMonth).filter(Boolean).sort()[0]||null,conflicts,invalidCells,stats:{sheetCount:parts.length,latestSheet:parts.at(-1)?.stats.latestSheet||'',currencyCount:currencies.length,monthCount:keys.length,valueCount,firstMonth:keys[0]||null,lastMonth:keys.at(-1)||null}};
}
const issue=(code,tr,en,detail={})=>({code,tr,en,...detail});
function validateFxImport(parsed,current={}){
 const errors=[],warnings=[],months=parsed?.months||{},keys=Object.keys(months).sort(),currencies=new Set();
 for(const month of keys){
  if(!validMonth(month))errors.push(issue('invalid-month','Geçersiz ay anahtarı.','Invalid month key.',{month}));
  for(const [code,value] of Object.entries(months[month]||{})){
   currencies.add(code);if(!/^[A-Z]{3}$/.test(code))errors.push(issue('invalid-code','Geçersiz döviz kodu.','Invalid currency code.',{month,currency:code}));
   if(!Number.isFinite(value)||value<=0)errors.push(issue('invalid-value','Kur sonlu ve sıfırdan büyük olmalı.','Rate must be finite and greater than zero.',{month,currency:code}));
   if(code==='TRY'&&value<1)errors.push(issue('reversed-try','TRY kuru 1’den küçük; kur yönünü kontrol edin.','TRY rate is below 1; check the rate direction.',{month,currency:code}));
   const old=current.months?.[month]?.[code];if(Number.isFinite(old)&&old>0&&Math.abs(value/old-1)>CURRENT_DIFFERENCE_THRESHOLD)warnings.push(issue('current-difference','Mevcut kura göre fark %15’i aşıyor.','Difference from current rate exceeds 15%.',{month,currency:code}));
  }
 }
 for(const cell of parsed?.invalidCells||[])errors.push(issue('invalid-value','Geçersiz kur hücresi.','Invalid rate cell.',cell));
 for(const cell of parsed?.conflicts||[])errors.push(issue('conflicting-cell','Aynı ay ve döviz için çelişen değerler var.','Conflicting values for the same month and currency.',cell));
 if(currencies.size<MIN_CURRENCIES)errors.push(issue('too-few-currencies','En az üç döviz gerekir.','At least three currencies are required.'));
 if(!keys.length)errors.push(issue('no-months','En az bir ay gerekir.','At least one month is required.'));
 for(const code of currencies){let previous=null;for(const month of keys){const value=months[month]?.[code];if(value==null)continue;if(previous&&Math.abs(value/previous.value-1)>MONTH_JUMP_THRESHOLD)warnings.push(issue('month-jump','Ardışık aylardaki kur farkı %25’i aşıyor.','Rate change between successive months exceeds 25%.',{month,currency:code}));previous={month,value};}}
 const ordinal=key=>+key.slice(0,4)*12+(+key.slice(5)-1);
 for(let i=1;i<keys.length;i++)if(validMonth(keys[i])&&validMonth(keys[i-1])&&ordinal(keys[i])-ordinal(keys[i-1])>1)warnings.push(issue('month-gap','Ay sütunları arasında boşluk var.','There is a gap between month columns.',{month:keys[i]}));
 for(const code of EXPECTED_CURRENCIES)if(!currencies.has(code))warnings.push(issue('missing-currency','Beklenen döviz bulunamadı.','An expected currency is missing.',{currency:code}));
 return {errors,warnings};
}
function mergeMonths(current,candidate){const months=Object.fromEntries(Object.entries(current||{}).map(([m,r])=>[m,{...r}]));for(const [month,rates] of Object.entries(candidate||{}))months[month]={...months[month],...rates};return months;}
function diffCells(parsed,current={}){
 const cells=[];for(const [month,rates] of Object.entries(parsed.months||{}).sort())for(const [currency,value] of Object.entries(rates)){const old=current.months?.[month]?.[currency]??null,percent=Number.isFinite(old)&&old>0?(value/old-1)*100:null;cells.push({month,currency,old,value,percent,flagged:percent!=null&&Math.abs(percent)>CURRENT_DIFFERENCE_THRESHOLD*100});}return cells;
}
function previewGrids(grids){return grids.map(grid=>({sheetName:grid.sheetName,totalRows:grid.rows.length,totalColumns:grid.rows.reduce((n,row)=>Math.max(n,row.length),0),cells:grid.rows.slice(0,30).map((row,r)=>row.slice(0,40).map((value,c)=>({address:columnName(c)+(r+1),value:String(value==null?'':value).slice(0,40)})))}));}
return Object.freeze({detectLayout,extractWithLayout,validateFxImport,normalizeLayout,combineParsed,mergeMonths,diffCells,previewGrids,numberValue,monthFromValue,columnIndex,columnName,validMonth,MONTH_JUMP_THRESHOLD,CURRENT_DIFFERENCE_THRESHOLD,EXPECTED_CURRENCIES,FX_LAYOUT_GUIDE,MAX_GRID_CELLS});
});
