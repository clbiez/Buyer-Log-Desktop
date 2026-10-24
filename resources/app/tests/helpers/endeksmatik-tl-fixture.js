'use strict';
// Synthetic values; the two control layouts follow the locally inspected S7/W6
// workbooks. No company workbook, class name or source number is included.
const XLSX=require('xlsx');
const SHEETS=['KLASMAN KUMAŞ PİVOT','KLASMAN CMT PİVOT','KLASMAN AKSESUAR PİVOT','KLASMAN EK İŞLEM PİVOT'];
function buildLegacyTlWorkbook({layout='s7',season='SYNTHETIC',date=46000}={}){
 const wb=XLSX.utils.book_new(),screen={},shift=layout==='w6'?1:0,selection=[3,4,5,6,7].map(r=>'C'+(r+shift));
 const dims=['CUW4','CU4E','KNIT','LICENSE','TOP'],weights=[.4,.3,.2,.1],put=(a,v,f)=>{screen[a]={t:typeof v==='number'?'n':'s',v,...(f?{f}:{})};};
 put('C'+(1+shift),season);put('C'+(2+shift),date);
 selection.forEach((a,i)=>put(a,dims[i]));
 const oldOrder='C'+(8+shift),oldStore='C'+(9+shift),order='C'+(10+shift),store='C'+(11+shift),adjust='B'+(22+shift);
 for(const a of [oldOrder,oldStore])put(a,202501);for(const a of [order,store])put(a,202502);put(adjust,.03);
 const key=selection.join('&"_"&'),look=(sheet,month)=>`VLOOKUP(${key},'${sheet}'!$A:$BF,VLOOKUP("Toplam "&${month},Seçimler!$AT$1:$AU$58,2,FALSE),FALSE)`;
 const fx=r=>`VLOOKUP($${store[0]}$${store.slice(1)},Değişimler!V${r}:$W$150,2,FALSE)/VLOOKUP($${oldStore[0]}$${oldStore.slice(1)},Değişimler!V${r}:$W$150,2,FALSE)`;
 SHEETS.forEach((sheet,i)=>{
  const row=16+shift+i,current=i%2?store:order,previous=i%2?oldStore:oldOrder,usd=1.1/(31/30)-1;
  put('C'+row,.1,`IFERROR(${look(sheet,current)}/${look(sheet,previous)}-1,"-")`);
  put('D'+row,usd,`IFERROR((1+C${row})/(${fx(i+3)})-1,"-")`);
  put('F'+row,weights[i],`VLOOKUP(${key},'KLASMAN LİSTESİ ÖZET'!$A:$J,${7+i},FALSE)`);
  put('C'+(23+shift+i),.067,`(1+C${row})*(1-$B$${22+shift})-1`);
  put('D'+(23+shift+i),(1+usd)*.97-1,`(1+D${row})*(1-$B$${22+shift})-1`);
 });
 const sum=(start,weight)=>weights.map((_,i)=>`C${start+i}*${weight?'$F$':'F'}${16+shift+i}`).join('+'),total=20+shift,target=27+shift;
 put('C'+total,.1,`IFERROR(${sum(16+shift,shift)},"-")`);
 put('D'+total,1.1/(31/30)-1,`IFERROR((1+C${total})/(${fx(7)})-1,"-")`);
 put('C'+target,.067,`IFERROR(${sum(23+shift,shift)},"-")`);
 put('D'+target,1.1/(31/30)*.97-1,`(1+D${total})*(1-$B$${22+shift})-1`);
 screen['!ref']='B1:F28';XLSX.utils.book_append_sheet(wb,screen,'ENDEKSMATİK');
 const header=[null,'Merch Marka Yaş Grup','Merch Alt Grup','Tedarik Grup','Buyer Grup','Klasman'];
 XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([header,[null,...dims,...weights]]),'KLASMAN LİSTESİ ÖZET');
 for(const name of SHEETS)XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([[...header,'Toplam 202501','Toplam 202502'],[null,...dims,100,110]]),name);
 const rates=[];rates[2]=[];rates[2][21]=202501;rates[2][22]=30;rates[3]=[];rates[3][21]=202502;rates[3][22]=31;
 XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(rates),'Değişimler');
 return XLSX.write(wb,{type:'buffer',bookType:'xlsx'});
}
module.exports={buildLegacyTlWorkbook};
