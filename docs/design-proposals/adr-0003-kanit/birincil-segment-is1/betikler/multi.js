// Sentetik: üretimsiz çoklu lojistik aşama kategorisi. main ↔ aday, Siparişler (parse.js) ve CP (prep) alanları.
const [MAIN,CAND]=process.argv.slice(2);
const load=app=>({parse:require(app+'/server/lib/parse.js'),prep:require(app+'/server/lib/read-model/overview-row-prep.js')});
const M=load(MAIN),C=load(CAND);
const STAGES=[['Yükleme Operasyonları','TIR'],['Yol Operasyonları','Gemi'],['Gümrük-Liman Operasyonları','Uçak'],['Depoda','Gemi+Uçak']];
const dates=['2026-12-04','2026-12-20','2027-01-10'];
const asas=(code)=>({'Sipariş Kod':String(code),'Model Adı':'M','Renk Kod':'C01','Renk':'X','Net Alım Sipariş Miktarı':10000,'Kalan Alım Sipariş Miktarı':3000,'FOB Fiyatı':5,'Üretici':'S','Sezon':'W6','Buyer Grup (TR)':'BG','Siparişin Üretildiği Ülke':'BANGLADES','Orijinal Exfactory Merch Tarih':'2026-11-01','Retail Depo Tarih Yıl Ay Gün':'2027-06-01','Model Bütçe Tarih Yıl Ay Gün':'2027-06-15'});
let seq=0;const ias=(code,[st,v],qty,arr)=>({'Sipariş Kod':String(code),'Ürün Ad':'M','Renk Kod':'C01','Renk Tanım':'X','Supplier Portal Statü':st,'Tahmini Antrepo Giriş Tarihi':arr,'HANDOVER Tarihi':st.startsWith('Yükleme')?'':'2026-11-20','Vasita Tanim':v,'Yükleme Toplam Adet':qty,'Net Alım Sipariş Miktarı':10000,'İthalat Dosya No':'I'+(++seq),'Konteyner No':'K'+seq});
const cases=[];let code=5100000;
// İki farklı aşama, her tarih sırası; üç aşama; aynı aşamada iki parsiyel.
for(let i=0;i<STAGES.length;i++)for(let j=i+1;j<STAGES.length;j++)for(const [di,dj] of [[0,2],[2,0]])cases.push({label:`${STAGES[i][0]} + ${STAGES[j][0]} (${di<dj?'geride olan önce varır':'geride olan sonra varır'})`,parts:[[STAGES[i],4900,dates[di]],[STAGES[j],4900,dates[dj]]]});
cases.push({label:'Yükleme + Yol + Depoda (geride olan en geç)',parts:[[STAGES[0],3300,dates[2]],[STAGES[1],3300,dates[1]],[STAGES[3],3300,dates[0]]]});
cases.push({label:'iki Yol (aynı aşama)',parts:[[STAGES[1],4900,dates[2]],[STAGES[1],4900,dates[0]]]});
const ov=p=>({antrepoMatchConfig:p.defaultAntrepoMatchConfig(),submap:{},delmap:{},suppfobmap:{},suppfobmetamap:{},notesmap:{},licensormap:{},pricingRules:[],transitRules:[],datemap:{}});
const d=v=>v?(typeof v==='object'?`${v.getFullYear()}-${String(v.getMonth()+1).padStart(2,'0')}-${String(v.getDate()).padStart(2,'0')}`:String(v).slice(0,10)):null;
const f=r=>[r.STATUS,r['Del. Type'],d(r['Ant. Arrival']),d(r['HANDOVER Tarihi'])].join(' · ');
const run=(L,c)=>{const o=ov(L.parse);const code=c.code;const orders=L.parse.parseASASRows([asas(code)],o.antrepoMatchConfig).orders;const map=L.parse.parseAntrepoRows(c.parts.map(p=>ias(code,...p)),o.antrepoMatchConfig);
 const row=L.parse.buildCPRowsFromASAS(orders,map,o)[0];const rm=JSON.parse(JSON.stringify(row));L.prep.prepareCpRows([rm]);return {P:f(row),R:f(rm)};};
let changedOrders=0,changedCp=0;const out=[];
for(const c of cases){c.code=code++;const a=run(M,c),b=run(C,c);if(a.P!==b.P)changedOrders++;if(a.R!==b.R)changedCp++;out.push({kategori:c.label,mainSiparisler:a.P,mainCP:a.R,aday:b.P,adayCpEsit:b.P===b.R});}
console.log(JSON.stringify({vaka:cases.length,siparislerDegisen:changedOrders,cpDegisen:changedCp,satirlar:out},null,1));
