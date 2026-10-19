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
let nightSurface=null,nightGlow=null,nightSurfaceKey='';
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
function cameraUsableHeight(r){return Math.max(180,r.height-(parseFloat(getComputedStyle(document.body).getPropertyValue('--builder-h'))||205));}
function centerOnTile(x,y,zoom){
  const r=cv.getBoundingClientRect();
  const p=tileToScreen(Math.max(0,Math.min(MAP_W-1,x)),Math.max(0,Math.min(MAP_H-1,y)));
  if(Number.isFinite(zoom))view.zoom=Math.max(.25,Math.min(2.5,zoom));
  view.ox=r.width/2-p.sx*view.zoom;view.oy=cameraUsableHeight(r)*.52+35-p.sy*view.zoom;clampView(r);
}
function centerOnCity(){
  if(!S){centerOnTile(MAP_W/2,MAP_H/2,1);return;}
  let points=[];
  for(let y=0;y<MAP_H;y++)for(let x=0;x<MAP_W;x++){
    const b=S.tiles[y]?.[x]?.b;
    if(b&&b.type!=='road'&&(!b.origin||(b.origin[0]===x&&b.origin[1]===y))){
      const z=(BUILD[b.type]?.size||1)-1;points.push(tileToScreen(x+z/2,y+z/2));
    }
  }
  if(!points.length){centerOnTile(S.start?.x??MAP_W/2,S.start?.y??MAP_H/2,1);return;}
  const r=cv.getBoundingClientRect();
  const minX=Math.min(...points.map(p=>p.sx)),maxX=Math.max(...points.map(p=>p.sx));
  const minY=Math.min(...points.map(p=>p.sy))-100,maxY=Math.max(...points.map(p=>p.sy))+70;
  view.zoom=Math.max(.55,Math.min(1.1,(r.width-130)/(maxX-minX+TILE_W*3),(cameraUsableHeight(r)-40)/(maxY-minY+TILE_H*3)));
  view.ox=r.width/2-(minX+maxX)/2*view.zoom;
  view.oy=cameraUsableHeight(r)*.52+35-(minY+maxY)/2*view.zoom;clampView(r);
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
  if(rendererSettings.night==='night')return .78;if(rendererSettings.night==='day')return 0;
  const phase=((S?.tick||0)%480)/480;
  return Math.max(0,Math.min(.78,(Math.cos((phase-.75)*Math.PI*2)-.15)*1.05));
}
function render(){
  const started=performance.now(),r=cv.getBoundingClientRect(),dpr=Math.min(2,window.devicePixelRatio||1);
  ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,r.width,r.height);
  const bg=ctx.createLinearGradient(0,0,r.width,r.height);bg.addColorStop(0,'#243e37');bg.addColorStop(1,'#101f20');ctx.fillStyle=bg;ctx.fillRect(0,0,r.width,r.height);
  if(!S)return;
  if(renderState!==S){renderState=S;invalidateRenderer();centerOnCity();}
  const delta=lastRenderFrame?Math.min(80,started-lastRenderFrame):0;lastRenderFrame=started;
  if(speed>0&&!rendererSettings.reducedMotion)renderClock+=delta*Math.min(speed,2);
  rendererBounds={left:-view.ox/view.zoom,right:(r.width-view.ox)/view.zoom,top:-view.oy/view.zoom,bottom:(r.height-view.oy)/view.zoom};
  rendererLights=[];rendererMasks=[];rendererNight=getNightAmount();
  ctx.save();ctx.translate(view.ox,view.oy);ctx.scale(view.zoom,view.zoom);
  drawMapEdge();
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
    }else if(!b&&['tree','stone','clay','copper'].includes(tile.t)&&inViewport(p.sx,p.sy,100,150))objects.push({kind:tile.t,x,y,p,depth:x+y+.05});
  }
  drawRoadNetwork(roads);
  drawOverlay();drawCoverage();drawSelectionGround();drawRoadPreview();
  if(view.zoom>.45)drawCitizens(roads,objects);
  objects.sort((a,b)=>a.depth-b.depth||a.x-b.x);
  for(const o of objects){if(o.kind==='person'){drawPerson(o.px,o.py,o.color,o.seed);continue;}if(o.kind==='building')drawBuilding(o.x,o.y,o.b);else if(o.kind==='tree')drawTree(o.p.sx,o.p.sy,o.x,o.y);else if(o.kind==='stone'||o.kind==='copper')drawRock(o.p.sx,o.p.sy,o.x,o.y,o.kind==='copper');else drawClay(o.p.sx,o.p.sy,o.x,o.y);}
  drawHover();
  ctx.restore();
  drawAtmosphere(r);
  drawMinimap();
  rendererStats.visibleTiles=tileCount;rendererStats.visibleBuildings=objects.filter(o=>o.kind==='building').length;rendererStats.frameMs=Math.round((performance.now()-started)*10)/10;
}
function drawMapEdge(){
  const p=tileToScreen((MAP_W-1)/2,(MAP_H-1)/2),w=MAP_W*TILE_W,h=MAP_H*TILE_H;
  drawDiamond(p.sx,p.sy+14,w,h);ctx.fillStyle='#263a2d';ctx.fill();
  drawDiamond(p.sx,p.sy+6,w,h);ctx.fillStyle='#5b6746';ctx.fill();
}
const TERRAIN_FILL={grass:['#81966a','#809569','#83976c','#7f9469'],sand:['#c8bb8d','#c5b587','#cdbc96'],tree:['#7e9468','#7f956a'],stone:['#8e957a','#879071'],clay:['#ab9a70','#b19e78'],copper:['#a79771','#a3916b'],water:['#4c8c91','#4c9095','#508e95'],shore:['#beb68b','#c3bc94']};
function drawTileGround(x,y,t,p){
  const civ=currentCivilization(),seed=hash2(x,y);
  let colors=TERRAIN_FILL[t.t]||TERRAIN_FILL.grass;
  if(t.t==='grass'||t.t==='tree'){
    if(civ==='egypt')colors=['#b5b77a','#b4b67a','#b7b87d'];
    if(civ==='persia')colors=['#a4ae7d','#a6af7e','#a3ad7c'];
    if(civ==='aztec')colors=['#708e65','#728f66','#708d64'];
  }
  const fill=colors[Math.floor(seed*colors.length)],surface=['sand','water'].includes(t.t)?t.t:'grass';
  const ground=getGroundTile(fill,surface);ctx.drawImage(ground,p.sx-ground.width/2,p.sy-ground.height/2);
  if(t.t==='water'){drawWater(x,y,p);return;}
  if(t.b?.type==='road')return;
  // Sparse reusable details keep the terrain quiet enough for the architecture.
  if(view.zoom>.42){
    ctx.fillStyle=t.t==='sand'?'rgba(107,100,66,.16)':'rgba(52,87,43,.13)';
    for(let i=0;i<3;i++){const hx=hash2(x+i*61,y+19),hy=hash2(x+39,y+i*47);ctx.fillRect(p.sx+(hx-.5)*TILE_W*.6,p.sy+(hy-.5)*TILE_H*.54,1.5+seed*2,1);}
    if(!t.b&&seed>.89&&(t.t==='grass'||t.t==='tree')){ctx.fillStyle='#b9bf89';ctx.fillRect(p.sx+8,p.sy+2,2,1.3);ctx.fillRect(p.sx+11,p.sy+4,2,1.3);}
  }
  for(const [dx,dy] of DIRS){if(tileAt(x+dx,y+dy)?.t==='water'){
    const ex=p.sx+(dx-dy)*TILE_W/4,ey=p.sy+(dx+dy)*TILE_H/4;
    ctx.strokeStyle='rgba(222,211,157,.7)';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(ex-(dx+dy)*TILE_W/4,ey+(dx-dy)*TILE_H/4);ctx.lineTo(ex+(dx+dy)*TILE_W/4,ey-(dx-dy)*TILE_H/4);ctx.stroke();
  }}
  if(rendererSettings.grid||selTool){drawDiamond(p.sx,p.sy,TILE_W,TILE_H);ctx.strokeStyle='rgba(41,61,38,.16)';ctx.lineWidth=.65;ctx.stroke();}
}
function getGroundTile(fill,surface){
  const key=fill+surface;if(groundTileCache.has(key))return groundTileCache.get(key);
  const tile=document.createElement('canvas');tile.width=TILE_W+2;tile.height=TILE_H+2;const tc=tile.getContext('2d'),cx=tile.width/2,cy=tile.height/2;
  tc.beginPath();tc.moveTo(cx,cy-(TILE_H+.7)/2);tc.lineTo(cx+(TILE_W+.7)/2,cy);tc.lineTo(cx,cy+(TILE_H+.7)/2);tc.lineTo(cx-(TILE_W+.7)/2,cy);tc.closePath();tc.fillStyle=fill;tc.fill();
  const texture=getTerrainTexture(surface);if(texture){tc.globalAlpha=surface==='water'?.36:surface==='sand'?.24:.16;tc.drawImage(texture,0,0);}
  groundTileCache.set(key,tile);return tile;
}
function getTerrainTexture(surface){
  if(terrainTextureCache.has(surface))return terrainTextureCache.get(surface);
  const now=performance.now();if((terrainTextureMiss.get(surface)||0)>now)return null;
  const texture=document.createElement('canvas');texture.width=TILE_W+2;texture.height=TILE_H+2;
  if(!window.GameArt?.drawTerrain?.(texture.getContext('2d'),surface,texture.width/2,texture.height/2,TILE_W+.5,TILE_H+.5)){terrainTextureMiss.set(surface,now+300);return null;}
  terrainTextureCache.set(surface,texture);return texture;
}
function drawWater(x,y,p){
  const seed=hash2(x,y),time=renderClock/2300;
  if(view.zoom>.35){ctx.strokeStyle=`rgba(185,226,213,${.13+Math.sin(time+seed*8)*.055})`;ctx.lineWidth=1;
    for(let i=0;i<2;i++){const a=p.sx+(seed-.5)*34+i*7,b=p.sy-4+i*8;ctx.beginPath();ctx.moveTo(a-9,b);ctx.quadraticCurveTo(a,b+Math.sin(time+seed*10)*1.5,a+8,b);ctx.stroke();}
  }
  for(const [dx,dy]of DIRS){const n=tileAt(x+dx,y+dy);if(n&&n.t!=='water'){
    const ex=p.sx+(dx-dy)*TILE_W/4,ey=p.sy+(dx+dy)*TILE_H/4;
    ctx.strokeStyle='rgba(203,229,204,.42)';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(ex-(dx+dy)*TILE_W/4,ey+(dx-dy)*TILE_H/4);ctx.lineTo(ex+(dx+dy)*TILE_W/4,ey-(dx-dy)*TILE_H/4);ctx.stroke();
  }}
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
  for(const{k,path}of paths){ctx.strokeStyle=k==='bridge'?'#ad936a':k==='main'?'#c1b68f':'#b5aa84';ctx.lineWidth=16;ctx.stroke(path);}
  ctx.lineCap='butt';
  if(view.zoom>.5)for(const{x,y,p}of roads){if(S.tiles[y][x].t!=='water')drawRoadTexture(x,y,p);drawRoadDetails(x,y,S.tiles[y][x].b,p,S.tiles[y][x].t==='water');}
}
function drawRoadTexture(x,y,p){
  if(!window.GameArt?.drawTerrain)return;
  ctx.save();ctx.beginPath();ctx.rect(p.sx-5,p.sy-5,10,10);
  for(const[dx,dy]of DIRS){if(tileAt(x+dx,y+dy)?.b?.type!=='road')continue;const vx=(dx-dy)*TILE_W/4,vy=(dx+dy)*TILE_H/4,len=Math.hypot(vx,vy),nx=-vy/len*8,ny=vx/len*8;ctx.moveTo(p.sx+nx,p.sy+ny);ctx.lineTo(p.sx+vx+nx,p.sy+vy+ny);ctx.lineTo(p.sx+vx-nx,p.sy+vy-ny);ctx.lineTo(p.sx-nx,p.sy-ny);ctx.closePath();}
  ctx.clip();ctx.globalAlpha=.42;const texture=getTerrainTexture('road');if(texture)ctx.drawImage(texture,p.sx-texture.width/2,p.sy-texture.height/2);ctx.restore();
}
function drawRoadDetails(x,y,b,p,bridge){
  const links=DIRS.filter(([dx,dy])=>tileAt(x+dx,y+dy)?.b?.type==='road');
  ctx.strokeStyle=bridge?'rgba(96,77,49,.33)':'rgba(237,222,178,.45)';ctx.lineWidth=.7;
  for(const[dx,dy]of links){const ex=p.sx+(dx-dy)*TILE_W/4,ey=p.sy+(dx+dy)*TILE_H/4;for(let i=1;i<=2;i++){const f=i/3,xx=p.sx+(ex-p.sx)*f,yy=p.sy+(ey-p.sy)*f;ctx.beginPath();ctx.moveTo(xx-3*(dx+dy),yy+3*(dx-dy));ctx.lineTo(xx+3*(dx+dy),yy-3*(dx-dy));ctx.stroke();}}
  if(bridge){ctx.strokeStyle='#7e714c';ctx.lineWidth=1.6;for(const[dx,dy]of links){const ex=p.sx+(dx-dy)*TILE_W/2,ey=p.sy+(dx+dy)*TILE_H/2;for(const side of[-1,1]){const off=side*7;ctx.beginPath();ctx.moveTo(p.sx+off,p.sy-6);ctx.lineTo(ex+off,ey-6);ctx.stroke();for(const f of[0,.5,1]){const xx=p.sx+(ex-p.sx)*f+off,yy=p.sy+(ey-p.sy)*f;ctx.beginPath();ctx.moveTo(xx,yy-7);ctx.lineTo(xx,yy+2);ctx.stroke();}}}}
  if(b.main&&hash2(x,y)>.82){ctx.fillStyle='#6c6242';ctx.fillRect(p.sx-15,p.sy-14,2,14);ctx.fillStyle='#d7bd70';ctx.fillRect(p.sx-18,p.sy-17,8,5);if(rendererNight>.1)rendererLights.push({x:p.sx-14,y:p.sy-16,r:36,power:.65});}
}
function drawTile(x,y){const t=tileAt(x,y);if(t)drawTileGround(x,y,t,tileToScreen(x,y));}
function drawTree(sx,sy,x,y){
  const seed=hash2(x,y),s=.8+seed*.5,wind=Math.sin(renderClock/1600+x)*1.3;
  const civ=currentCivilization(),variant=civ==='egypt'?2:civ==='persia'?(seed>.6?1:2):civ==='greece'?(seed>.5?1:0):civ==='china'&&seed>.82?3:0;
  if(window.GameArt?.drawTerrain?.(ctx,'tree',sx,sy,TILE_W*(.65+seed*.22),TILE_H*.35,variant))return;
  ctx.fillStyle='rgba(32,53,31,.17)';ctx.beginPath();ctx.ellipse(sx+6,sy+3,17*s,7*s,-.12,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#6d6b43';ctx.fillRect(sx-2*s,sy-28*s,4*s,30*s);
  const layers=[[-9,-28,13,'#4c7047'],[7,-31,15,'#557a4b'],[-2,-43,16,'#628650'],[-8,-42,10,'#77935a'],[5,-49,10,'#79975b']];
  for(const[a,b,r,c]of layers){ctx.fillStyle=c;ctx.beginPath();ctx.ellipse(sx+(a+wind)*s,sy+b*s,r*s,r*s*.85,0,0,Math.PI*2);ctx.fill();}
  ctx.fillStyle='rgba(182,197,114,.25)';ctx.beginPath();ctx.ellipse(sx-5*s+wind,sy-48*s,7*s,5*s,-.2,0,Math.PI*2);ctx.fill();
}
function drawRock(sx,sy,x,y,copper=false){
  if(window.GameArt?.drawTerrain?.(ctx,copper?'copper':'stone',sx,sy,TILE_W*.78,TILE_H*.4,0))return;
  const seed=hash2(x,y);ctx.fillStyle='rgba(37,49,29,.16)';ctx.beginPath();ctx.ellipse(sx+3,sy+3,19,7,0,0,Math.PI*2);ctx.fill();
  for(const[dx,dy,w,h]of [[0,0,18,22],[13,3,11,12],[-13,3,10,12]]){
    const xx=sx+dx,yy=sy+dy;polygon([[xx-w/2,yy],[xx-w*.65,yy-h*.5],[xx-w*.1,yy-h],[xx+w*.5,yy-h*.7],[xx+w*.6,yy-h*.15],[xx+w*.3,yy+2]],copper?'#a48b68':'#9d9e8a');
    polygon([[xx-w*.1,yy-h],[xx+w*.5,yy-h*.7],[xx+w*.6,yy-h*.15],[xx+w*.3,yy+2],[xx,yy-h*.3]],copper?'#8a7758':'#7c8472');
    polygon([[xx-w*.65,yy-h*.5],[xx-w*.1,yy-h],[xx+w*.5,yy-h*.7],[xx,yy-h*.3]],copper?'#c5ab7d':'#b3b39a');
  }
}
function drawClay(sx,sy,x,y){if(window.GameArt?.drawTerrain?.(ctx,'clay',sx,sy,TILE_W*.82,TILE_H*.45,0))return;ctx.fillStyle='#a38d63';ctx.beginPath();ctx.ellipse(sx,sy+2,22,9,0,0,Math.PI*2);ctx.fill();ctx.fillStyle='#c0a67c';ctx.beginPath();ctx.ellipse(sx-5,sy-1,15,7,0,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#8d7954';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(sx-12,sy+2);ctx.lineTo(sx+3,sy+5);ctx.lineTo(sx+12,sy);ctx.stroke();}
function buildingGeometry(x,y,b){const size=BUILD[b.type]?.size||1,p=tileToScreen(x,y);return{cx:p.sx,cy:p.sy+(size-1)*TILE_H/2,size,width:size*TILE_W,height:size*TILE_H};}
function drawFoundation(g,b){
  drawDiamond(g.cx,g.cy,g.width*.91,g.height*.91);ctx.fillStyle=b.construction?'#aaa17a':'#b6b18f';ctx.fill();
  ctx.strokeStyle='rgba(70,76,51,.25)';ctx.lineWidth=1;ctx.stroke();
}
function drawBuildingArt(g,b,level=b.lvl||1,opacity=1){
  if(opacity!==1){ctx.save();ctx.globalAlpha*=opacity;}
  let drawn=false;
  if(window.GameArt?.drawBuilding)drawn=window.GameArt.drawBuilding(ctx,{type:b.type,civ:currentCivilization(),level,cx:g.cx,cy:g.cy,width:g.width,height:g.height,time:renderClock,construction:b.construction||null})!==false;
  if(!drawn)drawStructure(g.cx,g.cy,{...b,lvl:level},g.size===1?1.7:g.size===2?2.35:3.2,g.size);
  if(opacity!==1)ctx.restore();return drawn;
}
function drawBuilding(x,y,b){
  const d=BUILD[b.type];if(!d)return;
  const g=buildingGeometry(x,y,b),selected=window.selectedTile&&tileAt(window.selectedTile.x,window.selectedTile.y)?.b===b;
  ctx.save();
  drawFoundation(g,b);
  const underConstruction=b.construction&&b.construction.remaining>0;
  const transparent=rendererSettings.overlay==='foundation'||rendererSettings.overlay==='foundations';
  if(transparent)ctx.globalAlpha=.23;
  if(underConstruction)drawConstruction(g,b);else{drawBuildingArt(g,b);drawBuildingAnimation(g,b);}
  ctx.restore();
  if(rendererNight>.1)addBuildingLights(g,b,underConstruction);
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
  const c=b.construction,progress=Math.max(0,Math.min(1,1-c.remaining/Math.max(1,c.total)));
  const upgrade=!!c.fromLevel;
  if(upgrade)drawBuildingArt(g,b,c.fromLevel,.8);
  ctx.save();
  // Reveal the new architecture from its base; upgrades preserve the existing building.
  const bottom=g.cy+g.height*.5,height=g.width*(.32+progress*.85);
  ctx.beginPath();ctx.rect(g.cx-g.width*.6,bottom-height,g.width*1.2,height+8);ctx.clip();
  drawBuildingArt(g,b,c.toLevel||b.lvl||1,upgrade?.5:.93);ctx.restore();
  if(progress<.25&&!upgrade){ctx.fillStyle='rgba(173,156,106,.55)';drawDiamond(g.cx,g.cy,g.width*.84,g.height*.84);ctx.fill();}
  const siteSprite=window.GameArt?.drawConstruction?.(ctx,{type:b.type,civ:currentCivilization(),cx:g.cx,cy:g.cy,width:g.width,height:g.height,progress,fromLevel:c.fromLevel||0,toLevel:c.toLevel||b.lvl||1,time:renderClock+b.id*73,upgrade});
  if(siteSprite){
    const barW=Math.min(55,g.width*.45),by=g.cy+g.height*.5+7;
    ctx.fillStyle='#394937';ctx.fillRect(g.cx-barW/2,by,barW,3);ctx.fillStyle='#dfc484';ctx.fillRect(g.cx-barW/2,by,barW*progress,3);
    return;
  }
  const scaffoldH=g.width*(.23+progress*.35),w=g.width*.38,h=g.height*.38;
  const posts=[[-w,0],[0,h],[w,0],[0,-h]];
  ctx.lineWidth=1.7;ctx.strokeStyle='#7a6240';
  for(const[a,z]of posts){ctx.beginPath();ctx.moveTo(g.cx+a,g.cy+z);ctx.lineTo(g.cx+a,g.cy+z-scaffoldH);ctx.stroke();}
  for(let k=1;k<=3;k++){const y=scaffoldH*k/3;ctx.beginPath();ctx.moveTo(g.cx-w,g.cy-y);ctx.lineTo(g.cx,g.cy+h-y);ctx.lineTo(g.cx+w,g.cy-y);ctx.stroke();}
  ctx.strokeStyle='#a88c59';ctx.lineWidth=1.1;
  for(const direction of [-1,1]){ctx.beginPath();ctx.moveTo(g.cx,g.cy+h);ctx.lineTo(g.cx+direction*w,g.cy-scaffoldH);ctx.moveTo(g.cx+direction*w,g.cy);ctx.lineTo(g.cx,g.cy+h-scaffoldH);ctx.stroke();}
  ctx.strokeStyle='#d1bc82';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(g.cx-w,g.cy-scaffoldH*.67);ctx.lineTo(g.cx,g.cy+h-scaffoldH*.67);ctx.lineTo(g.cx+w,g.cy-scaffoldH*.67);ctx.stroke();
  // A small hoist, moving workers and rising dust communicate active construction.
  const move=rendererSettings.reducedMotion?0:Math.sin(renderClock/900+b.id);
  ctx.strokeStyle='#785a39';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(g.cx+w*.7,g.cy-scaffoldH-7);ctx.lineTo(g.cx+w*.7,g.cy-5);ctx.moveTo(g.cx+w*.35,g.cy-scaffoldH-7);ctx.lineTo(g.cx+w*1.15,g.cy-scaffoldH-7);ctx.stroke();
  ctx.strokeStyle='#c8b082';ctx.lineWidth=.7;ctx.beginPath();ctx.moveTo(g.cx+w*1.1,g.cy-scaffoldH-7);ctx.lineTo(g.cx+w*1.1,g.cy-scaffoldH*.4+move*6);ctx.stroke();ctx.fillStyle='#9e7a47';ctx.fillRect(g.cx+w*1.1-3,g.cy-scaffoldH*.4+move*6,6,5);
  for(let i=0;i<2;i++){const phase=(renderClock/5500+i*.45+b.id*.13)%1,px=g.cx-w+phase*w*2,py=g.cy+h*.6+Math.sin(phase*Math.PI)*5;drawPerson(px,py,i?'#a95138':'#e0c284',i);}
  if(!rendererSettings.reducedMotion&&speed>0)for(let i=0;i<3;i++){const f=(renderClock/1700+i*.33)%1;ctx.fillStyle=`rgba(228,212,173,${(1-f)*.25})`;ctx.beginPath();ctx.arc(g.cx+w*.4+Math.sin(i*5)*8,g.cy+h*.5-f*20,2+f*5,0,Math.PI*2);ctx.fill();}
  const barW=Math.min(55,g.width*.45),by=g.cy+g.height*.5+7;
  ctx.fillStyle='#394937';ctx.fillRect(g.cx-barW/2,by,barW,3);ctx.fillStyle='#dfc484';ctx.fillRect(g.cx-barW/2,by,barW*progress,3);
}
function drawBuildingAnimation(g,b){
  if(view.zoom<.4)return;
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
  if(emissionMaskCache.has(meta.key))return emissionMaskCache.get(meta.key);
  const mask=document.createElement('canvas');mask.width=256;mask.height=Math.ceil(256*meta.height/meta.width);const mc=mask.getContext('2d');
  mc.fillStyle='#ffe5a0';
  for(const point of meta.lights){const x=point.x*mask.width,y=point.y*mask.height,skew=point.x<.5?1:-1;mc.beginPath();mc.moveTo(x-3,y-4);mc.lineTo(x+3,y-4+2*skew);mc.lineTo(x+3,y+4+2*skew);mc.lineTo(x-3,y+4);mc.closePath();mc.fill();}
  // The actual sprite alpha clips the emissive windows to the architecture.
  mc.globalCompositeOperation='destination-in';
  const loaded=GameArt.drawBuilding(mc,{type:b.type,civ:currentCivilization(),level:b.lvl||1,cx:128,cy:mask.height-64,width:256,height:128});
  if(!loaded)return null;
  emissionMaskCache.set(meta.key,mask);return mask;
}
function addBuildingLights(g,b,construction){
  if(!construction&&['farmland','vegFarm','pasture','orchard','treeDeco','quarry','clayPit','copperMine','monument'].includes(b.type))return;
  const meta=window.GameArt?.metadata?.(b.type,currentCivilization(),b.lvl||1);
  if(!construction&&meta?.width&&meta?.height){
    const h=g.width*meta.height/meta.width,top=g.cy+g.height/2-h;
    for(const point of meta.lights||[])rendererLights.push({x:g.cx-g.width/2+point.x*g.width,y:top+point.y*h,r:26+g.size*8,power:.63,masked:true});
    const mask=getEmissionMask(g,b,meta);if(mask)rendererMasks.push({mask,x:g.cx-g.width/2,y:top,width:g.width,height:h});return;
  }
  const size=g.size,points=construction?[[-.27,.13],[.25,.1]]:[[-.2,-.13],[.19,-.05],[0,.19]];
  if(['farmland','vegFarm','pasture','treeDeco','quarry','clayPit'].includes(b.type))return;
  for(let i=0;i<Math.min(points.length,size+1);i++){const[a,c]=points[i];rendererLights.push({x:g.cx+a*g.width,y:g.cy+c*g.height-5,r:(construction?34:30)+size*9,power:construction?.7:.64});}
}
function drawPerson(x,y,color,seed){
  ctx.fillStyle='rgba(28,35,22,.2)';ctx.beginPath();ctx.ellipse(x+1,y+1,3,1.4,0,0,Math.PI*2);ctx.fill();ctx.fillStyle=color;ctx.fillRect(x-1.5,y-5,3,4);ctx.fillStyle='#d0ae7b';ctx.beginPath();ctx.arc(x,y-6,1.5,0,Math.PI*2);ctx.fill();
  if(view.zoom>.7){ctx.strokeStyle='#655d43';ctx.lineWidth=.8;const step=Math.sin(renderClock/120+seed)*1.2;ctx.beginPath();ctx.moveTo(x-.6,y-1);ctx.lineTo(x-1+step,y+1);ctx.moveTo(x+.6,y-1);ctx.lineTo(x+1-step,y+1);ctx.stroke();}
}
function drawCitizens(roads,objects){
  let drawn=0;
  for(const{x,y,p}of roads){if(hash2(x+9,y+7)>.16||drawn>=36)continue;
    const links=DIRS.filter(([dx,dy])=>tileAt(x+dx,y+dy)?.b?.type==='road');if(!links.length)continue;
    const seed=hash2(x,y),[dx,dy]=links[Math.floor(seed*links.length)],phase=(renderClock/6200+seed)%1;
    objects.push({kind:'person',x,y,depth:x+y+(dx+dy)*phase+.08,px:p.sx+(dx-dy)*TILE_W/2*phase,py:p.sy+(dx+dy)*TILE_H/2*phase,color:['#b25b3d','#d3bf83','#4d726c'][Math.floor(seed*3)],seed:x+y});drawn++;
  }
}
function drawAtmosphere(r){
  if(rendererNight<.02)return;
  ctx.save();ctx.fillStyle=`rgba(10,25,45,${rendererNight*.78})`;ctx.fillRect(0,0,r.width,r.height);
  if(!nightSurface)nightSurface=document.createElement('canvas');
  if(nightSurface.width!==Math.ceil(r.width)||nightSurface.height!==Math.ceil(r.height)){nightSurface.width=Math.ceil(r.width);nightSurface.height=Math.ceil(r.height);}
  if(!nightGlow){nightGlow=document.createElement('canvas');nightGlow.width=nightGlow.height=128;const gc=nightGlow.getContext('2d'),gradient=gc.createRadialGradient(64,64,0,64,64,64);gradient.addColorStop(0,'rgba(255,188,75,.62)');gradient.addColorStop(.3,'rgba(241,160,50,.21)');gradient.addColorStop(1,'rgba(236,160,59,0)');gc.fillStyle=gradient;gc.fillRect(0,0,128,128);}
  const lightKey=[view.ox,view.oy,view.zoom,r.width,r.height,rendererNight.toFixed(3),rendererEpoch,rendererLights.length,rendererMasks.length,rendererLights.reduce((sum,p)=>sum+p.x*.13+p.y*.17+p.r*.71,0)].join(':');
  if(lightKey===nightSurfaceKey){ctx.globalCompositeOperation='screen';ctx.drawImage(nightSurface,0,0,r.width,r.height);ctx.restore();return;}
  nightSurfaceKey=lightKey;
  const light=nightSurface.getContext('2d');light.setTransform(1,0,0,1,0,0);light.clearRect(0,0,nightSurface.width,nightSurface.height);light.translate(view.ox,view.oy);light.scale(view.zoom,view.zoom);
  // Composite the complete emission layer once. Per-building screen blending
  // stalls software/mobile canvas backends in large cities.
  for(const point of rendererLights){const power=point.power*rendererNight;light.globalAlpha=power;light.drawImage(nightGlow,point.x-point.r,point.y-point.r,point.r*2,point.r*2);if(!point.masked){light.globalAlpha=1;light.fillStyle=`rgba(255,221,139,${Math.min(.95,power+.15)})`;light.fillRect(point.x-1.5,point.y-3,3,4);}}
  light.globalAlpha=Math.min(1,rendererNight*1.2);for(const item of rendererMasks)light.drawImage(item.mask,item.x,item.y,item.width,item.height);light.globalAlpha=1;
  ctx.globalCompositeOperation='screen';ctx.drawImage(nightSurface,0,0,r.width,r.height);ctx.restore();
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
