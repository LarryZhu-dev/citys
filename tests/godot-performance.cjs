'use strict';
// Measures the actual shipped PCK, with no profiling replacement or hidden layer
// switches. Software-GPU results are diagnostic evidence, not phone FPS.
const fs=require('node:fs'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {createServer}=require('../server/index.cjs');
const dir=process.env.PERFORMANCE_OUTPUT||'work/component-performance';
const gpuBackend=process.env.CHROMIUM_ANGLE_BACKEND||'swiftshader';
assert(['swiftshader','gl'].includes(gpuBackend),'Use swiftshader or gl; the latter requires an X display');
fs.mkdirSync(dir,{recursive:true});
const fixture=JSON.parse(fs.readFileSync('examples/completed-city.json','utf8'));
(async()=>{
 const server=createServer({env:{DATA_FILE:dir+'/online.json'}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:gpuBackend!=='gl',args:['--no-sandbox','--use-gl=angle','--use-angle='+gpuBackend,'--enable-unsafe-swiftshader','--disable-dev-shm-usage',...(gpuBackend==='gl'?['--ignore-gpu-blocklist']:[])]});
 const errors=[],report={fixture:'examples/completed-city.json',artifact:JSON.parse(fs.readFileSync('engine-web/manifest.json')),requestedBackend:gpuBackend,viewport:{width:1440,height:900,dpr:1},stages:[],errors};
 try{
  const cdp=await browser.newBrowserCDPSession();report.gpu=(await cdp.send('SystemInfo.getInfo')).gpu;report.browser=await browser.version();
  const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1,hasTouch:true});
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(/SCRIPT ERROR:|Parse Error:|USER ERROR:/.test(m.text()))errors.push(m.text());});
  await page.addInitScript(st=>{
   st.clock.lastWallMs=Date.now();localStorage.setItem('empire-new-era-v1',JSON.stringify(st));
   let previous=0,frames=[],tasks=[];
   window.frameProbe={begin(){previous=0;frames=[];tasks=[];this.start=performance.now();},read(){return{frames,tasks,elapsed:performance.now()-this.start,metrics:window.godotMetrics};}};
   requestAnimationFrame(function tick(t){if(previous)frames.push(t-previous);previous=t;requestAnimationFrame(tick);});
   new PerformanceObserver(entries=>{for(const entry of entries.getEntries())tasks.push(entry.duration);}).observe({type:'longtask'});
  },fixture);
  const start=Date.now();await page.goto('http://127.0.0.1:'+server.address().port);
  await page.waitForFunction(()=>window.godotReady===true,null,{timeout:120000});report.readyMs=Date.now()-start;
  async function stage(name,mode,action){
   await page.evaluate(mode=>{setSpeed(mode==='paused'?0:1);CityBridge.dispatch('night',{mode:mode==='night'?'night':'day'});},mode);
   await page.waitForTimeout(2200);await page.evaluate(()=>frameProbe.begin());
   if(action)await action();
   await page.waitForTimeout(6000);
   const raw=await page.evaluate(()=>frameProbe.read()),values=raw.frames.slice().sort((a,b)=>a-b),percentile=q=>values[Math.floor((values.length-1)*q)]||0;
   const result={name,seconds:raw.elapsed/1000,frames:values.length,fps:values.length/(raw.elapsed/1000),p95:percentile(.95),max:percentile(1),longTasks:raw.tasks.length,metrics:raw.metrics};
   report.stages.push(result);console.log(JSON.stringify({name,fps:result.fps,p95:result.p95,nodes:raw.metrics?.nodes,drawCalls:raw.metrics?.draw_calls,renderObjects:raw.metrics?.render_objects}));
   await page.screenshot({path:dir+'/'+name+'.png'});
  }
  await stage('dense-day','day');
  await stage('dense-night','night');
  await stage('dense-drag','day',async()=>{
   await page.mouse.move(700,440);await page.mouse.down();
   for(let i=1;i<=12;i++)await page.mouse.move(700+Math.sin(i/12*Math.PI)*260,440-i*5);
   await page.mouse.up();
  });
  await stage('dense-paused','paused');
  assert.deepEqual(errors,[]);
  fs.writeFileSync(dir+'/report.json',JSON.stringify(report,null,2));
  // A hardware-independent submission budget for this fixed city catches a
  // regression to one non-batchable draw call per architectural leaf. Do not
  // impose an FPS threshold on the software GPU used by this environment.
  for(const stage of report.stages)assert(stage.metrics.draw_calls>0&&stage.metrics.draw_calls<=1200,`${stage.name}: ${stage.metrics.draw_calls} draw calls exceed the fixed-city budget`);
 }finally{await browser.close();await new Promise(r=>server.close(r));await server.app.store.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
