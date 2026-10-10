'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const model=require('../public/agent-office-workshop-model');
test('floor projections keep rear cabinets at the wall and front walkers on their own floor',()=>{
  for(const floor of [0,1]){
    const surface=model.FLOORS[floor];
    for(let y=0;y<4;y++){
      const p=model.project({x:8,y,floor});
      assert.ok(p.y>=surface.top&&p.y<=surface.bottom);
    }
    assert.ok(model.project({x:8,y:0,floor},false).y-surface.top<=10);
  }
});
test('rugs remain wholly on the floor at every editable row and furniture scale',()=>{
  for(const floor of [0,1])for(let y=0;y<4;y++)for(const scale of [1,1.3]){
    const r=model.groundRect({kind:'rug',x:12,y,floor,scale},200*scale);
    assert.ok(r.y>=model.FLOORS[floor].top);
    assert.ok(r.y+r.h<=model.FLOORS[floor].bottom);
    assert.ok(r.h<r.w/3,'Floor perspective cannot become a wall-mounted rectangle');
  }
});
test('walk cadence tracks travelled distance rather than restarting or advancing at rest',()=>{
  assert.equal(model.walkFrame(0),0);
  assert.equal(model.walkFrame(10),1);
  assert.equal(model.walkFrame(60),0);
  assert.deepEqual(Array.from({length:6},(_,i)=>model.walkFrame(i*10)),[0,1,2,3,4,5]);
});
test('outfit material masks separate navy trousers, teal sleeves, skin and dark outlines at the same height',()=>{
  assert.equal(model.material(35,54,76,70,64),'bottoms');
  assert.equal(model.material(38,99,111,70,64),'top');
  assert.equal(model.material(230,171,124,70,64),'skin');
  assert.equal(model.material(19,23,28,70,64),'outline');
  assert.equal(model.material(97,54,32,25,64),'hair');
  assert.equal(model.material(97,54,32,94,64),'shoes');
});

test('drag inverse matches each ground and wall anchor without vertical jumps',()=>{
  for(const floor of [0,1])for(const kind of ['board','decor','desk','rug','shelf'])for(let y=0;y<4;y++){
    const item={x:9,y,floor,kind},p=model.furnitureAnchor(item);
    assert.deepEqual(model.unprojectFurniture({x:p.x+40,y:p.y},kind),{x:10,y,floor});
    assert.deepEqual(model.unprojectFurniture(p,kind),{x:9,y,floor});
  }
});
