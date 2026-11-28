'use strict';
// Nihai doğrulama fixture'ı: generate-demo-data (seed 7) + Windows kapısıyla AYNI dönüşüm (gate.js prepareFixture):
// ASAS 'Buying Son Onay Tarihi' her 4. satırda boşaltılır → elle düzenlenebilir Ex-factory satırları oluşur. Tüm kollar aynı dizini okur.
// node fixture-ex.js <FIXTURE_APP> <OUT_DIR> <ROWS>
const fs=require('fs'),path=require('path'),{spawnSync}=require('child_process');
const [FIX,DIR,ROWS]=process.argv.slice(2);const SHIP_CONF='Buying Son Onay Tarihi';
if(fs.existsSync(path.join(DIR,'fixture.json'))){process.stdout.write(fs.readFileSync(path.join(DIR,'fixture.json'),'utf8'));process.exit(0);}
fs.rmSync(DIR,{recursive:true,force:true});
const g=spawnSync(process.execPath,[path.join(FIX,'scripts','generate-demo-data.js'),DIR,'--rows',String(ROWS),'--seed','7'],{cwd:FIX,encoding:'utf8',maxBuffer:64<<20});
if(g.status!==0)throw Error(g.stderr||g.stdout);
const XLSX=require(path.join(FIX,'node_modules','xlsx'));const file=fs.readdirSync(DIR).map(f=>path.join(DIR,f)).find(f=>/^ASAS/i.test(path.basename(f)));
const wb=XLSX.readFile(file),name=wb.SheetNames[0],aoa=XLSX.utils.sheet_to_json(wb.Sheets[name],{header:1,raw:true,defval:null});
const h=aoa.findIndex(r=>Array.isArray(r)&&r.includes(SHIP_CONF));if(h<0)throw Error('ASAS yükleme onayı sütunu yok');const col=aoa[h].indexOf(SHIP_CONF);let cleared=0;
for(let i=h+1;i<aoa.length;i++)if((i-h)%4===1&&aoa[i]&&aoa[i][col]!=null){aoa[i][col]=null;cleared++;}
const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(aoa),name);XLSX.writeFile(book,file,{bookType:'xlsx'});
const crypto=require('crypto');const sums=Object.fromEntries(fs.readdirSync(DIR).filter(f=>f!=='fixture.json').sort().map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(path.join(DIR,f))).digest('hex')]));
const meta={generator:FIX,rows:Number(ROWS),seed:7,asasRows:aoa.length-h-1,loadingApprovalCleared:cleared,sha256:sums};
fs.writeFileSync(path.join(DIR,'fixture.json'),JSON.stringify(meta,null,1));process.stdout.write(JSON.stringify(meta,null,1));
