'use strict';
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),core=path.resolve(__dirname,'../../../resources/app'),root=process.env.BUYER_LOG_PORTABLE_ROOT,started=performance.now();
const accessModule=require(path.join(core,'server/lib/user-access')),original=accessModule.buildUserAccess;let access;
accessModule.buildUserAccess=(...args)=>(access=original(...args));
const platform=require(path.join(core,'server/lib/platform'));platform.openPathExternally=()=>false;platform.openPathExternallyAsync=async()=>false;
require(path.join(core,'server/server.js'));
function png(seed){const w=240,h=320,raw=Buffer.alloc((w*3+1)*h);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const p=y*(w*3+1)+1+x*3;raw[p]=(x+seed*19)%256;raw[p+1]=(y+seed*31)%256;raw[p+2]=((x^y)+seed*13)%256;}const crc=data=>{let c=-1;for(const b of data){c^=b;for(let n=0;n<8;n++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^-1)>>>0;},chunk=(name,data)=>{const type=Buffer.from(name),head=Buffer.alloc(4),tail=Buffer.alloc(4);head.writeUInt32BE(data.length);tail.writeUInt32BE(crc(Buffer.concat([type,data])));return Buffer.concat([head,type,data,tail]);},ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(w);ihdr.writeUInt32BE(h,4);ihdr[8]=8;ihdr[9]=2;return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);}
async function seed(){
 const orders=Array.from({length:30000},(_,i)=>({ocode:5000000+i,model:'BENCH-MODEL-'+(i%300),ccode:String(i%3+1).padStart(2,'0'),colour:['BLUE','RED','BLACK'][i%3],buyer:'Bench Buyer '+(i%9+1),buyerGrup:'DEMO',mag:'DEMO MAG',mmyg:'DEMO MMYG',buyingGroup:'DEMO GROUP',manufacturer:'Demo Supplier '+String(i%50+1).padStart(2,'0'),license:'Demo License '+String(i%20+1).padStart(2,'0'),licensor:'DEMO LICENSOR',countryRaw:i%2?'CHINA':'TURKIYE',qty:100+i%300,kalan:100+i%300,fob:5+i%7,opd:new Date(2026,8,1),ex:new Date(2026,i%4===0?8:10,1),retail:new Date(2026,11,1),mb:new Date(2026,11,15)}));
 for(let i=0;i<30;i++)orders.push({...orders[i],qty:15,kalan:15,ex:new Date(2026,10,15)});
 const active=['moderator',...Array.from({length:9},(_,i)=>'bench-buyer-'+(i+1))];for(const id of active)global.__blSeedAsas(orders,id,['cp','orders']);access.syncProfiles(orders,{authoritative:true});
 const workspaces=require(path.join(core,'server/lib/collection-workspaces')),data=require(path.join(core,'server/user-data')),manufacturers=Array.from({length:50},(_,i)=>'Demo Supplier '+String(i+1).padStart(2,'0'));let images=0;
 for(let owner=0;owner<300;owner++){
  const id=owner===0?'moderator':'bench-buyer-'+owner,current=workspaces.loadWorkspace(id);if(current.rows.length)continue;
  const rows=Array.from({length:owner<10?300:1},(_,i)=>({id:i+1,modelKod:'BENCH-MODEL-'+i,plmId:'BENCH-PLM-'+i,colourCode:String(i%3+1).padStart(2,'0'),colour:['BLUE','RED','BLACK'][i%3],season:'W26',country:i%2?'China':'Turkey',manufacturer:manufacturers[i%50],lisans:'Demo License '+String(i%20+1).padStart(2,'0'),licensor:'DEMO LICENSOR',qty:100,targetPrice:'12',pricing:{[manufacturers[i%50]]:'10.25'}}));
  if(owner===0)for(let i=0;i<30;i++){const image=data.saveCollectionImage({rowId:String(i+1),filename:'bench-'+i+'.png',mimeType:'image/png',base64:png(i).toString('base64')});rows[i].imgRef=image.id;rows[i].img=image.url;images++;}
  await workspaces.saveWorkspaceAsync(id,{rows,manufacturers},current._revision);
 }
 const result={ready:true,orders:30000,physicalRows:orders.length,partialSourceRows:30,visibleCollectionRows:300,workspaceFiles:300,fullWorkspaces:10,singleRowWorkspaces:290,manufacturers:50,licenses:20,activeProfiles:10,directoryProfiles:300,seededImages:images,seedMs:performance.now()-started};fs.writeFileSync(path.join(root,'seed-ready.json'),JSON.stringify(result,null,2));
}
const timer=setInterval(()=>{if(!access||typeof global.__blSeedAsas!=='function')return;clearInterval(timer);seed().catch(error=>{fs.writeFileSync(path.join(root,'seed-error.txt'),error.stack);console.error(error);});},30);timer.unref();
