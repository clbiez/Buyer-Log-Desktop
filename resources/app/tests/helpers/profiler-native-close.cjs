'use strict';
const assert=require('node:assert/strict');
const {createStallProfiler}=require(process.argv[2]);
(async()=>{
  for(let cycle=0;cycle<4;cycle++){
    const logs=[],profiler=createStallProfiler({windowMs:0,log:line=>logs.push(line)});
    assert.ok(profiler);assert.equal(await profiler.start(),true);
    try{
      const until=performance.now()+15;
      while(performance.now()<until)Math.sqrt(Math.random());
      await profiler.rotate();await profiler.capture(12000);
      assert.ok(logs.some(line=>line.includes('[RUNTIME] stall-profile ')));
      assert.ok(!logs.some(line=>line.includes('unavailable')));
    }finally{await profiler.stop();}
  }
  process.stdout.write('completed 4 native profiler sessions\n');
})().catch(error=>{console.error(error);process.exitCode=1;});
