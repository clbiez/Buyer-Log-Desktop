'use strict';

// Playwright başlangıç betiği: dış kapsamdan bağımsızdır.
function installFirstTransitionProbe({module,expectedRows,timeoutMs=900000,logEvents=false}) {
  if(!['cp','orders'].includes(module))throw Error('Unsupported first transition');
  let finished=false,firstPaintAt=null,interactivePaintAt=null,paintPending=false,dataReadyAt=null;
  const clicked=new WeakSet();
  const contentId=module==='cp'?'cpContent':'ordersContent';
  const selector=module==='cp'?'#cpTable tbody tr[data-id]':'#ordersTable tbody tr[data-id]';
  const rows=()=>module==='cp'?state.cp?.rows:state.orders?.rows;
  const visible=element=>Boolean(element&&!element.hidden&&element.getClientRects().length);
  const holds=()=>[...document.querySelectorAll('.blTriviaHold')].filter(visible);
  const dataReady=()=>document.body.dataset.activeTab===module&&rows()?.length===expectedRows&&visible(document.getElementById(contentId))&&(expectedRows===0||document.querySelector(selector));
  function rowUnobscured(){
    if(expectedRows===0)return true;
    const row=document.querySelector(selector);
    if(!row||typeof document.elementFromPoint!=='function')return false;
    const style=window.getComputedStyle(row);
    if(style.visibility==='hidden'||style.visibility==='collapse'||Number(style.opacity)===0)return false;
    const rect=row.getBoundingClientRect(),left=Math.max(0,rect.left),right=Math.min(window.innerWidth,rect.right),
      top=Math.max(0,rect.top),bottom=Math.min(window.innerHeight,rect.bottom);
    if(right<=left||bottom<=top)return false;
    const hit=document.elementFromPoint((left+right)/2,(top+bottom)/2);
    return Boolean(hit&&(hit===row||row.contains(hit)));
  }
  window.__benchmarkFirstTransition=null;
  window.addEventListener('bl:startup-complete',()=>{
    const intentAt=performance.now();let lastProgressAt=intentAt,lastTickAt=intentAt,stableSince=null;
    const result=window.__benchmarkFirstTransition={module,status:'scheduled',intentAtMs:intentAt,
      startedWithRows:rows()?.length??null,moduleContinueCount:0,stabilityObservationMs:1000,
      visibilityProbeVersion:2,maxStablePollGapMs:100,observationRestarts:0,maxPollGapMs:0};
    function fail(message){if(finished)return;finished=true;Object.assign(result,{status:'failed',error:message,failedAtMs:performance.now(),activeTab:document.body.dataset.activeTab,actualRows:rows()?.length??null,contentVisible:visible(document.getElementById(contentId)),domRows:document.querySelectorAll(selector).length,firstPaintAtMs:firstPaintAt,moduleStates:window.BLModulePreparation?.snapshot?.()});}
    function tick(){
      if(finished)return;
      try{
        const now=performance.now();
        const pollGap=now-lastTickAt;lastTickAt=now;result.maxPollGapMs=Math.max(result.maxPollGapMs,pollGap);
        // A blocked timer can run before the overdue trivia check, whose settle
        // callback is then still pending. Do not count that blocked wall time as
        // an observed stable screen. This only extends observation, not latency.
        if(stableSince!==null&&pollGap>result.maxStablePollGapMs){stableSince=now;result.observationRestarts++;}
        if(logEvents&&now-lastProgressAt>=30000){
          lastProgressAt=now;
          console.log('BENCHMARK_FIRST_PROGRESS '+JSON.stringify({module,elapsedMs:now-intentAt,active:document.body.dataset.activeTab,rows:rows()?.length??null,visible:visible(document.getElementById(contentId)),domRows:document.querySelectorAll(selector).length,holds:holds().length,firstPaintAtMs:firstPaintAt}));
        }
        if(now-intentAt>timeoutMs){fail('First transition timed out');return;}
        if(window.BLModulePreparation?.snapshot?.()[module]?.status==='error'){fail('Module preparation failed');return;}
        const ready=Boolean(dataReady());
        if(ready&&dataReadyAt===null)dataReadyAt=now;
        const blockers=holds();
        if(blockers.length){
          interactivePaintAt=null;stableSince=null;
          for(const hold of blockers){
            const button=hold.querySelector('[data-hold-continue]');
            if(ready&&visible(button)&&!hold.dataset.leaving&&!clicked.has(button)){
              clicked.add(button);result.moduleContinueCount++;button.click();
            }
          }
          setTimeout(tick,20);return;
        }
        if(!ready||!rowUnobscured()){interactivePaintAt=null;stableSince=null;setTimeout(tick,20);return;}
        if(interactivePaintAt===null&&!paintPending){
          paintPending=true;
          requestAnimationFrame(()=>requestAnimationFrame(()=>{
            paintPending=false;
            if(dataReady()&&!holds().length&&rowUnobscured()){const at=performance.now();if(firstPaintAt===null)firstPaintAt=at;interactivePaintAt=at;stableSince=at;}
            setTimeout(tick,20);
          }));
          return;
        }
        if(firstPaintAt!==null&&interactivePaintAt!==null&&stableSince!==null&&now-stableSince>=result.stabilityObservationMs){
          finished=true;
          Object.assign(result,{status:'passed',dataReadyMs:dataReadyAt-intentAt,firstRowsPaintedMs:firstPaintAt-intentAt,
            elapsedMs:interactivePaintAt-intentAt,paintedAtMs:interactivePaintAt,observationEndMs:now-intentAt,
            rows:rows().length,domRows:document.querySelectorAll(selector).length,canAccess:window.BLCanAccessArea?.(module)===true,rowVisibilityVerified:true});
          return;
        }
        setTimeout(tick,20);
      }catch(error){fail(String(error?.message||error));}
    }
    setTimeout(()=>{
      result.dispatchAtMs=performance.now();result.dispatchDelayMs=result.dispatchAtMs-intentAt;
      try{if(switchTab(module)===false){fail('First transition denied');return;}tick();}
      catch(error){fail(String(error?.message||error));}
    },0);
  },{once:true});
}

function validateFirstTransition(result,expected,initialGeneration){
  const assert=require('node:assert/strict');
  assert.equal(result.status,'passed',result.error);
  assert.equal(result.visibilityProbeVersion,2,'current unobscured-row probe required');
  assert.equal(result.rowVisibilityVerified,true,'an unobscured row must be verified');
  assert.equal(result.rows,expected.rows[result.module]);assert.equal(result.canAccess,true);
  assert.ok(result.domRows>0,'visible row DOM is required');assert.deepEqual(result.errors,[]);
  // /api/data?startup=1 intentionally returns metadata with pageCache.hit=false.
  // Compare that field with the same baseline envelope; actual data identity
  // is mandatory in every projection header and in the final disk manifest.
  assert.equal(result.initialGeneration,initialGeneration);
  assert.ok(result.projectionGenerations.length>0,'projection generation is required');
  assert.ok(result.projectionGenerations.every(value=>value===expected.generation),'projection generation mismatch');
  assert.deepEqual(result.revisions,expected.revisions);
}
module.exports={installFirstTransitionProbe,validateFirstTransition};
