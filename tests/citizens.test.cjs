'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createSimulation}=require('../js/citizens.js');
function setup(){
  const state={tiles:Array.from({length:7},()=>Array.from({length:12},()=>({t:'grass',b:null})))};
  for(let x=1;x<=10;x++)state.tiles[3][x].b={type:'road'};
  state.tiles[2][1].b={id:1,type:'house',pop:6,origin:[1,2]};
  state.tiles[2][9].b={id:2,type:'farmland',staffed:true,origin:[9,2]};
  const sim=createSimulation({house:{size:1},farmland:{size:1,workers:1}});
  sim.update(state,0);return{state,sim};
}
test('citizens keep their identities, follow adjacent roads and actually commute to work and home',()=>{
  const {state,sim}=setup();let previous={...sim.collect()[0]},work=false,home=false;
  const id=previous.id;
  for(let i=0;i<1100;i++){
    sim.update(state,.1);const e=sim.collect()[0];assert.equal(e.id,id);
    assert.ok(Math.hypot(e.x-previous.x,e.y-previous.y)<=.061,'movement stays continuous at corners and route ends');
    assert.equal(e.y,3,'every segment follows the road');
    if(e.action==='work'){work=true;assert.equal(e.x,9);assert.equal(e.role,'farmer');}
    if(work&&e.action==='rest'&&e.x===1)home=true;
    previous={...e};
  }
  assert.ok(work,'resident reaches a real staffed farm');assert.ok(home,'worker returns to their own home');
});
test('pausing preserves positions and collection/camera-independent reads never resample citizens',()=>{
  const {state,sim}=setup();for(let i=0;i<80;i++)sim.update(state,.1);
  const before=sim.inspect().entities;
  for(let i=0;i<100;i++){sim.collect();sim.update(state,.1,{speed:0});}
  assert.deepEqual(sim.inspect().entities,before);
});
test('demolishing the next road reverses an in-flight edge instead of teleporting; rebuilding resumes the trip',()=>{
  const {state,sim}=setup();let e;
  for(let i=0;i<500;i++){sim.update(state,.1);e=sim.collect()[0];if(e.to&&e.edge>.4)break;}
  assert.ok(e.to);const [x,y]=e.to.split(',').map(Number);state.tiles[y][x].b=null;
  let previous={...e};
  for(let i=0;i<120;i++){sim.update(state,.1);e=sim.collect()[0];assert.ok(Math.hypot(e.x-previous.x,e.y-previous.y)<.061);previous={...e};}
  assert.equal(e.action,'blocked');assert.ok(e.x<x,'waits on the reachable side of the gap');
  state.tiles[y][x].b={type:'road'};let arrived=false;
  for(let i=0;i<700;i++){sim.update(state,.1);if(sim.collect()[0].action==='work')arrived=true;}
  assert.ok(arrived);
});
test('demolished homes retire their visual residents gradually instead of creating a replacement elsewhere',()=>{
  const {state,sim}=setup();for(let i=0;i<30;i++)sim.update(state,.1);
  state.tiles[2][1].b=null;sim.update(state,.2);assert.equal(sim.collect().length,1);
  for(let i=0;i<60;i++)sim.update(state,.1);assert.equal(sim.collect().length,0);
});

test('paused city loads and city switches initialize visible citizens without advancing them',()=>{
  const {state}=setup(),sim=createSimulation({house:{size:1},farmland:{size:1,workers:1}});
  sim.update(state,.1,{speed:0});
  assert.equal(sim.collect().length,1);
  assert.equal(sim.collect()[0].opacity,1,'a paused/visited city has visible residents immediately');
  const first=sim.inspect().entities;
  for(let i=0;i<60;i++)sim.update(state,.1,{speed:0});
  assert.deepEqual(sim.inspect().entities,first);
  const next=JSON.parse(JSON.stringify(state));next.tiles[2][1].b=null;
  next.tiles[2][2].b={id:17,type:'house',pop:12,origin:[2,2]};
  sim.update(next,.1,{speed:0});
  assert.equal(sim.collect().length,2);
  assert.ok(sim.collect().every(e=>e.id.startsWith('17:')&&e.opacity===1));
  const second=sim.inspect().entities;
  for(let i=0;i<60;i++)sim.update(next,.1,{speed:0});
  assert.deepEqual(sim.inspect().entities,second,'switching cities must not leave old citizens or move paused citizens');
});

test('idle production sends working citizens home continuously and only resumes work when the job restarts',()=>{
  const {state,sim}=setup();
  for(let i=0;i<600&&sim.collect()[0].action!=='work';i++)sim.update(state,.1);
  assert.equal(sim.collect()[0].action,'work');
  state.tiles[2][9].b.idle=true;
  let previous={...sim.collect()[0]},home=false;
  for(let i=0;i<600;i++){
    sim.update(state,.1);const e=sim.collect()[0];
    assert.ok(Math.hypot(e.x-previous.x,e.y-previous.y)<=.061);
    assert.notEqual(e.action,'work','a staffed but idle production site cannot keep citizens working');
    if(e.action==='rest'&&e.x===1)home=true;previous={...e};
  }
  assert.ok(home);
  state.tiles[2][9].b.idle=false;let resumed=false;
  for(let i=0;i<700;i++){sim.update(state,.1);if(sim.collect()[0].action==='work'){resumed=true;break;}}
  assert.ok(resumed);
  state.tiles[2][9].b.staffed=false;sim.update(state,.1);
  assert.notEqual(sim.collect()[0].action,'work','losing the assigned worker also stops the labour animation');
});

test('a demolished next road is checked immediately even just after a graph scan and near an edge endpoint',()=>{
  const {state,sim}=setup();let e;
  for(let i=0;i<900;i++){sim.update(state,.05);e=sim.collect()[0];if(e.to&&e.edge>.92)break;}
  assert.ok(e.to&&e.edge>.92);
  sim.update(state,.61,{speed:0}); // Fresh periodic graph; next regular scan is still 0.6 s away.
  const [x,y]=e.to.split(',').map(Number),before={...e};state.tiles[y][x].b=null;
  sim.update(state,.1);e=sim.collect()[0];
  assert.ok(e.x<before.x,'the very next movement frame must reverse rather than cross the removed road');
  let previous={...e};
  for(let i=0;i<120;i++){
    sim.update(state,.1);e=sim.collect()[0];
    assert.ok(Math.hypot(e.x-previous.x,e.y-previous.y)<=.061);
    assert.ok(e.x<x,'cannot advance onto the demolished road before the next graph scan');previous={...e};
  }
  assert.equal(e.action,'blocked');
});

test('unreachable jobs are rejected by road component without repeated full-map searches, and a new bridge reconnects them',()=>{
  const state={tiles:Array.from({length:64},()=>Array.from({length:64},(_,x)=>({t:'grass',b:x<31||x>33?{type:'road'}:null})))};
  for(let i=0;i<20;i++)state.tiles[i+5][5].b={id:i+1,type:'house',pop:18,lvl:4,origin:[5,i+5]};
  for(let i=0;i<12;i++){
    const b={id:i+100,type:'farmland',origin:[40,3+i*4],staffed:true};
    for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++)state.tiles[3+i*4+dy][40+dx].b=b;
  }
  const sim=createSimulation({house:{size:1},farmland:{size:2,workers:3}});sim.update(state,0);
  for(let i=0;i<600;i++)sim.update(state,1/60);
  assert.equal(sim.collect().length,60);
  assert.equal(sim.inspect().pathSearches,0,'disconnected commute attempts must not each run a full BFS');
  assert.equal(sim.findPath('5,3',['40,2']),null);
  for(let x=31;x<=33;x++)state.tiles[30][x].b={type:'road'};
  sim.update(state,.7,{speed:0});
  const route=sim.findPath('5,3',['40,2']);
  assert.ok(Array.isArray(route)&&route.length>1);
  assert.equal(sim.inspect().pathSearches,1);
});
