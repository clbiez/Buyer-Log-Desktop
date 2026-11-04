'use strict';

// One frame per window, consumed once after sign-in navigation. Never persisted.
function createStartupTransition({ttlMs=15000,captureTimeoutMs=450,now=Date.now}={}) {
  const frames=new Map();
  function clear(sender) {
    const entry=frames.get(sender);
    if(entry){clearTimeout(entry.timer);sender.removeListener('destroyed',entry.destroyed);}
    frames.delete(sender);
  }
  async function prepare(sender,width,height) {
    clear(sender);
    if(!(width>0&&height>0&&width<=8192&&height<=8192&&width*height<=16777216))return false;
    const entry={frame:null,expires:now()+ttlMs,timer:null,destroyed:null};
    frames.set(sender,entry);
    entry.timer=setTimeout(()=>clear(sender),ttlMs);entry.timer.unref?.();
    entry.destroyed=()=>{if(frames.get(sender)===entry)clear(sender);};
    sender.once('destroyed',entry.destroyed);
    let timeout;
    try {
      let image=await Promise.race([sender.capturePage(),new Promise(resolve=>{timeout=setTimeout(()=>resolve(null),captureTimeoutMs);})]);
      if(!image||image.isEmpty()||sender.isDestroyed()||frames.get(sender)!==entry||now()>=entry.expires)return false;
      const size=image.getSize();
      if(size.width!==width||size.height!==height)image=image.resize({width,height,quality:'good'});
      entry.frame={width,height,bgra:image.toBitmap()};
      return true;
    } catch (_) { return false; }
    finally {
      clearTimeout(timeout);
      if(!entry.frame&&frames.get(sender)===entry)clear(sender);
    }
  }
  function take(sender) {
    const entry=frames.get(sender);clear(sender);
    return entry&&now()<entry.expires?entry.frame:null;
  }
  return {prepare,take};
}
module.exports={createStartupTransition};
