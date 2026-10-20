/* Pointer-first map interaction. A tap selects; an intentional drag pans. */
const mapPointers=new Map();
let mapGesture=null;
let pinchState=null;
let loopStarted=false;
let mapControlFrame=0;
function canvasPoint(e){const r=cv.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top};}
function zoomAt(factor,px,py){const bx=(px-view.ox)/view.zoom,by=(py-view.oy)/view.zoom;view.zoom=Math.max(.24,Math.min(3.6,view.zoom*factor));view.ox=px-bx*view.zoom;view.oy=py-by*view.zoom;$('#zoomLabel').textContent=Math.round(view.zoom*100)+'%';}
function zoomCenter(factor){const r=cv.getBoundingClientRect();zoomAt(factor,r.width*.5,r.height*.43);}
function roadPath(a,b){const points=[];let x=a.x,y=a.y;points.push({x,y});const xFirst=Math.abs(b.x-a.x)>=Math.abs(b.y-a.y);const stepX=()=>{while(x!==b.x&&points.length<160){x+=Math.sign(b.x-x);points.push({x,y});}};const stepY=()=>{while(y!==b.y&&points.length<160){y+=Math.sign(b.y-y);points.push({x,y});}};if(xFirst){stepX();stepY();}else{stepY();stepX();}return points.map(p=>({...p,ok:inB(p.x,p.y)&&canBuildAt('road',p.x,p.y).ok}));}
cv.addEventListener('pointerdown',e=>{
 if(e.button===2)return;if($('#modal').classList.contains('show')||window.OnlineUI?.opened)return;e.preventDefault();closeHudPanels();cv.focus({preventScroll:true});const p=canvasPoint(e);mapPointers.set(e.pointerId,p);cv.setPointerCapture(e.pointerId);
 if(mapPointers.size===2){const [a,b]=[...mapPointers.values()],mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2};pinchState={distance:Math.hypot(a.x-b.x,a.y-b.y),zoom:view.zoom,worldX:(mid.x-view.ox)/view.zoom,worldY:(mid.y-view.oy)/view.zoom};if(mapGesture)mapGesture.moved=true;window.roadPreview=[];return;}
 const tile=screenToTile(p.x,p.y);mapGesture={id:e.pointerId,start:p,last:p,moved:false,road:selTool==='road'&&e.button===0&&!isVisiting(),startTile:tile};if(mapGesture.road)window.roadPreview=roadPath(tile,tile);
});
cv.addEventListener('pointermove',e=>{
 const p=canvasPoint(e);if(mapPointers.has(e.pointerId))mapPointers.set(e.pointerId,p);
 if(mapPointers.size>=2&&pinchState){const [a,b]=[...mapPointers.values()],mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2};view.zoom=Math.max(.24,Math.min(3.6,pinchState.zoom*Math.hypot(a.x-b.x,a.y-b.y)/Math.max(1,pinchState.distance)));view.ox=mid.x-pinchState.worldX*view.zoom;view.oy=mid.y-pinchState.worldY*view.zoom;return;}
 const tile=screenToTile(p.x,p.y);hover=inB(tile.x,tile.y)?tile:null;if(hover)$('#mapCoords').textContent=hover.x.toString().padStart(2,'0')+' / '+hover.y.toString().padStart(2,'0');
 if(!mapGesture||mapGesture.id!==e.pointerId)return;const distance=Math.hypot(p.x-mapGesture.start.x,p.y-mapGesture.start.y);if(distance>(e.pointerType==='touch'?9:5))mapGesture.moved=true;
 if(mapGesture.road){window.roadPreview=roadPath(mapGesture.startTile,tile);return;}
 if(mapGesture.moved){view.ox+=p.x-mapGesture.last.x;view.oy+=p.y-mapGesture.last.y;}mapGesture.last=p;
});
function finishPointer(e,cancelled=false){
 if(!mapPointers.has(e.pointerId))return;mapPointers.delete(e.pointerId);if(cv.hasPointerCapture(e.pointerId))cv.releasePointerCapture(e.pointerId);
 if(pinchState){if(mapPointers.size<2)pinchState=null;if(mapGesture)mapGesture.moved=true;if(mapPointers.size===1){const [id,p]=[...mapPointers.entries()][0];mapGesture={id,start:p,last:p,moved:true,road:false};}else mapGesture=null;window.roadPreview=[];return;}
 if(!mapGesture||mapGesture.id!==e.pointerId)return;const gesture=mapGesture;mapGesture=null;const p=canvasPoint(e),tile=screenToTile(p.x,p.y);
 if(cancelled){window.roadPreview=[];return;}
 if(gesture.road){const path=window.roadPreview.slice();window.roadPreview=[];if(protectVisit())return;let built=0,blocked=0;for(const pt of path){if(!inB(pt.x,pt.y)){blocked++;continue;}if(tileAt(pt.x,pt.y)?.b?.type==='road')continue;if(!canBuildAt('road',pt.x,pt.y).ok){blocked++;continue;}if(!afford('road')){toast('石料不足，已铺设 '+built+' 段道路。','bad');break;}if(doBuild('road',pt.x,pt.y))built++;}if(built>1)toast('已铺设 '+built+' 段道路'+(blocked?'，'+blocked+' 格因占用或地形跳过。':'。'),'good');else if(!built&&blocked)toast('道路不能铺设在这些位置。','bad');if(built)save();return;}
 if(gesture.moved||!inB(tile.x,tile.y))return;
 if(selTool){if(protectVisit())return;if(window.relocatingBuilding){const from=window.relocatingBuilding;if(typeof moveBuilding!=='function'){toast('迁移模块尚未就绪。','bad');return;}if(moveBuilding(from.x,from.y,tile.x,tile.y)){clearSelection();window.selectedTile={x:tile.x,y:tile.y};renderAll();save();}}else if(doBuild(selTool,tile.x,tile.y))save();}
 else{const b=tileAt(tile.x,tile.y)?.b;window.selectedTile=b?{x:b.origin?.[0]??tile.x,y:b.origin?.[1]??tile.y}:null;hud.info=!!b;renderInfo();}
}
cv.addEventListener('pointerup',e=>finishPointer(e));cv.addEventListener('pointercancel',e=>finishPointer(e,true));
cv.addEventListener('pointerleave',()=>{if(!mapGesture)hover=null;});
cv.addEventListener('contextmenu',e=>{e.preventDefault();clearSelection();mapGesture=null;mapPointers.clear();});
cv.addEventListener('wheel',e=>{e.preventDefault();const p=canvasPoint(e);zoomAt(Math.exp(-Math.max(-180,Math.min(180,e.deltaY))*.0015),p.x,p.y);},{passive:false});
mm.addEventListener('pointerdown',e=>{e.preventDefault();const r=mm.getBoundingClientRect();centerOnTile(Math.min(MAP_W-1,Math.max(0,(e.clientX-r.left)/r.width*MAP_W)),Math.min(MAP_H-1,Math.max(0,(e.clientY-r.top)/r.height*MAP_H)));});
function toggleBuilder(){setBuilderOpen(!hud.builder);}
function toggleDay(){const modes=['auto','day','night'];const current=typeof rendererSettings==='undefined'?'auto':rendererSettings.night;changeDayMode(modes[(modes.indexOf(current)+1)%3]);}
window.addEventListener('keydown',e=>{
 const input=e.target.closest('input,textarea,select,[contenteditable="true"]');if(input&&e.key!=='Escape')return;
 if($('#modal').classList.contains('show')){if(e.key==='Escape'&&modalCanClose){e.preventDefault();closeModal();}if(e.key==='Tab'){const elements=[...$('#modalCard').querySelectorAll('button,input,select,a[href]')].filter(el=>!el.disabled&&el.offsetParent!==null);const first=elements[0],last=elements.at(-1);if(e.shiftKey&&document.activeElement===first){last?.focus();e.preventDefault();}else if(!e.shiftKey&&document.activeElement===last){first?.focus();e.preventDefault();}}return;}
 if(window.OnlineUI?.opened)return;
 if(e.target.closest('button')&&(e.key===' '||e.key==='Enter'))return;
 if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();if(!protectVisit()&&save())toast('当前城市已保存。','good');return;}
 if(e.key==='Escape'){e.preventDefault();clearSelection();closeHudPanels();return;}
 if(e.key===' '){e.preventDefault();if(!isVisiting())setSpeed(speed===0?1:0);}
 else if(['1','2','4'].includes(e.key)){if(!isVisiting())setSpeed(+e.key);}
 else if(e.key.toLowerCase()==='b')toggleBuilder();else if(e.key.toLowerCase()==='i')openInventory();else if(e.key.toLowerCase()==='n')toggleDay();else if(e.key.toLowerCase()==='h')centerOnCity();else if(e.key==='+'||e.key==='=')zoomCenter(1.16);else if(e.key==='-'||e.key==='_')zoomCenter(.86);else if(e.key==='?'||e.key==='F1'){e.preventDefault();openHelp();}
 else if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();const amount=40;if(e.key==='ArrowLeft')view.ox+=amount;if(e.key==='ArrowRight')view.ox-=amount;if(e.key==='ArrowUp')view.oy+=amount;if(e.key==='ArrowDown')view.oy-=amount;}
});
function bindUI(){
 installIcons();syncHud();
 $('#infoBody').addEventListener('pointerdown',()=>{detailInteraction=true;});
 window.addEventListener('pointerup',()=>{if(detailInteraction){detailInteraction=false;requestAnimationFrame(renderInfo);}});
 window.addEventListener('pointercancel',()=>{detailInteraction=false;});
 document.querySelectorAll('.speedbox button').forEach(b=>b.onclick=()=>{if(!window.OnlineUI?.opened&&!$('#modal').classList.contains('show'))setSpeed(+b.dataset.speed);});
 $('#quickPauseBtn').onclick=()=>setSpeed(speed===0?1:0);$('#speedCycleBtn').onclick=()=>setSpeed(speed===1?2:speed===2?4:1);
 $('#homeBtn').onclick=openCityOverview;$('#cityIdentity').onclick=openSaves;$('#saveBtn').onclick=openSaves;$('#inventoryBtn').onclick=openInventory;$('#helpBtn').onclick=openHelp;$('#settingsBtn').onclick=openSettings;
 $('#onlineBtn').onclick=()=>{closeHudPanels();if(window.OnlineUI?.open)window.OnlineUI.open();else toast('在线模块尚未准备好，请稍后重试。','bad');};
 $('#closeInfo').onclick=clearSelection;$('#buildToggle').onclick=()=>setBuilderOpen(false);$('#buildOpenBtn').onclick=toggleBuilder;$('#roadToolBtn').onclick=()=>selectBuildTool('road');
 $('#buildSearch').oninput=e=>{buildSearch=e.target.value.trim();buildRenderSignature='';renderBuildList();};
 $('#taskToggle').onclick=()=>toggleHudPanel('tasks');$('#closeTasks').onclick=()=>closeHudPanels();
 $('#viewBtn').onclick=()=>toggleHudPanel('view');$('#closeView').onclick=()=>closeHudPanels();$('#menuBtn').onclick=()=>toggleHudPanel('menu');$('#closeMenu').onclick=()=>closeHudPanels();
 $('#minimapToggle').onclick=()=>{closeHudPanels();hud.minimap=true;syncHud();};$('#closeMinimap').onclick=()=>closeHudPanels();
 $('#zoomInBtn').onclick=()=>zoomCenter(1.16);$('#zoomOutBtn').onclick=()=>zoomCenter(.86);$('#centerBtn').onclick=()=>{centerOnCity();closeHudPanels();};$('#dayBtn').onclick=toggleDay;
 $('#overlaySelect').onchange=e=>{if(typeof rendererSettings!=='undefined')rendererSettings.overlay=e.target.value;if(typeof invalidateRenderer==='function')invalidateRenderer();};
 $('#logBtn').onclick=()=>toggleHudPanel('log');$('#closeLog').onclick=()=>closeHudPanels();
 $('#placementInfoBtn').onclick=openBlueprint;$('#cancelPlacementBtn').onclick=clearSelection;
 $('#importFile').onchange=e=>{importSaveFile(e.target.files[0]);e.target.value='';};
 $('#modal').addEventListener('click',e=>{if(e.target.id==='modal'&&modalCanClose)closeModal();});
 if(typeof rendererSettings!=='undefined')rendererSettings.reducedMotion=uiSettings.reducedMotion;
 window.addEventListener('beforeunload',()=>{if(uiSettings.autosave&&!isVisiting())save();});
 document.addEventListener('visibilitychange',()=>{if(document.hidden&&uiSettings.autosave&&!isVisiting())save();});
}
function loop(){render();if(++mapControlFrame%20===0)$('#zoomLabel').textContent=Math.round(view.zoom*100)+'%';requestAnimationFrame(loop);}
function boot(){
 buildCat='recommended';bindUI();resizeCanvas();window.addEventListener('resize',()=>resizeCanvas());
 let existing=false;try{existing=!!localStorage.getItem(SAVE_KEY);}catch(err){toast('浏览器存储不可用，请通过导出档案保留进度。','bad');}
 let loaded=load();if(!loaded&&!existing&&typeof LEGACY_SAVE_KEY!=='undefined'){loaded=load(LEGACY_SAVE_KEY);if(loaded){save();toast('旧城市已迁移到扩展疆域。','good');}}
 if(!loaded){uiSaveSuppressed=true;newGame({civilization:'china',cityName:'长乐',seed:'dawn-first-city',mode:'campaign'});setSpeed(0);openNewGame(true);}else{setSpeed(1);log('城市档案已恢复。欢迎归来。','good');}
 renderAll();updateHint();if(typeof centerOnCity==='function')centerOnCity();if(!loopStarted){loopStarted=true;loop();}
 if(window.GameArt?.ready&&typeof GameArt.ready.then==='function')GameArt.ready.then(refreshArt).catch(err=>console.warn('部分美术未加载',err));
 window.addEventListener('modular-art-ready',()=>paintBuildingThumbnails(document));
 if(window.ModularBuildings?.ready?.then)ModularBuildings.ready.then(()=>paintBuildingThumbnails(document)).catch(err=>console.warn('建筑材质未就绪',err));
}
boot();
