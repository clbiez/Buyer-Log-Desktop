'use strict';
/* Genel Bakış okuma modeli hesabı (#1074). HTTP'siz, DOM'suz; okuma modeli
 * işçisinde çalışır. Girdi kullanıcı kapsamına göre ÖNCEDEN süzülmüş CP ve
 * Genel Bakış (sipariş özeti) projeksiyon satırlarıdır; kapsam dışı satır hiçbir
 * toplama girmez.
 *
 * Hesap istemcideki kodla aynıdır:
 *  - boyut filtresi, KPI, ülke / alt üretici, sezon × öncelik, Buying Group:
 *    public/overview-model.js (istemcinin eski yolu da bunu kullanır);
 *  - İstisna Kutusu: public/exception-inbox.js project + cp-readiness-engine;
 *  - CP Kontrol Listesi ve Kurallar özeti, satır öncelikleri: karar barındırıcısı
 *    (aynı cp-overview-assistant.js, overview-decision-host.js).
 *
 * Çıktı sözleşmesi (version 1):
 *  { version, cp:null|{ rows, country:[[ad,adet]], subManufacturer:[[ad,adet]],
 *      season:{codes,labels:{code:{tr,en}},rows:[{label,count,qty,priorities}]},
 *      summary:<cp-overview-assistant overviewSummaryOf>, notes:[satır] },
 *    exceptionInbox:null|{items,counts,total},
 *    orders:null|{ kpi:{total,active,fobUsd,fobTry}, buyingGroup:[{label,...}] } }
 */
const Model=require('../../../public/overview-model');
const Inbox=require('../../../public/exception-inbox');
const Engine=require('../../../public/cp-readiness-engine');
const rules=require('../../../public/business-rules');
const fields=require('../canonical-fields');
const INBOX_LIMIT=200;

// Kullanıcının not hatırlatıcısı istemcide overviewNoteGroups ile (yazar süzmesi
// dahil) kurulur; burada yalnız not taşıyan satırlar seçilir.
const hasNote=row=>Model.norm(row&&row['Notes'])!==''||Model.norm(row&&row['Ek Not'])!=='';

async function computeOverviewModel({cpRows=null,summaryRows=null,filters={},host=null,transitRules=[]}){
  const main=Model.normalizeFilters(filters.main),bg=Model.normalizeFilters(filters.bg);
  const out={version:1,cp:null,exceptionInbox:null,orders:null};
  if(Array.isArray(cpRows)){
    const cp=cpRows.filter(row=>Model.passesDimFilters(row,true,main));
    const decided=host?host.overview(cp):null;
    out.cp={
      rows:cp.length,
      country:Model.groupCount(cp,'Country'),
      subManufacturer:Model.groupCount(cp,'Sub-Manufacturer'),
      season:decided?{codes:decided.codes,labels:decided.labels,
        rows:Model.seasonBreakdown(cp,{codes:decided.codes,priorityOf:decided.priorityOf,compareSeason:rules.compareSeasonNumberThenLetter})
          .map(([label,data])=>({label,count:data.count,qty:data.qty,priorities:data.priorities}))}:null,
      summary:decided?decided.summary:null,
      notes:cp.filter(hasNote),
    };
    const transit=Array.isArray(transitRules)?transitRules:[];
    out.exceptionInbox=await Inbox.project(cpRows,{fields,limit:INBOX_LIMIT,yield:()=>Promise.resolve(),
      analyze:row=>Engine.analyzeOrder(row,{transitRules:transit}),filter:row=>Model.passesDimFilters(row,true,main)});
  }
  if(Array.isArray(summaryRows)){
    const orders=summaryRows.filter(row=>Model.passesDimFilters(row,false,main));
    const groups=Model.buyingGroups(summaryRows.filter(row=>Model.passesDimFilters(row,false,bg)));
    out.orders={kpi:Model.orderKpis(orders),
      buyingGroup:groups.map(([label,d])=>({label,active:d.active,total:d.total,remaining:d.remaining,totalQty:d.totalQty,
        fobUsd:d.fobValueUsd,fobTry:d.fobValueTry,totalFobUsd:d.totalFobValueUsd,totalFobTry:d.totalFobValueTry}))};
  }
  return out;
}
module.exports={computeOverviewModel,INBOX_LIMIT};
