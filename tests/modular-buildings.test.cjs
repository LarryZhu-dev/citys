'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

function load(){
  const window={},canvas={getContext:()=>({})};const context=vm.createContext({window,console,Math,Map,Set,Object,Promise,document:{querySelector:()=>canvas}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/data.js'),'utf8'),context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/modular-buildings.js'),'utf8'),context);
  return {api:window.ModularBuildings,context,types:vm.runInContext("Object.entries(BUILD).filter(([key,b])=>key!=='road'&&(!b.civilization||b.civilization==='china')).map(([key,b])=>({key,size:b.size}))",context)};
}
function drawing(){
  const values=[];const gradient={addColorStop(){}};
  const ctx=new Proxy({globalAlpha:1,getTransform:()=>({a:1,b:0,c:0,d:1}),createLinearGradient:()=>gradient,createRadialGradient:()=>gradient},
    {get(target,key){if(key in target)return target[key];return (...args)=>{for(const value of args)if(typeof value==='number'){assert.ok(Number.isFinite(value),`${String(key)} got a non-finite coordinate`);values.push(value);}};},set(target,key,value){target[key]=value;return true;}});
  return {ctx,values};
}

test('all applicable Chinese types have distinct structural recipes on their real footprints',()=>{
  const {api,types}=load();assert.equal(api.supportedTypes.length,types.length);
  const signatures=new Set();
  for(const {key,size}of types){
    const plan=api.recipe(key,1);assert.equal(plan.size,size,key);assert.ok(plan.parts.length>0,key);
    assert.equal(new Set(plan.parts.map(p=>p.id)).size,plan.parts.length,`${key}: component identifiers must be unique`);
    assert.ok(!signatures.has(plan.signature),`${key}: recipe must not alias another building`);signatures.add(plan.signature);
    const bounds=api.measure({type:key,width:size*84,height:size*42});
    assert.ok(bounds.width>=size*84&&bounds.height>size*42,key);
  }
  assert.equal(api.inspect({type:'house',civ:'egypt'}).supported,false);
  assert.equal(api.recipe('sphinx'),null);
});

test('construction is monotonic, with posts and rafters before tile strips',()=>{
  const {api}=load();
  for(const type of['house','well','temple','market','pottery','pagoda']){
    let previous=new Set();
    for(let step=0;step<=100;step++){
      const info=api.inspect({type,civ:'china',construction:step===100?null:{total:100,remaining:100-step}}),now=new Set(info.parts.map(p=>p.id));
      for(const id of previous)assert.ok(now.has(id),`${type} lost ${id} during construction`);
      if(step<55)assert.equal(info.parts.some(p=>p.id.includes('rafter')),false);
      if(step<71)assert.equal(info.parts.some(p=>p.id.includes('-roof-south')),false);
      previous=now;
    }
    assert.equal(previous.size,api.recipe(type).parts.length);
  }
});

test('every residence level adds visible modules and upgrading preserves all existing components',()=>{
  const {api}=load();
  for(const [type,max]of[['house',10],['villa',6]])for(let level=2;level<=max;level++){
    const old=api.recipe(type,level-1),next=api.recipe(type,level),ids=new Set(next.parts.map(p=>p.id));
    assert.notEqual(next.signature,old.signature);assert.ok(next.parts.length>old.parts.length);
    for(const part of old.parts)assert.ok(ids.has(part.id),`${type} ${level} removes ${part.id}`);
    const start=api.inspect({type,level:level-1,construction:{total:100,remaining:100,fromLevel:level-1,toLevel:level}});
    assert.equal(start.parts.length,old.parts.length);
    assert.ok(start.parts.every(p=>p.retained&&p.progress===1));
    const middle=api.inspect({type,level:level-1,construction:{total:100,remaining:50,fromLevel:level-1,toLevel:level}});
    assert.ok(middle.parts.filter(p=>p.retained).every(p=>p.progress===1));
  }
});

test('ground surfaces paint below rear halls and elevated storeys remain in their own painter group',()=>{
  const {api}=load();
  for(const type of['temple','market','well','pottery','wonder']){
    const parts=api.recipe(type).parts,lastGround=Math.max(...parts.map((p,i)=>p.ground?i:-1)),firstStructure=parts.findIndex(p=>!p.ground);
    assert.ok(lastGround<firstStructure,`${type}: foreground ground must not cover a rear structure`);
  }
  const upper=api.recipe('house',6).parts.find(p=>p.id==='upper-hall-plinth');
  assert.equal(!!upper.ground,false);
  const farm=api.recipe('farmland');assert.equal(farm.parts.find(p=>p.id==='site').material,null);
  assert.ok(farm.parts.some(p=>p.id.startsWith('soil-bed')),'crops need real soil beds, not wooden platforms');
});

test('production state controls machinery and crop progress follows successful simulation ticks only',()=>{
  const {api}=load();
  const running={staffed:true,idle:false,damage:0,productionTicks:17};
  assert.equal(api.inspect({type:'kiln',building:running}).active,true);
  for(const change of[{staffed:false},{idle:true},{damage:1},{construction:{total:8,remaining:3}}])assert.equal(api.inspect({type:'kiln',building:{...running,...change}}).active,false);
  const first=api.inspect({type:'farmland',building:running,time:1}),later=api.inspect({type:'farmland',building:{...running,idle:true},time:1000});
  assert.equal(first.growthStage,5);assert.equal(later.growthStage,5);
  assert.equal(api.inspect({type:'farmland',building:{...running,productionTicks:24}}).growthStage,0);
});

test('all recipes render finite geometry and night furnace light stops with production',()=>{
  const {api,types}=load();
  for(const {key,size}of types){
    const {ctx,values}=drawing();const result=api.draw(ctx,{type:key,civ:'china',level:key==='house'?10:key==='villa'?6:1,width:size*84,height:size*42,cx:140,cy:160,night:.8,time:3,building:{staffed:true,idle:false,productionTicks:10,pop:15}});
    assert.equal(result.modular,true,key);assert.ok(values.length>10,key);
    for(const light of result.lights)assert.ok(Number.isFinite(light.x)&&Number.isFinite(light.y)&&light.r>0,key);
  }
  const {ctx}=drawing();
  assert.ok(api.draw(ctx,{type:'kiln',night:.8,building:{staffed:true,idle:false}}).lights.length>0);
  assert.equal(api.draw(ctx,{type:'kiln',night:.8,building:{staffed:true,idle:true}}).lights.length,0);
  assert.equal(api.draw(ctx,{type:'house',civ:'greece'}),false);
});


test('roof strips share continuous source UVs instead of repeating a whole roof texture',()=>{
  const {api}=load();
  for(const type of['house','temple','market','pagoda']){
    const groups=new Map();
    for(const part of api.recipe(type).parts){
      const match=part.id.match(/^(.*-roof-(?:south|north)-)(\d+)$/);if(!match)continue;
      if(!groups.has(match[1]))groups.set(match[1],[]);groups.get(match[1]).push(part);
    }
    assert.ok(groups.size>0,type);
    for(const parts of groups.values()){
      parts.sort((a,b)=>a.uv[0]-b.uv[0]);let end=0;
      for(const part of parts){assert.ok(Math.abs(part.uv[0]-end)<1e-9);assert.ok(part.uv[2]<.3);assert.ok(part.textureAlpha<.7);end+=part.uv[2];}
      assert.ok(Math.abs(end-1)<1e-9,`${type}: one complete image per roof slope`);
    }
  }
});

test('garden and orchard trees use the same generated terrain components as the landscape',()=>{
  const {api,context}=load(),calls=[];
  context.window.GameArt={drawTerrain(...args){calls.push(args);return true;}};
  const {ctx}=drawing();api.draw(ctx,{type:'orchard',building:{productionTicks:10}});
  assert.equal(calls.length,9);assert.ok(calls.every(args=>args[1]==='tree'&&args[4]>0));
});


test('hip-roof framing stays inside the ridge and rear brackets are occluded by roof tiles',()=>{
 const {api}=load(),plan=api.recipe('temple');
 const m=plan.modules.find(m=>m.id==='sanctuary'),hip=Math.min(m.w*.24,m.d*.28);
 for(const part of plan.parts.filter(p=>p.id.includes('-rafterN-')))assert.ok(part.b[0]>=m.x+hip&&part.b[0]<=m.x+m.w-hip);
 assert.ok(plan.parts.filter(p=>p.material==='dougong').every(p=>p.phase<4));
 const {ctx}=drawing(),render=api.draw(ctx,{type:'house',night:1,building:{pop:12}});
 assert.ok(render.lights.every(p=>p.masked),'architectural emission is already painted on real windows, never floating light rectangles');
});


test('moonlight is baked once per night cache band without changing alpha or precision',()=>{
  const {api,context}=load(),writes=[],canvases=[];
  context.document.createElement=()=>{
    const {ctx}=drawing();ctx.getImageData=()=>({data:new Uint8ClampedArray([100,150,200,80,90,120,160,255,1,2,3,0])});
    ctx.putImageData=image=>writes.push(Array.from(image.data));
    const canvas={width:0,height:0,getContext:()=>ctx};canvases.push(canvas);return canvas;
  };
  const {ctx}=drawing();ctx.getTransform=()=>({a:4,b:0,c:0,d:4});
  api.draw(ctx,{type:'farmland',night:1});
  assert.deepEqual(writes[0],[73,120,178,80,66,96,143,255,1,2,3,0]);
  assert.ok(canvases[0].width>=api.measure({type:'farmland'}).width*4,'DPR × zoom resolution stays intact');
  api.draw(ctx,{type:'farmland',night:.98});assert.equal(writes.length,1,'same quantized night reuses pixels');
  api.draw(ctx,{type:'farmland',night:0});assert.equal(writes.length,1,'day entries require no readback');
});

test('construction carpenter uses generated citizen rig and freezes when construction is idle',()=>{
  const {api,context}=load(),calls=[];context.window.Citizens={draw(...args){calls.push(args);}};
  const {ctx}=drawing(),building={id:32,construction:{total:100,remaining:50},idle:false};
  api.draw(ctx,{type:'house',building,time:3,night:.5});
  assert.equal(calls[0][1].role,'builder');assert.equal(calls[0][1].action,'work');assert.equal(calls[0][1].phase,12);assert.equal(calls[0][4],3000);assert.equal(calls[0][5].night,.5);
  api.draw(ctx,{type:'house',building:{...building,idle:true},time:30});
  assert.equal(calls[1][1].action,'rest');assert.equal(calls[1][1].phase,0);
});
