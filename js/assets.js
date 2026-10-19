"use strict";
/* Original AI-generated art; see assets/manifest.json for provenance.
 * Coordinates: cx/cy = ground footprint center; width/height = footprint size.
 */
(function(global){
  const CIVS = ['china','egypt','greece','persia','aztec'];
  const CORE = ['house1','house2','house3','palace','temple','market','well','granary','workshop','school','barracks','farm','harbor','garden','theater','observatory'];
  const COMMON = ['watch','police','clinic','repair','grainShop','vegShop','fruitShop','fishShop','meatShop','lumber','quarry','clayPit','kiln','mill','weaver','winery'];
  const NATURAL = ['grass','sand','water','road','oak','cypress','palm','cherry','stone','copper','clay','reeds','monument','pasture','orchard','bath'];
  const LANDMARKS = ['pagoda','china-wonder','sphinx','egypt-wonder','agora','greece-wonder','windTower','persia-wonder','sunTemple','aztec-wonder','university','bath','copperMine','warehouse','vegFarm','harbor'];
  const cache = new Map(), failures = new Set(), rasterCache = new Map();
  let atlasMetadata = {};
  const baseURL = new URL('../assets/', document.currentScript?.src || new URL('js/assets.js',location.href));
  const aliases = { wonder:'palace',pagoda:'temple',sphinx:'palace',agora:'school',windTower:'observatory',sunTemple:'temple',farmland:'farm',vegFarm:'farm',fishing:'harbor',warehouse:'granary',pottery:'workshop',university:'school',copperMine:'quarry' };
  const shared = {treeDeco:'oak',monument:'monument',pasture:'pasture',orchard:'orchard',bath:'bath'};
  function civName(civ){ return CIVS.includes(civ) ? civ : 'china'; }
  function buildingKey(type,civ='china',level=1){
    civ=civName(civ);
    if(type==='wonder')return 'landmarks/'+civ+'-wonder';
    if(LANDMARKS.includes(type))return 'landmarks/'+type;
    if(type==='house') type=level<=3?'house1':level<=6?'house2':'house3';
    if(type==='villa') type=level<=2?'house2':'house3';
    if(type==='road')return 'terrain/road';
    if(shared[type])return 'terrain/'+shared[type];
    if(COMMON.includes(type))return 'common/'+type;
    type=aliases[type]||type;
    if(COMMON.includes(type))return 'common/'+type;
    return civ+'/'+(CORE.includes(type)?type:'workshop');
  }
  function url(key){return new URL('sprites/'+key.replaceAll('/','-')+'.webp',baseURL).href;}
  function load(key){
    if(cache.has(key))return cache.get(key).promise;
    const image=new Image(); image.decoding='async';
    const entry={image,loaded:false};
    entry.promise=new Promise(resolve=>{
      image.onload=()=>{entry.loaded=true;global.invalidateRenderer?.();resolve(true);};
      image.onerror=()=>{failures.add(key);resolve(false);};
    });
    cache.set(key,entry); image.src=url(key); return entry.promise;
  }
  function raster(key,image,width,ctx){
    // Repeated large-source resampling dominated dense city frames. Keep crisp
    // 1x/2x raster tiers; camera zoom does not create an unbounded width cache.
    const transform=ctx.getTransform?.(),scale=transform?Math.hypot(transform.a,transform.b):1;
    const targetWidth=Math.min(image.naturalWidth,Math.max(1,Math.ceil(width*(scale>1.2?2:1))));
    const id=key+':'+targetWidth;
    if(rasterCache.has(id))return rasterCache.get(id);
    const canvas=document.createElement('canvas');
    canvas.width=targetWidth;canvas.height=Math.max(1,Math.round(targetWidth*image.naturalHeight/image.naturalWidth));
    const drawing=canvas.getContext('2d');drawing.imageSmoothingEnabled=true;drawing.imageSmoothingQuality='high';
    drawing.drawImage(image,0,0,canvas.width,canvas.height);
    rasterCache.set(id,canvas);
    if(rasterCache.size>384)rasterCache.delete(rasterCache.keys().next().value);
    return canvas;
  }
  function draw(ctx,key,cx,cy,width,height,frame){
    if(key.startsWith('construction/stage')&&!/-[0-3]$/.test(key))key+='-'+((frame||0)%4);
    const entry=cache.get(key);
    if(!entry){load(key);return false;}
    if(!entry.loaded)return false;
    const im=entry.image,footHeight=height??width/2;
    const drawHeight=width*im.naturalHeight/im.naturalWidth;
    ctx.drawImage(raster(key,im,width,ctx),cx-width/2,cy+footHeight/2-drawHeight,width,drawHeight);
    return true;
  }
  function drawBuilding(ctx,options){
    const {type,civ='china',level=1,cx,cy,width,height}=options;
    return draw(ctx,buildingKey(type,civ,level),cx,cy,width,height);
  }
  function drawConstruction(ctx,options){
    const {cx,cy,width,height,progress=0,time=0,fromLevel=0,upgrade=false}=options;
    const stage=(upgrade||fromLevel>0)?4:Math.min(3,Math.floor(Math.max(0,Math.min(.999,progress))*3)+1);
    const frame=stage===3?Math.min(3,Math.floor(Math.max(0,progress-2/3)*12)):Math.floor(time/240)%4;
    return draw(ctx,'construction/stage'+stage,cx,cy,width,height,frame);
  }
  function drawTerrain(ctx,type,cx,cy,width,height,variant=0){
    if(type==='tree')type=['oak','cypress','palm','cherry'][Math.abs(variant|0)%4];
    if(!NATURAL.includes(type))return false;
    const key='terrain/'+type,entry=cache.get(key);
    if(!entry){load(key);return false;} if(!entry.loaded)return false;
    if(['grass','sand','water','road'].includes(type)){
      ctx.save();ctx.beginPath();ctx.moveTo(cx,cy-height/2);ctx.lineTo(cx+width/2,cy);ctx.lineTo(cx,cy+height/2);ctx.lineTo(cx-width/2,cy);ctx.closePath();ctx.clip();
      ctx.drawImage(entry.image,cx-width*.54,cy-height*.54,width*1.08,height*1.08);ctx.restore();return true;
    }
    const scale=type==='oak'||type==='cherry'?1.15:type==='cypress'||type==='palm'?.9:1;
    return draw(ctx,key,cx,cy,width*scale,height);
  }
  function preloadCivilization(civ){return Promise.all(CORE.map(type=>load(civName(civ)+'/'+type)));}
  const ready=Promise.all([
    preloadCivilization('china'),...COMMON.map(type=>load('common/'+type)),...NATURAL.map(type=>load('terrain/'+type)),
    ...LANDMARKS.map(type=>load('landmarks/'+type)),
    ...Array.from({length:16},(_,i)=>load('construction/stage'+(Math.floor(i/4)+1)+'-'+(i%4))),
    fetch(new URL('sprites.json',baseURL)).then(r=>r.json()).then(data=>{atlasMetadata=data;}).catch(()=>{})
  ]);
  function metadata(type,civ,level){
    const key=type.includes('/')?type:buildingKey(type,civ,level),data=atlasMetadata[key]||{};
    return {...data,key,url:url(key),lights:lightPoints(key),smoke:smokePoint(key)};
  }
  function lightPoints(key){
    const kind=key.split('/')[1];
    if(['farm','garden','pasture','orchard','oak','cypress','palm','cherry','monument','grass','sand','water','road'].includes(kind))return [];
    if(kind==='well')return [{x:.53,y:.56}];
    if(kind==='palace')return [{x:.35,y:.53},{x:.62,y:.56},{x:.50,y:.73}];
    if(kind==='house3')return [{x:.69,y:.43},{x:.31,y:.61},{x:.64,y:.73}];
    return [{x:.38,y:.62},{x:.65,y:.68}];
  }
  function smokePoint(key){
    const kind=key.split('/')[1];
    if(kind==='workshop'){
      const mouths={china:{x:.67,y:.14},egypt:{x:.49,y:.21},greece:{x:.46,y:.20},persia:{x:.30,y:.24},aztec:{x:.48,y:.27}};
      return mouths[key.split('/')[0]]||null;
    }
    if(kind==='kiln')return {x:.36,y:.12};
    return null;
  }
  global.GameArt={ready,url,draw,drawBuilding,drawTerrain,drawConstruction,preloadCivilization,load,buildingKey,metadata,
    thumbnail:(type,civ,level)=>url(buildingKey(type,civ,level)),hero:new URL('hero.webp',baseURL).href,
    get errors(){return [...failures];},get loaded(){return [...cache.values()].filter(e=>e.loaded).length;},get rasterCacheSize(){return rasterCache.size;}
  };
})(window);
