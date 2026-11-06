'use strict';

// Playwright başlangıç betiği: dış kapsamdan bağımsızdır.
function installFirstTransitionProbe({module,expectedRows,timeoutMs=900000}) {
  if(!['cp','orders'].includes(module))throw Error('Unsupported first transition');
  let finished=false,firstPaintAt=null,interactivePaintAt=null,paintPending=false,dataReadyAt=null;
  const clicked=new WeakSet();
  const contentId=module==='cp'?'cpContent':'ordersContent';
  const selector=module==='cp'?'#cpTable tbody tr[data-id]':'#ordersTable tbody tr[data-id]';
  const rows=()=>module==='cp'?state.cp?.rows:state.orders?.rows;
  const visible=element=>Boolean(element&&!element.hidden&&element.getClientRects().length);
  const holds=()=>[...document.querySelectorAll('.blTriviaHold')].filter(visible);
  const dataReady=()=>document.body.dataset.activeTab===module&&rows()?.length===expectedRows&&visible(document.getElementById(contentId))&&(expectedRows===0||document.querySelector(selector));
  window.__benchmarkFirstTransition=null;
  window.addEventListener('bl:startup-complete',()=>{
    const intentAt=performance.now();
    const result=window.__benchmarkFirstTransition={module,status:'scheduled',intentAtMs:intentAt,
      startedWithRows:rows()?.length??null,moduleContinueCount:0,stabilityObservationMs:1000};
    function fail(message){if(finished)return;finished=true;Object.assign(result,{status:'failed',error:message,failedAtMs:performance.now(),activeTab:document.body.dataset.activeTab,actualRows:rows()?.length??null,contentVisible:visible(document.getElementById(contentId)),domRows:document.querySelectorAll(selector).length,firstPaintAtMs:firstPaintAt,moduleStates:window.BLModulePreparation?.snapshot?.()});}
    function tick(){
      if(finished)return;
      try{
        const now=performance.now();
        if(now-intentAt>timeoutMs){fail('First transition timed out');return;}
        if(window.BLModulePreparation?.snapshot?.()[module]?.status==='error'){fail('Module preparation failed');return;}
        const ready=Boolean(dataReady());
        if(ready&&dataReadyAt===null)dataReadyAt=now;
        const blockers=holds();
        if(blockers.length){
          interactivePaintAt=null;
          for(const hold of blockers){
            const button=hold.querySelector('[data-hold-continue]');
            if(ready&&visible(button)&&!hold.dataset.leaving&&!clicked.has(button)){
              clicked.add(button);result.moduleContinueCount++;button.click();
            }
          }
          setTimeout(tick,20);return;
        }
        if(!ready){interactivePaintAt=null;setTimeout(tick,20);return;}
        if(interactivePaintAt===null&&!paintPending){
          paintPending=true;
          requestAnimationFrame(()=>requestAnimationFrame(()=>{
            paintPending=false;
            if(dataReady()&&!holds().length){const at=performance.now();if(firstPaintAt===null)firstPaintAt=at;interactivePaintAt=at;}
            setTimeout(tick,20);
          }));
          return;
        }
        if(firstPaintAt!==null&&interactivePaintAt!==null&&now-firstPaintAt>=1000){
          finished=true;
          Object.assign(result,{status:'passed',dataReadyMs:dataReadyAt-intentAt,firstRowsPaintedMs:firstPaintAt-intentAt,
            elapsedMs:interactivePaintAt-intentAt,paintedAtMs:interactivePaintAt,observationEndMs:now-intentAt,
            rows:rows().length,domRows:document.querySelectorAll(selector).length,canAccess:window.BLCanAccessArea?.(module)===true});
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
