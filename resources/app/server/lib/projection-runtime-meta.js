'use strict';
function projectionRuntimeMeta(runtime){
  const src=runtime||{};
  return {loadedAt:src.loadedAt||null,sources:src.sources||null,cpupdateInfo:src.cpupdateInfo||null,cpupdateOverrides:src.cpupdateOverrides||null,
    fabricHeaderInfo:src.fabricHeaderInfo||null,antrepoHeaderInfo:src.antrepoHeaderInfo||null,lflMeta:src.lflMeta||null,
    refreshWarnings:Array.isArray(src.refreshWarnings)?src.refreshWarnings:[],refreshWarningDetails:Array.isArray(src.refreshWarningDetails)?src.refreshWarningDetails:[],
    modelRefresh:src.modelRefresh||null,lastRefreshResult:src.lastRefreshResult||null};
}
module.exports={projectionRuntimeMeta};
