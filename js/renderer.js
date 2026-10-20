/* The map is drawn in three passes: ground, depth-sorted objects, then light.
   An n×n building is centred at (x, y)+(n-1)/2 on BOTH tile axes. */
let view = { ox:0, oy:0, zoom:1 };
const FONT = '"Noto Sans SC","PingFang SC",system-ui,sans-serif';
const rendererSettings = window.rendererSettings = {
  night:'auto', overlay:'none', reducedMotion:window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || false,
  grid:false,
};
let renderClock=0, lastRenderFrame=0, renderState=null, rendererEpoch=0;
let rendererBounds=null, rendererLights=[], rendererMasks=[], rendererNight=0;
const emissionMaskCache=new Map(),terrainTextureCache=new Map(),terrainTextureMiss=new Map(),groundTileCache=new Map();
let minimapCache=null, minimapStamp=0, minimapState=null, overlayCache=null;
let nightGlow=null;
const terrainChunkCache=new Map();
let terrainViewportSurface=null,terrainViewportKey='';
let terrainCacheState=null,terrainCacheCiv='',terrainSeed=1,terrainCacheBytes=0;
const rendererStats=window.rendererStats={visibleTiles:0,visibleBuildings:0,frameMs:0};

function tileToScreen(x,y){ return {sx:(x-y)*TILE_W/2,sy:(x+y)*TILE_H/2}; }
function screenToTile(px,py){
  const sx=(px-view.ox)/view.zoom, sy=(py-view.oy)/view.zoom;
  return {x:Math.floor((sx/(TILE_W/2)+sy/(TILE_H/2))/2+.5),y:Math.floor((sy/(TILE_H/2)-sx/(TILE_W/2))/2+.5)};
}
function invalidateRenderer(){ rendererEpoch++; overlayCache=null; minimapStamp=0; terrainTextureMiss.clear(); groundTileCache.clear(); }
window.invalidateRenderer=invalidateRenderer;
function resizeCanvas(){
  const r=cv.parentElement.getBoundingClientRect();
  if(r.width<2 || r.height<2){ requestAnimationFrame(resizeCanvas); return; }
  const oldW=Number(cv.dataset.cssWidth)||0,oldH=Number(cv.dataset.cssHeight)||0;
  const dpr=Math.min(2,window.devicePixelRatio||1);
  cv.width=Math.round(r.width*dpr); cv.height=Math.round(r.height*dpr);
  cv.dataset.cssWidth=r.width;cv.dataset.cssHeight=r.height;
  if(!oldW || !renderState) centerOnCity();
  else {view.ox+=(r.width-oldW)/2;view.oy+=(r.height-oldH)/2;clampView(r);}
}
function cameraInsets(r){const supplied=window.gameViewportInsets?.();if(supplied)return{top:Math.max(0,supplied.top-cv.getBoundingClientRect().top),bottom:Math.max(0,supplied.bottom)};return{top:36,bottom:72};}
function cameraUsableHeight(r){const insets=cameraInsets(r);return Math.max(180,r.height-insets.top-insets.bottom);}
function cameraCenterY(r){return cameraInsets(r).top+cameraUsableHeight(r)*.52;}
function centerOnTile(x,y,zoom){
  const r=cv.getBoundingClientRect();
  const p=tileToScreen(Math.max(0,Math.min(MAP_W-1,x)),Math.max(0,Math.min(MAP_H-1,y)));
  if(Number.isFinite(zoom))view.zoom=Math.max(.25,Math.min(2.5,zoom));
  view.ox=r.width/2-p.sx*view.zoom;view.oy=cameraCenterY(r)-p.sy*view.zoom;clampView(r);
}
function centerOnCity(){
  if(!S){centerOnTile(MAP_W/2,MAP_H/2,1);return;}
  let points=[],homePoints=[];
  for(let y=0;y<MAP_H;y++)for(let x=0;x<MAP_W;x++){
    const b=S.tiles[y]?.[x]?.b;
    if(b&&b.type!=='road'&&(!b.origin||(b.origin[0]===x&&b.origin[1]===y))){
      const z=(BUILD[b.type]?.size||1)-1,point=tileToScreen(x+z/2,y+z/2);points.push(point);if(isResidence(b))homePoints.push(point);
    }
  }
  if(!points.length){centerOnTile(S.start?.x??MAP_W/2,S.start?.y??MAP_H/2,1);return;}
  const r=cv.getBoundingClientRect();
  if(r.width<=720&&homePoints.length){points=homePoints;const px=points.reduce((sum,p)=>sum+p.sx,0)/points.length,py=points.reduce((sum,p)=>sum+p.sy,0)/points.length;view.zoom=Math.max(.9,Math.min(1.05,r.width/410));view.ox=r.width/2-px*view.zoom;view.oy=cameraCenterY(r)-py*view.zoom;clampView(r);return;}
  const minX=Math.min(...points.map(p=>p.sx)),maxX=Math.max(...points.map(p=>p.sx));
  const minY=Math.min(...points.map(p=>p.sy))-100,maxY=Math.max(...points.map(p=>p.sy))+70;
  view.zoom=Math.max(.55,Math.min(1.1,(r.width-130)/(maxX-minX+TILE_W*3),(cameraUsableHeight(r)-40)/(maxY-minY+TILE_H*3)));
  view.ox=r.width/2-(minX+maxX)/2*view.zoom;
  view.oy=cameraCenterY(r)-(minY+maxY)/2*view.zoom;clampView(r);
}
function fitView(){
  const r=cv.getBoundingClientRect();
  view.zoom=Math.max(.12,Math.min((r.width-60)/(MAP_W*TILE_W),(r.height-80)/(MAP_H*TILE_H)));
  const p=tileToScreen((MAP_W-1)/2,(MAP_H-1)/2);
  view.ox=r.width/2-p.sx*view.zoom;view.oy=r.height/2-p.sy*view.zoom;
}
function clampView(r=cv.getBoundingClientRect()){
  const margin=Math.min(140,r.width/3),z=view.zoom;
  const minX=-(MAP_H-1)*TILE_W/2*z,maxX=(MAP_W-1)*TILE_W/2*z;
  const minY=-TILE_H/2*z,maxY=(MAP_W+MAP_H-1)*TILE_H/2*z;
  if(maxX+view.ox<margin)view.ox=margin-maxX;
  if(minX+view.ox>r.width-margin)view.ox=r.width-margin-minX;
  if(maxY+view.oy<margin)view.oy=margin-maxY;
  if(minY+view.oy>r.height-margin)view.oy=r.height-margin-minY;
}
function setDayMode(mode){if(['auto','day','night'].includes(mode))rendererSettings.night=mode;}
window.centerOnCity=centerOnCity;window.centerOnTile=centerOnTile;window.setDayMode=setDayMode;
function hash2(x,y){const n=Math.sin(x*127.1+y*311.7)*43758.5453;return n-Math.floor(n);}
function currentCivilization(){return S?.civilization||S?.civ||'china';}
function drawDiamond(cx,cy,w,h){
  ctx.beginPath();ctx.moveTo(cx,cy-h/2);ctx.lineTo(cx+w/2,cy);ctx.lineTo(cx,cy+h/2);ctx.lineTo(cx-w/2,cy);ctx.closePath();
}
function polygon(points,fill,stroke){ctx.beginPath();for(let i=0;i<points.length;i++)ctx[i?'lineTo':'moveTo'](...points[i]);ctx.closePath();if(fill){ctx.fillStyle=fill;ctx.fill();}if(stroke){ctx.strokeStyle=stroke;ctx.stroke();}}
function getVisibleBounds(r){
  const m=7,corners=[screenToTile(-TILE_W*3,-TILE_H*6),screenToTile(r.width+TILE_W*3,-TILE_H*6),screenToTile(0,r.height+TILE_H*5),screenToTile(r.width,r.height+TILE_H*5)];
  return {x0:Math.max(0,Math.min(...corners.map(p=>p.x))-m),x1:Math.min(MAP_W-1,Math.max(...corners.map(p=>p.x))+m),y0:Math.max(0,Math.min(...corners.map(p=>p.y))-m),y1:Math.min(MAP_H-1,Math.max(...corners.map(p=>p.y))+m)};
}
function inViewport(sx,sy,padX=100,padY=160){return sx>rendererBounds.left-padX&&sx<rendererBounds.right+padX&&sy>rendererBounds.top-padY&&sy<rendererBounds.bottom+padY;}
function getNightAmount(){
  if(rendererSettings.night==='night')return 1;if(rendererSettings.night==='day')return 0;
  const phase=((S?.tick||0)%480)/480;
  return Math.max(0,Math.min(1,(Math.cos((phase-.75)*Math.PI*2)-.15)*1.2));
}
function render(){
  const started=performance.now(),r=cv.getBoundingClientRect(),dpr=Math.min(2,window.devicePixelRatio||1);
  ctx.setTransform(dpr,0,0,dpr,0,0);ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.clearRect(0,0,r.width,r.height);
  const bg=ctx.createLinearGradient(0,0,r.width,r.height);bg.addColorStop(0,'#243e37');bg.addColorStop(1,'#101f20');ctx.fillStyle=bg;ctx.fillRect(0,0,r.width,r.height);
  if(!S)return;
  if(renderState!==S){renderState=S;invalidateRenderer();centerOnCity();}
  const delta=lastRenderFrame?Math.min(80,started-lastRenderFrame):0;lastRenderFrame=started;
  if(speed>0&&!rendererSettings.reducedMotion)renderClock+=delta*Math.min(speed,2);
  window.Citizens?.update?.(S,delta/1000,{speed,reducedMotion:rendererSettings.reducedMotion});
  rendererBounds={left:-view.ox/view.zoom,right:(r.width-view.ox)/view.zoom,top:-view.oy/view.zoom,bottom:(r.height-view.oy)/view.zoom};
  rendererLights=[];rendererMasks=[];rendererNight=getNightAmount();
  ctx.save();ctx.translate(view.ox,view.oy);ctx.scale(view.zoom,view.zoom);
  drawMapEdge();drawContinuousTerrain();
  const bounds=getVisibleBounds(r),objects=[],roads=[];let tileCount=0;
  for(let sum=bounds.x0+bounds.y0;sum<=bounds.x1+bounds.y1;sum++)for(let x=bounds.x0;x<=bounds.x1;x++){
    const y=sum-x;if(y<bounds.y0||y>bounds.y1)continue;
    const tile=S.tiles[y]?.[x];if(!tile)continue;
    const p=tileToScreen(x,y),b=tile.b;
    if(inViewport(p.sx,p.sy,TILE_W,TILE_H)){drawTileGround(x,y,tile,p);tileCount++;if(b?.type==='road')roads.push({x,y,p});}
    if(b&&b.type!=='road'){
      if(!b.origin||(b.origin[0]===x&&b.origin[1]===y)){
        const size=BUILD[b.type]?.size||1,cy=p.sy+(size-1)*TILE_H/2;
        if(inViewport(p.sx,cy,size*TILE_W,size*TILE_W+160))objects.push({kind:'building',x,y,b,depth:x+y+size-1});
      }
    }else if(!b&&['tree','stone','clay','copper'].includes(tile.t)&&inViewport(p.sx,p.sy,140,180))collectNaturalObjects(objects,x,y,tile.t);
    if(!b&&tile.t!=='water'&&hash2(x+27,y+39)>.68){const waterSide=DIRS.find(([dx,dy])=>tileAt(x+dx,y+dy)?.t==='water');if(waterSide){const tx=x+waterSide[0]*.3+(hash2(x+81,y)-.5)*.4,ty=y+waterSide[1]*.3+(hash2(x,y+77)-.5)*.4,q=tileToScreen(tx,ty);if(inViewport(q.sx,q.sy,40,50))objects.push({kind:'reeds',x:tx,y:ty,p:q,depth:tx+ty+.05});}}
  }
  drawRoadNetwork(roads);
  drawOverlay();drawCoverage();drawSelectionGround();drawRoadPreview();
  if(view.zoom>.3)collectCitizens(objects);
  objects.sort((a,b)=>a.depth-b.depth||a.x-b.x);
  for(const o of objects){if(o.kind==='person'){window.Citizens?.draw?.(ctx,o.entity,o.px,o.py,renderClock,{night:rendererNight,zoom:view.zoom,reducedMotion:rendererSettings.reducedMotion});continue;}if(o.kind==='reeds'){window.GameArt?.drawTerrain?.(ctx,'reeds',o.p.sx,o.p.sy,17+hash2(o.x,o.y)*12,0,0,rendererNight);continue;}if(o.kind==='building')drawBuilding(o.x,o.y,o.b);else if(o.kind==='tree')drawTree(o.p.sx,o.p.sy,o.x,o.y);else if(o.kind==='stone'||o.kind==='copper')drawRock(o.p.sx,o.p.sy,o.x,o.y,o.kind==='copper',o.natural);else drawClay(o.p.sx,o.p.sy,o.x,o.y,o.natural);}
  drawHover();
  ctx.restore();
  drawAtmosphere(r);
  drawMinimap();
  rendererStats.visibleTiles=tileCount;rendererStats.visibleBuildings=objects.filter(o=>o.kind==='building').length;rendererStats.visibleCitizens=objects.filter(o=>o.kind==='person').length;rendererStats.visibleNatural=objects.filter(o=>!['building','person'].includes(o.kind)).length;rendererStats.frameMs=Math.round((performance.now()-started)*10)/10;
}
function drawMapEdge(){
  const p=tileToScreen((MAP_W-1)/2,(MAP_H-1)/2),w=MAP_W*TILE_W,h=MAP_H*TILE_H;
  drawDiamond(p.sx,p.sy+14,w,h);ctx.fillStyle='#263a2d';ctx.fill();
  drawDiamond(p.sx,p.sy+6,w,h);ctx.fillStyle='#5b6746';ctx.fill();
}
const TERRAIN_FILL={grass:['#81966a','#809569','#83976c','#7f9469'],sand:['#c8bb8d','#c5b587','#cdbc96'],tree:['#7e9468','#7f956a'],stone:['#8e957a','#879071'],clay:['#ab9a70','#b19e78'],copper:['#a79771','#a3916b'],water:['#4c8c91','#4c9095','#508e95'],shore:['#beb68b','#c3bc94']};
function drawTileGround(x,y,t,p){
  if(t.t==='water')drawWater(x,y,p);
  if(rendererSettings.grid||selTool){drawDiamond(p.sx,p.sy,TILE_W,TILE_H);ctx.strokeStyle='rgba(38,60,38,.12)';ctx.lineWidth=.6;ctx.stroke();}
}
function rendererTerrainHash(x,y,seed=terrainSeed){let n=Math.imul(x|0,374761393)^Math.imul(y|0,668265263)^seed;n=Math.imul(n^(n>>>13),1274126177);return((n^(n>>>16))>>>0)/4294967295;}
function rendererTerrainNoise(x,y){const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy,u=fx*fx*(3-2*fx),v=fy*fy*(3-2*fy),a=rendererTerrainHash(ix,iy),b=rendererTerrainHash(ix+1,iy),c=rendererTerrainHash(ix,iy+1),d=rendererTerrainHash(ix+1,iy+1);return(a+(b-a)*u)*(1-v)+(c+(d-c)*u)*v;}
function getTerrainVisual(x,y){
  if(typeof terrainVisualAt==='function')return terrainVisualAt(x,y,S.seed);
  return{groundBlend:Math.max(0,(rendererTerrainNoise(x*.12,y*.12)-.5)*1.2),moisture:rendererTerrainNoise(x*.07+10,y*.07),detail:rendererTerrainHash(x,y),offsetX:rendererTerrainHash(x,y)-.5,offsetY:rendererTerrainHash(x+17,y+23)-.5,scale:.75+rendererTerrainHash(x+3,y+19)*.5};
}
function smoothRange(a,b,value){const t=Math.max(0,Math.min(1,(value-a)/(b-a)));return t*t*(3-2*t);}
function terrainTypeWeight(x,y,type){
  const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy;
  const value=(tx,ty)=>S.tiles[Math.max(0,Math.min(MAP_H-1,ty))]?.[Math.max(0,Math.min(MAP_W-1,tx))]?.t===type?1:0;
  return(value(ix,iy)*(1-fx)+value(ix+1,iy)*fx)*(1-fy)+(value(ix,iy+1)*(1-fx)+value(ix+1,iy+1)*fx)*fy;
}
function groundFieldAt(wx,wy){
  const x=wx/TILE_W+wy/TILE_H,y=wy/TILE_H-wx/TILE_W,field=getTerrainVisual(x,y),fine=rendererTerrainNoise(x*1.37+11,y*1.37-5),civ=currentCivilization();
  const sand=terrainTypeWeight(x,y,'sand'),water=terrainTypeWeight(x,y,'water'),shoreNoise=(fine-.5)*.12;
  let blend=Math.max(0,Math.min(.88,smoothRange(.25,.49,field.groundBlend+(fine-.5)*.13)*.76+sand*.72));
  const grass=civ==='egypt'?[137,153,91]:civ==='persia'?[123,145,88]:civ==='aztec'?[89,126,73]:[101,147,75];
  const soil=civ==='egypt'?[198,176,118]:[177,155,105],variation=(fine-.5)*14+(field.moisture-.5)*15;
  let r=grass[0]+(soil[0]-grass[0])*blend+variation,g=grass[1]+(soil[1]-grass[1])*blend+variation,b=grass[2]+(soil[2]-grass[2])*blend+variation*.7;
  // Preserve the continuous water field until rasterization. Interpolating
  // already-coloured shoreline samples made visible eight-pixel stair steps.
  const edge=water+shoreNoise+(rendererTerrainNoise(x*4.7-19,y*4.7+9)-.5)*.025;
  return[r,g,b,edge,water];
}
function createTerrainChunk(cx,cy,tier){
  const size=256,padding=2,worldX=cx*size-padding,worldY=cy*size-padding,total=size+padding*2,step=4,n=Math.ceil(total/step)+1;
  const field=new Float32Array(n*n*5);
  for(let gy=0;gy<n;gy++)for(let gx=0;gx<n;gx++){const color=groundFieldAt(worldX+gx*step,worldY+gy*step),i=(gy*n+gx)*5;for(let ch=0;ch<5;ch++)field[i+ch]=color[ch];}
  const canvas=document.createElement('canvas');canvas.width=canvas.height=total*tier;const dc=canvas.getContext('2d'),pixels=dc.createImageData(canvas.width,canvas.height),data=pixels.data;
  for(let py=0;py<canvas.height;py++)for(let px=0;px<canvas.width;px++){
    const fx=px/tier/step,fy=py/tier/step,ix=Math.floor(fx),iy=Math.floor(fy),u=fx-ix,v=fy-iy,a=(iy*n+ix)*5,b=a+5,c=a+n*5,d=c+5,i=(py*canvas.width+px)*4;
    const edge=(field[a+3]*(1-u)+field[b+3]*u)*(1-v)+(field[c+3]*(1-u)+field[d+3]*u)*v,water=(field[a+4]*(1-u)+field[b+4]*u)*(1-v)+(field[c+4]*(1-u)+field[d+4]*u)*v;
    const grain=(rendererTerrainHash(Math.floor(worldX*tier+px),Math.floor(worldY*tier+py))-.5)*11;
    const fleck=(rendererTerrainHash(Math.floor((worldX+px/tier)/1.7),Math.floor((worldY+py/tier)/.85))-.5)*6;
    const bank=smoothRange(.414,.447,edge)*(1-smoothRange(.476,.487,edge)),flow=smoothRange(.481,.493,edge),deep=smoothRange(.56,1,water);
    for(let ch=0;ch<3;ch++){
      let color=(field[a+ch]*(1-u)+field[b+ch]*u)*(1-v)+(field[c+ch]*(1-u)+field[d+ch]*u)*v;
      color+=((ch===0?160:ch===1?151:104)-color)*bank;
      color+=((ch===0?38-deep*11:ch===1?141-deep*24:149-deep*15)-color)*flow;
      data[i+ch]=color+grain*(1-flow*.6)+fleck*(1-flow);
    }
    data[i+3]=255;
  }
  dc.putImageData(pixels,0,0);
  // Tiny irregular blade clusters belong to world space, not the tile lattice.
  // Their high-frequency texture breaks up the broad meadow colour fields.
  dc.setTransform(tier,0,0,tier,0,0);dc.lineWidth=.45;
  for(let i=0;i<340;i++){
    const x=rendererTerrainHash(cx*911+i,cy*73+7)*size+padding,y=rendererTerrainHash(cx*311+i,cy*47+19)*size+padding;
    const wx=worldX+x,wy=worldY+y,tx=wx/TILE_W+wy/TILE_H,ty=wy/TILE_H-wx/TILE_W;if(terrainTypeWeight(tx,ty,'water')>.36)continue;
    const f=rendererTerrainHash(cx*47+i,cy*17);dc.strokeStyle=f>.5?'rgba(193,203,116,.24)':'rgba(43,88,40,.19)';
    dc.beginPath();dc.moveTo(x-1.3,y+.4);dc.lineTo(x-.4,y-1.3-f);dc.moveTo(x,y);dc.lineTo(x+1.2,y-.9-f*1.6);dc.stroke();
  }
  const chunk={canvas,x:worldX,y:worldY,size:total,bytes:canvas.width*canvas.height*4};
  // Retain immutable pixels and release the temporary raster canvas once the
  // browser has made the image. Evicted chunks also release their image data.
  if(typeof createImageBitmap==='function')createImageBitmap(canvas).then(bitmap=>{if(chunk.disposed){bitmap.close();return;}chunk.bitmap=bitmap;canvas.width=canvas.height=1;}).catch(()=>{});
  return chunk;
}
function drawContinuousTerrain(){
  const civ=currentCivilization();
  if(terrainCacheState!==S||terrainCacheCiv!==civ){
    for(const old of terrainChunkCache.values()){old.disposed=true;old.bitmap?.close();}
    terrainChunkCache.clear();terrainCacheBytes=0;terrainViewportKey='';terrainCacheState=S;terrainCacheCiv=civ;
    terrainSeed=Array.from(String(S.seed||'dawn')).reduce((n,c)=>Math.imul(n^c.charCodeAt(0),16777619),2166136261)>>>0;
  }
  const dpr=Math.min(2,devicePixelRatio||1),rasterScale=view.zoom*dpr,tier=Math.max(1,Math.ceil(rasterScale*2)/2),size=256;
  const terrainNight=Math.round(rendererNight*20)/20,key=[view.ox,view.oy,view.zoom,cv.width,cv.height,civ,terrainNight].join(':');
  if(!terrainViewportSurface)terrainViewportSurface=document.createElement('canvas');
  if(terrainViewportKey!==key){
    terrainViewportKey=key;
    if(terrainViewportSurface.width!==cv.width||terrainViewportSurface.height!==cv.height){terrainViewportSurface.width=cv.width;terrainViewportSurface.height=cv.height;}
    const ground=terrainViewportSurface.getContext('2d');ground.setTransform(1,0,0,1,0,0);ground.clearRect(0,0,cv.width,cv.height);ground.setTransform(rasterScale,0,0,rasterScale,view.ox*dpr,view.oy*dpr);ground.imageSmoothingQuality='low';
    const x0=Math.floor(Math.max(-MAP_H*TILE_W/2,rendererBounds.left)/size),x1=Math.floor(Math.min(MAP_W*TILE_W/2,rendererBounds.right)/size),y0=Math.floor(Math.max(-TILE_H/2,rendererBounds.top)/size),y1=Math.floor(Math.min((MAP_W+MAP_H)*TILE_H/2,rendererBounds.bottom)/size);
    const p=tileToScreen((MAP_W-1)/2,(MAP_H-1)/2),hw=MAP_W*TILE_W/2,hh=MAP_H*TILE_H/2;
    ground.save();ground.beginPath();ground.moveTo(p.sx,p.sy-hh);ground.lineTo(p.sx+hw,p.sy);ground.lineTo(p.sx,p.sy+hh);ground.lineTo(p.sx-hw,p.sy);ground.closePath();ground.clip();
    for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
      const cacheKey=x+','+y+','+tier;let chunk=terrainChunkCache.get(cacheKey);
      if(!chunk){
        chunk=createTerrainChunk(x,y,tier);terrainChunkCache.set(cacheKey,chunk);terrainCacheBytes+=chunk.bytes;
        while(terrainChunkCache.size>512||terrainCacheBytes>96*1024*1024){const first=terrainChunkCache.keys().next().value,old=terrainChunkCache.get(first);terrainCacheBytes-=old.bytes;old.disposed=true;old.bitmap?.close();terrainChunkCache.delete(first);}
      }else{terrainChunkCache.delete(cacheKey);terrainChunkCache.set(cacheKey,chunk);}
      ground.drawImage(chunk.bitmap||chunk.canvas,chunk.x,chunk.y,chunk.size,chunk.size);
    }
    if(terrainNight>.02){ground.globalCompositeOperation='multiply';ground.fillStyle=`rgba(64,111,157,${terrainNight*.24})`;ground.fillRect(rendererBounds.left,rendererBounds.top,rendererBounds.right-rendererBounds.left,rendererBounds.bottom-rendererBounds.top);ground.fillStyle=`rgba(79,125,184,${terrainNight*.39})`;ground.fillRect(rendererBounds.left,rendererBounds.top,rendererBounds.right-rendererBounds.left,rendererBounds.bottom-rendererBounds.top);ground.globalCompositeOperation='source-over';}
    ground.restore();
  }
  // The map outline and overlapping world chunks are composited once per
  // camera change. The static view is then one exact-resolution pixel copy.
  ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.imageSmoothingEnabled=false;ctx.drawImage(terrainViewportSurface,0,0);ctx.restore();
}
function getGroundTile(fill,surface){
  const key=fill+surface;if(groundTileCache.has(key))return groundTileCache.get(key);
  const tile=document.createElement('canvas');tile.width=TILE_W+2;tile.height=TILE_H+2;const tc=tile.getContext('2d'),cx=tile.width/2,cy=tile.height/2;
  tc.beginPath();tc.moveTo(cx,cy-(TILE_H+.7)/2);tc.lineTo(cx+(TILE_W+.7)/2,cy);tc.lineTo(cx,cy+(TILE_H+.7)/2);tc.lineTo(cx-(TILE_W+.7)/2,cy);tc.closePath();tc.fillStyle=fill;tc.fill();
  const texture=getTerrainTexture(surface);if(texture){tc.globalAlpha=surface==='water'?.36:surface==='sand'?.24:.16;tc.drawImage(texture,0,0);}
  groundTileCache.set(key,tile);return tile;
}
function getTerrainTexture(surface){
  const scale=view.zoom*Math.min(2,devicePixelRatio||1),tier=Math.max(1,Math.ceil(scale*2)/2),night=Math.round(rendererNight*12)/12,key=surface+':'+tier+':'+night;
  if(terrainTextureCache.has(key))return terrainTextureCache.get(key);
  const now=performance.now();if((terrainTextureMiss.get(surface)||0)>now)return null;
  const texture=document.createElement('canvas');texture.width=(TILE_W+2)*tier;texture.height=(TILE_H+2)*tier;const tc=texture.getContext('2d');tc.setTransform(tier,0,0,tier,0,0);
  if(!window.GameArt?.drawTerrain?.(tc,surface,(TILE_W+2)/2,(TILE_H+2)/2,TILE_W+.5,TILE_H+.5,0,night)){terrainTextureMiss.set(surface,now+300);return null;}
  terrainTextureCache.set(key,texture);if(terrainTextureCache.size>32)terrainTextureCache.delete(terrainTextureCache.keys().next().value);return texture;
}
function drawWater(x,y,p){
  const seed=hash2(x,y),time=renderClock/2300;
  if(view.zoom>.35){ctx.strokeStyle=`rgba(185,226,213,${.13+Math.sin(time+seed*8)*.055})`;ctx.lineWidth=1;
    for(let i=0;i<2;i++){const a=p.sx+(seed-.5)*34+i*7,b=p.sy-4+i*8;ctx.beginPath();ctx.moveTo(a-9,b);ctx.quadraticCurveTo(a,b+Math.sin(time+seed*10)*1.5,a+8,b);ctx.stroke();}
  }

}
function drawRoadNetwork(roads){
  const groups={normal:[],main:[],bridge:[]};
  for(const road of roads){const t=S.tiles[road.y][road.x];groups[t.t==='water'?'bridge':t.b.main?'main':'normal'].push(road);}
  ctx.lineJoin='round';ctx.lineCap='round';
  const paths=[];
  for(const[k,items]of Object.entries(groups)){
    const path=new Path2D();for(const{x,y,p}of items){let count=0;for(const[dx,dy]of DIRS){if(tileAt(x+dx,y+dy)?.b?.type!=='road')continue;path.moveTo(p.sx,p.sy);path.lineTo(p.sx+(dx-dy)*TILE_W/2,p.sy+(dx+dy)*TILE_H/2);count++;}if(!count){path.moveTo(p.sx-.1,p.sy);path.lineTo(p.sx+.1,p.sy);}}
    paths.push({k,path});ctx.strokeStyle='rgba(88,79,48,.27)';ctx.lineWidth=19;ctx.stroke(path);
  }
  for(const{k,path}of paths){const color=k==='bridge'?[173,147,106]:k==='main'?[193,182,143]:[181,170,132];ctx.strokeStyle=`rgb(${Math.round(color[0]*(1-rendererNight*.18)*(1-rendererNight*.26918))},${Math.round(color[1]*(1-rendererNight*.135)*(1-rendererNight*.19882))},${Math.round(color[2]*(1-rendererNight*.092)*(1-rendererNight*.10859))})`;ctx.lineWidth=16;ctx.stroke(path);}
  ctx.lineCap='butt';
  if(view.zoom>.5)for(const{x,y,p}of roads){if(S.tiles[y][x].t!=='water')drawRoadTexture(x,y,p);drawRoadDetails(x,y,S.tiles[y][x].b,p,S.tiles[y][x].t==='water');}
}
function drawRoadTexture(x,y,p){
  if(!window.GameArt?.drawTerrain)return;
  // Keep the centre and road arms in the same winding direction. A clockwise
  // centre rectangle punched a square hole in the counterclockwise arm mask.
  ctx.save();ctx.beginPath();ctx.arc(p.sx,p.sy,7,0,Math.PI*2,true);
  for(const[dx,dy]of DIRS){if(tileAt(x+dx,y+dy)?.b?.type!=='road')continue;const vx=(dx-dy)*TILE_W/4,vy=(dx+dy)*TILE_H/4,len=Math.hypot(vx,vy),nx=-vy/len*8,ny=vx/len*8;ctx.moveTo(p.sx+nx,p.sy+ny);ctx.lineTo(p.sx+vx+nx,p.sy+vy+ny);ctx.lineTo(p.sx+vx-nx,p.sy+vy-ny);ctx.lineTo(p.sx-nx,p.sy-ny);ctx.closePath();}
  ctx.clip();ctx.globalAlpha=.42-rendererNight*.13;const texture=getTerrainTexture('road');if(texture)ctx.drawImage(texture,p.sx-(TILE_W+2)/2,p.sy-(TILE_H+2)/2,TILE_W+2,TILE_H+2);ctx.restore();
}
function drawRoadDetails(x,y,b,p,bridge){
  const links=DIRS.filter(([dx,dy])=>tileAt(x+dx,y+dy)?.b?.type==='road');
  ctx.strokeStyle=bridge?'rgba(96,77,49,.33)':'rgba(237,222,178,.45)';ctx.lineWidth=.7;
  for(const[dx,dy]of links){const ex=p.sx+(dx-dy)*TILE_W/4,ey=p.sy+(dx+dy)*TILE_H/4;for(let i=1;i<=2;i++){const f=i/3,xx=p.sx+(ex-p.sx)*f,yy=p.sy+(ey-p.sy)*f;ctx.beginPath();ctx.moveTo(xx-3*(dx+dy),yy+3*(dx-dy));ctx.lineTo(xx+3*(dx+dy),yy-3*(dx-dy));ctx.stroke();}}
  if(bridge){ctx.strokeStyle='#7e714c';ctx.lineWidth=1.6;for(const[dx,dy]of links){const ex=p.sx+(dx-dy)*TILE_W/2,ey=p.sy+(dx+dy)*TILE_H/2;for(const side of[-1,1]){const off=side*7;ctx.beginPath();ctx.moveTo(p.sx+off,p.sy-6);ctx.lineTo(ex+off,ey-6);ctx.stroke();for(const f of[0,.5,1]){const xx=p.sx+(ex-p.sx)*f+off,yy=p.sy+(ey-p.sy)*f;ctx.beginPath();ctx.moveTo(xx,yy-7);ctx.lineTo(xx,yy+2);ctx.stroke();}}}}
  if(b.main&&hash2(x,y)>.82){ctx.fillStyle='#6c6242';ctx.fillRect(p.sx-15,p.sy-14,2,14);ctx.fillStyle='#d7bd70';ctx.fillRect(p.sx-18,p.sy-17,8,5);if(rendererNight>.1)rendererLights.push({x:p.sx-14,y:p.sy-16,r:17,power:.72});}
}
function drawTile(x,y){const t=tileAt(x,y);if(t)drawTileGround(x,y,t,tileToScreen(x,y));}
function collectNaturalObjects(objects,x,y,type){
  const natural=getTerrainVisual(x,y);
  if(type==='tree'){const tx=x+natural.offsetX*.82,ty=y+natural.offsetY*.82;objects.push({kind:type,x,y,p:tileToScreen(tx,ty),natural,depth:tx+ty+.05});return;}
  const neighbours=DIRS.reduce((n,[dx,dy])=>n+(tileAt(x+dx,y+dy)?.t===type?1:0),0),count=2+Math.floor(hash2(x+23,y+71)*3);
  for(let i=0;i<count;i++){
    // Several unequal props share each mineral patch. Neighbouring patches
    // deliberately overlap their sampling domains instead of repeating one tile.
    const tx=x+(hash2(x+i*13+41,y+81)-.5)*1.45,ty=y+(hash2(x+23,y+i*31+19)-.5)*1.45,seed=hash2(x+i*19,y+47);
    const scale=(i===0&&neighbours>1?.52:.17)+seed*(i===0?.25:.19),p=tileToScreen(tx,ty);if(!inViewport(p.sx,p.sy,80,100))continue;
    objects.push({kind:type,x,y,p,natural:{...natural,propScale:scale,propSeed:seed,index:i},depth:tx+ty+.05});
  }
}
function drawTree(sx,sy,x,y){
  const natural=getTerrainVisual(x,y),seed=hash2(x,y),s=natural.scale,wind=Math.sin(renderClock/1600+x)*1.3;
  const civ=currentCivilization(),variant=civ==='egypt'?2:civ==='persia'?(seed>.6?1:2):civ==='greece'?(seed>.5?1:0):civ==='china'&&natural.moisture>.62&&seed>.83?3:0;
  if(window.GameArt?.drawTerrain?.(ctx,'tree',sx,sy,TILE_W*(.47+seed*.19)*natural.scale,TILE_H*.12,variant,rendererNight))return;
  ctx.fillStyle='rgba(32,53,31,.17)';ctx.beginPath();ctx.ellipse(sx+6,sy+3,17*s,7*s,-.12,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#6d6b43';ctx.fillRect(sx-2*s,sy-28*s,4*s,30*s);
  const layers=[[-9,-28,13,'#4c7047'],[7,-31,15,'#557a4b'],[-2,-43,16,'#628650'],[-8,-42,10,'#77935a'],[5,-49,10,'#79975b']];
  for(const[a,b,r,c]of layers){ctx.fillStyle=c;ctx.beginPath();ctx.ellipse(sx+(a+wind)*s,sy+b*s,r*s,r*s*.85,0,0,Math.PI*2);ctx.fill();}
  ctx.fillStyle='rgba(182,197,114,.25)';ctx.beginPath();ctx.ellipse(sx-5*s+wind,sy-48*s,7*s,5*s,-.2,0,Math.PI*2);ctx.fill();
}
function drawRock(sx,sy,x,y,copper=false,detail={}){
  const size=detail.propScale||.5,flip=detail.propSeed>.5;ctx.save();ctx.translate(sx,sy);if(flip)ctx.scale(-1,1);const painted=window.GameArt?.drawTerrain?.(ctx,copper?'copper':'stone',0,0,TILE_W*size,0,0,rendererNight);ctx.restore();if(painted)return;
  const seed=hash2(x,y);ctx.fillStyle='rgba(37,49,29,.16)';ctx.beginPath();ctx.ellipse(sx+3,sy+3,19,7,0,0,Math.PI*2);ctx.fill();
  for(const[dx,dy,w,h]of [[0,0,18,22],[13,3,11,12],[-13,3,10,12]]){
    const xx=sx+dx,yy=sy+dy;polygon([[xx-w/2,yy],[xx-w*.65,yy-h*.5],[xx-w*.1,yy-h],[xx+w*.5,yy-h*.7],[xx+w*.6,yy-h*.15],[xx+w*.3,yy+2]],copper?'#a48b68':'#9d9e8a');
    polygon([[xx-w*.1,yy-h],[xx+w*.5,yy-h*.7],[xx+w*.6,yy-h*.15],[xx+w*.3,yy+2],[xx,yy-h*.3]],copper?'#8a7758':'#7c8472');
    polygon([[xx-w*.65,yy-h*.5],[xx-w*.1,yy-h],[xx+w*.5,yy-h*.7],[xx,yy-h*.3]],copper?'#c5ab7d':'#b3b39a');
  }
}
const clayPropCache=new Map();
function clayProp(seed,night=0){
  const nightLevel=Math.round(night*12)/12,key=Math.floor(seed*8)+':'+nightLevel;if(clayPropCache.has(key))return clayPropCache.get(key);
  const variant=Math.floor(seed*8),image=document.createElement('canvas');image.width=192;image.height=100;const dc=image.getContext('2d');
  for(let mound=0;mound<5;mound++){
    const mx=30+mound*31,my=66+rendererTerrainHash(variant,mound)*16,w=24+rendererTerrainHash(variant+13,mound)*16,h=w*(.32+rendererTerrainHash(variant+31,mound)*.19);
    dc.save();dc.beginPath();
    for(let j=0;j<13;j++){const angle=j/13*Math.PI*2,r=.78+rendererTerrainHash(variant*71+j,mound)*.22,x=mx+Math.cos(angle)*w*r,y=my+Math.sin(angle)*h*r-h*.7*(1-Math.cos(angle)**2);dc[j?'lineTo':'moveTo'](x,y);}
    dc.closePath();const gradient=dc.createLinearGradient(mx-w,my-h*1.7,mx+w,my+h);gradient.addColorStop(0,'#b19c70');gradient.addColorStop(.36,'#99815a');gradient.addColorStop(1,'#726241');dc.fillStyle=gradient;dc.fill();dc.clip();
    for(let j=0;j<180;j++){const px=mx+(rendererTerrainHash(variant*31+j,mound+11)-.5)*w*2,py=my+(rendererTerrainHash(variant*19+j,mound+41)-.5)*h*3;dc.fillStyle=j%3?'rgba(63,50,31,.24)':'rgba(222,203,156,.35)';dc.fillRect(px,py,.8+rendererTerrainHash(j,variant)*1.5,.6+rendererTerrainHash(j+71,variant)*1.2);}
    dc.strokeStyle='rgba(65,53,35,.35)';dc.lineWidth=.8;for(let j=0;j<4;j++){const px=mx-w*.6+j*w*.4,py=my-h*.4+rendererTerrainHash(j,variant)*h;dc.beginPath();dc.moveTo(px,py);dc.lineTo(px+3,py-2);dc.lineTo(px+7,py-.8);dc.stroke();}dc.restore();
  }
  if(nightLevel){const pixels=dc.getImageData(0,0,image.width,image.height),data=pixels.data;for(let i=0;i<data.length;i+=4){data[i]*=1-nightLevel*.26918;data[i+1]*=1-nightLevel*.19882;data[i+2]*=1-nightLevel*.10859;}dc.putImageData(pixels,0,0);}
  clayPropCache.set(key,image);if(clayPropCache.size>64)clayPropCache.delete(clayPropCache.keys().next().value);return image;
}
function drawClay(sx,sy,x,y,detail={}){
  const seed=detail.propSeed??hash2(x,y),width=(detail.propScale||.5)*TILE_W*.83,image=clayProp(seed,rendererNight),height=width*image.height/image.width;
  ctx.drawImage(image,sx-width/2,sy-height*.82,width,height);
}
function buildingGeometry(x,y,b){const size=BUILD[b.type]?.size||1,p=tileToScreen(x,y);return{cx:p.sx,cy:p.sy+(size-1)*TILE_H/2,size,width:size*TILE_W,height:size*TILE_H};}
function drawFoundation(g,b){
  drawDiamond(g.cx,g.cy,g.width*.91,g.height*.91);ctx.fillStyle=b.construction?'#aaa17a':'#b6b18f';ctx.fill();
  ctx.strokeStyle='rgba(70,76,51,.25)';ctx.lineWidth=1;ctx.stroke();
}
function legacyBuildingGeometry(g,b){
  const scale=b.type==='well'?.66:['grainShop','vegShop','fruitShop','fishShop','meatShop'].includes(b.type)?.82:b.type==='treeDeco'?.72:1;
  return scale===1?g:{...g,width:g.width*scale};
}
function drawBuildingArt(g,b,level=b.lvl||1,opacity=1){
  if(opacity!==1){ctx.save();ctx.globalAlpha*=opacity;}
  let drawn=!!window.ModularBuildings?.draw?.(ctx,{type:b.type,civ:currentCivilization(),level,cx:g.cx,cy:g.cy,width:g.width,height:g.height,time:renderClock/1000,construction:null,building:{...b,lvl:level,construction:null},night:rendererNight});
  if(!drawn&&window.GameArt?.drawBuilding){const art=legacyBuildingGeometry(g,b);drawn=window.GameArt.drawBuilding(ctx,{type:b.type,civ:currentCivilization(),level,cx:art.cx,cy:art.cy,width:art.width,height:art.height,time:renderClock,construction:b.construction||null,night:rendererNight})!==false;}
  if(!drawn)drawStructure(g.cx,g.cy,{...b,lvl:level},g.size===1?1.7:g.size===2?2.35:3.2,g.size);
  if(opacity!==1)ctx.restore();return drawn;
}
function drawBuilding(x,y,b){
  const d=BUILD[b.type];if(!d)return;
  const g=buildingGeometry(x,y,b),selected=window.selectedTile&&tileAt(window.selectedTile.x,window.selectedTile.y)?.b===b;
  ctx.save();
  const underConstruction=b.construction&&b.construction.remaining>0;
  const transparent=rendererSettings.overlay==='foundation'||rendererSettings.overlay==='foundations';
  if(transparent)ctx.globalAlpha=.23;
  const modular=window.ModularBuildings?.draw?.(ctx,{type:b.type,civ:currentCivilization(),level:b.lvl||1,cx:g.cx,cy:g.cy,width:g.width,height:g.height,time:renderClock/1000,construction:underConstruction?b.construction:null,building:b,night:rendererNight});
  if(!modular){if(underConstruction)drawConstruction(g,b);else{drawBuildingArt(g,b);drawBuildingAnimation(g,b);}}
  ctx.restore();
  if(rendererNight>.1){if(modular){for(const light of modular.lights||[])rendererLights.push({...light,r:Math.min(26,light.r||18),power:light.power??.75});}else addBuildingLights(g,b,underConstruction);}
  if((selected||view.zoom>1.35)&&isResidence(b)){
    const state=b.met,col=state?.canUpgrade?'#a4cd82':state?.currentOk?'#dfc27e':'#df9170';
    const xx=g.cx+g.width*.33,yy=g.cy-g.height*.45;
    ctx.beginPath();ctx.arc(xx,yy,8,0,Math.PI*2);ctx.fillStyle='#243b31';ctx.fill();ctx.strokeStyle=col;ctx.lineWidth=1;ctx.stroke();ctx.font='600 10px '+FONT;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle=col;ctx.fillText(b.lvl||1,xx,yy+.5);
  }
  if(!underConstruction&&d.workers&&!b.staffed&&view.zoom>.6){
    const xx=g.cx+g.width*.32,yy=g.cy-g.height*.35;
    ctx.beginPath();ctx.arc(xx,yy,6,0,Math.PI*2);ctx.fillStyle='#b97643';ctx.fill();ctx.fillStyle='#fff0ce';ctx.textAlign='center';ctx.textBaseline='middle';ctx.font='bold 9px '+FONT;ctx.fillText('!',xx,yy+.5);
  }
}
function drawConstruction(g,b){
  const c=b.construction,progress=Math.max(0,Math.min(1,1-c.remaining/Math.max(1,c.total))),upgrade=!!c.fromLevel;
  const targetLevel=c.toLevel||b.lvl||1,meta=window.GameArt?.metadata?.(b.type,currentCivilization(),targetLevel),spriteH=meta?.width?g.width*meta.height/meta.width:g.width*.85;
  const bottom=g.cy+g.height/2,frameHeight=Math.max(g.height*.3,spriteH-g.height*.26),w=g.width*.40,h=g.height*.39;
  if(upgrade)drawBuildingArt(g,b,c.fromLevel,1);else drawFoundation(g,b);
  // Reveal the actual target silhouette in staggered structural bays. A generic
  // construction illustration must never replace every unrelated building.
  const bays=Math.max(3,g.size*3),bayWidth=g.width/bays;
  for(let bay=0;bay<bays;bay++){
    const local=Math.max(0,Math.min(1,(progress-.07-(bay%3)*.035)/.82));if(!local)continue;
    const height=spriteH*local;ctx.save();ctx.beginPath();ctx.rect(g.cx-g.width/2+bay*bayWidth-.3,bottom-height,bayWidth+.6,height+2);ctx.clip();drawBuildingArt(g,b,targetLevel,upgrade?Math.min(1,.65+progress*.35):1);ctx.restore();
  }
  const elevation=frameHeight*(.2+progress*.77),rows=Math.max(1,Math.ceil(elevation/23)),open=Math.max(.1,1-smoothRange(.82,1,progress));
  ctx.save();ctx.globalAlpha=open;ctx.lineCap='round';
  // Each front edge has separate scaffold bays; footprint and height come from
  // this building's sprite, including low farms and tall monuments.
  for(const side of [-1,1])for(let bay=0;bay<Math.max(2,g.size+1);bay++){
    const count=Math.max(2,g.size+1),f0=bay/count,f1=(bay+1)/count;
    const x0=g.cx+side*w*(1-f0),y0=g.cy+h*f0,x1=g.cx+side*w*(1-f1),y1=g.cy+h*f1;
    const top=elevation*(.92+((bay+b.id)%3)*.04);ctx.strokeStyle='#735c38';ctx.lineWidth=1.3;ctx.beginPath();ctx.moveTo(x0,y0);ctx.lineTo(x0,y0-top);ctx.moveTo(x1,y1);ctx.lineTo(x1,y1-top);ctx.stroke();
    ctx.strokeStyle='#b59662';ctx.lineWidth=1;
    for(let row=1;row<=rows;row++){const rise=top*row/rows;ctx.beginPath();ctx.moveTo(x0,y0-rise);ctx.lineTo(x1,y1-rise);ctx.moveTo(x0,y0-rise);ctx.lineTo(x1,y1-rise+top/rows);ctx.stroke();}
    ctx.strokeStyle='#d0b582';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(x0,y0-top);ctx.lineTo(x1,y1-top);ctx.stroke();
  }
  ctx.restore();
  const wave=rendererSettings.reducedMotion?0:Math.sin(renderClock/1500+b.id),phase=.5+.35*wave;
  drawPerson(g.cx-w+phase*w*2,g.cy+h*.74,'#b55e39',b.id);
  if(g.size>1)drawPerson(g.cx+w*.67,g.cy+h*.25,'#d1b67c',b.id+1);
  const barW=Math.min(48,g.width*.4),by=bottom+5;ctx.fillStyle='#304735';ctx.fillRect(g.cx-barW/2,by,barW,2);ctx.fillStyle='#dbbf77';ctx.fillRect(g.cx-barW/2,by,barW*progress,2);
}
function drawBuildingAnimation(g,b){
  if(view.zoom<.4)return;g=legacyBuildingGeometry(g,b);
  const t=b.type,d=BUILD[t],active=!d.workers||b.staffed,tm=renderClock/1000;
  const artMeta=window.GameArt?.metadata?.(t,currentCivilization(),b.lvl||1),artH=artMeta?.width?g.width*artMeta.height/artMeta.width:g.width,artTop=g.cy+g.height/2-artH;
  if(['kiln','pottery'].includes(t)&&active&&!rendererSettings.reducedMotion){
    const smoke=artMeta?.smoke,smokeX=smoke?g.cx-g.width/2+smoke.x*g.width:g.cx+g.width*.2,smokeY=smoke?artTop+smoke.y*artH:g.cy-g.width*.48;
    for(let i=0;i<4;i++){const f=(tm*.2+i*.25+hash2(b.id,3))%1;ctx.fillStyle=`rgba(225,222,201,${(1-f)*.28})`;ctx.beginPath();ctx.ellipse(smokeX+Math.sin(f*5+b.id)*7,smokeY-f*32,2+f*7,3+f*5,-.2,0,Math.PI*2);ctx.fill();}
  }
  if(['well','garden','fountain'].includes(t)){
    const sx=g.cx,sy=g.cy-g.height*.12;ctx.strokeStyle='rgba(192,231,212,.72)';ctx.lineWidth=1;ctx.beginPath();ctx.ellipse(sx,sy,4+Math.sin(tm*2)*1.5,2,0,0,Math.PI*2);ctx.stroke();
  }
  if(['barracks','wonder','palace','market','harbor','temple'].includes(t)){
    const px=g.cx+g.width*.18,py=g.cy-g.width*.43;ctx.strokeStyle='#776746';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(px,py+15);ctx.lineTo(px,py-5);ctx.stroke();
    polygon([[px,py-5],[px+10,py-3+Math.sin(tm*2+b.id)*1.7],[px+8,py+4+Math.sin(tm*2+b.id)*1.7],[px,py+3]],currentCivilization()==='china'?'#af5540':'#c3a55d');
  }
  if(t==='mill'&&active){
    const xx=g.cx+g.width*.11,yy=artTop+artH*.59,rx=g.width*.075,ry=g.width*.11,rot=tm*.6;
    ctx.strokeStyle='rgba(157,119,65,.8)';ctx.lineWidth=1.2;for(let i=0;i<8;i++){const a=rot+i*Math.PI/4;ctx.beginPath();ctx.moveTo(xx,yy);ctx.lineTo(xx+Math.cos(a)*rx,yy+Math.sin(a)*ry);ctx.stroke();}
    ctx.fillStyle='#d2ae74';ctx.beginPath();ctx.ellipse(xx,yy,2,2.8,0,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle='rgba(198,233,230,.55)';ctx.lineWidth=1;ctx.setLineDash([3,4]);ctx.lineDashOffset=-tm*14;ctx.beginPath();ctx.moveTo(xx+rx+2,yy-ry*.4);ctx.quadraticCurveTo(xx+rx+6,yy+ry*.5,xx+rx+8,yy+ry*1.4);ctx.stroke();ctx.setLineDash([]);
  }
}
function getEmissionMask(g,b,meta){
  if(!meta?.width||!meta?.height||!meta.lights?.length)return null;
  const required=g.width*view.zoom*Math.min(2,devicePixelRatio||1),resolution=Math.max(128,Math.min(1024,2**Math.ceil(Math.log2(required)))),key=meta.key+':'+resolution;
  if(emissionMaskCache.has(key))return emissionMaskCache.get(key);
  const mask=document.createElement('canvas');mask.width=resolution;mask.height=Math.ceil(resolution*meta.height/meta.width);const mc=mask.getContext('2d'),scale=resolution/256;
  mc.fillStyle='#ffd487';
  for(const point of meta.lights){const x=point.x*mask.width,y=point.y*mask.height,skew=point.x<.5?1:-1;mc.beginPath();mc.moveTo(x-3*scale,y-4*scale);mc.lineTo(x+3*scale,y+(-4+2*skew)*scale);mc.lineTo(x+3*scale,y+(4+2*skew)*scale);mc.lineTo(x-3*scale,y+4*scale);mc.closePath();mc.fill();}
  // The actual sprite alpha clips the emissive windows to the architecture.
  mc.globalCompositeOperation='destination-in';
  const loaded=GameArt.drawBuilding(mc,{type:b.type,civ:currentCivilization(),level:b.lvl||1,cx:resolution/2,cy:mask.height-resolution/4,width:resolution,height:resolution/2});
  if(!loaded)return null;
  emissionMaskCache.set(key,mask);if(emissionMaskCache.size>64)emissionMaskCache.delete(emissionMaskCache.keys().next().value);return mask;
}
function addBuildingLights(g,b,construction){
  g=legacyBuildingGeometry(g,b);
  if(!construction&&['farmland','vegFarm','pasture','orchard','treeDeco','quarry','clayPit','copperMine','monument'].includes(b.type))return;
  const meta=window.GameArt?.metadata?.(b.type,currentCivilization(),b.lvl||1);
  if(!construction&&meta?.width&&meta?.height){
    const h=g.width*meta.height/meta.width,top=g.cy+g.height/2-h;
    for(const point of meta.lights||[])rendererLights.push({x:g.cx-g.width/2+point.x*g.width,y:top+point.y*h,r:12+g.size*4,power:.75,masked:true});
    const mask=getEmissionMask(g,b,meta);if(mask)rendererMasks.push({mask,x:g.cx-g.width/2,y:top,width:g.width,height:h});return;
  }
  const size=g.size,points=construction?[[-.27,.13],[.25,.1]]:[[-.2,-.13],[.19,-.05],[0,.19]];
  if(['farmland','vegFarm','pasture','treeDeco','quarry','clayPit'].includes(b.type))return;
  for(let i=0;i<Math.min(points.length,size+1);i++){const[a,c]=points[i];rendererLights.push({x:g.cx+a*g.width,y:g.cy+c*g.height-5,r:(construction?14:12)+size*4,power:construction?.7:.72});}
}
function drawPerson(x,y,color,seed){
  ctx.fillStyle='rgba(28,35,22,.2)';ctx.beginPath();ctx.ellipse(x+1,y+1,3,1.4,0,0,Math.PI*2);ctx.fill();ctx.fillStyle=color;ctx.fillRect(x-1.5,y-5,3,4);ctx.fillStyle='#d0ae7b';ctx.beginPath();ctx.arc(x,y-6,1.5,0,Math.PI*2);ctx.fill();
  if(view.zoom>.7){ctx.strokeStyle='#655d43';ctx.lineWidth=.8;const step=Math.sin(renderClock/120+seed)*1.2;ctx.beginPath();ctx.moveTo(x-.6,y-1);ctx.lineTo(x-1+step,y+1);ctx.moveTo(x+.6,y-1);ctx.lineTo(x+1-step,y+1);ctx.stroke();}
}
function collectCitizens(objects){
  for(const entity of window.Citizens?.collect?.()||[]){const p=tileToScreen(entity.x,entity.y);if(!inViewport(p.sx,p.sy,20,30))continue;objects.push({kind:'person',entity,x:entity.x,y:entity.y,depth:entity.x+entity.y+.1,px:p.sx,py:p.sy});}
}
function drawAtmosphere(r){
  if(rendererNight<.02)return;
  if(!nightGlow){
    nightGlow=document.createElement('canvas');nightGlow.width=nightGlow.height=128;
    const gc=nightGlow.getContext('2d'),gradient=gc.createRadialGradient(64,64,0,64,64,64);
    gradient.addColorStop(0,'rgba(255,187,78,.48)');gradient.addColorStop(.22,'rgba(248,157,43,.17)');gradient.addColorStop(1,'rgba(236,146,40,0)');gc.fillStyle=gradient;gc.fillRect(0,0,128,128);
  }
  // Static moonlight is baked into the terrain and sprite caches. Draw only
  // small emissive regions here: copying a nearly empty full-screen canvas
  // forced an expensive high-DPR canvas transfer every frame in Chromium.
  ctx.save();ctx.translate(view.ox,view.oy);ctx.scale(view.zoom,view.zoom);
  for(const point of rendererLights){
    const radius=Math.min(26,point.r||18);ctx.globalAlpha=(point.power??.75)*rendererNight;
    ctx.drawImage(nightGlow,point.x-radius,point.y-radius,radius*2,radius*2);
    if(!point.masked){ctx.globalAlpha=rendererNight;ctx.fillStyle='#ffe5ae';ctx.fillRect(point.x-1.2,point.y-2.3,2.4,3.6);}
  }
  ctx.globalAlpha=rendererNight;
  for(const item of rendererMasks)ctx.drawImage(item.mask,item.x,item.y,item.width,item.height);
  ctx.restore();
}
function drawStructure(cx,cy,b,sc,size){
  const t = b.type;
  ctx.fillStyle="rgba(0,0,0,0.26)";
  ctx.beginPath();
  ctx.ellipse(cx, cy+7*sc, 17*sc*Math.sqrt(size)*0.9, 8*sc*Math.sqrt(size)*0.9, 0, 0, Math.PI*2);
  ctx.fill();

  const box = (w,hh,body,roof,roofH)=>{
    const hw=w/2*sc, dh=hh/2*sc, bh=body.h*sc;
    const top=cy-bh;
    ctx.fillStyle=body.left;
    ctx.beginPath();
    ctx.moveTo(cx-hw,top); ctx.lineTo(cx,top+dh); ctx.lineTo(cx,top+dh+bh); ctx.lineTo(cx-hw,top+bh);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle=body.right;
    ctx.beginPath();
    ctx.moveTo(cx+hw,top); ctx.lineTo(cx,top+dh); ctx.lineTo(cx,top+dh+bh); ctx.lineTo(cx+hw,top+bh);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle=roof;
    ctx.beginPath();
    ctx.moveTo(cx,top-dh-roofH*sc); ctx.lineTo(cx+hw,top-roofH*sc);
    ctx.lineTo(cx,top+dh-roofH*sc); ctx.lineTo(cx-hw,top-roofH*sc);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle="rgba(0,0,0,0.18)";
    ctx.beginPath();
    ctx.moveTo(cx,top-dh-roofH*sc); ctx.lineTo(cx-hw,top-roofH*sc); ctx.lineTo(cx,top+dh-roofH*sc);
    ctx.closePath(); ctx.fill();
  };

  switch(t){
    case "house": {
      const lvl=b.lvl||1;
      const hgt=8+lvl*1.5;
      box(20,10,{left:"#c9a97a",right:"#a8875c",h:hgt}, lvl>=5?"#8f5a3a":"#a86a45", 5+lvl*0.35);
      ctx.fillStyle="#5a3f24";
      ctx.fillRect(cx-2.5*sc, cy+hgt*sc-6*sc, 5*sc, 6*sc);
      if (lvl>=3){
        ctx.fillStyle="#e8d9a8";
        for(let i=0;i<Math.min(4,lvl-2);i++){
          const yy=cy+hgt*sc-10*sc-i*5*sc;
          ctx.fillRect(cx-7*sc,yy,3*sc,2.5*sc);
          ctx.fillRect(cx+4*sc,yy,3*sc,2.5*sc);
        }
      }
      break;
    }
    case "villa": {
      box(30,16,{left:"#e0d2b0",right:"#bcaa88",h:14}, "#9a6a48", 6);
      ctx.fillStyle="#7a5a3a";
      ctx.fillRect(cx-5*sc, cy+2*sc, 10*sc, 8*sc);
      break;
    }
    case "well": {
      box(16,9,{left:"#a8a08a",right:"#8b8370",h:4},"#6f8f9c",2);
      ctx.fillStyle="#5b93a8";
      ctx.beginPath(); ctx.ellipse(cx,cy+1*sc,8*sc,4*sc,0,0,Math.PI*2); ctx.fill();
      break;
    }
    case "watch": {
      box(17,9,{left:"#c25b45",right:"#a04632",h:13},"#8a3527",3);
      ctx.fillStyle="#f2c060";
      ctx.beginPath(); ctx.arc(cx, cy-9*sc, 2.6*sc, 0, Math.PI*2); ctx.fill();
      break;
    }
    case "police": box(18,10,{left:"#5c6f8a",right:"#45566e",h:12},"#39465a",3); break;
    case "clinic": {
      box(18,10,{left:"#d8d2c0",right:"#b3ad9b",h:11},"#8e8878",3);
      ctx.fillStyle="#c0392b";
      ctx.fillRect(cx-1.5*sc,cy+2*sc,3*sc,8*sc);
      ctx.fillRect(cx-5*sc,cy+4.5*sc,10*sc,3*sc);
      break;
    }
    case "repair": box(18,10,{left:"#8a7a62",right:"#6e614d",h:10},"#5a4f3e",3); break;
    case "temple": {
      ctx.fillStyle="#cbb98c";
      ctx.fillRect(cx-12*sc,cy+2*sc,24*sc,4*sc);
      for(let i=-2;i<=2;i++){
        ctx.fillStyle = i<0?"#b5a075":"#9c8860";
        ctx.fillRect(cx+i*5*sc-1.2*sc, cy-9*sc, 2.4*sc, 13*sc);
      }
      ctx.fillStyle="#8a7550";
      ctx.beginPath();
      ctx.moveTo(cx-14*sc,cy-9*sc); ctx.lineTo(cx+14*sc,cy-9*sc); ctx.lineTo(cx,cy-20*sc);
      ctx.closePath(); ctx.fill();
      break;
    }
    case "school": {
      box(20,11,{left:"#d6c8a4",right:"#b4a684",h:12},"#7a6444",4);
      ctx.fillStyle="#6a5232";
      ctx.fillRect(cx-8*sc,cy+2*sc,16*sc,2*sc);
      break;
    }
    case "theater": {
      box(20,11,{left:"#a8607a",right:"#8a4a62",h:9},"#6a3448",4);
      ctx.fillStyle="#e0c060";
      ctx.beginPath(); ctx.arc(cx,cy-2*sc,3*sc,0,Math.PI*2); ctx.fill();
      break;
    }
    case "grainShop": case "vegShop": case "fruitShop": case "fishShop": case "meatShop": {
      box(17,9,{left:"#b8915c",right:"#97744a",h:7},"#c9a86a",2);
      const col = t==="grainShop"?"#d8b45c":t==="vegShop"?"#7fb04a":
                  t==="fruitShop"?"#c85050":t==="fishShop"?"#5a90b0":"#b06060";
      ctx.fillStyle=col;
      ctx.beginPath();
      ctx.moveTo(cx-10*sc,cy-6*sc); ctx.lineTo(cx+10*sc,cy-6*sc);
      ctx.lineTo(cx+7*sc,cy-11*sc); ctx.lineTo(cx-7*sc,cy-11*sc);
      ctx.closePath(); ctx.fill();
      break;
    }
    case "farmland": case "vegFarm": case "orchard": case "pasture": {
      const col = t==="farmland"?"#9aa84a":t==="vegFarm"?"#7fa84a":
                  t==="orchard"?"#6f9a42":"#8a9a5a";
      const w = size===2?26:13;
      ctx.fillStyle=col;
      ctx.beginPath();
      ctx.moveTo(cx,cy-w*0.55); ctx.lineTo(cx+w,cy);
      ctx.lineTo(cx,cy+w*0.55); ctx.lineTo(cx-w,cy);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle="rgba(240,230,150,0.5)"; ctx.lineWidth=1;
      for(let i=-2;i<=2;i++){
        ctx.beginPath();
        ctx.moveTo(cx+i*w*0.32-w*0.6, cy+i*w*0.18);
        ctx.lineTo(cx+i*w*0.32+w*0.6, cy+i*w*0.18);
        ctx.stroke();
      }
      break;
    }
    case "fishing": {
      box(16,9,{left:"#8a7a5a",right:"#6e6248",h:8},"#5a4f3c",3);
      ctx.strokeStyle="#d8c8a0"; ctx.lineWidth=1.2;
      ctx.beginPath(); ctx.moveTo(cx+7*sc,cy-6*sc); ctx.lineTo(cx+13*sc,cy+2*sc); ctx.stroke();
      break;
    }
    case "lumber": {
      box(26,14,{left:"#9a7a52",right:"#7a5f3e",h:10},"#6b5236",4);
      ctx.fillStyle="#6e5a42";
      ctx.fillRect(cx+9*sc,cy-18*sc,4*sc,11*sc);
      ctx.fillStyle="#c8a05c";
      ctx.fillRect(cx-18*sc,cy+5*sc,6*sc,3*sc);
      ctx.fillRect(cx-16*sc,cy+2*sc,6*sc,3*sc);
      break;
    }
    case "quarry": {
      ctx.fillStyle="#7a7163";
      ctx.beginPath();
      ctx.moveTo(cx,cy-10*sc); ctx.lineTo(cx+20*sc,cy);
      ctx.lineTo(cx,cy+10*sc); ctx.lineTo(cx-20*sc,cy);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle="#9a9082";
      ctx.fillRect(cx-10*sc,cy-8*sc,7*sc,6*sc);
      ctx.fillRect(cx+3*sc,cy-2*sc,8*sc,6*sc);
      break;
    }
    case "clayPit": {
      ctx.fillStyle="#a08464";
      ctx.beginPath();
      ctx.moveTo(cx,cy-10*sc); ctx.lineTo(cx+20*sc,cy);
      ctx.lineTo(cx,cy+10*sc); ctx.lineTo(cx-20*sc,cy);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle="#b89a78";
      ctx.beginPath(); ctx.ellipse(cx,cy,10*sc,5*sc,0,0,Math.PI*2); ctx.fill();
      break;
    }
    case "kiln": case "pottery": case "mill": case "weaver": case "winery": {
      box(26,14,{left:"#9a7a62",right:"#7a5f4a",h:11},"#5e4636",4);
      ctx.fillStyle="#6e5a42";
      ctx.fillRect(cx+9*sc,cy-20*sc,5*sc,13*sc);
      ctx.fillStyle="#e8dcc0";
      ctx.beginPath(); ctx.arc(cx-9*sc,cy+1*sc,4*sc,0,Math.PI*2); ctx.fill();
      break;
    }
    case "granary": {
      box(26,14,{left:"#c8b07a",right:"#a68f5e",h:13},"#8a7448",4);
      ctx.fillStyle="#e0c88a";
      ctx.fillRect(cx-9*sc,cy-3*sc,18*sc,2*sc);
      break;
    }
    case "warehouse": {
      box(28,15,{left:"#9a7a52",right:"#7a5f3e",h:12},"#6b5236",4);
      ctx.fillStyle="#4a3722";
      ctx.fillRect(cx-7*sc,cy+3*sc,14*sc,7*sc);
      break;
    }
    case "treeDeco": {
      ctx.fillStyle="#5a4126";
      ctx.fillRect(cx-1.4,cy-4,2.8,7);
      ctx.fillStyle="#4a7a3c";
      ctx.beginPath(); ctx.arc(cx,cy-11*sc,8*sc,0,Math.PI*2); ctx.fill();
      ctx.fillStyle="#5f9449";
      ctx.beginPath(); ctx.arc(cx-3*sc,cy-14*sc,5*sc,0,Math.PI*2); ctx.fill();
      break;
    }
    case "garden": {
      ctx.fillStyle="#8a9a5a";
      ctx.beginPath();
      ctx.moveTo(cx,cy-13*sc); ctx.lineTo(cx+24*sc,cy);
      ctx.lineTo(cx,cy+13*sc); ctx.lineTo(cx-24*sc,cy);
      ctx.closePath(); ctx.fill();
      const flowers=[[-8,-2,"#d05a7a"],[6,-4,"#e0b040"],[0,4,"#c86a9a"],[10,3,"#e0b040"]];
      for(const [dx,dy,c] of flowers){
        ctx.fillStyle=c;
        ctx.beginPath(); ctx.arc(cx+dx*sc,cy+dy*sc,3*sc,0,Math.PI*2); ctx.fill();
      }
      break;
    }
    case "monument": {
      ctx.fillStyle="#b5a882";
      ctx.fillRect(cx-4*sc,cy-16*sc,8*sc,20*sc);
      ctx.fillStyle="#cbbfa0";
      ctx.fillRect(cx-6*sc,cy+2*sc,12*sc,4*sc);
      break;
    }
    case "barracks": {
      box(28,15,{left:"#7a6a5a",right:"#5e5044",h:12},"#4a3e34",4);
      ctx.fillStyle="#8a3020";
      ctx.fillRect(cx-2*sc,cy-14*sc,3*sc,9*sc);
      break;
    }
    case "wonder": {
      ctx.fillStyle="#cbb98c";
      ctx.beginPath();
      ctx.moveTo(cx,cy-44*sc); ctx.lineTo(cx+34*sc,cy+14*sc); ctx.lineTo(cx-34*sc,cy+14*sc);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle="#a8956a";
      ctx.beginPath();
      ctx.moveTo(cx,cy-44*sc); ctx.lineTo(cx+34*sc,cy+14*sc); ctx.lineTo(cx,cy+14*sc);
      ctx.closePath(); ctx.fill();
      break;
    }
    default:
      box(18,10,{left:"#b0a080",right:"#8e8062",h:9},"#7a6a4e",3);
  }
}

/* Service overlays are recalculated at most twice a second. Never run the
   economic needs evaluator or a whole-map building scan for every frame. */
function getOverlayValues(mode){
  const now=performance.now();if(overlayCache&&overlayCache.mode===mode&&overlayCache.state===S&&overlayCache.epoch===rendererEpoch&&now-overlayCache.time<650)return overlayCache.values;
  const values=new Float32Array(MAP_W*MAP_H);
  if(mode==='road'){
    const network=roadNetwork();for(let y=0;y<MAP_H;y++)for(let x=0;x<MAP_W;x++)if(S.tiles[y][x].b?.type==='road')values[y*MAP_W+x]=network[y][x]?1:-1;
  }else{
    const sources=[];
    for(let y=0;y<MAP_H;y++)for(let x=0;x<MAP_W;x++){
      const b=S.tiles[y][x].b;if(!b||b.type==='road'||b.construction||b.origin&&(b.origin[0]!==x||b.origin[1]!==y))continue;
      const d=BUILD[b.type];if(!d)continue;
      if(mode==='pollution'){
        if(typeof POLLUTERS!=='undefined'&&POLLUTERS.includes(b.type))sources.push({x,y,r:(d.size||1)+1,v:1});
      }else if(mode==='beauty'){
        if(d.cat==='decor'||b.type==='well')sources.push({x,y,r:b.type==='garden'?3:2,v:b.type==='garden'?3:1});
      }else if((d.provides===mode||mode==='water'&&d.provides==='water')&&(!d.workers||b.staffed))sources.push({x,y,r:d.radius||4,v:1});
    }
    for(const o of sources)for(let y=Math.max(0,o.y-o.r);y<=Math.min(MAP_H-1,o.y+o.r);y++)for(let x=Math.max(0,o.x-o.r);x<=Math.min(MAP_W-1,o.x+o.r);x++)values[y*MAP_W+x]+=o.v;
  }
  overlayCache={values,mode,state:S,epoch:rendererEpoch,time:now};return values;
}
function drawOverlay(){
  const mode=rendererSettings.overlay;if(mode==='none'||mode==='foundation'||mode==='foundations')return;
  const values=getOverlayValues(mode),r=cv.getBoundingClientRect(),bounds=getVisibleBounds(r);
  for(let y=bounds.y0;y<=bounds.y1;y++)for(let x=bounds.x0;x<=bounds.x1;x++){
    const value=values[y*MAP_W+x];if(!value)continue;
    const p=tileToScreen(x,y);if(!inViewport(p.sx,p.sy,TILE_W,TILE_H))continue;
    drawDiamond(p.sx,p.sy,TILE_W-1,TILE_H-1);
    ctx.fillStyle=mode==='pollution'?`rgba(202,106,75,${Math.min(.5,.14+value*.09)})`:mode==='water'?'rgba(79,174,197,.30)':mode==='road'?(value>0?'rgba(137,202,147,.42)':'rgba(224,112,84,.48)'):'rgba(123,192,136,.28)';ctx.fill();
  }
}
function drawCoverage(){
  let target=null;
  if(selTool&&BUILD[selTool]?.radius&&hover)target={radius:BUILD[selTool].radius,x:hover.x,y:hover.y,size:BUILD[selTool].size};
  else{
    const focus=window.selectedTile||hover,t=focus?tileAt(focus.x,focus.y):null,b=t?.b,d=b?BUILD[b.type]:null;
    if(d?.radius){const origin=b.origin||[focus.x,focus.y];target={radius:d.radius,x:origin[0],y:origin[1],size:d.size};}
  }
  if(!target||target.x==null)return;
  const{x,y,radius}=target;
  for(let dy=-radius;dy<=radius;dy++)for(let dx=-radius;dx<=radius;dx++){
    if(!tileAt(x+dx,y+dy))continue;const p=tileToScreen(x+dx,y+dy);
    drawDiamond(p.sx,p.sy,TILE_W-1,TILE_H-1);ctx.fillStyle='rgba(126,196,190,.11)';ctx.fill();
    if(Math.max(Math.abs(dx),Math.abs(dy))===radius){ctx.strokeStyle='rgba(193,224,202,.5)';ctx.lineWidth=1;ctx.stroke();}
  }
}
function drawSelectionGround(){
  const focus=window.selectedTile;if(!focus)return;const t=tileAt(focus.x,focus.y);if(!t?.b)return;
  const b=t.b,origin=b.origin||[focus.x,focus.y],g=buildingGeometry(origin[0],origin[1],b);
  drawDiamond(g.cx,g.cy,g.width+5,g.height+5);ctx.fillStyle='rgba(232,205,130,.15)';ctx.fill();ctx.strokeStyle='#efdb9d';ctx.lineWidth=2/view.zoom;ctx.stroke();
}
function drawRoadPreview(){
  if(!Array.isArray(window.roadPreview))return;
  for(const p of window.roadPreview){if(!inB(p.x,p.y))continue;const q=tileToScreen(p.x,p.y),valid=p.ok??canBuildAt('road',p.x,p.y).ok;
    drawDiamond(q.sx,q.sy,TILE_W-2,TILE_H-2);ctx.fillStyle=valid?'rgba(155,201,137,.38)':'rgba(212,119,87,.42)';ctx.fill();ctx.strokeStyle=valid?'#d5e1ac':'#e7ad89';ctx.lineWidth=1.2;ctx.stroke();
  }
}
function drawHover(){
  if(!hover||!inB(hover.x,hover.y))return;
  let {x,y}=hover,size=BUILD[selTool]?.size||1,ok=true;
  if(selTool&&BUILD[selTool]){const moving=window.relocatingBuilding;ok=moving&&typeof canMoveBuilding==='function'?canMoveBuilding(moving.x,moving.y,x,y).ok:canBuildAt(selTool,x,y).ok&&afford(selTool);}
  else if(!selTool){const b=tileAt(x,y)?.b;if(b){if(b.origin)[x,y]=b.origin;size=BUILD[b.type]?.size||1;}}
  const p=tileToScreen(x,y),cx=p.sx,cy=p.sy+(size-1)*TILE_H/2;
  drawDiamond(cx,cy,TILE_W*size,TILE_H*size);ctx.fillStyle=selTool?(ok?'rgba(170,203,139,.23)':'rgba(218,126,91,.28)'):'rgba(250,226,169,.09)';ctx.fill();ctx.strokeStyle=selTool?(ok?'#c6e2aa':'#f0b08c'):'rgba(255,232,177,.7)';ctx.lineWidth=1.4/view.zoom;ctx.stroke();
  if(selTool&&BUILD[selTool]&&selTool!=='road'&&ok){
    ctx.save();ctx.globalAlpha=.48;drawBuildingArt({cx,cy,size,width:TILE_W*size,height:TILE_H*size},{type:selTool,lvl:1,id:0});ctx.restore();
  }
  // Corner diamonds remain legible over high-contrast textures and at night.
  if(selTool){ctx.fillStyle=ok?'#e2edc6':'#f4bd9a';for(const[dx,dy]of [[0,-TILE_H*size/2],[TILE_W*size/2,0],[0,TILE_H*size/2],[-TILE_W*size/2,0]]){drawDiamond(cx+dx,cy+dy,5/view.zoom,3/view.zoom);ctx.fill();}}
}
function drawMinimap(){
  if(!mmc||!mm||!S)return;
  const rect=mm.getBoundingClientRect(),width=Math.max(30,Math.round(rect.width)||148),height=Math.max(30,Math.round(rect.height)||110),dpr=Math.min(2,window.devicePixelRatio||1),now=performance.now();
  if(mm.width!==Math.round(width*dpr)||mm.height!==Math.round(height*dpr)){mm.width=Math.round(width*dpr);mm.height=Math.round(height*dpr);minimapStamp=0;}
  mmc.setTransform(dpr,0,0,dpr,0,0);
  if(!minimapCache||minimapState!==S||now-minimapStamp>850||minimapCache.width!==width||minimapCache.height!==height||minimapCache.epoch!==rendererEpoch){
    const surface=document.createElement('canvas');surface.width=width;surface.height=height;const mc=surface.getContext('2d'),cw=width/MAP_W,ch=height/MAP_H;
    for(let y=0;y<MAP_H;y++)for(let x=0;x<MAP_W;x++){
      const t=S.tiles[y][x],b=t.b,d=b?BUILD[b.type]:null;let color='#7e9368';
      if(t.t==='water')color='#4c8e94';else if(t.t==='sand')color='#b8b182';else if(t.t==='tree')color='#4f744d';else if(t.t==='stone')color='#92927c';else if(t.t==='clay')color='#aa9069';else if(t.t==='copper')color='#a97e5b';
      if(b){if(b.type==='road')color=b.main?'#dec995':'#bcb28c';else if(isResidence(b))color='#e0c292';else if(d?.cat==='industry')color='#987157';else if(d?.cat==='agri')color='#aeaf65';else if(d?.cat==='decor')color='#5c8b55';else color='#bcb999';}
      mc.fillStyle=color;mc.fillRect(x*cw,y*ch,cw+.2,ch+.2);
    }
    minimapCache={surface,width,height,epoch:rendererEpoch};minimapStamp=now;minimapState=S;
  }
  mmc.clearRect(0,0,width,height);mmc.drawImage(minimapCache.surface,0,0,width,height);
  const r=cv.getBoundingClientRect();mmc.save();mmc.beginPath();mmc.rect(0,0,width,height);mmc.clip();mmc.beginPath();
  for(const [i,[px,py]]of [[0,[0,0]],[1,[r.width,0]],[2,[r.width,r.height]],[3,[0,r.height]]]){
    const sx=(px-view.ox)/view.zoom,sy=(py-view.oy)/view.zoom,fx=(sx/(TILE_W/2)+sy/(TILE_H/2))/2,fy=(sy/(TILE_H/2)-sx/(TILE_W/2))/2;
    mmc[i?'lineTo':'moveTo'](fx/MAP_W*width,fy/MAP_H*height);
  }
  mmc.closePath();mmc.fillStyle='rgba(255,240,195,.07)';mmc.fill();mmc.strokeStyle='#fff0c3';mmc.lineWidth=1.1;mmc.stroke();mmc.restore();
}
