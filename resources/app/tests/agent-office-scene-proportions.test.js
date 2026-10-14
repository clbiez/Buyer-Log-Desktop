'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const SOURCE=fs.readFileSync(path.join(__dirname,'../public/agent-office-scene.js'),'utf8');
function scene(){
  const root={matchMedia:()=>({matches:false,addEventListener(){},removeEventListener(){}})};
  const source=SOURCE.replace("import('/agent-office-workshop-model.js')",'Promise.resolve(null)').replace(/\}\)\(window\);\s*$/,'root.__sceneTest={seatOffset,objectWidth,deskWidth,DESK_HEIGHT,DESK_RATIO,KEYBOARD_X,MEETING_SEATS,SEATED_SIZE,STANDING_SIZE,FURNITURE_SCALE};})(window);');
  vm.runInNewContext(source,{window:root,document:{hidden:false,addEventListener(){},removeEventListener(){}},Image:class{},structuredClone,requestAnimationFrame:()=>1,cancelAnimationFrame(){},setTimeout,clearTimeout,performance:{now:()=>1}});
  return root.__sceneTest;
}
test('every desk style shares one desk-surface height instead of one drawing width',()=>{
  const s=scene();
  for(const style of Object.keys(s.DESK_RATIO)){
    const width=s.deskWidth({kind:'desk',style}),surface=width*s.DESK_RATIO[style];
    assert.ok(Math.abs(surface-s.DESK_HEIGHT)<=3,`${style} desk surface ${surface.toFixed(1)}px`);
  }
});
test('seated agents sit in front of their desk at the keyboard, not beside or above it',()=>{
  const s=scene();
  for(const style of Object.keys(s.KEYBOARD_X)){
    const desk={kind:'desk',style},width=s.objectWidth(desk),seat=s.seatOffset(desk);
    assert.ok(seat.y>0,'feet stand on the floor in front of the desk legs');
    assert.ok(Math.abs(seat.x)<width/2-10,`${style} seat stays within the desk span`);
    assert.ok(Math.abs(seat.x-(s.KEYBOARD_X[style]-.5)*width)<=6,`${style} seat is at the keyboard`);
  }
});
test('agents and furniture use one real-world scale',()=>{
  const s=scene(),pxPerMetre=s.DESK_HEIGHT/.72,standing=s.STANDING_SIZE*.95/pxPerMetre;
  assert.ok(standing>1.55&&standing<1.85,`standing agent ${standing.toFixed(2)} m`);
  assert.ok(s.SEATED_SIZE<s.STANDING_SIZE);
  // Heights implied by the drawing ratios: sofa back, bookshelf, garment rack, dress form.
  const metres={sofa:s.FURNITURE_SCALE.sofa*80/160/pxPerMetre,shelf:s.FURNITURE_SCALE.shelf*1.717/pxPerMetre,rack:s.FURNITURE_SCALE.rack*1.574/pxPerMetre,mannequin:s.FURNITURE_SCALE.mannequin*2.486/pxPerMetre};
  assert.ok(metres.sofa<1.1,`sofa ${metres.sofa.toFixed(2)} m`);
  assert.ok(metres.shelf>1.8&&metres.shelf<2.2,`shelf ${metres.shelf.toFixed(2)} m`);
  assert.ok(metres.rack>1.6&&metres.rack<2,`rack ${metres.rack.toFixed(2)} m`);
  assert.ok(metres.mannequin>1.4&&metres.mannequin<1.8,`mannequin ${metres.mannequin.toFixed(2)} m`);
});
test('desk workers and near-side meeting seats face into the scene with a back-view chair',()=>{
  const s=scene();
  assert.equal(JSON.stringify(s.MEETING_SEATS.map(seat=>seat.back)),'[false,false,true,true]');
  assert.match(SOURCE,/'chair-back'\]/);
  assert.match(SOURCE,/const back=facingDesk\|\|/);
  assert.match(SOURCE,/if\(seated&&!sofa\)deskChair\(/);
  assert.ok(fs.existsSync(path.join(__dirname,'../public/assets/agent-office/workshop/chair-back.png')));
});
