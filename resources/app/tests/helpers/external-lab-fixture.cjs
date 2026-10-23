'use strict';
function fixture({result='PASS',secondOrder='',secondReport='DEMSL260000124-B'}={}) {
  const out=[];
  const add=(p,x,y,s)=>out.push({p,x,y,w:s.length*5,s});
  const glyph=(p,x,y,s)=>{for(const c of s){if(c!==' ')add(p,x,y,c);x+=c===' '?3:6;}};
  glyph(1,25,770,'TEST REPORT No');add(1,145,770,': DEMSL260000124-A');glyph(1,350,770,'Issue Date');add(1,415,770,': 17-Oct-2026');
  glyph(1,25,700,'SAMPLE DESCRIPTION');add(1,180,700,'KNITTED GARMENT ( DEMO,KNIT-8YD (GOLD SEAL) ) SUBMITTED');
  glyph(1,25,680,'COLOUR');add(1,180,680,'BLUE');glyph(1,25,660,'ORDER NUMBER');add(1,180,660,'4100001');
  add(1,25,620,'SGS INDIA PVT LTD');
  add(2,25,770,'TEST REPORT No: DEMSL260000124-A');
  for(const [x,s] of [[25,'Item'],[70,'Test Parameters'],[380,'Conclusion'],[450,'Remarks']])add(2,x,700,s);
  for(const [y,n,name,r] of [[680,'1','Azo Dyes','PASS'],[660,'2','Formaldehyde',result]]){add(2,25,y,n);add(2,70,y,name);add(2,380,y,r);}
  add(3,25,770,'TEST REPORT No: '+secondReport);add(3,25,720,'Conclusion');add(3,180,720,'Pass');
  if(secondOrder){glyph(3,25,680,'ORDER NUMBER');add(3,180,680,secondOrder);}
  return out;
}


function pdfFromItems(items) {
  const pages=[...new Set(items.map(item=>item.p))].sort((a,b)=>a-b);
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','', '<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>'];
  const pageRefs=[];
  for(const p of pages){
    const pageId=objects.length+1,streamId=pageId+1;pageRefs.push(pageId+' 0 R');
    const content=items.filter(item=>item.p===p).map(item=>'BT /F1 10 Tf 1 0 0 1 '+item.x+' '+item.y+' Tm ('+item.s.replace(/[()\\]/g,'\\$&')+') Tj ET').join('\n');
    objects.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 3 0 R >> >> /Contents '+streamId+' 0 R >>');
    objects.push('<< /Length '+Buffer.byteLength(content)+' >>\nstream\n'+content+'\nendstream');
  }
  objects[1]='<< /Type /Pages /Count '+pages.length+' /Kids ['+pageRefs.join(' ')+'] >>';
  let pdf='%PDF-1.4\n',offsets=[0];
  objects.forEach((object,i)=>{offsets.push(Buffer.byteLength(pdf));pdf+=(i+1)+' 0 obj\n'+object+'\nendobj\n';});
  const xref=Buffer.byteLength(pdf);pdf+='xref\n0 '+offsets.length+'\n0000000000 65535 f \n'+offsets.slice(1).map(offset=>String(offset).padStart(10,'0')+' 00000 n \n').join('');
  pdf+='trailer\n<< /Size '+offsets.length+' /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF';return Buffer.from(pdf);
}
module.exports={fixture,pdfFromItems};
